import '@/styles/content.css';

import type {
  ExtensionResponse,
  PublicGitHubLensSettings,
  RepositoryPreview,
  RepositorySummary,
} from '@/lib/contracts';
import {
  getCompanionDomPosition,
  getCompanionPresentation,
  normalizeCounterTransform,
} from '@/lib/companion-layout';
import {
  normalizeInlineFields,
  type InlineSummaryField,
} from '@/lib/inline-settings';
import { isInlineSummaryAnchorEligible } from '@/lib/page-policy';
import { synchronizePopoverVisibility } from '@/lib/popover-state';
import { isSiteAllowed, normalizeSiteList } from '@/lib/site-policy';
import type { PageAccessMode } from '@/lib/page-access';
import {
  createEncounterId,
  normalizeEncounterPageUrl,
  type RepositoryEncounterSource,
} from '@/lib/encounter';
import {
  formatCompactNumber,
  formatInlineSummary,
  formatIssueDate,
  formatPreviewFreshness,
  formatRelativeDate,
  getActivitySignal,
  parseGitHubRepositoryUrl,
  parseGitHubRepositoryPageUrl,
  repositoryKey,
  type RepositoryCoordinate,
} from '@/lib/repository';

const DISCOVERY_MARGIN = '200px';
const VIEWPORT_GUTTER = 12;
const POPOVER_GAP = 8;

interface CompanionElements {
  host: HTMLElement;
  root: HTMLElement;
  summaryState: HTMLElement;
  summaryLoading: HTMLElement;
  summaryError: HTMLElement;
  summaryContent: HTMLElement;
  summaryRetry: HTMLButtonElement;
  summaryStars: HTMLElement;
  summaryActivity: HTMLElement;
  summaryLastPush: HTMLElement;
  infoButton: HTMLButtonElement;
  popover: HTMLElement;
  closeButton: HTMLButtonElement;
  detailLoading: HTMLElement;
  detailError: HTMLElement;
  detailErrorMessage: HTMLElement;
  detailRetry: HTMLButtonElement;
  detailContent: HTMLElement;
  fullName: HTMLElement;
  description: HTMLElement;
  activity: HTMLElement;
  activityDetail: HTMLElement;
  stars: HTMLElement;
  openIssues: HTMLElement;
  openIssueDate: HTMLElement;
  closedIssues: HTMLElement;
  closedIssueDate: HTMLElement;
  contributors: HTMLElement;
  facts: HTMLElement;
  topics: HTMLElement;
  warning: HTMLElement;
  freshness: HTMLElement;
  rateLimit: HTMLElement;
  repositoryLink: HTMLAnchorElement;
}

interface CompanionUi {
  remove(): void;
}

