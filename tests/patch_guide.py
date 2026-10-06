import re
P='/home/user/prestonhillestates/H_Ticks_C_10AM_Precision.pine'
src=open(P).read()
def rep(a,b,c=1):
    global src
    n=src.count(a); assert n==c,(a[:80],n); src=src.replace(a,b)
# ---------- defaults and inputs
rep('string inCxWin = input.session("0930-1100",','string inCxWin = input.session("0930-1200",')
rep('string inCxHard = input.string("11:00",','string inCxHard = input.string("12:00",')
rep('string inCxMacroWin = input.session("0950-1010", "Macro window (NY, candle open times, end exclusive)", group = G10)','''string inCxMacroWin = input.session("0950-1010", "Macro window (NY, candle open times, end exclusive)", group = G10)
bool inGuide = input.bool(true, "GUIDE-FAITHFUL MODE (the Powell playbook as written in the guide)", group = G10, tooltip = "ON: only SIGNIFICANT liquidity starts a setup (previous day / regular session high-low, equal highs-lows, the 18:00-00:00 accumulation range); the sweep -> CISD is read on 15m; Standard enters on a CLOSING confirmation candle inside the zone (market at the next candle open) instead of a resting limit; the stop trails (+1R -> -0.5R, +2R -> break-even); win ends the day / one 50% retry after a non-win. OFF: the earlier behaviour, driven by the other settings.")
bool inGdH1 = input.bool(true, "Guide: the 1H CISD must agree with the setup direction", group = G10)
bool inGd4 = input.bool(false, "Guide: the 4H CISD must also agree", group = G10)
string inGdTrig = input.string("5m", "Guide: entry-trigger timeframe", options = ["1m", "5m"], group = G10)
int inGdCap = input.int(100, "Guide: maximum stop (ticks). Wider than this: use the local-structure stop; still wider: reject", minval = 1, group = G14)
bool inGdTrail = input.bool(true, "Guide: trail the stop (+1R -> stop at -0.5R, +2R -> break-even)", group = G14)''')
rep("int macE = f_mins(inCxMacroWin, 5)\n","int macE = f_mins(inCxMacroWin, 5)\nbool gd = inGuide\nstring srcTf = gd ? \"15m\" : inCxTf\nbool trailOn = gd and inGdTrail\n")
rep('    aggs.get(inCxTf == "1m" ? 0 : (inCxTf == "5m" ? 1 : 2))','    aggs.get(srcTf == "1m" ? 0 : (srcTf == "5m" ? 1 : 2))')
rep('    (inCxTf == "1m" ? 1 : (inCxTf == "5m" ? 5 : 15)) * chartMs','    (srcTf == "1m" ? 1 : (srcTf == "5m" ? 5 : 15)) * chartMs')
# ---------- levels in guide mode
rep("        if inCxLvCS\n","        if inCxLvCS and not gd\n")
rep("    if inCxLvOR\n","    if inCxLvOR and not gd\n")
rep('    f_cxRange(rgAS, inCxAs, "ASH", "ASL", inCxLvAS)','    f_cxRange(rgAS, gd ? "1800-0000" : inCxAs, "ASH", "ASL", inCxLvAS or gd)')
# ---------- Mdl field
rep("    string tgtAud = \"\"\n","    string tgtAud = \"\"\n    bool mkt = false\n")
# ---------- CISD tracker state + function
rep("var array<float> pvPx = array.new_float(2, na)","var array<int> ctS = array.new_int(7, 0)          // continuous CISD state per timeframe (1H = 4, 4H = 5): 1 bullish, -1 bearish\nvar array<int> ctT = array.new_int(7, na)\nvar array<int> ctRC = array.new_int(7, 0)\nvar array<float> ctRO = array.new_float(7, na)\nvar array<int> ctPC = array.new_int(7, 0)\nvar array<float> ctPO = array.new_float(7, na)\nvar array<float> pvPx = array.new_float(2, na)")
rep("f_cxPri(string ty) =>","""// CISD per timeframe, from COMPLETED candles: a candle that closes through the OPEN of the most recent opposing run (dojis end a run) flips the state.
// Reset to unavailable when that timeframe drops an incomplete candle.
f_cxCisdTrk(int ix, Agg a) =>
    if a.bad
        ctS.set(ix, 0)
        ctT.set(ix, na)
        ctRC.set(ix, 0)
        ctPC.set(ix, 0)
    if a.nw
        float o0 = f_ag(a.O, 0)
        float c0 = f_ag(a.C, 0)
        int col = c0 > o0 ? 1 : (c0 < o0 ? -1 : 0)
        if col == 0
            ctRC.set(ix, 0)
        else if col != ctRC.get(ix)
            ctPC.set(ix, ctRC.get(ix))
            ctPO.set(ix, ctRO.get(ix))
            ctRC.set(ix, col)
            ctRO.set(ix, o0)
        if col != 0 and ctPC.get(ix) == -col and (col > 0 ? c0 > ctPO.get(ix) : c0 < ctPO.get(ix))
            ctS.set(ix, col)
            ctT.set(ix, a.TC.last())
    true

f_cxPri(string ty) =>""")
rep("    for i = 2 to 6\n        f_cxPrb(i, aggs.get(i))\n","    for i = 2 to 6\n        f_cxPrb(i, aggs.get(i))\n    f_cxCisdTrk(4, aggs.get(4))\n    f_cxCisdTrk(5, aggs.get(5))\n")
# ---------- filters: HTF CISD agreement
rep("    if r == \"\" and inFPo3 and st.lvl.ty != \"PO3H\"","""    if r == "" and gd and (inGdH1 or inGd4)
        for q = 4 to 5
            if r == "" and (q == 4 ? inGdH1 : inGd4)
                if na(ctT.get(q)) or ctS.get(q) != st.dir
                    r := (q == 4 ? "1H" : "4H") + " CISD " + (na(ctT.get(q)) ? "unavailable" : "does not agree with the setup")
    if r == "" and inFPo3 and st.lvl.ty != "PO3H\"""")
