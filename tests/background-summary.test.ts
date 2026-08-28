import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

Object.assign(globalThis, {
  defineBackground: () => undefined,
});

const {
  backgroundTestState,
  enrichRepositoryDetail,
  fetchRepositorySummaryStage,
  handleMessage,
  toRepositorySummary,
} = await import('../entrypoints/background.ts');

beforeEach(() => backgroundTestState.reset());

function futureReset(seconds = 3_600): number {
  return Math.floor(Date.now() / 1_000) + seconds;
}

const repositoryPayload = {
  full_name: 'octo/example',
  html_url: 'https://github.com/octo/example',
  description: 'Example repository',
  stargazers_count: 123,
  forks_count: 12,
  subscribers_count: 7,
  language: 'TypeScript',
  license: { spdx_id: 'MIT', name: 'MIT License' },
  topics: ['browser-extension'],
  archived: false,
  disabled: false,
  fork: false,
  is_template: false,
  visibility: 'public',
  has_issues: true,
  default_branch: 'main',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  pushed_at: '2026-08-26T10:00:00Z',
};

function jsonResponse(
  body: unknown,
  options: { status?: number; resource?: 'core' | 'search'; remaining?: number; reset?: number } = {},
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.resource) headers.set('x-ratelimit-resource', options.resource);
  if (options.remaining != null) headers.set('x-ratelimit-remaining', String(options.remaining));
  if (options.reset != null) headers.set('x-ratelimit-reset', String(options.reset));
  return new Response(JSON.stringify(body), { status: options.status ?? 200, headers });
}

test('automatic summaries use repository metadata without issue searches', async () => {
  const urls: string[] = [];
  const stage = await fetchRepositorySummaryStage('octo', 'example', {
    priority: 'automatic',
    request: async (url: string): Promise<Response> => {
      urls.push(url);
      return jsonResponse(repositoryPayload, { resource: 'core', remaining: 55 });
    },
  });

  assert.deepEqual(urls, ['https://api.github.com/repos/octo/example']);
  assert.equal(stage.openIssues, null);
  assert.equal(stage.closedIssues, null);
  assert.match(stage.warnings.join(' '), /detail/i);
});

