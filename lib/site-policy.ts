export function normalizeSiteList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const normalized = new Set<string>();
  for (const entry of value) {
    const hostname = normalizeSiteEntry(entry);
    if (hostname) normalized.add(hostname);
  }
  return [...normalized];
}

export function isSiteAllowed(
  pageHref: string,
  includedSites: readonly string[],
  excludedSites: readonly string[],
): boolean {
  const hostname = parseHttpHostname(pageHref);
  if (!hostname) return false;

  const includes = normalizeSiteList(includedSites);
  const excludes = normalizeSiteList(excludedSites);
  if (excludes.some((entry) => hostnameMatches(hostname, entry))) return false;
  return includes.length === 0 || includes.some((entry) => hostnameMatches(hostname, entry));
}

function normalizeSiteEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;
  if (candidate.startsWith('*.')) candidate = candidate.slice(2);

  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/\.$/, '') || null;
  } catch {
    return null;
  }
}

function parseHttpHostname(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function hostnameMatches(hostname: string, rule: string): boolean {
  return hostname === rule || hostname.endsWith(`.${rule}`);
}
