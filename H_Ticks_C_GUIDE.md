# H Ticks - Powell Model C: guide (Contextual preset + Legacy 10am preset)

**Audit patch applied (see C_AUDIT_NOTES.md): gap execution policy, pre-existing rejection parent, Sunday context, aggregation completeness, pre-window Fib endpoints, causal breaker, range-state labelling, mandatory Precision parent.**

**Research model. Profitability is unproven.** Everything is *our mechanical reading* of the guide, not Powell's official rules. Simulation on completed 1m
candles. **Not compiled in TradingView and not chart-tested** (see "Verification status"). The paste file is about 143 KB stripped; whether TradingView accepts
that size is **unverified** - if it reports "script too large", say so and a lean build (Contextual only) will be made.

## Two scripts (split forced by TradingView's compiled-token limit CE10117)
* **`H_Ticks_C_10AM_Precision.pine`** - Powell Model C, Contextual only (described below).
* **`H_Ticks_C_Legacy_10AM.pine`** - the earlier 10:00-open retest engine as its own indicator (logic unchanged except the gap-policy correction).
  Reset the contextual script's settings to defaults after pasting (its inputs were renumbered).

## Rule provenance
| Tag | Meaning |
|---|---|
| GUIDE | concept described in the guide: sweep of a pre-existing level, CISD, FVG/OB/breaker/iFVG areas, retracement entry, Fib 0.705 / 0.79, opposing-liquidity target, key opens as context |
| OURS | our mechanical choice: CISD reference = first open of the contiguous opposite run into the sweep; area selection policy; breaker = block before the run, broken by a CLOSE; current-session level after N minutes; HTF bias definition; setup priority and replacement rules |
| OPT | optional experimental filters (all OFF by default): HTF bias, PO3, confluence, iFVG required, chop, engineered-liquidity proximity, SMT reversal role, Fib-in-area |
| ENG | engineering approximations: self-aggregated candles, late completion across the 17:00-18:00 break, 80%-complete ranges, whole-contract sizing |

