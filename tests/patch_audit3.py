import re
exec(open('/home/user/prestonhillestates/tests/patch_audit1.py').read().split('# ---------------- types')[0])
src=open(P).read()

# ---------- pick with a "known before" bound
rep("f_cxPick(Setup st, bool execSide) =>","f_cxPick(Setup st, bool execSide, int beforeT) =>")
rep("        bool okA = not a.dead and a.known <= time_close\n","        bool okA = not a.dead and a.known <= beforeT\n")
rep("// executable side of the close (a buy limit below / sell limit above market).","// executable side of the close (a buy limit below / sell limit above market). Only areas known at or before beforeT are candidates (an area that is\n// created by the candle being judged can never be its own parent).")
rep("            Area area = f_cxPick(st, true)\n","            Area area = f_cxPick(st, true, time_close)\n")

# ---------- Fib: detection / tracking / arming separated
i=src.index("// ---- Precision A: Fib."); j=src.index("// ---- Precision B:")
newfib='''// ---- Precision A: Fib. Anchors = sweep extreme + the FIRST confirmed swing after the CISD (known only when its right side closed) ----
// Endpoint DETECTION, stale TRACKING and order ARMING are separate: the first eligible endpoint is stored with its original confirmation time whether or not
// the entry window is open, it is never replaced by a later swing, it becomes stale the moment price trades to the entry level, and it is armed only inside the
// entry window and only if it is still eligible then.
f_cxFibEntry(Setup st) =>
    bool bull = st.dir > 0
    float hx = bull ? st.fibPx : st.ext
    float lx = bull ? st.ext : st.fibPx
    float rg = hx - lx
    float e = bull ? hx - inFibE * rg : lx + inFibE * rg
    float ref = bull ? hx - inFibS * rg : lx + inFibS * rg
    [rg, e, ref]

f_cxFibDetect(Setup st, Agg A) =>
    if slotOn.get(SC_PRE) and inPFibOn and st.fibSt == 0
        bool bull = st.dir > 0
        int q = bull ? 0 : 1
        if not na(pvKn.get(q)) and pvKn.get(q) == time_close and pvOp.get(q) >= st.cisdOpen
            st.fibSt := 1
            st.fibPx := pvPx.get(q)
            st.fibOp := pvOp.get(q)
            st.fibKn := pvKn.get(q)
            f_fn(SC_PRE, 4)
            f_fn(7, 4)
            [rg, e, ref] = f_cxFibEntry(st)
            float eR = math.round_to_mintick(e)
            // stale: the candles AFTER the swing candle are all known now; if any already reached the entry it was traversed before the anchor existed
            bool trav = false
            int n = A.H.size()
            for i = 0 to n - 1
                if A.T0.get(i) > st.fibOp
                    trav := trav or (bull ? A.L.get(i) <= eR : A.H.get(i) >= eR)
            if rg <= 0
                st.fibSt := 3
                f_why("fib invalid", "Fib: the leg has no size")
                f_fn(SC_PRE, 8)
                f_fn(7, 8)
            else if trav or not (bull ? eR < close : eR > close)
                st.fibSt := 3
                f_why("stale fib", "Fib: " + str.tostring(inFibE, "#.000") + " (" + str.tostring(eR, format.mintick) + ") was already traversed before the swing anchor (confirmed " + f_hm(st.fibKn) + ") existed; no back-dated entry")
                f_fn(SC_PRE, 12)
                f_fn(7, 12)
    true

// every 1m candle: a stored candidate dies as soon as price trades to its entry level (a limit placed later would be retroactive)
f_cxFibTrack(Setup st) =>
    if st.fibSt == 1 and time >= st.fibKn
        [rg, e, ref] = f_cxFibEntry(st)
        float eR = math.round_to_mintick(e)
        if st.dir > 0 ? low <= eR : high >= eR
            st.fibSt := 3
            f_why("stale fib", "Fib: price traded to " + str.tostring(eR, format.mintick) + " after the anchor was confirmed (" + f_hm(st.fibKn) + ") and before an order could be armed")
            f_fn(SC_PRE, 12)
            f_fn(7, 12)
    true

f_cxFibArm(Setup st) =>
    if slotOn.get(SC_PRE) and st.fibSt == 1 and f_cxArmWin()
        [mult, firstRisk, why] = f_cxSeq(SC_PRE)
        if mult == 0.0
            if why != "busy"
                st.fibSt := 3
                f_why("daily sequence", "Precision Fib: " + why)
        else
            bool bull = st.dir > 0
            Mdl md = f_cxNewMdl(SC_PRE, st, "Fib 0.705")
            st.mdlP := md
            st.fibSt := 3
            md.fH := bull ? st.fibPx : st.ext
            md.fL := bull ? st.ext : st.fibPx
            // a VALID parent area is required for Precision (independent of the optional overlap filter below)
            Area par = f_cxPick(st, false, time_close)
            if na(par)
                f_cxDrop(md, "no valid parent area for Precision (none known, alive and eligible)", "no parent", 12)
            else
                md.areaK := par.kind
                md.aLo := par.lo
                md.aHi := par.hi
                md.aCe := par.ce
                md.parId := par.id
                [rg, e, ref] = f_cxFibEntry(st)
                float eR = math.round_to_mintick(e)
                if not (bull ? eR < close : eR > close)
                    f_cxDrop(md, "stale: the entry is no longer on the executable side of the market", "stale fib", 12)
                else if inFibArea and (eR < par.lo or eR > par.hi)
                    f_cxDrop(md, "Fib entry does not overlap the selected parent area (optional condition)", "filter", 12)
                else
                    string fl = f_cxFilters(st, par)
                    if fl != ""
                        f_cxDrop(md, fl, "filter", 12)
                    else if inFCe and f_cxCeProx(st, eR)
                        f_cxDrop(md, "engineered-liquidity proximity beyond the entry", "filter", 12)
                    else
                        float stopRaw = bull ? ref - inCxPBuf * tk : ref + inCxPBuf * tk
                        if f_cxPlan(st, md, e, stopRaw, inCxPCap, inCxPMinR, mult, firstRisk)
                            st.precSt := 1
    true

'''
src=src[:i]+newfib+src[j:]

