import re
exec(open('/home/user/prestonhillestates/tests/patch_ui1.py').read().split('# ---------- types / state')[0])
src=open(P).read()
# ---- table declarations
rep("var table tbInfo = table.new(position.middle_left, 1, 16,","var table tbInfo = table.new(position.middle_left, 1, 11,")
rep("var table tbFun = table.new(position.top_right, 6, 16,","var table tbFun = table.new(position.middle_right, 5, 16,")
rep("var table tbPerf = table.new(position.bottom_right, 6, 21,","var table tbPerf = table.new(position.bottom_right, 5, 21,")
i=src.index("f_cxTables() =>"); j=src.index("bool drawNow")
tables='''var table tbSum = table.new(position.top_right, 1, 7, bgcolor = color.new(color.white, 8), border_width = 1, border_color = color.gray)
var table tbRec = table.new(position.top_center, 2, 24, bgcolor = color.new(color.white, 8), border_width = 1, border_color = color.gray)
var table tbSet = table.new(position.bottom_center, 7, 14, bgcolor = color.new(color.white, 8), border_width = 1, border_color = color.gray)

// ---- default view: ONE small summary panel ----
f_cxSumStat(int slot) =>
    array<float> a = f_perf(slot, "")
    string s = "0 trades"
    if a.get(0) + a.get(24) > 0
        s := str.tostring(a.get(0), "#") + " closed (" + str.tostring(a.get(1), "#") + "W/" + str.tostring(a.get(2), "#") + "L/" + str.tostring(a.get(3), "#") + "T)" + (a.get(24) > 0 ? " +" + str.tostring(a.get(24), "#") + " open" : "") + " | net win " + f_fmt(a.get(5), "#.0") + "% | net " + f_fmt(a.get(13), "#.00") + "R"
    s

f_cxSetupTxt() =>
    Setup st = f_cxCur()
    string s = "none yet"
    if not na(st)
        string base = "#" + str.tostring(st.id) + " " + (st.dir > 0 ? "LONG" : "SHORT") + " swept " + st.lvl.ty + " " + str.tostring(st.lvl.px, format.mintick)
        if st.st == 1
            s := base + " | waiting for a close through CISD ref " + str.tostring(st.cisdRef, format.mintick)
        else if st.st == 2
            s := base + " | CISD " + f_hm(st.cisdT) + ", " + str.tostring(st.areas.size()) + " area(s), " + (f_cxArmWin() ? "entry window OPEN" : "waiting for the entry window")
        else
            s := base + " | ended: " + st.why
    s

f_cxSummary() =>
    color blk = color.black
    int maxN = 0
    for t in trades
        maxN += 1
    string pTxt = "PREC: OFF - tick 'COMPARE Standard and Precision' or select Precision"
    if slotOn.get(SC_PRE)
        pTxt := "PREC: " + f_cxSumStat(SC_PRE)
    string sTxt = "STD: not simulated (variant = Precision only; tick COMPARE to run both)"
    if slotOn.get(SC_STD)
        sTxt := "STD: " + f_cxSumStat(SC_STD)
    string rs = lastRsn.get(0)
    if str.length(rs) > 78
        rs := str.substring(rs, 0, 78)
    int dropped = 0
    for i = 1 to 6
        dropped += aggs.get(i).dropN
    string warn = maxN < 30 ? "SAMPLE: " + str.tostring(maxN) + " trade(s) - too few to show an edge" : "Sample: " + str.tostring(maxN) + " trades (still not proof)"
    warn += " | days " + str.tostring(cv.get(0)) + " (" + str.tostring(cv.get(2)) + " partial, " + str.tostring(cv.get(3) + cv.get(5)) + " unusable)" + (dropped > 0 ? " | " + str.tostring(dropped) + " HTF candles dropped" : "")
    f_cell(tbSum, 0, 0, "H Ticks C | Contextual | " + inVariant + (inCmpVar ? " + comparison" : "") + " | research sim", color.white, color.new(color.maroon, 10))
    f_cell(tbSum, 0, 1, "Setup: " + f_cxSetupTxt(), blk, na)
    f_cell(tbSum, 0, 2, sTxt, blk, na)
    f_cell(tbSum, 0, 3, pTxt, slotOn.get(SC_PRE) ? blk : color.red, na)
    f_cell(tbSum, 0, 4, "Last reject: " + (rs == "" ? "-" : rs), blk, na)
    f_cell(tbSum, 0, 5, warn, maxN < 30 ? color.red : blk, na)
    f_cell(tbSum, 0, 6, inDbgMode ? "Debug mode ON" : "Full tables: Settings > Display > DEBUG MODE", color.gray, na)
    true

// ---- debug view ----
f_cxPrbTxt(int ix, string nm) =>
    string s = nm + " n/a"
    if not na(prbT.get(ix))
        s := nm + " " + (prbS.get(ix) > 0 ? "up" : (prbS.get(ix) < 0 ? "down" : "none yet")) + " (" + f_hm(prbT.get(ix)) + ")"
    s

f_cxCols() =>
    array<int> c = array.new_int(0)
    if slotOn.get(SC_STD)
        c.push(5)
    if slotOn.get(SC_PRE)
        c.push(6)
        if inPFibOn
            c.push(7)
        if inPRejOn
            c.push(8)
    c

f_cxDbgInfo() =>
    color blk = color.black
    int wk = not na(firstKey) and not na(lastKey) ? f_weekdays(firstKey, lastKey) : 0
    string rng = not na(firstKey) ? f_dt(firstKey) + " to " + f_dt(lastKey) : "none"
    string agTxt = "5m " + str.tostring(aggs.get(1).doneN) + "/" + str.tostring(aggs.get(1).dropN) + " 15m " + str.tostring(aggs.get(2).doneN) + "/" + str.tostring(aggs.get(2).dropN) + " 1H " + str.tostring(aggs.get(4).doneN) + "/" + str.tostring(aggs.get(4).dropN) + " 4H " + str.tostring(aggs.get(5).doneN) + "/" + str.tostring(aggs.get(5).dropN) + " D " + str.tostring(aggs.get(6).doneN) + "/" + str.tostring(aggs.get(6).dropN)
    string tAud = "-"
    if plans.size() > 0
        for i = plans.size() - 1 to 0
            if plans.get(i).tgtAud != ""
                tAud := "#" + str.tostring(plans.get(i).sid) + " " + plans.get(i).meth + " target: " + plans.get(i).tgtAud
                break
    f_cell(tbInfo, 0, 0, "DEBUG | Contextual | " + syminfo.ticker + " | research model, profitability UNPROVEN, our reading of the guide", color.white, color.new(color.maroon, 10))
    f_cell(tbInfo, 0, 1, "Data (loaded history): " + rng + " | window " + inCxWin + " NY, hard exit " + inCxHard + " | weekdays done " + str.tostring(cv.get(0)) + " of " + str.tostring(wk) + " (complete " + str.tostring(cv.get(1)) + ", partial " + str.tostring(cv.get(2)) + ", no window candle " + str.tostring(cv.get(3)) + ", levels n/a " + str.tostring(cv.get(5)) + ")", blk, na)
    f_cell(tbInfo, 0, 2, "HTF candles built/dropped: " + agTxt + " (tolerance " + str.tostring(inCxMiss) + ")", blk, na)
    f_cell(tbInfo, 0, 3, "Prior-range breakout state, NOT CISD: " + f_cxPrbTxt(6, "D") + " | " + f_cxPrbTxt(5, "4H") + " | " + f_cxPrbTxt(4, "1H") + " | " + f_cxPrbTxt(3, "30m") + " | " + f_cxPrbTxt(2, "15m"), blk, na)
    f_cell(tbInfo, 0, 4, "Current setup: " + f_cxSetupTxt(), blk, na)
    f_cell(tbInfo, 0, 5, "STANDARD: limit at area CE, stop beyond the sweep extreme +" + str.tostring(inCxBuf) + "t (cap " + str.tostring(inCxCap) + "t), min " + str.tostring(inCxMinR, "#.0") + "R, " + (inCxTgt == "Fixed R" ? "fixed " + str.tostring(inCxFixR, "#.0") + "R" : "nearest unswept liquidity"), blk, na)
    f_cell(tbInfo, 0, 6, "PRECISION: " + (inPFibOn ? "Fib " + str.tostring(inFibE, "#.000") + " " : "") + (inPRejOn ? "rejection CE on " + inRejTf : "") + " | cap " + str.tostring(inCxPCap) + "t buf " + str.tostring(inCxPBuf) + " | min " + str.tostring(inCxPMinR, "#.0") + "R | " + inSeq, blk, na)
    f_cell(tbInfo, 0, 7, "Costs " + (inComm == 0.0 and inSlip == 0 ? "ZERO (net = gross)" : str.tostring(inComm, "#.00") + "/side, " + str.tostring(inSlip) + "t slip") + " | size " + (inSizeMode == "Fixed cash risk" ? str.tostring(inCashRisk, "#") + " USD risk" : str.tostring(inQty) + " contract(s)") + " | fills " + (inStrict ? "trade-through" : "touch assumed"), blk, na)
    f_cell(tbInfo, 0, 8, "Latest " + tAud, blk, na)
    f_cell(tbInfo, 0, 9, "Unswept levels superseded by a newer same-type level (no longer targets): " + str.tostring(cxN.get(5)) + " | not implemented: NWOG/NDOG, trailing, SMT target role", blk, na)
    f_cell(tbInfo, 0, 10, "Limits: OHLC order inside a candle is unknowable (ambiguous = loss); a touched limit is an assumption; drawdown = closed trades only.", blk, na)
    true

f_cxDbgFun() =>
    color blk = color.black
    color bgH = color.new(color.silver, 30)
    string[] rows = array.from("Eligible days", "Setups created (sweeps)", "CISD confirmed", "Setups with an eligible area", "Candidates evaluated", "Orders armed", "Filled trades", "Unfilled/expired/cancel", "Stop rejections", "Invalidated", "Ambiguous trades", "No-target rejections", "Filter rejections / stale", "Min-R rejections", "Sizing rejections")
    string[] cn = array.from("", "", "", "", "", "STD", "PREC", "PREC-Fib", "PREC-Rej")
    array<int> cs = f_cxCols()
    f_cell(tbFun, 0, 0, "FUNNEL - candidate/order rows are per variant and NOT exclusive; setup rows are shared", blk, bgH)
    for c = 0 to 3
        if c < cs.size()
            f_cell(tbFun, c + 1, 0, cn.get(cs.get(c)), blk, bgH)
    for r = 0 to NF - 1
        f_cell(tbFun, 0, r + 1, rows.get(r), blk, na)
        for c = 0 to 3
            if c < cs.size()
                f_cell(tbFun, c + 1, r + 1, str.tostring(fnl.get(cs.get(c) * NF + r)), blk, na)
    true

f_cxDbgPerf() =>
    color blk = color.black
    color bgH = color.new(color.silver, 30)
    string[] pr = array.from("Closed trades", "W / L / time / ambig", "Net win rate % (filled)", "Expectancy gross / net R", "Profit factor (net)", "Avg win / avg loss R", "Max losing streak", "Closed DD  R / USD", "Net total  R / USD", "Avg MAE pts / R", "Median MAE all  pts / R", "Median MAE wins  pts / R", "Wins with MAE <= 0.25R %", "Avg MFE pts / R", "Uncertain / open trades", "Avg stop (ticks)", "Avg plan R / real net R", "Avg actual risk USD", "Planned >=4R / >=5R trades", "Gap-through-entry events")
    string[] cn = array.from("", "", "", "", "", "STD", "PREC", "PREC-Fib", "PREC-Rej")
    array<int> cs = f_cxCols()
    f_cell(tbPerf, 0, 0, "PERFORMANCE (MAE/MFE = bounds)", blk, bgH)
    for r = 0 to 19
        f_cell(tbPerf, 0, r + 1, pr.get(r), blk, na)
    for c = 0 to 3
        if c < cs.size()
            int k = cs.get(c)
            f_cell(tbPerf, c + 1, 0, cn.get(k), blk, bgH)
            array<float> pa = f_perf(k == 5 ? 5 : 6, k == 7 ? "Fib 0.705" : (k == 8 ? "Rejection CE" : ""))
            for r = 0 to 19
                f_cell(tbPerf, c + 1, r + 1, f_perfStr(pa, r), blk, na)
    true

f_cxDbgLed() =>
    color blk = color.black
    color bgH = color.new(color.silver, 30)
    int perPage = 10
    int sel = inLedModel == "Ctx Standard" ? 5 : (inLedModel == "Ctx Precision" ? 6 : -1)
    array<int> idx = array.new_int(0)
    if trades.size() > 0
        for i = trades.size() - 1 to 0
            Trade tt = trades.get(i)
            if tt.slot >= 5 and (sel < 0 or tt.slot == sel)
                idx.push(i)
    int pages = math.max(1, int(math.ceil(idx.size() / 10.0)))
    int pg = math.min(inLedPage, pages)
    string[] hd = array.from("Date", "Dir", "Method", "Swept", "Entry", "Stop", "Target", "Fill", "Exit", "Outcome", "Net R", "Reason (incl. target audit)")
    for c = 0 to 11
        f_cell(tbLed, c, 0, (c == 0 ? "LEDGER " + str.tostring(pg) + "/" + str.tostring(pages) + " " : "") + hd.get(c), blk, bgH)
    for r = 0 to perPage - 1
        int pos = (pg - 1) * perPage + r
        if pos < idx.size()
            Trade t = trades.get(idx.get(pos))
            string oc = t.isOpen ? "OPEN" : (t.outcome == 1 ? "TARGET" : (t.outcome == 2 ? "STOP" : (t.outcome == 3 ? "TIME EXIT" : "AMBIGUOUS")))
            string why = t.note + (t.entryAmb ? " [entry-candle ambiguity]" : "")
            string mth = (t.slot == SC_STD ? "STD " : "PREC ") + t.meth
            string[] cells = array.from(f_dt(t.dayKey), t.dir > 0 ? "LONG" : "SHORT", mth, str.tostring(t.lvl, format.mintick), str.tostring(t.entryPx, format.mintick), str.tostring(t.stopPx, format.mintick), str.tostring(t.tgtPx, format.mintick), f_hms(t.fillT), t.isOpen ? "-" : f_hms(t.exitT), oc, f_fmt(t.netR, "#.00"), str.length(why) > 120 ? str.substring(why, 0, 120) : why)
            for c = 0 to 11
                f_cell(tbLed, c, r + 1, cells.get(c), blk, na)
        else
            for c = 0 to 11
                f_cell(tbLed, c, r + 1, "", blk, na)
    true

f_cxDbgWhy() =>
    color blk = color.black
    color bgH = color.new(color.silver, 30)
    f_cell(tbWhy, 0, 0, "WHY NO TRADE? latest day (newest last)", blk, bgH)
    int nr = dayWhy.size()
    int w0 = math.max(0, nr - 9)
    for r = 0 to 8
        f_cell(tbWhy, 0, r + 1, w0 + r < nr ? dayWhy.get(w0 + r) : "", blk, na)
    f_cell(tbWhy, 0, 10, "Cumulative reasons (all loaded days):", blk, bgH)
    for r = 0 to 8
        f_cell(tbWhy, 0, r + 11, r < rjK.size() ? rjK.get(r) + ": " + str.tostring(rjC.get(r)) : "", blk, na)
    true

f_cxDbgRec() =>
    color blk = color.black
    color bgH = color.new(color.silver, 30)
    int tot = rcN.get(15)
    int sumC = 0
    f_cell(tbRec, 0, 0, "SETUP-LEVEL RECONCILIATION: each area-qualified setup is counted ONCE", blk, bgH)
    f_cell(tbRec, 1, 0, "setups", blk, bgH)
    for c = 0 to 13
        int v = c < 13 ? rcN.get(c) : math.max(0, tot - sumC)
        sumC += c < 13 ? v : 0
        f_cell(tbRec, 0, c + 1, f_cxRecLabel(c), blk, na)
        f_cell(tbRec, 1, c + 1, str.tostring(v), blk, na)
    f_cell(tbRec, 0, 15, "Area-qualified setups (total)", blk, bgH)
    f_cell(tbRec, 1, 15, str.tostring(tot), blk, bgH)
    f_cell(tbRec, 0, 16, "SWEEPS IGNORED while a setup was active (by blocker):", blk, bgH)
    f_cell(tbRec, 1, 16, "", blk, bgH)
    string[] bl = array.from("blocker waiting for its CISD", "blocker CISD done, no order yet", "blocker IDLE (attempts used, nothing pending)", "blocker has an order pending/open")
    for b = 0 to 3
        f_cell(tbRec, 0, b + 17, bl.get(b), blk, na)
        f_cell(tbRec, 1, b + 17, str.tostring(blkC.get(b)), blk, na)
    f_cell(tbRec, 0, 21, "Setup counters are exclusive; funnel candidate/order counters are per variant.", blk, na)
    f_cell(tbRec, 1, 21, "", blk, na)
    true

f_cxDbgSet() =>
    color blk = color.black
    color bgH = color.new(color.silver, 30)
    string[] hd = array.from("Setup", "Dir", "Swept level", "CISD", "Areas", "Cands", "Outcome")
    for c = 0 to 6
        f_cell(tbSet, c, 0, hd.get(c), blk, bgH)
    int row = 1
    if sets.size() > 0
        for i = sets.size() - 1 to 0
            Setup q = sets.get(i)
            if q.hadArea and row <= 13
                string oc = q.st == 8 ? q.endCat : "active: " + (q.st == 1 ? "waiting CISD" : "CISD done")
                string[] cells = array.from("#" + str.tostring(q.id) + " " + str.format_time(q.swT, "MM-dd HH:mm", TZ), q.dir > 0 ? "LONG" : "SHORT", q.lvl.ty + " " + str.tostring(q.lvl.px, format.mintick), f_hm(q.cisdT), str.tostring(q.areas.size()), str.tostring(q.candN), oc)
                for c = 0 to 6
                    f_cell(tbSet, c, row, cells.get(c), blk, na)
                row += 1
    while row <= 13
        for c = 0 to 6
            f_cell(tbSet, c, row, "", blk, na)
        row += 1
    true

f_cxDebugAll() =>
    f_cxDbgInfo()
    f_cxDbgWhy()
    f_cxDbgRec()
    f_cxDbgSet()
    if inFunnel
        f_cxDbgFun()
    if inPerf
        f_cxDbgPerf()
    if inLedger
        f_cxDbgLed()
    true

f_cxClearDebug() =>
    table.clear(tbInfo, 0, 0, 0, 10)
    table.clear(tbFun, 0, 0, 4, 15)
    table.clear(tbPerf, 0, 0, 4, 20)
    table.clear(tbLed, 0, 0, 11, 11)
    table.clear(tbWhy, 0, 0, 0, 19)
    table.clear(tbRec, 0, 0, 1, 23)
    table.clear(tbSet, 0, 0, 6, 13)
    true

'''
src=src[:i]+tables+src[j:]
# remove the old duplicated declarations that came before f_cxTables (f_cxPrbTxt old + tbWhy stays)
i=src.index("f_cxPrbTxt(int ix, string nm) =>"); j=src.index("f_perfStr(array<float> a, int r) =>")
src=src[:i]+src[j:]
# dispatch
i=src.index("    if inCxVisCtx\n        f_cxDrawLevels()"); 
src=src[:i]+'''    Setup cs = f_cxCur()
    if inCxVisCtx
        if not na(cs) and (cs.st == 1 or cs.st == 2)
            f_cxDrawSetup(cs)
        if inCxHistCtx
            for q in sets
                if shownKeys.includes(q.dayKey) and q.st == 8
                    f_cxDrawSetup(q)
    if inCxVisLevels
        f_cxDrawLevels()
    // trade boxes: latest PENDING plan per variant, every open position, and the last N completed trades per variant
    array<int> pendShown = array.new_int(9, 0)
    array<int> doneShown = array.new_int(9, 0)
    if plans.size() > 0 and inVisPlan
        for i = plans.size() - 1 to 0
            Mdl md = plans.get(i)
            if slotOn.get(md.slot)
                bool draw = false
                if md.st == 3
                    draw := true
                else if md.st == 2 and pendShown.get(md.slot) == 0
                    draw := true
                    pendShown.set(md.slot, 1)
                else if md.st == 4 and not na(md.tr) and doneShown.get(md.slot) < inCxNDone
                    draw := true
                    doneShown.set(md.slot, doneShown.get(md.slot) + 1)
                if draw
                    f_cxDrawPlan(md)
    f_cxSummary()
    if inDbgMode
        f_cxDebugAll()
    else
        f_cxClearDebug()
'''
open(P,'w').write(src)
print('ui5 ok')
