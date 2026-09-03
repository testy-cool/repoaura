export interface RepositoryAnchorCandidate<T> {
  anchor: T;
  repositoryKey: string;
  hasHeading: boolean;
  hasNativeHeading: boolean;
  hasVisualMedia: boolean;
  linkText: string;
}

const GENERIC_LINK_LABELS = new Set([
  'github',
  'learn more',
  'more',
  'open',
  'read more',
  'view',
]);

export function isGoogleSearchResultsPage(pageHref: string): boolean {
  try {
    const url = new URL(pageHref);
    return /^(?:www\.)?google\.[a-z.]+$/i.test(url.hostname)
      && url.pathname === '/search';
  } catch {
    return false;
  }
}

export function selectPreferredRepositoryAnchors<T>(
  candidates: readonly RepositoryAnchorCandidate<T>[],
  deduplicate: boolean,
): T[] {
  if (!deduplicate) return candidates.map((candidate) => candidate.anchor);

  const preferred = new Map<string, RepositoryAnchorCandidate<T>>();
  for (const candidate of candidates) {
    const current = preferred.get(candidate.repositoryKey);
    if (!current || scoreCandidate(candidate) > scoreCandidate(current)) {
      preferred.set(candidate.repositoryKey, candidate);
    }
  }
  return [...preferred.values()].map((candidate) => candidate.anchor);
}

function scoreCandidate<T>(candidate: RepositoryAnchorCandidate<T>): number {
  if (candidate.hasNativeHeading) return 5;
  if (isGenericLinkText(candidate.linkText)) return 0;
  if (candidate.hasHeading && !candidate.hasVisualMedia) return 4;
  if (!candidate.hasVisualMedia) return 3;
  return candidate.hasHeading ? 2 : 1;
}

function isGenericLinkText(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
  return GENERIC_LINK_LABELS.has(normalized)
    || (normalized.startsWith('github ') && normalized.includes('github.com'));
}
