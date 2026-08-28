---
name: setup-repoaura-pocketbase
description: Set up, upgrade, or repair RepoAura's optional PocketBase archive on a user-authorized Linux host, including migrations, a hardened service, private HTTPS access, backups, and live extension verification. Use when a buyer wants an agent to make RepoAura snapshots or encounter history browsable in PocketBase.
---

# Set up the RepoAura PocketBase archive

Treat the machine running PocketBase as execution and data authority. Treat the RepoAura repository as migration and service-template authority. Inspect before changing anything, preserve existing data, and never put a PocketBase superuser secret in RepoAura, a command line, a transcript, or a committed file.

## Inputs

Obtain or discover:

- the authorized target host and login method;
- the RepoAura checkout containing `ops/pocketbase/`;
- the private HTTPS origin users will enter in RepoAura;
- whether this is a fresh install, repair, or upgrade;
- the operator-approved maintenance window if an existing service must stop.

Stop and ask before changing an existing PocketBase instance, public ingress, firewall, DNS, TLS, backup retention, or service ownership.

## 1. Inspect

Read `ops/pocketbase/README.md`, every included migration, and `ops/pocketbase/repoaura-pocketbase.service` completely.

On the target, record without exposing secrets:

- OS, architecture, free disk, and current user;
- existing PocketBase processes, binaries, services, listeners, data directories, and migrations;
- the current PocketBase version and `pocketbase --help`, `pocketbase migrate --help`, and `pocketbase superuser --help` output;
- current private ingress or reverse proxy;
- the most recent verified backup and its restore procedure.

Do not assume a command from an older PocketBase version. RepoAura v1.0.0 pins PocketBase 0.40.1. The current standalone CLI uses `superuser`, not the older `admin` command.

## 2. Plan and back up

Use separate paths and a free loopback port if another PocketBase application exists. The default template uses:

- binary and migrations: `~/.local/lib/repoaura-pocketbase/`;
- data: `~/.local/share/repoaura-pocketbase/pb_data/`;
- user service: `~/.config/systemd/user/repoaura-pocketbase.service`;
- listener: `127.0.0.1:8091`.

Before an upgrade or repair, produce a verified backup. Do not copy a live SQLite database as if it were a consistent backup. Prefer a completed PocketBase backup; otherwise schedule explicit downtime, stop only the RepoAura service, copy `pb_data`, verify the copy, and define the rollback command before proceeding.

Report the exact target paths, version transition, listener, ingress, backup, and rollback. Continue only within the user's authority.

## 3. Install the pinned binary

Download the matching 0.40.1 release archive only from `https://github.com/pocketbase/pocketbase/releases/`. Verify its official SHA-256 before extraction. For `linux_amd64`, RepoAura's recorded ZIP checksum is:

```text
0f3442d2e57b03b56fbff0d09289e4a30b4f561a44338c38d2dcd4a1a0cfa91e
```

For another architecture, obtain and verify that release asset's official checksum; do not reuse the AMD64 value. Stage the binary beside the current one, run `pocketbase --version`, and promote it atomically. Keep the previous binary until acceptance passes.

Copy the repository's `ops/pocketbase/pb_migrations/` into the target migration directory. Do not copy `pb_data`, credentials, or unrelated files from the development machine.

## 4. Apply schema deliberately

Keep automatic migration generation disabled in production. With the service stopped for a first install or approved maintenance window, run the pinned binary's explicit migration command against the exact data and migration directories. Confirm that all four RepoAura migrations are present in PocketBase's migration history.

The expected collections are:

- `repository_observations` — base collection;
- `repository_encounters` — base collection;
- `repository_encounter_totals` — private aggregate view;
- `repository_encounter_pages` — private aggregate view.

The two base collections allow unauthenticated create only. List, view, update, and delete rules must remain locked. Do not weaken those rules to make dashboard testing easier.

## 5. Run it privately

Install the included user-service template after reviewing its paths. Bind PocketBase to loopback. Expose it only through an operator-authorized private HTTPS route such as an existing VPN proxy or private reverse proxy. Do not make the dashboard or create API publicly reachable merely to simplify setup.

Create or update the first superuser through PocketBase's `superuser` command or installer UI. Have the operator enter the password through an interactive, secret-safe channel; do not request, echo, store, or transmit it. Consider a superuser IP allowlist and MFA where the operator's access pattern supports them.

## 6. Verify the outcome

Require all of the following:

1. The service is active after a fresh login/session and listening only on the intended loopback address.
2. The private HTTPS `GET /api/health` response is successful.
3. The dashboard opens for the operator and shows all four collections in the intended order.
4. Scheduled backups are enabled, retention matches policy, and at least one backup artifact is readable.
5. In RepoAura, **Test connection** succeeds for the private HTTPS origin.
6. With repository snapshots enabled, refresh one known public repository and confirm one new observation in PocketBase.
7. With private encounter history explicitly enabled, visit one approved page and confirm one encounter plus updated aggregate views. Turn history back off if the operator only wanted a canary.
8. No superuser secret appears in Chrome storage, RepoAura settings, shell history, logs, or repository files.

The health endpoint and local tests are supporting evidence; the RepoAura-to-PocketBase canary is the acceptance test.

## Handoff

Return a compact report containing:

- PocketBase version and verified release checksum;
- service name, data path, loopback listener, and private HTTPS origin;
- migration history and collection names;
- backup location, retention, last successful artifact, and restore procedure;
- RepoAura health and write-canary results;
- exact rollback path and any unverified limitation.

Never include credentials, auth tokens, private page URLs, or raw encounter rows in the report.
