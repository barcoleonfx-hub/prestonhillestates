# H Ticks — FVG / iFVG: notes

**Verification status:** the script has NOT been compiled in TradingView and NOT run in Bar Replay (no compiler or chart environment is available here, and tradingview.com docs were blocked by the network proxy, so APIs were written from knowledge of Pine v6, not re-read from the current docs). `tests/lifecycle_sim.py` is a Python re-implementation of the rules; it verifies the intended logic, not Pine execution.

## Two layers
* **Current-chart layer** – FVGs of the open timeframe. FVG → iFVG (same box recoloured, text “iFVG”, dashed border) → removed. State lives in `chartZ`.
* **HTF context layer** – up to 4 slots (15m, 1H, 4H on; 1D off). Gaps enter Untapped, become Tapped on first touch, are removed on a confirmed *source-timeframe* close through the opposite outer boundary. Never drawn as iFVG. State lives in `hz1..hz4`.
* A source TF > chart TF → HTF layer; = chart TF → chart layer only; < chart TF → omitted; equal-seconds slots are deduplicated.

## Exact rules (tick-aware: prices snapped to whole ticks, no buffer)
* **Formation** (candle 3 closed): bull `low > high[2]` (bottom `high[2]`, top `low`); bear `high < low[2]` (bottom `high`, top `low[2]`); gap ≥ *minimum ticks* (≥1). Boundaries never change.
* **Touch**: `candleHigh >= bottom and candleLow <= top` (later candles only; wick/exact-boundary count; gap-over candles don’t).
* **Inversion**: bull FVG: source/chart close `< bottom`; bear FVG: close `> top`. Strict. Touch/mid/inside/boundary-close/wick do not invert.
* **Chart iFVG removal** (only `bar_index > inversionBar`): invalidation first (bearish iFVG close `> top`, bullish iFVG close `< bottom`), else any overlap. Reason recorded for alerts.
* **HTF**: tap = chart candle overlap, candle must *open* at/after the gap’s confirmation time; monotonic. Removal (source close inversion) overrides a tap in the same step.
* One transition per chart zone per chart bar; removed zones are destroyed and cannot return.

## Timing
Everything commits on a confirmed chart bar. A wick touch is committed at that candle’s close. HTF snapshots use the last *completed* source candle (offset ≥ 1 inside the engine, `lookahead_on`); an HTF event is available at the open of the first chart bar of the next source period and shown at that bar’s close. Alerts only fire on confirmed realtime bars; bootstrap never alerts. Source times (`formTime`, `confTime`, `tapTime`) and chart processing times (`availTime`, `tapAvail`, `invAvail`) are stored separately.

## How HTF history is reconstructed
A lifecycle engine runs inside `request.security` on each source series (touches from completed source candle ranges, inversions from source closes) and returns a compact snapshot (≤ 7 floats × capacity). The chart reconciles it only when a new source candle appears, using a chronological merge plus a per-slot import watermark, so repeated forward-filled values can’t duplicate or resurrect zones. Chart taps are OR-ed in, so a stale snapshot can’t revert Tapped.

## Limits
* Source history: engine runs on the last *N* source candles per slot (default 1000; plan data limits may shorten it). Chart history is separate. Capacity pruning (200 chart / 100 per HTF source, oldest first) is not a price event; pruned zones produce no later transitions. Visible limits (15 / 5 per source) never stop tracking.
* If the chart starts inside a source period, that period’s snapshot is skipped (touches earlier in it are unknowable); the next snapshot already includes it. Zones are omitted rather than labelled Untapped. Warning table shows any omission.
* A slot is disabled with a warning if its TF is not an integer multiple of the chart TF, or a chart candle straddles a source boundary (session misalignment).
* Non-standard charts (Heikin Ashi, Renko, Range, tick…) are rejected with a warning.
* Session basis: `syminfo.tickerid` (the chart’s session/adjustment settings) for all requests.
* Drawings are rebuilt from state on the last bar (rollback-safe). Result: no duplicates, but boxes are not mutated in place across bars. Box left edge is clamped to the first loaded chart bar. Box starts at candle 3’s open (formation candle), which does not mean the gap was confirmed then — see `confTime`. Recolouring an iFVG box represents its *current* state across its whole width; enable the inversion marker to see the actual confirmation bar. Right extension is approximate across session gaps.
* Providers can revise data and differ in available history; no immunity is claimed.

## Install
1. TradingView → Pine Editor → paste `H_Ticks_FVG_iFVG.pine` → **Save** → **Add to chart**. Fix any compiler error it reports (not compiled by the author).
2. Inputs: toggles, visible limits, slots, tick minimum, colours.

## Alerts
* **Aggregated (recommended):** Create Alert → Condition “H Ticks — FVG / iFVG” → “Any alert() function call”. One message per closed bar listing all enabled events with counts and source TFs.
* **Per-event:** pick one of the eight `alertcondition` entries instead (don’t enable both).
