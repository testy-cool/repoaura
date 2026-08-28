# RepoAura

RepoAura adds a quiet repository-health summary beside GitHub repository links, without making you leave the page. The default inline view shows stars, activity, and last push. Click the adjacent info button for issues, contributors, language, license, topics, and other details; hover and focus never open the card.

## What it recognizes

- Exact repository-root links such as `https://github.com/owner/repo`.
- Readable links on sites you explicitly allow.
- Links inside rendered `.markdown-body` prose on GitHub, except a repository linking to itself.

RepoAura ignores image-only links, URL fragments, files, folders, issues, pull requests, commits, releases, and every link under `github.com/topics`.

Repository status uses the last push date:

- **Active:** pushed within 30 days.
- **Quiet:** no push in the last 30 days.
- **Dormant:** no push in the last six months.
- **Archived / Unavailable:** GitHub reports the repository as archived or disabled.

## Install

Download `repoaura-1.0.0-chrome.zip` from the latest GitHub release and unzip it. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the unzipped folder.

On first run, choose either all-site access or selected-site access. Chrome grants page access, not RepoAura itself. In selected-site mode, open the toolbar popup and choose **Enable on this site**. A separate **Never on this site** control always wins.

The popup also lets you:

- choose which inline signals appear;
- add an optional read-only GitHub token for higher limits and accessible private repositories;
- clear the 24-hour repository cache and refresh the current page;
- independently enable repository snapshots or private encounter history in PocketBase.

## Data behavior

Automatic summaries use GitHub repository metadata only. Issue searches and contributor requests begin only after the info button is clicked. Issue searches use `is:issue`, so pull requests are excluded. Partial API failures keep usable repository data visible with a warning.

Repository responses are cached locally for 24 hours (degraded responses for five minutes), coalesced across identical requests, and capped at 100 repositories. **Refresh now** deliberately clears that cache before reloading the page.

RepoAura has no vendor analytics. See [PRIVACY.md](PRIVACY.md) for the complete permission and data-flow contract.

## Optional PocketBase archive

PocketBase is optional and off by default. Repository snapshots and private encounter history have separate switches. Encounter history records one event per repository per page visit, including the source page origin and path (query and fragment removed), title, link text, and whether the repository was linked or visited directly.

The extension never receives a PocketBase superuser credential. It has create-only access to the two archive collections; browsing and administration remain superuser-only. Archive writes use persisted retry queues and never block a usable preview.

For an agent-operated installation, give the buyer's agent [the included setup skill](skills/setup-repoaura-pocketbase/SKILL.md). The reusable migrations and service template live under [`ops/pocketbase/`](ops/pocketbase/).

## Development

Requires Node.js 22.

```bash
npm ci
npm run check
npm run dev
```

Useful commands:

```bash
npm run compile  # TypeScript
npm test         # contract suite
npm run build    # .build/chrome-mv3
npm run zip      # .build/repoaura-1.0.0-chrome.zip
```

For behavior changes, load `.build/chrome-mv3` into an isolated Chromium profile and verify the positive and negative contracts in [AGENTS.md](AGENTS.md). Do not build directly into a Chrome-loaded directory.

## License

[MIT](LICENSE)
