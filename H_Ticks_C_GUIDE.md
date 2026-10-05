# H Ticks - 10AM Precision Model C: guide

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
