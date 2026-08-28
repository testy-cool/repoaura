import './style.css';

import type {
  ExtensionResponse,
  GitHubLensSettings,
  PublicGitHubLensSettings,
} from '@/lib/contracts';
import { ALL_PAGE_ORIGINS, type PageAccessMode } from '@/lib/page-access';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing onboarding root.');

app.innerHTML = `
  <section class="welcome-card">
    <span class="eyebrow">RepoAura</span>
    <h1>See repository health where you discover it.</h1>
    <p class="lead">RepoAura adds a quiet stars, activity, and last-push summary beside eligible GitHub repository links.</p>
    <div class="choices">
      <button id="enable-everywhere" type="button">
        <strong>Enable on all websites</strong>
        <span>Chrome will ask for page access once.</span>
      </button>
      <button id="choose-sites" class="secondary" type="button">
        <strong>Choose sites as I browse</strong>
        <span>Use the toolbar button on each site you approve.</span>
      </button>
    </div>
    <p class="privacy">Page access only detects eligible GitHub links. Private encounter history and PocketBase export stay off unless you enable them separately.</p>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
`;

const everywhereButton = requiredElement<HTMLButtonElement>('#enable-everywhere');
const selectedButton = requiredElement<HTMLButtonElement>('#choose-sites');
const status = requiredElement<HTMLElement>('#status');

everywhereButton.addEventListener('click', async () => {
  setBusy(true);
  const granted = await browser.permissions.request({ origins: [...ALL_PAGE_ORIGINS] });
  if (!granted) {
    setBusy(false);
    status.textContent = 'Chrome did not grant page access. You can choose individual sites instead.';
    return;
  }
  await saveMode('all-sites');
});

selectedButton.addEventListener('click', async () => {
  setBusy(true);
  await saveMode('selected-sites');
});

async function saveMode(pageAccessMode: PageAccessMode): Promise<void> {
  const current = await sendMessage<PublicGitHubLensSettings>({ type: 'get-settings' });
  if (!current.ok) {
    setBusy(false);
    status.textContent = current.error.message;
    return;
  }
  const settings: GitHubLensSettings = {
    enabled: current.data.enabled,
    token: current.data.token ?? '',
    pageAccessMode,
    includedSites: current.data.includedSites,
    excludedSites: current.data.excludedSites,
    inlineFields: current.data.inlineFields,
  };
  const saved = await sendMessage({ type: 'save-settings', settings });
  if (!saved.ok) {
    setBusy(false);
    status.textContent = saved.error.message;
    return;
  }
  status.textContent = pageAccessMode === 'all-sites'
    ? 'RepoAura is ready. You may close this tab.'
    : 'Ready. Open a website and use the RepoAura toolbar button to enable it.';
}

function setBusy(busy: boolean): void {
  everywhereButton.disabled = busy;
  selectedButton.disabled = busy;
}

async function sendMessage<T = undefined>(message: object): Promise<ExtensionResponse<T>> {
  try {
    return await browser.runtime.sendMessage(message) as ExtensionResponse<T>;
  } catch {
    return {
      ok: false,
      error: { code: 'network', message: 'Could not reach the RepoAura background service.' },
    };
  }
}

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing onboarding element: ${selector}`);
  return element;
}
