# RepoAura privacy

This policy covers the public RepoAura extension. It does not collect browsing
history, send data to an archive server, or use advertising, telemetry, or vendor
analytics.

## Permissions

- `storage`: saves settings and GitHub responses in the current Chrome profile.
- `activeTab`: supports user-triggered actions for the current tab.
- `scripting`: registers the content script only on page origins Chrome has granted.
- `https://api.github.com/*`: fetches repository metadata and user-requested details.
- Optional HTTP(S) page access: scans approved pages for eligible repository-root and repository-subpage links.

Fresh installs do not scan web pages until the user chooses all-site or selected-site access. RepoAura does not read page content on unapproved origins.

## GitHub data

For eligible repository links, RepoAura sends the repository owner and name to GitHub's API. Automatic inline summaries request repository metadata only. Issue and contributor data are requested after the user clicks the info button.

An optional GitHub token is stored in `chrome.storage.local` and sent only to `https://api.github.com`. It is never written to logs.

GitHub responses are cached locally for 24 hours, with a 100-repository cap. Clearing extension storage removes local settings, tokens, and cache entries.

## Personal build

The separately built RepoAura Personal variant adds opt-in archive features and an
alarm permission. Its additional data flows are described in
[the personal archive privacy policy](ops/pocketbase/PRIVACY.md).
