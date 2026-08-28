import assert from 'node:assert/strict';
import test from 'node:test';

import {
  archivePermissionPattern,
  buildRepositoryObservation,
  DEFAULT_ARCHIVE_SETTINGS,
  isAcceptedArchiveResponse,
  normalizeArchiveSettings,
} from '../lib/archive.ts';

test('keeps both archive streams disabled without a personal endpoint', () => {
  assert.deepEqual(DEFAULT_ARCHIVE_SETTINGS, {
    snapshotsEnabled: false,
    encountersEnabled: false,
    endpoint: '',
  });
});

test('builds a narrow optional host permission for the configured archive origin', () => {
  assert.equal(
    archivePermissionPattern('https://archive.example.com:8443'),
    'https://archive.example.com/*',
  );
  assert.equal(archivePermissionPattern('http://localhost:8090'), 'http://localhost/*');
  assert.equal(archivePermissionPattern('file:///tmp/archive'), null);
});

test('normalizes archive settings to an origin and rejects unsafe endpoints', () => {
  assert.deepEqual(normalizeArchiveSettings({
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: ' https://archive.example.test:8443/ ',
  }), {
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'https://archive.example.test:8443',
  });
  assert.deepEqual(normalizeArchiveSettings({
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'ftp://archive.example.test',
  }), { snapshotsEnabled: false, encountersEnabled: false, endpoint: '' });
  assert.deepEqual(normalizeArchiveSettings({
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'https://user:secret@archive.example.test',
  }), { snapshotsEnabled: false, encountersEnabled: false, endpoint: '' });
  assert.deepEqual(normalizeArchiveSettings({
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'https://archive.example.test/a/path',
  }), { snapshotsEnabled: false, encountersEnabled: false, endpoint: '' });
  assert.deepEqual(normalizeArchiveSettings({
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'http://archive.example.test',
  }), { snapshotsEnabled: false, encountersEnabled: false, endpoint: '' });
  assert.deepEqual(normalizeArchiveSettings({
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'http://localhost:8090',
  }), {
    snapshotsEnabled: true,
    encountersEnabled: true,
    endpoint: 'http://localhost:8090',
  });
});

test('migrates the old combined archive switch without silently enabling history', () => {
  assert.deepEqual(normalizeArchiveSettings({
    enabled: true,
    endpoint: 'https://archive.example.test',
  }), {
    snapshotsEnabled: true,
    encountersEnabled: false,
    endpoint: 'https://archive.example.test',
  });
});

test('builds a stable flattened observation without inventing missing issue data', () => {
  const observation = buildRepositoryObservation({
    stage: 'detail',
    fullName: 'Octo/Example',
    url: 'https://github.com/Octo/Example',
    description: null,
    stars: 123,
    forks: 12,
    watchers: 7,
    openIssues: 0,
    closedIssues: null,
    latestOpenIssueAt: null,
    latestClosedIssueAt: null,
    contributors: null,
    language: 'TypeScript',
    license: 'MIT',
    topics: ['browser-extension'],
    archived: false,
    disabled: false,
    fork: false,
    template: false,
    visibility: 'public',
    defaultBranch: 'main',
    createdAt: '2020-01-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    pushedAt: '2026-08-26T10:00:00Z',
    fetchedAt: '2026-08-28T12:00:00Z',
    warnings: ['Closed issue data unavailable.'],
  });

  assert.equal(observation.observation_id, 'octo/example|2026-08-28T12:00:00Z|detail');
  assert.equal(observation.repository_key, 'octo/example');
  assert.equal(observation.activity, 'active');
  assert.equal(observation.open_issues, 0);
  assert.equal('closed_issues' in observation, false);
  assert.equal(observation.has_issue_data, false);
  assert.equal(observation.has_contributor_data, false);
  assert.equal('latest_open_issue_at' in observation, false);
  assert.deepEqual(observation.topics, ['browser-extension']);
});

test('accepts PocketBase creates and deterministic duplicate validation responses', async () => {
  assert.equal(await isAcceptedArchiveResponse(new Response('{}', { status: 200 })), true);
  assert.equal(await isAcceptedArchiveResponse(new Response(JSON.stringify({
    data: { observation_id: { code: 'validation_not_unique' } },
  }), { status: 400 })), true);
  assert.equal(await isAcceptedArchiveResponse(new Response(JSON.stringify({
    data: { full_name: { code: 'validation_required' } },
  }), { status: 400 })), false);
  assert.equal(await isAcceptedArchiveResponse(new Response(JSON.stringify({
    data: { encounter_id: { code: 'validation_not_unique' } },
  }), { status: 400 }), 'encounter_id'), true);
  assert.equal(await isAcceptedArchiveResponse(new Response('{}', { status: 503 })), false);
});
