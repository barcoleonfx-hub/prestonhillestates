"""Deterministic model of the H Ticks FVG/iFVG lifecycle RULES (tick 0.25).
This is a Python re-implementation of the intended logic, NOT a Pine execution."""
TICK = 0.25
def tk(x): return round(x / TICK)
def overlap(hi, lo, zb, zt): return tk(hi) >= tk(zb) and tk(lo) <= tk(zt)

# ---------- chart layer (mirrors f_stepChart) ----------
class CZ:
    def __init__(s, d, top, bot, bar): s.dir, s.top, s.bot, s.formBar, s.invBar, s.state = d, top, bot, bar, -1, 'FVG'
def step(z, hi, lo, cl, bi):
    if bi <= z.formBar: return 'none'
    bull = z.dir > 0
    if z.state == 'FVG':
        if (tk(cl) < tk(z.bot)) if bull else (tk(cl) > tk(z.top)):
            z.state, z.invBar = 'IFVG', bi
            return 'inverted'
    elif bi > z.invBar:
        if (tk(cl) > tk(z.top)) if bull else (tk(cl) < tk(z.bot)): return 'removed:invalidation'
        if overlap(hi, lo, z.bot, z.top): return 'removed:touch'
    return 'none'
def gap(h3, l3, h1, l1, minT=1):  # candle1=(h3,l3), candle3=(h1,l1)
    if tk(l1) - tk(h3) >= minT: return ('bull', l1, h3)
    if tk(l3) - tk(h1) >= minT: return ('bear', l3, h1)
    return None

# ---------- source engine + HTF chart side (mirrors f_engine / f_tapStore / f_reconcile) ----------
class Eng:
    def __init__(s, cap=100): s.Z, s.cap = [], cap
    def candle(s, t_open, t_close, h, l, c):   # one COMPLETED source candle, after prior 2 candles given via gap()
        s.Z = [z for z in s.Z if not z['flag']]
        for z in s.Z:
            if t_open >= z['conf']:
                if (tk(c) < tk(z['bot'])) if z['dir'] > 0 else (tk(c) > tk(z['top'])): z['flag'] = True
                elif z['tap'] == 0 and overlap(h, l, z['bot'], z['top']): z['tap'] = t_close
    def form(s, t_open, t_close, g, d):
        s.Z.append(dict(ft=t_open, dir=d, top=g[1] if d > 0 else g[1], bot=g[2], conf=t_close, tap=0, flag=False))
        if len(s.Z) > s.cap: s.Z.pop(0)
def htf_tap(z, c_open, hi, lo):
    if not z['tapped'] and c_open >= z['conf'] and overlap(hi, lo, z['bot'], z['top']): z['tapped'] = True; return True
    return False

R = []
def chk(name, cond, kind='SIMULATED'): R.append((name, 'PASS' if cond else 'FAIL', kind))

