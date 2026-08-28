# RepoAura privacy

RepoAura does not use advertising, telemetry, or vendor analytics.

## Permissions

- `storage`: saves settings, GitHub responses, and optional archive retry queues in the current Chrome profile.
- `activeTab`: supports user-triggered actions for the current tab.
- `alarms`: retries optional PocketBase deliveries after a failure.
- `scripting`: registers the content script only on page origins Chrome has granted.
- `https://api.github.com/*`: fetches repository metadata and user-requested details.
- Optional HTTP(S) page access: scans approved pages for eligible repository-root links.
- Optional PocketBase origin access: sends enabled archive streams to the server origin the user enters.

Fresh installs do not scan web pages until the user chooses all-site or selected-site access. RepoAura does not read page content on unapproved origins.

## GitHub data

For eligible repository links, RepoAura sends the repository owner and name to GitHub's API. Automatic inline summaries request repository metadata only. Issue and contributor data are requested after the user clicks the info button.

An optional GitHub token is stored in `chrome.storage.local` and sent only to `https://api.github.com`. It is never written to logs or PocketBase.

GitHub responses are cached locally for 24 hours, with a 100-repository cap. Clearing extension storage removes local settings, tokens, cache entries, and retry queues.

## Optional PocketBase data

Both archive streams are off by default:

- **Repository snapshots** contain the GitHub repository fields shown by RepoAura and the time RepoAura checked them.
- **Private encounter history** contains the repository, source page origin and path, page title, visible link text, encounter source, and time. URL queries and fragments are removed before storage.

Disabling encounter history immediately clears its unsent local retry queue. It does not delete records already accepted by the user's PocketBase server; those remain under that server administrator's retention policy. Disabling snapshots behaves the same way for its unsent queue.

The included PocketBase schema allows unauthenticated creates for these two collections because the browser extension does not hold a server credential. List, view, update, and delete access remain restricted to PocketBase superusers. Operators should expose the archive only over an authorized private HTTPS route.
