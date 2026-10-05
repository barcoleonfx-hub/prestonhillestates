import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import datetime as dt
from c_helpers import T, bar, NYZ
import c_model as M
import c_ctx_model as X

def five(t0, o, h, l, c, n=5):
    # expand one n-minute candle into n one-minute bars with a deterministic intrabar path (bullish: o,l,h,c ; bearish: o,h,l,c)
    wp = [o, l, l, h, h, c] if c >= o else [o, h, h, l, l, c]
    if n != 5: wp = [o, l, h, c] if c >= o else [o, h, l, c]
    bars = []
    k = len(wp) - 1
    for i in range(n):
        a = wp[min(i, k - 1)] if n == 5 else wp[min(i, k - 1)]
        b = wp[min(i + 1, k)]
        bars.append(bar(t0 + i * 60000, a, max(a, b), min(a, b), b))
    # make sure the candle's own open/close are exact
    bars[0]['o'] = o; bars[-1]['c'] = c
    return bars

def flat(t0, minutes, px, rng=0.5):
    return [bar(t0 + i * 60000, px, px + rng, px - rng, px) for i in range(minutes)]

def candles(start, specs, base_px=20000.0, pre_min=60):
    # start=(y,mo,d,hh,mm); specs = list of 5m candles (o,h,l,c); a flat pre-roll of pre_min minutes precedes it
    t = T(*start)
    out = flat(t - pre_min * 60000, pre_min, base_px)
    for sp in specs:
        if sp is None: out += flat(t, 5, specs_last(out)); t += 300000; continue
        out += five(t, *sp); t += 300000
    return out

def specs_last(out): return out[-1]['c']

def engine(bars, levels=(), **kw):
    e = X.Ctx(**kw)
    for (ty, side, px) in levels:
        e.time = 0
        e.lid += 1; l = X.Lvl(e.lid, ty, side, px, 0, 0); e.levels.append(l)
    for i, b in enumerate(bars): e.onBar(b, i)
    return e