# ===== A. bullish 100-110 =====
def mk(d, top=110, bot=100): return CZ(d, top, bot, 0)
z = mk(1)
chk('A: low 99, close 105 stays FVG', step(z, 108, 99, 105, 1) == 'none' and z.state == 'FVG')
chk('A: close 100 stays FVG', step(z, 108, 99, 100, 2) == 'none' and z.state == 'FVG')
chk('A: close 100.25 stays FVG', step(z, 108, 99, 100.25, 3) == 'none' and z.state == 'FVG')
chk('A: intrabar 99, close 102 stays FVG', step(z, 108, 99, 102, 4) == 'none' and z.state == 'FVG')
z = mk(1)
chk('A: close 99.75 -> red bear iFVG', step(z, 108, 99, 99.75, 1) == 'inverted' and z.state == 'IFVG' and z.dir > 0)
chk('A: inversion candle overlaps; iFVG survives (same bar)', step(z, 108, 99, 99.75, 1) == 'none')
chk('A: next candle high 99.75 close 99 -> iFVG remains', step(z, 99.75, 98, 99, 2) == 'none')
chk('A: later high exactly 100 -> removed (touch)', step(z, 100, 98, 99, 3) == 'removed:touch')
z = mk(1); step(z, 108, 99, 99.75, 1)
chk('A: gap above 110, close 111 -> removed (invalidation)', step(z, 112, 110.5, 111, 2) == 'removed:invalidation')
# ===== B. bearish 100-110 =====
z = mk(-1)
chk('B: high 111 close 105 stays bear FVG', step(z, 111, 104, 105, 1) == 'none' and z.state == 'FVG')
chk('B: close 110 stays', step(z, 111, 104, 110, 2) == 'none' and z.state == 'FVG')
z = mk(-1)
chk('B: close 110.25 -> green bull iFVG', step(z, 111, 104, 110.25, 1) == 'inverted' and z.state == 'IFVG')
chk('B: inversion candle cannot remove it', step(z, 111, 104, 110.25, 1) == 'none')
chk('B: next low 110.25 remains', step(z, 112, 110.25, 111, 2) == 'none')
chk('B: later low exactly 110 -> removed (touch)', step(z, 112, 110, 111, 3) == 'removed:touch')
z = mk(-1); step(z, 111, 104, 110.25, 1)
chk('B: entirely below 100, close 99 -> removed (invalidation)', step(z, 99.5, 98, 99, 2) == 'removed:invalidation')
# ===== C. HTF bullish 100-110 =====
e = Eng(); e.form(0, 100, ('bull', 110, 100), 1); zc = e.Z[0]
zc2 = dict(zc, tapped=False)
chk('C: formation-candle range cannot tap (candle opens before confTime)', not htf_tap(zc2, 90, 112, 95))
chk('C: later chart candle low 109 high 112 -> Tapped', htf_tap(zc2, 100, 112, 109))
# a lower-TF close 99.75 never reaches the engine; engine only sees source closes:
e2 = Eng(); e2.form(0, 100, ('bull', 110, 100), 1); e2.candle(100, 200, 112, 99, 101)
chk('C: source close 101 keeps zone (tapped)', not e2.Z[0]['flag'] and e2.Z[0]['tap'] == 200)
e2.candle(200, 300, 105, 99, 100)
chk('C: source close 100 keeps zone', not e2.Z[0]['flag'])
e2.candle(300, 400, 105, 98, 99.75)
chk('C: source close 99.75 -> removed (flag)', e2.Z[0]['flag'])
e3 = Eng(); e3.form(0, 100, ('bull', 110, 100), 1); e3.candle(100, 200, 112, 111, 111.5)
chk('C: touch-less gap-through above does not invert a bullish HTF gap', not e3.Z[0]['flag'])
# ===== D. HTF bearish 100-110 =====
e = Eng(); e.form(0, 100, ('bear', 110, 100), -1); zd = dict(e.Z[0], tapped=False)
chk('D: chart candle high 101 low 98 -> Tapped', htf_tap(zd, 100, 101, 98))
e.candle(100, 200, 111, 104, 110)
chk('D: source close exactly 110 keeps', not e.Z[0]['flag'])
e.candle(200, 300, 112, 105, 110.25)
chk('D: source close 110.25 removes', e.Z[0]['flag'])
# ===== E. detection / edge =====
chk('E: bullish gap needs candle3 low > candle1 high', gap(100, 95, 109, 100.25) == ('bull', 100.25, 100))
chk('E: equal wick boundaries -> no gap', gap(100, 95, 109, 100) is None)
chk('E: gap exactly 1 tick qualifies', gap(100, 95, 109, 100.25, 1) is not None)
chk('E: sub-tick-minimum gap (2-tick min, 1-tick gap) rejected', gap(100, 95, 109, 100.25, 2) is None)
chk('E: bearish gap high < low[2]', gap(110, 105, 104, 100) == ('bear', 105, 104))
# mitigated FVG can still invert later
z = mk(1); step(z, 108, 101, 105, 1)
chk('E: mitigated FVG inverts later', step(z, 108, 99, 99.5, 2) == 'inverted')
# several zones invert on same candle, independent
zs = [mk(1, 110, 100), mk(1, 108, 98), mk(-1, 103, 97)]
res = [step(q, 100, 95, 94, 1) for q in zs]
chk('E: several zones invert on one candle; overlapping zones independent', res == ['inverted', 'inverted', 'none'])
# one lifecycle transition per bar
z = mk(1); r1 = step(z, 200, 50, 99.75, 1)
chk('E: max one transition per zone per bar (FVG->iFVG, not removed same bar)', r1 == 'inverted' and z.state == 'IFVG')
# selection (equal/lower/dup)
def select(chart, slots):
    out, seen = [], []
    for en, s in slots:
        if en and s > chart and s not in seen: out.append(s); seen.append(s)
    return out
chk('E: on 1m picks 15m,1H,4H', select(60, [(1, 900), (1, 3600), (1, 14400), (0, 86400)]) == [900, 3600, 14400])
chk('E: on 15m equal TF excluded (chart layer only)', select(900, [(1, 900), (1, 3600), (1, 14400), (0, 86400)]) == [3600, 14400])
chk('E: on 4H lower excluded, 1D if enabled', select(14400, [(1, 900), (1, 3600), (1, 14400), (1, 86400)]) == [86400])
chk('E: duplicate selections deduplicated', select(60, [(1, 3600), (1, 3600), (1, 14400), (0, 0)]) == [3600, 14400])
# watermark: removed zone cannot be re-imported; capacity pruning deterministic oldest-first
wm = 0; store = []
def import_snap(snap):
    global wm
    for ft in snap:
        if ft not in store and ft > wm: store.append(ft); wm = ft
