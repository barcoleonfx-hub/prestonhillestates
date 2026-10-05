import datetime as dt, sys, os
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import c_model as M
NYZ = ZoneInfo('America/New_York')
def T(y, mo, d, hh, mm): return int(dt.datetime(y, mo, d, hh, mm, tzinfo=NYZ).timestamp() * 1000)
def bar(t, o, h, l, c): return dict(t=t, o=o, h=h, l=l, c=c)
def mkday(y, mo, d, spec=None, start=(9, 0), end=(11, 30), base=20000.0, orLow=None, orHigh=None, skip=(), fill=1.0):
    spec = spec or {}; out = []
    t = T(y, mo, d, *start); stop_t = T(y, mo, d, *end)
    while t <= stop_t:
        dd = dt.datetime.fromtimestamp(t / 1000, NYZ); key = (dd.hour, dd.minute)
        if key not in skip:
            if key in spec: o, h, l, c = spec[key]
            else:
                o = base; h = base + fill; l = base - fill; c = base
                if orHigh is not None and key == (9, 45): h = orHigh
                if orLow is not None and key == (9, 45): l = orLow
            out.append(bar(t, o, h, l, c))
        t += 60000
    return out
def run(bars, **kw): return M.Engine(**kw).run(bars)
def tr_of(e, slot): return [t for t in e.trades if t.slot == slot]
def col(e, slot, c): return e.fnl[slot * M.NF + c]
FIX = dict(thr_mode='Fixed points')
