export type InlineSummaryField = 'stars' | 'activity' | 'lastPush';

export const DEFAULT_INLINE_FIELDS: readonly InlineSummaryField[] = [
  'stars',
  'activity',
  'lastPush',
];

export function normalizeInlineFields(value: unknown): InlineSummaryField[] {
  if (!Array.isArray(value)) return [...DEFAULT_INLINE_FIELDS];

  const selected = new Set(value.filter((item): item is string => typeof item === 'string'));
  return DEFAULT_INLINE_FIELDS.filter((field) => selected.has(field));
}
