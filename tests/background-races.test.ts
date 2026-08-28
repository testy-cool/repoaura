import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

Object.assign(globalThis, { defineBackground: () => undefined });

const { backgroundTestState, handleMessage } = await import('../entrypoints/background.ts');

beforeEach(() => backgroundTestState.reset());

const extensionSender = { url: 'chrome-extension://github-lens/popup.html' };

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: () => resolvePromise?.() };
}

function jsonResponse(
  body: unknown,
  options: { resource?: 'core' | 'search'; remaining?: number; reset?: number } = {},
): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.resource) headers.set('x-ratelimit-resource', options.resource);
  if (options.remaining != null) headers.set('x-ratelimit-remaining', String(options.remaining));
  if (options.reset != null) headers.set('x-ratelimit-reset', String(options.reset));
  return new Response(JSON.stringify(body), { headers });
}

function repositoryPayload(fullName: string, stars = 1): Record<string, unknown> {
  return {
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: 'Race fixture',
    stargazers_count: stars,
    forks_count: 2,
    subscribers_count: 3,
    language: 'TypeScript',
    license: { spdx_id: 'MIT', name: 'MIT License' },
    topics: [],
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
}

function issueResponse(): Response {
  return jsonResponse({ total_count: 1, incomplete_results: false, items: [] }, {
    resource: 'search',
    remaining: 8,
    reset: Math.floor(Date.now() / 1_000) + 3_600,
  });
}

function installStorage(initial: Record<string, unknown> = {}): Map<string, unknown> {
  const values = new Map(Object.entries(initial));
  Object.assign(globalThis, {
    browser: {
      storage: {
        local: {
          async get(key: string): Promise<Record<string, unknown>> {
            const value = values.get(key);
            return { [key]: value == null ? value : structuredClone(value) };
          },
          async set(items: Record<string, unknown>): Promise<void> {
            for (const [key, value] of Object.entries(items)) {
              values.set(key, structuredClone(value));
            }
          },
          async remove(keys: string | string[]): Promise<void> {
            for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
          },
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://github-lens/${path}` },
    },
  });
  return values;
}

test('settings change starts a new credential generation and rejects the old cache write', async () => {
  const values = installStorage({
    githubLensSettingsV1: { enabled: true, token: 'old-token' },
  });
  const oldGate = deferred();
  const oldStarted = deferred();
  const newStarted = deferred();
  const authorizations: string[] = [];

  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      authorizations.push(authorization);
      if (url.endsWith('/repos/race/token')) {
        if (authorization === 'Bearer old-token') {
          oldStarted.resolve();
          await oldGate.promise;
          return jsonResponse(repositoryPayload('race/token', 1), { resource: 'core', remaining: 50 });
        }
        newStarted.resolve();
        return jsonResponse(repositoryPayload('race/token', 2), { resource: 'core', remaining: 49 });
      }
      if (url.includes('/contributors?')) return jsonResponse([], { resource: 'core', remaining: 48 });
      return issueResponse();
    },
  });

  const oldRequest = handleMessage({ type: 'repository-summary', owner: 'race', repo: 'token' }, {});
  await oldStarted.promise;
  await handleMessage({
    type: 'save-settings',
    settings: { enabled: true, token: 'new-token' },
  }, extensionSender);
  const newRequest = handleMessage({ type: 'repository-preview', owner: 'race', repo: 'token' }, {});

  const beganWithNewToken = await Promise.race([
    newStarted.promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
  ]);
  oldGate.resolve();
  const [, newResponse] = await Promise.all([oldRequest, newRequest]);

  assert.equal(beganWithNewToken, true);
  assert.equal(newResponse.ok, true);
  if (newResponse.ok) assert.equal((newResponse.data as { stars: number }).stars, 2);
  assert.equal(authorizations.filter((value) => value === 'Bearer old-token').length, 1);
  assert.ok(authorizations.includes('Bearer new-token'));
  const cache = values.get('githubLensRepositoryCacheV3') as Record<string, {
    summary?: { data: { repository: { stargazers_count: number } } };
  }>;
  assert.equal(cache['race/token']?.summary?.data.repository.stargazers_count, 2);
  assert.deepEqual(Object.keys(cache), ['race/token']);
});

test('persisted summary cache survives a background-state restart', async () => {
  installStorage();
  let metadataRequests = 0;
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      if (url.endsWith('/repos/race/restart')) {
        metadataRequests += 1;
        return jsonResponse(repositoryPayload('race/restart'), { resource: 'core', remaining: 50 });
      }
      return issueResponse();
    },
  });

  await handleMessage({
    type: 'save-settings',
    settings: { enabled: true, token: 'restart-token' },
  }, extensionSender);
  const first = await handleMessage(
    { type: 'repository-summary', owner: 'race', repo: 'restart' },
    {},
  );
  backgroundTestState.reset();
  const afterRestart = await handleMessage(
    { type: 'repository-summary', owner: 'race', repo: 'restart' },
    {},
  );

  assert.equal(first.ok, true);
  assert.equal(metadataRequests, 1);
  assert.deepEqual(afterRestart, first);
});