interface Companion {
  anchor: HTMLAnchorElement;
  repository: RepositoryCoordinate;
  ui: CompanionUi;
  elements: CompanionElements;
  summaryRequestSequence: number;
  detailRequestSequence: number;
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  registration: 'runtime',
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main: async (ctx) => {
    const settings = await sendMessage<PublicGitHubLensSettings>({ type: 'get-settings' });
    let enabled = settings.ok ? settings.data.enabled : true;
    let pageAccessMode: PageAccessMode = settings.ok
      ? settings.data.pageAccessMode
      : 'unconfigured';
    let includedSites = settings.ok ? settings.data.includedSites : [];
    let excludedSites = settings.ok ? settings.data.excludedSites : [];
    let inlineFields = normalizeInlineFields(settings.ok ? settings.data.inlineFields : undefined);
    let invalidated = false;
    let reconcileFrame: number | undefined;
    let companionSequence = 0;
    let openCompanion: Companion | null = null;
    const companions = new Map<HTMLAnchorElement, Companion>();
    const observedAnchors = new Set<HTMLAnchorElement>();
    const pendingAnchors = new Set<HTMLAnchorElement>();
    const encounteredPageRepositories = new Set<string>();

    const recordRepositoryEncounter = (
      repository: RepositoryCoordinate,
      source: RepositoryEncounterSource,
      linkText = '',
    ) => {
      if (
        invalidated
        || !enabled
        || pageAccessMode === 'unconfigured'
        || !isSiteAllowed(
          location.href,
          pageAccessMode === 'selected-sites' ? includedSites : [],
          excludedSites,
        )
      ) return;
      const pageUrl = normalizeEncounterPageUrl(location.href);
      if (!pageUrl) return;
      const encounterKey = `${repositoryKey(repository)}|${pageUrl}`;
      if (encounteredPageRepositories.has(encounterKey)) return;
      encounteredPageRepositories.add(encounterKey);
      void sendMessage({
        type: 'record-repository-encounter',
        encounterId: createEncounterId(),
        owner: repository.owner,
        repo: repository.repo,
        source,
        pageUrl,
        pageTitle: document.title,
        linkText,
      });
    };

    const recordDirectRepositoryVisit = () => {
      const repository = parseGitHubRepositoryPageUrl(location.href);
      if (repository) recordRepositoryEncounter(repository, 'direct');
    };

    const positionOpenPopover = () => {
      if (!openCompanion) return;
      positionPopover(openCompanion.elements.popover, openCompanion.elements.infoButton);
    };

    const returnFocus = (companion: Companion) => {
      if (companion.anchor.isConnected && companion.elements.infoButton.isConnected) {
        companion.elements.infoButton.focus({ preventScroll: true });
      }
    };

    const markPopoverClosed = (companion: Companion, restoreFocus: boolean) => {
      synchronizePopoverVisibility(
        companion.elements.popover,
        companion.elements.infoButton,
        false,
      );
      if (openCompanion === companion) openCompanion = null;
      if (restoreFocus) returnFocus(companion);
    };

    const closePopover = (companion: Companion, restoreFocus = true) => {
      const { popover } = companion.elements;
      if (typeof popover.hidePopover === 'function') {
        try {
          popover.hidePopover();
        } catch {
          // The source may disconnect between reconciliation and dismissal.
        }
      }
      markPopoverClosed(companion, restoreFocus);
    };

    const removeCompanion = (companion: Companion) => {
      companion.summaryRequestSequence += 1;
      companion.detailRequestSequence += 1;
      closePopover(companion, false);
      companions.delete(companion.anchor);
      companion.ui.remove();
    };

    let intersectionObserver: IntersectionObserver;

    const removeAllCompanions = () => {
      for (const companion of [...companions.values()]) removeCompanion(companion);
      for (const anchor of observedAnchors) intersectionObserver.unobserve(anchor);
      observedAnchors.clear();
      pendingAnchors.clear();
    };

    const loadSummary = async (companion: Companion) => {
      const { elements, repository } = companion;
      const sequence = ++companion.summaryRequestSequence;
      showSummaryState(elements, 'loading');
      elements.summaryState.setAttribute(
        'aria-label',
        `Loading summary for ${repository.owner}/${repository.repo}`,
      );
      const response = await sendMessage<RepositorySummary>({
        type: 'repository-summary',
        owner: repository.owner,
        repo: repository.repo,
      });
      if (sequence !== companion.summaryRequestSequence || !companion.anchor.isConnected) return;
      if (!response.ok) {
        elements.summaryError.title = response.error.message;
        elements.summaryState.setAttribute(
          'aria-label',
          `${repository.owner}/${repository.repo}: ${response.error.message}`,
        );
        showSummaryState(elements, 'error');
        return;
      }
      renderSummary(elements, response.data, inlineFields);
      showSummaryState(elements, 'content');
    };

    const loadDetail = async (companion: Companion) => {
      const { elements, repository } = companion;
      const sequence = ++companion.detailRequestSequence;
      showDetailState(elements, 'loading');
      elements.popover.setAttribute('aria-label', `Loading ${repository.owner}/${repository.repo}`);
      positionOpenPopover();
      const response = await sendMessage<RepositoryPreview>({
        type: 'repository-preview',
        owner: repository.owner,
        repo: repository.repo,
      });
      if (
        sequence !== companion.detailRequestSequence ||
        openCompanion !== companion ||
        !companion.anchor.isConnected
      ) return;
      if (!response.ok) {
        elements.detailErrorMessage.textContent = response.error.message;
        elements.popover.setAttribute(
          'aria-label',
          `${repository.owner}/${repository.repo}: ${response.error.message}`,
        );
        showDetailState(elements, 'error');
        positionOpenPopover();
        return;
      }
      renderRepository(elements, response.data);
      showDetailState(elements, 'content');
      positionOpenPopover();
    };

    const openPopover = (companion: Companion) => {
      if (openCompanion === companion) {
        closePopover(companion);
        return;
      }
      if (openCompanion) closePopover(openCompanion, false);
      openCompanion = companion;
      synchronizePopoverVisibility(
        companion.elements.popover,
        companion.elements.infoButton,
        true,
      );
      showDetailState(companion.elements, 'loading');
      positionOpenPopover();
      if (typeof companion.elements.popover.showPopover === 'function') {
        try {
          companion.elements.popover.showPopover();
        } catch {
          // The data-open fallback remains usable without native popovers.
        }
      }
      companion.elements.closeButton.focus({ preventScroll: true });
      void loadDetail(companion);
    };

    const mountCompanion = async (anchor: HTMLAnchorElement) => {
      if (pendingAnchors.has(anchor) || companions.has(anchor)) return;
      const repository = eligibleRepository(anchor);
      if (!repository) return;
      pendingAnchors.add(anchor);
      const ui = await createShadowRootUi(ctx, {
        name: `repoaura-inline-${++companionSequence}`,
        position: 'inline',
        anchor,
        append: (anchor, host) => anchor.after(host),
        isolateEvents: ['click', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'keypress'],
        onMount(container, _shadow, shadowHost) {
          shadowHost.style.setProperty('display', 'inline', 'important');
          shadowHost.style.setProperty('position', 'relative', 'important');
          shadowHost.style.setProperty('width', 'auto', 'important');
          shadowHost.style.setProperty('height', 'auto', 'important');
          shadowHost.style.setProperty('overflow', 'visible', 'important');
          shadowHost.style.setProperty('vertical-align', 'baseline', 'important');
          return createCompanionElements(container, shadowHost, repository);
        },
      });
      pendingAnchors.delete(anchor);
      if (
        invalidated
        || !enabled
        || pageAccessMode === 'unconfigured'
        || !isSiteAllowed(
          location.href,
          pageAccessMode === 'selected-sites' ? includedSites : [],
          excludedSites,
        )
        || !anchor.isConnected
      ) {
        ui.remove();
        return;
      }
      const currentRepository = eligibleRepository(anchor);
      if (!currentRepository || repositoryKey(currentRepository) !== repositoryKey(repository)) {
        ui.remove();
        return;
      }
      ui.mount();
      const elements = ui.mounted;
      if (!elements) {
        ui.remove();
        return;
      }
      const companion: Companion = {
        anchor,
        repository,
        ui,
        elements,
        summaryRequestSequence: 0,
        detailRequestSequence: 0,
      };
      companions.set(anchor, companion);
      recordRepositoryEncounter(repository, 'link', anchor.innerText);
      applyInlineFieldVisibility(elements, inlineFields);
      applyCompanionPresentation(anchor, elements);
      correctCompanionLayout(anchor, elements);
      elements.infoButton.addEventListener('click', () => openPopover(companion));
      elements.summaryRetry.addEventListener('click', () => void loadSummary(companion));
      elements.detailRetry.addEventListener('click', () => void loadDetail(companion));
      elements.closeButton.addEventListener('click', () => closePopover(companion));
      elements.popover.addEventListener('toggle', (event) => {
        const toggle = event as Event & { newState?: 'open' | 'closed' };
        if (toggle.newState === 'closed' && openCompanion === companion) {
          markPopoverClosed(companion, true);
        }
      });
      elements.popover.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closePopover(companion);
      });
      if (inlineFields.length > 0) void loadSummary(companion);
      else showSummaryState(elements, 'content');
    };

    intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const anchor = entry.target as HTMLAnchorElement;
        intersectionObserver.unobserve(anchor);
        observedAnchors.delete(anchor);
        void mountCompanion(anchor);
      }
    }, { rootMargin: DISCOVERY_MARGIN });

    const reconcile = () => {
      reconcileFrame = undefined;
      if (invalidated) return;
      if (
        !enabled
        || pageAccessMode === 'unconfigured'
        || !isSiteAllowed(
          location.href,
          pageAccessMode === 'selected-sites' ? includedSites : [],
          excludedSites,
        )
      ) {
        removeAllCompanions();
        return;
      }
      for (const companion of [...companions.values()]) {
        const repository = eligibleRepository(companion.anchor);
        if (!repository || repositoryKey(repository) !== repositoryKey(companion.repository)) {
          removeCompanion(companion);
        }
      }
      const eligible = new Set<HTMLAnchorElement>();
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (!eligibleRepository(anchor)) continue;
        eligible.add(anchor);
        if (companions.has(anchor) || pendingAnchors.has(anchor) || observedAnchors.has(anchor)) continue;
        observedAnchors.add(anchor);
        intersectionObserver.observe(anchor);
      }
      for (const anchor of [...observedAnchors]) {
        if (eligible.has(anchor)) continue;
        intersectionObserver.unobserve(anchor);
        observedAnchors.delete(anchor);
      }
    };

    const scheduleReconcile = () => {
      if (reconcileFrame || invalidated) return;
      reconcileFrame = window.requestAnimationFrame(reconcile);
    };

    const mutationObserver = new MutationObserver(scheduleReconcile);
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['href', 'class', 'style', 'hidden', 'aria-hidden'],
    });

    const onStorageChanged = (
      changes: Record<string, Browser.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'local' || !changes.githubLensSettingsV1) return;
      const nextSettings = changes.githubLensSettingsV1.newValue as Partial<{
        enabled: boolean;
        pageAccessMode: PageAccessMode;
        includedSites: string[];
        excludedSites: string[];
        inlineFields: InlineSummaryField[];
      }> | undefined;
      enabled = nextSettings?.enabled ?? true;
      pageAccessMode = nextSettings?.pageAccessMode ?? 'unconfigured';
      includedSites = normalizeSiteList(nextSettings?.includedSites);
      excludedSites = normalizeSiteList(nextSettings?.excludedSites);
      inlineFields = normalizeInlineFields(nextSettings?.inlineFields);
      removeAllCompanions();
      if (enabled) scheduleReconcile();
    };

    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!openCompanion) return;
      if (event.composedPath().includes(openCompanion.elements.host)) return;
      closePopover(openCompanion, true);
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openCompanion) closePopover(openCompanion);
    };
    const onRuntimeMessage = (message: unknown) => {
      if (!isRefreshMessage(message)) return undefined;
      removeAllCompanions();
      if (enabled) scheduleReconcile();
      return { ok: true };
    };

    browser.storage.onChanged.addListener(onStorageChanged);
    browser.runtime.onMessage.addListener(onRuntimeMessage);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('scroll', positionOpenPopover, true);
    window.addEventListener('resize', positionOpenPopover);
    const onLocationChange = () => {
      scheduleReconcile();
      recordDirectRepositoryVisit();
    };
    window.addEventListener('wxt:locationchange', onLocationChange);
    reconcile();
    recordDirectRepositoryVisit();

    ctx.onInvalidated(() => {
      invalidated = true;
      if (reconcileFrame) window.cancelAnimationFrame(reconcileFrame);
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
      removeAllCompanions();
      browser.storage.onChanged.removeListener(onStorageChanged);
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      window.removeEventListener('scroll', positionOpenPopover, true);
      window.removeEventListener('resize', positionOpenPopover);
      window.removeEventListener('wxt:locationchange', onLocationChange);
    });
  },
});

