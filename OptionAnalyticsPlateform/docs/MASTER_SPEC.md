# MASTER SPEC - Option Analytics Platform

## Vision
Build a production-grade, responsive web platform for Indian options analytics with multi-broker support through OpenAlgo.

## Core Goals
- Single login through OpenAlgo-supported brokers
- Live + historical option analytics
- Multi-strike analysis
- Professional Greek analytics
- Institutional-grade volatility and dealer-flow dashboards
- Mobile-first responsive UX

## Functional Requirements

### Authentication
- OpenAlgo integration
- Broker abstraction layer
- Support paper trading and live trading

### Instrument Selection
- Indexes: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY
- Stocks and F&O instruments
- Expiry selection
- Multi-strike CE/PE selection

### Analytics
First-order Greeks:
- Delta
- Gamma
- Theta
- Vega
- Rho

Second/third-order Greeks:
- Vanna
- Vomma
- Charm
- Speed
- Color
- Zomma
- Ultima

### Visualization
- Historical charts
- Live streaming charts
- Multi-strike overlays
- Heatmaps
- Dual-axis comparison

### Indicators
- SMA
- EMA
- WMA
- HMA
- VWMA
- RSI
- Stochastic RSI
- Bollinger Bands
- Supertrend
- ATR
- ADX
- Donchian
- Z-score

### Volatility Analytics
- IV Rank
- IV Percentile
- IV Smile
- IV Surface
- Term Structure
- Realized vs Implied Volatility

### Dealer Flow Analytics
- GEX
- Zero Gamma
- Gamma Walls
- Put/Call Gamma Ratio
- Vanna Exposure
- Charm Exposure

### Strategy Builder
- Iron Condor
- Straddle
- Strangle
- Butterfly
- Calendar
- Diagonal
- Custom strategies

### Alerts
- Price alerts
- Greek alerts
- IV alerts
- GEX alerts

### Replay Mode
Historical playback of:
- Price
- OI
- Greeks
- IV

## Development Rules
1. Read MASTER_SPEC.md first.
2. Read PROJECT_STATUS.md before every task.
3. Implement milestone by milestone.
4. Update PROJECT_STATUS.md after each milestone.
5. Update DECISIONS.md for architecture changes.
6. Never break completed milestones.
7. Generate tests for all code.
8. Stop after milestone completion for review.