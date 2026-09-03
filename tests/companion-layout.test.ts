import assert from 'node:assert/strict';
import test from 'node:test';

test('moves a companion before its anchor when a flipped result paints it above the embedded heading', async () => {
  const layout = await import('../lib/companion-layout.ts');

  assert.equal(layout.getCompanionDomPosition(
    { top: 816, bottom: 850 },
    { top: 779, bottom: 805 },
  ), 'before');
  assert.equal(layout.getCompanionDomPosition(
    { top: 816, bottom: 850 },
    { top: 853, bottom: 879 },
  ), 'after');
});

test('counteracts only orientation-changing transforms', async () => {
  const layout = await import('../lib/companion-layout.ts');

  assert.equal(layout.normalizeCounterTransform('matrix(1, 0, 0, -1, 0, 0)'), 'matrix(1, 0, 0, -1, 0, 0)');
  assert.equal(layout.normalizeCounterTransform('matrix(1, 0, 0, 1, 12, 8)'), null);
  assert.equal(layout.normalizeCounterTransform('none'), null);
});

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
