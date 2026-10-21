# Braces development dependency patch

`braces-3.0.3-oap.1.tgz` contains the MIT-licensed braces 3.0.3 package with
one parser change: total brace/parenthesis nesting deeper than 64 throws `SyntaxError` before
recursive compilation/expansion can exhaust the stack. This closes the
deep-nesting denial of service described in GHSA-vfj7-8cjw-p6xm.

The package is named `@option-analytics/braces` locally to distinguish the
maintained patch from upstream. npm installs it under the original `braces`
name through the explicit override. Public APIs and ordinary patterns remain
unchanged. This package is used by development lint tooling, not the app runtime.

The complete original MIT license is retained inside the tarball and in
[BRACES-LICENSE](BRACES-LICENSE). No upstream release is implied.

Upstream: https://registry.npmjs.org/braces/-/braces-3.0.3.tgz

SHA-256: `1cd18e862c8640b4568b1425a7df4ee030ff201d45b2da8f9f222d2987494ffc`

Rebuild and compare from the repository root:

```sh
python3 scripts/build-braces-package.py /path/to/braces-3.0.3.tgz /tmp/braces-patched.tgz
cmp frontend/vendor/braces-3.0.3-oap.1.tgz /tmp/braces-patched.tgz
```

The builder verifies the upstream checksum and fixes archive timestamps. Tests
cover the malicious inputs, normal glob/range expansion and the depth boundary.
