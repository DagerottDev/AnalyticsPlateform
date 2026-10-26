# Security reporting

Please do not disclose vulnerabilities, credentials, account data, or exploit
details in public issues or pull requests.

If GitHub shows **Report a vulnerability** on the repository's
[Security tab](https://github.com/DagerottDev/AnalyticsPlateform/security),
use that private reporting form. If it is unavailable, open an issue titled
"Request for a private security reporting channel" with no vulnerability details.
Wait for a maintainer to arrange a private channel before sending the report.

Include the affected revision, a minimal reproduction with synthetic data,
expected and observed behavior, and impact. Never include live broker secrets,
JWTs, PINs, TOTP seeds, or real account records. If a credential has leaked,
revoke or rotate it with its provider; deleting it from a file is insufficient.

Security fixes target the current main branch. Older releases may require an
upgrade; there is no guaranteed response time or long-term support commitment.

## Operating safely

This is a single-account application with one active broker connection per API
process, not a shared multi-user service. Keep services local unless you have
reviewed the deployment, added TLS, and restricted access. The supplied Compose
database credentials are for local development.

Generate independent signing and broker-encryption keys. Preserve the existing
encryption key when upgrading so stored credentials remain decryptable. Broker
credentials may also persist in browser local storage; use a trusted browser
profile and clear saved credentials before sharing a device.

Start in paper mode. Backend-monitored exits require the process to keep running;
they cannot guarantee execution during outages. See the
[data and trading constraints](../README.md#data-and-trading-constraints) and
[0.1.1 security release notes](../docs/SECURITY_RELEASE_0.1.1.md).
