/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = new Collection({
    type: 'base',
    name: 'repository_observations',
    listRule: null,
    viewRule: null,
    createRule: '',
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'observation_id', type: 'text', required: true, max: 500 },
      { name: 'repository_key', type: 'text', required: true, max: 250 },
      { name: 'full_name', type: 'text', required: true, max: 250 },
      { name: 'url', type: 'url', required: true },
      { name: 'stage', type: 'select', required: true, maxSelect: 1, values: ['summary', 'detail'] },
      { name: 'activity', type: 'select', required: true, maxSelect: 1, values: ['active', 'quiet', 'dormant', 'archived', 'unavailable'] },
      { name: 'description', type: 'text', max: 5000 },
      { name: 'stars', type: 'number', required: true, min: 0, onlyInt: true },
      { name: 'forks', type: 'number', min: 0, onlyInt: true },
      { name: 'watchers', type: 'number', min: 0, onlyInt: true },
      { name: 'open_issues', type: 'number', min: 0, onlyInt: true },
      { name: 'closed_issues', type: 'number', min: 0, onlyInt: true },
      { name: 'contributors', type: 'number', min: 0, onlyInt: true },
      { name: 'has_issue_data', type: 'bool' },
      { name: 'has_contributor_data', type: 'bool' },
      { name: 'latest_open_issue_at', type: 'date' },
      { name: 'latest_closed_issue_at', type: 'date' },
      { name: 'language', type: 'text', max: 100 },
      { name: 'license', type: 'text', max: 100 },
      { name: 'topics', type: 'json', maxSize: 20000 },
      { name: 'visibility', type: 'text', max: 50 },
      { name: 'default_branch', type: 'text', max: 250 },
      { name: 'archived', type: 'bool' },
      { name: 'disabled', type: 'bool' },
      { name: 'fork', type: 'bool' },
      { name: 'template', type: 'bool' },
      { name: 'repository_created_at', type: 'date' },
      { name: 'repository_updated_at', type: 'date' },
      { name: 'pushed_at', type: 'date', required: true },
      { name: 'fetched_at', type: 'date', required: true },
      { name: 'warnings', type: 'json', maxSize: 20000 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_repository_observations_id ON repository_observations (observation_id)',
      'CREATE INDEX idx_repository_observations_repo_time ON repository_observations (repository_key, fetched_at DESC)',
    ],
  });

  app.save(collection);

  const settings = app.settings();
  settings.meta.appName = 'RepoAura Archive';
  settings.backups.cron = '0 4 * * *';
  settings.backups.cronMaxKeep = 14;
  app.save(settings);
}, (app) => {
  const collection = app.findCollectionByNameOrId('repository_observations');
  app.delete(collection);
});
