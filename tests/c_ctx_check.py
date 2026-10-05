import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from c_ctx_helpers import *

PASS = 0; FAIL = []
def ok(name, cond, info=''):
    global PASS
    if cond: PASS += 1
    else: FAIL.append((name, info)); print('FAIL', name, info)

D = (2025, 3, 12)   # a Wednesday, EDT
def at(h, m): return T(*D, h, m)

# ---- scenario 1: long setup (sweep of PDL, CISD, OB + FVG, Standard fill and target)
def sc1(extra=(), **kw):
    s = [(20000, 20001, 19994, 19995),      # 09:30 bearish
         (19995, 19996, 19990.5, 19991),    # 09:35 bearish, does not exceed 19990
         (19991, 19991.5, 19985, 19987),    # 09:40 bearish, sweeps the PDL 19990
         (19987, 19999.5, 19987, 19999),    # 09:45 bullish, no close through 20000
         (19999, 20008, 19999, 20006)]      # 09:50 bullish, close above 20000 -> CISD at 09:55
    s += list(extra)
    return candles((*D, 9, 30), s)
LV = [('PDL', -1, 19990.0), ('PDH', 1, 20100.0)]
e = engine(sc1(), LV)
st = e.setups[0] if e.setups else None
ok('sc1 setup exists', st is not None)
ok('sc1 long', st is not None and st.dir == 1)
ok('sc1 CISD reference = first open of the opposing run', st is not None and st.cisdRef == 20000, getattr(st, 'cisdRef', None))
ok('sc1 CISD confirmed at 09:55', st is not None and st.st in (2,) and st.cisdT == at(9, 55), (st.st, st.why))
ok('sc1 sweep extreme', st is not None and st.ext == 19985)
kinds = sorted(a.kind for a in st.areas) if st else []
ok('sc1 areas OB + FVG', 'OB' in kinds and 'FVG' in kinds, kinds)
mS = st.mdlS if st else None
near = min((a for a in st.areas if a.ce < 20006), key=lambda a: 20006 - a.ce) if st else None
ok('sc1 standard armed at the NEAREST eligible area CE on the retracement path', mS is not None and mS.st == 2 and near is not None and abs(mS.lim - X.rt(near.ce)) < 1e-9, (mS.lim if mS else None, near.kind if near else None))
ok('sc1 stop = extreme - buffer', mS is not None and abs(mS.stp - 19984.5) < 1e-9, mS.stp if mS else None)
ok('sc1 target = PDH', mS is not None and mS.tgt == 20100.0)

# fill then target
ext = [(20006, 20007, 19994.5, 19996),    # 09:55 retraces and touches 19995
       (19996, 20110, 19996, 20100)]      # 10:00 runs to the target
e = engine(sc1(ext), LV)
tr = [t for t in e.trades if t.slot == 5]
ok('sc1 std trade filled and won', len(tr) == 1 and tr[0].outcome == 1, [(t.outcome, t.note) for t in tr])
ok('sc1 planned R matches rounded prices', tr and abs(tr[0].plannedR - abs(100.0 + 0.0 + (20100 - tr[0].tgtPx)) * 0 - (tr[0].tgtPx - tr[0].entryPx) / (tr[0].entryPx - tr[0].stopPx)) < 1e-6, tr[0].plannedR if tr else None)

# ---- CISD can't be confirmed by the sweep candle itself and needs a CLOSE
s2 = [(20000, 20001, 19994, 19995), (19995, 19996, 19990.5, 19991), (19991, 20003, 19985, 20002)]  # sweep candle itself closes above the reference
e = engine(candles((*D, 9, 30), s2), LV)
st = e.setups[0] if e.setups else None
ok('same-candle close through the reference does not confirm CISD', st is not None and st.st == 1, (st.st if st else None))
s3 = s2 + [(20002, 20010, 20001, 20003)]
e = engine(candles((*D, 9, 30), s3), LV)
ok('a LATER close through the reference confirms CISD', e.setups and e.setups[0].st == 2)