# ---------- rejection: pre-existing parent, CISD sequence, frozen identity
rep("""    if slotOn.get(SC_PRE) and inPRejOn and st.precSt != 1 and f_cxArmWin()
        bool bull = st.dir > 0
        Area par = f_cxPick(st, false)
        if not na(par)""","""    // SEQUENCE: CISD confirmed -> parent area known -> THEN a rejection candle that OPENED after both. The candle cannot create its own parent.
    int rOpen = f_agI(R.T0, 0)
    if slotOn.get(SC_PRE) and inPRejOn and st.precSt != 1 and f_cxArmWin() and rOpen >= st.cisdT
        bool bull = st.dir > 0
        Area par = f_cxPick(st, false, rOpen)
        if not na(par)""")
rep("                    md.aCe := par.ce\n                    md.rLo := l0","                    md.aCe := par.ce\n                    md.parId := par.id\n                    md.rLo := l0")
# ---------- arm window weekday restriction
rep("f_cxArmWin() =>\n    mOpen >= winS and mOpen < cutM","// Entry eligibility is separate from context ingestion: orders may be armed only inside the window on Monday-Friday (NY calendar day of the candle).\n// Sunday-evening and overnight data still feed levels, ranges and aggregation.\nf_cxArmWin() =>\n    dowN >= dayofweek.monday and dowN <= dayofweek.friday and mOpen >= winS and mOpen < cutM")
# ---------- plan step: no cancellation before a gap
rep("""        else if md.slot == SC_PRE and (bull ? open <= md.stp : open >= md.stp)
            f_cxCancel(md, "local stop level breached before the fill (precision attempt ends; the larger setup may continue)", 9, false)
        else if bull ? open < md.xExt : open > md.xExt
            f_cxCancel(md, "invalidated: the candle opened beyond the frozen setup extreme", 9, true)
        else
            bool touchE""","""        else
            // No cancellation on a gap: an active resting limit is never assumed cancelled before the market gaps through it. A candle that opens beyond
            // the entry fills (touch), and one that opens beyond the STOP is a flagged gap event (see f_cxFillTry), never a silent non-trade.
            bool touchE""")
rep("""        if stopHit and tgtTouch
            t.maeP := math.max(t.maeP, t.riskPts)
            t.excUnc := true
            f_cxFinish(md, 4, stp, time, "ambiguous: stop and target both reachable on the fill candle")""","""        bool gapStop = bull ? open <= stp : open >= stp
        if gapStop
            // EXECUTION POLICY (gap through entry AND stop): the active resting limit is assumed filled at the limit price (no improvement) and stopped at
            // the open. Real prices cannot be known from OHLC, so the trade is flagged ambiguous, counted as a loss at the worse bound and counted as a gap event.
            t.gap := true
            t.maeP := math.max(t.maeP, bull ? lim - open : open - lim)
            t.excUnc := true
            f_cxFinish(md, 4, open, time, "gap through entry AND stop: resting limit assumed filled at the limit, stopped at the open (conservative, ambiguous)")
        else if stopHit and tgtTouch
            t.maeP := math.max(t.maeP, t.riskPts)
            t.excUnc := true
            f_cxFinish(md, 4, stp, time, "ambiguous: stop and target both reachable on the fill candle")""")
