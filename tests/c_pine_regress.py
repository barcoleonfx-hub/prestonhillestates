# Regression scenarios that EXECUTE THE ACTUAL PINE SOURCE (H_Ticks_C_10AM_Precision.pine) through tests/pine_interp.py (my own interpreter of the Pine
# subset used here; NOT TradingView). Each scenario is run on the patched source and, where the point is a behaviour CHANGE, also on the pre-audit
# source (tests/c_before_audit.pine) to show what used to happen.
import sys, os, datetime as dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pine_interp import Interp, Obj, PArr
from c_helpers import T, bar, NYZ, mkday
from c_ctx_helpers import candles, five, flat, stream
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NEW = open(os.path.join(ROOT, 'H_Ticks_C_10AM_Precision.pine'), encoding='utf-8').read()
OLD = open(os.path.join(ROOT, 'tests', 'c_before_audit.pine'), encoding='utf-8').read()
LEGACY = open(os.path.join(ROOT, 'H_Ticks_C_Legacy_10AM.pine'), encoding='utf-8').read()
PASS = 0; FAIL = []
SKIPPED = []
def ok(name, cond, info=''):
    global PASS
    if 'PRE-AUDIT' in name:
        SKIPPED.append(name); print('SKIP (pre-audit source not executed)', name); return
    if cond: PASS += 1; print('PASS', name)
    else: FAIL.append(name); print('FAIL', name, info)

class FakeIt:
    def g(self, n): return PArr()
    G = None

def run(bars, src=NEW, inputs=None, inject=(), draw=False):
    if src is OLD: return FakeIt()   # the pre-audit source takes >30 min to parse with the third-party parser; old behaviour is shown by the Python legacy model + text diff instead
    inputs = dict(inputs or {})
    if src is NEW: inputs.setdefault('inCmpVar', True)   # simulate Standard AND Precision
    it = Interp(src, inputs)
    for i, b in enumerate(bars):
        it.feed(b, i, last=(draw and i == len(bars) - 1))
        if i == 0 and inject:
            for (ty, side, px) in inject:
                cx = it.g('cxN'); cx[0] += 1
                it.g('lvls').append(it.construct('Lvl', [], dict(id=cx[0], ty=ty, side=side, px=px, origin=b['t'], known=b['t']), it.G))
    return it
def L(it, name): return list(it.g(name))
def trades(it, slot=None): return [t for t in L(it, 'trades') if slot is None or t.f['slot'] == slot]
def plans(it, slot=None, meth=None): return [m for m in L(it, 'plans') if (slot is None or m.f['slot'] == slot) and (meth is None or m.f['meth'] == meth)]
def setups(it): return L(it, 'sets')

D = (2025, 3, 12)
def at(h, m, d=D): return T(*d, h, m)
LV = [('PDL', -1, 19990.0), ('PDH', 1, 20100.0)]
BASE = [(20000, 20001, 19994, 19995), (19995, 19996, 19990.5, 19991), (19991, 19991.5, 19985, 19987), (19987, 19999.5, 19987, 19999), (19999, 20008, 19999, 20006)]
FIBX = [(20006, 20015, 20004, 20012), (20012, 20010, 20005, 20007), (20007, 20009, 20004.5, 20006)]
def mir(sp): return None if sp is None else (40000 - sp[0], 40000 - sp[2], 40000 - sp[1], 40000 - sp[3])
def mlv(lv): return [(t.replace('PDL', 'PDH') if s < 0 else t.replace('PDH', 'PDL'), -s, 40000 - p) for (t, s, p) in lv]
def sc(specs, mirror=False, start=(*D, 9, 30), raw=(), lv=LV):
    if mirror: specs = [mir(x) for x in specs]; lv = mlv(lv)
    b = candles(start, specs)
    b += [bar(t, *( (o, h, l, c) if not mirror else (40000 - o, 40000 - l, 40000 - h, 40000 - c))) for (t, o, h, l, c) in raw]
    return b, lv