test('summary hydration returns exact issue counts from issue-only searches', async () => {
  const urls: string[] = [];
  const request = async (url: string): Promise<Response> => {
    urls.push(url);
    if (url.includes('/search/issues')) {
      const state = new URL(url).searchParams.get('q')?.includes('is:closed') ? 'closed' : 'open';
      return jsonResponse({
        total_count: state === 'open' ? 9 : 41,
        incomplete_results: false,
        items: [{ created_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-21T00:00:00Z' }],
      }, { resource: 'search', remaining: state === 'open' ? 8 : 7, reset: futureReset() });
    }
    return jsonResponse(repositoryPayload, { resource: 'core', remaining: 55 });
  };

  const stage = await fetchRepositorySummaryStage('octo', 'example', {
    priority: 'explicit',
    request,
    now: () => new Date('2026-08-27T12:00:00Z'),
  });
  const summary = toRepositorySummary(stage);

  assert.equal(summary.stars, 123);
  assert.equal(summary.openIssues, 9);
  assert.equal(summary.closedIssues, 41);
  assert.equal(summary.pushedAt, repositoryPayload.pushed_at);
  assert.equal(summary.fetchedAt, '2026-08-27T12:00:00.000Z');
  assert.deepEqual(summary.warnings, []);
  assert.equal(summary.rateLimit.searchRemaining, 7);
  assert.equal(urls.length, 3);
  for (const url of urls.filter((candidate) => candidate.includes('/search/issues'))) {
    assert.match(new URL(url).searchParams.get('q') ?? '', /\bis:issue\b/);
  }
});

test('detail enrichment reuses successful summary data and only fetches contributors', async () => {
  const summaryUrls: string[] = [];
  const stage = await fetchRepositorySummaryStage('octo', 'example', {
    priority: 'explicit',
    now: () => new Date('2026-08-27T12:00:00Z'),
    request: async (url: string): Promise<Response> => {
      summaryUrls.push(url);
      if (url.includes('/search/issues')) {
        const closed = new URL(url).searchParams.get('q')?.includes('is:closed');
        return jsonResponse({
          total_count: closed ? 41 : 9,
          incomplete_results: false,
          items: [{ created_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-21T00:00:00Z' }],
        }, { resource: 'search', remaining: closed ? 7 : 8 });
      }
      return jsonResponse(repositoryPayload, { resource: 'core', remaining: 55 });
    },
  });

  const detailUrls: string[] = [];
  const detail = await enrichRepositoryDetail(stage, {
    request: async (url: string): Promise<Response> => {
      detailUrls.push(url);
      return jsonResponse([{}], { resource: 'core', remaining: 54 });
    },
    now: () => new Date('2026-08-27T12:05:00Z'),
  });

  assert.equal(summaryUrls.length, 3);
  assert.equal(detailUrls.length, 1);
  assert.match(detailUrls[0] ?? '', /\/contributors\?/);
  assert.equal(detail.fullName, 'octo/example');
  assert.equal(detail.openIssues, 9);
  assert.equal(detail.closedIssues, 41);
  assert.equal(detail.contributors, 1);
  assert.equal(detail.fetchedAt, '2026-08-27T12:00:00.000Z');
});

test('detail fills deferred issue fields back into the reusable summary stage', async () => {
  const stage = await fetchRepositorySummaryStage('octo', 'deferred', {
    priority: 'automatic',
    request: async (url: string): Promise<Response> => {
      if (url.includes('/search/issues')) {
        return jsonResponse({
          total_count: 3,
          incomplete_results: false,
          items: [{ created_at: '2026-08-20T00:00:00Z', closed_at: null }],
        }, { resource: 'search', remaining: 2, reset: futureReset() });
      }
      return jsonResponse({ ...repositoryPayload, full_name: 'octo/deferred' }, {
        resource: 'core',
        remaining: 55,
      });
    },
  });
  assert.equal(toRepositorySummary(stage).closedIssues, null);

  const detail = await enrichRepositoryDetail(stage, {
    request: async (url: string): Promise<Response> => {
      if (url.includes('/search/issues')) {
        const closed = new URL(url).searchParams.get('q')?.includes('is:closed');
        return jsonResponse({
          total_count: closed ? 17 : 3,
          incomplete_results: false,
          items: [{ created_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-21T00:00:00Z' }],
        }, { resource: 'search', remaining: closed ? 0 : 1 });
      }
      return jsonResponse({ message: 'contributors unavailable' }, { status: 503, resource: 'core' });
    },
  });

  const upgradedSummary = toRepositorySummary(stage);
  assert.equal(upgradedSummary.openIssues, 3);
  assert.equal(upgradedSummary.closedIssues, 17);
  assert.doesNotMatch(upgradedSummary.warnings.join(' '), /deferred/i);
  assert.equal(detail.stars, 123);
  assert.equal(detail.contributors, null);
  assert.match(detail.warnings.join(' '), /contributor/i);
});

test('message flow migrates V2, caches V3 stages, and deduplicates detail hydration', async () => {
  const now = Date.parse('2026-08-28T12:00:00Z');
  backgroundTestState.reset(now);
  const values = new Map<string, unknown>([
    ['githubLensRepositoryCacheV2', { stale: true }],
  ]);
  const local = {
    async get(key: string): Promise<Record<string, unknown>> {
      return { [key]: values.get(key) };
    },
    async set(items: Record<string, unknown>): Promise<void> {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
  };
  Object.assign(globalThis, {
    browser: {
      storage: { local },
      runtime: { getURL: (path: string) => `chrome-extension://github-lens/${path}` },
    },
  });

  const urls: string[] = [];
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      urls.push(url);
      if (url.includes('/search/issues')) {
        const closed = new URL(url).searchParams.get('q')?.includes('is:closed');
        return jsonResponse({
          total_count: closed ? 22 : 4,
          incomplete_results: false,
          items: [{ created_at: '2026-08-20T00:00:00Z', closed_at: '2026-08-21T00:00:00Z' }],
        }, { resource: 'search', remaining: closed ? 8 : 9 });
      }
      if (url.includes('/contributors?')) return jsonResponse([{}], { resource: 'core', remaining: 49 });
      return jsonResponse({ ...repositoryPayload, full_name: 'cache/example' }, {
        resource: 'core',
        remaining: 50,
      });
    },
  });

  const summaryResponse = await handleMessage(
    { type: 'repository-summary', owner: 'cache', repo: 'example' },
    {},
  );
  assert.equal(summaryResponse.ok, true);

  const [firstPreview, secondPreview] = await Promise.all([
    handleMessage({ type: 'repository-preview', owner: 'cache', repo: 'example' }, {}),
    handleMessage({ type: 'repository-preview', owner: 'cache', repo: 'example' }, {}),
  ]);
  assert.equal(firstPreview.ok, true);
  assert.deepEqual(secondPreview, firstPreview);

  const upgradedSummary = await handleMessage(
    { type: 'repository-summary', owner: 'cache', repo: 'example' },
    {},
  );
  assert.equal(upgradedSummary.ok, true);
  if (upgradedSummary.ok) {
    const data = upgradedSummary.data as { openIssues: number | null; closedIssues: number | null };
    assert.equal(data.openIssues, 4);
    assert.equal(data.closedIssues, 22);
  }

  assert.equal(urls.filter((url) => /\/repos\/cache\/example$/.test(url)).length, 1);
  assert.equal(urls.filter((url) => url.includes('/search/issues')).length, 2);
  assert.equal(urls.filter((url) => url.includes('/contributors?')).length, 1);
  assert.equal(values.has('githubLensRepositoryCacheV2'), false);
  assert.equal(values.has('githubLensRepositoryCacheV3'), true);
  const cache = values.get('githubLensRepositoryCacheV3') as Record<string, {
    summary?: { expiresAt: number };
  }>;
  assert.equal(cache['cache/example']?.summary?.expiresAt, now + 24 * 60 * 60_000);

  let releaseFirstSummary: (() => void) | undefined;
  let markFirstSummaryStarted: (() => void) | undefined;
  let markExplicitStarted: (() => void) | undefined;
  const firstSummaryGate = new Promise<void>((resolve) => { releaseFirstSummary = resolve; });
  const firstSummaryStarted = new Promise<void>((resolve) => { markFirstSummaryStarted = resolve; });
  const explicitStarted = new Promise<void>((resolve) => { markExplicitStarted = resolve; });
  const metadataOrder: string[] = [];
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      if (url.includes('/search/issues')) {
        return jsonResponse({ total_count: 1, incomplete_results: false, items: [] }, {
          resource: 'search',
          remaining: 10,
        });
      }
      if (url.includes('/contributors?')) return jsonResponse([], { resource: 'core', remaining: 40 });
      const match = url.match(/\/repos\/queue\/(first|second|explicit)$/);
      const repo = match?.[1] ?? 'unknown';
      metadataOrder.push(repo);
      if (repo === 'first') {
        markFirstSummaryStarted?.();
        await firstSummaryGate;
      }
      if (repo === 'explicit') markExplicitStarted?.();
      return jsonResponse({ ...repositoryPayload, full_name: `queue/${repo}` }, {
        resource: 'core',
        remaining: 50,
      });
    },
  });

  const firstAutomatic = handleMessage(
    { type: 'repository-summary', owner: 'queue', repo: 'first' },
    {},
  );
  await firstSummaryStarted;
  const secondAutomatic = handleMessage(
    { type: 'repository-summary', owner: 'queue', repo: 'second' },
    {},
  );
  const explicit = handleMessage(
    { type: 'repository-preview', owner: 'queue', repo: 'explicit' },
    {},
  );
  await explicitStarted;
  assert.deepEqual(metadataOrder, ['first', 'explicit']);
  releaseFirstSummary?.();
  await Promise.all([firstAutomatic, secondAutomatic, explicit]);
  assert.deepEqual(metadataOrder, ['first', 'explicit', 'second']);

  const cleared = await handleMessage(
    { type: 'clear-cache' },
    { url: 'chrome-extension://github-lens/popup.html' },
  );
  assert.equal(cleared.ok, true);
  assert.equal(values.has('githubLensRepositoryCacheV3'), false);
});

test('settings normalize and expose include and exclude site lists', async () => {
  const preservedCache = { 'cached/repository': { summary: { expiresAt: Date.now() + 10_000 } } };
  const values = new Map<string, unknown>([
    ['githubLensSettingsV1', { enabled: true, token: '' }],
    ['githubLensRepositoryCacheV3', preservedCache],
  ]);
  Object.assign(globalThis, {
    browser: {
      storage: {
        local: {
          async get(key: string): Promise<Record<string, unknown>> {
            return { [key]: values.get(key) };
          },
          async set(items: Record<string, unknown>): Promise<void> {
            for (const [key, value] of Object.entries(items)) values.set(key, value);
          },
          async remove(keys: string | string[]): Promise<void> {
            for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
          },
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://github-lens/${path}` },
    },
  });

  const saved = await handleMessage({
    type: 'save-settings',
    settings: {
      enabled: true,
      token: '',
      pageAccessMode: 'selected-sites',
      includedSites: [' Google.com ', 'https://news.ycombinator.com/item', 'google.com'],
      excludedSites: ['*.github.com'],
      inlineFields: ['lastPush', 'stars', 'unknown', 'stars'],
    },
  }, { url: 'chrome-extension://github-lens/popup.html' });

  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.deepEqual(saved.data, {
      enabled: true,
      hasToken: false,
      token: '',
      pageAccessMode: 'selected-sites',
      includedSites: ['google.com', 'news.ycombinator.com'],
      excludedSites: ['github.com'],
      inlineFields: ['stars', 'lastPush'],
    });
  }
  assert.deepEqual(values.get('githubLensSettingsV1'), {
    enabled: true,
    token: '',
    pageAccessMode: 'selected-sites',
    includedSites: ['google.com', 'news.ycombinator.com'],
    excludedSites: ['github.com'],
    inlineFields: ['stars', 'lastPush'],
  });
  assert.deepEqual(values.get('githubLensRepositoryCacheV3'), preservedCache);
});
