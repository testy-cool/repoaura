import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

const installerUrl = new URL('../scripts/install-local.mjs', import.meta.url);
const fixtureRoots = [];

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((fixtureRoot) =>
      rm(fixtureRoot, { recursive: true, force: true }),
    ),
  );
});

async function loadInstaller() {
  return import(installerUrl.href);
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'github-lens-installer-'));
  fixtureRoots.push(repoRoot);
  const sourceDir = path.join(repoRoot, '.build', 'chrome-mv3');
  const destinationDir = path.join(repoRoot, '.output', 'chrome-mv3');
  const stagingDir = path.join(repoRoot, '.output', 'chrome-mv3.next');
  const backupDir = path.join(repoRoot, '.output', 'chrome-mv3.previous');

  await mkdir(sourceDir, { recursive: true });
  await mkdir(destinationDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      background: { service_worker: 'background.js' },
      action: { default_popup: 'popup.html' },
      content_scripts: [{ js: ['content-scripts/content.js'] }],
      web_accessible_resources: [
        { resources: ['content-scripts/content.css'], matches: ['https://*/*'] },
      ],
    }),
  );
  await mkdir(path.join(sourceDir, 'content-scripts'), { recursive: true });
  await writeFile(path.join(sourceDir, 'background.js'), 'new background');
  await writeFile(path.join(sourceDir, 'popup.html'), '<main>new popup</main>');
  await writeFile(path.join(sourceDir, 'content-scripts', 'content.js'), 'new content');
  await writeFile(path.join(sourceDir, 'content-scripts', 'content.css'), 'new styles');
  await writeFile(path.join(destinationDir, 'installed.txt'), 'previous install');

  return { repoRoot, sourceDir, destinationDir, stagingDir, backupDir };
}

function options(fixture, extensionDisabled = true) {
  return { ...fixture, extensionDisabled };
}

test('rejects a missing disabled-extension acknowledgement without changing the destination', async () => {
  const fixture = await createFixture();
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(
    installLocalExtension(options(fixture, false)),
    /--extension-disabled/,
  );

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
  await assert.rejects(readFile(path.join(fixture.backupDir, 'installed.txt')), /ENOENT/);
});

test('leaves the destination unchanged when the source is missing', async () => {
  const fixture = await createFixture();
  await rm(fixture.sourceDir, { recursive: true });
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /source/i);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('leaves the destination unchanged when a manifest reference is missing', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      background: { service_worker: 'missing-background.js' },
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /missing-background\.js/);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('leaves the destination unchanged when a DNR rules file is missing', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      declarative_net_request: {
        rule_resources: [{ id: 'default', enabled: true, path: 'rules/default.json' }],
      },
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /rules\/default\.json/);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('leaves the destination unchanged when the managed storage schema is missing', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      storage: { managed_schema: 'schema/managed.json' },
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /schema\/managed\.json/);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('accepts a web-accessible resource wildcard with an in-tree match', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      web_accessible_resources: [
        { resources: ['/content-scripts/*.css'], matches: ['https://*/*'] },
      ],
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await installLocalExtension(options(fixture));

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'content-scripts', 'content.css'), 'utf8'),
    'new styles',
  );
});

test('rejects an unmatched web-accessible resource wildcard without changing the destination', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      web_accessible_resources: [
        { resources: ['content-scripts/*.png'], matches: ['https://*/*'] },
      ],
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /matched no regular files/i);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('rejects an escaping web-accessible resource wildcard without changing the destination', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.repoRoot, 'outside.js'), 'outside extension');
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      web_accessible_resources: [
        { resources: ['../*.js'], matches: ['https://*/*'] },
      ],
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /escapes/i);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('rejects an invalid web-accessible resource wildcard without changing the destination', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'GitHub Lens',
      version: '0.1.0',
      web_accessible_resources: [
        { resources: ['content-scripts\\*.css'], matches: ['https://*/*'] },
      ],
    }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /invalid/i);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('leaves the destination unchanged when the source is not Manifest V3', async () => {
  const fixture = await createFixture();
  await writeFile(
    path.join(fixture.sourceDir, 'manifest.json'),
    JSON.stringify({ manifest_version: 2, name: 'GitHub Lens', version: '0.1.0' }),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /Manifest V3/);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('rejects a symlinked source without changing the destination', async () => {
  const fixture = await createFixture();
  const actualSource = path.join(fixture.repoRoot, 'source-outside-owned-path');
  await rename(fixture.sourceDir, actualSource);
  await symlink(actualSource, fixture.sourceDir, 'dir');
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /symbolic link/i);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('rejects symlinks inside the source tree without changing the destination', async () => {
  const fixture = await createFixture();
  await symlink(
    path.join(fixture.repoRoot, 'outside-extension.js'),
    path.join(fixture.sourceDir, 'unreferenced-link.js'),
  );
  const { installLocalExtension } = await loadInstaller();

  await assert.rejects(installLocalExtension(options(fixture)), /symbolic link/i);

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('replaces the destination and preserves its previous tree at the owned backup path', async () => {
  const fixture = await createFixture();
  await mkdir(fixture.backupDir, { recursive: true });
  await writeFile(path.join(fixture.backupDir, 'obsolete.txt'), 'obsolete backup');
  const { installLocalExtension } = await loadInstaller();

  await installLocalExtension(options(fixture));

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'background.js'), 'utf8'),
    'new background',
  );
  assert.equal(
    await readFile(path.join(fixture.backupDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
  await assert.rejects(readFile(path.join(fixture.backupDir, 'obsolete.txt')), /ENOENT/);
  await assert.rejects(readFile(path.join(fixture.stagingDir, 'manifest.json')), /ENOENT/);
});

test('restores the previous install when final promotion rename fails', async () => {
  const fixture = await createFixture();
  const { installLocalExtension } = await loadInstaller();
  let renameCount = 0;
  const fileOperations = {
    async rename(from, to) {
      renameCount += 1;
      if (renameCount === 2) throw new Error('simulated final rename failure');
      await rename(from, to);
    },
  };

  await assert.rejects(
    installLocalExtension(options(fixture), fileOperations),
    /previous install was restored/i,
  );

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
  await assert.rejects(readFile(path.join(fixture.backupDir, 'installed.txt')), /ENOENT/);
});

test('preserves an unexpected destination collision and reports the exact recovery backup', async () => {
  const fixture = await createFixture();
  const { installLocalExtension } = await loadInstaller();
  let renameCount = 0;
  const fileOperations = {
    async rename(from, to) {
      renameCount += 1;
      if (renameCount === 2) {
        await mkdir(fixture.destinationDir, { recursive: true });
        await writeFile(path.join(fixture.destinationDir, 'collision.txt'), 'unexpected owner');
        throw new Error('simulated destination collision');
      }
      await rename(from, to);
    },
  };

  await assert.rejects(
    installLocalExtension(options(fixture), fileOperations),
    (error) => {
      assert.match(error.message, /recovery failed/i);
      assert.ok(error.message.includes(fixture.backupDir));
      return true;
    },
  );

  assert.equal(
    await readFile(path.join(fixture.destinationDir, 'collision.txt'), 'utf8'),
    'unexpected owner',
  );
  assert.equal(
    await readFile(path.join(fixture.backupDir, 'installed.txt'), 'utf8'),
    'previous install',
  );
});

test('rejects unexpected CLI arguments before considering an installation', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(installerUrl), '--extension-disabled', '--force'],
    { encoding: 'utf8' },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected argument: --force/);
});