function eligibleRepository(anchor: HTMLAnchorElement): RepositoryCoordinate | null {
  const repository = parseGitHubRepositoryUrl(anchor.href);
  if (!repository) return null;
  return isInlineSummaryAnchorEligible({
    pageHref: location.href,
    repositoryHref: anchor.href,
    hasReadableText: hasReadableAnchorText(anchor),
    isRendered: isRenderedAnchor(anchor),
    inMarkdownBody: Boolean(anchor.closest('.markdown-body')),
  }) ? repository : null;
}

function hasReadableAnchorText(anchor: HTMLAnchorElement): boolean {
  if (anchor.getAttribute('aria-hidden') === 'true') return false;
  return anchor.innerText.replace(/\s+/g, ' ').trim().length > 0;
}

function isRenderedAnchor(anchor: HTMLAnchorElement): boolean {
  if (!anchor.isConnected || anchor.hidden || anchor.getClientRects().length === 0) return false;
  const style = getComputedStyle(anchor);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

function createCompanionElements(
  container: HTMLElement,
  host: HTMLElement,
  repository: RepositoryCoordinate,
): CompanionElements {
  const fullName = `${repository.owner}/${repository.repo}`;
  container.innerHTML = `
    <span class="lens-inline" data-repository="${escapeAttribute(fullName)}">
      <span class="lens-inline-state" role="status" aria-live="polite">
        <span class="lens-inline-loading">Loading summary…</span>
        <span class="lens-inline-error" hidden>Summary unavailable <button class="lens-retry" data-summary-retry type="button">Retry</button></span>
        <span class="lens-inline-content" hidden>
          <span class="inline-metric" data-summary-stars></span>
          <span class="inline-activity" data-summary-activity></span>
          <span class="inline-last-push" data-summary-last-push></span>
        </span>
      </span>
      <button class="lens-info" type="button" aria-label="Open details for ${escapeAttribute(fullName)}" aria-expanded="false" aria-haspopup="dialog">i</button>
      <article class="lens-popover" popover="auto" data-open="false" role="dialog" hidden>
        <button class="lens-close" type="button" aria-label="Close repository details">×</button>
        <div class="lens-detail-loading">
          <span class="skeleton skeleton-title"></span><span class="skeleton skeleton-copy"></span><span class="skeleton skeleton-copy skeleton-copy-short"></span>
          <span class="skeleton-grid"><span class="skeleton skeleton-metric"></span><span class="skeleton skeleton-metric"></span><span class="skeleton skeleton-metric"></span><span class="skeleton skeleton-metric"></span></span>
        </div>
        <div class="lens-detail-error" hidden>
          <span class="error-mark" aria-hidden="true">!</span>
          <div><strong>Preview unavailable</strong><p data-detail-error-message></p><button class="lens-retry" data-detail-retry type="button">Retry</button></div>
        </div>
        <div class="lens-detail-content" hidden>
          <header class="lens-header">
            <div class="repo-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M8.4 15.6 5.8 18.2a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2A3.4 3.4 0 0 1 9 10" /><path d="m15.6 8.4 2.6-2.6A3.4 3.4 0 0 1 23 10.6l-3.2 3.2A3.4 3.4 0 0 1 15 14" /><path d="m8.5 15.5 7-7" /></svg></div>
            <div class="repo-heading"><div class="repo-title-row"><strong data-full-name></strong><span class="activity-badge" data-activity></span></div><span class="activity-detail" data-activity-detail></span></div>
          </header>
          <p class="repo-description" data-description></p>
          <dl class="metrics"><div><dt>Stars</dt><dd data-stars></dd></div><div><dt>Open</dt><dd data-open-issues></dd><small data-opened-at></small></div><div><dt>Closed</dt><dd data-closed-issues></dd><small data-closed-at></small></div><div><dt>People</dt><dd data-contributors></dd></div></dl>
          <div class="facts" data-facts></div><div class="topics" data-topics></div><p class="warning" data-warning hidden></p>
          <footer class="lens-footer"><div class="freshness"><span data-freshness></span><span data-rate-limit></span></div><a data-repository-link target="_blank" rel="noreferrer">Open repo <span aria-hidden="true">↗</span></a></footer>
        </div>
      </article>
    </span>`;
  return {
    host,
    root: requiredElement(container, '.lens-inline'),
    summaryState: requiredElement(container, '.lens-inline-state'),
    summaryLoading: requiredElement(container, '.lens-inline-loading'),
    summaryError: requiredElement(container, '.lens-inline-error'),
    summaryContent: requiredElement(container, '.lens-inline-content'),
    summaryRetry: requiredElement<HTMLButtonElement>(container, '[data-summary-retry]'),
    summaryStars: requiredElement(container, '[data-summary-stars]'),
    summaryActivity: requiredElement(container, '[data-summary-activity]'),
    summaryLastPush: requiredElement(container, '[data-summary-last-push]'),
    infoButton: requiredElement<HTMLButtonElement>(container, '.lens-info'),
    popover: requiredElement(container, '.lens-popover'),
    closeButton: requiredElement<HTMLButtonElement>(container, '.lens-close'),
    detailLoading: requiredElement(container, '.lens-detail-loading'),
    detailError: requiredElement(container, '.lens-detail-error'),
    detailErrorMessage: requiredElement(container, '[data-detail-error-message]'),
    detailRetry: requiredElement<HTMLButtonElement>(container, '[data-detail-retry]'),
    detailContent: requiredElement(container, '.lens-detail-content'),
    fullName: requiredElement(container, '[data-full-name]'),
    description: requiredElement(container, '[data-description]'),
    activity: requiredElement(container, '[data-activity]'),
    activityDetail: requiredElement(container, '[data-activity-detail]'),
    stars: requiredElement(container, '[data-stars]'),
    openIssues: requiredElement(container, '[data-open-issues]'),
    openIssueDate: requiredElement(container, '[data-opened-at]'),
    closedIssues: requiredElement(container, '[data-closed-issues]'),
    closedIssueDate: requiredElement(container, '[data-closed-at]'),
    contributors: requiredElement(container, '[data-contributors]'),
    facts: requiredElement(container, '[data-facts]'),
    topics: requiredElement(container, '[data-topics]'),
    warning: requiredElement(container, '[data-warning]'),
    freshness: requiredElement(container, '[data-freshness]'),
    rateLimit: requiredElement(container, '[data-rate-limit]'),
    repositoryLink: requiredElement<HTMLAnchorElement>(container, '[data-repository-link]'),
  };
}

function renderSummary(
  elements: CompanionElements,
  repository: RepositorySummary,
  inlineFields: readonly InlineSummaryField[],
): void {
  const summary = formatInlineSummary(repository);
  elements.summaryStars.textContent = summary.stars;
  elements.summaryStars.title = repository.stars == null
    ? 'Stars unavailable'
    : `${repository.stars.toLocaleString()} stars`;
  elements.summaryActivity.textContent = summary.activityIcon;
  elements.summaryActivity.dataset.level = summary.activity.level;
  elements.summaryActivity.title = summary.activityLabel;
  elements.summaryLastPush.textContent = summary.lastPush;
  elements.summaryLastPush.title = summary.lastPushLabel;
  const selected = new Set(inlineFields);
  const labels = [
    repository.fullName,
    selected.has('stars') ? summary.starsLabel : '',
    selected.has('activity') ? summary.activity.label : '',
    selected.has('lastPush') ? summary.lastPushLabel : '',
    formatPreviewFreshness(repository.fetchedAt),
  ].filter(Boolean);
  elements.summaryState.setAttribute('aria-label', labels.join(', '));
  elements.root.title = repository.warnings.join(' ');
}

function applyInlineFieldVisibility(
  elements: CompanionElements,
  inlineFields: readonly InlineSummaryField[],
): void {
  const selected = new Set(inlineFields);
  elements.summaryState.hidden = selected.size === 0;
  elements.summaryStars.hidden = !selected.has('stars');
  elements.summaryActivity.hidden = !selected.has('activity');
  elements.summaryLastPush.hidden = !selected.has('lastPush');
}

function correctCompanionLayout(anchor: HTMLAnchorElement, elements: CompanionElements): void {
  window.requestAnimationFrame(() => {
    if (!anchor.isConnected || !elements.host.isConnected) return;
    if (
      getCompanionDomPosition(
        anchor.getBoundingClientRect(),
        elements.host.getBoundingClientRect(),
      ) !== 'before'
    ) return;

    const counterTransform = findCounterTransform(anchor);
    anchor.before(elements.host);
    if (!counterTransform) return;
    elements.root.style.transform = counterTransform;
    elements.root.style.transformOrigin = 'center';
  });
}

function applyCompanionPresentation(
  anchor: HTMLAnchorElement,
  elements: CompanionElements,
): void {
  const parent = anchor.parentElement;
  const presentation = getCompanionPresentation({
    anchorDisplay: getComputedStyle(anchor).display,
    anchorWidth: anchor.getBoundingClientRect().width,
    parentWidth: parent?.getBoundingClientRect().width ?? 0,
    inHeading: Boolean(anchor.closest('h1, h2, h3')),
  });
  elements.root.dataset.presentation = presentation;
  if (presentation === 'stacked') {
    elements.host.style.setProperty('display', 'block', 'important');
  }
}

function findCounterTransform(anchor: HTMLAnchorElement): string | null {
  const candidates = [anchor, ...anchor.querySelectorAll<HTMLElement>('*')];
  for (const element of candidates) {
    const transform = normalizeCounterTransform(getComputedStyle(element).transform);
    if (transform) return transform;
  }
  return null;
}

function isRefreshMessage(message: unknown): message is { type: 'refresh-previews' } {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'refresh-previews';
}

function renderRepository(elements: CompanionElements, repository: RepositoryPreview): void {
  const activity = getActivitySignal(repository.pushedAt, { archived: repository.archived, disabled: repository.disabled });
  elements.fullName.textContent = repository.fullName;
  elements.description.textContent = repository.description || 'No repository description.';
  elements.description.dataset.empty = repository.description ? 'false' : 'true';
  elements.activity.textContent = activity.label;
  elements.activity.dataset.level = activity.level;
  elements.activity.title = activity.detail;
  elements.activityDetail.textContent = `${activity.detail} · last push ${formatRelativeDate(repository.pushedAt)}`;
  elements.stars.textContent = formatCompactNumber(repository.stars);
  elements.stars.title = repository.stars.toLocaleString();
  elements.openIssues.textContent = formatCompactNumber(repository.openIssues);
  elements.closedIssues.textContent = formatCompactNumber(repository.closedIssues);
  renderIssueDate(elements.openIssueDate, 'opened', repository.latestOpenIssueAt, repository.openIssues);
  renderIssueDate(elements.closedIssueDate, 'closed', repository.latestClosedIssueAt, repository.closedIssues);
  elements.contributors.textContent = formatCompactNumber(repository.contributors);
  elements.facts.replaceChildren(...buildFacts(repository).map((fact) => createChip(fact.label, fact.tone)));
  elements.topics.replaceChildren(...repository.topics.slice(0, 3).map((topic) => createChip(topic, 'topic')));
  elements.topics.hidden = repository.topics.length === 0;
  elements.warning.hidden = repository.warnings.length === 0;
  elements.warning.textContent = repository.warnings.join(' ');
  elements.freshness.textContent = formatPreviewFreshness(repository.fetchedAt);
  elements.freshness.title = `Data fetched ${new Date(repository.fetchedAt).toLocaleString()}`;
  elements.rateLimit.textContent = formatRateLimit(repository);
  elements.rateLimit.hidden = elements.rateLimit.textContent.length === 0;
  elements.repositoryLink.href = repository.url;
  elements.repositoryLink.setAttribute('aria-label', `Open ${repository.fullName} on GitHub`);
  elements.popover.setAttribute('aria-label', `${repository.fullName} repository preview`);
}

function renderIssueDate(element: HTMLElement, action: 'opened' | 'closed', value: string | null, count: number | null): void {
  element.textContent = formatIssueDate(value, count);
  element.title = value ? `Latest issue ${action} ${new Date(value).toLocaleString()}` : count === 0 ? `No ${action === 'opened' ? 'open' : 'closed'} issues` : `Latest ${action} issue date unavailable`;
}

function buildFacts(repository: RepositoryPreview): Array<{ label: string; tone: string }> {
  const facts: Array<{ label: string; tone: string }> = [];
  if (repository.language) facts.push({ label: repository.language, tone: 'language' });
  if (repository.license) facts.push({ label: repository.license, tone: 'neutral' });
  facts.push({ label: `${formatCompactNumber(repository.forks)} forks`, tone: 'neutral' });
  if (repository.fork) facts.push({ label: 'Fork', tone: 'notice' });
  if (repository.template) facts.push({ label: 'Template', tone: 'notice' });
  if (!repository.hasIssues) facts.push({ label: 'Issues off', tone: 'notice' });
  if (repository.watchers > 0) facts.push({ label: `${formatCompactNumber(repository.watchers)} watching`, tone: 'neutral' });
  return facts.slice(0, 4);
}

function createChip(label: string, tone: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'fact-chip';
  chip.dataset.tone = tone;
  chip.textContent = label;
  return chip;
}

function formatRateLimit(repository: RepositoryPreview): string {
  const search = repository.rateLimit.searchRemaining;
  return search != null && search <= 3 ? `${search} searches left` : '';
}

function showSummaryState(elements: CompanionElements, state: 'loading' | 'error' | 'content'): void {
  elements.summaryLoading.hidden = state !== 'loading';
  elements.summaryError.hidden = state !== 'error';
  elements.summaryContent.hidden = state !== 'content';
  elements.root.dataset.summaryState = state;
}

function showDetailState(elements: CompanionElements, state: 'loading' | 'error' | 'content'): void {
  elements.detailLoading.hidden = state !== 'loading';
  elements.detailError.hidden = state !== 'error';
  elements.detailContent.hidden = state !== 'content';
  elements.popover.dataset.state = state;
}

function positionPopover(popover: HTMLElement, trigger: HTMLElement): void {
  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const width = popoverRect.width || 360;
  const height = popoverRect.height || 320;
  const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - width - VIEWPORT_GUTTER);
  const left = Math.min(Math.max(triggerRect.right - width, VIEWPORT_GUTTER), maxLeft);
  let top = triggerRect.bottom + POPOVER_GAP;
  if (top + height > window.innerHeight - VIEWPORT_GUTTER) top = triggerRect.top - height - POPOVER_GAP;
  top = Math.max(VIEWPORT_GUTTER, top);
  popover.style.left = `${Math.round(left)}px`;
  popover.style.top = `${Math.round(top)}px`;
  popover.dataset.placement = top < triggerRect.top ? 'top' : 'bottom';
}

async function sendMessage<T>(message: object): Promise<ExtensionResponse<T>> {
  try {
    return (await browser.runtime.sendMessage(message)) as ExtensionResponse<T>;
  } catch {
    return { ok: false, error: { code: 'network', message: 'RepoAura could not reach its background service.' } };
  }
}

function requiredElement<T extends HTMLElement = HTMLElement>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing preview element: ${selector}`);
  return element;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}
