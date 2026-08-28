import type {
  ExtensionErrorCode,
  ExtensionRequest,
  ExtensionResponse,
  GitHubLensSettings,
  PublicGitHubLensSettings,
  RateLimitSnapshot,
  RepositoryPreview,
  RepositorySummary,
} from '../lib/contracts.ts';
import {
  getLatestIssueTimestamp,
  isValidRepositoryCoordinate,
  repositoryKey,
} from '../lib/repository.ts';
import { normalizeInlineFields } from '../lib/inline-settings.ts';
import { normalizeSiteList } from '../lib/site-policy.ts';
import {
  contentScriptMatches,
  normalizePageAccessMode,
  type PageAccessMode,
} from '../lib/page-access.ts';
import {
  archiveCreateUrl,
  archiveEncounterCreateUrl,
  archiveHealthUrl,
  archivePermissionPattern,
  buildRepositoryObservation,
  DEFAULT_ARCHIVE_SETTINGS,
  isAcceptedArchiveResponse,
  normalizeArchiveSettings,
  type RepositoryArchiveSettings,
  type RepositoryArchiveState,
  type RepositoryObservation,
  type RepositoryObservationInput,
} from '../lib/archive.ts';
import {
  buildRepositoryEncounter,
  normalizeEncounterPageUrl,
  type RepositoryEncounter,
} from '../lib/encounter.ts';

const SETTINGS_KEY = 'githubLensSettingsV1';
const CACHE_KEY = 'githubLensRepositoryCacheV3';
const OLD_CACHE_KEY = 'githubLensRepositoryCacheV2';
const CACHE_TTL_MS = 24 * 60 * 60_000;
const DEGRADED_CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const API_VERSION = '2026-03-10';
const OPEN_ISSUES_WARNING = 'Open issue data unavailable.';
const CLOSED_ISSUES_WARNING = 'Closed issue data unavailable.';
const DEFERRED_ISSUES_WARNING = 'Issue details load after opening the repository preview.';
const LEGACY_DEFERRED_ISSUES_WARNING =
  'Issue counts deferred to preserve GitHub search capacity for an explicit preview.';
const CONTRIBUTORS_WARNING = 'Contributor count unavailable.';
const ARCHIVE_SETTINGS_KEY = 'githubLensArchiveSettingsV1';
const ARCHIVE_QUEUE_KEY = 'githubLensArchiveQueueV1';
const ENCOUNTER_QUEUE_KEY = 'githubLensEncounterQueueV1';
const ARCHIVE_STATUS_KEY = 'githubLensArchiveStatusV1';
const ARCHIVE_ALARM = 'githubLensArchiveFlush';
const ARCHIVE_RETRY_MINUTES = 15;
const ARCHIVE_TIMEOUT_MS = 5_000;
const MAX_ARCHIVE_QUEUE_ENTRIES = 250;
const MAX_ENCOUNTER_QUEUE_ENTRIES = 1_000;
const CONTENT_SCRIPT_ID = 'repoaura-content';

const DEFAULT_SETTINGS: GitHubLensSettings = {
  enabled: true,
  token: '',
  pageAccessMode: 'unconfigured',
  includedSites: [],
  excludedSites: [],
  inlineFields: normalizeInlineFields(undefined),
};

interface GitHubRepositoryResponse {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  language: string | null;
  license: { spdx_id: string | null; name: string } | null;
  topics: string[];
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  is_template: boolean;
  visibility: string;
  has_issues: boolean;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: Array<{ created_at: string; closed_at: string | null }>;
}

interface IssueSummary {
  count: number;
  latestAt: string | null;
}

interface ArchiveStatus {
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface RepositorySummaryStage {
  repository: GitHubRepositoryResponse;
  openIssues: IssueSummary | null;
  closedIssues: IssueSummary | null;
  fetchedAt: string;
  warnings: string[];
  rateLimit: RateLimitSnapshot;
}

interface CacheStage<T> {
  data: T;
  expiresAt: number;
}

interface RepositoryCacheEntry {
  summary?: CacheStage<RepositorySummaryStage>;
  detail?: CacheStage<RepositoryPreview>;
}

type RepositoryCache = Record<string, RepositoryCacheEntry>;
type RequestFunction = (url: string, init?: RequestInit) => Promise<Response>;

export interface SummaryFetchOptions {
  priority: 'automatic' | 'explicit';
  request?: RequestFunction;
  token?: string;
  now?: () => Date;
  generation?: number;
}

export interface DetailFetchOptions {
  request?: RequestFunction;
  token?: string;
  now?: () => Date;
}

class GitHubApiError extends Error {
  readonly status: number;
  readonly resetAt?: string;

