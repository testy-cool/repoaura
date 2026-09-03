interface VerticalRect {
  top: number;
  bottom: number;
}

export type CompanionDomPosition = 'before' | 'after';
export type CompanionPresentation = 'compact' | 'stacked';

interface CompanionPresentationInput {
  anchorDisplay: string;
  anchorWidth: number;
  parentWidth: number;
  inHeading?: boolean;
}

export function getCompanionPresentation(
  input: CompanionPresentationInput,
): CompanionPresentation {
  if (input.inHeading || ['block', 'flex', 'grid'].includes(input.anchorDisplay)) {
    return 'stacked';
  }
  if (input.parentWidth <= 0) return 'compact';
  return input.anchorWidth / input.parentWidth >= 0.65 ? 'stacked' : 'compact';
}

export function getCompanionDomPosition(
  heading: VerticalRect,
  companion: VerticalRect,
): CompanionDomPosition {
  return companion.bottom <= heading.top ? 'before' : 'after';
}

export function normalizeCounterTransform(value: string): string | null {
  const transform = value.trim();
  if (!transform || transform === 'none') return null;

  const match = transform.match(/^matrix\(([^)]+)\)$/);
  if (!match) return null;
  const values = match[1]!.split(',').map((part) => Number(part.trim()));
  if (values.length !== 6 || values.some((part) => !Number.isFinite(part))) return null;

  const [scaleX, skewY, skewX, scaleY] = values;
  const changesOrientation = scaleX! < 0
    || scaleY! < 0
    || Math.abs(skewX!) > 0.01
    || Math.abs(skewY!) > 0.01;
  return changesOrientation ? transform : null;
}