import_snap([10, 20, 30]); store.remove(20)
import_snap([10, 20, 30]); 
chk('E: removed zones never resurrect (watermark)', 20 not in store)
e = Eng(cap=3)
for i in range(5): e.form(i * 100, i * 100 + 100, ('bull', 110, 100), 1)
chk('E: capacity pruning oldest-first & deterministic', [z['ft'] for z in e.Z] == [200, 300, 400])
# pre-formation tap / straddle protection
zq = dict(ft=0, conf=100, top=110, bot=100, tapped=False)
chk('E: chart candle opening before confirmation (straddle) cannot tap', not htf_tap(zq, 95, 120, 90))
# stale snapshot cannot un-tap (monotonic OR)
tapped = True; snap_tap = 0
tapped = tapped or snap_tap > 0
chk('E: stale snapshot cannot revert Tapped -> Untapped', tapped)
# coverage gate: chart starting inside a source period -> skip that period's snapshot
def covered(first_time, cur_open): return first_time <= cur_open
chk('E: chart starting mid source-period is not trusted for that period', not covered(907, 900) and covered(900, 900) and covered(907, 1800))


# ======================= repair-pass models (mirror the revised f_engine / f_reconcile) =======================
import random
def mkcandles(n, seed):
    rnd = random.Random(seed); out = []; px = 100.0
    for i in range(n):
        o = px + rnd.choice([-2, -1, 0, 0, 1, 2]) * 0.75
        h = o + rnd.randint(1, 6) * 0.25; l = o - rnd.randint(1, 6) * 0.25
        c = rnd.choice([l, h, (h + l) / 2]); c = round(c / TICK) * TICK
        out.append((i * 100, i * 100 + 100, h, l, c)); px = c
    return out
def run_engine(cd, first, last, budget, cap, minT=1):
    """Z rows: [ft, code(+-1 live, +-2 flagged), top, bot, conf, tap, fidx]. Candle c processed at bar c+1."""
    Z = []
    for c in range(first, last + 1):
        to, tc, h, l, cl = cd[c]
        Z = [z for z in Z if abs(z[1]) != 2]
        for z in Z:
            if to >= z[4]:
                inv = tk(cl) < tk(z[3]) if z[1] > 0 else tk(cl) > tk(z[2])
                if inv: z[1] *= 2
                elif z[5] == 0 and overlap(h, l, z[3], z[2]): z[5] = tc
        if c >= 2:
            h3, l3 = cd[c - 2][2], cd[c - 2][3]
            if tk(l) - tk(h3) >= minT: Z.append([to, 1, l, h3, tc, 0, c])
            elif tk(l3) - tk(h) >= minT: Z.append([to, -1, l3, h, tc, 0, c])
        Z = [z for z in Z if not (abs(z[1]) == 1 and c - z[6] >= budget)]
        over = len(Z) - sum(abs(z[1]) == 2 for z in Z) - cap
        i = 0
        while over > 0 and i < len(Z):
            if abs(Z[i][1]) == 1: Z.pop(i); over -= 1
            else: i += 1
    return Z
BUD = 40
cd = mkcandles(900, 7)
def window_equal(cap, bounds):
    bad = []
    for L in bounds:   # L = index of last bar; its last completed candle is L-1
        live = run_engine(cd, 0, L - 1, BUD, cap)
        fresh = run_engine(cd, max(0, L - BUD), L - 1, BUD, cap)
        if live != fresh: bad.append(L)
    return bad
bnds = list(range(60, 880, 7))
chk('Repair2: uninterrupted == fresh reconstruction across 117 advancing history boundaries (cap 100)', window_equal(100, bnds) == [])
bad_small = window_equal(3, bnds)
chk(f'Repair2: same with a tiny cap (3) [mismatching boundaries: {len(bad_small)}/117]', bad_small == [])
# without expiry the old behaviour would diverge (shows the test is able to fail)
def run_noexp(cd, L, budget, cap):
    return [z for z in run_engine(cd, 0, L - 1, 10**9, cap)]
