import assert from 'node:assert/strict';
import test from 'node:test';

import * as repositoryModule from '../lib/repository.ts';

import {
  formatCompactNumber,
  formatInlineSummary,
  formatIssueDate,
  formatPreviewFreshness,
  formatRelativeDate,
  getActivitySignal,
  getLatestIssueTimestamp,
  parseGitHubRepositoryUrl,
  repositoryKey,
} from '../lib/repository.ts';

test('parses repository-root links', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt'), {
    owner: 'wxt-dev',
    repo: 'wxt',
  });
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt?tab=readme'), {
    owner: 'wxt-dev',
    repo: 'wxt',
  });
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt.git'), {
    owner: 'wxt-dev',
    repo: 'wxt',
  });
});

test('rejects file, folder, and feature links inside a repository', () => {
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt/tree/main'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt/blob/main/package.json'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt/issues'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt/pull/123'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt/commit/abc123'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt/releases/tag/v1.0.0'), null);
});

test('rejects section links within a repository page', () => {
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt#readme'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev/wxt#contributing-ov-file'), null);
});

test('rejects non-repository GitHub and lookalike links', () => {
  assert.equal(parseGitHubRepositoryUrl('https://github.com/topics/browser-extension'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com/wxt-dev'), null);
  assert.equal(parseGitHubRepositoryUrl('https://gist.github.com/wxt-dev/example'), null);
  assert.equal(parseGitHubRepositoryUrl('https://github.com.evil.test/wxt-dev/wxt'), null);
  assert.equal(parseGitHubRepositoryUrl('mailto:wxt-dev/wxt'), null);
});

test('recognizes direct repository visits across repository subpages', () => {
  const repository = repositoryModule as typeof repositoryModule & {
    parseGitHubRepositoryPageUrl?: (href: string) => { owner: string; repo: string } | null;
  };
  assert.equal(typeof repository.parseGitHubRepositoryPageUrl, 'function');
  assert.deepEqual(repository.parseGitHubRepositoryPageUrl!(
    'https://github.com/wxt-dev/wxt',
  ), { owner: 'wxt-dev', repo: 'wxt' });
  assert.deepEqual(repository.parseGitHubRepositoryPageUrl!(
    'https://github.com/wxt-dev/wxt/blob/main/package.json#L1',
  ), { owner: 'wxt-dev', repo: 'wxt' });
  assert.equal(repository.parseGitHubRepositoryPageUrl!(
    'https://github.com/topics/browser-extension',
  ), null);
  assert.equal(repository.parseGitHubRepositoryPageUrl!('https://github.com/wxt-dev'), null);
});

test('normalizes repository cache keys', () => {
  assert.equal(repositoryKey({ owner: 'WXT-Dev', repo: 'WXT' }), 'wxt-dev/wxt');
});

test('formats compact metrics without hiding small values', () => {
  assert.equal(formatCompactNumber(null), '—');
  assert.equal(formatCompactNumber(42), '42');
  assert.match(formatCompactNumber(1_250), /^1[.,]3K$/);
  assert.equal(formatCompactNumber(16_400), '16K');
});

test('formats useful relative dates', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');
  assert.equal(formatRelativeDate('2026-07-31T11:25:00Z', now), '35m ago');
  assert.equal(formatRelativeDate('2026-07-27T12:00:00Z', now), '4d ago');
  assert.equal(formatRelativeDate('2025-07-31T12:00:00Z', now), '1y ago');
});

test('formats issue activity dates and missing states', () => {
  assert.equal(formatIssueDate('2026-07-27T12:00:00Z', 3), 'Jul 27, 2026');
  assert.equal(formatIssueDate('2025-04-20T12:00:00Z', 8), 'Apr 20, 2025');
  assert.equal(formatIssueDate(null, 0), 'none');
  assert.equal(formatIssueDate(null, null), 'date unavailable');
});

test('labels preview fetch time as checked rather than repository activity', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');
  assert.equal(formatPreviewFreshness('2026-07-31T11:25:00Z', now), 'Checked 35m ago');
});

test('selects the newest issue activity timestamp from returned results', () => {
  const issues = [
    { createdAt: '2026-06-26T14:46:09Z', closedAt: '2026-06-29T10:47:10Z' },
    { createdAt: '2026-03-26T17:40:06Z', closedAt: '2026-07-02T09:15:00Z' },
  ];

  assert.equal(getLatestIssueTimestamp('open', issues), '2026-06-26T14:46:09Z');
  assert.equal(getLatestIssueTimestamp('closed', issues), '2026-07-02T09:15:00Z');
  assert.equal(getLatestIssueTimestamp('closed', [{ createdAt: issues[0]!.createdAt, closedAt: null }]), null);
});

test('classifies repository activity with archived and disabled overrides', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');
  assert.equal(getActivitySignal('2026-07-20T12:00:00Z', { now }).level, 'active');
  assert.equal(getActivitySignal('2026-04-20T12:00:00Z', { now }).level, 'quiet');
  assert.equal(getActivitySignal('2025-01-01T12:00:00Z', { now }).level, 'dormant');
  assert.equal(getActivitySignal('2026-07-20T12:00:00Z', { now, archived: true }).level, 'archived');
  assert.equal(getActivitySignal('2026-07-20T12:00:00Z', { now, disabled: true }).level, 'unavailable');
});

test('formats inline summaries with all visible activity states and last-push wording', () => {
  const now = Date.parse('2026-07-31T12:00:00Z');
  const base = {
    stars: 1_250,
    openIssues: 3,
    closedIssues: 9,
    pushedAt: '2026-07-27T12:00:00Z',
    archived: false,
    disabled: false,
  };

  assert.equal(formatInlineSummary(base, now).activity.label, 'Active');
  assert.equal(formatInlineSummary({ ...base, pushedAt: '2026-04-20T12:00:00Z' }, now).activity.label, 'Quiet');
  assert.equal(formatInlineSummary({ ...base, pushedAt: '2025-01-01T12:00:00Z' }, now).activity.label, 'Dormant');
  assert.equal(formatInlineSummary({ ...base, archived: true }, now).activity.label, 'Archived');
  assert.equal(formatInlineSummary({ ...base, disabled: true }, now).activity.label, 'Unavailable');

  const formatted = formatInlineSummary(base, now);
  assert.deepEqual(formatted, {
    stars: '★ 1.3K',
    starsLabel: '1.3K stars',
    activity: {
      level: 'active',
      label: 'Active',
      detail: 'Pushed within 30 days',
    },
    lastPush: 'last push 4d ago',
  });
  assert.doesNotMatch(Object.values(formatted).join(' '), /Updated/i);
});

test('formats partial inline summaries with explicit unknown values', () => {
  const formatted = formatInlineSummary({
    stars: null,
    openIssues: null,
    closedIssues: null,
    pushedAt: null,
    archived: false,
    disabled: false,
  });

  assert.equal(formatted.stars, '★ —');
  assert.equal(formatted.starsLabel, '— stars');
  assert.equal(formatted.activity.label, 'Unavailable');
  assert.equal(formatted.lastPush, 'last push —');
});
