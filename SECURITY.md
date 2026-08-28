# Security policy

## Reporting

Please report security issues privately through GitHub's security-advisory interface for this repository. Do not include tokens, PocketBase credentials, private URLs, or captured page content in a public issue.

## Supported version

Security fixes target the latest tagged release.

## Operational boundaries

- Use the least-privileged GitHub token that meets your needs.
- Keep PocketBase behind an authorized private HTTPS route.
- Never place a PocketBase superuser credential in RepoAura.
- Back up `pb_data` before changing the PocketBase binary or applying migrations.
- Review PocketBase release notes before upgrades; it remains pre-1.0 and may require manual migration work.