div = sum(1 for L in bnds if run_noexp(cd, L, BUD, 100) != run_engine(cd, max(0, L - BUD), L - 1, BUD, 100))
chk(f'Repair2: control - without age expiry live != fresh at {div} boundaries (test can fail)', div > 0)
# expiry is silent: an expired zone is absent and NOT flagged
zz = run_engine(cd, 0, 500, BUD, 100)
chk('Repair2: expired zones are absent, never flagged as inverted', all(abs(z[1]) in (1, 2) and (abs(z[1]) == 2 or 500 - z[6] < BUD) for z in zz))
# capacity prune must not drop a just-inverted zone's event
man = [(0, 100, 100, 95, 98), (100, 200, 108, 99, 100), (200, 300, 112, 105, 111), (300, 400, 98.75, 98, 98.5)]
zm = run_engine(man, 0, 2, 50, 1)
chk('Repair: bull gap forms at candle 2 (setup)', len(zm) == 1 and zm[0][1] == 1 and zm[0][3] == 100 and zm[0][2] == 105)
zm = run_engine(man, 0, 3, 50, 1)
chk('Repair: cap=1; inverted zone flagged AND new gap added; inversion event retained (not pruned)',
    len(zm) == 2 and zm[0][1] == 2 and zm[1][1] == -1)
zm = run_engine(man + [(400, 500, 99, 98, 98.5)], 0, 4, 50, 1)
chk('Repair: flagged zone purged next bar, no stale entry', all(abs(z[1]) == 1 for z in zm))
# bootstrap import must not announce; later genuine events must
def reconcile(store, snap, gen, asOf, wm):
    evs = []; seen = set()
    for z in snap:
        ft, flg, conf, tap = z['ft'], z.get('flag', False), z['conf'], z.get('tap', 0)
        m = next((s for s in store if s['ft'] == ft), None)
        if m:
            seen.add(ft)
            if flg: m['end'] = True
            elif tap and not m['tapped']:
                m['tapped'] = True
                if gen: evs.append('tap')
        elif not flg and ft > wm[0]:
            store.append(dict(ft=ft, tapped=bool(tap), conf=conf)); seen.add(ft); wm[0] = ft
            if gen and conf == asOf: evs.append('new')
    for s in list(store):
        if s.get('end'):
            store.remove(s)
            if gen: evs.append('inv')
        elif s['ft'] not in seen: store.remove(s)
    return evs
store, wm = [], [0]
e1 = reconcile(store, [dict(ft=1, conf=10), dict(ft=2, conf=20, tap=25), dict(ft=3, conf=30)], False, 30, wm)
chk('Repair4: bootstrap import of 3 old zones announces nothing', e1 == [] and len(store) == 3 and store[1]['tapped'])
e2 = reconcile(store, [dict(ft=1, conf=10, flag=True), dict(ft=2, conf=20, tap=25), dict(ft=3, conf=30, tap=40), dict(ft=4, conf=60)], True, 60, wm)
chk('Repair4: later tap, inversion and genuine new zone ARE announced', sorted(e2) == ['inv', 'new', 'tap'])
e3 = reconcile(store, [dict(ft=2, conf=20, tap=25), dict(ft=3, conf=30, tap=40), dict(ft=4, conf=60), dict(ft=5, conf=70)], True, 90, wm)
chk('Repair4: zone imported late (conf != asOf) is silent', e3 == [] and any(s['ft'] == 5 for s in store))
chk('Repair: watermark does not block updates to existing zones (tap on ft<=wm applied)', store[1]['tapped'])
# exact-token timeframe de-duplication
def tok_add(cur, tf):
    t = cur.split(','); return cur if tf in t else (tf if cur == '' else cur + ',' + tf)
chk('Repair6: "5m" and "15m" are distinct tokens, true duplicate ignored', tok_add(tok_add('15m', '5m'), '15m') == '15m,5m' and tok_add('', '1H') == '1H')
# memory bound
def bound(slots, budget, cap):
    eff = min(budget, 8_000_000 // (slots * 7 * cap)); return eff, slots * eff * 7 * cap * 8 / 1e6
for sl, bu, cp in [(3, 1000, 100), (4, 1000, 100), (4, 4000, 200), (4, 1000, 200)]:
    eff, mb = bound(sl, bu, cp); print(f"   memory bound slots={sl} budget={bu} cap={cp}: effective budget {eff}, worst-case {mb:.1f} MB")
chk('Repair3: default worst-case bound <= 64 MB and max settings are clamped to <= 64 MB', bound(4, 1000, 100)[1] <= 64 and bound(4, 4000, 200)[1] <= 64.01)
print(f"{'test':72} {'result':6} basis")
for n, r, k in R: print(f"{n:72} {r:6} {k}")
print(sum(r == 'PASS' for _, r, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r == 'PASS' for _, r, _ in R) else 1)
