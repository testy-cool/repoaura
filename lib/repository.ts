export interface RepositoryCoordinate {
  owner: string;
  repo: string;
}

export type ActivityLevel = 'active' | 'quiet' | 'dormant' | 'archived' | 'unavailable';

export interface ActivitySignal {
  level: ActivityLevel;
  label: string;
  detail: string;
}

export interface IssueTimestamp {
  createdAt: string;
  closedAt: string | null;
}

export interface InlineSummaryInput {
  stars: number | null;
  openIssues: number | null;
  closedIssues: number | null;
  pushedAt: string | null;
  archived: boolean;
  disabled: boolean;
}

export interface FormattedInlineSummary {
  stars: string;
  starsLabel: string;
  activity: ActivitySignal;
  lastPush: string;
}

const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'collections',
  'contact',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'join',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'readme',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'topics',
  'trending',
]);

const OWNER_PATTERN = /^(?!-)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const REPO_PATTERN = /^(?!\.\.?$)[\w.-]{1,100}$/u;

export function parseGitHubRepositoryUrl(href: string): RepositoryCoordinate | null {
  const url = parseGitHubUrl(href);
  if (!url) return null;
  if (url.hash) return null;

  return parseRepositoryPath(url, true);
}

export function parseGitHubRepositoryPageUrl(href: string): RepositoryCoordinate | null {
  const url = parseGitHubUrl(href);
  return url ? parseRepositoryPath(url, false) : null;
}

function parseGitHubUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.toLowerCase() === 'github.com' ? url : null;
  } catch {
    return null;
  }
}

function parseRepositoryPath(url: URL, exactRoot: boolean): RepositoryCoordinate | null {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponentSafely(segment));

  if (segments.length < 2 || (exactRoot && segments.length !== 2)) return null;
  if (segments[0] == null || segments[1] == null) return null;

  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/i, '');

  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  if (!isValidRepositoryCoordinate(owner, repo)) return null;

  return { owner, repo };
}

export function isValidRepositoryCoordinate(owner: string, repo: string): boolean {
  return OWNER_PATTERN.test(owner) && REPO_PATTERN.test(repo);
}

export function repositoryKey({ owner, repo }: RepositoryCoordinate): string {
  return `${owner}/${repo}`.toLowerCase();
}

export function formatCompactNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';

  return new Intl.NumberFormat('en', {
    notation: value >= 1_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 10_000 ? 0 : 1,
  }).format(value);
}

export function formatRelativeDate(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'unknown';

  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(elapsed / 3_600_000);
  const days = Math.floor(elapsed / 86_400_000);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

export function formatIssueDate(value: string | null, count: number | null): string {
  if (count === 0) return 'none';
  if (!value || !Number.isFinite(Date.parse(value))) return 'date unavailable';
  return new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

export function formatPreviewFreshness(fetchedAt: string, now = Date.now()): string {
  return `Checked ${formatRelativeDate(fetchedAt, now)}`;
}

export function formatInlineSummary(
  summary: InlineSummaryInput,
  now = Date.now(),
): FormattedInlineSummary {
  const stars = formatCompactNumber(summary.stars);
  return {
    stars: `★ ${stars}`,
    starsLabel: `${stars} stars`,
    activity: getActivitySignal(summary.pushedAt, {
      archived: summary.archived,
      disabled: summary.disabled,
      now,
    }),
    lastPush: summary.pushedAt && Number.isFinite(Date.parse(summary.pushedAt))
      ? `last push ${formatRelativeDate(summary.pushedAt, now)}`
      : 'last push —',
  };
}

export function getLatestIssueTimestamp(
  state: 'open' | 'closed',
  issues: readonly IssueTimestamp[],
): string | null {
  const values = issues.map((issue) => (state === 'open' ? issue.createdAt : issue.closedAt));
  let latest: { value: string; timestamp: number } | null = null;

  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || (latest && timestamp <= latest.timestamp)) continue;
    latest = { value, timestamp };
  }

  return latest?.value ?? null;
}

export function getActivitySignal(
  pushedAt: string | null,
  options: { archived?: boolean; disabled?: boolean; now?: number } = {},
): ActivitySignal {
  if (options.disabled) {
    return { level: 'unavailable', label: 'Unavailable', detail: 'Repository disabled' };
  }

  if (options.archived) {
    return { level: 'archived', label: 'Archived', detail: 'Read-only repository' };
  }

  const timestamp = Date.parse(pushedAt ?? '');
  if (!Number.isFinite(timestamp)) {
    return { level: 'unavailable', label: 'Unavailable', detail: 'Push date unavailable' };
  }

  const days = Math.max(0, (options.now ?? Date.now()) - timestamp) / 86_400_000;

  if (days <= 30) {
    return { level: 'active', label: 'Active', detail: 'Pushed within 30 days' };
  }

  if (days <= 180) {
    return { level: 'quiet', label: 'Quiet', detail: 'No push in the last 30 days' };
  }

  return { level: 'dormant', label: 'Dormant', detail: 'No push in the last 6 months' };
}

function decodeURIComponentSafely(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
