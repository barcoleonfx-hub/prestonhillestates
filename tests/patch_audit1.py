import re
P='/home/user/prestonhillestates/H_Ticks_C_10AM_Precision.pine'
src=open(P).read()
def rep(old,new,count=1):
    global src
    c=src.count(old); assert c==count,(old[:80],c)
    src=src.replace(old,new)
def fn_span(name):
    i=src.index('\n'+name+'(')+1
    m=re.search(r'\n(?=\S)', src[i+len(name):])
    j=i+len(name)+m.start()+1
    return i,j
def repl_fn(name,new):
    global src
    i,j=fn_span(name); src=src[:i]+new.rstrip('\n')+'\n\n'+src[j:]

# ---------------- types
rep("    string meth = \"\"\n    int sid = 0\n\n// One entry model's state","    string meth = \"\"\n    int sid = 0\n    bool gap = false\n\n// One entry model's state")
rep("    float rHi = na\n    int rT\n","    float rHi = na\n    int rT\n    int parId = 0\n")
rep("type Area\n    string kind\n","type Area\n    int id\n    string kind\n")
rep("    int tc = 0\n    bool nw = false\n    array<float> O","    int tc = 0\n    bool nw = false\n    int cnt = 0\n    int idx = 0\n    int firstMs = 0\n    int lastMs = 0\n    bool gap = false\n    bool bad = false\n    int dropN = 0\n    int doneN = 0\n    array<float> O")
rep("    bool fibDone = false\n    int stdSt = 0","    int fibSt = 0\n    float fibPx = na\n    int fibOp = 0\n    int fibKn = 0\n    bool brkDone = false\n    int stdSt = 0")
rep("type Rg\n","""// A confirmed source-timeframe swing (known only when its right-side candles closed) and the order block associated with it
type Sw
    int side
    float px
    int open
    int kn
    float bLo = na
    float bHi = na

type Rg
""")
rep("var array<Pv> eqP = array.new<Pv>()","var array<Pv> eqP = array.new<Pv>()\nvar array<Sw> swgs = array.new<Sw>()")
rep("var array<int> cxN = array.new_int(6, 0)          // 0 level id, 1 setup id, 2 fvg id, 3 last trading-day key, 4 bars in window today","var array<int> cxN = array.new_int(6, 0)          // 0 level id, 1 setup id, 2 fvg id, 3 last trading-day key, 4 area id")
rep("var array<int> biasS = array.new_int(7, 0)        // per aggregated timeframe: 1 bullish, -1 bearish, 0 neutral\nvar array<int> biasT = array.new_int(7, na)       // availability timestamp (candle close); na = unavailable",
    "var array<int> prbS = array.new_int(7, 0)         // prior-range breakout state per aggregated timeframe: 1 up, -1 down, 0 none yet (NOT a CISD)\nvar array<int> prbT = array.new_int(7, na)        // availability timestamp (completed candle close); na = unavailable")
src=src.replace("biasS.","prbS.").replace("biasT.","prbT.")
# ---------------- inputs
rep('bool inBiasD = input.bool(false, "Filter: Daily bias must agree", group = G12, tooltip = "Bias per timeframe uses only COMPLETED candles: bullish after a close above the previous candle\'s high, bearish after a close below its low, otherwise unchanged. Our mechanical approximation.")',
    'bool inBiasD = input.bool(false, "Filter: Daily prior-range breakout state must agree (NOT a CISD)", group = G12, tooltip = "Prior-range breakout state per timeframe, from COMPLETED candles only: +1 after a close above the previous candle\'s high, -1 after a close below its low, otherwise it PERSISTS unchanged (0 until the first breakout). It resets to unavailable when that timeframe loses a candle (incomplete data). It is NOT the opposing-delivery-leg CISD used for the setup.")')
for a,b in (("4H","4H"),("1H","1H"),("30m","30m"),("15m","15m")):
    rep('"Filter: %s bias must agree"'%a,'"Filter: %s prior-range breakout state must agree"'%b)
