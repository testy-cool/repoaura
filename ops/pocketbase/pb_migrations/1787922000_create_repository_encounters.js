/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const encounters = new Collection({
    type: 'base',
    name: 'repository_encounters',
    listRule: null,
    viewRule: null,
    createRule: '',
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'full_name', type: 'text', required: true, max: 250 },
      { name: 'page_title', type: 'text', max: 500 },
      { name: 'page_url', type: 'url', required: true },
      { name: 'source', type: 'select', required: true, maxSelect: 1, values: ['link', 'direct'] },
      { name: 'seen_at', type: 'date', required: true },
      { name: 'link_text', type: 'text', max: 500 },
      { name: 'page_host', type: 'text', required: true, max: 255 },
      { name: 'repository_url', type: 'url', required: true },
      { name: 'repository_key', type: 'text', required: true, max: 250 },
      { name: 'encounter_id', type: 'text', required: true, max: 100 },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_repository_encounters_id ON repository_encounters (encounter_id)',
      'CREATE INDEX idx_repository_encounters_repo_time ON repository_encounters (repository_key, seen_at DESC)',
      'CREATE INDEX idx_repository_encounters_page_time ON repository_encounters (page_host, seen_at DESC)',
    ],
  });
  app.save(encounters);

  const totals = new Collection({
    type: 'view',
    name: 'repository_encounter_totals',
    listRule: null,
    viewRule: null,
    viewQuery: `
      SELECT
        MIN(id) AS id,
        repository_key,
        MAX(full_name) AS full_name,
        MAX(repository_url) AS repository_url,
        COUNT(*) AS encounter_count,
        COUNT(DISTINCT page_url) AS page_count,
        MIN(seen_at) AS first_seen_at,
        MAX(seen_at) AS last_seen_at
      FROM repository_encounters
      GROUP BY repository_key
    `,
  });
  app.save(totals);

  const pages = new Collection({
    type: 'view',
    name: 'repository_encounter_pages',
    listRule: null,
    viewRule: null,
    viewQuery: `
      SELECT
        MIN(id) AS id,
        repository_key,
        MAX(full_name) AS full_name,
        MAX(repository_url) AS repository_url,
        page_url,
        MAX(page_title) AS page_title,
        MAX(page_host) AS page_host,
        COUNT(*) AS encounter_count,
        MIN(seen_at) AS first_seen_at,
        MAX(seen_at) AS last_seen_at,
        MAX(source) AS source
      FROM repository_encounters
      GROUP BY repository_key, page_url
    `,
  });
  app.save(pages);
}, (app) => {
  app.delete(app.findCollectionByNameOrId('repository_encounter_pages'));
  app.delete(app.findCollectionByNameOrId('repository_encounter_totals'));
  app.delete(app.findCollectionByNameOrId('repository_encounters'));
});