  constructor(status: number, message: string, resetAt?: string) {
    super(message);
    this.status = status;
    this.resetAt = resetAt;
  }
}

class ArchiveConnectionError extends Error {}

const summaryInFlight = new Map<string, Promise<RepositorySummaryStage>>();
const detailInFlight = new Map<string, Promise<RepositoryPreview>>();
const queuedAutomaticSummaries = new Map<string, Promise<RepositorySummaryStage>>();
let automaticSummaryQueue: Promise<void> = Promise.resolve();
let cacheMutationQueue: Promise<void> = Promise.resolve();
let migrationPromise: Promise<void> | null = null;
let requestGeneration = 0;
let settingsOverride: GitHubLensSettings | null = null;
let archiveSettingsOverride: RepositoryArchiveSettings | null = null;
let archiveRepairPromise: Promise<RepositoryArchiveSettings> | null = null;
let clockNow = (): number => Date.now();
let archiveQueueMutationQueue: Promise<void> = Promise.resolve();
let encounterQueueMutationQueue: Promise<void> = Promise.resolve();
let archiveFlushPromise: Promise<void> | null = null;
let archiveFlushRequested = false;

export const backgroundTestState = (() => ({
  reset(now: number = Date.now()): void {
    summaryInFlight.clear();
    detailInFlight.clear();
    queuedAutomaticSummaries.clear();
    automaticSummaryQueue = Promise.resolve();
    cacheMutationQueue = Promise.resolve();
    migrationPromise = null;
    requestGeneration = 0;
    settingsOverride = null;
    archiveSettingsOverride = null;
    archiveRepairPromise = null;
    clockNow = () => now;
    archiveQueueMutationQueue = Promise.resolve();
    encounterQueueMutationQueue = Promise.resolve();
    archiveFlushPromise = null;
    archiveFlushRequested = false;
  },
  generation(): number {
    return requestGeneration;
  },
  clearArchiveOverride(): void {
    archiveSettingsOverride = null;
    archiveRepairPromise = null;
  },
}))();

export default defineBackground(() => {
  void ensureCacheMigration();
  void flushArchiveQueue();
  void synchronizePageAccess();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ARCHIVE_ALARM) void flushArchiveQueue();
  });
  browser.permissions.onAdded.addListener(() => {
    void handleArchivePermissionAdded();
    void synchronizePageAccess();
  });
  browser.permissions.onRemoved.addListener(() => {
    void synchronizePageAccess();
  });
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
    }
    void synchronizePageAccess();
  });
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    return handleMessage(message as ExtensionRequest, sender);
  });
});

export async function handleMessage(
  message: ExtensionRequest,
  sender: Browser.runtime.MessageSender,
): Promise<ExtensionResponse<unknown>> {
  try {
    switch (message.type) {
      case 'repository-summary':
        return await getRepositorySummary(message.owner, message.repo);
      case 'repository-preview':
        return await getRepositoryPreview(message.owner, message.repo);
      case 'record-repository-encounter': {
        const pageUrl = normalizeEncounterPageUrl(message.pageUrl);
        if (!pageUrl || !isEncounterSender(sender, pageUrl)) {
          return errorResponse('invalid-encounter', 'Encounter page identity did not match its tab.');
        }
        const encounter = buildRepositoryEncounter({
          encounterId: message.encounterId,
          owner: message.owner,
          repo: message.repo,
          source: message.source,
          pageUrl,
          pageTitle: message.pageTitle,
          linkText: message.linkText,
          seenAt: new Date(clockNow()).toISOString(),
        });
        if (!encounter) {
          return errorResponse('invalid-encounter', 'Encounter data was invalid.');
        }
        const recorded = await enqueueRepositoryEncounter(encounter);
        return { ok: true, data: { recorded } };
      }
      case 'get-settings': {
        const settings = await readSettings();
        const response: PublicGitHubLensSettings = {
          enabled: settings.enabled,
          hasToken: settings.token.length > 0,
          pageAccessMode: settings.pageAccessMode,
          includedSites: settings.includedSites,
          excludedSites: settings.excludedSites,
          inlineFields: settings.inlineFields,
        };
        if (isExtensionPage(sender)) response.token = settings.token;
        return { ok: true, data: response };
      }
      case 'save-settings': {
        assertExtensionPage(sender);
        const previousSettings = await readSettings();
        const settings = sanitizeSettings(message.settings, true);
        const tokenChanged = previousSettings.token !== settings.token;
        if (tokenChanged) invalidateRequestGeneration();
        settingsOverride = settings;
        await browser.storage.local.set({ [SETTINGS_KEY]: settings });
        await synchronizePageAccess(settings);
        if (tokenChanged) await clearStoredCache();
        return {
          ok: true,
          data: {
            enabled: settings.enabled,
            hasToken: settings.token.length > 0,
            token: settings.token,
            pageAccessMode: settings.pageAccessMode,
            includedSites: settings.includedSites,
            excludedSites: settings.excludedSites,
            inlineFields: settings.inlineFields,
          } satisfies PublicGitHubLensSettings,
        };
      }
      case 'clear-cache':
        assertExtensionPage(sender);
        invalidateRequestGeneration();
        await clearStoredCache();
        return { ok: true, data: undefined };
      case 'get-archive-settings':
        assertExtensionPage(sender);
        return { ok: true, data: await readArchiveState() };
      case 'save-archive-settings': {
        assertExtensionPage(sender);
        const settings = normalizeArchiveSettings(message.settings);
        const requestedArchive = message.settings.snapshotsEnabled
          || message.settings.encountersEnabled;
        if (requestedArchive && settings.endpoint.length === 0) {
          return errorResponse(
            'invalid-archive-endpoint',
            'Enter an HTTPS PocketBase origin without a path.',
          );
        }
        archiveSettingsOverride = settings;
        archiveRepairPromise = null;
        await browser.storage.local.set({ [ARCHIVE_SETTINGS_KEY]: settings });
        if (!settings.snapshotsEnabled) {
          await mutateArchiveQueue(() => []);
        }
        if (!settings.encountersEnabled) {
          await mutateEncounterQueue(() => []);
        }
        if (
          (settings.snapshotsEnabled || settings.encountersEnabled)
          && await hasArchiveAccess(settings.endpoint)
        ) {
          scheduleArchiveFlush(0.02);
          void flushArchiveQueue();
        }
        return { ok: true, data: await readArchiveState() };
      }
      case 'test-archive': {
        assertExtensionPage(sender);
        const settings = await readArchiveSettings();
        await testArchiveConnection(settings);
        return { ok: true, data: await readArchiveState() };
      }
      case 'flush-archive':
        assertExtensionPage(sender);
        await flushArchiveQueue();
        return { ok: true, data: await readArchiveState() };
      default:
        return errorResponse('unknown', 'Unsupported request.');
    }
  } catch (error) {
    return mapError(error);
  }
}

