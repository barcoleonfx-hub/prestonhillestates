import re
exec(open('/home/user/prestonhillestates/tests/patch_ui1.py').read().split('# ---------- types / state')[0])
src=open(P).read()

# ----- f_cxSource: ends via f_cxEnd; blocked-sweep statistics
rep("""        if act and not replace
            f_why("sweep ignored", "sweep of " + best.ty + " ignored: setup #" + str.tostring(st.id) + " is still active")""","""        if act and not replace
            // which kind of setup is blocking? 0 waiting for its CISD, 1 CISD done / no order yet, 2 idle (variants finished, nothing pending), 3 order pending or open
            bool pendB = (not na(st.mdlS) and (st.mdlS.st == 2 or st.mdlS.st == 3)) or (not na(st.mdlP) and (st.mdlP.st == 2 or st.mdlP.st == 3))
            int bk = st.st == 1 ? 0 : (pendB ? 3 : (st.stdSt == 2 and st.candN > 0 ? 2 : 1))
            blkC.set(bk, blkC.get(bk) + 1)
            f_why("sweep ignored", "sweep of " + best.ty + " ignored: setup #" + str.tostring(st.id) + " active (" + (bk == 0 ? "waiting for CISD" : (bk == 1 ? "CISD done, no order yet" : (bk == 2 ? "idle, attempts used" : "order pending/open"))) + ", age " + str.tostring(math.round((time_close - st.swT) / 60000.0)) + "m)")""")
rep("""            if replace
                st.st := 8
                st.why := "superseded by a sweep of a higher-priority level"
            if na(ref)
                ns.st := 8
                ns.why := "no opposing candle run before the sweep (CISD reference unavailable)"
                f_why("CISD reference unavailable", "sweep of " + best.ty + " rejected: " + ns.why)""","""            if replace
                f_cxEnd(st, "superseded by a sweep of a higher-priority level", "sup")
            if na(ref)
                f_cxEnd(ns, "no opposing candle run before the sweep (CISD reference unavailable)", "other")
                f_why("CISD reference unavailable", "sweep of " + best.ty + " rejected: " + ns.why)""")
rep("""        else if st.cnt >= inCxSwAge
            st.st := 8
            st.why := "reversal (CISD) not confirmed within " + str.tostring(inCxSwAge) + " candles"
            f_why("no CISD", "setup #" + str.tostring(st.id) + ": " + st.why)""","""        else if st.cnt >= inCxSwAge
            f_cxEnd(st, "reversal (CISD) not confirmed within " + str.tostring(inCxSwAge) + " candles", "other")
            f_why("no CISD", "setup #" + str.tostring(st.id) + ": " + st.why)""")
rep("""        if time_close - st.cisdT > inCxAgeMin * 60000 and not busy
            st.st := 8
            st.why := "setup expired: no order within " + str.tostring(inCxAgeMin) + " minutes of the CISD"
            f_why("setup expired", "setup #" + str.tostring(st.id) + ": " + st.why)""","""        if time_close - st.cisdT > inCxAgeMin * 60000 and not busy
            f_cxEnd(st, "setup expired: no order within " + str.tostring(inCxAgeMin) + " minutes of the CISD", "exp")
            f_why("setup expired", "setup #" + str.tostring(st.id) + ": " + st.why)""")
# ----- after-cancel / src bad
rep("        if setupDead\n            st.st := 8\n            st.why := md.why\n","        if setupDead\n            f_cxEnd(st, md.why, \"inval\")\n")
rep("""    if not na(st) and st.st == 1
        st.st := 8
        st.why := "source candle incomplete (missing 1m data): CISD tracking cannot continue"
        f_why("incomplete data", "setup #" + str.tostring(st.id) + ": " + st.why)""","""    if not na(st) and st.st == 1
        f_cxEnd(st, "source candle incomplete (missing 1m data): CISD tracking cannot continue", "data")
        f_why("incomplete data", "setup #" + str.tostring(st.id) + ": " + st.why)""")