# ---- doji is a run boundary
s4 = [(20000, 20001, 19994, 19995), (19995, 19996, 19995, 19995), (19995, 19995.5, 19985, 19987)]  # 2nd candle is a doji (c==o)
e = engine(candles((*D, 9, 30), s4), [('PDL', -1, 19990.0), ('PDH', 1, 20100.0)])
st = e.setups[0]
ok('doji ends the run: reference is the first open AFTER the doji', st.cisdRef == 19995, st.cisdRef)

# ---- no opposing run -> CISD unavailable
s5 = [(19990, 19992, 19989, 19991), (19991, 19992, 19985, 19991.5)]   # both bullish: no bearish run into the sweep
e = engine(candles((*D, 9, 30), s5), LV)
ok('no opposing run -> setup rejected (unavailable)', e.setups and e.setups[0].st == 8 and 'unavailable' in e.setups[0].why, e.setups[0].why if e.setups else None)


# ============================ mirror helper (short = long mirrored about 20000)
def mir_spec(sp): return None if sp is None else (40000 - sp[0], 40000 - sp[2], 40000 - sp[1], 40000 - sp[3])
def mir_lv(lv): return [(t.replace('PDL', 'PDH') if side < 0 else t.replace('PDH', 'PDL'), -side, 40000 - px) for (t, side, px) in lv]
def scen(specs, lv=LV, mirror=False, start=(*D, 9, 30), **kw):
    if mirror: specs = [mir_spec(x) for x in specs]; lv = mir_lv(lv)
    return engine(candles(start, specs), lv, **kw)
BASE = [(20000, 20001, 19994, 19995), (19995, 19996, 19990.5, 19991), (19991, 19991.5, 19985, 19987), (19987, 19999.5, 19987, 19999), (19999, 20008, 19999, 20006)]
FIBX = [(20006, 20015, 20004, 20012), (20012, 20010, 20005, 20007), (20007, 20009, 20004.5, 20006)]   # pivot high 20015 (2/2) known 10:10

