import { defineConfig } from 'wxt';

export default defineConfig({
  outDir: '.build',
  manifest: {
    name: 'RepoAura',
    short_name: 'RepoAura',
    description:
      'Preview repository activity, issues, contributors, stars, and maintenance signals from any GitHub link.',
    permissions: ['storage', 'activeTab', 'alarms', 'scripting'],
    host_permissions: ['https://api.github.com/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_title: 'RepoAura settings',
    },
  },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      const pageOrigins = new Set(['http://*/*', 'https://*/*']);
      manifest.host_permissions = manifest.host_permissions?.filter(
        (origin: string) => !pageOrigins.has(origin),
      );
    },
  },
});
