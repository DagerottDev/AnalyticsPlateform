# Feature Matrix

Track implementation status per feature.

| Feature | Milestone | Status | Notes |
|---------|-----------|--------|-------|
| **Authentication** | | | |
| Direct Broker integration | M1 | ✅ Done | Broker credentials → JWT flow |
| Broker abstraction layer | M1 | ✅ Done | BrokerService class |
| Paper trading mode | M1 | ✅ Done | Paper/Live toggle |
| Live trading mode | M1 | ✅ Done | With warning badge |
| **Instrument Selection** | | | |
| NIFTY index | M2 | ✅ Done | |
| BANKNIFTY index | M2 | ✅ Done | |
| FINNIFTY index | M2 | ✅ Done | |
| MIDCPNIFTY index | M2 | ✅ Done | |
| Stock F&O | M2 | ✅ Done | |
| Expiry selection | M2 | ✅ Done | |
| Multi-strike CE/PE | M2 | ✅ Done | |
| **Market Data** | | | |
| Option chain | M2 | ✅ Done | |
| WebSocket streaming | M2 | ✅ Done | |
| **Historical Engine** | | | |
| TimescaleDB storage | M3 | ✅ Done | |
| Backfill jobs | M3 | ✅ Done | |
| **Greeks** | | | |
| Delta | M4 | ✅ Done | |
| Gamma | M4 | ✅ Done | |
| Theta | M4 | ✅ Done | |
| Vega | M4 | ✅ Done | |
| Rho | M4 | ✅ Done | |
| Vanna | M4 | ✅ Done | |
| Vomma | M4 | ✅ Done | |
| Charm | M4 | ✅ Done | |
| Speed | M4 | ✅ Done | |
| Color | M4 | ✅ Done | |
| Zomma | M4 | ✅ Done | |
| Ultima | M4 | ✅ Done | |
| **Charting** | | | |
| Historical charts | M5 | ✅ Done | |
| Live streaming charts | M5 | ✅ Done | |
| Multi-strike overlays | M5 | ✅ Done | |
| Heatmaps | M5 | ✅ Done | |
| SMA/EMA/WMA/HMA | M5 | ✅ Done | |
| RSI/Stochastic RSI | M5 | ✅ Done | |
| Bollinger/Supertrend | M5 | ✅ Done | |
| ATR/ADX/Donchian | M5 | ✅ Done | |
| **Volatility** | | | |
| IV Rank | M6 | ✅ Done | |
| IV Percentile | M6 | ✅ Done | |
| IV Smile | M6 | ✅ Done | |
| IV Surface | M6 | ✅ Done | |
| Term Structure | M6 | ✅ Done | |
| Realized vs Implied | M6 | ✅ Done | |
| **Dealer Flow** | | | |
| GEX | M7 | ✅ Done | |
| Zero Gamma | M7 | ✅ Done | |
| Gamma Walls | M7 | ✅ Done | |
| Put/Call Gamma Ratio | M7 | ✅ Done | |
| Vanna Exposure | M7 | ✅ Done | |
| Charm Exposure | M7 | ✅ Done | |
| **Strategy Builder** | | | |
| Iron Condor | M8 | ✅ Done | |
| Straddle | M8 | ✅ Done | |
| Strangle | M8 | ✅ Done | |
| Butterfly | M8 | ✅ Done | |
| Calendar/Diagonal | M8 | ✅ Done | |
| Custom strategies | M8 | ✅ Done | |
| **Alerts** | | | |
| Price alerts | M9 | ✅ Done | |
| Greek alerts | M9 | ✅ Done | |
| IV alerts | M9 | ✅ Done | |
| GEX alerts | M9 | ✅ Done | |
| **Replay Mode** | | | |
| Price replay | M10 | ✅ Done | |
| OI replay | M10 | ✅ Done | |
| Greeks replay | M10 | ✅ Done | |
| IV replay | M10 | ✅ Done | |
| **Infrastructure** | | | |
| Monorepo structure | M1 | ✅ Done | backend/ + frontend/ |
| Docker Compose | M1 | ✅ Done | 4 services |
| CI/CD pipeline | M1 | ✅ Done | GitHub Actions |
| Premium dark theme | M1 | ✅ Done | TradingView-style |
| Responsive layout | M1 | ✅ Done | Sidebar + header |

> **Data-source caveat**: Fyers instruments, quotes, historical candles, and the backend
> WebSocket proxy are implemented. Option-chain OI is a short-lived REST snapshot because
> Fyers live ticks do not include OI; Dealer Flow falls back to `instrument.oi` for that
> reason. Dhan supports account, order, portfolio, and explicit-security quote flows but
> does not expose the equivalent Fyers option-chain-by-symbol API.
