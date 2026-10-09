# RepoAura

[![CI](https://github.com/testy-cool/repoaura/actions/workflows/ci.yml/badge.svg)](https://github.com/testy-cool/repoaura/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/manifest-MV3-brightgreen.svg)](wxt.config.ts)

> Stars and recent activity beside the GitHub links you’re already reading.

RepoAura helps you decide which projects deserve a closer look without opening
every repository in a new tab. It adds a small summary beside readable GitHub
links, wherever you’ve enabled it.

No account, GitHub token, or server setup is required.

Click the info button for the description, issue dates, contributors, language,
license, topics, forks, watchers, and freshness. Hovering and focusing never
open the card. Hover the compact values to read their explicit labels.

## What you get

- **Signals where you need them.** Read stars, activity, and last push beside the
  original link.
- **Useful detail on demand.** API-heavy issue and contributor requests begin
  only after you click the info button.
- **Signal without page takeover.** RepoAura inherits the page typography and
  chooses a compact or stacked layout to fit the surrounding content.
- **Explicit control.** Choose every site, selected sites, or no sites; exclude
  the current site at any time.

## Install

For now, install the public build locally with Node.js 22:

```bash
git clone https://github.com/testy-cool/repoaura.git
cd repoaura
npm ci
npm run build
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select `.build/chrome-mv3`.
3. Choose all-site or selected-site access when RepoAura opens.
4. Choose **Try it on GitHub** to see summaries on a project list. In selected-site
   mode, Chrome asks for GitHub access only.

You can also run `npm run zip` to prepare the public Chrome Web Store package.
A store installation link will be added when the listing is published.

In selected-site mode, open RepoAura on another page and choose **Enable on this
site**. **Never on this site** always wins and provides a quick local override.

## Try it

Open [Awesome](https://github.com/sindresorhus/awesome#platforms), a list of projects,
with GitHub access enabled. Look for stars and activity beside readable repository
links, then click an info button for details.

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
| **◉ Quiet** | No push in the last 30 days |
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
- clear the cache and refresh the current page immediately;
- optionally add a GitHub token under **Advanced** for higher API limits and
  repositories the token can access.

Repository metadata is cached locally for 24 hours, with five-minute caching
for degraded responses. Identical requests are coalesced, and the cache retains
at most 100 repositories. **Refresh now** clears it and reloads summaries on the current page.

The public extension has no browsing-history collection, archive export, or vendor
analytics. An optional GitHub token remains in `chrome.storage.local` and is sent
only to `https://api.github.com`. See [PRIVACY.md](PRIVACY.md) for the complete
permission and data-flow contract.

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

The default build and ZIP are public packages: PocketBase controls, delivery,
encounter collection, and the archive alarm permission are excluded at build time.
`npm run check` also builds and checks the personal variant.

For personal use, run `npm run build:personal` or `npm run zip:personal`.
The unpacked personal extension is `.build/chrome-mv3-personal` and its ZIP is
`.build/repoaura-1.0.0-chrome-personal.zip`. `npm run dev:personal` starts personal
watch mode. The guarded `install:local` command installs this personal variant
at the existing `.output/chrome-mv3` path, preserving the loaded extension's identity;
RepoAura must be disabled in Chrome first; run `npm run install:local -- --extension-disabled`.
Personal archive setup and its separate privacy contract live under
[`ops/pocketbase/`](ops/pocketbase/README.md).

Before changing browser behavior, read [AGENTS.md](AGENTS.md). It defines the
positive and negative link contracts and the isolated-browser verification
procedure.

## Project documents

- [Contributing guidelines](CONTRIBUTING.md)
- [Privacy and data flow](PRIVACY.md)
- [Security policy](SECURITY.md)
- [MIT license](LICENSE)
