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

def run(bars, src=NEW, inputs=None, inject=(), draw=False, inject_at=None):
    if src is OLD: return FakeIt()   # the pre-audit source takes >30 min to parse with the third-party parser; old behaviour is shown by the Python legacy model + text diff instead
    inputs = dict(inputs or {})
    if src is NEW: inputs.setdefault('inCmpVar', True); inputs.setdefault('inGuide', False)   # legacy tests: guide mode off; simulate Standard AND Precision
    it = Interp(src, inputs)
    for i, b in enumerate(bars):
        it.feed(b, i, last=(draw and i == len(bars) - 1))
        if inject_at and i in inject_at:
            for (ty, side, px, kn) in inject_at[i]:
                cx = it.g('cxN'); cx[0] += 1
                it.g('lvls').append(it.construct('Lvl', [], dict(id=cx[0], ty=ty, side=side, px=px, origin=b['t'], known=(b['t'] if kn is None else kn)), it.G))
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




def seq(start, segs, base=20000.0, pre=60):
    # segs: list of (minutes, (o,h,l,c) | None); minutes in (5, 15); a flat pre-roll precedes
    t = T(*start); out = flat(t - pre * 60000, pre, base)
    for n, sp in segs:
        out += five(t, *sp, n=n) if sp else flat(t, n, out[-1]['c'])
        t += n * 60000
    return out
