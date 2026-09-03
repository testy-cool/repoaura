# Repository Guidelines

## Product contract

RepoAura is a Chrome Manifest V3 extension built with WXT and plain TypeScript. On approved non-GitHub HTTP(S) pages, readable links to repository roots or repository subpages receive an adjacent inline health summary for the containing repository. On `github.com`, summaries are limited to links inside rendered `.markdown-body` prose and are disabled entirely on `/topics` and descendants. A click on the adjacent info button opens details; hover and focus alone must never open it.

Do not broaden activation to image-only links or GitHub routes that do not identify a repository. Changes to URL or anchor recognition require positive and negative tests.

Keep these meanings separate:

- `pushedAt` drives active, quiet, or dormant status.
- issue `createdAt` and `closedAt` describe issue events.
- `fetchedAt` is observation time and must be labeled `Checked …`, never `Updated …`.

Automatic summaries use repository metadata only. Issue searches begin after an info-button click and retain `is:issue` so pull requests are excluded. Partial failures keep usable repository data visible with warnings.

## Source map

- `entrypoints/content.ts`: discovery, adaptive inline companions, click-only Shadow DOM details, lifecycle, and positioning.
- `entrypoints/background.ts`: GitHub API, settings, runtime page registration, cache, rate limits, and PocketBase queues.
- `entrypoints/popup/`: settings and user-triggered permission requests.
- `entrypoints/onboarding.html` and `pages/onboarding/`: first-run page-access choice.
- `lib/repository.ts`: repository identity, formatting, timestamps, and activity.
- `lib/page-policy.ts`: page and anchor eligibility.
- `lib/page-access.ts`: permission modes and runtime match patterns.
- `lib/contracts.ts`: entrypoint message boundary.
- `styles/content.css`: isolated companion and details styles.
- `ops/pocketbase/`: optional archive migrations and service template.
- `tests/`: pure contracts and build/static checks.

## Commands

Use Node.js 22 and the checked-in lockfile.

```bash
npm ci
npm run compile
npm test
npm run build
npm run check
npm run zip
```

Run `npm run check` before each commit. Add focused tests for URL recognition, permissions, cache keys, formatting, activity thresholds, issue timestamps, archive privacy, and message contracts.

## Implementation rules

- Use two-space indentation, single quotes, semicolons, explicit types at message/API boundaries, and `import type` for type-only imports.
- Keep UI dependency-light and prefer platform/WXT primitives.
- Preserve initial and mutation-driven discovery for dynamic pages.
- Preserve keyboard focus, Escape dismissal, reduced-motion support, and light/dark readability.
- Keep Shadow DOM hosts adjacent to, never nested inside, original anchors.
- Inline typography inherits the page. Details may use their own system stack.
- Keep summary and detail response guards independent.
- Preserve the `githubLensSettingsV1` and repository-cache storage keys unless an explicit migration is included; their legacy names keep existing installations compatible.
- Never log, commit, export, or copy a GitHub token. It may be sent only to `https://api.github.com`.
- PocketBase snapshots and encounter history remain separate, opt-in streams. Disabling a stream clears its unsent queue.
- Do not edit generated `.wxt/`, `.build/`, `.output/`, or `node_modules/` files.

## Live verification

After `npm run check`, load `.build/chrome-mv3` in an isolated Playwright Chromium profile, not a user's normal browser profile. Verify:

1. Visible repository-root and repository-subpage links on a non-GitHub fixture gain inline summaries without hovering; hover and focus do not open details.
2. Clicking the info button opens details with repository identity, activity, issue-date labels, `Checked …` freshness, Escape dismissal, and no clipping.
3. A GitHub README `.markdown-body` link to another repository or its subpage is eligible, a self-repository link is not, and `/topics` has no companions.
4. Fresh installs do not inject before page access is chosen; selected-site mode injects only after Chrome grants that origin.
5. If archive behavior changed, use the real configured PocketBase or closest isolated equivalent and verify health plus one write/readback canary without exposing credentials or private page data.

Save evidence only under an owned temporary path and clean up only the owned profile, process, and artifacts.

## Commits

Keep commits small and effect-oriented. Before committing, inspect recent messages, status, and the staged diff. Report the exact commit hash, message, test result, live-canary result, and any unverified limitation. Do not force-push or amend an already-pushed commit without explicit authorization.
