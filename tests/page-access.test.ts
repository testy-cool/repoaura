import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_PAGE_ORIGINS,
  contentScriptMatches,
  normalizePageAccessMode,
  sitePermissionPatterns,
} from '../lib/page-access.ts';

test('leaves new installs unconfigured while preserving legacy all-site behavior', () => {
  assert.equal(normalizePageAccessMode(undefined, false), 'unconfigured');
  assert.equal(normalizePageAccessMode(undefined, true), 'all-sites');
  assert.equal(normalizePageAccessMode('selected-sites', false), 'selected-sites');
  assert.equal(normalizePageAccessMode('invalid', false), 'unconfigured');
});

test('builds narrow optional permissions for a selected hostname', () => {
  assert.deepEqual(sitePermissionPatterns(' News.Example.com '), [
    'http://news.example.com/*',
    'https://news.example.com/*',
  ]);
  assert.deepEqual(sitePermissionPatterns('not a host name'), []);
});

test('registers only page matches that Chrome has actually granted', () => {
  assert.deepEqual(contentScriptMatches('unconfigured', [], ALL_PAGE_ORIGINS), []);
  assert.deepEqual(contentScriptMatches('all-sites', [], ALL_PAGE_ORIGINS), ALL_PAGE_ORIGINS);
  assert.deepEqual(contentScriptMatches('all-sites', [], ['https://*/*']), []);
  assert.deepEqual(contentScriptMatches('selected-sites', ['example.com', 'missing.test'], [
    'http://example.com/*',
    'https://example.com/*',
  ]), [
    'http://example.com/*',
    'https://example.com/*',
  ]);
});
