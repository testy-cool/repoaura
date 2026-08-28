/// <reference path="../pb_data/types.d.ts" />

const ergonomicOrder = [
  'full_name',
  'activity',
  'pushed_at',
  'stars',
  'language',
  'stage',
  'fetched_at',
  'open_issues',
  'latest_open_issue_at',
  'closed_issues',
  'latest_closed_issue_at',
  'forks',
  'contributors',
  'watchers',
  'description',
  'topics',
  'license',
  'archived',
  'fork',
  'template',
  'visibility',
  'repository_created_at',
  'repository_updated_at',
  'default_branch',
  'has_issue_data',
  'has_contributor_data',
  'disabled',
  'warnings',
  'url',
  'repository_key',
  'observation_id',
];

const originalOrder = [
  'observation_id',
  'repository_key',
  'full_name',
  'url',
  'stage',
  'activity',
  'description',
  'stars',
  'forks',
  'watchers',
  'open_issues',
  'closed_issues',
  'contributors',
  'has_issue_data',
  'has_contributor_data',
  'latest_open_issue_at',
  'latest_closed_issue_at',
  'language',
  'license',
  'topics',
  'visibility',
  'default_branch',
  'archived',
  'disabled',
  'fork',
  'template',
  'repository_created_at',
  'repository_updated_at',
  'pushed_at',
  'fetched_at',
  'warnings',
];

function orderFields(app, names) {
  const collection = app.findCollectionByNameOrId('repository_observations');

  names.forEach((name, index) => {
    const field = collection.fields.getByName(name);
    collection.fields.removeById(field.id);
    collection.fields.addAt(index + 1, field);
  });

  app.save(collection);
}

migrate((app) => {
  orderFields(app, ergonomicOrder);
}, (app) => {
  orderFields(app, originalOrder);
});
