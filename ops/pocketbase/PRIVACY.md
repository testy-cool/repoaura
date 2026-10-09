# RepoAura Personal archive privacy

Both archive streams are off by default:

- **Repository snapshots** contain the GitHub repository fields shown by RepoAura and the time RepoAura checked them.
- **Private encounter history** contains the repository, source page origin and path, page title, visible link text, encounter source, and time. URL queries and fragments are removed before storage.

Disabling encounter history immediately clears its unsent local retry queue. It does not delete records already accepted by the user's PocketBase server; those remain under that server administrator's retention policy. Disabling snapshots behaves the same way for its unsent queue.

The included PocketBase schema allows unauthenticated creates for these two collections because the browser extension does not hold a server credential. List, view, update, and delete access remain restricted to PocketBase superusers. Operators should expose the archive only over an authorized private HTTPS route.

This applies only to the personal build. The public build excludes archive delivery
and encounter collection. GitHub tokens are never included in either archive stream.