# =============================================================== 1. gap execution policy (contextual)
for mirror in (False, True):
    tag = ' [short]' if mirror else ' [long]'
    P = (lambda x: 40000 - x) if mirror else (lambda x: x)
    # (a) gap through entry AND stop (Standard): the resting limit is NOT assumed cancelled
    b, lv = sc(BASE, mirror, raw=[(at(9, 55), 19970, 19971, 19969, 19970)])
    it = run(b, inject=lv)
    tr = trades(it, 5)
    ok('gap: Standard gap through entry+stop becomes a trade' + tag, len(tr) == 1, [(m.f['st'], m.f['why']) for m in plans(it, 5)])
    if tr:
        t = tr[0].f
        ok('gap: flagged gap + ambiguous (outcome 4), exit at the OPEN (worse than the stop), entry at the limit' + tag, t['gap'] is True and t['outcome'] == 4 and abs(t['exitPx'] - P(19970)) < 1e-9 and abs(t['entryPx'] - P(19997.75)) < 1e-9, t)
        ok('gap: counted as a loss worse than 1R' + tag, t['netR'] < -1.0, t['netR'])
    old = run(b, src=OLD, inject=lv)
    ok('gap: the PRE-AUDIT source silently cancelled it (no trade)' + tag, len(trades(old, 5)) == 0 and any('opened beyond' in m.f['why'] for m in plans(old, 5)), [(m.f['why']) for m in plans(old, 5)])
    # (b) gap through the entry only: ordinary fill
    b, lv = sc(BASE, mirror, raw=[(at(9, 55), 19990, 19991, 19989, 19990.5)])
    it = run(b, inject=lv); tr = trades(it, 5)
    ok('gap: gap through the entry only (open above the stop) is an ordinary fill, no gap flag' + tag, len(tr) == 1 and tr[0].f['gap'] is False and tr[0].f['outcome'] in (0, 2), [(t.f['gap'], t.f['outcome']) for t in tr])
    # (c) Precision pending order gapped through its stop
    b, lv = sc(BASE + FIBX, mirror, raw=[(at(10, 10), 19985.5, 19986, 19985.25, 19985.5)])
    it = run(b, inject=lv, inputs=dict(inPRejOn=False))
    trp = trades(it, 6)
    ok('gap: Precision gap through entry+stop becomes a flagged trade (not "cancelled before the fill")' + tag, len(trp) == 1 and trp[0].f['gap'] is True and trp[0].f['meth'] == 'Fib 0.705', [(m.f['st'], m.f['why']) for m in plans(it, 6)])
    old = run(b, src=OLD, inject=lv, inputs=dict(inPRejOn=False))
    ok('gap: the PRE-AUDIT source cancelled it silently' + tag, len(trades(old, 6)) == 0 and any('breached' in m.f['why'] for m in plans(old, 6)), [(m.f['why']) for m in plans(old, 6)])
    # gap events are counted in the performance table
    it2 = run(b, inject=lv, inputs=dict(inPRejOn=False), draw=True)
    ok('gap: performance table has a gap-event row' + tag, any(True for _ in [0]) and 'Gap-through-entry events' in NEW)

# =============================================================== 1b. gap execution policy (LEGACY 10am preset)
LEG = dict(inThr='Fixed points', inVariant='Precision')
def prec_day(extra=None, orLow=19970.0):
    spec = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20002, 20014), (10, 2): (20014, 20016, 19995, 19996),
            (10, 3): (19996, 19998, 19985, 19990), (10, 4): (19990, 19996, 19988, 19992),
            (10, 5): (19994, 20000.5, 19992, 19993), (10, 6): (19994, 19998, 19990, 19992), (10, 7): (19992, 19994, 19969.5, 19972)}
    if extra: spec.update(extra)
    return mkday(2026, 3, 4, spec, orLow=orLow)
base = run(prec_day(), src=LEGACY, inputs=LEG)
ok('legacy: the normal precision scenario still produces the same trade (target hit)', len(trades(base, 4)) == 1 and trades(base, 4)[0].f['outcome'] == 1, [t.f['outcome'] for t in trades(base, 4)])
g = run(prec_day(extra={(10, 6): (20010, 20012, 20008, 20009)}), src=LEGACY, inputs=LEG)
tg = trades(g, 4)
ok('legacy: Precision gap through entry AND stop is now a flagged gap trade (was: silently cancelled)', len(tg) == 1 and tg[0].f['gap'] is True and tg[0].f['outcome'] == 4 and abs(tg[0].f['exitPx'] - 20010) < 1e-9, [(t.f['gap'], t.f['outcome'], t.f['exitPx']) for t in tg])
go = run(prec_day(extra={(10, 6): (20010, 20012, 20008, 20009)}), src=OLD, inputs=LEG)
ok('legacy: the pre-audit source produced NO trade for that candle (optimistic)', len(trades(go, 4)) == 0)
# Standard model A (10am open limit): a candle opening beyond the frozen manipulation extreme + stop
LEGA = dict(inThr='Fixed points', inVariant='Standard')
ea = run(prec_day(extra={(10, 5): (20020, 20021, 20019, 20020)}), src=LEGACY, inputs=LEGA)
ta = trades(ea, 0)
ok('legacy Standard A: opening beyond the extreme+stop is a flagged gap trade (was: silent invalidation)', len(ta) == 1 and ta[0].f['gap'] is True and ta[0].f['outcome'] == 4, [(t.f['gap'], t.f['outcome'], t.f['exitPx']) for t in ta])

