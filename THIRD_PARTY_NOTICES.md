# Third-party notices

The [MIT license](LICENSE) covers original project code. Dependencies and vendored
code retain their own licenses and notices. Preserve those licenses when
redistributing source or built artifacts; the root license does not replace them.

## Vendored components

| Component | License and provenance |
| --- | --- |
| Fyers API v3 SDK, locally patched 3.1.14+oap.1 | [MIT license](backend/vendor/FYERS-LICENSE.txt); [source, changes, checksums, and rebuild instructions](backend/vendor/README.md) |
| Braces, locally patched 3.0.3-oap.1 | [MIT license](frontend/vendor/BRACES-LICENSE); [source, changes, checksums, and rebuild instructions](frontend/vendor/README.md) |

These are local patches, not upstream releases. Their original licenses also
remain inside the distributed wheel and tarball.

## Lightweight Charts

TradingView Lightweight Charts™
Copyright (с) 2024 TradingView, Inc. https://www.tradingview.com/

Lightweight Charts is distributed under the
[Apache License 2.0](frontend/public/licenses/lightweight-charts-LICENSE.txt).
The application displays the attribution and TradingView link in its shared
workspace layout. The attribution requirement is documented by
[TradingView](https://tradingview.github.io/lightweight-charts/docs/4.2#license-and-attribution).

## Other dependency licenses

The frontend lockfile also declares LGPL-3.0-or-later for the optional
`@img/sharp-libvips-*` binaries, combined license expressions for some other Sharp
platform packages, MPL-2.0 for Lightning CSS and axe-core, and CC-BY-4.0 for
caniuse-lite. The installed nselib package includes an Apache 2.0 license.
These components are not relicensed under MIT. Consult the locked package's own
license and notices, including platform-specific packages, when distributing a
binary or container. This file is a guide to notable components, not a complete
dependency license inventory.

## Market data and broker services

This project's license grants no rights to redistribute broker or exchange market
data, account records, trademarks, or third-party services. Use your own authorized
accounts and check the applicable provider terms before sharing data or offering
a hosted service. The project is not affiliated with or endorsed by those providers.

Analytics and modeled results are research tools, not investment advice or a
promise of trading performance.
