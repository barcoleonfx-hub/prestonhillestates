import re
exec(open('/home/user/prestonhillestates/tests/patch_ui1.py').read().split('# ---------- types / state')[0])
src=open(P).read()
rep("""        if st.dir > 0 ? low <= eR : high >= eR
            st.fibSt := 3
""","""        if st.dir > 0 ? low <= eR : high >= eR
            st.fibSt := 3
            st.candN += 1
            st.candCat := st.candCat == "" ? "filter" : st.candCat
""")
i=src.index("f_cxFibArm(Setup st) =>"); j=src.index("// ---- Precision B:")
src=src[:i]+'''f_cxFibArm(Setup st) =>
    if slotOn.get(SC_PRE) and st.fibSt == 1 and f_cxArmWin()
        [mult, firstRisk, why] = f_cxSeq(SC_PRE)
        // a VALID parent area is required for Precision (independent of the optional overlap filter below). If none is alive/known YET the stored
        // candidate WAITS (it is not consumed): parents can still form while the window is open.
        Area par = f_cxPick(st, false, time_close)
        if mult == 0.0
            if why != "busy"
                st.fibSt := 3
                st.seqBlock := st.candN == 0
                f_why("daily sequence", "Precision Fib: " + why)
            else
                st.busyBlock := st.candN == 0
        else if na(par)
            if not st.parWait
                st.parWait := true
                f_why("no parent yet", "Fib candidate waits: no valid parent area is known and alive yet")
        else
            bool bull = st.dir > 0
            Mdl md = f_cxNewMdl(SC_PRE, st, "Fib 0.705")
            st.mdlP := md
            st.fibSt := 3
            md.fH := bull ? st.fibPx : st.ext
            md.fL := bull ? st.ext : st.fibPx
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

'''+src[j:]
open(P,'w').write(src)
print('ui3 ok')
