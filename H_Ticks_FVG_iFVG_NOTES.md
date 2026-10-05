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
* Drawings use persistent handles, mutated by setters only on confirmed bars (never on provisional ticks); hidden/removed zones are deleted. Box left edge is clamped to the first loaded chart bar. Box starts at candle 3’s open (formation candle), which does not mean the gap was confirmed then — see `confTime`. Recolouring an iFVG box represents its *current* state across its whole width; enable the inversion marker to see the actual confirmation bar. Right extension is approximate across session gaps.
* Providers can revise data and differ in available history; no immunity is claimed.

## Install
1. TradingView → Pine Editor → paste `H_Ticks_FVG_iFVG.pine` → **Save** → **Add to chart**. Fix any compiler error it reports (not compiled by the author).
2. Inputs: toggles, visible limits, slots, tick minimum, colours.

## Alerts
* **Aggregated (recommended):** Create Alert → Condition “H Ticks — FVG / iFVG” → “Any alert() function call”. One message per closed bar listing all enabled events with counts and source TFs.
* **Per-event:** pick one of the eight `alertcondition` entries instead (don’t enable both).

## Repair pass (audit findings)
* **Coverage policy:** a zone is tracked only while its formation candle is within the last N candles of its own series (HTF: source-history budget; chart: new "Tracking window" input, default 4500 bars, keep below bars your plan loads). Older zones expire silently (never an inversion, never alerted). The engine reconstructs only inside the same window, so live == fresh reload.
* **Memory:** snapshots are 7 floats/zone and a new array is published only when engine state changes (otherwise the same unmutated reference). The effective budget is clamped so slots x budget x 7 x cap x 8 B <= 64 MB (default 4 slots/1000/100 = 22.4 MB bound; max 4000/200 clamps to ~1428). These are upper bounds from arithmetic, **not measured on TradingView**.
* **Events:** the first reconciliation per slot is bootstrap and announces nothing; later "new HTF FVG" requires the zone to be confirmed by the just-completed source candle.
* **Pruning/expiry** never flag inversion; the engine prunes the oldest *unflagged* zone, so a just-inverted zone's removal event is never lost.
* **Verification status:** static review + Python model tests only. Not compiled in TradingView; not run in Bar Replay.

## Declutter update (display filters; lifecycle rules unchanged)
* **Detection vs display:** gaps ≥ *Minimum DETECTION size* (default 1 tick) are always detected and tracked. Display filters only choose what is drawn; hidden zones still invert, get tapped and are removed.
* **Frozen size filter** (separate for chart FVG, chart iFVG, HTF): width ≥ max(min ticks × mintick, ATR multiple × formation ATR). Default 4 ticks / 0.10. Width and ATR(14) are stored at the confirmed formation candle (source ATR from the same source candle for HTF; chart ATR for chart zones) and never change. iFVGs use the original gap's stored ATR. ATR unavailable + multiple > 0 ⇒ hidden (still tracked); multiple 0 turns the ATR part off.
* **Budgets:** chart: 3 ordinary FVGs, 2 iFVGs (separate). Each HTF source: 1 above (bottom > price), 1 below (top < price), 1 containing (bottom ≤ price ≤ top; boundary contact is "containing" only). Defaults: 15m and 1H on, 4H and 1D off.
* **Priority:** *Nearest to price* (default) = nearest-edge distance (0 inside), ties → most recent formation, then later array position; or *Most recently formed*. Reference = last confirmed chart close; selection runs only on confirmed bars, via flags, never reordering lifecycle arrays.
* **Chart distance filter:** distance to nearest edge ≤ 3.0 × current confirmed chart ATR(14); zones containing price always pass; not applied to HTF. If chart ATR is not yet available the filter passes.
* **Alerts** are tied to tracked lifecycle events and are NOT filtered by display settings: a hidden zone can still alert when it forms/inverts/taps. Visibility changes never alert.
* **Verification:** static review + 76 Python model checks only. Not compiled in TradingView; no chart or Bar Replay testing.

