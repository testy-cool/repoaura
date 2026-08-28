import assert from 'node:assert/strict';
import test from 'node:test';

test('defaults old settings to every inline field', async () => {
  const settings = await import('../lib/inline-settings.ts');

  assert.deepEqual(settings.normalizeInlineFields(undefined), [
    'stars',
    'activity',
    'lastPush',
  ]);
});

test('normalizes inline fields in display order and preserves an empty selection', async () => {
  const settings = await import('../lib/inline-settings.ts');

  assert.deepEqual(settings.normalizeInlineFields([
    'lastPush',
    'stars',
    'unknown',
    'stars',
  ]), ['stars', 'lastPush']);
  assert.deepEqual(settings.normalizeInlineFields([]), []);
});