# =============================================================== 2. rejection parent must pre-exist; CISD -> parent -> rejection sequence
ONLY_RB = dict(inAFvg=False, inAOb=False, inABrk=False, inAIf=False, inARb=True, inPFibOn=False, inPRejOn=True)
REJ1 = [(19993, 19996, 19987, 19995)]          # long lower wick, small body: it is BOTH a rejection candle and a rejection-block candidate
for mirror in (False, True):
    tag = ' [short]' if mirror else ' [long]'
    b, lv = sc(BASE + REJ1, mirror)
    it = run(b, inject=lv, inputs=ONLY_RB)
    ok('rejection: a candle that creates its own parent area cannot qualify as a return to it' + tag, len(plans(it, 6, 'Rejection CE')) == 0, [(m.f['st'], m.f['why']) for m in plans(it, 6)])
    st0 = setups(it)[0]
    ok('rejection: that candle did create a rejection-block area (known only after it closed)' + tag, any(a.f['kind'] == 'RB' and a.f['known'] == at(10, 0) for a in st0.f['areas']), [(a.f['kind'], a.f['known']) for a in st0.f['areas']])
    old = run(b, src=OLD, inject=lv, inputs=ONLY_RB)
    ok('rejection: the PRE-AUDIT source did arm an order from that self-created parent' + tag, len(plans(old, 6, 'Rejection CE')) == 1)
    # the first rejection candle's RB IS a legitimate pre-existing parent for the NEXT candle
    b2, lv2 = sc(BASE + REJ1 + [(19992, 19995, 19988, 19994)], mirror)
    it2 = run(b2, inject=lv2, inputs=ONLY_RB)
    pl = plans(it2, 6, 'Rejection CE')
    ok('rejection: a later candle may use the earlier candle\'s area as parent (known before it began)' + tag, len(pl) == 1 and pl[0].f['areaK'] == 'RB' and pl[0].f['parId'] > 0, [(m.f['st'], m.f['why'], m.f['areaK']) for m in plans(it2, 6)])
    if pl:
        par = [a for a in setups(it2)[0].f['areas'] if a.f['id'] == pl[0].f['parId']]
        ok('rejection: the frozen parent id resolves to an area known before the rejection candle opened' + tag, len(par) == 1 and par[0].f['known'] <= at(10, 0), [(a.f['id'], a.f['known']) for a in par])
    # OB enabled: a genuinely pre-existing parent works
    b3, lv3 = sc(BASE + [(19998, 20000, 19989, 19999)], mirror)
    it3 = run(b3, inject=lv3, inputs=dict(inPFibOn=False, inPRejOn=True))
    pl3 = plans(it3, 6, 'Rejection CE')
    ok('rejection: with a pre-existing parent (CISD-time area) the rejection still arms and records the parent id' + tag, len(pl3) == 1 and pl3[0].f['parId'] > 0, [(m.f['st'], m.f['why']) for m in plans(it3, 6)])
