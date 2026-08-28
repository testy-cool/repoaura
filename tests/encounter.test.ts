import assert from 'node:assert/strict';
import test from 'node:test';

const encounterModulePath = '../lib/encounter.ts';

test('builds a private encounter event while preserving useful page identity', async () => {
  const encounter = await import(encounterModulePath).catch(() => null);
  assert.ok(encounter, 'encounter module must exist');

  assert.deepEqual(encounter.buildRepositoryEncounter({
    encounterId: 'encounter-1',
    owner: 'WXT-Dev',
    repo: 'WXT',
    source: 'link',
    pageUrl: 'https://www.google.com/search?q=wxt#result-2',
    pageTitle: '  WXT search results  ',
    linkText: '  WXT · GitHub  ',
    seenAt: '2026-08-28T12:00:00.000Z',
  }), {
    encounter_id: 'encounter-1',
    repository_key: 'wxt-dev/wxt',
    full_name: 'WXT-Dev/WXT',
    repository_url: 'https://github.com/WXT-Dev/WXT',
    source: 'link',
    page_url: 'https://www.google.com/search',
    page_host: 'www.google.com',
    page_title: 'WXT search results',
    link_text: 'WXT · GitHub',
    seen_at: '2026-08-28T12:00:00.000Z',
  });
});

test('rejects unsafe or malformed encounter inputs', async () => {
  const encounter = await import(encounterModulePath).catch(() => null);
  assert.ok(encounter, 'encounter module must exist');

  assert.equal(encounter.buildRepositoryEncounter({
    encounterId: '',
    owner: 'wxt-dev',
    repo: 'wxt',
    source: 'direct',
    pageUrl: 'https://github.com/wxt-dev/wxt',
    pageTitle: 'WXT',
    linkText: '',
    seenAt: '2026-08-28T12:00:00.000Z',
  }), null);
  assert.equal(encounter.buildRepositoryEncounter({
    encounterId: 'encounter-2',
    owner: 'wxt-dev',
    repo: 'wxt',
    source: 'direct',
    pageUrl: 'chrome://extensions',
    pageTitle: 'Extensions',
    linkText: '',
    seenAt: '2026-08-28T12:00:00.000Z',
  }), null);
  assert.equal(encounter.normalizeEncounterPageUrl(
    'https://user:secret@example.com/private',
  ), null);
  assert.equal(
    encounter.normalizeEncounterPageUrl('https://example.com/private?token=secret#section'),
    'https://example.com/private',
  );
});

test('creates retry-safe encounter identifiers without requiring page metadata', async () => {
  const encounter = await import(encounterModulePath).catch(() => null);
  assert.ok(encounter, 'encounter module must exist');

  const first = encounter.createEncounterId();
  const second = encounter.createEncounterId();
  assert.match(first, /^[a-z\d._:-]{1,100}$/i);
  assert.notEqual(first, second);
});