## Selective setup indicator (Qualified iFVG)
**Verification status:** static review (bracket balance, API/semantics read-through) + Python model tests (`tests/lifecycle_sim.py` 76, `tests/setup_sim.py` 54). **Not compiled in TradingView. Not run on a chart or in Bar Replay.** Python models verify intended logic only.

**Mandatory gates (all required, no score):** (1) iFVG size filter on frozen width/formation ATR; (2) momentum route A (single-candle displacement) OR route B (multi-candle impulse) on ATR(14)[1]; (3) valid entry/stop/risk (entry = inversion close; stop = N-candle extreme ± buffer; risk ≥ 1 tick); (4) nearest eligible unconsumed target (PDH/PDL, confirmed swings, optional completed Asia/London); (5) target R ≥ minimum (default 2.0, unrounded); (6) no active tracked opposing HTF FVG (any size, tapped or untapped, drawn or hidden) intersecting the closed entry→2R-horizon interval (or entry→target if enabled); (7) complete HTF coverage (unknown ⇒ reject); plus optional sweep / HTF-contact gates (AND). Evaluated once at confirmed inversion and frozen; never upgraded.

**Defaults (starting parameters, not optimised):** mode My Setup Only; max 2 qualified iFVGs; N=3; body ≥ 0.8×ATR[1], body/range ≥ 0.65, close in top/bottom 20%; extension ≥ max(1 tick, 0.10×ATR[1]); route B efficiency ≥ 0.70 and |net| ≥ 1.0×ATR[1]; stop buffer 1 tick; min 2.0R; swings 3/3, horizon 1000 bars; PDH/PDL + swings ON, Asia/London OFF (explicit session + IANA timezone inputs, Asia 0900-1500 Asia/Tokyo, London 0800-1600 Europe/London are placeholders to verify); HTF sources 15m + 1H ON, 4H/1D OFF; optional gates OFF (window 5); only the aggregated "Newly Qualified iFVG" alert is ON; mechanical alerts OFF.

**Coverage rules:** a source is valid only when applicable (strictly higher than chart TF, deduplicated), aligned, initialised, not disabled and not truncated. Equal/lower sources are not applicable. At least one valid source is required and any applicable-but-invalid source ⇒ "HTF coverage unknown" ⇒ rejection. Engine capacity pruning raises a truncation flag until the pruned zone would have aged out of the source-history horizon (documented coverage boundary, not an inversion). Clearance is only against enabled tracked sources within that coverage; it does not mean every market obstacle was checked. If chart TF is 1H with only 15m/1H enabled there is no applicable source (enable 4H).

**Targets:** PDH/PDL admitted only if the chart covers the whole period after the day ended; consumption uses `high >= level` / `low <= level` (no straddle needed); pivots are strict and admitted only at right-side confirmation after post-origin validation; levels consumed by the inversion candle are excluded; sweeps are recorded before consumption; swing levels older than the horizon expire silently. Previous-day levels are disabled on charts ≥ 1D.

**Not simulated / needs real TradingView testing:** compilation; request.security array returns and `ta.atr` inside the engine; `time(timeframe, session, timezone)` behaviour; drawing behaviour; realtime/Bar Replay/reload equality of qualification outcomes end-to-end (only the engine window/truncation equality and pure gate logic are modelled); alert delivery.

## Entry-window timing gate (final timing specification)
**Verification status:** static review (bracket balance + read-through) and Python model tests (`tests/timing_sim.py` 35, plus earlier suites). **Not compiled in TradingView; Pine's `timestamp()/year()/month()/dayofmonth()/dayofweek()` timezone behaviour and `timenow` realtime behaviour are untested; no Bar Replay run.**