async function getRepositorySummary(
  owner: string,
  repo: string,
): Promise<ExtensionResponse<RepositorySummary>> {
  if (!isValidRepositoryCoordinate(owner, repo)) {
    return errorResponse('invalid-repository', 'That link does not identify a valid GitHub repository.');
  }
  const key = repositoryKey({ owner, repo });
  const generation = requestGeneration;
  try {
    const stage = await enqueueAutomaticSummary(key, owner, repo, generation);
    return { ok: true, data: toRepositorySummary(stage) };
  } catch (error) {
    return mapError(error);
  }
}

async function getRepositoryPreview(
  owner: string,
  repo: string,
): Promise<ExtensionResponse<RepositoryPreview>> {
  if (!isValidRepositoryCoordinate(owner, repo)) {
    return errorResponse('invalid-repository', 'That link does not identify a valid GitHub repository.');
  }
  const key = repositoryKey({ owner, repo });
  const generation = requestGeneration;
  const cached = await readCachedStage(key, 'detail', generation);
  if (cached) return { ok: true, data: cached };

  const inFlightKey = generationKey(key, generation);
  let request = detailInFlight.get(inFlightKey);
  if (!request) {
    request = fetchDetailForRepository(key, owner, repo, generation)
      .finally(() => detailInFlight.delete(inFlightKey));
    detailInFlight.set(inFlightKey, request);
  }
  try {
    return { ok: true, data: await request };
  } catch (error) {
    return mapError(error);
  }
}

function enqueueAutomaticSummary(
  key: string,
  owner: string,
  repo: string,
  generation: number,
): Promise<RepositorySummaryStage> {
  const inFlightKey = generationKey(key, generation);
  const queued = queuedAutomaticSummaries.get(inFlightKey);
  if (queued) return queued;
  const request = automaticSummaryQueue.then(
    () => getOrFetchSummaryStage(key, owner, repo, 'automatic', generation),
  );
  automaticSummaryQueue = request.then(() => undefined, () => undefined);
  queuedAutomaticSummaries.set(inFlightKey, request);
  void request.finally(() => queuedAutomaticSummaries.delete(inFlightKey)).catch(() => undefined);
  return request;
}

async function getOrFetchSummaryStage(
  key: string,
  owner: string,
  repo: string,
  priority: 'automatic' | 'explicit',
  generation: number,
): Promise<RepositorySummaryStage> {
  const cached = await readCachedStage(key, 'summary', generation);
  if (cached) return cached;
  const inFlightKey = generationKey(key, generation);
  let request = summaryInFlight.get(inFlightKey);
  if (!request) {
    request = fetchAndCacheSummary(key, owner, repo, priority, generation)
      .finally(() => summaryInFlight.delete(inFlightKey));
    summaryInFlight.set(inFlightKey, request);
  }
  return request;
}

async function fetchAndCacheSummary(
  key: string,
  owner: string,
  repo: string,
  priority: 'automatic' | 'explicit',
  generation: number,
): Promise<RepositorySummaryStage> {
  const settings = await readSettings();
  const stage = await fetchRepositorySummaryStage(owner, repo, {
    priority,
    token: settings.token,
    generation,
    now: () => new Date(clockNow()),
  });
  await cacheStage(key, 'summary', stage, generation);
  if (generation === requestGeneration) {
    await enqueueArchiveObservation(buildRepositoryObservation(summaryObservationInput(stage)));
  }
  return stage;
}

async function fetchDetailForRepository(
  key: string,
  owner: string,
  repo: string,
  generation: number,
): Promise<RepositoryPreview> {
  const settings = await readSettings();
  const stage = await getOrFetchSummaryStage(key, owner, repo, 'explicit', generation);
  const fillsDeferredIssues = !stage.openIssues || !stage.closedIssues;
  const detail = await enrichRepositoryDetail(stage, { token: settings.token });
  if (fillsDeferredIssues) await updateCachedSummaryData(key, stage, generation);
  await cacheStage(key, 'detail', detail, generation);
  if (generation === requestGeneration) {
    await enqueueArchiveObservation(buildRepositoryObservation(detailObservationInput(detail)));
  }
  return detail;
}

export async function fetchRepositorySummaryStage(
  owner: string,
  repo: string,
  options: SummaryFetchOptions,
): Promise<RepositorySummaryStage> {
  const request = options.request ?? fetch;
  const generation = options.generation ?? requestGeneration;
  const headers = createHeaders(options.token ?? '');
  const rateLimit = emptyRateLimit();
  const warnings: string[] = [];
  const repositoryResponse = await githubRequest<GitHubRepositoryResponse>(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    headers,
    rateLimit,
    request,
  );

  let openIssues: IssueSummary | null = null;
  let closedIssues: IssueSummary | null = null;
  if (options.priority === 'automatic') {
    warnings.push(DEFERRED_ISSUES_WARNING);
  } else {
    openIssues = await fetchIssueSummaryOrWarn(
      owner, repo, 'open', headers, rateLimit, request, warnings,
    );
    closedIssues = await fetchIssueSummaryOrWarn(
      owner, repo, 'closed', headers, rateLimit, request, warnings,
    );
  }

  return {
    repository: repositoryResponse.data,
    openIssues,
    closedIssues,
    fetchedAt: (options.now?.() ?? new Date()).toISOString(),
    warnings,
    rateLimit,
  };
}