# ---------- daily sequence in guide mode
rep('    else if inSeq != "One trade per day" and doneN == 1','    else if (gd or inSeq != "One trade per day") and doneN == 1')
# ---------- limit-at-CE Standard is replaced by the closing trigger in guide mode
rep("    if slotOn.get(SC_STD) and st.stdSt == 0 and f_cxArmWin()\n","    if slotOn.get(SC_STD) and st.stdSt == 0 and f_cxArmWin() and not gd\n")
# ---------- closing-trigger entry
rep("// ---- Precision A: Fib.","""// ---- Guide-faithful Standard: price returns into the PD array, then a CLOSING confirmation candle on the trigger timeframe ----
// Micro-CISD: the candle is in the setup direction, its close passes the OPEN of the retracement run (contiguous opposite candles) that went into the array,
// that run reached the array, the close is not beyond the array's far side, and the setup extreme is intact. The parent array must have been known before
// the trigger candle began. The order is a MARKET order filled at the NEXT candle's open; the stop is beyond the sweep extreme, or - if that exceeds the cap -
// beyond the local retracement extreme (the guide's "drop to a smaller rejection block"), or the setup is rejected.
f_cxTryTrig(Setup st, Agg T) =>
    int n = T.H.size()
    if gd and slotOn.get(SC_STD) and st.stdSt == 0 and f_cxArmWin() and n >= 2 and f_agI(T.T0, 0) >= st.cisdT
        bool bull = st.dir > 0
        float o0 = f_ag(T.O, 0)
        float c0 = f_ag(T.C, 0)
        bool run1 = bull ? f_ag(T.C, 1) < f_ag(T.O, 1) : f_ag(T.C, 1) > f_ag(T.O, 1)
        if (bull ? c0 > o0 : c0 < o0) and run1
            int j = n - 2
            while j - 1 >= 0 and (bull ? T.C.get(j - 1) < T.O.get(j - 1) : T.C.get(j - 1) > T.O.get(j - 1))
                j -= 1
            float ref = T.O.get(j)
            float ext = bull ? f_ag(T.L, 0) : f_ag(T.H, 0)
            for k = j to n - 2
                ext := bull ? math.min(ext, T.L.get(k)) : math.max(ext, T.H.get(k))
            Area par = f_cxPick(st, false, f_agI(T.T0, 0))
            if not na(par) and (bull ? c0 > ref and ext <= par.hi and c0 >= par.lo and ext > st.ext : c0 < ref and ext >= par.lo and c0 <= par.hi and ext < st.ext)
                [mult, firstRisk, why] = f_cxSeq(SC_STD)
                if mult == 0.0
                    if why != "busy"
                        st.stdSt := 2
                        st.seqBlock := st.candN == 0
                        f_why("daily sequence", "Standard: " + why)
                    else
                        st.busyBlock := st.candN == 0
                else
                    st.stdSt := 2
                    Mdl md = f_cxNewMdl(SC_STD, st, "Close trigger")
                    st.mdlS := md
                    md.mkt := true
                    md.areaK := par.kind
                    md.aLo := par.lo
                    md.aHi := par.hi
                    md.aCe := par.ce
                    md.parId := par.id
                    string fl = f_cxFilters(st, par)
                    if fl != ""
                        f_cxDrop(md, fl, "filter", 12)
                    else
                        float sA = bull ? st.ext - inCxBuf * tk : st.ext + inCxBuf * tk
                        float sB = bull ? ext - inCxPBuf * tk : ext + inCxPBuf * tk
                        float stopRaw = math.abs(c0 - sA) / tk <= inGdCap ? sA : sB
                        if f_cxPlan(st, md, c0, stopRaw, inGdCap, inCxMinR, mult, firstRisk)
                            st.stdSt := 1
    true

// ---- Precision A: Fib.""")
rep("    if R.nw and not na(st) and st.st == 2\n        f_cxTryRej(st, R)\n","    if R.nw and not na(st) and st.st == 2\n        f_cxTryRej(st, R)\n    st := f_cxCur()\n    Agg G = aggs.get(inGdTrig == \"1m\" ? 0 : 1)\n    if G.nw and not na(st) and st.st == 2\n        f_cxTryTrig(st, G)\n")
# ---------- plan message for market orders
rep('(bull ? "LONG" : "SHORT") + " limit " + str.tostring(entry, format.mintick) + " stop "','(bull ? "LONG" : "SHORT") + (md.mkt ? " MARKET at the next open (ref " : " limit ") + str.tostring(entry, format.mintick) + (md.mkt ? ")" : "") + " stop "')
# ---------- market fill at the next candle's open
rep("    else if md.st == 2 and bar_index > md.armBar\n        float thrP = inStrict ? tk : 0.0\n","    else if md.st == 2 and bar_index > md.armBar\n        if md.mkt and bar_index == md.armBar + 1\n            md.lim := math.round_to_mintick(open)\n            md.plannedR := math.abs(md.tgt - md.lim) / math.max(tk, math.abs(md.lim - md.stp))\n        float thrP = inStrict and not md.mkt ? tk : 0.0\n")
rep("    bool touch = bull ? low <= lim - thrP : high >= lim + thrP\n    if touch\n        bool known = bull ? open <= lim - thrP : open >= lim + thrP\n        float stp = md.stp\n        float tgt = md.tgt\n        Setup st = f_cxSetupBy(md.sid)","    bool touch = bull ? low <= lim - thrP : high >= lim + thrP\n    if touch\n        bool known = bull ? open <= lim - thrP : open >= lim + thrP\n        float stp = md.stp\n        float tgt = md.tgt\n        Setup st = f_cxSetupBy(md.sid)")
rep("    float lim = md.lim\n    float thrP = inStrict ? tk : 0.0\n    bool touch = bull ? low <= lim - thrP : high >= lim + thrP\n    if touch\n        bool known","    float lim = md.lim\n    float thrP = inStrict and not md.mkt ? tk : 0.0\n    bool touch = bull ? low <= lim - thrP : high >= lim + thrP\n    if touch\n        bool known")
# ---------- trailing stop (effective from the NEXT candle) + trailed-stop wording
rep('        t.excUnc := t.excUnc or fav > pMfe\n        f_cxFinish(md, 2, stp, time, "stop hit")','        t.excUnc := t.excUnc or fav > pMfe\n        f_cxFinish(md, 2, stp, time, stp != t.stopPx ? "stop hit (trailed)" : "stop hit")')
rep("    else\n        t.maeP := math.max(pMae, adv)\n        t.mfeP := math.max(pMfe, fav)\n    true\n\nf_cxCancel","""    else
        t.maeP := math.max(pMae, adv)
        t.mfeP := math.max(pMfe, fav)
        // trailing (guide management, our mechanical reading of 10 -> 5 -> break-even): +1R -> stop at -0.5R, +2R -> break-even; applies from the NEXT candle
        if trailOn
            float rk = t.riskPts
            if t.mfeP >= 2 * rk
                md.stp := bull ? math.max(md.stp, ent) : math.min(md.stp, ent)
            else if t.mfeP >= rk
                md.stp := math.round_to_mintick(bull ? math.max(md.stp, ent - 0.5 * rk) : math.min(md.stp, ent + 0.5 * rk))
    true

f_cxCancel""")
# ---------- summary header
rep('"H Ticks C | Contextual | " + inVariant + (inCmpVar ? " + comparison" : "") + " | research sim"','"H Ticks C | " + (gd ? "GUIDE mode" : "Contextual") + " | " + inVariant + (inCmpVar ? " + comparison" : "") + " | research sim"')
open(P,'w').write(src)
print('guide patch ok')