## Pipeline (per trading day = 18:00 NY to 17:00 NY)
1. **Levels** (each with id, type, price, origin, *earliest knowable time*, status untouched/touched/swept): previous completed trading-day H/L (known when the next
   trading day's first candle arrives), previous regular-session H/L (all 390 candles, known at 16:00), current-session extreme that stood N minutes, frozen
   opening range (known 10:00), confirmed equal highs/lows, optional completed Asia/London/PO3 ranges. 18:00 / 00:00 / 10:00 opens are drawn as reference only and never
   create a setup. NWOG/NDOG are **not implemented**.
2. **Sweep**: a level exceeded by >= N ticks by a candle that opened *after* the level was known. A level created on a candle is first tested on the next candle.
3. **CISD**: at the sweep the reference (first open of the contiguous opposite-colour run leading into the sweep candle; dojis end a run) is frozen; a *later* source-TF candle must
   **close** through it. No run = CISD unavailable = setup rejected with a reason.
4. **Areas** (must exist before an order uses them): FVG (usable after the 3rd candle closes), order block (last opposite candle before the displacement, full high-low, CE = midpoint),
   breaker (causal confirmed-swing sequence A->B->C then a CLOSE beyond B; the broken block is B's order block), rejection block (our wick/body thresholds), iFVG (opposite gap inverted by a close). An area dies when a 1m candle closes
   through its far side and is stale once price touched its CE after it was known.
5. **Selection (deterministic)**: prefer areas overlapping the selected HTF POI, else the CE nearest to the last close on the retracement side, tie -> most recently confirmed, then type.
   Frozen when the order is armed. A setup formed before the window stays eligible (no fresh sweep needed) until it expires, is invalidated, or a new trading day starts.
6. **Standard**: limit at the CE; stop = full sweep extreme + buffer (over the cap = rejected, never squeezed); target = nearest *unswept* opposing level known at arming; min planned R 3 on rounded prices; no target = rejected (no farther level substituted).
7. **Precision** (sub-methods of ONE variant): **Fib** - anchors are the sweep extreme and the first confirmed swing after the CISD (known only when its right side closed, never back-dated); entry
   high - 0.705*(high-low) (long) / low + 0.705*(high-low) (short); stop reference at 0.79 plus buffer; skipped as stale if 0.705 was already traversed before the anchor was known.
   **Rejection CE** - a completed local candle (5m default) interacting with the parent area with a directional close and a wick share >= threshold; entry = wick midpoint; stop beyond the local extreme + buffer.
   If both are on, the first executable candidate wins (same candle -> Fib first). A precision stop ends that *attempt*, not the larger setup.
8. **Daily sequence** (each variant independently): "One trade per day" (default) or "win ends the day; one retry after a non-win at 50% of the first trade's actual cash risk (whole contracts, rounded down)".
   A breakeven/time-exit counts as an attempt.
9. **Simulation**: orders eligible from the candle after arming; touch (or trade-through) fills at the limit; an open beyond the frozen extreme invalidates; fill-candle target touches ignored; entry+stop+target on one candle or stop+target on a later candle = ambiguous = counted as a loss;
   gaps through the stop exit at the open; slippage adverse; commission per contract per side; hard exit at the open of the first candle at/after the hard-exit time.

## Not implemented (deferred)
NWOG/NDOG; trailing / breakeven management; SMT *target* role (only the reversal role exists); local FVG / breaker overlap for rejections; retries beyond the one sequence retry; HTF bias beyond the simple
"close beyond the previous candle" rule; Asia/London/PO3 are optional and off by default.

## Reading the tables
Funnel (Standard / Precision / Precision-Fib / Precision-Rejection), performance (same columns; planned >=4R / >=5R counts), ledger, "Why no trade?" (latest day detail + cumulative reasons),
info panel (coverage, bias per timeframe with availability times, current setup, assumptions). Missing data is never counted as "no setup".

## Verification status
`tests/c_ctx_check.py` tests a Python model of the contextual logic (102 scenario checks, long and mirrored short); `tests/c_check.py` (142 checks) text-checks the Pine and proves the Legacy functions are unchanged.
**The Pine script itself has not been compiled in TradingView or chart-tested.** The syntax parse used is a third-party parser.

---
# Previous guide (Legacy 10am preset)

**Research model. Profitability is unproven.** The rules are *our* specification, not Powell's official rules. Everything is a simulation on completed
1-minute candles. Not compiled in TradingView and not chart-tested by the author (see "Verification status").

## Choosing the variant (Settings -> "0. Execution variant")
| Setting | Meaning |
|---|---|
| Execution variant | **Standard** = the 10am reversal / retest execution (entry models A, B, C below) with its structural stop. **Precision** = the same setup, but it waits for a local rejection / secondary sweep and uses a local stop. The selected variant raises alerts and its planned lines are drawn first. |
| Display both variants | Draw the other simulated variant's planned levels too (`STD ENTRY/SL/TP` and `PREC ENTRY/SL/TP`). Only variants that are being simulated can be drawn. |
| Compare both variants' statistics | ON = simulate Standard AND Precision independently (separate equity, outcomes, drawdown). OFF = only the selected variant is simulated, so Standard runs exactly as before. |

**Mapping of the old entry models:** A (plain retest), B (retest + iFVG), C (Fib overlap + rejection) and the experimental C-wick (rejection-wick stop) are all *Standard* entry models, chosen with "Selected entry model" / "Model C stop policy". "Comparison mode" still compares those four entry models with each other. Nothing was removed.

## Shared setup (both variants)
1. The exact open of the **10:00 NY candle** is captured when that candle closes (never backdated).
2. A **manipulation** qualifies on a candle that opens 10:00-10:09: ATR mode `0.5 x ATR(14)` frozen from the last completed candle before 10:00 (default) or fixed 15 points. Above the open = short, below = long. A first candle crossing both thresholds is skipped (option: use the larger excursion).
3. **Reversal** = 2 consecutive closes back through the open on candles *after* the manipulation candle (resets if broken). The manipulation extreme is then frozen.
4. Optional filters (all off by default): post-10am liquidity sweep, maximum manipulation size.
5. Entry cutoff 10:45 (pending orders cancelled); remaining positions closed at the 11:00 candle open.

## Standard
Limit at the 10am open (A), after a frozen FVG inversion (B), or at the midpoint of a rejection wick when the open sits in the 61.8-79% retracement of the frozen leg (C). Stop beyond the frozen manipulation extreme + 2 ticks, capped at 80 ticks (rejected, never squeezed). Target 1R / 2R / frozen opposing liquidity.

## Precision (new): "Rejection / Sweep"
After the shared reversal confirms, Precision waits for **its own trigger** on a later completed candle:
* **Precision area** = a band around the 10am open (default +/- 4 ticks). Optional Fib filter: the band must overlap the frozen 61.8-79% zone and the trigger candle must interact with that overlap.
* **Rejection trigger** (short): candle trades into the area, closes below the 10am open and below its own open, upper wick >= 40% of the range, close in the bottom half. Long mirrors. Zero-range candles rejected.
* **Secondary-sweep trigger**: the most recent confirmed local pivot formed *after* the reversal confirmation (default 1 left / 1 right, strictly higher/lower, known only when the right-side candle has closed) is exceeded by >= 1 tick by a *later* candle that interacts with the area, closes back through the pivot and the 10am open, and meets the same rejection-wick conditions. A pivot is consumed once exceeded. No pivot = trigger unavailable.
* "Either" = whichever qualifies first; both on one candle is labelled **Sweep + Rejection**.
* **Entry**: limit at the midpoint of the frozen trigger wick, eligible from the *next* candle only. No market chasing.
* **Stop**: trigger candle high (short) / low (long) +/- buffer (default 2 ticks) from the rounded entry. Over the cap (default 40 ticks) = rejected.
* **Target**: nearest *unswept* opposing liquidity level (frozen opening range, previous completed regular session) that was known when the order was armed, frozen at arming; or a separate Fixed-R mode (default 5R). Planned R is checked on the rounded prices against the minimum (default 5R); below it = skipped, no farther target substituted.
* A pending Precision order is cancelled on: expiry (default 3 subsequent candles), the entry cutoff, a candle opening beyond the local stop, the shared setup being invalidated, or the target being reached before the entry.
* Retries are **not** implemented: one candidate per variant per day.
* Optional: require a frozen iFVG inversion first (model B rules).

## Execution model and its limits
* Setup and order creation use completed candles only; nothing is backdated. No `request.*` calls, so there is no higher-timeframe repainting.
* A limit fills when a **later** candle touches it (a touch is an assumption, not guaranteed execution; the stricter setting requires trade-through). The fill price is the limit price: no price improvement is ever credited.
* A candle that opens beyond the frozen manipulation extreme invalidates a pending order instead of filling it.
* Entry + stop + target on one candle, or stop + target on a later candle: the intrabar order is unknowable from OHLC, so the trade is flagged **ambiguous** and counted as a loss (conservative; option: exclude). On the fill candle a target touch is ignored (it may precede the fill).
* Gap through the stop exits at the open (worse than 1R); gap through the target fills at the target.
* MAE / MFE from candles where the order of events is unknown are flagged as uncertain and are conservative bounds, never exact values.
* Slippage is adverse on entry, stop and time exits (not target limits); commission is per contract per side. With zero costs, net equals gross (the dashboard says so).
* Whole contracts only. "Fixed cash risk" sizing uses the same cash risk per trade (contracts rounded **down**; a setup needing less than one contract is rejected) so variants can be compared fairly.
* A small stop with a large planned R is not evidence of an edge or of small drawdown. Count every loss, cost and missed fill. About 16 days cannot establish an edge.

## Dashboard
Funnel (eligible setups, triggered candidates, orders armed, filled, expired/unfilled, stop-cap / minimum-R / no-target / sizing rejections, invalidated, ambiguous) and performance (wins, losses, time exits, gross and net expectancy, profit factor, average stop, average planned and realised R, max losing streak, closed-equity drawdown, median MAE for all trades and winners, ambiguous outcomes) with Standard and Precision side by side, plus a paginated ledger and a coverage panel (evaluated, partial, missing 10am candle, ATR unavailable, weekdays with no bars at all). Missing data is never counted as "no setup".

## Defaults are research starting points, not optimised
ATR 0.5x / 15 pts, 2 closes, buffers 2 ticks, Standard cap 80 ticks, Precision cap 40 ticks, band 4 ticks, wick 40%, pivots 1/1, minimum 5R, expiry 3 candles, Fixed-R 5R, cash risk 500 USD.

## Verification status
`tests/c_check.py` (+ `tests/c_model.py`, a Python port of the decision logic) checks the Pine text and the behaviour of that port on synthetic data. **The Pine script itself has not been compiled in TradingView or chart-tested.** The syntax parse used is a third-party parser, not TradingView's compiler.
