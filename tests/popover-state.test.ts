import assert from 'node:assert/strict';
import test from 'node:test';

import { synchronizePopoverVisibility } from '../lib/popover-state.ts';

function createTargets(initialHidden: boolean) {
  const attributes = new Map<string, string>();
  return {
    attributes,
    popover: {
      dataset: {} as { open?: string },
      hidden: initialHidden,
    },
    trigger: {
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    },
  };
}

test('synchronizes the closed popover visibility state', () => {
  const { attributes, popover, trigger } = createTargets(false);

  synchronizePopoverVisibility(popover, trigger, false);

  assert.equal(popover.hidden, true);
  assert.equal(popover.dataset.open, 'false');
  assert.equal(attributes.get('aria-expanded'), 'false');
});

test('synchronizes the open popover visibility state', () => {
  const { attributes, popover, trigger } = createTargets(true);

  synchronizePopoverVisibility(popover, trigger, true);

  assert.equal(popover.hidden, false);
  assert.equal(popover.dataset.open, 'true');
  assert.equal(attributes.get('aria-expanded'), 'true');
});