# ---------- f_cxBar: Sunday context, bad candles, fib flow
rep("    // coverage\n    if mOpen >= winS and mOpen < exitM\n        dy.bars10 += 1\n    if dy.st == 0 and mOpen >= winS\n","    // coverage (entry-day bookkeeping only: context ingestion below runs on EVERY candle, including Sunday evening)\n    if dy.active and mOpen >= winS and mOpen < exitM\n        dy.bars10 += 1\n    if dy.active and dy.st == 0 and mOpen >= winS\n")
rep("    if not na(st) and st.st == 2\n        f_cxAreaUpdate(st)\n    // 2)","    if not na(st) and st.st == 2\n        f_cxAreaUpdate(st)\n        f_cxFibTrack(st)\n    // 2)")
rep("    // 4) levels created at THIS candle's close\n    f_cxLevelsBar()\n    // 5) source candle / local rejection candle events\n    Agg A = f_cxSrc()\n    Agg R = aggs.get(inRejTf == \"1m\" ? 0 : 1)\n    if A.nw","    // 4) levels created at THIS candle's close\n    f_cxLevelsBar()\n    // 5) source candle / local rejection candle events\n    Agg A = f_cxSrc()\n    Agg R = aggs.get(inRejTf == \"1m\" ? 0 : 1)\n    if A.bad\n        f_cxSrcBad()\n    if A.nw")
rep("            f_cxTryFib(st, A)\n    st := f_cxCur()\n    if R.nw and not na(st) and st.st == 2","            f_cxFibDetect(st, A)\n    st := f_cxCur()\n    if not na(st) and st.st == 2\n        f_cxFibArm(st)\n    st := f_cxCur()\n    if R.nw and not na(st) and st.st == 2")
rep("f_cxBar(Day dy) =>","""// the source timeframe lost a candle: nothing may span the hole, and a setup that still waits for its CISD cannot be tracked
f_cxSrcBad() =>
    fvgs.clear()
    eqP.clear()
    swgs.clear()
    for q = 0 to 1
        pvPx.set(q, na)
        pvOp.set(q, na)
        pvKn.set(q, na)
    Setup st = f_cxCur()
    if not na(st) and st.st == 1
        st.st := 8
        st.why := "source candle incomplete (missing 1m data): CISD tracking cannot continue"
        f_why("incomplete data", "setup #" + str.tostring(st.id) + ": " + st.why)
    true

f_cxBar(Day dy) =>""")
# ---------- main loop
rep("    if cur.active\n        if isCx\n            f_cxBar(cur)\n        else\n            f_dayStep(cur)","    if isCx\n        f_cxBar(cur)\n    else if cur.active\n        f_dayStep(cur)")
# ---------- tables: gap row + aggregation completeness line
rep('"Avg actual risk USD", "Planned >=4R / >=5R trades")','"Avg actual risk USD", "Planned >=4R / >=5R trades", "Gap-through-entry events")')
rep("            for r = 0 to 18\n                f_cell(tbPerf, 0, r + 1, pr.get(r), blk, bgN)","            for r = 0 to 19\n                f_cell(tbPerf, 0, r + 1, pr.get(r), blk, bgN)")
rep("    else\n        v := str.tostring(a.get(31), \"#\") + \" / \" + str.tostring(a.get(32), \"#\")\n    v","    else if r == 18\n        v := str.tostring(a.get(31), \"#\") + \" / \" + str.tostring(a.get(32), \"#\")\n    else\n        v := str.tostring(a.get(33), \"#\")\n    v")
rep("var table tbPerf = table.new(position.bottom_right, 6, 20,","var table tbPerf = table.new(position.bottom_right, 6, 21,")
rep("        table.clear(tbPerf, 5, 0, 5, 18)\n    else\n        table.clear(tbPerf, 0, 0, 5, 18)\n    // ledger (newest first)","        table.clear(tbPerf, 5, 0, 5, 20)\n    else\n        table.clear(tbPerf, 0, 0, 5, 20)\n    // ledger (newest first)")
rep('''        f_cell(tbInfo, 0, 4, "No-bar weekdays: " + str.tostring(math.max(0, wk - evald)) + " (holiday/missing; never counted as 'no setup'). Warm-up: the range states need 2 consecutive complete candles.", blk, bgN)''','''        f_cell(tbInfo, 0, 4, "No-bar weekdays: " + str.tostring(math.max(0, wk - evald)) + " (never 'no setup'). Candles built / DROPPED as incomplete: 5m " + str.tostring(aggs.get(1).doneN) + "/" + str.tostring(aggs.get(1).dropN) + " 15m " + str.tostring(aggs.get(2).doneN) + "/" + str.tostring(aggs.get(2).dropN) + " 1H " + str.tostring(aggs.get(4).doneN) + "/" + str.tostring(aggs.get(4).dropN) + " 4H " + str.tostring(aggs.get(5).doneN) + "/" + str.tostring(aggs.get(5).dropN) + " D " + str.tostring(aggs.get(6).doneN) + "/" + str.tostring(aggs.get(6).dropN) + " (tolerance " + str.tostring(inCxMiss) + ")", blk, bgN)''')
open(P,'w').write(src)
print('stage3 ok')