test('new-generation automatic summary bypasses gated old-generation work', async () => {
  installStorage({ githubLensSettingsV1: { enabled: true, token: 'old-token' } });
  const oldGate = deferred();
  const oldStarted = deferred();
  const newStarted = deferred();
  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.endsWith('/repos/race/automatic')) {
        const authorization = new Headers(init?.headers).get('authorization');
        if (authorization === 'Bearer old-token') {
          oldStarted.resolve();
          await oldGate.promise;
        } else {
          newStarted.resolve();
        }
        return jsonResponse(repositoryPayload('race/automatic'), { resource: 'core', remaining: 50 });
      }
      return issueResponse();
    },
  });

  const oldRequest = handleMessage(
    { type: 'repository-summary', owner: 'race', repo: 'automatic' },
    {},
  );
  await oldStarted.promise;
  await handleMessage({
    type: 'save-settings',
    settings: { enabled: true, token: 'new-token' },
  }, extensionSender);
  const newRequest = handleMessage(
    { type: 'repository-summary', owner: 'race', repo: 'automatic' },
    {},
  );

  const beganBeforeRelease = await Promise.race([
    newStarted.promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
  ]);
  oldGate.resolve();
  await Promise.all([oldRequest, newRequest]);

  assert.equal(beganBeforeRelease, true);
});

test('summary waits for a concurrent settings cache removal before reading V3', async () => {
  const now = Date.now();
  const removeGate = deferred();
  const removeStarted = deferred();
  const values = new Map<string, unknown>([
    ['githubLensSettingsV1', { enabled: true, token: 'old-token' }],
    ['githubLensRepositoryCacheV3', {
      'race/interleaving': {
        summary: {
          data: {
            repository: repositoryPayload('race/interleaving', 1),
            openIssues: { count: 1, latestAt: null },
            closedIssues: { count: 1, latestAt: null },
            fetchedAt: new Date(now - 60_000).toISOString(),
            warnings: [],
            rateLimit: { coreRemaining: 50, searchRemaining: 8, resetAt: null },
          },
          expiresAt: now + 60_000,
        },
      },
    }],
  ]);
  Object.assign(globalThis, {
    browser: {
      storage: {
        local: {
          async get(key: string): Promise<Record<string, unknown>> {
            const value = values.get(key);
            return { [key]: value == null ? value : structuredClone(value) };
          },
          async set(items: Record<string, unknown>): Promise<void> {
            for (const [key, value] of Object.entries(items)) {
              values.set(key, structuredClone(value));
            }
          },
          async remove(keys: string | string[]): Promise<void> {
            const targets = Array.isArray(keys) ? keys : [keys];
            if (targets.includes('githubLensRepositoryCacheV3')) {
              removeStarted.resolve();
              await removeGate.promise;
            }
            for (const key of targets) values.delete(key);
          },
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://github-lens/${path}` },
    },
  });

  let metadataRequests = 0;
  const authorizations: string[] = [];
  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '');
      if (url.endsWith('/repos/race/interleaving')) {
        metadataRequests += 1;
        return jsonResponse(repositoryPayload('race/interleaving', 2), {
          resource: 'core',
          remaining: 49,
        });
      }
      return issueResponse();
    },
  });

  const saveRequest = handleMessage({
    type: 'save-settings',
    settings: { enabled: true, token: 'new-token' },
  }, extensionSender);
  await removeStarted.promise;
  const summaryRequest = handleMessage(
    { type: 'repository-summary', owner: 'race', repo: 'interleaving' },
    {},
  );
  const returnedBeforeRemoval = await Promise.race([
    summaryRequest.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 30)),
  ]);
  removeGate.resolve();
  const [, summary] = await Promise.all([saveRequest, summaryRequest]);

  assert.equal(returnedBeforeRemoval, false);
  assert.equal(summary.ok, true);
  if (summary.ok) assert.equal((summary.data as { stars: number }).stars, 2);
  assert.equal(metadataRequests, 1);
  assert.ok(authorizations.every((value) => value === 'Bearer new-token'));
});

test('clear-cache prevents an older in-flight request from repopulating V3', async () => {
  const values = installStorage();
  const gate = deferred();
  const started = deferred();
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      if (url.endsWith('/repos/race/clear')) {
        started.resolve();
        await gate.promise;
        return jsonResponse(repositoryPayload('race/clear'), { resource: 'core', remaining: 50 });
      }
      return issueResponse();
    },
  });

  const oldRequest = handleMessage({ type: 'repository-summary', owner: 'race', repo: 'clear' }, {});
  await started.promise;
  await handleMessage({ type: 'clear-cache' }, extensionSender);
  gate.resolve();
  await oldRequest;

  assert.equal(values.has('githubLensRepositoryCacheV3'), false);
});

