import type { ExtensionResponse } from './contracts';
import {
  archivePermissionPattern,
  normalizeArchiveEndpoint,
  type RepositoryArchiveSettings,
  type RepositoryArchiveState,
} from './archive';

const ARCHIVE_PERMISSION_TIMEOUT_MS = 15_000;

export const ARCHIVE_SETTINGS_MARKUP = `
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
        <p class="site-note">Encounter history includes the page origin, path, and title. Site exclusions apply.</p>
        <div class="archive-actions">
          <button id="test-archive" class="secondary-button" type="button">Test connection</button>
          <button id="open-archive" class="secondary-button" type="button">Open archive</button>
        </div>
      </div>
    </section>
`;

interface ArchiveControlOptions {
  sendMessage<T = undefined>(message: object): Promise<ExtensionResponse<T>>;
  setStatus(message: string, tone?: 'neutral' | 'success' | 'error'): void;
  setBusy(busy: boolean): void;
}

export interface ArchiveControls {
  load(): Promise<void>;
  save(): Promise<ExtensionResponse<RepositoryArchiveState>>;
  setBusy(busy: boolean): void;
}

export function createArchiveControls(options: ArchiveControlOptions): ArchiveControls {
  const { sendMessage, setStatus, setBusy } = options;
  let busy = false;
  const archiveSnapshotsInput = requiredElement<HTMLInputElement>('#archive-snapshots-enabled');
  const archiveEncountersInput = requiredElement<HTMLInputElement>('#archive-encounters-enabled');
  const archiveEndpointInput = requiredElement<HTMLInputElement>('#archive-endpoint');
  const archiveState = requiredElement<HTMLElement>('#archive-state');
  const testArchiveButton = requiredElement<HTMLButtonElement>('#test-archive');
  const openArchiveButton = requiredElement<HTMLButtonElement>('#open-archive');

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
    archiveEndpointInput.disabled = busy;
    testArchiveButton.disabled = busy || !enabled;
    openArchiveButton.disabled = busy
      || normalizeArchiveEndpoint(archiveEndpointInput.value).length === 0;
  }

  return {
    load: loadArchiveSettings,
    save: saveArchiveSettings,
    setBusy(value: boolean): void {
      busy = value;
      archiveSnapshotsInput.disabled = busy;
      archiveEncountersInput.disabled = busy;
      updateArchiveControls();
    },
  };
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing archive element: ${selector}`);
  return element;
}
