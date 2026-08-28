import assert from 'node:assert/strict';
import test from 'node:test';

test('normalizes hostname and URL entries while dropping invalid values', async () => {
  const policy = await import('../lib/site-policy.ts');

  assert.deepEqual(policy.normalizeSiteList([
    ' Google.COM ',
    'https://news.ycombinator.com/item?id=1',
    '*.Example.com.',
    'not a host name',
    'google.com',
  ]), ['google.com', 'news.ycombinator.com', 'example.com']);
});

test('allows every HTTP site when the include list is empty', async () => {
  const policy = await import('../lib/site-policy.ts');

  assert.equal(policy.isSiteAllowed('https://www.google.com/search?q=wxt', [], []), true);
  assert.equal(policy.isSiteAllowed('https://example.com/article', [], []), true);
  assert.equal(policy.isSiteAllowed('chrome://extensions', [], []), false);
});

test('include entries cover the hostname and its subdomains', async () => {
  const policy = await import('../lib/site-policy.ts');

  assert.equal(policy.isSiteAllowed('https://google.com/search', ['google.com'], []), true);
  assert.equal(policy.isSiteAllowed('https://www.google.com/search', ['google.com'], []), true);
  assert.equal(policy.isSiteAllowed('https://example.com/article', ['google.com'], []), false);
});

test('exclude entries override include entries', async () => {
  const policy = await import('../lib/site-policy.ts');

  assert.equal(policy.isSiteAllowed(
    'https://news.google.com/article',
    ['google.com'],
    ['news.google.com'],
  ), false);
  assert.equal(policy.isSiteAllowed(
    'https://mail.news.google.com/inbox',
    ['google.com'],
    ['news.google.com'],
  ), false);
});
