# Builds the stand-alone LEGACY indicator (10am retest engine) from the pre-contextual source + the audit execution-safety corrections.
import re
src=open('/home/user/prestonhillestates/tests/c_before_powell.pine').read()
def rep(a,b,c=1):
    global src
    assert src.count(a)==c,(a[:70],src.count(a)); src=src.replace(a,b)
def fn_span(name):
    i=src.index('\n'+name+'(')+1
    m=re.search(r'\n(?=\S)', src[i+len(name):]); return i, i+len(name)+m.start()+1
rep('indicator("H Ticks — 10AM Precision Model C", shorttitle = "H Ticks C"','indicator("H Ticks — 10AM Precision Model C (Legacy)", shorttitle = "H Ticks C Legacy"')
rep("// H Ticks — 10AM Precision Model C  (indicator C: a NEW, separate indicator; A and B are untouched)","// H Ticks — 10AM Precision Model C (LEGACY 10am engine). Split out of Powell Model C because the combined script exceeded TradingView's 100,256-token limit (CE10117).\n// Contains the audit execution-safety correction: no silent cancellation before a gap (see gap policy in f_fillTry).")
rep("    float riskUsd = 0.0\n\n// One entry model's state","    float riskUsd = 0.0\n    bool gap = false\n\n// One entry model's state")
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
i,j=fn_span('f_fillStep')
src=src[:i]+'''f_fillStep(Day dy, Mdl md) =>
    // A resting limit is never assumed cancelled before a gap: a candle that opens beyond the manipulation extreme goes through the shared fill logic
    // (touch -> fill; open beyond the stop -> flagged gap event). Earlier versions silently invalidated such orders (optimistic).
    f_fillTry(dy, md)
    true

'''+src[j:]
rep("""    else if (bull ? open <= md.stp : open >= md.stp)
        f_invalidate(md, "local stop level breached before the fill (the candle opened beyond the stop)")
    else if (bull ? open < dy.mExt : open > dy.mExt)
        f_invalidate(md, "shared setup invalidated: the candle opened beyond the frozen manipulation extreme")
    else
        bool touchE""","""    else
        // gap candles are NOT cancelled here (see f_fillTry: resting limit assumed filled, flagged gap event)
        bool touchE""")
# perf: exclusion, counter, row
rep("                else if t.outcome == 4 and inAmbMode == \"Exclude from stats\"\n","                else if t.outcome == 4 and inAmbMode == \"Exclude from stats\" and not t.gap\n")
rep("    int winLow = 0\n    int nW = 0\n","    int winLow = 0\n    int nW = 0\n    int nGap = 0\n")
rep("                    if t.outcome == 4\n                        amb += 1\n","                    if t.outcome == 4\n                        amb += 1\n                    if t.gap\n                        nGap += 1\n")
rep("    r.set(30, cntT > 0 ? sumRisk / cntT : na)\n","    r.set(30, cntT > 0 ? sumRisk / cntT : na)\n    r.set(31, nGap)\n")
rep('"Avg plan R / real net R", "Avg actual risk USD")','"Avg plan R / real net R", "Avg actual risk USD", "Gap-through-entry events")')
rep("        for r = 0 to 17\n            f_cell(tbPerf, 0, r + 1, pr.get(r), blk, bgN)","        for r = 0 to 18\n            f_cell(tbPerf, 0, r + 1, pr.get(r), blk, bgN)")
rep('                    else\n                        v := f_fmt(pf.get(k, 30), "#")','                    else if r == 17\n                        v := f_fmt(pf.get(k, 30), "#")\n                    else\n                        v := str.tostring(pf.get(k, 31), "#")')
rep("var table tbPerf = table.new(position.bottom_right, 6, 19,","var table tbPerf = table.new(position.bottom_right, 6, 20,")
rep("        table.clear(tbPerf, 0, 0, 5, 18)","        table.clear(tbPerf, 0, 0, 5, 19)")
open('/home/user/prestonhillestates/H_Ticks_C_Legacy_10AM.pine','w').write(src)
print('legacy file', len(src))
