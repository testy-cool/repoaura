import { parseGitHubRepositoryUrl } from './repository.ts';

export interface InlineSummaryAnchorPolicyInput {
  pageHref: string;
  repositoryHref: string;
  hasReadableText: boolean;
  isRendered: boolean;
  hasVisualMedia: boolean;
  inMarkdownBody: boolean;
}

export function isInlineSummaryAnchorEligible(
  input: InlineSummaryAnchorPolicyInput,
): boolean {
  if (!input.hasReadableText || !input.isRendered || input.hasVisualMedia) return false;
  const linkedRepository = parseGitHubRepositoryUrl(input.repositoryHref);
  if (!linkedRepository) return false;

  const pageUrl = parseHttpUrl(input.pageHref);
  if (!pageUrl) return false;
  if (pageUrl.hostname.toLowerCase() !== 'github.com') return true;
  if (pageUrl.pathname === '/topics' || pageUrl.pathname.startsWith('/topics/')) return false;
  const pageRepository = parseGitHubPageRepository(pageUrl);
  if (
    pageRepository
    && pageRepository.owner.toLowerCase() === linkedRepository.owner.toLowerCase()
    && pageRepository.repo.toLowerCase() === linkedRepository.repo.toLowerCase()
  ) return false;
  return input.inMarkdownBody;
}

function parseGitHubPageRepository(url: URL): { owner: string; repo: string } | null {
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  return parseGitHubRepositoryUrl(`${url.origin}/${owner}/${repo}`);
}

function parseHttpUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
