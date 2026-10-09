import './style.css';
import { PERSONAL_BUILD } from '@/lib/build';

import type {
  ExtensionResponse,
  GitHubLensSettings,
  PublicGitHubLensSettings,
} from '@/lib/contracts';
import { ALL_PAGE_ORIGINS, sitePermissionPatterns, type PageAccessMode } from '@/lib/page-access';
import { isSiteAllowed, normalizeSiteList } from '@/lib/site-policy';

const EXAMPLE_URL = 'https://github.com/sindresorhus/awesome#platforms';

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing onboarding root.');

app.innerHTML = `
  <section class="welcome-card">
    <span class="eyebrow">RepoAura</span>
    <h1>Find projects worth a closer look.</h1>
    <p class="lead">See stars and recent activity beside the GitHub links you’re already reading.</p>
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
    <div id="try-it" hidden>
      <button id="try-github" type="button">
        <strong>Try it on GitHub</strong>
        <span>Open a list of projects and look for summaries beside the links.</span>
      </button>
      <p id="try-note" class="privacy"></p>
    </div>
    <p class="privacy">${PERSONAL_BUILD
      ? 'Page access only detects eligible GitHub links. Private encounter history and PocketBase export stay off unless you enable them separately.'
      : 'No account or server setup. Repository data is fetched from GitHub and cached in this Chrome profile.'}</p>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
`;

const everywhereButton = requiredElement<HTMLButtonElement>('#enable-everywhere');
const selectedButton = requiredElement<HTMLButtonElement>('#choose-sites');
const status = requiredElement<HTMLElement>('#status');
const tryButton = requiredElement<HTMLButtonElement>('#try-github');
const trySection = requiredElement<HTMLElement>('#try-it');
const tryNote = requiredElement<HTMLElement>('#try-note');
const choices = requiredElement<HTMLElement>('.choices');
let chosenMode: PageAccessMode = 'unconfigured';

everywhereButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    const granted = await browser.permissions.request({ origins: [...ALL_PAGE_ORIGINS] });
    if (!granted) {
      status.textContent = 'Chrome did not grant page access. You can choose individual sites instead.';
      return;
    }
    await saveMode('all-sites');
  } catch {
    status.textContent = 'Chrome could not grant page access. Try choosing sites as you browse.';
  } finally {
    setBusy(false);
  }
});

selectedButton.addEventListener('click', async () => {
  setBusy(true);
  await saveMode('selected-sites');
  setBusy(false);
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
  chosenMode = pageAccessMode;
  choices.hidden = true;
  trySection.hidden = false;
  tryNote.textContent = pageAccessMode === 'all-sites'
    ? 'The example opens in a new tab. Click an info button for repository details.'
    : 'Chrome will ask for access to GitHub only. Other sites stay off until you approve them.';
  status.textContent = 'Ready. Try the example to see RepoAura in action.';
}

tryButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    // Request from the click itself, before awaiting settings, to retain the user gesture.
    if (chosenMode === 'selected-sites') {
      const granted = await browser.permissions.request({ origins: sitePermissionPatterns('github.com') });
      if (!granted) {
        status.textContent = 'Chrome did not grant GitHub access. You can still enable sites from the toolbar.';
        return;
      }
    }
    const current = await sendMessage<PublicGitHubLensSettings>({ type: 'get-settings' });
    if (!current.ok) {
      status.textContent = current.error.message;
      return;
    }
    if (!current.data.enabled || !isSiteAllowed(EXAMPLE_URL, [], current.data.excludedSites)) {
      status.textContent = 'Enable previews and remove any GitHub exclusion in RepoAura settings first.';
      return;
    }
    const settings: GitHubLensSettings = {
      enabled: current.data.enabled,
      token: current.data.token ?? '',
      pageAccessMode: current.data.pageAccessMode,
      includedSites: current.data.pageAccessMode === 'selected-sites'
        ? normalizeSiteList([...current.data.includedSites, 'github.com'])
        : current.data.includedSites,
      excludedSites: current.data.excludedSites,
      inlineFields: current.data.inlineFields,
    };
    const saved = await sendMessage({ type: 'save-settings', settings });
    if (!saved.ok) {
      status.textContent = saved.error.message;
      return;
    }
    await browser.tabs.create({ url: EXAMPLE_URL });
    status.textContent = 'Example opened. Look for stars and activity beside the project links.';
  } catch {
    status.textContent = 'Could not open the example. Try again or enable a site from the toolbar.';
  } finally {
    setBusy(false);
  }
});

function setBusy(busy: boolean): void {
  everywhereButton.disabled = busy;
  selectedButton.disabled = busy;
  tryButton.disabled = busy;
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
