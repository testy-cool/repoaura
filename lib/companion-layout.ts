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