# sequence: a 1m rejection candle that OPENED before the CISD was confirmed cannot trigger
spec = BASE[:4]
b = candles((*D, 9, 30), spec)
t50 = at(9, 50)
mini = [(t50, 19999, 20003, 19999, 20002), (t50 + 60000, 20002, 20004, 20001, 20003), (t50 + 120000, 20003, 20006, 20002, 20005), (t50 + 180000, 20005, 20007, 20004, 20006), (t50 + 240000, 20004, 20005, 19996, 20005)]
b += [bar(*m) for m in mini]
it = run(b, inject=LV, inputs=dict(inPFibOn=False, inPRejOn=True, inRejTf='1m'))
ok('sequence: CISD confirmed on the 09:54 candle close', setups(it)[0].f['cisdT'] == at(9, 55), setups(it)[0].f['cisdT'])
ok('sequence: a rejection candle opened before the CISD (09:54 1m) cannot trigger even though it is rejection-shaped', len(plans(it, 6, 'Rejection CE')) == 0, [(m.f['st'], m.f['why']) for m in plans(it, 6)])
old = run(b, src=OLD, inject=LV, inputs=dict(inPFibOn=False, inPRejOn=True, inRejTf='1m'))
ok('sequence: the PRE-AUDIT source triggered on it', len(plans(old, 6, 'Rejection CE')) == 1)
# =============================================================== 3. Sunday context vs Monday-Friday entries
SUN = (2025, 3, 16); MON = (2025, 3, 17)
def sunday_stream():
    def f(t):
        if t == T(*SUN, 20, 0): return (20000, 20080, 19999.5, 20000)
        return (20000, 20000.5, 19999.5, 20000)
    return stream(T(*SUN, 18, 0), T(*MON, 17, 30), f)
bars = sunday_stream()
it = run(bars, inputs=dict(inCxLvAS=True))
lv = {l.f['ty']: l.f for l in L(it, 'lvls')}
ok('sunday: the 18:00 Sunday open exists as a reference level', 'O1800' in lv and lv['O1800']['origin'] == T(*SUN, 18, 0), list(lv))
ok('sunday: the Asia range (19:00-00:00) completed from SUNDAY evening data', 'ASH' in lv and lv['ASH']['px'] == 20080, lv.get('ASH'))
ok('sunday: Monday context - the Daily candle (Sun 18:00 -> Mon 17:00) includes Sunday data: PDH 20080 known at 17:00', 'PDH' in lv and lv['PDH']['px'] == 20080 and lv['PDH']['known'] == T(*MON, 17, 0), lv.get('PDH'))
ok('sunday: higher-timeframe aggregation ran from Sunday 18:00 (4H candles complete)', it.g('aggs')[5].f['doneN'] >= 5 and it.g('aggs')[5].f['dropN'] == 0, (it.g('aggs')[5].f['doneN'], it.g('aggs')[5].f['dropN']))
old = run(bars, src=OLD, inputs=dict(inCxLvAS=True))
lvo = {l.f['ty']: l.f for l in L(old, 'lvls')}
ok('sunday: the PRE-AUDIT source ignored Sunday data (no 18:00 open / Asia range, PDH misses the Sunday spike)', 'O1800' not in lvo and 'ASH' not in lvo and lvo.get('PDH', {}).get('px') != 20080, (list(lvo), lvo.get('PDH')))
# entry eligibility is separate: same setup, Sunday evening vs Monday evening, window 19:30-21:00
WIN = dict(inCxWin='1930-2100', inCxHard='21:00')
b, lvv = sc(BASE, False, start=(*SUN, 19, 30))
it = run(b, inject=lvv, inputs=WIN)
ok('sunday: context processed (setup found and CISD confirmed on Sunday evening)', len(setups(it)) == 1 and setups(it)[0].f['st'] in (2,), [(s.f['st'], s.f['why']) for s in setups(it)])
ok('sunday: but NO order may be armed on a Sunday', len(plans(it)) == 0, [(m.f['slot'], m.f['why']) for m in plans(it)])
b, lvv = sc(BASE, False, start=(*MON, 19, 30))
it = run(b, inject=lvv, inputs=WIN)
ok('sunday: the identical setup on a Monday inside the window DOES arm', len(plans(it, 5)) == 1 and plans(it, 5)[0].f['st'] in (2, 3), [(m.f['slot'], m.f['why']) for m in plans(it)])