test('expired cleanup does not delete a fresh stage written ahead of it', async () => {
  const now = Date.now();
  const expiredStage = {
    data: {
      repository: repositoryPayload('race/expiry'),
      openIssues: { count: 1, latestAt: null },
      closedIssues: { count: 1, latestAt: null },
      fetchedAt: new Date(now - 60_000).toISOString(),
      warnings: [],
      rateLimit: { coreRemaining: 50, searchRemaining: 8, resetAt: null },
    },
    expiresAt: now - 1,
  };
  const freshStage = {
    ...expiredStage,
    data: { ...expiredStage.data, fetchedAt: new Date(now).toISOString() },
    expiresAt: now + 60_000,
  };
  const values = new Map<string, unknown>([
    ['githubLensRepositoryCacheV3', {
      'race/expiry': { summary: expiredStage },
    }],
  ]);
  let replaceExpiredSnapshot = true;
  let metadataRequests = 0;
  Object.assign(globalThis, {
    browser: {
      storage: {
        local: {
          async get(key: string): Promise<Record<string, unknown>> {
            const value = values.get(key);
            if (key === 'githubLensRepositoryCacheV3' && replaceExpiredSnapshot) {
              replaceExpiredSnapshot = false;
              values.set(key, { 'race/expiry': { summary: freshStage } });
            }
            return { [key]: value == null ? value : structuredClone(value) };
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
    fetch: async (url: string): Promise<Response> => {
      if (url.endsWith('/repos/race/expiry')) {
        metadataRequests += 1;
        return jsonResponse(repositoryPayload('race/expiry'), { resource: 'core', remaining: 50 });
      }
      return issueResponse();
    },
  });

  await handleMessage({ type: 'repository-summary', owner: 'race', repo: 'expiry' }, {});

  const cache = values.get('githubLensRepositoryCacheV3') as Record<string, {
    summary?: { expiresAt: number };
  }>;
  assert.equal(metadataRequests, 0);
  assert.equal(cache['race/expiry']?.summary?.expiresAt, freshStage.expiresAt);
});

test('contributor-only detail preserves summary observation time and expiry', async () => {
  const now = Date.now();
  const fetchedAt = new Date(now - 5 * 60_000).toISOString();
  const expiresAt = now + 1_000;
  const stage = {
    repository: repositoryPayload('race/freshness'),
    openIssues: { count: 1, latestAt: null },
    closedIssues: { count: 2, latestAt: null },
    fetchedAt,
    warnings: [],
    rateLimit: { coreRemaining: 50, searchRemaining: 8, resetAt: null },
  };
  const values = installStorage({
    githubLensRepositoryCacheV3: {
      'race/freshness': {
        summary: { data: stage, expiresAt },
      },
    },
  });
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      assert.match(url, /\/contributors\?/);
      return jsonResponse([], { resource: 'core', remaining: 49 });
    },
  });

  const response = await handleMessage(
    { type: 'repository-preview', owner: 'race', repo: 'freshness' },
    {},
  );

  assert.equal(response.ok, true);
  if (response.ok) assert.equal((response.data as { fetchedAt: string }).fetchedAt, fetchedAt);
  const cache = values.get('githubLensRepositoryCacheV3') as Record<string, {
    summary?: { data: { fetchedAt: string }; expiresAt: number };
  }>;
  assert.equal(cache['race/freshness']?.summary?.data.fetchedAt, fetchedAt);
  assert.equal(cache['race/freshness']?.summary?.expiresAt, expiresAt);
});

test('filling deferred issues updates summary data without extending its expiry', async () => {
  const now = Date.now();
  const fetchedAt = new Date(now - 4 * 60_000).toISOString();
  const expiresAt = now + 1_000;
  const values = installStorage({
    githubLensRepositoryCacheV3: {
      'race/deferred': {
        summary: {
          data: {
            repository: repositoryPayload('race/deferred'),
            openIssues: null,
            closedIssues: null,
            fetchedAt,
            warnings: ['Issue counts deferred to preserve GitHub search capacity for an explicit preview.'],
            rateLimit: { coreRemaining: 50, searchRemaining: 2, resetAt: null },
          },
          expiresAt,
        },
      },
    },
  });
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      if (url.includes('/search/issues')) {
        const closed = new URL(url).searchParams.get('q')?.includes('is:closed');
        return jsonResponse({ total_count: closed ? 6 : 3, incomplete_results: false, items: [] }, {
          resource: 'search',
          remaining: closed ? 6 : 7,
          reset: Math.floor(Date.now() / 1_000) + 3_600,
        });
      }
      assert.match(url, /\/contributors\?/);
      return jsonResponse([], { resource: 'core', remaining: 49 });
    },
  });

  const response = await handleMessage(
    { type: 'repository-preview', owner: 'race', repo: 'deferred' },
    {},
  );

  assert.equal(response.ok, true);
  if (response.ok) assert.equal((response.data as { fetchedAt: string }).fetchedAt, fetchedAt);
  const cache = values.get('githubLensRepositoryCacheV3') as Record<string, {
    summary?: {
      data: { openIssues: { count: number }; closedIssues: { count: number }; fetchedAt: string };
      expiresAt: number;
    };
  }>;
  assert.equal(cache['race/deferred']?.summary?.data.openIssues.count, 3);
  assert.equal(cache['race/deferred']?.summary?.data.closedIssues.count, 6);
  assert.equal(cache['race/deferred']?.summary?.data.fetchedAt, fetchedAt);
  assert.equal(cache['race/deferred']?.summary?.expiresAt, expiresAt);
});
