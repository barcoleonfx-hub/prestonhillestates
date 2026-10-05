import re
exec(open('/home/user/prestonhillestates/tests/patch_audit1.py').read().split('# ---------------- types')[0].replace("src=open(P).read()","src=open(P).read()"))
src=open(P).read()

# ---------- aggregation with completeness
repl_fn('f_aggStep','''f_aggClear(Agg a) =>
    a.O.clear()
    a.H.clear()
    a.L.clear()
    a.C.clear()
    a.T0.clear()
    a.TC.clear()
    true

// Publish (ok) or DROP (incomplete) the bucket. A dropped bucket clears the history so no pattern (FVG, swing, run, bias) can span the hole.
f_aggClose(Agg a, bool ok) =>
    if ok
        f_aggPush(a)
        a.doneN += 1
        a.nw := true
    else
        f_aggClear(a)
        a.dropN += 1
        a.bad := true
    a.has := false
    true

// Completeness bookkeeping per synthetic timeframe. Bucket = minutes since 18:00 NY on the trading day. The scheduled 17:00-18:00 break is EXPLICIT:
// a bucket that reaches it ends at 17:00 (minute 1380), so the 4H candle 14:00-17:00 and the Daily candle 18:00-17:00 expect 180 / 1380 one-minute candles.
// A candle is published only if its first/last candle are on the expected boundaries (within the tolerance) and no more than the tolerance is missing.
// A gap between consecutive 1m candles is "explained" only when it follows the 16:59 candle (break, weekend, holiday); any other hole clears history.
f_aggStep(Agg a) =>
    a.nw := false
    a.bad := false
    int ms18 = (mOpen - 1080 + 1440) % 1440
    int span = a.n >= 1440 ? 1440 : a.n
    int idx = a.n >= 1440 ? 0 : int(math.floor(ms18 / a.n))
    int bid = tdk * 10000 + idx
    int startMs = idx * span
    int endMs = math.min((idx + 1) * span, 1380)
    int prevM = na(pCloseT) ? -1 : hour(pCloseT - chartMs, TZ) * 60 + minute(pCloseT - chartMs, TZ)
    int missed = na(pCloseT) ? 0 : int(math.round((time - pCloseT) / chartMs))
    bool hole = missed > inCxMiss and prevM != 1019
    if a.has and bid != a.id
        // the previous bucket never saw its last candle
        bool okp = a.firstMs - a.idx * span <= inCxMiss and (math.min((a.idx + 1) * span, 1380) - 1) - a.lastMs <= inCxMiss and a.cnt >= (math.min((a.idx + 1) * span, 1380) - a.idx * span) - inCxMiss and not a.gap
        f_aggClose(a, okp)
    if hole
        a.gap := true
        if a.H.size() > 0
            f_aggClear(a)
            a.dropN += 1
            a.bad := true
    if not a.has
        a.o := open
        a.h := high
        a.l := low
        a.c := close
        a.t0 := time
        a.tc := time_close
        a.id := bid
        a.idx := idx
        a.cnt := 1
        a.firstMs := ms18
        a.lastMs := ms18
        a.gap := hole
        a.has := true
    else
        a.h := math.max(a.h, high)
        a.l := math.min(a.l, low)
        a.c := close
        a.tc := time_close
        a.cnt += 1
        a.lastMs := ms18
    if ms18 + 1 == endMs
        bool ok = a.firstMs - startMs <= inCxMiss and endMs - 1 - a.lastMs <= inCxMiss and a.cnt >= (endMs - startMs) - inCxMiss and not a.gap
        f_aggClose(a, ok)
    a.nw or a.bad''')

# ---------- area ids
rep("f_cxRb(Setup st, Agg A) =>","""f_cxMkArea(string kind, float lo, float hi, int known, int src) =>
    cxN.set(4, cxN.get(4) + 1)
    Area.new(id = cxN.get(4), kind = kind, lo = lo, hi = hi, ce = (lo + hi) / 2.0, known = known, src = src)

f_cxRb(Setup st, Agg A) =>""")
rep('st.rbs.push(Area.new(kind = "RB", lo = lo, hi = hi, ce = (lo + hi) / 2.0, known = time_close, src = f_agI(A.T0, 0)))','st.rbs.push(f_cxMkArea("RB", lo, hi, time_close, f_agI(A.T0, 0)))')
rep('st.areas.push(Area.new(kind = "FVG", lo = f.lo, hi = f.hi, ce = (f.lo + f.hi) / 2.0, known = f.known, src = f.c1open))','st.areas.push(f_cxMkArea("FVG", f.lo, f.hi, f.known, f.c1open))')
rep('st.areas.push(Area.new(kind = "iFVG", lo = f.lo, hi = f.hi, ce = (f.lo + f.hi) / 2.0, known = f.invKnown, src = f.c1open))','st.areas.push(f_cxMkArea("iFVG", f.lo, f.hi, f.invKnown, f.c1open))')

