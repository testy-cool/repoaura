export interface PopoverVisibilityTarget {
  dataset: { open?: string };
  hidden: boolean;
}

export interface PopoverTriggerTarget {
  setAttribute(name: string, value: string): void;
}

export function synchronizePopoverVisibility(
  popover: PopoverVisibilityTarget,
  trigger: PopoverTriggerTarget,
  open: boolean,
): void {
  popover.hidden = !open;
  popover.dataset.open = String(open);
  trigger.setAttribute('aria-expanded', String(open));
}
