import './style.css';

import type {
  ExtensionResponse,
  GitHubLensSettings,
  PublicGitHubLensSettings,
} from '@/lib/contracts';
import {
  normalizeInlineFields,
  type InlineSummaryField,
} from '@/lib/inline-settings';
import { isSiteAllowed, normalizeSiteList } from '@/lib/site-policy';
import {
  ALL_PAGE_ORIGINS,
  sitePermissionPatterns,
  type PageAccessMode,
} from '@/lib/page-access';
import {
  archivePermissionPattern,
  normalizeArchiveEndpoint,
  type RepositoryArchiveSettings,
  type RepositoryArchiveState,
} from '@/lib/archive';

interface ActiveSite {
  tabId: number;
  hostname: string;
  url: string;
}

const ARCHIVE_PERMISSION_TIMEOUT_MS = 15_000;

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing popup root.');

app.innerHTML = `
  <header class="app-header">
    <div class="app-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M8.4 15.6 5.8 18.2a3.4 3.4 0 0 1-4.8-4.8l3.2-3.2A3.4 3.4 0 0 1 9 10" />
        <path d="m15.6 8.4 2.6-2.6A3.4 3.4 0 0 1 23 10.6l-3.2 3.2A3.4 3.4 0 0 1 15 14" />
        <path d="m8.5 15.5 7-7" />
      </svg>
    </div>
    <div>
      <h1>RepoAura</h1>
      <p>Repository signal, without the detour.</p>
    </div>
  </header>

  <form id="settings-form">
    <section class="settings-group" aria-labelledby="preview-heading">
      <div class="setting-row">
        <div>
          <h2 id="preview-heading">Link previews</h2>
          <p>Adds a compact summary beside eligible repository links.</p>
        </div>
        <label class="switch">
          <input id="enabled" type="checkbox" />
          <span aria-hidden="true"></span>
          <span class="sr-only">Enable link previews</span>
        </label>
      </div>
    </section>

    <section class="inline-section" aria-labelledby="inline-heading">
      <div class="section-heading">
        <div>
          <h2 id="inline-heading">Inline summary</h2>
          <p>Choose the signals shown beside repository links.</p>
        </div>
      </div>
      <div class="inline-options">
        <label><input id="inline-stars" type="checkbox" /><span>★ Stars</span></label>
        <label><input id="inline-activity" type="checkbox" /><span>Activity</span></label>
        <label><input id="inline-last-push" type="checkbox" /><span>Last push</span></label>
      </div>
      <p class="site-note">The info button remains available even when every signal is hidden.</p>
    </section>

    <section class="site-section" aria-labelledby="sites-heading">
      <div class="section-heading">
        <div>
          <h2 id="sites-heading">Page access</h2>
          <p>Choose where RepoAura is allowed to read repository links.</p>
        </div>
      </div>
      <label class="site-field">
        <span>Run on</span>
        <select id="page-access-mode">
          <option value="unconfigured">Choose access…</option>
          <option value="all-sites">All websites</option>
          <option value="selected-sites">Selected websites</option>
        </select>
      </label>
      <label class="site-field">
        <span>Selected sites</span>
        <textarea id="included-sites" rows="2" spellcheck="false" placeholder="example.com"></textarea>
      </label>
      <label class="site-field">
        <span>Never on</span>
        <textarea id="excluded-sites" rows="2" spellcheck="false" placeholder="example.com"></textarea>
      </label>
      <p class="site-note">Chrome asks before RepoAura can read a site. “Never on” always wins.</p>
      <button id="enable-current-site" class="secondary-button site-action" type="button" hidden>
        Enable on this site
      </button>
      <button id="exclude-current-site" class="secondary-button site-action" type="button" hidden>
        Never on this site
      </button>
    </section>

    <section class="token-section" aria-labelledby="token-heading">
      <div class="section-heading">
        <div>
          <h2 id="token-heading">GitHub token</h2>
          <p>Optional. Raises API limits and can preview repos you can access.</p>
        </div>
        <span id="token-state" class="token-state">Not set</span>
      </div>

      <div class="token-field">
        <input
          id="token"
          name="token"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="github_pat_…"
          aria-label="GitHub personal access token"
        />
        <button id="reveal-token" class="icon-button" type="button" aria-label="Show token">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5Z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        </button>
      </div>
      <p class="privacy-note">
        Stored only in this Chrome profile and sent only to <span>api.github.com</span>.
      </p>
    </section>

    <section class="archive-section" aria-labelledby="archive-heading">
      <div class="section-heading">
        <div>
          <h2 id="archive-heading">PocketBase archive</h2>
          <p>Optional. Send selected data to a PocketBase server you control.</p>
        </div>
      </div>
      <div class="archive-body">
        <div class="inline-options archive-options">
          <label><input id="archive-snapshots-enabled" type="checkbox" /><span>Repository snapshots</span></label>
          <label><input id="archive-encounters-enabled" type="checkbox" /><span>Private encounter history</span></label>
        </div>
        <label class="archive-field">
          <span>Server origin</span>
          <input id="archive-endpoint" type="url" spellcheck="false" placeholder="https://archive.example.com" />
        </label>
        <div class="archive-meta">
          <span id="archive-state" class="archive-state">Off</span>
          <span>Queued data retries automatically</span>
        </div>
        <p class="site-note">Encounter history includes the full page URL and title. Site exclusions apply.</p>
        <div class="archive-actions">
          <button id="test-archive" class="secondary-button" type="button">Test connection</button>
          <button id="open-archive" class="secondary-button" type="button">Open archive</button>
        </div>
      </div>
    </section>

    <p class="cache-note">Cached for 24 hours. Refresh now checks GitHub again.</p>
    <div class="actions">
      <button id="refresh-page" class="secondary-button" type="button">↻ Refresh now</button>
      <button id="save" class="primary-button" type="submit">Save changes</button>
    </div>
    <p id="status" class="status" role="status" aria-live="polite"></p>
  </form>
`;

