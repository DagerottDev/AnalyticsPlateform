# Contributing

Bug reports, focused fixes, tests, and documentation improvements are welcome.
Discuss substantial changes in an issue before implementing them.

## Development

Follow the [README setup instructions](README.md#getting-started),
[coding standards](docs/CODING_STANDARDS.md), and
[frontend error-handling instructions](.agents/AGENTS.md). Use Python 3.12,
Poetry 2.4.1, and Node.js 24. Install frontend dependencies with `npm ci`
inside `frontend/`; the root lockfile is not an application workspace.

Use your own local environment files. Never commit broker credentials, PINs,
TOTP seeds, access tokens, database exports, or screenshots containing account
information. Redact copied API errors and request headers before sharing them.
Use mocked brokers for automated tests; do not submit real orders to verify a PR.

## Checks

From `backend/`, after `poetry install`:

```sh
poetry run ruff check .
poetry run mypy app/ --ignore-missing-imports
poetry run pytest
```

From `frontend/`, after `npm ci`:

```sh
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Run the checks relevant to your change and report commands, results, and anything
not tested in the pull request. Add a regression test for nontrivial behavior.
Keep generated lockfiles synchronized with dependency changes and preserve the
vendored patches and their upstream notices. CI also checks patch reproducibility
and scans Git history for secrets.

For a local history scan with Gitleaks 8.30.1 or newer, from the repository root:

```sh
gitleaks git . --log-opts="--all" --redact=100
```

The configuration exempts only three specific, path-scoped test fixtures.
Investigate new findings; do not suppress an entire file to make CI pass.

## Issues and pull requests

Use the issue forms for bugs and feature proposals. Include a minimal reproduction,
expected behavior, version, and redacted logs. Report vulnerabilities through the
[security reporting instructions](.github/SECURITY.md), not a public bug report.

Keep pull requests focused. Explain the problem, resulting behavior, checks, and
any migration or compatibility impact. Do not mix formatting sweeps with fixes.
Follow the [code of conduct](CODE_OF_CONDUCT.md).

Submit only work you have the right to share. Contributions are provided under
the project's [MIT license](LICENSE); third-party code keeps its original terms.