# ----- f_cxBar: new trading day, invalidation, flags, exhaustion
rep("""                q.st := 8
                q.why := "new trading day"
""","""                f_cxEnd(q, "new trading day", "day")
""")
rep("""            st.st := 8
            st.why := "setup invalidated: price exceeded the frozen sweep extreme " + str.tostring(st.ext, format.mintick)
            f_why""","""            f_cxEnd(st, "setup invalidated: price exceeded the frozen sweep extreme " + str.tostring(st.ext, format.mintick), "inval")
            f_why""")
rep("""            if not st.hadArea and st.areas.size() > 0
                st.hadArea := true
                f_fnA2(3)""","""            if not st.hadArea and st.areas.size() > 0
                st.hadArea := true
                rcN.set(15, rcN.get(15) + 1)
                f_fnA2(3)""")
# window / executable-area evidence + exhaustion, placed before Standard arming
rep("""    // 6) Standard arming is evaluated on every 1m candle
    st := f_cxCur()
    if not na(st) and st.st == 2
        f_cxTryStd(st)""","""    // 6) Standard arming is evaluated on every 1m candle
    st := f_cxCur()
    if not na(st) and st.st == 2
        if f_cxArmWin()
            st.winSeen := true
            if not st.execSeen and not na(f_cxPick(st, true, time_close))
                st.execSeen := true
        f_cxTryStd(st)
        f_cxExhaust(st)""")
rep("f_cxBar(Day dy) =>","""// A setup whose enabled variants have ALL used their attempts and has nothing pending is finished: it must not keep blocking later sweeps.
// (Precision keeps a setup alive while a Fib endpoint is still awaited/stored or the rejection method can still trigger.)
f_cxExhaust(Setup st) =>
    if st.st == 2
        bool pend = (not na(st.mdlS) and (st.mdlS.st == 2 or st.mdlS.st == 3)) or (not na(st.mdlP) and (st.mdlP.st == 2 or st.mdlP.st == 3))
        if not pend and (not slotOn.get(SC_STD) or st.stdSt == 2)
            bool precDone = not slotOn.get(SC_PRE) or st.precSt == 2
            if not precDone
                [m6, fr6, w6] = f_cxSeq(SC_PRE)
                precDone := (m6 == 0.0 and w6 != "busy") or (not inPRejOn and (not inPFibOn or st.fibSt == 3))
            if precDone
                f_cxEnd(st, "exhausted: every enabled variant used its attempt (nothing pending)", "exh")
    true

f_cxBar(Day dy) =>""")
# ----- Standard / rejection flags
rep("""        if mult == 0.0
            if why != "busy"
                st.stdSt := 2
                f_why("daily sequence", "Standard: " + why)""","""        if mult == 0.0
            if why != "busy"
                st.stdSt := 2
                st.seqBlock := st.candN == 0
                f_why("daily sequence", "Standard: " + why)
            else
                st.busyBlock := st.candN == 0""")
rep("""                if mult == 0.0
                    if why != "busy"
                        f_why("daily sequence", "Precision: " + why)""","""                if mult == 0.0
                    if why != "busy"
                        st.seqBlock := st.candN == 0
                        f_why("daily sequence", "Precision: " + why)
                    else
                        st.busyBlock := st.candN == 0""")
# ----- Fib: stale candidates count as candidates; the parent is awaited, not consumed
rep("""            else if trav or not (bull ? eR < close : eR > close)
                st.fibSt := 3
""","""            else if trav or not (bull ? eR < close : eR > close)
                st.fibSt := 3
                st.candN += 1
                st.candCat := st.candCat == "" ? "filter" : st.candCat
""")
rep("""            st.fibSt := 3
            f_why("stale fib", "Fib: price traded to \"""","""            st.fibSt := 3
            st.candN += 1
            st.candCat := st.candCat == "" ? "filter" : st.candCat
            f_why("stale fib", "Fib: price traded to \"""") if False else None
open(P,'w').write(src)
print('ui2 partial ok')
