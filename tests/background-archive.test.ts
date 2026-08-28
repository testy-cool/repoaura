import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

Object.assign(globalThis, { defineBackground: () => undefined });

const {
  backgroundTestState,
  handleArchivePermissionAdded,
  handleMessage,
} = await import('../entrypoints/background.ts');

const extensionSender = { url: 'chrome-extension://github-lens/popup.html' };
const archiveEndpoint = 'https://archive.example.test:8443';

beforeEach(() => backgroundTestState.reset(Date.parse('2026-08-28T12:00:00Z')));

function repositoryPayload(fullName: string): Record<string, unknown> {
  return {
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description: 'Archive fixture',
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
}

function installBrowser(options: { archiveAccess?: boolean } = {}): {
  values: Map<string, unknown>;
  alarms: number[];
  setArchiveAccess(granted: boolean): void;
} {
  const values = new Map<string, unknown>();
  const alarms: number[] = [];
  let archiveAccess = options.archiveAccess ?? true;
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
      alarms: {
        create(_name: string, options: { delayInMinutes: number }): void {
          alarms.push(options.delayInMinutes);
        },
      },
      permissions: {
        async contains(): Promise<boolean> {
          return archiveAccess;
        },
      },
      runtime: { getURL: (path: string) => `chrome-extension://github-lens/${path}` },
    },
  });
  return {
    values,
    alarms,
    setArchiveAccess(granted: boolean): void {
      archiveAccess = granted;
    },
  };
}

test('starts with both archive streams disabled and no endpoint', async () => {
  installBrowser({ archiveAccess: true });

  const state = await handleMessage({ type: 'get-archive-settings' }, extensionSender);

  assert.equal(state.ok, true);
  if (state.ok) {
    assert.equal((state.data as { snapshotsEnabled: boolean }).snapshotsEnabled, false);
    assert.equal((state.data as { encountersEnabled: boolean }).encountersEnabled, false);
    assert.equal((state.data as { endpoint: string }).endpoint, '');
    assert.equal((state.data as { accessGranted: boolean }).accessGranted, false);
  }
});

test('migrates the old combined switch to snapshots without enabling history', async () => {
  const { values } = installBrowser({ archiveAccess: true });
  values.set('githubLensArchiveSettingsV1', { enabled: true, endpoint: archiveEndpoint });
  backgroundTestState.clearArchiveOverride();

  const state = await handleMessage({ type: 'get-archive-settings' }, extensionSender);

  assert.equal(state.ok, true);
  if (state.ok) {
    assert.equal((state.data as { snapshotsEnabled: boolean }).snapshotsEnabled, true);
    assert.equal((state.data as { encountersEnabled: boolean }).encountersEnabled, false);
    assert.equal((state.data as { accessGranted: boolean }).accessGranted, true);
  }
  assert.deepEqual(values.get('githubLensArchiveSettingsV1'), {
    snapshotsEnabled: true,
    encountersEnabled: false,
    endpoint: archiveEndpoint,
  });
});

test('flushes observations queued while archive access was pending when permission arrives', async () => {
  const { values, setArchiveAccess } = installBrowser({ archiveAccess: false });
  const archiveBodies: Array<Record<string, unknown>> = [];
  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === `${archiveEndpoint}/api/collections/repository_observations/records`) {
        archiveBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'archive-record' }), { status: 200 });
      }
      return new Response(JSON.stringify(repositoryPayload('archive/pending')), { status: 200 });
    },
  });

  const saved = await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: false, endpoint: archiveEndpoint },
  }, extensionSender);
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal((saved.data as { accessGranted: boolean }).accessGranted, false);

  await handleMessage(
    { type: 'repository-summary', owner: 'archive', repo: 'pending' },
    {},
  );
  assert.equal((values.get('githubLensArchiveQueueV1') as unknown[]).length, 1);
  assert.equal(archiveBodies.length, 0);

  setArchiveAccess(true);
  await handleArchivePermissionAdded();

  assert.equal(archiveBodies.length, 1);
  assert.deepEqual(values.get('githubLensArchiveQueueV1'), []);
});

