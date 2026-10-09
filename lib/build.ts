declare const __REPOAURA_PERSONAL__: boolean;

// Replaced at build time so personal features are removed from public packages.
export const PERSONAL_BUILD = typeof __REPOAURA_PERSONAL__ !== 'undefined'
  && __REPOAURA_PERSONAL__;
