import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

async function readBuild(directory) {
  const root = new URL(`../.build/${directory}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const scripts = [];
  async function collect(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), folder);
      if (entry.isDirectory()) await collect(url);
      else if (entry.name.endsWith('.js')) scripts.push(await readFile(url, 'utf8'));
    }
  }
  await collect(root);
  return { manifest, scripts: scripts.join('\n') };
}

test('public package contains previews but no archive controls, delivery, or encounter collection', async () => {
  const { manifest, scripts } = await readBuild('chrome-mv3');
  assert.equal(manifest.name, 'RepoAura');
  assert.equal(manifest.permissions.includes('alarms'), false);
  assert.deepEqual(manifest.host_permissions, ['https://api.github.com/*']);
  assert.deepEqual(manifest.content_scripts, []);
  assert.match(scripts, /repository-summary/);
  assert.match(scripts, /repository-preview/);
  assert.match(scripts, /Try it on GitHub/);
  assert.match(scripts, /sindresorhus\/awesome/);
  assert.match(scripts, /Advanced: GitHub token/);
  assert.doesNotMatch(scripts, /PocketBase|archive-snapshots-enabled|archive-encounters-enabled/);
  assert.doesNotMatch(scripts, /repository_observations|repository_encounters|record-repository-encounter/);
  assert.doesNotMatch(scripts, /githubLensArchive|githubLensEncounter|\/api\/health/);
});

test('personal package retains both opt-in archive streams and retry support', async () => {
  const { manifest, scripts } = await readBuild('chrome-mv3-personal');
  assert.equal(manifest.name, 'RepoAura Personal');
  assert.equal(manifest.permissions.includes('alarms'), true);
  assert.match(scripts, /PocketBase/);
  assert.match(scripts, /archive-snapshots-enabled/);
  assert.match(scripts, /archive-encounters-enabled/);
  assert.match(scripts, /repository_observations/);
  assert.match(scripts, /repository_encounters/);
  assert.match(scripts, /record-repository-encounter/);
});
