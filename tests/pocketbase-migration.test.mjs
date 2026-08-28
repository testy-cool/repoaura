import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const ergonomicMigrationUrl = new URL(
  '../ops/pocketbase/pb_migrations/1787917240_order_repository_observation_fields.js',
  import.meta.url,
);

const humanPriorityMigrationUrl = new URL(
  '../ops/pocketbase/pb_migrations/1787917950_prioritize_repository_observation_fields.js',
  import.meta.url,
);

const encountersMigrationUrl = new URL(
  '../ops/pocketbase/pb_migrations/1787922000_create_repository_encounters.js',
  import.meta.url,
);

const originalOrder = [
  'id',
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

const ergonomicOrder = [
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

class FakeFieldsList {
  constructor(names) {
    this.items = names.map((name) => ({ id: `${name}_id`, name }));
  }

  getByName(name) {
    const field = this.items.find((candidate) => candidate.name === name);
    assert.ok(field, `Missing fixture field ${name}`);
    return field;
  }

  removeById(id) {
    this.items = this.items.filter((field) => field.id !== id);
  }

  addAt(index, field) {
    this.items.splice(index, 0, field);
  }

  names() {
    return this.items.map((field) => field.name);
  }
}

async function loadMigration(migrationUrl) {
  let migration;
  const source = await readFile(migrationUrl, 'utf8');
  vm.runInNewContext(source, {
    migrate(up, down) {
      migration = { up, down };
    },
  });
  assert.ok(migration, 'Migration must register up and down handlers');
  return migration;
}

function createApp() {
  const collection = { fields: new FakeFieldsList(originalOrder) };
  let saves = 0;

  return {
    app: {
      findCollectionByNameOrId(name) {
        assert.equal(name, 'repository_observations');
        return collection;
      },
      save(savedCollection) {
        assert.equal(savedCollection, collection);
        saves += 1;
      },
    },
    collection,
    get saves() {
      return saves;
    },
  };
}

test('orders repository observation fields for human scanning without replacing fields', async () => {
  const migration = await loadMigration(ergonomicMigrationUrl);
  const fixture = createApp();
  const idsBefore = new Map(fixture.collection.fields.items.map((field) => [field.name, field.id]));

  migration.up(fixture.app);

  assert.deepEqual(fixture.collection.fields.names(), ergonomicOrder);
  assert.equal(fixture.saves, 1);
  assert.deepEqual(
    new Map(fixture.collection.fields.items.map((field) => [field.name, field.id])),
    idsBefore,
  );
});

test('restores the original field order on rollback', async () => {
  const migration = await loadMigration(ergonomicMigrationUrl);
  const fixture = createApp();

  migration.up(fixture.app);
  migration.down(fixture.app);

  assert.deepEqual(fixture.collection.fields.names(), originalOrder);
  assert.equal(fixture.saves, 2);
});

test('prioritizes description and repository health while moving identifiers last', async () => {
  const ergonomicMigration = await loadMigration(ergonomicMigrationUrl);
  const humanPriorityMigration = await loadMigration(humanPriorityMigrationUrl);
  const fixture = createApp();
  const idsBefore = new Map(fixture.collection.fields.items.map((field) => [field.name, field.id]));

  ergonomicMigration.up(fixture.app);
  humanPriorityMigration.up(fixture.app);

  assert.deepEqual(fixture.collection.fields.names(), humanPriorityOrder);
  assert.deepEqual(
    new Map(fixture.collection.fields.items.map((field) => [field.name, field.id])),
    idsBefore,
  );
});

test('restores the preceding ergonomic order on rollback', async () => {
  const ergonomicMigration = await loadMigration(ergonomicMigrationUrl);
  const humanPriorityMigration = await loadMigration(humanPriorityMigrationUrl);
  const fixture = createApp();

  ergonomicMigration.up(fixture.app);
  humanPriorityMigration.up(fixture.app);
  humanPriorityMigration.down(fixture.app);

  assert.deepEqual(fixture.collection.fields.names(), ergonomicOrder);
});

test('creates private encounter events plus repository and page aggregate views', async () => {
  const source = await readFile(encountersMigrationUrl, 'utf8').catch(() => null);
  assert.ok(source, 'encounter migration must exist');

  const saved = [];
  const deleted = [];
  let migration;
  class FakeCollection {
    constructor(options) {
      Object.assign(this, options);
    }
  }
  vm.runInNewContext(source, {
    Collection: FakeCollection,
    migrate(up, down) {
      migration = { up, down };
    },
  });
  assert.ok(migration);
  const byName = new Map();
  const app = {
    save(collection) {
      saved.push(collection);
      byName.set(collection.name, collection);
    },
    findCollectionByNameOrId(name) {
      return byName.get(name) ?? { name };
    },
    delete(collection) {
      deleted.push(collection.name);
    },
  };

  migration.up(app);

  assert.deepEqual(saved.map((collection) => collection.name), [
    'repository_encounters',
    'repository_encounter_totals',
    'repository_encounter_pages',
  ]);
  const events = saved[0];
  assert.equal(events.type, 'base');
  assert.equal(events.createRule, '');
  assert.equal(events.listRule, null);
  assert.match(events.indexes.join('\n'), /UNIQUE INDEX.*encounter_id/i);
  assert.match(saved[1].viewQuery, /COUNT\(\*\).*encounter_count/is);
  assert.match(saved[1].viewQuery, /GROUP BY repository_key/i);
  assert.match(saved[2].viewQuery, /GROUP BY repository_key, page_url/i);

  migration.down(app);
  assert.deepEqual(deleted, [
    'repository_encounter_pages',
    'repository_encounter_totals',
    'repository_encounters',
  ]);
});
