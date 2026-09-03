import assert from 'node:assert/strict';
import test from 'node:test';

test('allows textual repository links and subpages on non-GitHub pages', async () => {
  const policy = await import('../lib/page-policy.ts');

  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://example.com/article',
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: false,
  }), true);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://www.google.com/search?q=wxt',
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: false,
  }), true);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://example.com/article',
    repositoryHref: 'https://github.com/wxt-dev/wxt/blob/main/package.json',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: false,
  }), true);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://www.google.com/search?q=wxt',
    repositoryHref: 'https://github.com/wxt-dev/wxt/issues/123',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: false,
  }), true);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://example.com/article',
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: false,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: false,
  }), false);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://www.google.com/search?q=wxt',
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: true,
    isHeadingLink: false,
    inMarkdownBody: false,
  }), false);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    pageHref: 'https://www.google.com/search?q=wxt',
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: true,
    isHeadingLink: true,
    inMarkdownBody: false,
  }), true);
});

test('rejects every link on GitHub topic pages and descendants', async () => {
  const policy = await import('../lib/page-policy.ts');
  const base = {
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: true,
  };

  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    pageHref: 'https://github.com/topics',
  }), false);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    pageHref: 'https://github.com/topics/browser-extension',
  }), false);
});

test('allows repository links on other GitHub pages only in rendered Markdown prose', async () => {
  const policy = await import('../lib/page-policy.ts');
  const base = {
    pageHref: 'https://github.com/wxt-dev/wxt',
    repositoryHref: 'https://github.com/oven-sh/bun',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
  };

  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    inMarkdownBody: true,
  }), true);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    inMarkdownBody: false,
  }), false);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    isRendered: false,
    inMarkdownBody: true,
  }), false);
});

test('rejects a repository link when its own GitHub README references itself', async () => {
  const policy = await import('../lib/page-policy.ts');
  const base = {
    repositoryHref: 'https://github.com/wxt-dev/wxt',
    hasReadableText: true,
    isRendered: true,
    hasVisualMedia: false,
    isHeadingLink: false,
    inMarkdownBody: true,
  };

  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    pageHref: 'https://github.com/wxt-dev/wxt',
  }), false);
  assert.equal(policy.isInlineSummaryAnchorEligible({
    ...base,
    pageHref: 'https://github.com/wxt-dev/wxt/blob/main/README.md',
  }), false);
});