test('archives a fresh summary once and does not archive a 24-hour cache hit again', async () => {
  const { values } = installBrowser();
  const archiveBodies: Array<Record<string, unknown>> = [];
  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === `${archiveEndpoint}/api/collections/repository_observations/records`) {
        archiveBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'archive-record' }), { status: 200 });
      }
      return new Response(JSON.stringify(repositoryPayload('archive/example')), { status: 200 });
    },
  });

  const saved = await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: false, endpoint: archiveEndpoint },
  }, extensionSender);
  assert.equal(saved.ok, true);

  const first = await handleMessage(
    { type: 'repository-summary', owner: 'archive', repo: 'example' },
    {},
  );
  assert.equal(first.ok, true);
  await handleMessage({ type: 'flush-archive' }, extensionSender);

  const cached = await handleMessage(
    { type: 'repository-summary', owner: 'archive', repo: 'example' },
    {},
  );
  assert.deepEqual(cached, first);
  await handleMessage({ type: 'flush-archive' }, extensionSender);

  assert.equal(archiveBodies.length, 1);
  assert.equal(archiveBodies[0]?.observation_id, 'archive/example|2026-08-28T12:00:00.000Z|summary');
  assert.equal(archiveBodies[0]?.stage, 'summary');
  assert.deepEqual(values.get('githubLensArchiveQueueV1'), []);
});

test('archives encounters on cached repository views without another GitHub request', async () => {
  installBrowser();
  const githubUrls: string[] = [];
  const observations: Array<Record<string, unknown>> = [];
  const encounters: Array<Record<string, unknown>> = [];
  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === `${archiveEndpoint}/api/collections/repository_observations/records`) {
        observations.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'observation-record' }), { status: 200 });
      }
      if (url === `${archiveEndpoint}/api/collections/repository_encounters/records`) {
        encounters.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: `encounter-${encounters.length}` }), { status: 200 });
      }
      githubUrls.push(url);
      return new Response(JSON.stringify(repositoryPayload('archive/cached')), { status: 200 });
    },
  });

  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: true, endpoint: archiveEndpoint },
  }, extensionSender);
  await handleMessage({ type: 'repository-summary', owner: 'archive', repo: 'cached' }, {});
  await handleMessage({
    type: 'record-repository-encounter',
    encounterId: 'page-one',
    owner: 'archive',
    repo: 'cached',
    source: 'link',
    pageUrl: 'https://www.google.com/search?q=archive',
    pageTitle: 'Archive search',
    linkText: 'archive/cached',
  }, { url: 'https://www.google.com/search?q=archive' });
  await handleMessage({ type: 'repository-summary', owner: 'archive', repo: 'cached' }, {});
  await handleMessage({
    type: 'record-repository-encounter',
    encounterId: 'page-two',
    owner: 'archive',
    repo: 'cached',
    source: 'direct',
    pageUrl: 'https://github.com/archive/cached',
    pageTitle: 'archive/cached',
    linkText: '',
  }, { url: 'https://github.com/archive/cached' });
  await handleMessage({ type: 'flush-archive' }, extensionSender);

  assert.equal(githubUrls.length, 1);
  assert.equal(observations.length, 1);
  assert.equal(encounters.length, 2);
  assert.deepEqual(encounters.map((item) => item.encounter_id), ['page-one', 'page-two']);
  assert.deepEqual(encounters.map((item) => item.source), ['link', 'direct']);
});

test('archives encounters when an observation upload is temporarily failing', async () => {
  const { values, setArchiveAccess } = installBrowser({ archiveAccess: false });
  const encounters: Array<Record<string, unknown>> = [];
  Object.assign(globalThis, {
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      if (url === `${archiveEndpoint}/api/collections/repository_observations/records`) {
        return new Response(JSON.stringify({ message: 'Observation unavailable' }), { status: 503 });
      }
      if (url === `${archiveEndpoint}/api/collections/repository_encounters/records`) {
        encounters.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ id: 'encounter-record' }), { status: 200 });
      }
      return new Response(JSON.stringify(repositoryPayload('archive/partial')), { status: 200 });
    },
  });

  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: true, endpoint: archiveEndpoint },
  }, extensionSender);
  await handleMessage({ type: 'repository-summary', owner: 'archive', repo: 'partial' }, {});
  await handleMessage({
    type: 'record-repository-encounter',
    encounterId: 'partial-page',
    owner: 'archive',
    repo: 'partial',
    source: 'link',
    pageUrl: 'https://example.com/partial',
    pageTitle: 'Partial archive',
    linkText: 'archive/partial',
  }, { url: 'https://example.com/partial' });

  setArchiveAccess(true);
  await handleMessage({ type: 'flush-archive' }, extensionSender);

  assert.equal((values.get('githubLensArchiveQueueV1') as unknown[]).length, 1);
  assert.deepEqual(values.get('githubLensEncounterQueueV1'), []);
  assert.deepEqual(encounters.map((item) => item.encounter_id), ['partial-page']);
});

