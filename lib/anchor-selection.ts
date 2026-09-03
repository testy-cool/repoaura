export interface RepositoryAnchorCandidate<T> {
  anchor: T;
  repositoryKey: string;
  hasHeading: boolean;
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
  if (candidate.hasHeading) return 2;
  return isGenericLinkText(candidate.linkText) ? 0 : 1;
}

function isGenericLinkText(value: string): boolean {
  return GENERIC_LINK_LABELS.has(value.replace(/\s+/g, ' ').trim().toLowerCase());
}
