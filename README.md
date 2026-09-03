# RepoAura

> Repository health, right beside the GitHub links you are already reading.

RepoAura is a Chrome extension that adds a small health summary to repository
links without making you leave the page. In a live verification run, the
default line answered the useful questions at a glance:

```text
Pydantic AI Harness
  ★ 828  ●  1h  ⓘ
```

Click the info button for the description, issue dates, contributors, language,
license, topics, forks, watchers, and freshness. Hovering and focusing never
open the card. Hover the compact values to read their explicit labels.

## What you get

- **Health where you need it.** Read stars, activity, and last push beside the
  original link.
- **Useful detail on demand.** API-heavy issue and contributor requests begin
  only after you click the info button.
- **Signal without page takeover.** RepoAura inherits the page typography and
  chooses a compact or stacked layout to fit the surrounding content.
- **Explicit control.** Choose every site, selected sites, or no sites; exclude
  the current site at any time.

## Install

1. Download `repoaura-1.0.0-chrome.zip` from the
   [latest release](https://github.com/testy-cool/repoaura/releases/latest).
2. Unzip it.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Choose **Load unpacked** and select the unzipped folder.
5. Choose all-site or selected-site access when RepoAura opens.

In selected-site mode, open RepoAura on a page and choose **Enable on this
site**. **Never on this site** always wins and provides a quick local override.

## Where it appears

| Context | Behavior |
|---|---|
| Allowed non-GitHub page | Adds a summary to readable links anywhere inside a repository |
| GitHub README prose | Adds summaries to other repositories linked inside `.markdown-body` |
| Repository linking to itself | Does nothing |
| `github.com/topics` | Does nothing |
| File, folder, issue, pull request, commit, release, or fragment link | Summarizes the containing repository |
| Image-only link | Does nothing |

RepoAura resolves repository identity from the `owner/repo` prefix, whether a
link points to the repository root or one of its pages. It still rejects GitHub
routes that do not identify a repository.

## Reading repository status

| Status | Meaning |
|---|---|
| **● Active** | Pushed within the last 30 days |
| **◐ Quiet** | No push in the last 30 days |
| **○ Dormant** | No push in the last six months |
| **□ Archived** | GitHub reports the repository as archived |
| **× Unavailable** | GitHub reports the repository as disabled or no push date is available |

Status always comes from the repository's last push. Issue creation and closure
dates remain separate, and RepoAura labels its own observation time as
**Checked**, never **Updated**.

## Settings, caching, and privacy

The popup lets you:

- choose stars, activity, and last push independently;
- grant or revoke site access;
- add an optional read-only GitHub token for higher limits and repositories the
  token can access;
- clear the cache and refresh the current page immediately;
- independently enable PocketBase snapshots or encounter history.

Repository metadata is cached locally for 24 hours, with five-minute caching
for degraded responses. Identical requests are coalesced, and the cache retains
at most 100 repositories. **Refresh now** clears it before reloading the page.

RepoAura has no vendor analytics. A GitHub token remains in
`chrome.storage.local`, is sent only to `https://api.github.com`, and is never
written to the optional archive. See [PRIVACY.md](PRIVACY.md) for the complete
permission and data-flow contract.

## Optional PocketBase history

PocketBase support is off by default. Repository snapshots and private
encounter history use separate switches. Encounter records include the source
page origin and path, page title, link text, and whether the repository was
linked or visited directly; query strings and fragments are removed.

The extension receives create-only collection access, never a PocketBase
superuser credential. Persisted retry queues keep archive failures from blocking
the repository summary.

For an agent-operated installation, provide
[`skills/setup-repoaura-pocketbase/SKILL.md`](skills/setup-repoaura-pocketbase/SKILL.md)
to the buyer's agent. Reusable migrations and the service template live under
[`ops/pocketbase/`](ops/pocketbase/).

## Development

RepoAura requires Node.js 22.

```bash
npm ci
npm run check
npm run dev
```

`npm run check` compiles TypeScript, runs the contract suite, and produces the
Chrome Manifest V3 build under `.build/chrome-mv3`. Use `npm run zip` to create
the release archive.

Before changing browser behavior, read [AGENTS.md](AGENTS.md). It defines the
positive and negative link contracts and the isolated-browser verification
procedure.

## Project documents

- [Privacy and data flow](PRIVACY.md)
- [Security policy](SECURITY.md)
- [PocketBase operations](ops/pocketbase/README.md)
- [MIT license](LICENSE)