export async function enrichRepositoryDetail(
  source: RepositorySummaryStage,
  options: DetailFetchOptions = {},
): Promise<RepositoryPreview> {
  const request = options.request ?? fetch;
  const headers = createHeaders(options.token ?? '');
  const rateLimit = { ...source.rateLimit };
  const warnings = source.warnings.filter((warning) => !isIssueWarning(warning));
  const owner = repositoryOwner(source.repository.full_name);
  const repo = repositoryName(source.repository.full_name);
  let openIssues = source.openIssues;
  let closedIssues = source.closedIssues;
  const fetchedAt = source.fetchedAt;

  if (!openIssues) {
    openIssues = await fetchIssueSummaryOrWarn(
      owner, repo, 'open', headers, rateLimit, request, warnings,
    );
  }
  if (!closedIssues) {
    closedIssues = await fetchIssueSummaryOrWarn(
      owner, repo, 'closed', headers, rateLimit, request, warnings,
    );
  }

  let contributors: number | null = null;
  try {
    contributors = await fetchContributorCount(owner, repo, headers, rateLimit, request);
  } catch {
    warnings.push(CONTRIBUTORS_WARNING);
  }

  source.openIssues = openIssues;
  source.closedIssues = closedIssues;
  source.warnings = warnings.filter((warning) => warning !== CONTRIBUTORS_WARNING);
  source.rateLimit = { ...rateLimit };

  const repository = source.repository;
  return {
    fullName: repository.full_name,
    url: repository.html_url,
    description: repository.description,
    stars: repository.stargazers_count,
    forks: repository.forks_count,
    watchers: repository.subscribers_count,
    openIssues: openIssues?.count ?? null,
    closedIssues: closedIssues?.count ?? null,
    latestOpenIssueAt: openIssues?.latestAt ?? null,
    latestClosedIssueAt: closedIssues?.latestAt ?? null,
    contributors,
    language: repository.language,
    license: normalizeLicense(repository.license),
    topics: repository.topics.slice(0, 5),
    archived: repository.archived,
    disabled: repository.disabled,
    fork: repository.fork,
    template: repository.is_template,
    visibility: repository.visibility,
    hasIssues: repository.has_issues,
    defaultBranch: repository.default_branch,
    createdAt: repository.created_at,
    updatedAt: repository.updated_at,
    pushedAt: repository.pushed_at,
    fetchedAt,
    warnings,
    rateLimit,
  };
}

export function toRepositorySummary(stage: RepositorySummaryStage): RepositorySummary {
  return {
    fullName: stage.repository.full_name,
    url: stage.repository.html_url,
    stars: stage.repository.stargazers_count,
    openIssues: stage.openIssues?.count ?? null,
    closedIssues: stage.closedIssues?.count ?? null,
    pushedAt: stage.repository.pushed_at,
    archived: stage.repository.archived,
    disabled: stage.repository.disabled,
    fetchedAt: stage.fetchedAt,
    warnings: [...stage.warnings],
    rateLimit: { ...stage.rateLimit },
  };
}

async function fetchIssueSummaryOrWarn(
  owner: string,
  repo: string,
  state: 'open' | 'closed',
  headers: HeadersInit,
  rateLimit: RateLimitSnapshot,
  request: RequestFunction,
  warnings: string[],
): Promise<IssueSummary | null> {
  try {
    return await fetchIssueSummary(owner, repo, state, headers, rateLimit, request);
  } catch {
    warnings.push(state === 'open' ? OPEN_ISSUES_WARNING : CLOSED_ISSUES_WARNING);
    return null;
  }
}

async function fetchIssueSummary(
  owner: string,
  repo: string,
  state: 'open' | 'closed',
  headers: HeadersInit,
  rateLimit: RateLimitSnapshot,
  request: RequestFunction,
): Promise<IssueSummary> {
  const query = new URLSearchParams({
    q: `repo:${owner}/${repo} is:issue is:${state}`,
    sort: state === 'open' ? 'created' : 'updated',
    order: 'desc',
    per_page: state === 'open' ? '1' : '5',
  });
  const response = await githubRequest<GitHubSearchResponse>(
    `https://api.github.com/search/issues?${query}`,
    headers,
    rateLimit,
    request,
  );
  if (response.data.incomplete_results) {
    throw new Error(`GitHub returned an incomplete ${state} issue count.`);
  }
  const issues = response.data.items.map((issue) => ({
    createdAt: issue.created_at,
    closedAt: issue.closed_at,
  }));
  return {
    count: response.data.total_count,
    latestAt: getLatestIssueTimestamp(state, issues),
  };
}

