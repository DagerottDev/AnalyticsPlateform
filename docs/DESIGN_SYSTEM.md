# Design System

The frontend is a dark, "modern trading terminal" UI — flat and crisp by
default, glassmorphism reserved for a handful of hero moments, dense enough
for options data without feeling cluttered. This file is the single reference
for tokens, primitives, and chart color rules; check it before inventing a new
color, card style, or button in a page.

## Principles

- **Flat by default, glass for emphasis.** Every page uses `.panel` (1px
  border + surface fill, no blur) via the `Card` component's default
  `variant="panel"`. `variant="glass"` (`.glass-strong` + `.gradient-border`)
  is reserved for exactly three spots: the dashboard welcome banner, the login
  form, and the connected-account card on `/accounts`. Don't add a fourth
  without a good reason — overusing blur is what makes a UI feel like a
  marketing page instead of a terminal.
- **One page-layout convention.** Every `app/*/page.tsx` wraps its content in
  `<PageContainer>` (`mx-auto max-w-6xl space-y-6 pb-12 animate-fade-in`) with
  a `<SectionHeader title=... description=... />` at the top. Pages needing a
  wider canvas (e.g. the option chain) pass a `className` override to
  `PageContainer` rather than hand-rolling a new wrapper.
- **Tabular numerals on every number.** Add the `tnum` utility class (or use
  `StatTile`, which already includes it) anywhere a price, Greek, or stat
  renders, so digits align in columns.
- **No raw hex/Tailwind palette colors in app code.** Every color traces back
  to a token below. If you're about to write `text-green-400` or `bg-[#18181b]`,
  there's a token for that — add one if there truly isn't.

## Tokens (`frontend/src/app/globals.css`)

| Token | Meaning |
|---|---|
| `--color-bg-primary/secondary/tertiary/elevated/surface/hover` | Surface elevation scale, darkest to lightest |
| `--color-bg-input` | Form control surface (replaces old ad hoc `#18181b`/`#27272a`) |
| `--color-border-default/subtle/accent` | Border elevation scale |
| `--color-text-primary/secondary/muted/bright` | Text elevation scale |
| `--color-accent-blue/cyan/green/red/orange/purple/yellow` | Raw accent hues — used to build the tokens below, rarely referenced directly in app code |
| `--color-profit` / `--color-loss` | **The one pair for all polarity data**: candles up/down, calls/puts, profit/loss fills, gain/loss table cells. Never use `--color-accent-green/red` for this — pick this pair every time market direction or P&L is being colored. |
| `--color-status-good/warning/serious/critical` | Reserved for system/connection/alert **state** (Header's Connected dot, alert badges). Never reused as a series color, even when a hex happens to match `--color-profit`/`--color-loss`. Fixed values from the dataviz skill's reference status palette — don't re-derive. |
| `--color-cat-1/2/3/4` | Fixed categorical order for multi-series charts (blue, orange, purple, cyan). Always assigned 1st→4th in this order — see "Chart color rules" below. |
| `--color-sequential-1..5` | Single-hue (cyan) light→dark ramp for magnitude/heatmap data. |
| `--color-chart-grid/axis-text/tooltip-bg/tooltip-border` | Chart chrome — mirrors the UI border/text tokens so charts and the rest of the app read as one system. |
| `.panel` | Flat card surface — the default `Card` variant |
| `.glass` / `.glass-strong` / `.gradient-border` | Hero-moment surfaces only |
| `.tnum` | Tabular numerals utility |

## Primitives (`frontend/src/components/ui/`)

| Component | Use for |
|---|---|
| `Card` | Any card/panel. `variant="panel"` (default) everywhere; `variant="glass"` only for the three hero spots above. |
| `Button` | `primary` (CTAs), `outline`, `ghost`, `danger` (destructive actions), `icon` (square icon-only). Never a raw `<button className=...>`. |
| `Input` / `Select` | Any text/number input or native select. |
| `Badge` | Status/mode pills (PAPER/LIVE, trading-mode tags, milestone tags). Tones: `neutral`, `blue`, `profit`, `loss`, `orange`, `purple`. |
| `StatTile` | Label + big number + optional icon, in a `Card`. `tone` picks `profit`/`loss`/`neutral` text color. |
| `EmptyState` | Centered icon + message for "no data yet" states. |
| `LoadingState` | Centered spinner, `size="sm"/"md"/"lg"`. |
| `PageContainer` / `SectionHeader` / `Eyebrow` | Page layout — see Principles above. `Eyebrow` is the one small-uppercase-label scale for section dividers inside a page. |

## Chart color rules

Charts follow one method: color is assigned by the job the data does —
categorical (identity), sequential (magnitude), diverging/polarity, or status
(state) — never picked ad hoc per chart. (This mirrors Anthropic's internal
"dataviz" design methodology used to build this pass; the four rules below
are the parts that matter for this codebase.)

1. **Polarity (calls/puts, profit/loss, up/down)** → `--color-profit` /
   `--color-loss`, always. Never introduce a second green/red-ish pair (this
   is what `ExposureChart.tsx` got wrong before — violet/fuchsia for
   calls/puts — and what `OptionChain.tsx` got inconsistent on, mixing this
   pair with `--color-accent-green/red` for the same meaning).
2. **Multi-series indicator lines** (SMA/EMA/Bollinger/Supertrend, IV/RV,
   etc.) → `--color-cat-1` through `--color-cat-4`, assigned in that fixed
   order every time, restarting at 1 for each independent chart. Don't reuse
   purple/orange/yellow ad hoc because "it looked free" — that's how the same
   hue ended up meaning three unrelated things across `TradingChart` (RSI),
   `HistoricalVolChart` (IV), and `PayoffChart` (T+Today PnL) before this pass.
3. **Magnitude/heatmap data** (IV surface, OI heatmap intensity) → one hue,
   light→dark, from `--color-sequential-1..5`. Never a rainbow sweep — see
   `IVSurfaceHeatmap.tsx` for the reference implementation (`interpolateRamp`
   over the 5-step ramp). Validate any new ramp with the dataviz skill's
   `scripts/validate_palette.js --ordinal` before shipping.
4. **System/connection/alert state** → `--color-status-*`, never a series
   color, even when the hex is close to `--color-profit`/`--color-loss`.
5. **lightweight-charts is canvas-based and cannot resolve `var()`.**
   `TradingChart.tsx` and `HistoricalVolChart.tsx` mirror the tokens above as
   local hex constants (`COLOR_PROFIT`, `COLOR_CAT_1`, etc.) with a comment
   pointing back here — update both places if a token's hex value changes.
   Recharts-based charts (everything in `dealer-flow/`, `volatility/`,
   `strategy-builder/`, `Heatmap.tsx`) render to SVG and use `var(--color-*)`
   directly since the browser resolves CSS custom properties there.
6. **Add a legend whenever a chart has 2+ series.** Recharts' `<Legend>`
   covers itself; lightweight-charts charts use the shared
   `components/charts/ChartLegend.tsx` (colored dot + label row) since the
   library renders no legend of its own.

## Extending this system

- Adding a new page? Start from an existing retrofitted page (e.g.
  `app/dealer-flow/page.tsx`) as the template — `PageContainer` +
  `SectionHeader` + `Card`/`StatTile` for any stat row.
- Adding a new chart? Pick its color per the job the data does (steps 1-3
  above), not by "what looks good" — then check it against
  `references/anti-patterns.md` in the dataviz skill if you have access to it.
- Adding a new status (beyond good/warning/serious/critical) or a 5th
  categorical slot? Don't invent a hex — validate it with
  `validate_palette.js` first and add it to the tables above.
