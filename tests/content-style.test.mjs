import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('inline summaries inherit the page font while detail cards keep a system font', async () => {
  const css = await readFile(new URL('../styles/content.css', import.meta.url), 'utf8');
  const hostRule = css.match(/:host\s*\{([^}]*)\}/)?.[1] ?? '';
  const popoverRule = css.match(/\.lens-popover\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(hostRule, /\bfont:\s*inherit\s*!important\s*;/);
  assert.doesNotMatch(hostRule, /font-family/);
  assert.match(popoverRule, /font-family:/);
});

test('compact summaries stay atomic instead of wrapping into narrow columns', async () => {
  const css = await readFile(new URL('../styles/content.css', import.meta.url), 'utf8');
  const inlineRule = css.match(/\.lens-inline\s*\{([^}]*)\}/)?.[1] ?? '';
  const contentRule = css.match(/\.lens-inline-state,\s*\.lens-inline-content\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(inlineRule, /white-space:\s*nowrap/);
  assert.match(contentRule, /flex-wrap:\s*nowrap/);
});

test('shadow document wrappers do not split surrounding prose into block boxes', async () => {
  const css = await readFile(new URL('../styles/content.css', import.meta.url), 'utf8');
  const wrapperRule = css.match(/html,\s*body\s*\{([^}]*)\}/)?.[1] ?? '';

  assert.match(wrapperRule, /display:\s*contents\s*!important/);
});

test('companions are inserted directly after anchors without skipping text nodes', async () => {
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(content, /append:\s*'after'/);
  assert.match(content, /append:\s*\(anchor,\s*host\)\s*=>\s*anchor\.after\(host\)/);
});

test('inline symbols retain explicit hover and accessible labels', async () => {
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  assert.match(content, /summaryActivity\.title\s*=\s*summary\.activityLabel/);
  assert.match(content, /summaryLastPush\.title\s*=\s*summary\.lastPushLabel/);
  assert.match(content, /summaryStars\.title\s*=/);
  assert.match(content, /selected\.has\('activity'\)\s*\?\s*summary\.activity\.label/);
  assert.match(content, /selected\.has\('lastPush'\)\s*\?\s*summary\.lastPushLabel/);
});

test('inline markup omits issue metrics while the detail card retains them', async () => {
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(content, /data-summary-(?:open|closed)/);
  assert.match(content, /data-open-issues/);
  assert.match(content, /data-closed-issues/);
});

test('readable anchors are not rejected merely for containing layout elements', async () => {
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(content, /anchor\.querySelector\([^)]*\bdiv\b/);
});

test('content script corrects transformed companion placement and accepts explicit refreshes', async () => {
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  assert.match(content, /correctCompanionLayout\(/);
  assert.match(content, /refresh-previews/);
});

test('content script records visible links and direct repository visits independently of caching', async () => {
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');

  assert.match(content, /recordRepositoryEncounter\(repository, 'link'/);
  assert.match(content, /recordDirectRepositoryVisit/);
  assert.match(content, /parseGitHubRepositoryPageUrl\(location\.href\)/);
  assert.match(content, /type: 'record-repository-encounter'/);
  assert.match(content, /wxt:locationchange/);
});

test('popup exposes page access, inline, refresh, and privacy-separated archive controls', async () => {
  const popup = await readFile(new URL('../entrypoints/popup/main.ts', import.meta.url), 'utf8');
  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
  const config = await readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8');

  assert.match(popup, /id="inline-stars"/);
  assert.match(popup, /id="inline-activity"/);
  assert.match(popup, /id="inline-last-push"/);
  assert.match(popup, /id="exclude-current-site"/);
  assert.match(popup, /id="page-access-mode"/);
  assert.match(popup, /id="enable-current-site"/);
  assert.match(popup, /id="refresh-page"/);
  assert.match(popup, /id="archive-snapshots-enabled"/);
  assert.match(popup, /id="archive-encounters-enabled"/);
  assert.match(popup, /id="archive-endpoint"/);
  assert.match(popup, /id="test-archive"/);
  assert.match(popup, /id="open-archive"/);
  assert.match(popup, /Cached for 24 hours/);
  assert.match(popup, />↻ Refresh now</);
  assert.match(popup, />Save changes</);
  assert.match(config, /permissions:\s*\[[^\]]*'activeTab'/s);
  assert.match(config, /permissions:\s*\[[^\]]*'alarms'/s);
  assert.match(config, /permissions:\s*\[[^\]]*'scripting'/s);
  assert.match(config, /optional_host_permissions:\s*\[[^\]]*'http:\/\/\*\/\*'/s);
  assert.match(config, /optional_host_permissions:\s*\[[^\]]*'https:\/\/\*\/\*'/s);
  assert.match(config, /build:manifestGenerated/);
  assert.match(content, /registration:\s*'runtime'/);
  assert.match(popup, /browser\.permissions\.request/);
  assert.doesNotMatch(popup, /browser\.permissions\.contains/);
  assert.match(popup, /Waiting for Chrome’s access prompt/);
  assert.match(popup, /ARCHIVE_PERMISSION_TIMEOUT_MS/);
  assert.match(popup, /Needs access/);
  assert.match(popup, /full page URL and title/i);

  const saveArchiveStart = popup.indexOf('async function saveArchiveSettings');
  const persistIntent = popup.indexOf("type: 'save-archive-settings'", saveArchiveStart);
  const requestAccess = popup.indexOf('ensureArchivePermission(endpoint)', saveArchiveStart);
  assert.ok(persistIntent > saveArchiveStart);
  assert.ok(requestAccess > persistIntent, 'archive intent must persist before Chrome opens its prompt');
});
