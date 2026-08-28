import type { ActivityLevel } from './repository.ts';
import { getActivitySignal } from './repository.ts';

export interface RepositoryArchiveSettings {
  snapshotsEnabled: boolean;
  encountersEnabled: boolean;
  endpoint: string;
}

export interface RepositoryArchiveState extends RepositoryArchiveSettings {
  accessGranted: boolean;
  queued: number;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface RepositoryObservationInput {
  stage: 'summary' | 'detail';
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number | null;
  closedIssues: number | null;
  latestOpenIssueAt: string | null;
  latestClosedIssueAt: string | null;
  contributors: number | null;
  language: string | null;
  license: string | null;
  topics: string[];
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  template: boolean;
  visibility: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  fetchedAt: string;
  warnings: string[];
}

export interface RepositoryObservation {
  observation_id: string;
  repository_key: string;
  full_name: string;
  url: string;
  stage: 'summary' | 'detail';
  activity: ActivityLevel;
  description: string;
  stars: number;
  forks: number;
  watchers: number;
  open_issues?: number;
  closed_issues?: number;
  contributors?: number;
  has_issue_data: boolean;
  has_contributor_data: boolean;
  latest_open_issue_at?: string;
  latest_closed_issue_at?: string;
  language: string;
  license: string;
  topics: string[];
  visibility: string;
  default_branch: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  template: boolean;
  repository_created_at: string;
  repository_updated_at: string;
  pushed_at: string;
  fetched_at: string;
  warnings: string[];
}

export const DEFAULT_ARCHIVE_SETTINGS: RepositoryArchiveSettings = {
  snapshotsEnabled: false,
  encountersEnabled: false,
  endpoint: '',
};

export function normalizeArchiveSettings(value: unknown): RepositoryArchiveSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<RepositoryArchiveSettings> & { enabled?: unknown }
    : {};
  const endpoint = normalizeArchiveEndpoint(source.endpoint);
  const legacyEnabled = source.enabled === true;
  return {
    snapshotsEnabled: endpoint.length > 0
      && (source.snapshotsEnabled === true || legacyEnabled),
    encountersEnabled: endpoint.length > 0 && source.encountersEnabled === true,
    endpoint,
  };
}

export function normalizeArchiveEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  try {
    const url = new URL(value.trim());
    const isLocalHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
    if (url.protocol !== 'https:' && !isLocalHttp) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname !== '/' && url.pathname !== '') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function archivePermissionPattern(endpoint: string): string | null {
  const normalized = normalizeArchiveEndpoint(endpoint);
  if (!normalized) return null;
  const url = new URL(normalized);
  return `${url.protocol}//${url.hostname}/*`;
}

export function archiveCreateUrl(endpoint: string): string | null {
  const normalized = normalizeArchiveEndpoint(endpoint);
  return normalized
    ? `${normalized}/api/collections/repository_observations/records`
    : null;
}

export function archiveEncounterCreateUrl(endpoint: string): string | null {
  const normalized = normalizeArchiveEndpoint(endpoint);
  return normalized
    ? `${normalized}/api/collections/repository_encounters/records`
    : null;
}

export function archiveHealthUrl(endpoint: string): string | null {
  const normalized = normalizeArchiveEndpoint(endpoint);
  return normalized ? `${normalized}/api/health` : null;
}

export function buildRepositoryObservation(
  input: RepositoryObservationInput,
): RepositoryObservation {
  const repositoryKey = input.fullName.toLowerCase();
  const observedAt = Date.parse(input.fetchedAt);
  const activity = getActivitySignal(input.pushedAt, {
    archived: input.archived,
    disabled: input.disabled,
    now: Number.isFinite(observedAt) ? observedAt : Date.now(),
  }).level;
  const observation: RepositoryObservation = {
    observation_id: `${repositoryKey}|${input.fetchedAt}|${input.stage}`,
    repository_key: repositoryKey,
    full_name: input.fullName,
    url: input.url,
    stage: input.stage,
    activity,
    description: input.description ?? '',
    stars: input.stars,
    forks: input.forks,
    watchers: input.watchers,
    has_issue_data: input.openIssues != null && input.closedIssues != null,
    has_contributor_data: input.contributors != null,
    language: input.language ?? '',
    license: input.license ?? '',
    topics: [...input.topics],
    visibility: input.visibility,
    default_branch: input.defaultBranch,
    archived: input.archived,
    disabled: input.disabled,
    fork: input.fork,
    template: input.template,
    repository_created_at: input.createdAt,
    repository_updated_at: input.updatedAt,
    pushed_at: input.pushedAt,
    fetched_at: input.fetchedAt,
    warnings: [...input.warnings],
  };
  if (input.openIssues != null) observation.open_issues = input.openIssues;
  if (input.closedIssues != null) observation.closed_issues = input.closedIssues;
  if (input.contributors != null) observation.contributors = input.contributors;
  if (input.latestOpenIssueAt) observation.latest_open_issue_at = input.latestOpenIssueAt;
  if (input.latestClosedIssueAt) observation.latest_closed_issue_at = input.latestClosedIssueAt;
  return observation;
}

export async function isAcceptedArchiveResponse(
  response: Response,
  uniqueField = 'observation_id',
): Promise<boolean> {
  if (response.ok) return true;
  if (response.status !== 400) return false;
  const payload = await response.json().catch(() => null) as {
    data?: Record<string, { code?: string }>;
  } | null;
  return payload?.data?.[uniqueField]?.code === 'validation_not_unique';
}
