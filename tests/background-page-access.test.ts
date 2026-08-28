import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(globalThis, { defineBackground: () => undefined });

const registrations: Array<{ id: string; matches?: string[] }> = [];
let grantedOrigins: string[] = [];

Object.assign(globalThis, {
  browser: {
    permissions: {
      getAll: async () => ({ origins: grantedOrigins }),
    },
    scripting: {
      getRegisteredContentScripts: async () => [...registrations],
      registerContentScripts: async (items: Array<{ id: string; matches?: string[] }>) => {
        registrations.push(...items);
      },
      updateContentScripts: async (items: Array<{ id: string; matches?: string[] }>) => {
        for (const item of items) {
          const index = registrations.findIndex((entry) => entry.id === item.id);
          registrations[index] = item;
        }
      },
      unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
        for (let index = registrations.length - 1; index >= 0; index -= 1) {
          if (ids.includes(registrations[index]!.id)) registrations.splice(index, 1);
        }
      },
    },
  },
});

const { synchronizePageAccess } = await import('../entrypoints/background.ts');

function settings(pageAccessMode: 'unconfigured' | 'all-sites' | 'selected-sites') {
  return {
    enabled: true,
    token: '',
    pageAccessMode,
    includedSites: ['example.com'],
    excludedSites: [],
    inlineFields: ['stars', 'activity', 'lastPush'] as const,
  };
}

test('registers the runtime script only for origins Chrome granted', async () => {
  grantedOrigins = ['http://example.com/*', 'https://example.com/*'];
  await synchronizePageAccess(settings('selected-sites'));
  assert.deepEqual(registrations.map((item) => item.matches), [[
    'http://example.com/*',
    'https://example.com/*',
  ]]);

  grantedOrigins = ['https://*/*'];
  await synchronizePageAccess(settings('all-sites'));
  assert.deepEqual(registrations, []);
});