const form = requiredElement<HTMLFormElement>('#settings-form');
const enabledInput = requiredElement<HTMLInputElement>('#enabled');
const pageAccessModeInput = requiredElement<HTMLSelectElement>('#page-access-mode');
const includedSitesInput = requiredElement<HTMLTextAreaElement>('#included-sites');
const excludedSitesInput = requiredElement<HTMLTextAreaElement>('#excluded-sites');
const inlineStarsInput = requiredElement<HTMLInputElement>('#inline-stars');
const inlineActivityInput = requiredElement<HTMLInputElement>('#inline-activity');
const inlineLastPushInput = requiredElement<HTMLInputElement>('#inline-last-push');
const tokenInput = requiredElement<HTMLInputElement>('#token');
const tokenState = requiredElement<HTMLElement>('#token-state');
const revealButton = requiredElement<HTMLButtonElement>('#reveal-token');
const enableCurrentSiteButton = requiredElement<HTMLButtonElement>('#enable-current-site');
const excludeCurrentSiteButton = requiredElement<HTMLButtonElement>('#exclude-current-site');
const refreshPageButton = requiredElement<HTMLButtonElement>('#refresh-page');
const archiveSnapshotsInput = requiredElement<HTMLInputElement>('#archive-snapshots-enabled');
const archiveEncountersInput = requiredElement<HTMLInputElement>('#archive-encounters-enabled');
const archiveEndpointInput = requiredElement<HTMLInputElement>('#archive-endpoint');
const archiveState = requiredElement<HTMLElement>('#archive-state');
const testArchiveButton = requiredElement<HTMLButtonElement>('#test-archive');
const openArchiveButton = requiredElement<HTMLButtonElement>('#open-archive');
const saveButton = requiredElement<HTMLButtonElement>('#save');
const status = requiredElement<HTMLElement>('#status');
let activeSite: ActiveSite | null = null;

void initialize();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveSettings();
});

revealButton.addEventListener('click', () => {
  const reveal = tokenInput.type === 'password';
  tokenInput.type = reveal ? 'text' : 'password';
  revealButton.setAttribute('aria-label', reveal ? 'Hide token' : 'Show token');
  revealButton.dataset.active = String(reveal);
  tokenInput.focus();
});

