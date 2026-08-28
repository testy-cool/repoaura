import type { RepositoryCoordinate } from './repository';
import type { InlineSummaryField } from './inline-settings';
import type { RepositoryArchiveSettings } from './archive';
import type { RepositoryEncounterSource } from './encounter';
import type { PageAccessMode } from './page-access';

export interface GitHubLensSettings {
  enabled: boolean;
  token: string;
  pageAccessMode: PageAccessMode;
  includedSites: string[];
  excludedSites: string[];
  inlineFields: InlineSummaryField[];
}

export interface PublicGitHubLensSettings {
  enabled: boolean;
  hasToken: boolean;
  pageAccessMode: PageAccessMode;
  includedSites: string[];
  excludedSites: string[];
  inlineFields: InlineSummaryField[];
  token?: string;
}

export interface RateLimitSnapshot {
  coreRemaining: number | null;
  searchRemaining: number | null;
  resetAt: string | null;
}

export interface RepositorySummary {
  fullName: string;
  url: string;
  stars: number;
  openIssues: number | null;
  closedIssues: number | null;
  pushedAt: string;
  archived: boolean;
  disabled: boolean;
  fetchedAt: string;
  warnings: string[];
  rateLimit: RateLimitSnapshot;
}

export interface RepositoryPreview {
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
  hasIssues: boolean;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  fetchedAt: string;
  warnings: string[];
  rateLimit: RateLimitSnapshot;
}

export type ExtensionRequest =
  | ({ type: 'repository-summary' } & RepositoryCoordinate)
  | ({ type: 'repository-preview' } & RepositoryCoordinate)
  | ({
      type: 'record-repository-encounter';
      encounterId: string;
      source: RepositoryEncounterSource;
      pageUrl: string;
      pageTitle: string;
      linkText: string;
    } & RepositoryCoordinate)
  | { type: 'get-settings' }
  | { type: 'save-settings'; settings: GitHubLensSettings }
  | { type: 'clear-cache' }
  | { type: 'get-archive-settings' }
  | { type: 'save-archive-settings'; settings: RepositoryArchiveSettings }
  | { type: 'test-archive' }
  | { type: 'flush-archive' };

export type ExtensionErrorCode =
  | 'invalid-repository'
  | 'not-found'
  | 'rate-limited'
  | 'forbidden'
  | 'network'
  | 'invalid-archive-endpoint'
  | 'invalid-encounter'
  | 'archive-unreachable'
  | 'unknown';

export type ExtensionResponse<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ExtensionErrorCode;
        message: string;
        resetAt?: string;
      };
    };
