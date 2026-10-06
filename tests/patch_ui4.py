import re
exec(open('/home/user/prestonhillestates/tests/patch_ui1.py').read().split('# ---------- types / state')[0])
src=open(P).read()
# ---------------- inputs
rep('bool inShowBoth = input.bool(true, "Display both variants on the chart (when both are simulated)", group = G0)\n','')
rep('bool inCmpVar = input.bool(false, "Compare both variants\' statistics (simulate Standard AND Precision)", group = G0, tooltip = "OFF = only the selected variant is simulated, so Standard behaves exactly as before. ON = both are simulated independently with separate equity and statistics.")',
    'bool inCmpVar = input.bool(false, "COMPARE Standard and Precision (simulate BOTH, draw both)", group = G0, tooltip = "OFF = only the selected variant is simulated, and the other is shown as OFF in the summary. ON = Standard AND Precision are simulated independently (separate orders, trades, equity, statistics) and both are drawn. Alerts are sent only for the variant selected above.")')
rep('bool inCxVisCtx = input.bool(true, "Draw live levels and the setup context (sweep, CISD, areas, target)", group = G16)','bool inCxVisCtx = input.bool(true, "Draw the CURRENT setup context (sweep, CISD reference, setup extreme)", group = G16)')
rep('bool inCxVisFib = input.bool(true, "Draw Fib anchors and levels", group = G16)','bool inCxVisFib = input.bool(false, "Draw Fib anchors and levels on Fib plans", group = G16)')
rep('bool inCxHist = input.bool(true, "Draw historical trades (OFF = latest day only)", group = G16)\nbool inCxCompact = input.bool(false, "Compact tables (performance + why-no-trade only)", group = G16)\n','')
rep('bool inAlExit = input.bool(true, "Alert: simulated stop / target / time exit", group = G8)','bool inDbgMode = input.bool(false, "DEBUG MODE: show the full funnel, reconciliation, ledger, coverage and diagnostic tables", group = G16, tooltip = "OFF (default) = one small summary panel only.")\nint inCxNDone = input.int(10, "Completed trade boxes kept on the chart (per variant)", minval = 0, maxval = 40, group = G16)\nbool inCxVisLevels = input.bool(false, "Draw live liquidity levels (clutter)", group = G16)\nbool inCxHistCtx = input.bool(false, "Historical context: also draw ended / superseded setups, truncated at their end", group = G16)\nbool inAlExit = input.bool(true, "Alert: simulated stop / target / time exit", group = G8)')
# ---------------- drawing section rewrite
i=src.index("// ───────────────────────────────── CONTEXTUAL DRAWINGS"); j=src.index("// ───────────────────────────────────────────── TABLES")
draw='''// ───────────────────────────────── CONTEXTUAL DRAWINGS ─────────────────────────────────
// Trade boxes use ONLY values frozen when the order was armed / filled / closed (never later information): black entry line, red risk box, green reward box.
// Pending = dashed, filled = solid, completed = solid plus an exit marker.
f_cxDrawPlan(Mdl md) =>
    if not na(md.lim)
        string pre = md.slot == SC_PRE ? "PREC" : "STD"
        bool done = md.st == 4 and not na(md.tr)
        bool pend = md.st == 2
        string sty = pend ? line.style_dashed : line.style_solid
        int xCut = f_ts(md.dayKey, cutM)
        int xEnd = f_ts(md.dayKey, exitM)
        int xe = xEnd
        if pend
            xe := math.min(xCut, md.armT + inCxExp * chartMs)
        else if done
            xe := md.tr.exitT
        int xs = pend ? md.armT : md.tr.fillT
        float distP = math.abs(md.lim - md.stp)
        int distT = int(math.round(distP / tk))
        f_bxs(xs, math.max(md.lim, md.stp), xe, math.min(md.lim, md.stp), color.new(color.red, pend ? 88 : 78), color.red, sty)
        f_bxs(xs, math.max(md.lim, md.tgt), xe, math.min(md.lim, md.tgt), color.new(color.green, pend ? 88 : 78), color.green, sty)
        f_ln(xs, md.lim, xe, md.lim, color.black, line.style_solid, 2)
        string head = pre + " " + md.meth + " #" + str.tostring(md.sid) + (pend ? " PENDING" : (done ? "" : " FILLED"))
        f_lb(xe, md.lim, head + " | E " + str.tostring(md.lim, format.mintick) + " | " + str.tostring(md.plannedR, "#.0") + "R", color.black, label.style_label_left, "entry; frozen when armed. " + md.why)
        f_lb(xe, md.stp, "SL " + str.tostring(md.stp, format.mintick) + " (" + str.tostring(distT) + "t)", color.red, label.style_label_left, "stop")
        f_lb(xe, md.tgt, "TP " + str.tostring(md.tgt, format.mintick) + " " + md.tgtTy, color.green, label.style_label_left, "target audit: " + md.tgtAud)
        if done
            string oc = md.tr.outcome == 1 ? "TP" : (md.tr.outcome == 2 ? "SL" : (md.tr.outcome == 3 ? "time" : "ambig"))
            f_lb(md.tr.exitT, md.tr.exitPx, "x " + oc + " " + str.tostring(md.tr.netR, "#.00") + "R", color.black, md.dir > 0 ? label.style_label_down : label.style_label_up, md.tr.note)
        if inCxVisFib and md.meth == "Fib 0.705" and not na(md.fH)
            f_lb(md.armT, md.fH, "Fib H", color.fuchsia, label.style_label_down, "anchor")
            f_lb(md.armT, md.fL, "Fib L", color.fuchsia, label.style_label_up, "anchor")
        if md.meth == "Rejection CE" and not na(md.rLo)
            f_bx(md.rT, md.rHi, md.rT + 2 * chartMs, md.rLo, color.new(color.red, 80), color.new(color.red, 20))
    true

// Setup context. Everything is anchored at the moment it became known and STOPS at the setup's actual end (endT), never beyond it.
f_cxDrawSetup(Setup st) =>
    int xe = st.endT > 0 ? st.endT : time_close
    f_ln(st.lvl.known, st.lvl.px, st.swT, st.lvl.px, color.purple, line.style_dotted, 2)
    f_lb(st.swT, st.lvl.px, "SWEEP #" + str.tostring(st.id) + " " + st.lvl.ty + " " + str.tostring(st.lvl.px, format.mintick), color.purple, st.dir > 0 ? label.style_label_up : label.style_label_down, "pre-existing level swept; known since " + f_hm(st.lvl.known))
    if st.st >= 1 and not na(st.cisdRef)
        int xr = st.cisdT > 0 ? st.cisdT : xe
        f_ln(st.swT, st.cisdRef, xr, st.cisdRef, color.aqua, line.style_dashed, 1)
        f_lb(xr, st.cisdRef, st.cisdT > 0 ? "CISD ref " + str.tostring(st.cisdRef, format.mintick) + " closed through" : "CISD ref " + str.tostring(st.cisdRef, format.mintick) + " (awaiting a close through)", color.aqua, label.style_label_right, "first open of the opposing run into the sweep, frozen at the sweep")
    if st.cisdT > 0
        f_ln(st.cisdT, st.ext, xe, st.ext, color.orange, line.style_solid, 2)
        f_lb(st.cisdT, st.ext, "setup extreme " + str.tostring(st.ext, format.mintick), color.orange, st.dir > 0 ? label.style_label_up : label.style_label_down, "frozen at the CISD; Standard stops sit beyond it")
        if inCxVisAreas and st.st == 2
            for a in st.areas
                if not a.dead
                    f_bxs(a.known, a.hi, xe, a.lo, color.new(color.teal, 92), color.new(color.teal, 55), a.stale ? line.style_dotted : line.style_solid)
                    f_lb(a.known, a.ce, a.kind + " CE " + str.tostring(a.ce, format.mintick) + (a.stale ? " (stale)" : ""), color.teal, label.style_label_right, "eligible area")
    if st.st == 8
        f_lb(xe, st.ext, "ended: " + st.why, color.gray, st.dir > 0 ? label.style_label_up : label.style_label_down, st.endCat)
    true

f_cxDrawLevels() =>
    int xe = time_close + 12 * chartMs
    for lv in lvls
        bool sw = lv.st == 2
        if (lv.side != 0 or inCxOpens) and lv.known > time_close - 172800000 and (not sw or inCxHistCtx)
            color c = lv.side == 0 ? color.new(color.gray, 20) : (lv.side > 0 ? color.new(color.maroon, sw ? 70 : 25) : color.new(color.green, sw ? 70 : 25))
            f_ln(lv.known, lv.px, sw ? lv.swT : xe, lv.px, c, lv.side == 0 ? line.style_dotted : (sw ? line.style_dashed : line.style_solid), 1)
            f_lb(sw ? lv.swT : xe, lv.px, lv.ty + " " + str.tostring(lv.px, format.mintick) + (sw ? " [swept]" : ""), c, label.style_label_left, "level L" + str.tostring(lv.id) + ", known " + f_hm(lv.known) + " NY")
    true

'''
src=src[:i]+draw+src[j:]
open(P,'w').write(src)
print('ui4 ok')
