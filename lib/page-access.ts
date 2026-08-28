import { normalizeSiteList } from './site-policy.ts';

export const ALL_PAGE_ORIGINS = ['http://*/*', 'https://*/*'] as const;

export type PageAccessMode = 'unconfigured' | 'all-sites' | 'selected-sites';

export function normalizePageAccessMode(
  value: unknown,
  hasLegacySettings: boolean,
): PageAccessMode {
  if (value === 'all-sites' || value === 'selected-sites' || value === 'unconfigured') {
    return value;
  }
  return hasLegacySettings ? 'all-sites' : 'unconfigured';
}

export function sitePermissionPatterns(value: unknown): string[] {
  const [hostname] = normalizeSiteList([value]);
  if (!hostname) return [];
  return [`http://${hostname}/*`, `https://${hostname}/*`];
}

export function contentScriptMatches(
  mode: PageAccessMode,
  includedSites: readonly string[],
  grantedOrigins: readonly string[],
): string[] {
  const granted = new Set(grantedOrigins);
  if (mode === 'unconfigured') return [];

  if (mode === 'all-sites') {
    return ALL_PAGE_ORIGINS.every((origin) => granted.has(origin))
      ? [...ALL_PAGE_ORIGINS]
      : [];
  }

  return normalizeSiteList(includedSites).flatMap((hostname) => {
    const patterns = sitePermissionPatterns(hostname);
    return patterns.every((pattern) => granted.has(pattern)) ? patterns : [];
  });
}
