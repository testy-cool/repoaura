import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isGoogleSearchResultsPage,
  selectPreferredRepositoryAnchors,
} from '../lib/anchor-selection.ts';

interface TestAnchor {
  id: string;
}

test('recognizes Google search result pages without matching unrelated Google properties', () => {
  assert.equal(isGoogleSearchResultsPage('https://www.google.com/search?q=herdr'), true);
  assert.equal(isGoogleSearchResultsPage('https://google.co.uk/search?q=herdr'), true);
  assert.equal(isGoogleSearchResultsPage('https://docs.google.com/search?q=herdr'), false);
  assert.equal(isGoogleSearchResultsPage('https://www.google.com/'), false);
  assert.equal(isGoogleSearchResultsPage('not a URL'), false);
});

test('keeps one companion per repository and prefers the result heading on Google', () => {
  const readMore = { id: 'read-more' };
  const issueSitelink = { id: 'issue-sitelink' };
  const primaryResult = { id: 'primary-result' };
  const anotherRepository = { id: 'another-repository' };

  assert.deepEqual(selectPreferredRepositoryAnchors([
    {
      anchor: readMore,
      repositoryKey: 'herdrdev/herdr',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'Read more',
    },
    {
      anchor: issueSitelink,
      repositoryKey: 'herdrdev/herdr',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'Issues · herdrdev/herdr',
    },
    {
      anchor: primaryResult,
      repositoryKey: 'herdrdev/herdr',
      hasHeading: true,
      hasNativeHeading: true,
      hasVisualMedia: true,
      linkText: 'herdrdev/herdr: the runtime your coding agents live on',
    },
    {
      anchor: anotherRepository,
      repositoryKey: 'alacritty/alacritty',
      hasHeading: true,
      hasNativeHeading: true,
      hasVisualMedia: false,
      linkText: 'alacritty/alacritty: A cross-platform terminal emulator',
    },
  ], true), [primaryResult, anotherRepository]);
});

test('prefers a clean title link over a media-bearing ARIA citation', () => {
  const citation = { id: 'citation' };
  const title = { id: 'title' };
  const sitelink = { id: 'sitelink' };

  assert.deepEqual(selectPreferredRepositoryAnchors([
    {
      anchor: citation,
      repositoryKey: 'tmux/tmux',
      hasHeading: true,
      hasNativeHeading: false,
      hasVisualMedia: true,
      linkText: 'GitHub https://github.com › tmux › tmux',
    },
    {
      anchor: title,
      repositoryKey: 'tmux/tmux',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'tmux source code',
    },
    {
      anchor: sitelink,
      repositoryKey: 'tmux/tmux',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'Installing',
    },
  ], true), [title]);
});

test('recognizes a Google citation even when its favicon is outside the anchor', () => {
  const citation = { id: 'citation' };
  const title = { id: 'title' };

  assert.deepEqual(selectPreferredRepositoryAnchors([
    {
      anchor: citation,
      repositoryKey: 'tmux/tmux',
      hasHeading: true,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'GitHub https://github.com › tmux › tmux',
    },
    {
      anchor: title,
      repositoryKey: 'tmux/tmux',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'tmux source code',
    },
  ], true), [title]);
});

test('prefers a descriptive link over a generic action when no heading is available', () => {
  const readMore = { id: 'read-more' };
  const descriptive = { id: 'descriptive' };

  assert.deepEqual(selectPreferredRepositoryAnchors([
    {
      anchor: readMore,
      repositoryKey: 'firecrawl/firecrawl',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'Read more',
    },
    {
      anchor: descriptive,
      repositoryKey: 'firecrawl/firecrawl',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'firecrawl/firecrawl',
    },
  ], true), [descriptive]);
});

test('preserves repeated links outside Google search results', () => {
  const first = { id: 'first' };
  const second = { id: 'second' };

  assert.deepEqual(selectPreferredRepositoryAnchors([
    {
      anchor: first,
      repositoryKey: 'wxt-dev/wxt',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'WXT',
    },
    {
      anchor: second,
      repositoryKey: 'wxt-dev/wxt',
      hasHeading: false,
      hasNativeHeading: false,
      hasVisualMedia: false,
      linkText: 'WXT docs',
    },
  ], false), [first, second]);
});