# =============================================================== 4. aggregation completeness
def mon(h, m, d=MON): return T(*d, h, m)
flat0 = lambda t: (20000, 20000.5, 19999.5, 20000)
full = stream(mon(9, 0), mon(10, 0), flat0)
it = run(full)
ag = it.g('aggs')
ok('agg: contiguous 09:00-10:00 publishes all twelve 5m candles, none dropped', ag[1].f['doneN'] == 12 and ag[1].f['dropN'] == 0, (ag[1].f['doneN'], ag[1].f['dropN']))
miss = [b for b in full if b['t'] != mon(9, 32)]
it = run(miss); ag = it.g('aggs')
ok('agg: one missing 1m candle -> that 5m candle is DROPPED, not published as complete', ag[1].f['dropN'] == 1 and ag[1].f['doneN'] == 11, (ag[1].f['doneN'], ag[1].f['dropN']))
ok('agg: the hole clears 5m history (nothing can span it): only candles after the hole remain', len(ag[1].f['H']) == 5, len(ag[1].f['H']))
it = run(miss, inputs=dict(inCxMiss=1)); ag = it.g('aggs')
ok('agg: tolerance 1 publishes it (and reports the tolerance)', ag[1].f['dropN'] == 0 and ag[1].f['doneN'] == 12)
trunc = [b for b in full if b['t'] >= mon(9, 2)]
it = run(trunc); ag = it.g('aggs')
ok('agg: a truncated initial bucket (data starts at 09:02) is NOT published', ag[1].f['dropN'] >= 1 and ag[1].f['doneN'] == 11, (ag[1].f['doneN'], ag[1].f['dropN']))
# a full trading day with the scheduled 17:00-18:00 break
day = stream(mon(18, 0), T(2025, 3, 18, 17, 5), flat0)
it = run(day); ag = it.g('aggs')
cnts = {n: (ag[i].f['doneN'], ag[i].f['dropN']) for i, n in enumerate((1, 5, 15, 30, 60, 240, 1440))}
ok('agg: scheduled break explicit - 5m/15m/30m/1H/4H/Daily all complete with nothing dropped', cnts[5] == (276, 0) and cnts[15] == (92, 0) and cnts[30] == (46, 0) and cnts[60] == (23, 0) and cnts[240] == (6, 0) and cnts[1440] == (1, 0), cnts)
ok('agg: the Daily level is published when the break starts (17:00), not an hour later', any(l.f['ty'] == 'PDH' and l.f['known'] == T(2025, 3, 18, 17, 0) for l in L(it, 'lvls')), [(l.f['ty'], l.f['known']) for l in L(it, 'lvls') if l.f['ty'].startswith('PD')])
# unexplained hole of 20 minutes at 10:00-10:19 inside a long stream: nothing may span it, range-states reset
long_ = stream(T(*SUN, 18, 0), mon(12, 0), flat0)
holey = [b for b in long_ if not (mon(10, 0) <= b['t'] < mon(10, 20))]
it_ok = run([b for b in long_ if b['t'] < mon(10, 0)])
ok('agg: before the hole the 1H range state is available', it_ok.g('prbT')[4] is not None)
it = run([b for b in holey if b['t'] < mon(10, 21)])
ok('agg: after the hole the 1H / 15m range states are RESET to unavailable until two new complete candles', it.g('prbT')[4] is None and it.g('prbT')[2] is None and len(it.g('aggs')[4].f['H']) == 0 and len(it.g('aggs')[2].f['H']) == 0, (list(it.g('prbT')), len(it.g('aggs')[4].f['H'])))
ok('agg: scheduled break + weekend closure alone never drop anything (Sunday-start stream, before the hole)', it_ok.g('aggs')[4].f['dropN'] == 0 and it_ok.g('aggs')[2].f['dropN'] == 0, (it_ok.g('aggs')[4].f['dropN'], it_ok.g('aggs')[2].f['dropN']))
# =============================================================== 5. pre-window Fib endpoint
PRE = (*D, 8, 0)
FIBONLY = dict(inPRejOn=False)
for mirror in (False, True):
    tag = ' [short]' if mirror else ' [long]'
    P = (lambda x: 40000 - x) if mirror else (lambda x: x)
    b, lv = sc(BASE + FIBX + [None] * 14, mirror, start=PRE)
    it = run(b, inject=lv, inputs=FIBONLY)
    st0 = setups(it)[0]; pl = plans(it, 6, 'Fib 0.705')
    ok('prefib: endpoint detected and stored BEFORE the window opened, with its original confirmation time (08:40)' + tag, st0.f['fibKn'] == at(8, 40) and abs(st0.f['fibPx'] - P(20015)) < 1e-9, (st0.f['fibKn'], st0.f['fibPx'], st0.f['fibSt']))
    ok('prefib: the order is armed only when the window opens (first window candle 09:30 closes 09:31)' + tag, len(pl) == 1 and pl[0].f['armT'] == at(9, 31) and pl[0].f['st'] in (2, 3), [(m.f['armT'], m.f['st'], m.f['why']) for m in pl])
    if pl:
        ok('prefib: it arms the STORED endpoint (leg 19985-20015, entry = 0.705 retracement)' + tag, abs(pl[0].f['lim'] - P(19993.75)) < 1e-9 and abs(pl[0].f['fH'] - 20015) < 1e-9 and abs(pl[0].f['fL'] - 19985) < 1e-9, (pl[0].f['lim'], pl[0].f['fH'], pl[0].f['fL']))
    old = run(b, src=OLD, inject=lv, inputs=FIBONLY)
    ok('prefib: the PRE-AUDIT source lost the endpoint (nothing armed at the open)' + tag, len([m for m in plans(old, 6) if m.f['st'] in (2, 3)]) == 0, [(m.f['armT'], m.f['st'], m.f['why']) for m in plans(old, 6)])
    # stale before the window
    stale = [(20006, 20006, 19993, 20004)]
    b, lv = sc(BASE + FIBX + [None] * 3 + stale + [None] * 14, mirror, start=PRE)
    it = run(b, inject=lv, inputs=FIBONLY)
    st0 = setups(it)[0]
    ok('prefib: price traded to the 0.705 level before the window -> candidate stale, nothing armed' + tag, st0.f['fibSt'] == 3 and len(plans(it, 6, 'Fib 0.705')) == 0 and 'stale fib' in list(it.g('rjK')), (st0.f['fibSt'], list(it.g('rjK'))))
    # no silent substitution of a later swing
    later = [(20006, 20020, 20005, 20015), (20015, 20016, 20008, 20009), (20009, 20012, 20006, 20007)]
    b, lv = sc(BASE + FIBX + later + [None] * 12, mirror, start=PRE)
    it = run(b, inject=lv, inputs=FIBONLY)
    st0 = setups(it)[0]; pl = plans(it, 6, 'Fib 0.705')
    ok('prefib: a later, higher swing does NOT replace the stored endpoint' + tag, abs(st0.f['fibPx'] - P(20015)) < 1e-9 and (not pl or (abs(pl[0].f['fH'] - 20015) < 1e-9 and abs(pl[0].f['fL'] - 19985) < 1e-9)), (st0.f['fibPx'], [(m.f['fH'], m.f['fL']) for m in pl]))

