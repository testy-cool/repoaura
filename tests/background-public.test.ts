import assert from 'node:assert/strict';
import test from 'node:test';

let startBackground: () => void;
Object.assign(globalThis, {
  defineBackground(callback: () => void): void { startBackground = callback; },
});

const { backgroundTestState, handleMessage } = await import('../entrypoints/background.ts');

test('public build ignores legacy personal settings and queues, including on startup', async () => {
  backgroundTestState.reset();
  const archiveKeys = ['githubLensArchiveSettingsV1', 'githubLensArchiveQueueV1', 'githubLensEncounterQueueV1'];
  const values = new Map<string, unknown>([
    [archiveKeys[0]!, { snapshotsEnabled: true, encountersEnabled: true, endpoint: 'https://archive.example.test' }],
    [archiveKeys[1]!, [{ observation_id: 'preserved-snapshot' }]],
    [archiveKeys[2]!, [{ encounter_id: 'preserved-encounter' }]],
  ]);
  const before = structuredClone(values);
  const reads: string[] = [];
  const noopEvent = { addListener(): void {} };
  Object.assign(globalThis, {
    browser: {
      storage: { local: {
        async get(key: string): Promise<Record<string, unknown>> {
          reads.push(key);
          return { [key]: structuredClone(values.get(key)) };
        },
        async set(data: Record<string, unknown>): Promise<void> {
          for (const [key, value] of Object.entries(data)) values.set(key, structuredClone(value));
        },
        async remove(keys: string | string[]): Promise<void> {
          for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
        },
      } },
      permissions: { onAdded: noopEvent, onRemoved: noopEvent },
      runtime: { onInstalled: noopEvent, onMessage: noopEvent, getURL: () => 'chrome-extension://public/' },
      // No alarms API: the public manifest does not request it.
    },
    fetch(): never { throw new Error('Public archive requests must not reach the network.'); },
  });
  startBackground!();
  const sender = { url: 'chrome-extension://public/popup.html' };
  for (const type of ['get-archive-settings', 'test-archive', 'flush-archive'] as const) {
    assert.deepEqual(await handleMessage({ type }, sender), {
      ok: false, error: { code: 'unknown', message: 'Unsupported request.' },
    });
  }
  const saved = await handleMessage({
    type: 'save-archive-settings',
    settings: { snapshotsEnabled: true, encountersEnabled: true, endpoint: 'https://archive.example.test' },
  }, sender);
  assert.equal(saved.ok, false);
  const encounter = await handleMessage({
    type: 'record-repository-encounter', owner: 'wxt-dev', repo: 'wxt',
    encounterId: 'public-encounter', source: 'link', pageUrl: 'https://example.com/',
    pageTitle: 'Example', linkText: 'WXT',
  }, { url: 'https://example.com/' });
  assert.equal(encounter.ok, false);
  for (const key of archiveKeys) {
    assert.deepEqual(values.get(key), before.get(key));
    assert.equal(reads.includes(key), false);
  }
});