async function fetchContributorCount(
  owner: string,
  repo: string,
  headers: HeadersInit,
  rateLimit: RateLimitSnapshot,
  request: RequestFunction,
): Promise<number> {
  const response = await performRequest(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contributors?anon=1&per_page=1`,
    headers,
    rateLimit,
    request,
  );
  if (response.status === 204) return 0;
  if (!response.ok) await throwGitHubError(response);
  const lastPage = parseLastPage(response.headers.get('link'));
  if (lastPage != null) return lastPage;
  const contributors = (await response.json()) as unknown[];
  return contributors.length;
}

async function githubRequest<T>(
  url: string,
  headers: HeadersInit,
  rateLimit: RateLimitSnapshot,
  request: RequestFunction,
): Promise<{ data: T; response: Response }> {
  const response = await performRequest(url, headers, rateLimit, request);
  if (!response.ok) await throwGitHubError(response);
  return { data: (await response.json()) as T, response };
}

async function performRequest(
  url: string,
  headers: HeadersInit,
  rateLimit: RateLimitSnapshot,
  request: RequestFunction,
): Promise<Response> {
  let response: Response;
  try {
    response = await request(url, { headers });
  } catch {
    throw new GitHubApiError(0, 'Could not reach GitHub. Check your connection and try again.');
  }
  updateRateLimit(rateLimit, response);
  return response;
}

async function throwGitHubError(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  const resetAt = parseResetAt(response.headers.get('x-ratelimit-reset'));
  throw new GitHubApiError(
    response.status,
    payload?.message ?? `GitHub returned ${response.status}.`,
    resetAt ?? undefined,
  );
}

function createHeaders(token: string): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function emptyRateLimit(): RateLimitSnapshot {
  return { coreRemaining: null, searchRemaining: null, resetAt: null };
}

function updateRateLimit(snapshot: RateLimitSnapshot, response: Response): void {
  const remainingHeader = response.headers.get('x-ratelimit-remaining');
  const resource = response.headers.get('x-ratelimit-resource');
  const remaining = remainingHeader == null ? null : Number.parseInt(remainingHeader, 10);
  const resetAt = parseResetAt(response.headers.get('x-ratelimit-reset'));
  if (Number.isFinite(remaining)) {
    if (resource === 'search') snapshot.searchRemaining = remaining;
    else snapshot.coreRemaining = remaining;
  }
  if (resetAt && (resource === 'search' || snapshot.resetAt == null)) snapshot.resetAt = resetAt;
}

function parseLastPage(linkHeader: string | null): number | null {
  if (!linkHeader) return null;
  const lastLink = linkHeader
    .split(',')
    .map((part) => part.trim())
    .find((part) => /rel="last"/.test(part));
  const urlMatch = lastLink?.match(/^<([^>]+)>/);
  if (!urlMatch) return null;
  const lastUrl = urlMatch[1];
  if (!lastUrl) return null;
  const page = Number.parseInt(new URL(lastUrl).searchParams.get('page') ?? '', 10);
  return Number.isFinite(page) ? page : null;
}

function parseResetAt(value: string | null): string | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) ? new Date(seconds * 1_000).toISOString() : null;
}

function normalizeLicense(license: GitHubRepositoryResponse['license']): string | null {
  if (!license) return null;
  if (license.spdx_id && license.spdx_id !== 'NOASSERTION') return license.spdx_id;
  return license.name === 'Other' ? 'Custom' : license.name;
}

function repositoryOwner(fullName: string): string {
  return fullName.split('/', 2)[0] ?? '';
}

function repositoryName(fullName: string): string {
  return fullName.split('/', 2)[1] ?? '';
}

function isIssueWarning(warning: string): boolean {
  return warning === OPEN_ISSUES_WARNING
    || warning === CLOSED_ISSUES_WARNING
    || warning === DEFERRED_ISSUES_WARNING
    || warning === LEGACY_DEFERRED_ISSUES_WARNING;
}

function summaryObservationInput(stage: RepositorySummaryStage): RepositoryObservationInput {
  const repository = stage.repository;
  return {
    stage: 'summary',
    fullName: repository.full_name,
    url: repository.html_url,
    description: repository.description,
    stars: repository.stargazers_count,
    forks: repository.forks_count,
    watchers: repository.subscribers_count,
    openIssues: stage.openIssues?.count ?? null,
    closedIssues: stage.closedIssues?.count ?? null,
    latestOpenIssueAt: stage.openIssues?.latestAt ?? null,
    latestClosedIssueAt: stage.closedIssues?.latestAt ?? null,
    contributors: null,
    language: repository.language,
    license: normalizeLicense(repository.license),
    topics: repository.topics,
    archived: repository.archived,
    disabled: repository.disabled,
    fork: repository.fork,
    template: repository.is_template,
    visibility: repository.visibility,
    defaultBranch: repository.default_branch,
    createdAt: repository.created_at,
    updatedAt: repository.updated_at,
    pushedAt: repository.pushed_at,
    fetchedAt: stage.fetchedAt,
    warnings: stage.warnings,
  };
}

function detailObservationInput(detail: RepositoryPreview): RepositoryObservationInput {
  return {
    stage: 'detail',
    fullName: detail.fullName,
    url: detail.url,
    description: detail.description,
    stars: detail.stars,
    forks: detail.forks,
    watchers: detail.watchers,
    openIssues: detail.openIssues,
    closedIssues: detail.closedIssues,
    latestOpenIssueAt: detail.latestOpenIssueAt,
    latestClosedIssueAt: detail.latestClosedIssueAt,
    contributors: detail.contributors,
    language: detail.language,
    license: detail.license,
    topics: detail.topics,
    archived: detail.archived,
    disabled: detail.disabled,
    fork: detail.fork,
    template: detail.template,
    visibility: detail.visibility,
    defaultBranch: detail.defaultBranch,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    pushedAt: detail.pushedAt,
    fetchedAt: detail.fetchedAt,
    warnings: detail.warnings,
  };
}

async function readArchiveSettings(): Promise<RepositoryArchiveSettings> {
  if (archiveSettingsOverride) return archiveSettingsOverride;
  if (archiveRepairPromise) return await archiveRepairPromise;
  const operation = readAndRepairArchiveSettings();
  archiveRepairPromise = operation;
  try {
    return await operation;
  } finally {
    archiveRepairPromise = null;
  }
}

async function readAndRepairArchiveSettings(): Promise<RepositoryArchiveSettings> {
  const stored = await browser.storage.local.get(ARCHIVE_SETTINGS_KEY);
  const raw = stored[ARCHIVE_SETTINGS_KEY];
  const settings = normalizeArchiveSettings(raw ?? DEFAULT_ARCHIVE_SETTINGS);
  if (raw != null && JSON.stringify(raw) !== JSON.stringify(settings)) {
    archiveSettingsOverride = settings;
    await browser.storage.local.set({ [ARCHIVE_SETTINGS_KEY]: settings });
  }
  return settings;
}

async function readArchiveState(): Promise<RepositoryArchiveState> {
  const settings = await readArchiveSettings();
  const [accessGranted, observationQueue, encounterQueue, stored] = await Promise.all([
    hasArchiveAccess(settings.endpoint),
    readArchiveQueue(),
    readEncounterQueue(),
    browser.storage.local.get(ARCHIVE_STATUS_KEY),
  ]);
  const status = sanitizeArchiveStatus(stored[ARCHIVE_STATUS_KEY]);
  return {
    ...settings,
    accessGranted,
    queued: observationQueue.length + encounterQueue.length,
    ...status,
  };
}

async function hasArchiveAccess(endpoint: string): Promise<boolean> {
  const origin = archivePermissionPattern(endpoint);
  if (!origin) return false;
  try {
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

export async function handleArchivePermissionAdded(): Promise<void> {
  const settings = await readArchiveSettings();
  if (
    (!settings.snapshotsEnabled && !settings.encountersEnabled)
    || !await hasArchiveAccess(settings.endpoint)
  ) return;
  scheduleArchiveFlush(0.02);
  await flushArchiveQueue();
}

function sanitizeArchiveStatus(value: unknown): ArchiveStatus {
  const source = value && typeof value === 'object' ? value as Partial<ArchiveStatus> : {};
  return {
    lastSuccessAt: typeof source.lastSuccessAt === 'string' ? source.lastSuccessAt : null,
    lastError: typeof source.lastError === 'string' ? source.lastError : null,
  };
}

async function saveArchiveStatus(status: ArchiveStatus): Promise<void> {
  await browser.storage.local.set({ [ARCHIVE_STATUS_KEY]: status });
}

async function readArchiveStatus(): Promise<ArchiveStatus> {
  const stored = await browser.storage.local.get(ARCHIVE_STATUS_KEY);
  return sanitizeArchiveStatus(stored[ARCHIVE_STATUS_KEY]);
}

async function enqueueArchiveObservation(observation: RepositoryObservation): Promise<void> {
  const settings = await readArchiveSettings();
  if (!settings.snapshotsEnabled) return;
  await mutateArchiveQueue((queue) => {
    if (queue.some((item) => item.observation_id === observation.observation_id)) return queue;
    const next = [...queue, observation];
    return next.length > MAX_ARCHIVE_QUEUE_ENTRIES
      ? next.slice(next.length - MAX_ARCHIVE_QUEUE_ENTRIES)
      : next;
  });
  scheduleArchiveFlush(0.02);
  void flushArchiveQueue();
}

async function enqueueRepositoryEncounter(encounter: RepositoryEncounter): Promise<boolean> {
  const settings = await readArchiveSettings();
  if (!settings.encountersEnabled) return false;
  await mutateEncounterQueue((queue) => {
    if (queue.some((item) => item.encounter_id === encounter.encounter_id)) return queue;
    const next = [...queue, encounter];
    return next.length > MAX_ENCOUNTER_QUEUE_ENTRIES
      ? next.slice(next.length - MAX_ENCOUNTER_QUEUE_ENTRIES)
      : next;
  });
  scheduleArchiveFlush(0.02);
  void flushArchiveQueue();
  return true;
}

async function readArchiveQueue(): Promise<RepositoryObservation[]> {
  await archiveQueueMutationQueue;
  const stored = await browser.storage.local.get(ARCHIVE_QUEUE_KEY);
  return Array.isArray(stored[ARCHIVE_QUEUE_KEY])
    ? stored[ARCHIVE_QUEUE_KEY] as RepositoryObservation[]
    : [];
}

async function mutateArchiveQueue(
  mutate: (queue: RepositoryObservation[]) => RepositoryObservation[],
): Promise<void> {
  const operation = archiveQueueMutationQueue.then(async () => {
    const stored = await browser.storage.local.get(ARCHIVE_QUEUE_KEY);
    const queue = Array.isArray(stored[ARCHIVE_QUEUE_KEY])
      ? stored[ARCHIVE_QUEUE_KEY] as RepositoryObservation[]
      : [];
    await browser.storage.local.set({ [ARCHIVE_QUEUE_KEY]: mutate(queue) });
  });
  archiveQueueMutationQueue = operation.then(() => undefined, () => undefined);
  await operation;
}

async function readEncounterQueue(): Promise<RepositoryEncounter[]> {
  await encounterQueueMutationQueue;
  const stored = await browser.storage.local.get(ENCOUNTER_QUEUE_KEY);
  return Array.isArray(stored[ENCOUNTER_QUEUE_KEY])
    ? stored[ENCOUNTER_QUEUE_KEY] as RepositoryEncounter[]
    : [];
}

async function mutateEncounterQueue(
  mutate: (queue: RepositoryEncounter[]) => RepositoryEncounter[],
): Promise<void> {
  const operation = encounterQueueMutationQueue.then(async () => {
    const stored = await browser.storage.local.get(ENCOUNTER_QUEUE_KEY);
    const queue = Array.isArray(stored[ENCOUNTER_QUEUE_KEY])
      ? stored[ENCOUNTER_QUEUE_KEY] as RepositoryEncounter[]
      : [];
    await browser.storage.local.set({ [ENCOUNTER_QUEUE_KEY]: mutate(queue) });
  });
  encounterQueueMutationQueue = operation.then(() => undefined, () => undefined);
  await operation;
}

function scheduleArchiveFlush(delayInMinutes: number): void {
  try {
    browser.alarms.create(ARCHIVE_ALARM, { delayInMinutes });
  } catch {
    // The persisted queue remains available for the next background startup.
  }
}

async function flushArchiveQueue(): Promise<void> {
  if (archiveFlushPromise) {
    archiveFlushRequested = true;
    return await archiveFlushPromise;
  }
  const operation = (async () => {
    do {
      archiveFlushRequested = false;
      await flushArchiveQueueImpl();
    } while (archiveFlushRequested);
  })();
  archiveFlushPromise = operation.finally(() => {
    archiveFlushPromise = null;
  });
  return await archiveFlushPromise;
}

async function flushArchiveQueueImpl(): Promise<void> {
  const settings = await readArchiveSettings();
  const createUrl = archiveCreateUrl(settings.endpoint);
  const encounterCreateUrl = archiveEncounterCreateUrl(settings.endpoint);
  if (
    (!settings.snapshotsEnabled && !settings.encountersEnabled)
    || !createUrl
    || !encounterCreateUrl
    || !await hasArchiveAccess(settings.endpoint)
  ) return;

  const previousStatus = await readArchiveStatus();
  let archivedAny = false;
  const errors: string[] = [];

  for (const observation of settings.snapshotsEnabled ? await readArchiveQueue() : []) {
    try {
      const response = await fetchWithTimeout(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(observation),
      });
      if (!await isAcceptedArchiveResponse(response)) {
        throw new ArchiveConnectionError(`PocketBase returned ${response.status}.`);
      }
      await mutateArchiveQueue((queue) => queue.filter(
        (item) => item.observation_id !== observation.observation_id,
      ));
      archivedAny = true;
    } catch (error) {
      errors.push(error instanceof ArchiveConnectionError
        ? `${error.message} The observation remains queued for retry.`
        : 'Could not reach archive. The observation remains queued for retry.');
      scheduleArchiveFlush(ARCHIVE_RETRY_MINUTES);
      break;
    }
  }

  for (const encounter of settings.encountersEnabled ? await readEncounterQueue() : []) {
    try {
      const response = await fetchWithTimeout(encounterCreateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encounter),
      });
      if (!await isAcceptedArchiveResponse(response, 'encounter_id')) {
        throw new ArchiveConnectionError(`PocketBase returned ${response.status}.`);
      }
      await mutateEncounterQueue((queue) => queue.filter(
        (item) => item.encounter_id !== encounter.encounter_id,
      ));
      archivedAny = true;
    } catch (error) {
      errors.push(error instanceof ArchiveConnectionError
        ? `${error.message} The encounter remains queued for retry.`
        : 'Could not reach archive. The encounter remains queued for retry.');
      scheduleArchiveFlush(ARCHIVE_RETRY_MINUTES);
      break;
    }
  }

  if (archivedAny || errors.length > 0) {
    await saveArchiveStatus({
      lastSuccessAt: archivedAny
        ? new Date(clockNow()).toISOString()
        : previousStatus.lastSuccessAt,
      lastError: errors.length > 0 ? errors.join(' ') : null,
    });
  }
}

async function testArchiveConnection(settings: RepositoryArchiveSettings): Promise<void> {
  const healthUrl = archiveHealthUrl(settings.endpoint);
  if ((!settings.snapshotsEnabled && !settings.encountersEnabled) || !healthUrl) {
    throw new ArchiveConnectionError('Enable an archive stream and enter its PocketBase origin first.');
  }
  try {
    const response = await fetchWithTimeout(healthUrl);
    const payload = await response.json().catch(() => null) as { code?: number } | null;
    if (!response.ok || payload?.code !== 200) {
      throw new Error(`PocketBase returned ${response.status}.`);
    }
  } catch (error) {
    throw new ArchiveConnectionError(
      error instanceof Error ? error.message : 'Could not reach the PocketBase archive.',
    );
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readSettings(): Promise<GitHubLensSettings> {
  if (settingsOverride) return settingsOverride;
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<GitHubLensSettings> | undefined;
  return sanitizeSettings(raw, raw != null);
}

function sanitizeSettings(
  settings: Partial<GitHubLensSettings> | undefined,
  hasLegacySettings: boolean,
): GitHubLensSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_SETTINGS.enabled,
    token: typeof settings?.token === 'string' ? settings.token.trim() : DEFAULT_SETTINGS.token,
    pageAccessMode: normalizePageAccessMode(settings?.pageAccessMode, hasLegacySettings),
    includedSites: normalizeSiteList(settings?.includedSites),
    excludedSites: normalizeSiteList(settings?.excludedSites),
    inlineFields: normalizeInlineFields(settings?.inlineFields),
  };
}

export async function synchronizePageAccess(
  settingsOverrideValue?: GitHubLensSettings,
): Promise<void> {
  if (!browser.scripting?.getRegisteredContentScripts) return;
  const settings = settingsOverrideValue ?? await readSettings();
  const granted = await browser.permissions.getAll();
  const matches = settings.enabled
    ? contentScriptMatches(
      settings.pageAccessMode,
      settings.includedSites,
      granted.origins ?? [],
    )
    : [];
  const existing = await browser.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID],
  });

  if (matches.length === 0) {
    if (existing.length > 0) {
      await browser.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    }
    return;
  }

  const registration: Browser.scripting.RegisteredContentScript = {
    id: CONTENT_SCRIPT_ID,
    js: ['content-scripts/content.js'],
    matches,
    persistAcrossSessions: true,
    runAt: 'document_idle',
  };
  if (existing.length > 0) {
    await browser.scripting.updateContentScripts([registration]);
  } else {
    await browser.scripting.registerContentScripts([registration]);
  }
}

async function ensureCacheMigration(): Promise<void> {
  if (!migrationPromise) migrationPromise = browser.storage.local.remove(OLD_CACHE_KEY);
  await migrationPromise;
}

async function readCachedStage(
  key: string,
  stage: 'summary',
  generation: number,
): Promise<RepositorySummaryStage | null>;
async function readCachedStage(
  key: string,
  stage: 'detail',
  generation: number,
): Promise<RepositoryPreview | null>;
async function readCachedStage(
  key: string,
  stage: 'summary' | 'detail',
  generation: number,
): Promise<RepositorySummaryStage | RepositoryPreview | null> {
  await ensureCacheMigration();
  await cacheMutationQueue;
  const stored = await browser.storage.local.get(CACHE_KEY);
  const cache = (stored[CACHE_KEY] as RepositoryCache | undefined) ?? {};
  const cached = cache[key]?.[stage];
  if (!cached) return null;
  if (cached.expiresAt <= clockNow()) {
    return await mutateCache((current) => {
      const currentStage = current[key]?.[stage];
      if (sameCacheStage(currentStage, cached)) {
        delete current[key]![stage];
        if (!current[key]!.summary && !current[key]!.detail) delete current[key];
        return { changed: true, result: null };
      }
      if (
        currentStage
        && currentStage.expiresAt > clockNow()
      ) {
        return { changed: false, result: currentStage.data };
      }
      return { changed: false, result: null };
    });
  }
  return cached.data;
}

async function cacheStage(
  key: string,
  stage: 'summary',
  data: RepositorySummaryStage,
  generation: number,
): Promise<void>;
async function cacheStage(
  key: string,
  stage: 'detail',
  data: RepositoryPreview,
  generation: number,
): Promise<void>;
async function cacheStage(
  key: string,
  stage: 'summary' | 'detail',
  data: RepositorySummaryStage | RepositoryPreview,
  generation: number,
): Promise<void> {
  const hasDegradedData = data.warnings.some(
    (warning) => warning !== DEFERRED_ISSUES_WARNING,
  );
  const ttl = hasDegradedData ? DEGRADED_CACHE_TTL_MS : CACHE_TTL_MS;
  await mutateCache((cache) => {
    if (generation !== requestGeneration) return { changed: false, result: undefined };
    pruneCache(cache, key);
    const entry = cache[key] ?? {};
    if (stage === 'summary') {
      entry.summary = {
        data: data as RepositorySummaryStage,
        expiresAt: clockNow() + ttl,
      };
    } else {
      entry.detail = {
        data: data as RepositoryPreview,
        expiresAt: clockNow() + ttl,
      };
    }
    cache[key] = entry;
    return { changed: true, result: undefined };
  });
}

async function updateCachedSummaryData(
  key: string,
  data: RepositorySummaryStage,
  generation: number,
): Promise<void> {
  await mutateCache((cache) => {
    if (generation !== requestGeneration) return { changed: false, result: undefined };
    const summary = cache[key]?.summary;
    if (!summary) return { changed: false, result: undefined };
    summary.data = data;
    return { changed: true, result: undefined };
  });
}

interface CacheMutation<T> {
  changed: boolean;
  result: T;
}

async function mutateCache<T>(
  mutate: (cache: RepositoryCache) => CacheMutation<T>,
): Promise<T> {
  const operation = cacheMutationQueue.then(async () => {
    await ensureCacheMigration();
    const stored = await browser.storage.local.get(CACHE_KEY);
    const cache = (stored[CACHE_KEY] as RepositoryCache | undefined) ?? {};
    const mutation = mutate(cache);
    if (mutation.changed) await browser.storage.local.set({ [CACHE_KEY]: cache });
    return mutation.result;
  });
  cacheMutationQueue = operation.then(() => undefined, () => undefined);
  return await operation;
}

async function clearStoredCache(): Promise<void> {
  const operation = cacheMutationQueue.then(async () => {
    await ensureCacheMigration();
    await browser.storage.local.remove([CACHE_KEY, OLD_CACHE_KEY]);
  });
  cacheMutationQueue = operation.then(() => undefined, () => undefined);
  await operation;
}

function sameCacheStage(
  left: { expiresAt: number; data: { fetchedAt: string } } | undefined,
  right: { expiresAt: number; data: { fetchedAt: string } },
): boolean {
  return left?.expiresAt === right.expiresAt
    && left.data.fetchedAt === right.data.fetchedAt;
}

function invalidateRequestGeneration(): void {
  requestGeneration += 1;
  automaticSummaryQueue = Promise.resolve();
}

function generationKey(key: string, generation: number): string {
  return `${generation}:${key}`;
}

function pruneCache(cache: RepositoryCache, incomingKey: string): void {
  const now = clockNow();
  for (const [key, entry] of Object.entries(cache)) {
    if (entry.summary && entry.summary.expiresAt <= now) delete entry.summary;
    if (entry.detail && entry.detail.expiresAt <= now) delete entry.detail;
    if (!entry.summary && !entry.detail) delete cache[key];
  }
  if (cache[incomingKey] || Object.keys(cache).length < MAX_CACHE_ENTRIES) return;
  const oldest = Object.entries(cache)
    .map(([key, entry]) => ({
      key,
      expiresAt: Math.max(entry.summary?.expiresAt ?? 0, entry.detail?.expiresAt ?? 0),
    }))
    .sort((a, b) => a.expiresAt - b.expiresAt)[0];
  if (oldest) delete cache[oldest.key];
}

function isExtensionPage(sender: Browser.runtime.MessageSender): boolean {
  const extensionOrigin = browser.runtime.getURL('');
  return sender.url?.startsWith(extensionOrigin) ?? false;
}

function isEncounterSender(sender: Browser.runtime.MessageSender, pageUrl: string): boolean {
  const senderUrl = normalizeEncounterPageUrl(sender.url ?? sender.tab?.url);
  return senderUrl === pageUrl;
}

function assertExtensionPage(sender: Browser.runtime.MessageSender): void {
  if (!isExtensionPage(sender)) throw new Error('This action is only available from the extension.');
}

function mapError(error: unknown): ExtensionResponse<never> {
  if (error instanceof ArchiveConnectionError) {
    return errorResponse('archive-unreachable', error.message);
  }
  if (error instanceof GitHubApiError) {
    if (error.status === 404) return errorResponse('not-found', 'Repository not found or not accessible.');
    if (error.status === 401 || error.status === 403) {
      const rateLimited = error.message.toLowerCase().includes('rate limit');
      return errorResponse(
        rateLimited ? 'rate-limited' : 'forbidden',
        rateLimited
          ? 'GitHub’s API limit was reached. Add a token in RepoAura settings or try again later.'
          : 'GitHub denied this request. Check the token in RepoAura settings.',
        error.resetAt,
      );
    }
    if (error.status === 0) return errorResponse('network', error.message);
  }
  return errorResponse('unknown', error instanceof Error ? error.message : 'Something went wrong.');
}

function errorResponse(
  code: ExtensionErrorCode,
  message: string,
  resetAt?: string,
): ExtensionResponse<never> {
  return { ok: false, error: { code, message, ...(resetAt ? { resetAt } : {}) } };
}