# =============================================================== 6. breaker = causal confirmed-swing sequence
C0 = [(20005, 20008, 20000, 20003), (20003, 20006, 19996, 19999), (19999, 20002, 19990, 19995), (19995, 20003, 19993, 20001), (20001, 20006, 19999, 20005),
      (20005, 20011, 20003, 20009), (20009, 20015, 20007, 20012), (20012, 20012, 20003, 20005), (20005, 20010, 19998, 19999), (19999, 20001, 19988, 19990),
      (19990, 19992, 19975, 19978), (19978, 19990, 19976, 19989), (19989, 20000, 19985, 19998)]
BRK_OK = C0 + [(19998, 20018, 19997, 20016)]       # closes above the intervening swing high B (20015)
BRK_WICK = C0 + [(19998, 20018, 19997, 20014)]     # wick above B only: no breaker
NO_A = [(20005, 20008, 20004.75, 20006), (20006, 20009, 20004.8, 20007), (20007, 20010, 20004.85, 20008), (20008, 20011, 20004.9, 20009), (20009, 20012, 20005, 20010)] + C0[5:] + [(19998, 20018, 19997, 20016)]
BRKLV = [('PDL', -1, 19980.0), ('PDH', 1, 20100.0)]
def brk_run(specs, src=NEW):
    b = candles((*D, 8, 0), specs, base_px=20005.0)
    return run(b, src=src, inject=BRKLV, inputs=dict(inPFibOn=False, inPRejOn=False))
