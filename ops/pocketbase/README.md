# RepoAura PocketBase archive

These files define RepoAura's optional, self-hosted archive. They create:

- `repository_observations` for fresh GitHub metadata snapshots;
- `repository_encounters` for explicitly enabled private browsing history;
- `repository_encounter_totals` and `repository_encounter_pages` for private aggregate browsing.

The base collections permit unauthenticated creates because the extension never holds a PocketBase credential. List, view, update, and delete operations are superuser-only. Keep the service reachable only through an authorized private HTTPS route.

The supported standalone binary is PocketBase 0.40.1. For its `linux_amd64` release ZIP, verify SHA-256:

```text
0f3442d2e57b03b56fbff0d09289e4a30b4f561a44338c38d2dcd4a1a0cfa91e
```

The generic user-service template expects:

- binary and migrations: `~/.local/lib/repoaura-pocketbase/`;
- data and local backups: `~/.local/share/repoaura-pocketbase/pb_data/`;
- service: `~/.config/systemd/user/repoaura-pocketbase.service`;
- listener: `127.0.0.1:8091`.

The migrations schedule a daily 04:00 local backup and retain 14 automatic backups. Review this policy before production use, keep a separate restore-tested backup, and back up `pb_data` before binary or schema changes.

For a guarded agent-operated setup, use [`skills/setup-repoaura-pocketbase/SKILL.md`](../../skills/setup-repoaura-pocketbase/SKILL.md). PocketBase's current production guide documents the portable binary, `superuser create`, loopback reverse-proxy pattern, and backup behavior. Its migration guide confirms that `pb_migrations` can be committed and that unapplied migrations run on `serve` or `migrate up`; RepoAura disables automatic migration generation in production.