* **Windows (all ON by default, independently switchable):** A Asia open 09:00 Asia/Tokyo → first London 08:00 Europe/London strictly after it; B New York morning 09:45–11:30; C New York afternoon 14:30–15:30 (America/New_York). Every hour/minute and IANA timezone is an input. These are configured clock windows, not a universal Asian-session definition, and **not an exchange holiday / early-close calendar**. Default eligible start days: Mon–Fri by the START's local weekday (option: every day).
* **Instances:** per qualification, instances starting on the confirmation instant's local start-date and the previous start-date are built with `timestamp(tz, …)` (DST-aware; day stepping anchored at local noon, never +86,400,000 ms of a midnight). End = first end clock strictly after start, so overnight windows work; identical start/end in one timezone is rejected with a warning. Instance ID = window name + start timestamp.
* **Gate:** judged at the inversion candle's confirmed CLOSE time (`time_close`); start inclusive, end exclusive. A missing/non-positive close time fails ("No reliable close time"). If every window is disabled, nothing qualifies. Evaluated once at inversion and frozen with the other gates: an out-of-window inversion is never queued or upgraded, nor created by an in-window retest.
* **Overlap:** latest start wins; equal starts: NY morning, NY afternoon, Asia→London. One window ID, end and name are stored; alerts include the session name and keep the existing one-per-direction aggregation.
* **Engine never pauses:** formation, inversion, removal, HTF taps/inversions, targets and coverage all run at all times; timing only gates qualification and the display/alerts of qualified setups.
* **Display:** in My Setup Only a qualified setup is shown only until its stored window end (box, marker and guides hidden; mechanical state kept). In All Size-Filtered mode an expired setup remains a plain mechanical iFVG (never labelled Qualified). HTF gaps are unaffected.
* **Display expiry clock:** wall clock (`timenow`) only on a genuinely current realtime bar; otherwise the bar's close timestamp (history/Bar Replay). Expiry runs on realtime ticks via drawings only, with expired IDs in a `varip` array so rollback cannot restore them; hiding is re-applied every tick. TradingView only executes the script on incoming updates, so exact wall-clock hiding at the end instant cannot be guaranteed on a quiet market: the setup disappears on the first update at/after the end.
* **Limits:** a configured local time falling in a DST gap (e.g. 02:30 on spring-forward day) is not specially handled; an invalid IANA name will error at runtime; Asia window length follows the two configured endpoints; window times have no holiday calendar.

## Version: 3m inversion -> retest -> fresh 30s inversion -> entry at close -> fixed 1R
This **replaces** the earlier Qualified-iFVG system (momentum routes, ATR-size gate, liquidity targets, 2R). Those gates no longer exist in `H_Ticks_FVG_iFVG.pine`; their old model tests are parked in `tests/legacy_removed_logic/`.

**Verification status (precise):** code review + static checks (bracket balance, every function/input defined, definition-before-use, no negative-step loops) + Python state-machine model `tests/setup30_sim.py` (48 checks) alongside `tests/timing_sim.py` (35) and `tests/lifecycle_sim.py` (76). **The Pine file has NOT been compiled in TradingView and has NOT been run on a chart or in Bar Replay.** The Python models re-implement the intended logic; they do not prove the Pine compiles or behaves identically.

**Chart:** standard 30-second candles only; otherwise the warning table shows "Switch to a standard 30-second chart" and nothing is generated. The 3-minute context and the 15m/1H(/4H/1D) obstacles come from `request.security` with the engine reading only completed candles ([1] + `lookahead_on`); 30s entry events are never reconstructed from a request.

**State machine (one pending context):** 3m inversion confirmed inside an enabled window -> PENDING_RETEST -> first later 30s candle (open >= confirmation) intersecting the original 3m zone (boundary counts) -> WAITING_FOR_30S_TRIGGER (zone kept) -> a 30s FVG of the opposite direction, **confirmed (candle 3 closed) at or after the 3m confirmation**, whose strict close-inversion happens on a candle strictly after the retest candle -> entry at that candle's confirmed close. Order inside each bar: mechanical 30s lifecycle -> new 30s gap -> HTF sync/taps -> outcome tracking -> context expiry -> newly confirmed 3m data (cancel then create/replace) -> trigger -> retest. A candle that both first retests and inverts can therefore never trigger, and an inversion event is evaluated only on its own bar (never reused).

