# Powell Model C – guide-faithful mode (experiment)

**Reset the indicator's settings after loading this version (inputs changed).**

Honest status: not compiled in TradingView by me (you are the compiler). My Pine interpreter is not TradingView. Rules are our mechanical reading of the guide, not Powell's official rules. No profitability or win-rate claim is made; the sample you can test on is tiny.

## What `Guide-faithful` (default ON) does
- Significant levels only: PDH/PDL, previous-session H/L, clean equal highs/lows, Asia range (18:00–00:00), London, PO3. Current-session and opening-range levels are not created.
- Sweep and CISD are read on **15m**.
- Higher-timeframe agreement: 1H CISD must agree (optional 4H toggle). 1H/4H CISD is tracked from completed candles; if unavailable the candidate is rejected with that reason.
- Entry: **closing confirmation** inside the parent array (FVG/OB/breaker/rejection/iFVG that the retracement reached): a candle in the setup direction closes through the first open of the opposing run into the array (5m default, 1m optional). Market order at the **next candle's open**.
- Stop: beyond the sweep extreme; if wider than the cap (default 100 ticks) the local retracement extreme is used; if still wider the setup is rejected (never squeezed). Target: nearest unswept liquidity; minimum R as input.
- Optional trail: +1R → stop to −0.5R, +2R → break-even (effective from the next candle).
- Daily sequence: a win ends the day; a loss allows one retry (50% size).
- Window defaults 09:30–12:00, hard exit 12:00. Turning `Guide-faithful` OFF restores the previous behaviour.

## Also in this build
- Optional Macro mode: the level must be crossed by a 1m candle inside the macro window (default 09:50–10:10); target stays nearest unswept liquidity; known-level sweep still required.
- Removed to stay under TradingView's 100,256-token limit: SMT divergence, chop filter. Not implemented: NWOG/NDOG. Estimated size ≈93k tokens (my estimate, not measured; about 7k headroom).
- Stand-alone legacy 10am indicator: `H_Ticks_C_Legacy_10AM.pine`.

## Testing
`tests/c_check.py` 145/145 text checks; `tests/c_pine_regress.py` executes the Pine source in my interpreter (109 passed in the last full run, 1 test expectation corrected afterwards and spot-checked, 12 skipped).
