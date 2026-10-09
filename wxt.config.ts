import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: '.build',
  vite: ({ mode }) => ({
    define: { __REPOAURA_PERSONAL__: JSON.stringify(mode === 'personal') },
  }),
  manifest: ({ mode }) => ({
    name: mode === 'personal' ? 'RepoAura Personal' : 'RepoAura',
    short_name: 'RepoAura',
    description:
      'Preview repository activity, issues, contributors, stars, and maintenance signals from any GitHub link.',
    permissions: ['storage', 'activeTab', 'scripting', ...(mode === 'personal' ? ['alarms' as const] : [])],
    host_permissions: ['https://api.github.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'RepoAura settings',
    },
  }),
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      const pageOrigins = new Set(['http://*/*', 'https://*/*']);
      manifest.host_permissions = manifest.host_permissions?.filter(
        (origin: string) => !pageOrigins.has(origin),
      );
    },
  },
});
