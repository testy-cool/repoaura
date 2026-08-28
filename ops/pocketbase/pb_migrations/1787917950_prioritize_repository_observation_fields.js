/// <reference path="../pb_data/types.d.ts" />

const humanPriorityOrder = [
  'full_name',
  'description',
  'stars',
  'open_issues',
  'latest_open_issue_at',
  'closed_issues',
  'latest_closed_issue_at',
  'forks',
  'activity',
  'pushed_at',
  'language',
  'stage',
  'fetched_at',
  'contributors',
  'watchers',
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
  'id',
];

const precedingOrder = [
  'id',
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

function orderFields(app, names) {
  const collection = app.findCollectionByNameOrId('repository_observations');

  names.forEach((name, index) => {
    const field = collection.fields.getByName(name);
    collection.fields.removeById(field.id);
    collection.fields.addAt(index, field);
  });

  app.save(collection);
}

migrate((app) => {
  orderFields(app, humanPriorityOrder);
}, (app) => {
  orderFields(app, precedingOrder);
});