test('deduplicates a retried encounter before PocketBase access is granted', async () => {
  const { values } = installBrowser({ archiveAccess: false });
  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: false, encountersEnabled: true, endpoint: archiveEndpoint },
  }, extensionSender);
  const encounter = {
    type: 'record-repository-encounter' as const,
    encounterId: 'same-page',
    owner: 'archive',
    repo: 'dedupe',
    source: 'link' as const,
    pageUrl: 'https://example.com/list',
    pageTitle: 'List',
    linkText: 'archive/dedupe',
  };

  await handleMessage(encounter, { url: encounter.pageUrl });
  await handleMessage(encounter, { url: encounter.pageUrl });

  assert.equal((values.get('githubLensEncounterQueueV1') as unknown[]).length, 1);
});

test('turning encounter history off removes its unsent private queue', async () => {
  const { values } = installBrowser({ archiveAccess: false });
  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: false, encountersEnabled: true, endpoint: archiveEndpoint },
  }, extensionSender);
  await handleMessage({
    type: 'record-repository-encounter',
    encounterId: 'private-page',
    owner: 'archive',
    repo: 'privacy',
    source: 'link',
    pageUrl: 'https://example.com/private?token=secret',
    pageTitle: 'Private page',
    linkText: 'archive/privacy',
  }, { url: 'https://example.com/private?token=secret' });
  assert.equal((values.get('githubLensEncounterQueueV1') as unknown[]).length, 1);

  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: false, encountersEnabled: false, endpoint: archiveEndpoint },
  }, extensionSender);

  assert.deepEqual(values.get('githubLensEncounterQueueV1'), []);
});

test('keeps a failed archive write queued without failing the repository preview', async () => {
  const { values, alarms } = installBrowser();
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      if (url.startsWith(archiveEndpoint)) throw new Error('Archive offline');
      return new Response(JSON.stringify(repositoryPayload('archive/offline')), { status: 200 });
    },
  });

  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: false, endpoint: archiveEndpoint },
  }, extensionSender);
  const preview = await handleMessage(
    { type: 'repository-summary', owner: 'archive', repo: 'offline' },
    {},
  );
  assert.equal(preview.ok, true);
  const flushed = await handleMessage({ type: 'flush-archive' }, extensionSender);
  assert.equal(flushed.ok, true);

  const queue = values.get('githubLensArchiveQueueV1') as unknown[];
  assert.equal(queue.length, 1);
  assert.ok(alarms.some((delay) => delay >= 15));
  const state = await handleMessage({ type: 'get-archive-settings' }, extensionSender);
  assert.equal(state.ok, true);
  if (state.ok) {
    assert.equal((state.data as { queued: number }).queued, 1);
    assert.match((state.data as { lastError: string }).lastError, /reach archive/i);
  }
});

test('tests PocketBase health without exposing repository data', async () => {
  installBrowser();
  const urls: string[] = [];
  Object.assign(globalThis, {
    fetch: async (url: string): Promise<Response> => {
      urls.push(url);
      return new Response(JSON.stringify({ code: 200, message: 'API is healthy.', data: {} }), {
        status: 200,
      });
    },
  });

  await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: false, endpoint: archiveEndpoint },
  }, extensionSender);
  const tested = await handleMessage({ type: 'test-archive' }, extensionSender);
  assert.equal(tested.ok, true);
  assert.deepEqual(urls, [`${archiveEndpoint}/api/health`]);
});
