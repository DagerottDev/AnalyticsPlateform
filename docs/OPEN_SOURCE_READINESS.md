# Open-source release readiness

Preparation checked on 2026-10-26, starting from `7f25245`.
GitHub visibility was verified as **private** during preparation. The owner
authorized committing, pushing, and making the repository public on the same day.
The publication result and GitHub checks should be verified on the repository;
this note records the checks performed before publication.

## Prepared

- MIT license for original project code, with matching backend/frontend metadata.
- README with source setup, Podman commands, limitations, and contribution links.
- Contributor guide, code of conduct, bug/feature forms, and PR template.
- Security reporting instructions with a fallback when private reporting is unavailable.
- Vendored license notices, Lightweight Charts attribution in the workspace,
  and a bundled copy of its Apache 2.0 license.
- Expanded Git and container-context exclusions for environments, keys, local
  databases, and generated output; removed the tracked TypeScript build cache.
- Lockfile-based frontend installation through `npm ci`, private environment-file
  permissions on partial installs, and a native Redis example matching port 6380.
- CI secret scans for Git history and tracked files, including vendored archives,
  using a pinned, checksum-verified Gitleaks binary and read-only repository permissions.

## Local verification

| Check | Result |
| --- | --- |
| Gitleaks 8.30.1, refreshed reachable Git refs | Clean after reviewing six matches as fixed CI/test fixtures; 42 reachable commits, 41 scanned changesets |
| Publishable working-file snapshot and vendored archives | Clean; real local environment files and dependency directories excluded |
| Secret-scan exception checks | A different synthetic key in an excepted path fails; the fixture value in another path also fails |
| Backend Ruff / MyPy | Passed; MyPy checked 100 source files |
| Backend tests, isolated Python 3.12.13 with committed Poetry dependencies | 584 passed in sandbox; remaining localhost mock-server test passed on focused retry with socket access (585 total) |
| Frontend ESLint / TypeScript | Passed using the actual project script/compiler |
| Frontend Vitest | 360 tests passed across 76 files |
| Frontend production build | Passed; generated HTML contains attribution and the bundled license link |
| Installer smoke check in a temporary directory | Passed with dependency-install commands stubbed: `npm ci`, generated keys, mode 0600, key preservation on a second run, and private permissions on a partial install |
| Poetry manifest and lock consistency | Passed; legacy Poetry metadata deprecation warnings remain |
| Workflow / issue-form YAML, shell syntax, metadata, ignore rules, and local documentation links | Checked locally; the publication push triggers the updated GitHub workflow |
| Local Podman retry after the owner started Podman | Connection refused; machine startup then failed to connect to its `gvproxy` socket. Local container verification remains unavailable |
| Existing GitHub release assets | v0.1.1 has no uploaded assets; its security release notes were inspected |

The initial frontend lint command was rewritten by the local command wrapper and
scanned generated files. Bypassing that wrapper and running `npm run lint` passed.
The existing backend virtualenv lacked PyJWT, so tests used a separate temporary
environment installed from `backend/poetry.lock`, without changing the local venv.
Existing test warnings concern chart dimensions in jsdom, Node local storage,
Vite config loading, and Alembic configuration.

## Before making the repository public

- Confirm that you have the right to license all original code, documentation,
  and assets, including any work created under employment or other agreements.
- Review and commit the prepared changes, push through the normal review flow,
  and confirm the updated GitHub checks pass. Re-scan any later additions.
- Confirm the publication commit passes the GitHub container build/startup job.
  Local Podman verification was retried but remains blocked by the VM connection
  and `gvproxy` startup errors; no application data was changed.
- Explicitly change repository visibility when ready. Enable and verify GitHub
  private vulnerability reporting, then replace the reporting fallback if useful.
  The private-reporting API returned 404 during preparation; no enabled private
  channel is assumed.
- Review repository settings, branch protection, Actions permissions, and old
  releases/artifacts for public suitability. Those settings were not modified or exhaustively inspected. The only listed
  release, v0.1.1, has no uploaded assets.
- Before publishing images or standalone binaries, verify their complete license
  and notice contents separately, including platform-specific dependencies. This
  preparation targets a source repository; it does not certify binary distributions.

No live broker calls, real orders, new full security audit, or fresh dependency
advisory audit were performed. Existing security work is documented separately in
[the 0.1.1 release notes](SECURITY_RELEASE_0.1.1.md).