excludeCurrentSiteButton.addEventListener('click', async () => {
  if (!activeSite) return;
  excludedSitesInput.value = normalizeSiteList([
    ...parseSiteField(excludedSitesInput.value),
    activeSite.hostname,
  ]).join('\n');
  await saveSettings(`Excluded ${activeSite.hostname}.`);
});

enableCurrentSiteButton.addEventListener('click', async () => {
  if (!activeSite) return;
  const origins = sitePermissionPatterns(activeSite.hostname);
  if (!await requestPageAccess(origins)) return;
  pageAccessModeInput.value = 'selected-sites';
  includedSitesInput.value = normalizeSiteList([
    ...parseSiteField(includedSitesInput.value),
    activeSite.hostname,
  ]).join('\n');
  await saveSettings(`Enabled on ${activeSite.hostname}.`);
  await browser.tabs.reload(activeSite.tabId);
});

pageAccessModeInput.addEventListener('change', updatePageAccessControls);

refreshPageButton.addEventListener('click', async () => {
  setBusy(true);
  setStatus('Refreshing…');
  const response = await sendMessage({ type: 'clear-cache' });
  if (!response.ok) {
    setBusy(false);
    setStatus(response.error.message, 'error');
    return;
  }
  const refreshed = await refreshActiveTab();
  setBusy(false);
  setStatus(refreshed ? 'Refreshed this page.' : 'Cache cleared.', 'success');
});

archiveSnapshotsInput.addEventListener('change', updateArchiveControls);
archiveEncountersInput.addEventListener('change', updateArchiveControls);
archiveEndpointInput.addEventListener('input', updateArchiveControls);

testArchiveButton.addEventListener('click', async () => {
  setBusy(true);
  const saved = await saveArchiveSettings();
  if (!saved.ok) {
    setBusy(false);
    setStatus(saved.error.message, 'error');
    return;
  }
  setStatus('Checking archive…');
  const tested = await sendMessage<RepositoryArchiveState>({ type: 'test-archive' });
  setBusy(false);
  if (!tested.ok) {
    setStatus(tested.error.message, 'error');
    return;
  }
  setArchiveState(tested.data);
  setStatus('PocketBase is reachable.', 'success');
});

openArchiveButton.addEventListener('click', async () => {
  const endpoint = normalizeArchiveEndpoint(archiveEndpointInput.value);
  if (!endpoint) return;
  await browser.tabs.create({ url: `${endpoint}/_/` });
});

async function initialize(): Promise<void> {
  activeSite = await getActiveSite();
  await Promise.all([loadSettings(), loadArchiveSettings()]);
  updateSiteButtons();
}

async function loadArchiveSettings(): Promise<void> {
  const response = await sendMessage<RepositoryArchiveState>({ type: 'get-archive-settings' });
  if (!response.ok) {
    setStatus(response.error.message, 'error');
    return;
  }
  archiveSnapshotsInput.checked = response.data.snapshotsEnabled;
  archiveEncountersInput.checked = response.data.encountersEnabled;
  archiveEndpointInput.value = response.data.endpoint;
  setArchiveState(response.data);
  updateArchiveControls();
}

async function loadSettings(): Promise<void> {
  const response = await sendMessage<PublicGitHubLensSettings>({ type: 'get-settings' });
  if (!response.ok) {
    setStatus(response.error.message, 'error');
    return;
  }

  enabledInput.checked = response.data.enabled;
  pageAccessModeInput.value = response.data.pageAccessMode;
  includedSitesInput.value = response.data.includedSites.join('\n');
  excludedSitesInput.value = response.data.excludedSites.join('\n');
  setInlineFields(response.data.inlineFields);
  tokenInput.value = response.data.token ?? '';
  updateTokenState(response.data.hasToken);
  updatePageAccessControls();
}

