import {
  isValidRepositoryCoordinate,
  repositoryKey,
  type RepositoryCoordinate,
} from './repository.ts';

export type RepositoryEncounterSource = 'link' | 'direct';

export interface RepositoryEncounterInput extends RepositoryCoordinate {
  encounterId: string;
  source: RepositoryEncounterSource;
  pageUrl: string;
  pageTitle: string;
  linkText: string;
  seenAt: string;
}

export interface RepositoryEncounter {
  encounter_id: string;
  repository_key: string;
  full_name: string;
  repository_url: string;
  source: RepositoryEncounterSource;
  page_url: string;
  page_host: string;
  page_title: string;
  link_text: string;
  seen_at: string;
}

const ENCOUNTER_ID_PATTERN = /^[a-z\d._:-]{1,100}$/i;
const MAX_PAGE_URL_LENGTH = 4_000;

export function normalizeEncounterPageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.href.length <= MAX_PAGE_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

export function createEncounterId(now = Date.now()): string {
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  const random = [...values].map((value) => value.toString(36)).join('-');
  return `${now.toString(36)}-${random}`;
}

export function buildRepositoryEncounter(
  input: RepositoryEncounterInput,
): RepositoryEncounter | null {
  if (!ENCOUNTER_ID_PATTERN.test(input.encounterId)) return null;
  if (!isValidRepositoryCoordinate(input.owner, input.repo)) return null;
  if (input.source !== 'link' && input.source !== 'direct') return null;
  const pageUrl = normalizeEncounterPageUrl(input.pageUrl);
  if (!pageUrl || !Number.isFinite(Date.parse(input.seenAt))) return null;
  const repository = { owner: input.owner, repo: input.repo };
  return {
    encounter_id: input.encounterId,
    repository_key: repositoryKey(repository),
    full_name: `${input.owner}/${input.repo}`,
    repository_url: `https://github.com/${input.owner}/${input.repo}`,
    source: input.source,
    page_url: pageUrl,
    page_host: new URL(pageUrl).hostname.toLowerCase(),
    page_title: normalizeText(input.pageTitle, 500),
    link_text: normalizeText(input.linkText, 500),
    seen_at: input.seenAt,
  };
}

function normalizeText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}