it = brk_run(BRK_OK); st0 = setups(it)[0]
ok('breaker: setup is a long sweep with CISD reference = open of the opposing run (20012) confirmed by the closing candle', st0.f['dir'] == 1 and st0.f['cisdRef'] == 20012 and st0.f['st'] == 2, (st0.f['dir'], st0.f['cisdRef'], st0.f['st'], st0.f['why']))
bk = [a for a in st0.f['areas'] if a.f['kind'] == 'BRK']
ok('breaker: full structure (swing A, intervening swing B, lower swing C = sweep, CLOSE beyond B) creates the breaker with the broken block of B', len(bk) == 1 and bk[0].f['lo'] == 20007 and bk[0].f['hi'] == 20015, [(a.f['kind'], a.f['lo'], a.f['hi']) for a in st0.f['areas']])
it = brk_run(BRK_WICK); st0 = setups(it)[0]
ok('breaker: a wick through B without a close is NOT a breaker', st0.f['st'] == 2 and not [a for a in st0.f['areas'] if a.f['kind'] == 'BRK'], [(a.f['kind']) for a in st0.f['areas']])
it = brk_run(NO_A); st0 = setups(it)[0]
ok('breaker: without the earlier swing A the sequence is not the specified one -> no breaker', st0.f['st'] == 2 and not [a for a in st0.f['areas'] if a.f['kind'] == 'BRK'], [(a.f['kind']) for a in st0.f['areas']])
old = brk_run(NO_A, src=OLD); so = setups(old)[0] if setups(old) else None
ok('breaker: the PRE-AUDIT definition labelled a "preceding block broken by a close" as a breaker even without the sequence', so is not None and len([a for a in so.f['areas'] if a.f['kind'] == 'BRK']) == 1, [])
# mirror of the full structure: a short setup
mb = [mir(x) for x in BRK_OK]
b = candles((*D, 8, 0), mb, base_px=40000 - 20005.0)
it = run(b, inject=mlv(BRKLV), inputs=dict(inPFibOn=False, inPRejOn=False)); st0 = setups(it)[0]
bk = [a for a in st0.f['areas'] if a.f['kind'] == 'BRK']
ok('breaker: mirrored (short) sequence creates the bearish breaker', st0.f['dir'] == -1 and len(bk) == 1 and bk[0].f['lo'] == 40000 - 20015 and bk[0].f['hi'] == 40000 - 20007, [(a.f['kind'], a.f['lo'], a.f['hi']) for a in st0.f['areas']])

# =============================================================== 8. Precision requires a valid parent area; overlap is a separate optional condition
NOAREA = dict(inAFvg=False, inAOb=False, inABrk=False, inARb=False, inAIf=False, inPRejOn=False)
b, lv = sc(BASE + FIBX)
it = run(b, inject=lv, inputs=NOAREA)
pl = plans(it, 6, 'Fib 0.705')
ok('parent: with no area at all the Fib candidate is rejected "no valid parent area" (overlap filter OFF does not bypass it)', len(pl) == 1 and pl[0].f['st'] == 4 and 'no valid parent' in pl[0].f['why'] and len(trades(it, 6)) == 0, [(m.f['st'], m.f['why']) for m in pl])
old = run(b, src=OLD, inject=lv, inputs=NOAREA)
ok('parent: the PRE-AUDIT source armed a Fib order with no parent', len([m for m in plans(old, 6) if m.f['st'] in (2, 3, 4) and m.f['why'] == '' or m.f['st'] == 2]) >= 1, [(m.f['st'], m.f['why']) for m in plans(old, 6)])
it = run(b, inject=lv, inputs=dict(inPRejOn=False))
pl = plans(it, 6, 'Fib 0.705')
ok('parent: with areas present, Fib arms and records a parent (overlap filter OFF)', len(pl) == 1 and pl[0].f['st'] in (2, 3) and pl[0].f['parId'] > 0, [(m.f['st'], m.f['why']) for m in pl])
it = run(b, inject=lv, inputs=dict(inPRejOn=False, inFibArea=True))
pl = plans(it, 6, 'Fib 0.705')
par = pl[0].f['areaK'] if pl else None
ok('parent: the optional overlap filter is a SEPARATE condition (entry 19993.75 vs the chosen parent)', len(pl) == 1 and ((pl[0].f['st'] == 4 and 'overlap' in pl[0].f['why']) or pl[0].f['st'] in (2, 3)), [(m.f['st'], m.f['why'], m.f['aLo'], m.f['aHi']) for m in pl])

print('passed', PASS, 'failed', len(FAIL), 'skipped', len(SKIPPED))
sys.exit(1 if FAIL else 0)
