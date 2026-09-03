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
      linkText: 'Read more',
    },
    {
      anchor: issueSitelink,
      repositoryKey: 'herdrdev/herdr',
      hasHeading: false,
      linkText: 'Issues · herdrdev/herdr',
    },
    {
      anchor: primaryResult,
      repositoryKey: 'herdrdev/herdr',
      hasHeading: true,
      linkText: 'herdrdev/herdr: the runtime your coding agents live on',
    },
    {
      anchor: anotherRepository,
      repositoryKey: 'alacritty/alacritty',
      hasHeading: true,
      linkText: 'alacritty/alacritty: A cross-platform terminal emulator',
    },
  ], true), [primaryResult, anotherRepository]);
});

test('prefers a descriptive link over a generic action when no heading is available', () => {
  const readMore = { id: 'read-more' };
  const descriptive = { id: 'descriptive' };

  assert.deepEqual(selectPreferredRepositoryAnchors([
    {
      anchor: readMore,
      repositoryKey: 'firecrawl/firecrawl',
      hasHeading: false,
      linkText: 'Read more',
    },
    {
      anchor: descriptive,
      repositoryKey: 'firecrawl/firecrawl',
      hasHeading: false,
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
      linkText: 'WXT',
    },
    {
      anchor: second,
      repositoryKey: 'wxt-dev/wxt',
      hasHeading: false,
      linkText: 'WXT docs',
    },
  ], false), [first, second]);
});
