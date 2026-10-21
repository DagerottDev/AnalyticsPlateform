# Fyers SDK security patch

`fyers_apiv3-3.1.14+oap.1-py3-none-any.whl` is built from the official MIT SDK
3.1.14 wheel. Its broker API and websocket protocol implementations are retained.

Changes:

- Requests >=2.34.2,<3 and aiohttp >=3.14.5,<4 replace vulnerable exact pins.
- The unused asyncio backport and runtime setuptools requirement are removed.
- Three `pkg_resources` imports are replaced with standard-library resource
  loading (or removed when unused), allowing installation without setuptools.
- Wheel version and RECORD hashes are regenerated deterministically.

The original copyright and MIT license remain inside the wheel and in
[FYERS-LICENSE.txt](FYERS-LICENSE.txt). This is a local patch, not an upstream release.

Upstream wheel:
https://files.pythonhosted.org/packages/24/dc/553a556fb6dd4b2e4d4251d5ec53536a36cde34f9aae8aaf88280239a5bb/fyers_apiv3-3.1.14-py3-none-any.whl

SHA-256: `fb1cb2b3f99d3f26111ef03cad8412bb7df33887827f7f97f7a503533dc22fb4`

Rebuild from the repository root:

```sh
python3 scripts/build-fyers-wheel.py /path/to/fyers_apiv3-3.1.14-py3-none-any.whl \
  /tmp/fyers_apiv3-3.1.14+oap.1-py3-none-any.whl
cmp backend/vendor/fyers_apiv3-3.1.14+oap.1-py3-none-any.whl \
  /tmp/fyers_apiv3-3.1.14+oap.1-py3-none-any.whl
```

The builder rejects an upstream checksum mismatch. CI checks the rebuilt bytes.
Offline compatibility tests cover SDK REST/OAuth calls, resource loading and the
application's stream adapter. Live broker credentials and real trades are not used.