# ---------- swings + breaker
rep("// FVG store (3 candles; usable once the third closed)","""// A confirmed swing (strength P each side) plus the block associated with it: for a swing LOW the last bearish candle at/before it (the order block of the
// up-leg that starts there); for a swing HIGH the last bullish candle at/before it. Known only when the swing was confirmed (never back-dated).
f_cxSwing(Agg A, int i, int side) =>
    float px = side > 0 ? A.H.get(i) : A.L.get(i)
    float bLo = na
    float bHi = na
    for k = 0 to 3
        int j = i - k
        if j >= 0 and na(bLo)
            bool cand = side > 0 ? A.C.get(j) > A.O.get(j) : A.C.get(j) < A.O.get(j)
            if cand
                bLo := A.L.get(j)
                bHi := A.H.get(j)
    swgs.push(Sw.new(side = side, px = px, open = A.T0.get(i), kn = time_close, bLo = bLo, bHi = bHi))
    while swgs.size() > 30
        swgs.shift()
    true

// FVG store (3 candles; usable once the third closed)""")
rep("        if okH\n            pvPx.set(0, ph)","        if okH\n            f_cxSwing(A, i, 1)\n            pvPx.set(0, ph)")
rep("        if okL\n            pvPx.set(1, pl)","        if okL\n            f_cxSwing(A, i, -1)\n            pvPx.set(1, pl)")
# breaker function placed before f_cxSmt
rep("// [OPT] SMT, reversal role:","""// [GUIDE] BREAKER, causal confirmed-swing sequence. Bearish (short setup): swing HIGH A -> intervening swing LOW B -> HIGHER swing high C (the sweep extreme)
// -> a completed candle CLOSES below B (a wick is not enough). Bullish mirrors. The broken block is the order block associated with B (the last opposite-colour
// candle at/before B: bearish candle for a swing low, bullish for a swing high); its full high-low is the area. All three swings must be CONFIRMED and the
// closing candle completed before the area exists, and the area is stamped known at that moment. If any part of the structure is missing there is no breaker.
f_cxBrk(Setup st, Agg A) =>
    if inABrk and not st.brkDone and A.H.size() >= 3
        bool bull = st.dir > 0
        Sw c = na
        for s in swgs
            if s.side == (bull ? -1 : 1) and s.px == st.ext and s.open >= st.swOpen and s.kn <= time_close
                c := s
        if not na(c)
            Sw b = na
            Sw a0 = na
            for i = swgs.size() - 1 to 0
                Sw s2 = swgs.get(i)
                if na(b)
                    if s2.side == (bull ? 1 : -1) and s2.open < c.open
                        b := s2
                else if na(a0)
                    if s2.side == c.side and s2.open < b.open and (bull ? s2.px > c.px : s2.px < c.px)
                        a0 := s2
            if not na(b) and not na(a0) and not na(b.bLo)
                bool broke = false
                for k = 0 to A.H.size() - 1
                    if A.T0.get(k) > c.open
                        broke := broke or (bull ? A.C.get(k) > b.px : A.C.get(k) < b.px)
                if broke
                    st.areas.push(f_cxMkArea("BRK", b.bLo, b.bHi, time_close, b.open))
                    st.brkDone := true
    true

// [OPT] SMT, reversal role:""")
# old breaker code in f_cxCisd removed, replaced by the call
i=src.index("    // [GUIDE] breaker = a block that failed"); j=src.index("    f_cxCollect(st)\n    if inSmt != \"Off\"")
src=src[:i]+src[j:]
rep("    f_cxCollect(st)\n    if inSmt != \"Off\"","    f_cxCollect(st)\n    f_cxBrk(st, A)\n    if inSmt != \"Off\"")
rep('st.areas.push(Area.new(kind = "OB", lo = A.L.get(j - 1), hi = A.H.get(j - 1), ce = (A.L.get(j - 1) + A.H.get(j - 1)) / 2.0, known = time_close, src = A.T0.get(j - 1)))','st.areas.push(f_cxMkArea("OB", A.L.get(j - 1), A.H.get(j - 1), time_close, A.T0.get(j - 1)))')
rep("            f_cxRb(st, A)\n            f_cxCollect(st)\n    true","            f_cxRb(st, A)\n            f_cxCollect(st)\n            f_cxBrk(st, A)\n    true")

# ---------- prior-range breakout state (renamed, provenance, reset on incomplete data)
rep("f_cxBias(int ix, Agg a) =>\n","""// PRIOR-RANGE BREAKOUT STATE (not a CISD): +1 after a completed candle closes above the previous completed candle's high, -1 after a close below its low,
// otherwise the last state PERSISTS (0 until the first breakout). It is unavailable until two consecutive complete candles exist and is RESET to unavailable
// whenever that timeframe drops an incomplete candle. The CISD used for setups is a different, per-setup construct (opposing delivery leg, see f_cxRef).
f_cxPrb(int ix, Agg a) =>
    if a.bad
        prbS.set(ix, 0)
        prbT.set(ix, na)
        if ix == 2
            poi15.clear()
        if ix == 4
            poi60.clear()
""")
rep("        f_cxBias(i, aggs.get(i))","        f_cxPrb(i, aggs.get(i))")
rep('r := "bias " + nm + " unavailable or neutral"','r := "prior-range state " + nm + " unavailable or none yet"')
rep('r := "bias " + nm + " against the setup"','r := "prior-range state " + nm + " against the setup"')
rep('f_cxBiasTxt(int ix, string nm) =>','f_cxPrbTxt(int ix, string nm) =>')
rep('''"Bias (completed candles): " + f_cxBiasTxt(6, "D") + " | " + f_cxBiasTxt(5, "4H") + " | " + f_cxBiasTxt(4, "1H") + " | " + f_cxBiasTxt(3, "30m") + " | " + f_cxBiasTxt(2, "15m")''','''"Prior-range breakout state, NOT CISD (completed candles): " + f_cxPrbTxt(6, "D") + " | " + f_cxPrbTxt(5, "4H") + " | " + f_cxPrbTxt(4, "1H") + " | " + f_cxPrbTxt(3, "30m") + " | " + f_cxPrbTxt(2, "15m")''')
rep('(prbS.get(ix) > 0 ? "bull" : (prbS.get(ix) < 0 ? "bear" : "neutral"))','(prbS.get(ix) > 0 ? "up" : (prbS.get(ix) < 0 ? "down" : "none yet"))')
rep("Warm-up: bias D/4H/1H need 2 completed candles.","Warm-up: the range states need 2 consecutive complete candles.")
open(P,'w').write(src)
print('stage2 ok')