async function saveSettings(successMessage?: string): Promise<void> {
  setBusy(true);
  setStatus('Saving…');

  const pageAccessMode = pageAccessModeInput.value as PageAccessMode;
  const origins = pageAccessMode === 'all-sites'
    ? [...ALL_PAGE_ORIGINS]
    : parseSiteField(includedSitesInput.value).flatMap(sitePermissionPatterns);
  if (pageAccessMode !== 'unconfigured' && !await requestPageAccess(origins)) {
    setBusy(false);
    return;
  }

  const archiveResponse = await saveArchiveSettings();
  if (!archiveResponse.ok) {
    setBusy(false);
    setStatus(archiveResponse.error.message, 'error');
    return;
  }

  const settings: GitHubLensSettings = {
    enabled: enabledInput.checked,
    token: tokenInput.value.trim(),
    pageAccessMode,
    includedSites: parseSiteField(includedSitesInput.value),
    excludedSites: parseSiteField(excludedSitesInput.value),
    inlineFields: selectedInlineFields(),
  };
  const response = await sendMessage<PublicGitHubLensSettings>({
    type: 'save-settings',
    settings,
  });

  if (!response.ok) {
    setBusy(false);
    setStatus(response.error.message, 'error');
    return;
  }

  enabledInput.checked = response.data.enabled;
  pageAccessModeInput.value = response.data.pageAccessMode;
  includedSitesInput.value = response.data.includedSites.join('\n');
  excludedSitesInput.value = response.data.excludedSites.join('\n');
  setInlineFields(response.data.inlineFields);
  updateTokenState(response.data.hasToken);
  setArchiveState(archiveResponse.data);
  setBusy(false);
  updateSiteButtons();
  setStatus(successMessage ?? 'Saved.', 'success');
}

async function saveArchiveSettings(): Promise<ExtensionResponse<RepositoryArchiveState>> {
  const endpoint = normalizeArchiveEndpoint(archiveEndpointInput.value);
  const settings: RepositoryArchiveSettings = {
    snapshotsEnabled: archiveSnapshotsInput.checked,
    encountersEnabled: archiveEncountersInput.checked,
    endpoint,
  };
  const response = await sendMessage<RepositoryArchiveState>({
    type: 'save-archive-settings',
    settings,
  });
  if (response.ok) {
    archiveEndpointInput.value = response.data.endpoint;
    archiveSnapshotsInput.checked = response.data.snapshotsEnabled;
    archiveEncountersInput.checked = response.data.encountersEnabled;
    setArchiveState(response.data);
    updateArchiveControls();
  }
  if (
    !response.ok
    || (!response.data.snapshotsEnabled && !response.data.encountersEnabled)
    || response.data.accessGranted
  ) return response;

  setStatus('Waiting for Chrome’s access prompt…');
  if (!await ensureArchivePermission(endpoint)) {
    return {
      ok: false,
      error: {
        code: 'forbidden',
        message: 'Archive enabled, but Chrome did not grant access. Approve its prompt, then try again.',
      },
    };
  }
  const refreshed = await sendMessage<RepositoryArchiveState>({ type: 'get-archive-settings' });
  if (refreshed.ok) setArchiveState(refreshed.data);
  return refreshed;
}

