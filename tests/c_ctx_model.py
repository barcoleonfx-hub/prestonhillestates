# Python MODEL of the contextual ("Powell guide") engine of indicator C. It mirrors the Pine decision logic so the rules can be tested offline.
# It is NOT the Pine script and does not prove the script compiles or behaves identically in TradingView.
import math
from c_model import ny, rt, TICK, PV, MS, Trade, Mdl

SLOT_STD, SLOT_PREC = 5, 6
CX = dict(
    winS=570, cutM=660, exitM=660, tfMin=5, rejTf=5, swTk=1, swAge=12, csAge=10, eqTol=2,
    lvPD=True, lvPS=True, lvCS=True, lvOR=True, lvEQ=True, lvAS=False, lvLD=False, lvPO=False,
    orS=570, orE=600, asS=1140, asE=0, ldS=120, ldE=300, poS=0, poE=360,
    aFvg=True, aOb=True, aBrk=True, aRb=True, aIf=True, rbWick=0.5, rbBody=0.4, ifLook=12,
    poi='None', buf=2, cap=200, minR=3.0, tgtMode='liq', fixR=3.0,
    precOn=True, fibOn=True, rejOn=True, fibEntry=0.705, fibStop=0.79, pv=2, fibInArea=False,
    pCap=80, pBuf=2, pMinR=3.0, rejWick=0.40, rejSweep=False,
    biasD=False, bias4=False, bias1=False, bias30=False, bias15=False,
    po3=False, conf=False, ifReq=False, chop=False, chopN=12, chopMin=0.25, ceProx=False, ceDist=2.0, smt=False,
    seq='one', exp=60, setupAgeMin=480, strict=False, qty=1, sizeMode='Fixed contracts', cash=500.0, comm=0.0, slip=0, ambMode='loss', slotStd=True, slotPrec=True,
)

class Cndl:
    def __init__(s, o, h, l, c, t0, tc): s.o = o; s.h = h; s.l = l; s.c = c; s.t0 = t0; s.tc = tc