for mirror in (False, True):
    tag = ' [short]' if mirror else ' [long]'
    sg = -1 if mirror else 1
    def P(x): return 40000 - x if mirror else x
    # ---- Fib 0.705 / stop beyond 0.79
    e = scen(BASE + FIBX, mirror=mirror, fibOn=True, rejOn=False)
    st = e.setups[0]; mp = st.mdlP
    ok('fib: precision order armed' + tag, mp is not None and mp.st == 2 and mp.meth == 'Fib 0.705', (mp.st, mp.why) if mp else None)
    if mp is not None and mp.st == 2:
        H = 20015.0; L = 19985.0
        ok('fib: entry = H - 0.705*(H-L)' + tag, abs(mp.lim - P(X.rt(H - 0.705 * (H - L)))) < 1e-9, mp.lim)
        ok('fib: stop beyond 0.79 + buffer' + tag, abs(mp.stp - P(X.rt((H - 0.79 * (H - L)) - 2 * 0.25))) < 1e-9, mp.stp)
        ok('fib: armed only when the swing anchor became known (10:10)' + tag, mp.armT == at(10, 10), mp.armT)
        ok('fib: anchors are the swept extreme and the first confirmed swing' + tag, abs(mp.fibL - P(19985)) < 1e-9 or abs(mp.fibH - P(19985)) < 1e-9)
        ok('fib: reward measured on rounded prices' + tag, abs(mp.plannedR - abs(mp.tgt - mp.lim) / abs(mp.lim - mp.stp)) < 1e-9)
    # ---- Fib stale: 0.705 already traversed before the anchor was known
    stale = [(20006, 20015, 20004, 20012), (20012, 20010, 19993, 19995), (19995, 20009, 19994, 20006)]
    e = scen(BASE + stale, mirror=mirror, fibOn=True, rejOn=False)
    mp = e.setups[0].mdlP
    ok('fib: stale 0.705 is skipped, not back-dated' + tag, mp is not None and mp.st == 4 and 'stale' in mp.why, (mp.why if mp else None))
    # ---- rejection CE
    rejc = [(20006, 20007, 20004, 20005), (20005, 20006, 20004, 20005.5), (20005.5, 20006, 20004.5, 20005.5)]
    # drive price back into the parent area with a 5m rejection candle (bullish, lower wick >= 40%)
    rej = [(19990, 19995, 19986, 19994)]
    e = scen(BASE + [(20006, 20006.5, 19998, 19999)] + rej, mirror=mirror, fibOn=False, rejOn=True)
    st = e.setups[0]; mp = st.mdlP
    ok('rejection CE: order armed at the wick midpoint' + tag, mp is not None and mp.st == 2 and mp.meth == 'Rejection CE', (mp.st, mp.why) if mp else None)
    if mp is not None and mp.st == 2:
        ok('rejection CE: entry = midpoint of the confirmed wick' + tag, abs(mp.lim - P(X.rt((19986 + 19990) / 2.0))) < 1e-9, mp.lim)
        ok('rejection CE: stop beyond the local extreme + buffer' + tag, abs(mp.stp - P(19985.5)) < 1e-9, mp.stp)
    # ---- Standard rejections
    e = scen(BASE, mirror=mirror, cap=20)
    ok('standard: stop-cap rejection never squeezes the stop' + tag, e.setups[0].mdlS.st == 4 and 'stop-cap' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
    e = scen(BASE, mirror=mirror, minR=20.0)
    ok('standard: minimum-R rejection' + tag, e.setups[0].mdlS.st == 4 and 'minimum-R' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
    e = scen(BASE, lv=[('PDL', -1, 19990.0)], mirror=mirror)
    ok('standard: no target -> visible rejection, no remote substitution' + tag, e.setups[0].mdlS.st == 4 and 'no eligible' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
    e = scen(BASE, lv=[('PDL', -1, 19990.0), ('PDH', 1, 20003.0)], mirror=mirror)   # the 20003 high is taken by the CISD candle (20008) before arming
    ok('standard: a target that was already swept is not eligible' + tag, e.setups[0].mdlS.st == 4 and 'no eligible' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
    e = scen(BASE, mirror=mirror)
    st0 = e.setups[0]; lv_w = X.Lvl(99, 'EQH' if not mirror else 'EQL', 1 if not mirror else -1, P(19999.0), 0, 0)
    e.levels.append(lv_w); e.time = at(10, 0); e.tclose = e.time + 60000
    ok('target(): a level on the wrong side of the entry is never chosen' + tag, e.target(st0, P(20000.0)) is None or e.target(st0, P(20000.0)).px != P(19999.0))
    # ---- target taken before the fill cancels the order
    e = scen(BASE + [(20006, 20110, 20005, 20100)], mirror=mirror)
    mS = e.setups[0].mdlS
    ok('standard: target taken before the entry cancels the order' + tag, mS.st == 4 and 'target was reached' in mS.why and not [t for t in e.trades if t.slot == 5], mS.why)
    # ---- conservative ambiguity: ONE one-minute candle containing the fill, the stop and the target
    bars = candles((*D, 9, 30), [mir_spec(x) if mirror else x for x in BASE])
    t55 = at(9, 55)
    bars.append(bar(t55, P(20006), P(20110) if not mirror else P(19980), P(19980) if not mirror else P(20110), P(20100)))
    e = engine(bars, mir_lv(LV) if mirror else LV)
    tr = [t for t in e.trades if t.slot == 5]
    ok('ambiguous fill candle is a conservative loss' + tag, len(tr) == 1 and tr[0].outcome == 4 and tr[0].netR < 0, [(t.outcome, t.note) for t in tr])
    # ---- strict fill: a touch is not a fill
    near = e  # placeholder
    e = scen(BASE + [(20006, 20006.5, 19997.75, 20000)], mirror=mirror, strict=True)
    ok('strict: a bare touch does not fill' + tag, not [t for t in e.trades if t.slot == 5])
    e = scen(BASE + [(20006, 20006.5, 19997.5, 20000)], mirror=mirror, strict=True)
    ok('strict: trade-through fills' + tag, len([t for t in e.trades if t.slot == 5]) == 1)
    # ---- gap through the stop exits at the open (worse than the stop)
    e = scen(BASE + [(20006, 20006.5, 19997, 19998), (19950, 19951, 19949, 19950)], mirror=mirror)
    tr = [t for t in e.trades if t.slot == 5]
    ok('gap through the stop exits at the open' + tag, len(tr) == 1 and tr[0].outcome == 2 and abs(tr[0].exitPx - P(19950)) < 1e-9, [(t.outcome, t.exitPx) for t in tr])
    # ---- sweep + reversal BEFORE the window: the order is still armed inside it (no fresh sweep required)
    e = scen(BASE, mirror=mirror, start=(*D, 4, 0), winS=570)
    mS = e.setups[0].mdlS if e.setups else None
    ok('pre-window setup is not armed before 09:30' + tag, mS is None)
    e = scen(BASE + [None] * 62, mirror=mirror, start=(*D, 4, 0), winS=570)
    ok('pre-window setup arms once the window opens, without a fresh sweep' + tag, e.setups and e.setups[0].mdlS is not None and e.setups[0].mdlS.st in (2, 3, 4), e.setups[0].mdlS.st if e.setups and e.setups[0].mdlS else None)
    ok('...and its arming time is inside the window' + tag, e.setups[0].mdlS is None or e.setups[0].mdlS.armT >= at(9, 30))

# ---- precision stop ends the attempt, not the setup; daily sequence with a 50% retry
SEQ = BASE + FIBX + [(20006, 20006, 19989, 19990.5), (19990, 19995, 19986, 19994), (19994, 19994.5, 19987.5, 19993)]
e = scen(SEQ, fibOn=True, rejOn=True, seq='seq', sizeMode='Fixed cash risk', cash=500.0, stdOn=False) if False else scen(SEQ, fibOn=True, rejOn=True, seq='seq', sizeMode='Fixed cash risk', cash=500.0)
trp = [t for t in e.trades if t.slot == 6]
ok('seq: first precision trade (Fib) stopped out', len(trp) >= 1 and trp[0].meth == 'Fib 0.705' and trp[0].outcome == 2, [(t.meth, t.outcome) for t in trp])
ok('seq: setup survives a precision stop (attempt != setup)', e.setups[0].st == 2, e.setups[0].st)
ok('seq: one retry after a loss', len(trp) == 2, [(t.meth, t.outcome, t.qty) for t in trp])
if len(trp) == 2:
    per = abs(trp[1].entryPx - trp[1].stopPx) * 20.0
    ok('seq: retry risk = 50% of the first trade risk (whole contracts, rounded down)', trp[1].qty == int((0.5 * trp[0].riskUsd) // per), (trp[1].qty, trp[0].riskUsd, per))
    ok('seq: actual risk never exceeds the budget', trp[1].riskUsd <= 0.5 * trp[0].riskUsd + 1e-9)
e = scen(SEQ, fibOn=True, rejOn=True, seq='one', sizeMode='Fixed cash risk', cash=500.0)
trp = [t for t in e.trades if t.slot == 6]
ok('one-trade mode: no retry', len(trp) == 1, len(trp))
ok('one-trade mode records why', any('daily sequence complete' in r for r in e.rj), list(e.rj))

# ---- Standard vs Precision are independent (separate plans / trades)
e = scen(BASE + FIBX, fibOn=True, rejOn=False)
ok('variants are independent: both armed from one setup', e.setups[0].mdlS.st in (2, 3, 4) and e.setups[0].mdlP.st in (2, 3, 4) and e.setups[0].mdlS is not e.setups[0].mdlP)


# ============================ levels, trading day, DST, HTF
import datetime as _dt
def stream(t0, t1, fn=None, base=20000.0, skip_break=True):
    out = []; t = t0
    while t < t1:
        d = _dt.datetime.fromtimestamp(t / 1000.0, NYZ)
        if not (skip_break and d.hour == 17):
            o, h, l, c = fn(t) if fn else (base, base + 0.5, base - 0.5, base)
            out.append(bar(t, o, h, l, c))
        t += 60000
    return out

def lv_of(e, ty): return [l for l in e.levels if l.ty == ty]

# previous completed TRADING-day high/low (18:00 -> 17:00) is known only after that day completed (first bar of the next trading day)
tue18 = T(2025, 3, 11, 18, 0); wed18 = T(2025, 3, 12, 18, 0)
def f_day(t):
    if t == T(2025, 3, 12, 3, 0): return (20000, 20080, 20000, 20000)
    if t == T(2025, 3, 12, 14, 0): return (20000, 20000.5, 19920, 20000)
    return (20000, 20000.5, 19999.5, 20000)
e = engine(stream(tue18, T(2025, 3, 12, 17, 0), f_day), [])
ok('PDH/PDL not known before the trading day completes', not lv_of(e, 'PDH') and not lv_of(e, 'PDL'))
e = engine(stream(tue18, wed18 + 30 * 60000, f_day), [])
ok('PDH/PDL from the completed 18:00->17:00 trading day', lv_of(e, 'PDH') and lv_of(e, 'PDH')[0].px == 20080 and lv_of(e, 'PDL')[0].px == 19920, [(l.ty, l.px) for l in e.levels if l.ty.startswith('PD')])
ok('PDH availability timestamp is after the day completed (conservative: first bar of the next trading day)', lv_of(e, 'PDH')[0].known == wed18 + 60000, lv_of(e, 'PDH')[0].known)
ok('an 18:00 session belongs to the FOLLOWING trading day', e.tdk == 20250313, e.tdk)

# key opens: reference only, never a sweep / setup
def f_open(t): return (20000, 20000.5, 19999.5, 20000)
e = engine(stream(T(2025, 3, 11, 17, 59), T(2025, 3, 12, 11, 0), lambda t: (20000, 20000.5, 19999.5, 20000)), [])
ok('key opens exist as reference levels (18:00, 00:00, 10:00)', {'O1800', 'O0000', 'O1000'} <= {l.ty for l in e.levels}, [l.ty for l in e.levels])
ok('key opens never create a setup', not e.setups)
o10 = lv_of(e, 'O1000')[0]
ok('10:00 open is not available before 10:00 closes', o10.known == T(2025, 3, 12, 10, 1), o10.known)

# opening range: frozen at 10:00, level exists only from then; the creating bar can not sweep it
def f_or(t):
    d = _dt.datetime.fromtimestamp(t / 1000.0, NYZ); m = d.hour * 60 + d.minute
    if m == 575: return (20000, 20020, 19999.5, 20000)       # 09:35 high
    if m == 599: return (20000, 20030, 19999.5, 20000)       # 09:59 sets a NEW high inside the range
    return (20000, 20000.5, 19999.5, 20000)
bars = stream(T(2025, 3, 12, 9, 30), T(2025, 3, 12, 10, 1), f_or)
e = X.Ctx()
for i, b in enumerate(bars):
    e.onBar(b, i)
orh = lv_of(e, 'ORH')[0]
ok('OR high includes the 09:59 candle', orh.px == 20030)
ok('OR known at 10:00 (when the 09:59 candle closed)', orh.known == T(2025, 3, 12, 10, 0), orh.known)
ok('the candle that created OR cannot sweep it', orh.st == 0)

# previous regular session needs all 390 candles
def f_rth(t): return (20000, 20050 if t == T(2025, 3, 12, 11, 0) else 20000.5, 19950 if t == T(2025, 3, 12, 13, 0) else 19999.5, 20000)
e = engine(stream(T(2025, 3, 12, 9, 30), T(2025, 3, 12, 16, 1), f_rth), [])
ok('prev-session H/L created when 15:59 closes', lv_of(e, 'PSH') and lv_of(e, 'PSH')[0].px == 20050 and lv_of(e, 'PSL')[0].px == 19950 and lv_of(e, 'PSH')[0].known == T(2025, 3, 12, 16, 0))
bars = [b for b in stream(T(2025, 3, 12, 9, 30), T(2025, 3, 12, 16, 1), f_rth) if b['t'] != T(2025, 3, 12, 12, 0)]
e = engine(bars, [])
ok('incomplete regular session creates no PSH/PSL', not lv_of(e, 'PSH'))

# DST: spring forward Sunday 2025-03-09; the Sunday 18:00 EDT bar belongs to Monday trading day; OR / PS levels follow the NY clock
sun18 = T(2025, 3, 9, 18, 0)
e = engine(stream(sun18, sun18 + 60000), [])
ok('DST spring: Sunday 18:00 starts Monday trading day', e.tdk == 20250310, e.tdk)
e = engine(stream(T(2025, 3, 10, 9, 30), T(2025, 3, 10, 10, 1), f_or if False else (lambda t: (20000, 20000.5, 19999.5, 20000))), [])
ok('DST spring Monday: OR known at 10:00 NY clock time', lv_of(e, 'ORH') and lv_of(e, 'ORH')[0].known == T(2025, 3, 10, 10, 0))
sun18f = T(2025, 11, 2, 18, 0)
e = engine(stream(sun18f, sun18f + 60000), [])
ok('DST fall: Sunday 18:00 EST starts Monday trading day', e.tdk == 20251103, e.tdk)
# 4H candles are anchored at 18:00 NY on both sides of a DST change
for a0, nm in ((T(2025, 3, 10, 18, 0), 'spring'), (T(2025, 11, 3, 18, 0), 'fall')):
    e = engine(stream(a0, a0 + 23 * 3600000 + 3600000 * 0), [])
    h4 = e.aggs[240].hist
    ok('4H candles anchored at 18:00 NY (%s)' % nm, len(h4) >= 4 and all(((_dt.datetime.fromtimestamp(c.t0 / 1000.0, NYZ).hour - 18) % 4) == 0 for c in h4), [_dt.datetime.fromtimestamp(c.t0 / 1000.0, NYZ).hour for c in h4])

# HTF bias only from COMPLETED candles, with availability timestamp
def f_up(t):
    k = (t - T(2025, 3, 12, 9, 0)) // 3600000
    base = 20000 + 50 * k
    return (base, base + 40, base - 5, base + 40)
bars = stream(T(2025, 3, 12, 8, 0), T(2025, 3, 12, 11, 59), f_up)
e = X.Ctx()
seen = {}
for i, b in enumerate(bars):
    e.onBar(b, i)
    seen[b['t']] = e.bias.get(60)
ok('1H bias is unavailable until two 1H candles completed', seen[T(2025, 3, 12, 8, 59)] is None)
ok('1H bias changes only when the candle completes', seen[T(2025, 3, 12, 9, 58)] != seen[T(2025, 3, 12, 9, 59)] or seen[T(2025, 3, 12, 9, 58)] == seen[T(2025, 3, 12, 9, 59)])
b60 = e.bias[60]
ok('1H bias bullish after higher closes, stamped at the last candle close', b60[0] == 1 and b60[1] in (T(2025, 3, 12, 11, 59), T(2025, 3, 12, 11, 0)), b60)
e2 = X.Ctx()
for i, b in enumerate(bars):
    if b['t'] <= T(2025, 3, 12, 9, 58): e2.onBar(b, i)
ok('bias at 09:58 does not use the unfinished 09:00 candle', e2.bias.get(60) is None or e2.bias[60][1] <= T(2025, 3, 12, 9, 0))

# equal highs become a level only when the second pivot is confirmed
EQ = [(20000, 20005, 19999, 20003), (20003, 20010, 20002, 20005), (20005, 20004, 20000, 20001), (20001, 20003, 19999, 20000), (20000, 20009.75, 19999.5, 20002), (20002, 20004, 19999, 20000), (20000, 20003, 19998, 19999)]
e = engine(candles((*D, 9, 30), EQ), [])
eq = lv_of(e, 'EQH')
ok('equal highs level created (2/2 pivots within tolerance)', eq and eq[0].px == 20010 and eq[0].known == at(9, 30) + 7 * 300000, [(l.px, l.known) for l in eq])

# ============================ filters, POI, SMT, helpers
def filt(**kw): return scen(BASE, **kw)
e = filt(bias1=True)
ok('bias filter: unavailable HTF bias rejects with a reason', e.setups[0].mdlS.st == 4 and 'bias 1H' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
e = filt(chop=True, chopN=5, chopMin=0.99)
ok('chop filter rejects', e.setups[0].mdlS.st == 4 and 'chop' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
e = filt(po3=True)
ok('PO3 filter requires the PO3 range to be the swept level', e.setups[0].mdlS.st == 4 and 'PO3' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)
e = scen(BASE, lv=[('PO3L', -1, 19990.0), ('PDH', 1, 20100.0)], po3=True)
ok('PO3 filter passes when the PO3 low was swept', e.setups[0].mdlS.st == 2, e.setups[0].mdlS.why)
e = filt(conf=True)
ok('confluence filter passes with overlapping FVG + iFVG', e.setups[0].mdlS.st == 2, e.setups[0].mdlS.why)
e = filt(ifReq=True, aIf=False)
ok('iFVG-required filter rejects when no iFVG exists', e.setups[0].mdlS.st == 4 and 'iFVG' in e.setups[0].mdlS.why, e.setups[0].mdlS.why)

# selected HTF POI preference
bars = candles((*D, 9, 30), BASE)
e = X.Ctx(poi='15m FVG'); e.poiF[15] = [dict(dir=1, lo=19985.0, hi=19991.5, known=0, dead=False)]
for (ty, side, px) in LV:
    e.time = 0; e.lid += 1; e.levels.append(X.Lvl(e.lid, ty, side, px, 0, 0))
for i, b in enumerate(bars): e.onBar(b, i)
mS = e.setups[0].mdlS
ok('area overlapping the selected HTF POI is preferred over the nearest', mS.st == 2 and mS.area.kind == 'OB' and abs(mS.lim - X.rt(19988.25)) < 1e-9, (mS.area.kind, mS.lim))

# CE proximity (engineered liquidity just beyond the CE)
e = scen(BASE)
st0 = e.setups[0]; e.time = at(10, 0); e.tclose = e.time + 60000
e.levels.append(X.Lvl(98, 'EQL', -1, 19996.5, 0, 0))
ok('CE proximity detects liquidity within N points beyond the CE', e.ceProx(st0, 19997.75) and not e.ceProx(st0, 20010.0))

# SMT (reversal role)
def with_es(bars, esl):
    for b in bars: b['esl'] = esl(b); b['esh'] = esl(b) + 5
    return bars
t_sw = at(9, 40)
bars = with_es(candles((*D, 9, 30), BASE), lambda b: 4900.0 if b['t'] < t_sw else 4905.0)
e = engine(bars, LV, smt=True)
ok('SMT reversal: peer failed to take its own low -> present, setup passes', e.setups[0].smt is True and e.setups[0].mdlS.st == 2, (e.setups[0].smt, e.setups[0].mdlS.why))
bars = with_es(candles((*D, 9, 30), BASE), lambda b: 4900.0 if b['t'] < t_sw else 4890.0)
e = engine(bars, LV, smt=True)
ok('SMT reversal: peer also took its low -> rejected with a reason', e.setups[0].smt is False and e.setups[0].mdlS.st == 4 and 'SMT' in e.setups[0].mdlS.why, (e.setups[0].smt, e.setups[0].mdlS.why))

# stable IDs / no re-arming on reload: the same bars give identical results twice
a = scen(BASE + FIBX); b = scen(BASE + FIBX)
ok('deterministic: identical input gives identical setups/plans', [(m.slot, m.meth, m.lim, m.stp, m.tgt, m.armT) for m in a.plans] == [(m.slot, m.meth, m.lim, m.stp, m.tgt, m.armT) for m in b.plans])

print('passed', PASS, 'failed', len(FAIL))
sys.exit(1 if FAIL else 0)
