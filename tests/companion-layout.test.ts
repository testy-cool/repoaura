import assert from 'node:assert/strict';
import test from 'node:test';

test('stacks summaries for standalone result links while keeping prose compact', async () => {
  const layout = await import('../lib/companion-layout.ts');

  assert.equal(layout.getCompanionPresentation({
    anchorDisplay: 'block',
    anchorWidth: 320,
    parentWidth: 640,
  }), 'stacked');
  assert.equal(layout.getCompanionPresentation({
    anchorDisplay: 'inline',
    anchorWidth: 280,
    parentWidth: 360,
  }), 'stacked');
  assert.equal(layout.getCompanionPresentation({
    anchorDisplay: 'inline',
    anchorWidth: 120,
    parentWidth: 640,
  }), 'compact');
});