async function ensureArchivePermission(endpoint: string): Promise<boolean> {
  const origin = archivePermissionPattern(endpoint);
  if (!origin) return false;
  let timeout: number | undefined;
  try {
    const permissionRequest = browser.permissions.request({ origins: [origin] });
    return await Promise.race([
      permissionRequest,
      new Promise<boolean>((resolve) => {
        timeout = window.setTimeout(() => resolve(false), ARCHIVE_PERMISSION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function setArchiveState(state: RepositoryArchiveState): void {
  const enabled = state.snapshotsEnabled || state.encountersEnabled;
  archiveState.dataset.active = String(enabled);
  if (!enabled) {
    archiveState.textContent = 'Off';
  } else if (!state.accessGranted) {
    archiveState.textContent = 'Needs access';
  } else if (state.queued > 0) {
    archiveState.textContent = `${state.queued} queued`;
  } else if (state.lastSuccessAt) {
    archiveState.textContent = 'Connected';
  } else {
    archiveState.textContent = 'Ready';
  }
  archiveState.title = enabled && !state.accessGranted
    ? 'Chrome host access is required.'
    : state.lastError ?? '';
}

function updateArchiveControls(): void {
  const enabled = archiveSnapshotsInput.checked || archiveEncountersInput.checked;
  archiveEndpointInput.disabled = saveButton.disabled;
  testArchiveButton.disabled = saveButton.disabled || !enabled;
  openArchiveButton.disabled = saveButton.disabled
    || normalizeArchiveEndpoint(archiveEndpointInput.value).length === 0;
}

function selectedInlineFields(): InlineSummaryField[] {
  return normalizeInlineFields([
    ...(inlineStarsInput.checked ? ['stars'] : []),
    ...(inlineActivityInput.checked ? ['activity'] : []),
    ...(inlineLastPushInput.checked ? ['lastPush'] : []),
  ]);
}

function setInlineFields(value: unknown): void {
  const selected = new Set(normalizeInlineFields(value));
  inlineStarsInput.checked = selected.has('stars');
  inlineActivityInput.checked = selected.has('activity');
  inlineLastPushInput.checked = selected.has('lastPush');
}

async function getActiveSite(): Promise<ActiveSite | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null || !tab.url) return null;
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return { tabId: tab.id, hostname: url.hostname.toLowerCase(), url: url.href };
  } catch {
    return null;
  }
}

function updateSiteButtons(): void {
  if (!activeSite) {
    enableCurrentSiteButton.hidden = true;
    excludeCurrentSiteButton.hidden = true;
    return;
  }
  enableCurrentSiteButton.hidden = false;
  excludeCurrentSiteButton.hidden = false;
  const excluded = !isSiteAllowed(activeSite.url, [], parseSiteField(excludedSitesInput.value));
  excludeCurrentSiteButton.disabled = excluded;
  excludeCurrentSiteButton.textContent = excluded
    ? `${activeSite.hostname} is excluded`
    : `Never on ${activeSite.hostname}`;
}

function updatePageAccessControls(): void {
  includedSitesInput.disabled = saveButton.disabled
    || pageAccessModeInput.value !== 'selected-sites';
}

async function requestPageAccess(origins: string[]): Promise<boolean> {
  if (origins.length === 0) return true;
  try {
    const granted = await browser.permissions.request({ origins });
    if (!granted) setStatus('Chrome did not grant page access.', 'error');
    return granted;
  } catch {
    setStatus('Chrome could not grant page access.', 'error');
    return false;
  }
}

async function refreshActiveTab(): Promise<boolean> {
  if (!activeSite) return false;
  try {
    await browser.tabs.sendMessage(activeSite.tabId, { type: 'refresh-previews' });
    return true;
  } catch {
    return false;
  }
}

function updateTokenState(hasToken: boolean): void {
  tokenState.textContent = hasToken ? 'Protected' : 'Not set';
  tokenState.dataset.active = String(hasToken);
}

function setBusy(busy: boolean): void {
  saveButton.disabled = busy;
  enabledInput.disabled = busy;
  pageAccessModeInput.disabled = busy;
  includedSitesInput.disabled = busy || pageAccessModeInput.value !== 'selected-sites';
  excludedSitesInput.disabled = busy;
  inlineStarsInput.disabled = busy;
  inlineActivityInput.disabled = busy;
  inlineLastPushInput.disabled = busy;
  tokenInput.disabled = busy;
  archiveSnapshotsInput.disabled = busy;
  archiveEncountersInput.disabled = busy;
  archiveEndpointInput.disabled = busy;
  testArchiveButton.disabled = busy
    || (!archiveSnapshotsInput.checked && !archiveEncountersInput.checked);
  openArchiveButton.disabled = busy || normalizeArchiveEndpoint(archiveEndpointInput.value).length === 0;
  refreshPageButton.disabled = busy;
  enableCurrentSiteButton.disabled = busy;
  excludeCurrentSiteButton.disabled = busy || (
    activeSite !== null
    && !isSiteAllowed(activeSite.url, [], parseSiteField(excludedSitesInput.value))
  );
}

function parseSiteField(value: string): string[] {
  return normalizeSiteList(value.split(/[\n,]+/));
}

function setStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'neutral'): void {
  status.textContent = message;
  status.dataset.tone = tone;
}

async function sendMessage<T = undefined>(message: object): Promise<ExtensionResponse<T>> {
  try {
    return (await browser.runtime.sendMessage(message)) as ExtensionResponse<T>;
  } catch {
    return {
      ok: false,
      error: { code: 'network', message: 'Could not reach the RepoAura background service.' },
    };
  }
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popup element: ${selector}`);
  return element;
}