**Entry model:** E = trigger-candle close (tick-rounded); stop = candle BODY (min(open,close) long / max short) -/+ buffer (default 1 tick); R = exact tick distance; target = E +/- R. Invalid risk (< 1 tick) rejects. No other quality filter exists.

**Clear path:** every tracked opposing HTF gap (hidden, tapped, display-filtered, any size) whose closed interval intersects [E,T] (long) / [T,E] (short) blocks; unknown/uninitialised coverage of an applicable source also blocks. Decided once at the trigger; a rejection keeps the context pending, consumes no slot and is never retro-approved.

**Windows / limits:** same three configurable windows (Asia->London, NY morning, NY afternoon). Both the 3m confirmation and the entry close must resolve to the SAME window-instance ID under the deterministic owner rule (latest start; ties NY morning > NY afternoon > Asia->London). Contexts expire at the window end (end exclusive); optional max age default OFF. Max 3 actual entries per window instance (only created setup records count). One unresolved setup at a time (input, default ON): while open, no entry and contexts confirmed before its resolution are discarded; a new setup needs a context confirmed at/after the resolution close.

**Interpretation choices to confirm:** (1) "forms at/after the 3m confirmation" = gap confirmed at/after it (not candle 1); (2) "same originating window instance" = owner(entry close) equals the context's window ID; (3) outcome tracking is a deliberately minimal placeholder (touch of stop/target on later 30s candles; both in one candle = stop-first) pending the outcome specification; (4) a 3m context source is skipped when the chart does not cover the whole current 3m period (same coverage rule as other sources), and capacity pruning in the 3m engine never removes a just-inverted gap but may drop old live ones (documented coverage limit).

**Not verified anywhere:** Pine compilation; `request.security` array/tuple returns and `ta.atr` in the engine; `timestamp()/year()/dayofweek()` with named zones; realtime vs history equality; drawings; alert delivery.

## Refined indicator (stays an INDICATOR; no strategy build)
`H_Ticks_FVG_iFVG.pine` (paste copy: `H_Ticks_FVG_iFVG_paste.pine`). Same state machine as above plus audit refinements. **Not compiled by the author; not Bar-Replay tested.** Python models (`tests/setup30_sim.py` 64 checks, `timing_sim.py` 35, `lifecycle_sim.py` 76) re-implement the logic only.

**Statistics are an ESTIMATE, not Strategy Tester results.** The indicator keeps its own outcome model: later 30s candles only; stop checked first when a candle touches both; a stop that gaps through fills at the open; assumed slippage (default 1 tick, on the entry fill and stop fills) and an assumed round-turn cost in ticks (default 0) are deducted; R is measured against the signal's own risk distance. The per-window table (N, win%, avg R, net R) is computed from that model. Treat it as a rough read until you have validated it against a real simulator.

**Refinements added after the audit:** (1) source-engine pruning drops the gap FARTHEST from price and flags coverage unknown only if the dropped gap lay within a relevance radius (default 5 source ATR); on strong-trend SYNTHETIC data this cut "coverage unknown" time from 71-100% to 0% (cap 100/budget 1000 -> cap 200/budget 500); gaps pruned beyond the radius are outside coverage by design. (2) Optional minimum/maximum risk in ticks, optional outcome-model time exit, optional departure-before-retest and minimum 3m context width (spec defaults = no effect), risk shown in ticks and currency per contract, per-window results table, state table, timezone drop-downs, stage/outcome alerts (off), JSON entry alert (off), `log.info` state logging (off), `alertcondition`s for long/short entries.

**What to do first:** compile; if errors, paste them back. Then load a few days of 30s history and watch the state table and warnings table. Zero entries is possible: the setup is strict and the windows are short; use the debug option to see which gate rejects triggers.
