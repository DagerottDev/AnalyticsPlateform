# Security release 0.1.1

This release fixes seven findings from the repository security review of
`f42b19e2f9e7a37b809de9d55269882b5c141f08` and updates vulnerable dependencies.

## Changes

| Finding | Remediation |
| --- | --- |
| Unauthenticated saved-account recovery | Recovery requires a valid, unrevoked JWT for the same client, broker and trading mode; the returned broker profile is checked before persistence. |
| Fyers cache bypassed credential checks | Token cache entries now include a hash of all supplied credential inputs. |
| Known default JWT signing secret | Startup rejects missing, short and shipped placeholder secrets. New installations generate independent keys. |
| Database and Redis exposed on host interfaces | Compose publishes all services only on loopback. |
| Alert webhook SSRF | Delivery requires public HTTPS destinations, validates every resolved address, pins the connection address, preserves TLS identity and disables proxies and redirects. |
| Secret-bearing delivery URLs in logs | Failed deliveries omit tracebacks and HTTP client URL logging is restricted. |
| SQL bound parameters in logs | Runtime and migration engines hide parameters. |

Recovery also preserves the initiating browser identity across logout, account
switches and concurrent login. Old tokens cannot clear another persisted account,
and live orders require both a Live JWT and a currently Live broker service.
Production runs one API worker because broker sessions and monitors are held in
process memory.

Python JWT operations use PyJWT. Updated Python and npm lockfiles remove known
registry advisories. Two dependencies require explicit local MIT patches:

- [Fyers SDK](../backend/vendor/README.md): retains SDK 3.1.14 behavior while
  relaxing vulnerable HTTP pins and replacing obsolete resource imports.
- [Braces lint dependency](../frontend/vendor/README.md): bounds combined brace
  and parenthesis nesting before recursive compilation or expansion.

Both patches retain their original licenses, verify upstream SHA-256 hashes and
rebuild byte for byte with the included scripts. They require maintenance when
upstream dependencies change; a clean registry audit alone does not validate them.

## Upgrade

1. Back up the database and existing environment files.
2. Set an independently generated `JWT_SECRET` of at least 32 characters in
   `backend/.env` if the existing value is missing or a placeholder. For example,
   generate a value with `openssl rand -hex 32`. Changing it invalidates browser
   sessions; sign in again.
3. Preserve the existing `BROKER_TOKEN_ENCRYPTION_KEY` so saved broker credentials
   remain decryptable. `install.sh` only generates keys for a new environment file.
4. Rebuild containers with `docker compose -f docker/docker-compose.yml up -d --build`.
   Compose reads `backend/.env`; configure CORS and other settings there. Set
   `NEXT_PUBLIC_API_URL` when building a frontend for another origin.

Anonymous startup and expired JWTs now require manual login. Silent recovery is
available only while the existing JWT remains valid. Private-network and HTTP
webhooks are intentionally rejected. A remote deployment needs a TLS reverse
proxy because host ports now bind only to loopback.

## Verification

Local verification passed: backend Ruff and MyPy, 585 backend tests, frontend
ESLint and TypeScript, 360 frontend tests, a production Next.js build with its
standalone server entry point, and byte-for-byte vendor rebuilds. Locked Python
and npm registry audits reported zero known vulnerabilities. Regression
tests exercise recovery identity and revocation, browser recovery races, pinned
HTTP transport and TLS identity, secret redaction, live-mode enforcement and
SDK compatibility with mocked broker endpoints and an isolated local HTTP server.

GitHub CI additionally builds both production images and starts an isolated
TimescaleDB/Redis/API/frontend stack, checks migrations and health, and confirms
anonymous recovery is rejected. See the release pull request for check results.

This is a source release. Live broker connectivity, real orders and production
deployment are outside the executed checks; no broker credentials or real trades
are used by the release tests.