rep('bool inAlExit = input.bool(true, "Alert: simulated stop / target / time exit", group = G8)','bool inAlExit = input.bool(true, "Alert: simulated stop / target / time exit", group = G8)\nint inCxMiss = input.int(0, "Aggregation: missing 1m candles tolerated per higher-timeframe candle (0 = strict)", minval = 0, maxval = 30, group = G10, tooltip = "A synthetic 5m/15m/30m/1H/4H/Daily candle is published only when all its expected 1m candles are present (scheduled 17:00-18:00 break excluded). TradingView has no bar for a minute without trades, so thin sessions can lose candles; this tolerance trades strictness for availability. Dropped candles are counted in the info panel.")')
# ---------------- Legacy execution-safety fixes
rep("""        if stopHit and tgtTouch
            t.maeP := math.max(t.maeP, t.riskPts)
            t.excUnc := true
            f_finish(md, 4, stp, time, "ambiguous: stop and target both reachable on the fill candle")
        else if stopHit
            t.maeP := math.max(t.maeP, t.riskPts)
            f_finish(md, 2, stp, time, "stop hit on the fill candle")
        else if known and tgtTouch
            t.mfeP := math.max(t.mfeP, math.abs(tgt - lim))
            f_finish(md, 1, tgt, time, "target hit on the fill candle (fill at the open)")
    true

f_fillStep""","""        bool gapStop = bull ? open <= stp : open >= stp
        if gapStop
            // EXECUTION POLICY (gap through entry AND stop): the resting limit was active, so it is NOT assumed cancelled. It is assumed filled at the
            // limit price (no price improvement) and stopped at the open (adverse gap). The real fill/exit prices cannot be known from OHLC, so the trade
            // is flagged ambiguous (counted as a loss at the worse of the two bounds) and counted separately as a gap event.
            t.gap := true
            t.maeP := math.max(t.maeP, bull ? lim - open : open - lim)
            t.excUnc := true
            f_finish(md, 4, open, time, "gap through entry AND stop: resting limit assumed filled at the limit, stopped at the open (conservative, ambiguous)")
        else if stopHit and tgtTouch
            t.maeP := math.max(t.maeP, t.riskPts)
            t.excUnc := true
            f_finish(md, 4, stp, time, "ambiguous: stop and target both reachable on the fill candle")
        else if stopHit
            t.maeP := math.max(t.maeP, t.riskPts)
            f_finish(md, 2, stp, time, "stop hit on the fill candle")
        else if known and tgtTouch
            t.mfeP := math.max(t.mfeP, math.abs(tgt - lim))
            f_finish(md, 1, tgt, time, "target hit on the fill candle (fill at the open)")
    true

f_fillStep""")
repl_fn('f_fillStep','''f_fillStep(Day dy, Mdl md) =>
    // A resting limit is never assumed cancelled before a gap: a candle that opens beyond the manipulation extreme goes through the shared fill logic
    // (touch -> fill; open beyond the stop -> flagged gap event). Earlier versions silently invalidated such orders (optimistic).
    f_fillTry(dy, md)
    true''')
rep("""    else if (bull ? open <= md.stp : open >= md.stp)
        f_invalidate(md, "local stop level breached before the fill (the candle opened beyond the stop)")
    else if (bull ? open < dy.mExt : open > dy.mExt)
        f_invalidate(md, "shared setup invalidated: the candle opened beyond the frozen manipulation extreme")
    else
        bool touchE = bull ? low <= md.lim - thrP : high >= md.lim + thrP""","""    else
        // gap candles are NOT cancelled here (see f_fillTry: resting limit assumed filled, flagged gap event)
        bool touchE = bull ? low <= md.lim - thrP : high >= md.lim + thrP""")
# f_perf gap handling
rep("                else if t.outcome == 4 and inAmbMode == \"Exclude from stats\"\n","                else if t.outcome == 4 and inAmbMode == \"Exclude from stats\" and not t.gap\n")
rep("    int n4 = 0\n    int n5 = 0\n","    int n4 = 0\n    int n5 = 0\n    int nGap = 0\n")
rep("                    if t.outcome == 4\n                        amb += 1\n","                    if t.outcome == 4\n                        amb += 1\n                    if t.gap\n                        nGap += 1\n")
rep("    r.set(32, n5)\n","    r.set(32, n5)\n    r.set(33, nGap)\n")
open(P,'w').write(src)
print('stage1 ok')