class Agg:
    def __init__(s, n): s.n = n; s.id = None; s.cur = None; s.hist = []; s.new = False
    def step(s, bi_o, h, l, c, t0, tc, m, tdk):
        n = s.n
        msince = (m - 1080 + 1440) % 1440
        bid = tdk * 10000 + (0 if n >= 1440 else msince // n)
        late = False
        if s.cur is not None and bid != s.id:
            s.hist.append(s.cur); late = True; s.cur = None
        if s.cur is None: s.cur = Cndl(bi_o, h, l, c, t0, tc); s.id = bid
        else: s.cur.h = max(s.cur.h, h); s.cur.l = min(s.cur.l, l); s.cur.c = c; s.cur.tc = tc
        done = False
        if n < 1440 and (msince + 1) % n == 0:
            s.hist.append(s.cur); s.cur = None; done = True
        while len(s.hist) > 60: s.hist.pop(0)
        s.new = late or done
        return s.new

class Lvl:
    def __init__(s, id, ty, side, px, origin, known): s.id = id; s.ty = ty; s.side = side; s.px = px; s.origin = origin; s.known = known; s.st = 0; s.swT = None; s.swOpen = None; s.proc = False; s.touchT = None

class Area:
    def __init__(s, kind, lo, hi, known, src): s.kind = kind; s.lo = lo; s.hi = hi; s.ce = (lo + hi) / 2.0; s.known = known; s.src = src; s.dead = False; s.stale = False

class Setup:
    def __init__(s, id): s.id = id; s.dir = 0; s.st = 0; s.why = ''; s.areas = []; s.fibDone = False; s.stdSt = 0; s.precSt = 0; s.mdlS = None; s.mdlP = None

PRI = {'PDH': 0, 'PDL': 0, 'PSH': 1, 'PSL': 1, 'PO3H': 2, 'PO3L': 2, 'ASH': 3, 'ASL': 3, 'LDH': 4, 'LDL': 4, 'ORH': 5, 'ORL': 5, 'EQH': 6, 'EQL': 6, 'CSH': 7, 'CSL': 7}

class Ctx:
    def __init__(self, **kw):
        self.p = dict(CX); self.p.update(kw)
        self.aggs = {n: Agg(n) for n in (1, 5, 15, 30, 60, 240, 1440)}
        self.levels = []; self.lid = 0; self.setups = []; self.sid = 0; self.cur = None
        self.trades = []; self.plans = []; self.log = []; self.rj = {}
        self.fvgs = []; self.poiF = {15: [], 60: []}; self.piv = []; self.bias = {}; self.prevTd = None; self.pivH = None; self.pivL = None
        self.rng = {}; self.sess = dict(h=None, l=None, n=0)
        self.cs = dict(hi=None, hiT=None, hiReg=False, lo=None, loT=None, loReg=False)
        self.opens = {}; self.fn = {}; self.dayTrades = {}; self.sCandles = 0; self.msgs = []
        self.pCloseT = None; self.pSessAcc = None; self.lastTdKey = None; self.pm = None

    # ------------------------------------------------------------------ helpers
    def rej(s, reason):
        s.rj[reason] = s.rj.get(reason, 0) + 1; s.lastWhy = reason; s.log.append(('reject', s.time, reason))
    def fnc(s, key): s.fn[key] = s.fn.get(key, 0) + 1
    def srcAgg(s): return s.aggs[s.p['tfMin']]
    def newLevel(s, ty, side, px, origin, known):
        # a level of the same type that is still unswept is superseded by the newer one
        for l in s.levels:
            if l.ty == ty and l.st < 2 and ty in ('PDH', 'PDL', 'PSH', 'PSL', 'ORH', 'ORL', 'ASH', 'ASL', 'LDH', 'LDL', 'PO3H', 'PO3L'): l.st = 3
        s.lid += 1; l = Lvl(s.lid, ty, side, px, origin, known); s.levels.append(l)
        s.levels = [x for x in s.levels if not (x.st == 3) and s.time - x.known < 4 * 86400000]
        if len(s.levels) > 60: s.levels.pop(0)
        return l

    # ------------------------------------------------------------------ levels
    def levelStatus(s):
        sw = s.p['swTk'] * TICK
        for l in s.levels:
            if l.side == 0:
                if l.st == 0 and s.low <= l.px <= s.high and s.time >= l.known: l.st = 1; l.touchT = s.tclose
                continue
            if l.st >= 2 or s.time < l.known: continue
            if l.side > 0:
                if s.high >= l.px + sw: l.st = 2; l.swT = s.tclose; l.swOpen = s.time
                elif s.high >= l.px: l.st = 1
            else:
                if s.low <= l.px - sw: l.st = 2; l.swT = s.tclose; l.swOpen = s.time
                elif s.low <= l.px: l.st = 1

    def inWin(s, m, a, b): return (a <= m < b) if a < b else (m >= a or m < b)

    def rangeStep(s, name, a, b, ty_h, ty_l, enable, minFrac=0.8):
        if not enable: return
        m = s.m; r = s.rng.get(name)
        if r is None: r = s.rng[name] = dict(active=False, h=None, l=None, n=0, origin=None)
        e = b % 1440; inW = s.inWin(m, a, e if e != 0 else 1440) if a != e else False
        if inW and not r['active']: r.update(active=True, h=None, l=None, n=0, origin=s.time)
        if inW:
            r['h'] = s.high if r['h'] is None else max(r['h'], s.high); r['l'] = s.low if r['l'] is None else min(r['l'], s.low); r['n'] += 1
        fin = False; known = None
        if inW and (m + 1) % 1440 == e: fin = True; known = s.tclose
        elif r['active'] and not inW: fin = True; known = s.pCloseT
        if fin and r['active']:
            dur = (b - a) % 1440 or 1440
            if r['n'] >= minFrac * dur and r['h'] is not None:
                s.newLevel(ty_h, 1, r['h'], r['origin'], known); s.newLevel(ty_l, -1, r['l'], r['origin'], known)
            r['active'] = False

    def levelsBar(s):
        p = s.p; m = s.m
        # RTH accumulator -> previous completed regular session H/L (needs all 390 one-minute candles)
        if m == 570: s.sess = dict(h=None, l=None, n=0)
        if 570 <= m < 960:
            S = s.sess
            S['h'] = s.high if S['h'] is None else max(S['h'], s.high); S['l'] = s.low if S['l'] is None else min(S['l'], s.low); S['n'] += 1
            if m == 959 and p['lvPS'] and S['n'] >= 390:
                s.newLevel('PSH', 1, S['h'], s.time, s.tclose); s.newLevel('PSL', -1, S['l'], s.time, s.tclose)
        # current-session extremes that stood for csAge minutes
        if m == 570: s.cs = dict(hi=None, hiT=None, hiReg=False, lo=None, loT=None, loReg=False)
        if p['lvCS'] and 570 <= m < 960:
            c = s.cs
            if c['hi'] is None or s.high > c['hi']: c['hi'] = s.high; c['hiT'] = s.tclose; c['hiReg'] = False
            if c['lo'] is None or s.low < c['lo']: c['lo'] = s.low; c['loT'] = s.tclose; c['loReg'] = False
            if not c['hiReg'] and s.tclose - c['hiT'] >= p['csAge'] * MS: s.newLevelNS('CSH', 1, c['hi'], c['hiT'], s.tclose); c['hiReg'] = True
            if not c['loReg'] and s.tclose - c['loT'] >= p['csAge'] * MS: s.newLevelNS('CSL', -1, c['lo'], c['loT'], s.tclose); c['loReg'] = True
        # opening range
        if p['lvOR']:
            r = s.rng.setdefault('or', dict(h=None, l=None, n=0, done=False))
            if p['orS'] <= m < p['orE']:
                r['h'] = s.high if r['h'] is None else max(r['h'], s.high); r['l'] = s.low if r['l'] is None else min(r['l'], s.low); r['n'] += 1
                if m == p['orE'] - 1 and r['n'] >= p['orE'] - p['orS']:
                    s.newLevel('ORH', 1, r['h'], s.time, s.tclose); s.newLevel('ORL', -1, r['l'], s.time, s.tclose)
        if m == 570 - 1 or m == p['orS'] - 1: s.rng['or'] = dict(h=None, l=None, n=0, done=False)
        s.rangeStep('as', p['asS'], p['asE'], 'ASH', 'ASL', p['lvAS'])
        s.rangeStep('ld', p['ldS'], p['ldE'], 'LDH', 'LDL', p['lvLD'])
        s.rangeStep('po', p['poS'], p['poE'], 'PO3H', 'PO3L', p['lvPO'])
        # key opens (reference only)
        if m in (1080, 0, 600) and True:
            nm = {1080: 'O1800', 0: 'O0000', 600: 'O1000'}[m]
            s.lid += 1; l = Lvl(s.lid, nm, 0, s.open, s.time, s.tclose); s.levels.append(l); s.opens[nm] = l
    def newLevelNS(s, ty, side, px, origin, known):
        for l in s.levels:
            if l.ty == ty and l.px == px: return l
        s.lid += 1; l = Lvl(s.lid, ty, side, px, origin, known); s.levels.append(l)
        if len(s.levels) > 60: s.levels.pop(0)
        return l

    # ------------------------------------------------------------------ HTF bias + POI
    def biasStep(s, n):
        a = s.aggs[n]
        if a.new and len(a.hist) >= 2:
            c = a.hist[-1]; pv = a.hist[-2]
            st = s.bias.get(n, (0, None))[0]
            if c.c > pv.h: st = 1
            elif c.c < pv.l: st = -1
            s.bias[n] = (st, s.tclose)
        if a.new and n in (15, 60) and len(a.hist) >= 3:
            c1, c3 = a.hist[-3], a.hist[-1]
            if c3.l > c1.h: s.poiF[n].append(dict(dir=1, lo=c1.h, hi=c3.l, known=s.tclose, dead=False))
            if c3.h < c1.l: s.poiF[n].append(dict(dir=-1, lo=c3.h, hi=c1.l, known=s.tclose, dead=False))
            s.poiF[n] = s.poiF[n][-10:]
        if a.new and n in (15, 60) and a.hist:
            c = a.hist[-1]
            for f in s.poiF[n]:
                if not f['dead'] and ((c.c < f['lo']) if f['dir'] > 0 else (c.c > f['hi'])) and c.t0 > f['known'] - 1: f['dead'] = True

    # ------------------------------------------------------------------ source-TF candle events
    def pivotsAndFvg(s, A):
        h = A.hist; n = len(h); P = s.p['pv']
        # FVG store
        if n >= 3:
            c1, c3 = h[-3], h[-1]
            if c3.l > c1.h: s.fvgs.append(dict(dir=1, lo=c1.h, hi=c3.l, c1open=c1.t0, known=s.tclose, inv=False, invOpen=None, dead=False, sid=None))
            if c3.h < c1.l: s.fvgs.append(dict(dir=-1, lo=c3.h, hi=c1.l, c1open=c1.t0, known=s.tclose, inv=False, invOpen=None, dead=False, sid=None))
        c = h[-1]
        for f in s.fvgs:
            if f['dead']: continue
            if not f['inv']:
                if f['dir'] > 0 and c.c < f['lo']: f['inv'] = True; f['invOpen'] = c.t0; f['invKnown'] = s.tclose
                elif f['dir'] < 0 and c.c > f['hi']: f['inv'] = True; f['invOpen'] = c.t0; f['invKnown'] = s.tclose
            else:
                if f['dir'] > 0 and c.c > f['hi'] and c.t0 > f['invOpen']: f['dead'] = True
                if f['dir'] < 0 and c.c < f['lo'] and c.t0 > f['invOpen']: f['dead'] = True
        s.fvgs = s.fvgs[-40:]
        # pivots (strength P / P): candle h[n-1-P]
        if n >= 2 * P + 1:
            i = n - 1 - P; ph = h[i].h; pl = h[i].l
            okH = all(h[i - j].h < ph and h[i + j].h < ph for j in range(1, P + 1))
            okL = all(h[i - j].l > pl and h[i + j].l > pl for j in range(1, P + 1))
            if okH: s.pivH = dict(px=ph, open=h[i].t0, known=s.tclose, idx=i - n)
            if okL: s.pivL = dict(px=pl, open=h[i].t0, known=s.tclose, idx=i - n)
            s.lastPiv = (okH, okL)
            if s.p['lvEQ']:
                tol = s.p['eqTol'] * TICK
                for ok, px, side, ty in ((okH, ph, 1, 'EQH'), (okL, pl, -1, 'EQL')):
                    if ok:
                        for q in s.piv:
                            if q['side'] == side and not q['dead'] and abs(q['px'] - px) <= tol:
                                s.newLevelNS(ty, side, max(px, q['px']) if side > 0 else min(px, q['px']), h[i].t0, s.tclose); q['dead'] = True; break
                        s.piv.append(dict(side=side, px=px, dead=False))
                s.piv = s.piv[-12:]
            for q in s.piv:
                if not q['dead'] and ((c.h > q['px'] + s.p['eqTol'] * TICK) if q['side'] > 0 else (c.l < q['px'] - s.p['eqTol'] * TICK)): q['dead'] = True

    def cisdRef(s, A, dirn):
        # most recent contiguous opposite-colour run leading into the sweep candle (the newest completed candle); dojis are boundaries
        h = A.hist; j = len(h) - 1
        def opp(c): return (c.c < c.o) if dirn > 0 else (c.c > c.o)
        if not opp(h[j]): j -= 1
        if j < 0 or not opp(h[j]): return None, None
        while j - 1 >= 0 and opp(h[j - 1]): j -= 1
        return h[j].o, h[j].t0

    def onSourceCandle(s):
        A = s.srcAgg(); h = A.hist; c = h[-1]; p = s.p
        s.pivotsAndFvg(A)
        s.sCandles += 1
        st = s.cx
        # sweeps recognised on this candle: levels first exceeded by 1m bars while it was forming (levels must have existed BEFORE the exceeding bar)
        newSw = [l for l in s.levels if l.side != 0 and l.st == 2 and not l.proc]
        for l in newSw: l.proc = True
        enabled = [l for l in newSw if l.swOpen >= c.t0 and l.known <= l.swOpen]
        if enabled:
            best = None
            for l in enabled:
                key = (PRI.get(l.ty, 9), -l.px if l.side > 0 else l.px)
                if best is None or key < best[0]: best = (key, l)
            l = best[1]; dirn = -l.side
            busy = st is not None and st.st == 2 and ((st.mdlS is not None and st.mdlS.st in (2, 3)) or (st.mdlP is not None and st.mdlP.st in (2, 3)))
            act = st is not None and st.st in (1, 2)
            # an active setup is replaced only by a sweep of a strictly higher-priority level while it still waits for its CISD; the displacement
            # that confirms a CISD naturally takes minor highs/lows, so those never replace it
            if act and not (st.st == 1 and PRI.get(l.ty, 9) < PRI.get(st.lvl.ty, 9)):
                s.fnc('sweeps_ignored')
            else:
                ref, refOpen = s.cisdRef(A, dirn)
                s.fnc('sweeps')
                s.sid += 1; ns = Setup(s.sid); ns.dir = dirn; ns.lvl = l; ns.swOpen = c.t0; ns.swT = s.tclose; ns.ext = c.l if dirn > 0 else c.h; ns.cnt = 0; ns.age = 0
                ns.firstExc = min(x.swOpen for x in enabled if x.side == l.side); ns.dayKey = s.dkey; ns.rbs = []; ns.fvgUsed = set(); ns.smt = None
                if act: st.st = 8; st.why = 'superseded by a sweep of a higher-priority level'
                if ref is None:
                    ns.st = 8; ns.why = 'no opposing candle run before the sweep (CISD reference unavailable)'; s.rej(ns.why)
                else:
                    ns.st = 1; ns.cisdRef = ref; ns.refOpen = refOpen; s.rbCandidate(ns, c)
                s.setups.append(ns); s.cx = ns; st = ns
        # CISD tracking: only candles AFTER the sweep candle can confirm
        if st is not None and st.st == 1 and st.swOpen != c.t0:
            st.cnt += 1
            st.ext = min(st.ext, c.l) if st.dir > 0 else max(st.ext, c.h)
            s.rbCandidate(st, c)
            if (c.c > st.cisdRef) if st.dir > 0 else (c.c < st.cisdRef):
                s.cisdConfirm(st, A)
            elif st.cnt >= p['swAge']:
                st.st = 8; st.why = 'reversal (CISD) not confirmed within %d candles' % p['swAge']; s.rej(st.why)
        elif st is not None and st.st == 2:
            busy = (st.mdlS is not None and st.mdlS.st in (2, 3)) or (st.mdlP is not None and st.mdlP.st in (2, 3))
            if s.tclose - st.cisdT > p['setupAgeMin'] * MS and not busy:
                st.st = 8; st.why = 'setup expired: no order within %d minutes of the CISD' % p['setupAgeMin']; s.rej(st.why)
            else:
                s.rbCandidate(st, c); s.collectAreas(st)

    def rbCandidate(s, st, c):
        p = s.p
        if not p['aRb']: return
        rng = c.h - c.l
        if rng <= 0: return
        body = abs(c.c - c.o)
        if st.dir > 0:
            wick = min(c.o, c.c) - c.l; lo, hi = c.l, min(c.o, c.c)
        else:
            wick = c.h - max(c.o, c.c); lo, hi = max(c.o, c.c), c.h
        if c.t0 >= st.swOpen and wick / rng >= p['rbWick'] - 1e-9 and body / rng <= p['rbBody'] + 1e-9 and hi > lo:
            st.rbs.append(Area('RB', lo, hi, s.tclose, c.t0))

    def cisdConfirm(s, st, A):
        h = A.hist; p = s.p; st.st = 2; st.cisdT = s.tclose; st.cisdOpen = h[-1].t0; s.fnc('cisd')
        bull = st.dir > 0
        def same(c): return (c.c > c.o) if bull else (c.c < c.o)
        # order block: the last opposite-colour candle before the displacement run that ends at the CISD candle (full high-low), at/after the sweep candle
        j = len(h) - 1
        while j - 1 >= 0 and same(h[j - 1]): j -= 1
        if p['aOb'] and j - 1 >= 0 and h[j - 1].c != h[j - 1].o and not same(h[j - 1]) and h[j - 1].t0 >= st.swOpen:
            o = h[j - 1]; st.areas.append(Area('OB', o.l, o.h, s.tclose, o.t0))
        # breaker: the candle just before the opposing run into the sweep is the block that the displacement must break with a CLOSE (a wick is not enough)
        if p['aBrk']:
            jr = len(h) - 1
            while jr >= 0 and h[jr].t0 != st.refOpen: jr -= 1
            if jr >= 1:
                bo = h[jr - 1]; isBlock = (bo.c > bo.o) if bull else (bo.c < bo.o)
                broke = any(((x.c > bo.h) if bull else (x.c < bo.l)) for x in h if x.t0 >= st.swOpen)
                if isBlock and broke: st.areas.append(Area('BRK', bo.l, bo.h, s.tclose, bo.t0))
        st.areas.extend(st.rbs); st.rbs = []
        s.collectAreas(st)
        if p['smt']: st.smt = s.smtRev(st)
        s.msgs.append(('setup', s.tclose, 'SETUP %d %s' % (st.id, 'LONG' if bull else 'SHORT')))

    def collectAreas(s, st):
        p = s.p
        st.areas.extend(st.rbs); st.rbs = []
        for f in s.fvgs:
            if id(f) in st.fvgUsed or f['dead']: continue
            if p['aFvg'] and f['dir'] == st.dir and not f['inv'] and f['c1open'] >= st.swOpen:
                st.areas.append(Area('FVG', f['lo'], f['hi'], f['known'], f['c1open'])); st.fvgUsed.add(id(f))
            elif p['aIf'] and f['dir'] == -st.dir and f['inv'] and f['invOpen'] >= st.swOpen and f['c1open'] >= st.swOpen - p['ifLook'] * p['tfMin'] * MS:
                st.areas.append(Area('iFVG', f['lo'], f['hi'], f['invKnown'], f['c1open'])); st.fvgUsed.add(id(f))

    # ------------------------------------------------------------------ SMT (reversal role)
    def smtRev(s, st):
        n = len(s.bufT); w = [i for i in range(n) if s.bufT[i] >= st.firstExc]; pr = [i for i in range(n) if s.bufT[i] < st.firstExc][-60:]
        if not w or not pr or s.esL is None: return None
        if st.dir > 0:
            return min(s.esLb[i] for i in w) > min(s.esLb[i] for i in pr) and min(s.nqL[i] for i in w) < min(s.nqL[i] for i in pr)
        return max(s.esHb[i] for i in w) < max(s.esHb[i] for i in pr) and max(s.nqH[i] for i in w) > max(s.nqH[i] for i in pr)

    # ------------------------------------------------------------------ per-1m-bar setup logic
    def areaUpdate(s, st):
        bull = st.dir > 0
        for a in st.areas:
            if a.dead: continue
            if a.known <= s.time and not a.stale:
                if (s.low <= a.ce) if bull else (s.high >= a.ce): a.stale = True
            if (s.close < a.lo) if bull else (s.close > a.hi): a.dead = True

    def overlap(s, a, lo, hi): return a.hi > lo and a.lo < hi

    def poiRange(s, st):
        p = s.p
        if p['poi'] == 'None': return None
        n = 15 if p['poi'] == '15m FVG' else 60
        cand = [f for f in s.poiF[n] if f['dir'] == st.dir and not f['dead'] and f["known"] <= s.tclose]
        if not cand: return None
        f = cand[-1]; return (f['lo'], f['hi'])

    def pickArea(s, st, exec_side):
        bull = st.dir > 0; cands = []
        for a in st.areas:
            if a.dead or a.known > s.tclose: continue
            if exec_side and (a.stale or not ((a.ce < s.close) if bull else (a.ce > s.close))): continue
            cands.append(a)
        if not cands: return None
        poi = s.poiRange(st)
        pool = cands
        if poi is not None:
            ov = [a for a in cands if s.overlap(a, poi[0], poi[1])]
            if ov: pool = ov
        order = {'OB': 0, 'BRK': 1, 'FVG': 2, 'iFVG': 3, 'RB': 4}
        pool.sort(key=lambda a: (abs(a.ce - s.close), -a.known, order[a.kind]))
        return pool[0]

    def target(s, st, entry):
        bull = st.dir > 0; best = None
        for l in s.levels:
            if l.side != (1 if bull else -1) or l.st >= 2 or l.known > s.tclose: continue
            if (l.px > entry + TICK) if bull else (l.px < entry - TICK):
                if best is None or ((l.px < best.px) if bull else (l.px > best.px)): best = l
        return best

    def seqCheck(s, slot):
        done = [t for t in s.trades if t.slot == slot and t.dayKey == s.dkey]
        pend = [m for m in s.plans if m.slot == slot and m.dayKey == s.dkey and m.st in (2, 3)]
        if pend: return None, 'busy'
        if not done: return 1.0, ''
        if s.p['seq'] == 'seq' and len(done) == 1 and not (done[0].netR is not None and done[0].netR > 0): return 0.5, ''
        return None, 'daily sequence complete'

    def filters(s, st, area):
        p = s.p; bull = st.dir > 0
        for n, on, nm in ((1440, p['biasD'], 'Daily'), (240, p['bias4'], '4H'), (60, p['bias1'], '1H'), (30, p['bias30'], '30m'), (15, p['bias15'], '15m')):
            if on:
                b = s.bias.get(n)
                if b is None or b[0] == 0: return 'bias %s unavailable/neutral' % nm
                if (b[0] > 0) != bull: return 'bias %s against the setup' % nm
        if p['po3'] and st.lvl.ty not in ('PO3H', 'PO3L'): return 'PO3 filter: swept level is not the PO3 range'
        if p['conf'] and area is not None:
            ov = [a for a in st.areas if a is not area and not a.dead and a.kind != area.kind and s.overlap(a, area.lo, area.hi)]
            if not ov: return 'no FVG/breaker confluence with the parent area'
        if p['ifReq'] and not any(a.kind == 'iFVG' and not a.dead for a in st.areas): return 'no iFVG confirmation'
        if p['chop']:
            h = s.srcAgg().hist[-p['chopN']:]
            if len(h) >= p['chopN']:
                net = abs(h[-1].c - h[0].o); path = sum(c.h - c.l for c in h)
                if path <= 0 or net / path < p['chopMin']: return 'chop filter: efficiency ratio too low'
        if p['smt'] and not getattr(st, 'smt', None): return 'SMT (reversal) not present'
        return ''

    def planCommon(s, st, md, entryRaw, stopRaw, cap, minR, label):
        p = s.p; bull = st.dir > 0
        entry = rt(entryRaw); stop = rt(stopRaw)
        dist = (entry - stop) if bull else (stop - entry); riskT = int(round(dist / TICK))
        slot = md.slot
        if riskT < 1: return s.dropPlan(md, 'stop is not beyond the entry', 'invalid')
        if riskT > cap: return s.dropPlan(md, 'stop-cap rejection: %d ticks > %d' % (riskT, cap), 'cap')
        mult, why = s.seqMult
        qty = p['qty']
        if p['sizeMode'] == 'Fixed cash risk': qty = int(math.floor(p['cash'] / (riskT * TICK * PV)))
        if mult != 1.0:
            budget = mult * s.firstRiskUsd
            qty = int(math.floor(budget / (riskT * TICK * PV)))
        if qty < 1: return s.dropPlan(md, 'sizing rejection', 'size')
        if p['tgtMode'] == 'fixed':
            R = p['fixR']; tgt = entry + R * dist if bull else entry - R * dist; tl = None; tt = 'fixed-R'
        else:
            tl = s.target(st, entry)
            if tl is None: return s.dropPlan(md, 'no eligible unswept opposing liquidity', 'notgt')
            tgt = tl.px; tt = 'liquidity'
        tgtR = rt(tgt); pR = abs(tgtR - entry) / dist
        if pR < minR - 1e-9: return s.dropPlan(md, 'minimum-R rejection: planned %.2fR < %.1fR' % (pR, minR), 'minr')
        md.lim = entry; md.stp = stop; md.tgt = tgtR; md.qty = qty; md.plannedR = pR; md.tgtType = tt; md.tgtLvl = tl; md.meth = label
        md.st = 2; md.armBar = s.bi; md.armT = s.tclose; md.dir = st.dir; md.dayKey = s.dkey; md.setup = st; md.mult = mult
        s.fnc('armed_%d' % md.slot); s.fnc('armed_' + label)
        s.msgs.append(('armed', s.tclose, '%s %s' % (label, entry)))
        return True

    def dropPlan(s, md, why, key):
        md.st = 4; md.why = why; s.fnc('rej_' + key); s.fnc('rej_%d_%s' % (md.slot, key)); s.rej(why); return False

    def newMdl(s, slot, st):
        m = Mdl(slot); m.dir = st.dir; m.dayKey = s.dkey; m.tgtLvl = None; m.meth = ''; m.setup = st; m.mult = 1.0; s.plans.append(m); return m

    def tryStd(s, st):
        p = s.p
        if not p['slotStd'] or st.stdSt != 0: return
        if not (s.m >= p['winS'] and s.m < p['cutM']): return
        mult, why = s.seqCheck(SLOT_STD)
        if mult is None:
            if why != 'busy': st.stdSt = 2; s.rej('Standard: ' + why)
            return
        s.seqMult = (mult, why)
        if mult != 1.0: s.firstRiskUsd = [t for t in s.trades if t.slot == SLOT_STD and t.dayKey == s.dkey][0].riskUsd
        area = s.pickArea(st, True)
        if area is None: return
        st.stdSt = 2
        f = s.filters(st, area)
        md = s.newMdl(SLOT_STD, st); st.mdlS = md; md.area = area
        if f: s.dropPlan(md, f, 'filter'); return
        if p['ceProx'] and s.ceProx(st, area.ce): s.dropPlan(md, 'CE proximity: engineered liquidity within %.1f pts beyond the CE' % p['ceDist'], 'filter'); return
        stopRaw = (st.ext - p['buf'] * TICK) if st.dir > 0 else (st.ext + p['buf'] * TICK)
        s.planCommon(st, md, area.ce, stopRaw, p['cap'], p['minR'], 'Area CE')
        if md.st == 2: st.stdSt = 1

    def ceProx(s, st, ce):
        d = s.p['ceDist']; bull = st.dir > 0
        for l in s.levels:
            if l.side == (-1 if bull else 1) and l.st < 2 and l.known <= s.tclose:
                if (ce - d <= l.px <= ce) if bull else (ce <= l.px <= ce + d): return True
        return False

    def tryPrecFib(s, st, A):
        p = s.p
        if not (p['slotPrec'] and p['fibOn']) or st.fibDone: return
        if not (s.m >= p['winS'] and s.m < p['cutM']): return
        h = A.hist; bull = st.dir > 0; pv = s.pivH if bull else s.pivL
        if pv is None or pv['known'] != s.tclose or pv['open'] < st.cisdOpen: return
        st.fibDone = True; s.fnc('fib_anchor')
        mult, why = s.seqCheck(SLOT_PREC)
        if mult is None:
            if why != 'busy': s.rej('Precision: ' + why)
            return
        s.seqMult = (mult, why)
        if mult != 1.0: s.firstRiskUsd = [t for t in s.trades if t.slot == SLOT_PREC and t.dayKey == s.dkey][0].riskUsd
        Hx = pv['px'] if bull else st.ext      # long: swing high after the CISD, short: the swept high
        Lx = st.ext if bull else pv['px']      # long: the swept low, short: swing low after the CISD
        md = s.newMdl(SLOT_PREC, st); st.mdlP = md; md.meth = 'Fib 0.705'; md.fibH = Hx; md.fibL = Lx; md.area = s.pickArea(st, False)
        rngv = Hx - Lx
        if rngv <= 0: s.dropPlan(md, 'Fib leg has no size', 'invalid'); return
        e = Hx - p['fibEntry'] * rngv if bull else Lx + p['fibEntry'] * rngv
        ref = Hx - p['fibStop'] * rngv if bull else Lx + p['fibStop'] * rngv
        eR = rt(e)
        after = [c for c in h if c.t0 > pv['open']]
        traversed = bool(after) and ((min(c.l for c in after) <= eR) if bull else (max(c.h for c in after) >= eR))
        if traversed or not ((eR < s.close) if bull else (eR > s.close)):
            s.dropPlan(md, 'stale: 0.705 already traversed before the anchor was known', 'stale'); return
        if p['fibInArea'] and (md.area is None or not (md.area.lo <= eR <= md.area.hi)):
            s.dropPlan(md, 'Fib entry is outside the parent area', 'filter'); return
        f = s.filters(st, md.area)
        if f: s.dropPlan(md, f, 'filter'); return
        if p['ceProx'] and s.ceProx(st, eR): s.dropPlan(md, 'CE proximity', 'filter'); return
        stopRaw = (ref - p['pBuf'] * TICK) if bull else (ref + p['pBuf'] * TICK)
        s.planCommon(st, md, e, stopRaw, p['pCap'], p['pMinR'], 'Fib 0.705')
        if md.st == 2: st.precSt = 1

    def tryPrecRej(s, st, c):
        p = s.p
        if not (p['slotPrec'] and p['rejOn']) or st.precSt == 1: return
        if not (s.m >= p['winS'] and s.m < p['cutM']): return
        bull = st.dir > 0; area = s.pickArea(st, False)
        if area is None: return
        rng = c.h - c.l
        if rng <= 0: return
        inter = c.h >= area.lo and c.l <= area.hi
        if not inter: return
        body_lo = min(c.o, c.c); body_hi = max(c.o, c.c)
        wick = (body_lo - c.l) if bull else (c.h - body_hi)
        okc = (c.c > c.o) if bull else (c.c < c.o)
        intact = (c.l > st.ext) if bull else (c.h < st.ext)
        if not (okc and intact and wick >= p['rejWick'] * rng - 1e-9): return
        if p['rejSweep']:
            prev = s.rejHist[-2] if len(s.rejHist) >= 2 else None
            if prev is None or not ((c.l < prev.l) if bull else (c.h > prev.h)): return
        s.fnc('rej_cand')
        mult, why = s.seqCheck(SLOT_PREC)
        if mult is None:
            if why != 'busy': s.rej('Precision: ' + why)
            return
        s.seqMult = (mult, why)
        if mult != 1.0: s.firstRiskUsd = [t for t in s.trades if t.slot == SLOT_PREC and t.dayKey == s.dkey][0].riskUsd
        md = s.newMdl(SLOT_PREC, st); st.mdlP = md; md.meth = 'Rejection CE'; md.area = area; md.rejC = c
        e = (c.l + body_lo) / 2.0 if bull else (c.h + body_hi) / 2.0
        f = s.filters(st, area)
        if f: s.dropPlan(md, f, 'filter'); return
        if p['ceProx'] and s.ceProx(st, rt(e)): s.dropPlan(md, 'CE proximity', 'filter'); return
        stopRaw = (c.l - p['pBuf'] * TICK) if bull else (c.h + p['pBuf'] * TICK)
        s.planCommon(st, md, e, stopRaw, p['pCap'], p['pMinR'], 'Rejection CE')
        if md.st == 2: st.precSt = 1

    # ------------------------------------------------------------------ fills / positions (copies of the legacy shared logic, per-plan direction)
    def finish(s, md, outcome, exitPx, exitTime, note):
        t = md.tr; p = s.p; sgn = 1.0 if t.dir > 0 else -1.0
        grossUsd = sgn * (exitPx - t.entryPx) * PV * t.qty
        slipUsd = p['slip'] * TICK * PV * t.qty * (1.0 if outcome == 1 else 2.0); commUsd = p['comm'] * t.qty * 2.0
        riskUsd = t.riskPts * PV * t.qty
        t.isOpen = False; t.outcome = outcome; t.exitPx = exitPx; t.exitT = exitTime
        t.costUsd = slipUsd + commUsd; t.netUsd = grossUsd - slipUsd - commUsd
        t.grossR = grossUsd / riskUsd if riskUsd > 0 else None; t.netR = t.netUsd / riskUsd if riskUsd > 0 else None
        t.note = note if t.note == '' else t.note + ' | ' + note
        md.st = 4; md.why = note
        if outcome == 4: s.fnc('amb_%d' % md.slot)
        st = md.setup
        if md.slot == SLOT_STD: st.stdSt = 2
        else:
            st.precSt = 0 if not (outcome == 1) else 2   # a precision stop ends the ATTEMPT, not the setup
            if outcome == 1: st.precSt = 2
        s.msgs.append(('exit', exitTime, '%s %d' % (md.meth, outcome)))

    def fillTry(s, md):
        p = s.p; bull = md.dir > 0; lim = md.lim; thrP = TICK if p['strict'] else 0.0
        o, h, l = s.open, s.high, s.low
        touch = (l <= lim - thrP) if bull else (h >= lim + thrP)
        if not touch: return
        known = (o <= lim - thrP) if bull else (o >= lim + thrP)
        stp = md.stp; tgt = md.tgt
        t = Trade(slot=md.slot, dir=md.dir, dayKey=md.dayKey, lvl=md.setup.lvl.px, entryPx=lim, stopPx=stp, tgtPx=tgt, riskPts=abs(lim - stp), armT=md.armT,
                  fillT=s.time, qty=md.qty, plannedR=md.plannedR, tgtType=md.tgtType, riskUsd=abs(lim - stp) * PV * md.qty, note=md.meth, meth=md.meth, setupId=md.setup.id)
        md.tr = t; md.st = 3; s.trades.append(t); s.fnc('fill_%d' % md.slot); s.fnc('fill_' + md.meth)
        s.msgs.append(('fill', s.time, md.meth))
        stopHit = (l <= stp) if bull else (h >= stp); tgtTouch = (h >= tgt) if bull else (l <= tgt)
        adv = (lim - l) if bull else (h - lim); fav = (h - lim) if bull else (lim - l)
        t.maeP = max(0.0, adv)
        if known: t.mfeP = max(0.0, fav)
        else: t.mfeP = 0.0; t.excUnc = fav > 0; t.entryAmb = tgtTouch or fav > 0
        if stopHit and tgtTouch:
            t.maeP = max(t.maeP, t.riskPts); t.excUnc = True; s.finish(md, 4, stp, s.time, 'ambiguous: stop and target both reachable on the fill candle')
        elif stopHit:
            t.maeP = max(t.maeP, t.riskPts); s.finish(md, 2, stp, s.time, 'stop hit on the fill candle')
        elif known and tgtTouch:
            t.mfeP = max(t.mfeP, abs(tgt - lim)); s.finish(md, 1, tgt, s.time, 'target hit on the fill candle (fill at the open)')

    def posStep(s, md):
        t = md.tr; bull = t.dir > 0; stp = md.stp; tgt = md.tgt; ent = t.entryPx
        o, h, l = s.open, s.high, s.low
        gStop = (o <= stp) if bull else (o >= stp); gTgt = (o >= tgt) if bull else (o <= tgt)
        stopHit = (l <= stp) if bull else (h >= stp); tgtHit = (h >= tgt) if bull else (l <= tgt)
        adv = (ent - l) if bull else (h - ent); fav = (h - ent) if bull else (ent - l)
        pMae = t.maeP; pMfe = t.mfeP; tgtD = abs(tgt - ent)
        if gStop: t.maeP = max(pMae, (ent - o) if bull else (o - ent)); s.finish(md, 2, o, s.time, 'gap through the stop: exit at the open')
        elif gTgt: t.mfeP = max(pMfe, tgtD); s.finish(md, 1, tgt, s.time, 'gap through the target: filled at the target (no improvement)')
        elif stopHit and tgtHit:
            t.maeP = max(pMae, t.riskPts); t.mfeP = max(pMfe, fav); t.excUnc = True; s.finish(md, 4, stp, s.time, 'ambiguous: stop and target both reachable on one candle')
        elif stopHit: t.maeP = max(pMae, t.riskPts); t.excUnc = t.excUnc or fav > pMfe; s.finish(md, 2, stp, s.time, 'stop hit')
        elif tgtHit: t.mfeP = max(pMfe, tgtD); t.maeP = max(pMae, adv); t.excUnc = t.excUnc or adv > pMae; s.finish(md, 1, tgt, s.time, 'target hit')
        else: t.maeP = max(pMae, adv); t.mfeP = max(pMfe, fav)

    def planStep(s, md):
        p = s.p; m = s.m; st = md.setup; bull = md.dir > 0
        if md.st == 3:
            if m >= p['exitM']: s.finish(md, 3, s.open, s.time, 'time exit at the hard-exit candle open')
            else: s.posStep(md)
        elif md.st == 2 and s.bi > md.armBar:
            thrP = TICK if p['strict'] else 0.0
            if m >= p['cutM']:
                md.st = 4; md.why = 'unfilled: cancelled at the entry cutoff'; s.fnc('cancel_%d' % md.slot); s.afterCancel(md)
            elif s.bi > md.armBar + p['exp']:
                md.st = 4; md.why = 'expired'; s.fnc('cancel_%d' % md.slot); s.afterCancel(md)
            elif md.slot == SLOT_PREC and ((s.open <= md.stp) if bull else (s.open >= md.stp)):
                md.st = 4; md.why = 'local stop level breached before the fill'; s.fnc('inval_%d' % md.slot); s.afterCancel(md)
            elif (s.open < st.ext) if bull else (s.open > st.ext):
                md.st = 4; md.why = 'invalidated: the candle opened beyond the frozen setup extreme'; s.fnc('inval_%d' % md.slot); s.afterCancel(md, True)
            else:
                touchE = (s.low <= md.lim - thrP) if bull else (s.high >= md.lim + thrP)
                tgtFirst = (not touchE) and ((s.high >= md.tgt) if bull else (s.low <= md.tgt))
                if tgtFirst: md.st = 4; md.why = 'cancelled: the target was reached before the entry'; s.fnc('cancel_%d' % md.slot); s.afterCancel(md)
                else: s.fillTry(md)

    def afterCancel(s, md, setupDead=False):
        st = md.setup
        if md.slot == SLOT_STD: st.stdSt = 2
        else: st.precSt = 0
        if setupDead: st.st = 8; st.why = md.why

    # ------------------------------------------------------------------ main bar
    def onBar(s, b, i, nxt=None):
        p = s.p
        s.bi = i; s.time = b['t']; s.tclose = b['t'] + MS; s.open = b['o']; s.high = b['h']; s.low = b['l']; s.close = b['c']
        s.m, s.dkey, s.dow = ny(b['t'])
        import datetime as _dt
        from c_model import NY
        d2 = _dt.datetime.fromtimestamp((b['t'] + 6 * 3600000) / 1000.0, NY); s.tdk = d2.year * 10000 + d2.month * 100 + d2.day
        s.esL = b.get('esl'); s.esH = b.get('esh')
        if not hasattr(s, 'bufT'): s.bufT = []; s.esLb = []; s.esHb = []; s.nqL = []; s.nqH = []; s.rejHist = []
        s.bufT.append(s.time); s.esLb.append(s.esL); s.esHb.append(s.esH); s.nqL.append(s.low); s.nqH.append(s.high)
        if len(s.bufT) > 240:
            for q in (s.bufT, s.esLb, s.esHb, s.nqL, s.nqH): q.pop(0)
        if not hasattr(s, 'cx'): s.cx = None
        if not hasattr(s, 'lastWhy'): s.lastWhy = ''
        # 1) level statuses use only EXISTING levels (a level created at this bar's close is tested from the next bar)
        s.levelStatus()
        if s.cx is not None:
            if s.cx.st == 2: s.areaUpdate(s.cx)
        # 2) open plans first (they use candles after their arming candle)
        for md in list(s.plans):
            if md.st in (2, 3): s.planStep(md)
        # setup structure invalidation (no order yet): any bar beyond the frozen extreme
        st = s.cx
        if st is not None and st.st == 2 and ((s.low < st.ext) if st.dir > 0 else (s.high > st.ext)):
            busy = (st.mdlS is not None and st.mdlS.st in (2, 3)) or (st.mdlP is not None and st.mdlP.st in (2, 3))
            if not busy: st.st = 8; st.why = 'setup invalidated: price exceeded the frozen sweep extreme'; s.rej(st.why)
        # 3) aggregators
        for n, a in s.aggs.items(): a.step(s.open, s.high, s.low, s.close, s.time, s.tclose, s.m, s.tdk)
        # prior-trading-day levels
        if s.aggs[1440].new and p['lvPD']:
            c = s.aggs[1440].hist[-1]; s.newLevel('PDH', 1, c.h, c.t0, s.tclose); s.newLevel('PDL', -1, c.l, c.t0, s.tclose)
        for n in (15, 30, 60, 240, 1440): s.biasStep(n)
        # 4) level creation (known at THIS bar's close)
        s.levelsBar()
        # 5) source candle + local rejection candle events
        A = s.srcAgg(); R = s.aggs[p['rejTf']]
        if R.new: s.rejHist.append(R.hist[-1]); s.rejHist = s.rejHist[-4:]
        if A.new:
            s.onSourceCandle()
            st = s.cx
            if st is not None and st.st == 2: s.tryPrecFib(st, A)
        st = s.cx
        if R.new and st is not None and st.st == 2: s.tryPrecRej(st, R.hist[-1])
        # 6) Standard arming (every 1m bar)
        if st is not None and st.st == 2: s.tryStd(st)
        s.pCloseT = s.tclose; s.pm = s.m

    def run(s, bars):
        for i, b in enumerate(bars): s.onBar(b, i)
        return s
