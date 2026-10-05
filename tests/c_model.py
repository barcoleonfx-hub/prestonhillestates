# Python MODEL of "H Ticks - 10AM Precision Model C" (Standard A/B/C/C-wick + Precision). This is a line-by-line port of the Pine decision
# logic used to test behaviour offline. It is NOT the Pine script and does not prove the script compiles or behaves identically in TradingView.
import math, datetime as dt
from zoneinfo import ZoneInfo

NY = ZoneInfo('America/New_York')
TICK = 0.25
PV = 20.0
MS = 60000

def rt(x):
    return math.floor(x / TICK + 0.5) * TICK

def ny(tms):
    d = dt.datetime.fromtimestamp(tms / 1000.0, NY)
    return d.hour * 60 + d.minute, d.year * 10000 + d.month * 100 + d.day, d.isoweekday()  # Mon=1..Sun=7

DEFAULT = dict(orS=570, orE=600, openT=600, manE=610, cutT=645, exitT=660, thr_mode='ATR', fixed=15.0, atrM=0.5, atrLen=14, revN=2,
               ambInit='Skip day', maxOn=False, maxPts=60.0, maxAtr=4.0, sweep=False, sweepTk=1, lvOR=True, lvPD=True,
               model='A', compare=False, cstop='extreme', strict=False, buf=2, maxStop=80, tgt='1R', qty=1, comm=0.0, slip=0,
               ambMode='loss', variant='Standard', cmpVar=False, sizeMode='Fixed contracts', cash=500.0,
               pTrig='Rejection', band=4.0, pFib=False, pIfvg=False, wick=0.40, pvL=1, pvR=1, minR=5.0, pCap=40, pBuf=2, pExp=3,
               pTgt='Opposing liquidity', pFixR=5.0)

class Trade:
    def __init__(s, **k):
        s.isOpen = True; s.outcome = 0; s.grossR = None; s.netR = None; s.netUsd = 0.0; s.costUsd = 0.0; s.maeP = 0.0; s.mfeP = 0.0
        s.excUnc = False; s.entryAmb = False; s.note = ''; s.qty = 1; s.plannedR = None; s.tgtType = ''; s.riskUsd = 0.0
        s.__dict__.update(k)

class Mdl:
    def __init__(s, slot):
        s.slot = slot; s.st = 0; s.why = ''; s.armBar = -1; s.armT = None; s.lim = None; s.stp = None; s.tgt = None
        s.fT = None; s.fB = None; s.fCT = None; s.fInv = False; s.tr = None; s.qty = 1; s.plannedR = None; s.tgtType = ''
        s.trigNm = ''; s.tT = None; s.tHi = None; s.tLo = None; s.tBase = None; s.sLvl = None; s.sT = None

class Day:
    def __init__(s, key, active):
        s.key = key; s.active = active; s.status = 0; s.st = 0; s.why = ''; s.O = None; s.oT = None; s.atrPre = None; s.thr = None
        s.orH = s.orL = None; s.orN = 0; s.pdH = s.pdL = None; s.rthH = s.rthL = None; s.rthN = 0; s.bars10 = 0; s.dir = 0
        s.mExt = None; s.mExtT = None; s.oppX = None; s.qBar = -1; s.qT = None; s.cnt = 0; s.confBar = -1; s.confT = None
        s.mPts = None; s.mAtr = None; s.preSweep = False; s.swpLvl = None; s.swpT = None; s.swpNm = ''
        s.lvlP = [None] * 4; s.lvlT = [None] * 4
        s.fbuT = s.fbuB = s.fbuC = s.fbuMin = None; s.fbeT = s.fbeB = s.fbeC = s.fbeMax = None
        s.fibOk = False; s.fibLo = s.fibHi = None; s.rejOk = False; s.rejT = None; s.rejHi = s.rejLo = s.rejBase = s.rejEntry = None
        s.parLo = s.parHi = s.bdLo = s.bdHi = None; s.pvP = None; s.pvBar = None; s.pvKn = None; s.pvT = None; s.pvDead = False
        s.poHi = s.poLo = None
        s.ms = [Mdl(i) for i in range(5)]

NS = 5; NF = 15

class Engine:
    def __init__(self, **kw):
        self.p = dict(DEFAULT); self.p.update(kw)
        p = self.p
        stdSel = {'A': 0, 'B': 1, 'C': 2}[p['model']]
        if p['model'] == 'C' and p['cstop'] == 'wick': stdSel = 3
        selVar = 1 if p['variant'] == 'Precision' else 0
        self.stdSel = stdSel
        self.selSlot = 4 if selVar else stdSel
        stdOn = selVar == 0 or p['cmpVar']; precOn = selVar == 1 or p['cmpVar']
        self.slotOn = [stdOn and (p['compare'] or stdSel == i) for i in range(4)] + [precOn]
        self.fnl = [0] * (NS * NF); self.cv = [0] * 8; self.trades = []; self.days = []; self.msgs = []
        self.cur = None; self.lastAct = None; self.pClose = None; self.pCloseT = None
        self.bufH = []; self.bufL = []; self.bufI = []; self.bufT = []; self.sHi = None; self.sLo = None; self.pM = None
        self.firstKey = None; self.lastKey = None

    # ---- helpers
    def fn(s, slot, col): s.fnl[slot * NF + col] += 1
    def fnA(s, col):
        for k in range(NS):
            if s.slotOn[k]: s.fn(k, col)
    def msgK(s, kind, slot, txt):
        if slot == s.selSlot: s.msgs.append((kind, s.bi, txt))
    def exceeded(s, dy): return s.low < dy.mExt if dy.dir > 0 else s.high > dy.mExt
    def fibLvl(s, dy, r): return dy.oppX + r * (dy.mExt - dy.oppX) if dy.dir < 0 else dy.oppX - r * (dy.oppX - dy.mExt)

    # ---- trade bookkeeping
    def finish(s, md, outcome, exitPx, exitTime, note):
        t = md.tr; p = s.p
        sgn = 1.0 if t.dir > 0 else -1.0
        grossUsd = sgn * (exitPx - t.entryPx) * PV * t.qty
        slipUsd = p['slip'] * TICK * PV * t.qty * (1.0 if outcome == 1 else 2.0)
        commUsd = p['comm'] * t.qty * 2.0
        riskUsd = t.riskPts * PV * t.qty
        t.isOpen = False; t.outcome = outcome; t.exitPx = exitPx; t.exitT = exitTime
        t.costUsd = slipUsd + commUsd; t.netUsd = grossUsd - slipUsd - commUsd
        t.grossR = grossUsd / riskUsd if riskUsd > 0 else None; t.netR = t.netUsd / riskUsd if riskUsd > 0 else None
        t.note = note if t.note == '' else t.note + ' | ' + note
        md.st = 4; md.why = note
        if outcome == 4: s.fn(md.slot, 10)

    def plan(s, dy, md, entryRaw, wickX):
        p = s.p; bull = dy.dir > 0
        entry = rt(entryRaw)
        anchor = wickX if (md.slot == 3 and wickX is not None) else dy.mExt
        stop = rt(anchor - p['buf'] * TICK) if bull else rt(anchor + p['buf'] * TICK)
        riskT = int(round(((entry - stop) if bull else (stop - entry)) / TICK))
        qty = p['qty']
        if p['sizeMode'] == 'Fixed cash risk' and riskT >= 1:
            qty = int(math.floor(p['cash'] / (riskT * TICK * PV)))
        armed = False
        if riskT < 1:
            md.st = 4; md.why = 'rejected: stop is not beyond the entry'; s.fn(md.slot, 8)
        elif riskT > p['maxStop']:
            md.st = 4; md.why = 'stop-cap rejection'; s.fn(md.slot, 8)
        elif qty < 1:
            md.st = 4; md.why = 'sizing rejection'; s.fn(md.slot, 14)
        else:
            tgt = None
            if p['tgt'] == '1R': tgt = entry + riskT * TICK if bull else entry - riskT * TICK
            elif p['tgt'] == '2R': tgt = entry + 2 * riskT * TICK if bull else entry - 2 * riskT * TICK
            else:
                if bull:
                    c1 = dy.orH if (dy.orH is not None and dy.orH > entry + TICK) else None
                    c2 = dy.pdH if (dy.pdH is not None and dy.pdH > entry + TICK) else None
                    tgt = c2 if c1 is None else (c1 if c2 is None else min(c1, c2))
                else:
                    c1 = dy.orL if (dy.orL is not None and dy.orL < entry - TICK) else None
                    c2 = dy.pdL if (dy.pdL is not None and dy.pdL < entry - TICK) else None
                    tgt = c2 if c1 is None else (c1 if c2 is None else max(c1, c2))
            if tgt is None:
                md.st = 4; md.why = 'rejected: no eligible opposing-liquidity target'; s.fn(md.slot, 11)
            else:
                md.lim = entry; md.stp = stop; md.tgt = rt(tgt); md.qty = qty
                md.tgtType = 'liquidity' if p['tgt'] == 'Opposing liquidity' else p['tgt']
                md.plannedR = abs(md.tgt - entry) / abs(entry - stop)
                md.st = 2; md.armBar = s.bi; md.armT = s.tclose; s.fn(md.slot, 5); armed = True
        return armed

    def cond(s, dy, md, entryRaw, wickX):
        s.fn(md.slot, 4); return s.plan(dy, md, entryRaw, wickX)

    # ---- fills
    def fillTry(s, dy, md):
        p = s.p; bull = dy.dir > 0; lim = md.lim; thrP = TICK if p['strict'] else 0.0
        o, h, l = s.open, s.high, s.low
        touch = (l <= lim - thrP) if bull else (h >= lim + thrP)
        if touch:
            known = (o <= lim - thrP) if bull else (o >= lim + thrP)
            stp = md.stp; tgt = md.tgt
            t = Trade(slot=md.slot, dir=dy.dir, dayKey=dy.key, lvl=dy.O, entryPx=lim, stopPx=stp, tgtPx=tgt, riskPts=abs(lim - stp), armT=md.armT,
                      fillT=s.time, qty=md.qty, plannedR=md.plannedR, tgtType=md.tgtType, riskUsd=abs(lim - stp) * PV * md.qty,
                      note=(md.trigNm + ' | plan ' + ('%.1f' % md.plannedR) + 'R ' + md.tgtType) if md.slot == 4 else '')
            md.tr = t; md.st = 3; s.trades.append(t); s.fn(md.slot, 6)
            stopHit = (l <= stp) if bull else (h >= stp)
            tgtTouch = (h >= tgt) if bull else (l <= tgt)
            adv = (lim - l) if bull else (h - lim); fav = (h - lim) if bull else (lim - l)
            t.maeP = max(0.0, adv)
            if known: t.mfeP = max(0.0, fav)
            else:
                t.mfeP = 0.0; t.excUnc = fav > 0; t.entryAmb = tgtTouch or fav > 0
            if stopHit and tgtTouch:
                t.maeP = max(t.maeP, t.riskPts); t.excUnc = True
                s.finish(md, 4, stp, s.time, 'ambiguous: stop and target both reachable on the fill candle')
            elif stopHit:
                t.maeP = max(t.maeP, t.riskPts); s.finish(md, 2, stp, s.time, 'stop hit on the fill candle')
            elif known and tgtTouch:
                t.mfeP = max(t.mfeP, abs(tgt - lim)); s.finish(md, 1, tgt, s.time, 'target hit on the fill candle (fill at the open)')

    def fillStep(s, dy, md):
        bull = dy.dir > 0
        if (s.open < dy.mExt) if bull else (s.open > dy.mExt):
            md.st = 4; md.why = 'invalidated: the candle opened beyond the frozen manipulation extreme'; s.fn(md.slot, 9)
        else:
            s.fillTry(dy, md)

    def posStep(s, dy, md):
        t = md.tr; bull = t.dir > 0; stp = md.stp; tgt = md.tgt; ent = t.entryPx
        o, h, l = s.open, s.high, s.low
        gStop = (o <= stp) if bull else (o >= stp); gTgt = (o >= tgt) if bull else (o <= tgt)
        stopHit = (l <= stp) if bull else (h >= stp); tgtHit = (h >= tgt) if bull else (l <= tgt)
        adv = (ent - l) if bull else (h - ent); fav = (h - ent) if bull else (ent - l)
        pMae = t.maeP; pMfe = t.mfeP; tgtD = abs(tgt - ent)
        if gStop:
            t.maeP = max(pMae, (ent - o) if bull else (o - ent)); s.finish(md, 2, o, s.time, 'gap through the stop: exit at the open')
        elif gTgt:
            t.mfeP = max(pMfe, tgtD); s.finish(md, 1, tgt, s.time, 'gap through the target: filled at the target (no improvement)')
        elif stopHit and tgtHit:
            t.maeP = max(pMae, t.riskPts); t.mfeP = max(pMfe, fav); t.excUnc = True
            s.finish(md, 4, stp, s.time, 'ambiguous: stop and target both reachable on one candle')
        elif stopHit:
            t.maeP = max(pMae, t.riskPts); t.excUnc = t.excUnc or fav > pMfe; s.finish(md, 2, stp, s.time, 'stop hit')
        elif tgtHit:
            t.mfeP = max(pMfe, tgtD); t.maeP = max(pMae, adv); t.excUnc = t.excUnc or adv > pMae; s.finish(md, 1, tgt, s.time, 'target hit')
        else:
            t.maeP = max(pMae, adv); t.mfeP = max(pMfe, fav)

    # ---- per-model waiting rules (Standard)
    def invalidate(s, md, why):
        md.st = 4; md.why = why; s.fn(md.slot, 9); s.msgK(3, md.slot, 'INVALIDATED - ' + why)

    def waitB(s, dy, md):
        bull = dy.dir > 0
        if s.exceeded(dy): s.invalidate(md, 'price exceeded the frozen manipulation extreme before the iFVG confirmation')
        elif (s.close > md.fT) if bull else (s.close < md.fB):
            md.fInv = True; s.cond(dy, md, dy.O, None)

    def waitC(s, dy, md):
        if s.exceeded(dy): s.invalidate(md, 'price exceeded the frozen manipulation extreme before a rejection candle')
        elif dy.rejOk:
            s.cond(dy, md, dy.rejEntry, (dy.rejLo if dy.dir > 0 else dy.rejHi) if md.slot == 3 else None)

    def cReject(s, dy):
        if dy.fibOk and not dy.rejOk and s.bi > dy.confBar and s.m < s.p['cutT'] and dy.O is not None:
            bull = dy.dir > 0; o, h, l, c = s.open, s.high, s.low, s.close
            inFrame = (l >= dy.mExt) if bull else (h <= dy.mExt)
            zone = l <= dy.fibHi and h >= dy.fibLo
            if bull:
                wick = l < min(o, c)
                if inFrame and zone and wick and l <= dy.O and c > dy.O:
                    dy.rejOk = True; dy.rejT = s.time; dy.rejHi = h; dy.rejLo = l; dy.rejBase = min(o, c); dy.rejEntry = (l + min(o, c)) / 2.0
            else:
                wick = h > max(o, c)
                if inFrame and zone and wick and h >= dy.O and c < dy.O:
                    dy.rejOk = True; dy.rejT = s.time; dy.rejHi = h; dy.rejLo = l; dy.rejBase = max(o, c); dy.rejEntry = (h + max(o, c)) / 2.0

    # ---- Precision
    def pivotUpdate(s, dy):
        p = s.p; n = len(s.bufH); c = n - 1 - p['pvR']
        if c - p['pvL'] >= 0:
            bull = dy.dir > 0
            pv = s.bufL[c] if bull else s.bufH[c]
            ok = s.bufI[c] > dy.confBar
            if ok:
                for j in range(1, p['pvL'] + 1):
                    ok = ok and ((s.bufL[c - j] > pv) if bull else (s.bufH[c - j] < pv))
                for j in range(1, p['pvR'] + 1):
                    ok = ok and ((s.bufL[c + j] > pv) if bull else (s.bufH[c + j] < pv))
            if ok:
                dy.pvP = pv; dy.pvBar = s.bufI[c]; dy.pvT = s.bufT[c]; dy.pvKn = s.bi; dy.pvDead = False

    def precTrig(s, dy, md, gate):
        p = s.p; bull = dy.dir > 0; o, h, l, c = s.open, s.high, s.low, s.close
        rng = h - l
        inArea = h >= dy.parLo and l <= dy.parHi
        intact = (l >= dy.mExt) if bull else (h <= dy.mExt)
        shape = False
        if rng > 0:
            wick = (min(o, c) - l) if bull else (h - max(o, c))
            dirOk = (c > dy.O and c > o) if bull else (c < dy.O and c < o)
            posOk = (c >= l + 0.5 * rng) if bull else (c <= l + 0.5 * rng)
            shape = dirOk and posOk and wick >= p['wick'] * rng - 1e-9
        rej = inArea and intact and shape
        swp = False
        if dy.pvP is not None and not dy.pvDead and s.bi > dy.pvKn:
            exc = (l <= dy.pvP - TICK) if bull else (h >= dy.pvP + TICK)
            swp = exc and inArea and intact and shape and ((c > dy.pvP) if bull else (c < dy.pvP))
            if exc: dy.pvDead = True
        useR = p['pTrig'] in ('Rejection', 'Either'); useS = p['pTrig'] in ('Secondary sweep', 'Either')
        fire = gate and ((useR and rej) or (useS and swp))
        if fire:
            both = useR and useS and rej and swp
            md.trigNm = 'Sweep + Rejection' if both else ('Secondary sweep' if (useS and swp) else 'Rejection')
            md.tT = s.time; md.tHi = h; md.tLo = l; md.tBase = min(o, c) if bull else max(o, c)
            md.sLvl = dy.pvP if (useS and swp) else None; md.sT = dy.pvT
        return fire

    def rejectP(s, md, col, why):
        md.st = 4; md.why = why; s.fn(4, col); s.msgK(3, 4, 'REJECTED - ' + why)

    def planP(s, dy, md):
        p = s.p; bull = dy.dir > 0
        entry = rt((md.tLo + md.tBase) / 2.0 if bull else (md.tHi + md.tBase) / 2.0)
        stop = rt(md.tLo - p['pBuf'] * TICK) if bull else rt(md.tHi + p['pBuf'] * TICK)
        dist = (entry - stop) if bull else (stop - entry)
        riskT = int(round(dist / TICK))
        qty = p['qty']
        if p['sizeMode'] == 'Fixed cash risk' and riskT >= 1:
            qty = int(math.floor(p['cash'] / (riskT * TICK * PV)))
        if dist <= 0 or riskT < 1: s.rejectP(md, 8, 'stop distance is zero or invalid after rounding')
        elif riskT > p['pCap']: s.rejectP(md, 8, 'stop-cap rejection')
        elif qty < 1: s.rejectP(md, 14, 'sizing rejection')
        else:
            tgt = None
            if p['pTgt'] == 'Fixed R': tgt = entry + p['pFixR'] * dist if bull else entry - p['pFixR'] * dist
            elif bull:
                c1 = dy.orH if (dy.orH is not None and dy.orH > entry + TICK and not (dy.poHi is not None and dy.poHi > dy.orH)) else None
                c2 = dy.pdH if (dy.pdH is not None and dy.pdH > entry + TICK and not (s.sHi is not None and s.sHi > dy.pdH)) else None
                tgt = c2 if c1 is None else (c1 if c2 is None else min(c1, c2))
            else:
                c1 = dy.orL if (dy.orL is not None and dy.orL < entry - TICK and not (dy.poLo is not None and dy.poLo < dy.orL)) else None
                c2 = dy.pdL if (dy.pdL is not None and dy.pdL < entry - TICK and not (s.sLo is not None and s.sLo < dy.pdL)) else None
                tgt = c2 if c1 is None else (c1 if c2 is None else max(c1, c2))
            if tgt is None: s.rejectP(md, 11, 'No eligible liquidity target')
            else:
                tgtR = rt(tgt); pR = abs(tgtR - entry) / dist
                if pR < p['minR'] - 1e-9: s.rejectP(md, 13, 'minimum-R rejection')
                else:
                    md.lim = entry; md.stp = stop; md.tgt = tgtR; md.qty = qty
                    md.tgtType = 'fixed-R' if p['pTgt'] == 'Fixed R' else 'liquidity'; md.plannedR = pR
                    md.st = 2; md.armBar = s.bi; md.armT = s.tclose; s.fn(4, 5)
                    s.msgK(1, 4, 'PRECISION ORDER ARMED')

    def waitP(s, dy, md):
        p = s.p; bull = dy.dir > 0
        if s.exceeded(dy): s.invalidate(md, 'price exceeded the frozen manipulation extreme before a precision trigger')
        else:
            gate = True
            if p['pIfvg'] and not md.fInv:
                gate = False
                if (s.close > md.fT) if bull else (s.close < md.fB): md.fInv = True
            if s.precTrig(dy, md, gate):
                s.fn(4, 4); s.planP(dy, md)
            s.pivotUpdate(dy)

    def fillStepP(s, dy, md):
        p = s.p; bull = dy.dir > 0; thrP = TICK if p['strict'] else 0.0
        o, h, l = s.open, s.high, s.low
        if s.bi > md.armBar + p['pExp']:
            md.st = 4; md.why = 'expired'; s.fn(4, 7)
        elif (o <= md.stp) if bull else (o >= md.stp):
            s.invalidate(md, 'local stop level breached before the fill')
        elif (o < dy.mExt) if bull else (o > dy.mExt):
            s.invalidate(md, 'shared setup invalidated')
        else:
            touchE = (l <= md.lim - thrP) if bull else (h >= md.lim + thrP)
            tgtFirst = (not touchE) and ((h >= md.tgt) if bull else (l <= md.tgt))
            if tgtFirst:
                md.st = 4; md.why = 'cancelled: the target was reached before the entry'; s.fn(4, 7)
            else:
                s.fillTry(dy, md)

    def modelStep(s, dy, md):
        p = s.p; m = s.m
        if md.st == 3:
            if m >= p['exitT']: s.finish(md, 3, s.open, s.time, 'time exit')
            else: s.posStep(dy, md)
        elif md.st in (1, 2):
            if m >= p['cutT']:
                if md.st == 2:
                    s.fn(md.slot, 7); md.why = 'unfilled: cancelled at the entry cutoff'
                else:
                    s.fn(md.slot, 12); md.why = 'entry conditions not met by the cutoff'
                md.st = 4
            elif md.st == 2:
                if s.bi > md.armBar:
                    (s.fillStepP if md.slot == 4 else s.fillStep)(dy, md)
            else:
                if md.slot == 1: s.waitB(dy, md)
                elif md.slot == 4: s.waitP(dy, md)
                else: s.waitC(dy, md)

    # ---- reversal confirmed
    def confirm(s, dy):
        p = s.p; bull = dy.dir > 0
        dy.confT = s.tclose; dy.confBar = s.bi
        dy.mPts = abs(dy.mExt - dy.O); dy.mAtr = None if dy.atrPre is None else dy.mPts / dy.atrPre
        tooBig = p['maxOn'] and ((dy.mAtr is not None and dy.mAtr > p['maxAtr']) if p['thr_mode'] == 'ATR' else dy.mPts > p['maxPts'])
        swOk = True
        if p['sweep']:
            i0 = 2 if bull else 0; bestI = -1; bestP = None
            for i in range(i0, i0 + 2):
                lv = dy.lvlP[i]
                if lv is not None and dy.lvlT[i] is not None and ((s.close > lv) if bull else (s.close < lv)):
                    if bestI < 0 or ((lv < bestP) if bull else (lv > bestP)): bestI = i; bestP = lv
            if bestI < 0: swOk = False
            else: dy.swpLvl = bestP; dy.swpT = dy.lvlT[bestI]; dy.swpNm = ['OR high', 'prev high', 'OR low', 'prev low'][bestI]
        if tooBig: dy.st = 8; dy.why = 'manipulation larger than the maximum-size filter'; s.fnA(9)
        elif not swOk: dy.st = 8; dy.why = 'no qualifying post-10am liquidity sweep'; s.fnA(9)
        else:
            dy.st = 3; s.fnA(3)
            if p['sweep']: s.fnA(2)
            s.msgK(0, s.selSlot, 'SETUP READY')
            if s.slotOn[0]: s.cond(dy, dy.ms[0], dy.O, None)
            if s.slotOn[1]:
                mb = dy.ms[1]
                gT = dy.fbeT if bull else dy.fbuT; gB = dy.fbeB if bull else dy.fbuB
                if gT is None:
                    mb.st = 4; mb.why = 'no eligible FVG'; s.fn(1, 12)
                else:
                    mb.fT = gT; mb.fB = gB; mb.fCT = dy.fbeC if bull else dy.fbuC
                    inv = (dy.fbeMax is not None and dy.fbeMax > gT) if bull else (dy.fbuMin is not None and dy.fbuMin < gB)
                    mb.fInv = inv; mb.st = 1
                    if inv: s.cond(dy, mb, dy.O, None)
            l618 = s.fibLvl(dy, 0.618); l79 = s.fibLvl(dy, 0.79)
            dy.fibLo = min(l618, l79); dy.fibHi = max(l618, l79)
            if s.slotOn[2] or s.slotOn[3]:
                dy.fibOk = dy.O >= dy.fibLo and dy.O <= dy.fibHi
                for k in (2, 3):
                    if s.slotOn[k]:
                        mc = dy.ms[k]
                        if dy.fibOk: mc.st = 1
                        else: mc.st = 4; mc.why = 'skipped: the 10am open is outside the 61.8-79% retracement zone'; s.fn(k, 12)
            if s.slotOn[4]:
                mp = dy.ms[4]
                dy.bdLo = dy.O - p['band'] * TICK; dy.bdHi = dy.O + p['band'] * TICK
                aLo = dy.bdLo; aHi = dy.bdHi; pOk = True; pWhy = ''
                if p['pFib']:
                    aLo = max(dy.bdLo, dy.fibLo); aHi = min(dy.bdHi, dy.fibHi)
                    if aLo > aHi: pOk = False; pWhy = 'skipped: the precision band does not overlap the 61.8-79% Fib zone'
                dy.parLo = aLo; dy.parHi = aHi
                if pOk and p['pIfvg']:
                    gT2 = dy.fbeT if bull else dy.fbuT; gB2 = dy.fbeB if bull else dy.fbuB
                    if gT2 is None: pOk = False; pWhy = 'skipped: no eligible FVG for the iFVG filter'
                    else:
                        mp.fT = gT2; mp.fB = gB2
                        mp.fInv = (dy.fbeMax is not None and dy.fbeMax > gT2) if bull else (dy.fbuMin is not None and dy.fbuMin < gB2)
                if pOk: mp.st = 1
                else: mp.st = 4; mp.why = pWhy; s.fn(4, 12)

    # ---- day engine
    def dayStep(s, dy):
        p = s.p; m = s.m; o, h, l, c = s.open, s.high, s.low, s.close
        if 570 <= m < 960:
            dy.rthH = h if dy.rthH is None else max(dy.rthH, h); dy.rthL = l if dy.rthL is None else min(dy.rthL, l); dy.rthN += 1
        if p['orS'] <= m < p['orE']:
            dy.orH = h if dy.orH is None else max(dy.orH, h); dy.orL = l if dy.orL is None else min(dy.orL, l); dy.orN += 1
        if m < p['openT']:
            dy.atrPre = s.atr
            if m >= p['orS']:
                if dy.pdH is not None and h >= dy.pdH + p['sweepTk'] * TICK: dy.preSweep = True
                if dy.pdL is not None and l <= dy.pdL - p['sweepTk'] * TICK: dy.preSweep = True
        if p['openT'] <= m < p['exitT']: dy.bars10 += 1
        if dy.st == 0 and m >= p['openT']:
            if m != p['openT']:
                dy.st = 9; dy.status = 2; dy.why = 'missing 10am candle'
            elif p['thr_mode'] == 'ATR' and dy.atrPre is None:
                dy.st = 9; dy.status = 3; dy.why = 'ATR history unavailable before the open'
            else:
                dy.O = o; dy.oT = s.time
                if dy.orN < p['orE'] - p['orS']: dy.orH = None; dy.orL = None
                dy.thr = p['atrM'] * dy.atrPre if p['thr_mode'] == 'ATR' else p['fixed']
                dy.lvlP[0] = dy.orH if p['lvOR'] else None; dy.lvlP[1] = dy.pdH if p['lvPD'] else None
                dy.lvlP[2] = dy.orL if p['lvOR'] else None; dy.lvlP[3] = dy.pdL if p['lvPD'] else None
                anyLvl = any(x is not None for x in dy.lvlP)
                if p['sweep'] and not anyLvl:
                    dy.st = 9; dy.status = 4; dy.why = 'no eligible sweep level'
                else:
                    dy.st = 1; s.fnA(0)
        if dy.O is not None and m >= p['openT']:
            dy.poHi = h if dy.poHi is None else max(dy.poHi, h); dy.poLo = l if dy.poLo is None else min(dy.poLo, l)
        if dy.st in (1, 2) and m >= p['openT']:
            for i in range(4):
                lv = dy.lvlP[i]
                if lv is not None and dy.lvlT[i] is None:
                    if (h >= lv + p['sweepTk'] * TICK) if i < 2 else (l <= lv - p['sweepTk'] * TICK): dy.lvlT[i] = s.tclose
            if dy.fbuB is not None: dy.fbuMin = c if dy.fbuMin is None else min(dy.fbuMin, c)
            if dy.fbeT is not None: dy.fbeMax = c if dy.fbeMax is None else max(dy.fbeMax, c)
            if s.h2 is not None and s.l2 is not None and s.t2 is not None and s.t2 >= dy.oT and s.time - s.t2 == 2 * MS:
                if l > s.h2: dy.fbuT = l; dy.fbuB = s.h2; dy.fbuC = s.tclose; dy.fbuMin = None
                if h < s.l2: dy.fbeT = s.l2; dy.fbeB = h; dy.fbeC = s.tclose; dy.fbeMax = None
        if dy.st == 1:
            if m >= p['manE']:
                dy.st = 7; dy.why = 'no qualifying manipulation'
            else:
                up = h - dy.O; dn = dy.O - l; qu = up >= dy.thr; qd = dn >= dy.thr
                if qu or qd:
                    if qu and qd and p['ambInit'] == 'Skip day':
                        dy.st = 7; dy.why = 'ambiguous first candle'; s.cv[6] += 1
                    else:
                        dy.dir = (-1 if up >= dn else 1) if (qu and qd) else (-1 if qu else 1)
                        dy.qBar = s.bi; dy.qT = s.tclose; dy.mExt = h if dy.dir < 0 else l; dy.mExtT = s.time
                        dy.oppX = l if dy.dir < 0 else h; dy.cnt = 0; dy.st = 2; s.fnA(1)
        if dy.st == 2 and s.bi > dy.qBar:
            if m >= p['cutT']:
                dy.st = 7; dy.why = 'no reversal confirmation before the entry cutoff'
            else:
                if dy.dir < 0:
                    if h >= dy.mExt: dy.mExt = h; dy.mExtT = s.time; dy.oppX = l
                    else: dy.oppX = min(dy.oppX, l)
                    dy.cnt = dy.cnt + 1 if c < dy.O else 0
                else:
                    if l <= dy.mExt: dy.mExt = l; dy.mExtT = s.time; dy.oppX = h
                    else: dy.oppX = max(dy.oppX, h)
                    dy.cnt = dy.cnt + 1 if c > dy.O else 0
                if dy.cnt >= p['revN']: s.confirm(dy)
        if dy.st == 3:
            if s.bi > dy.confBar:
                s.cReject(dy)
                for k in range(NS):
                    if s.slotOn[k]: s.modelStep(dy, dy.ms[k])
            if all((not s.slotOn[k]) or dy.ms[k].st == 4 for k in range(NS)): dy.st = 6

    def finalize(s, dy, lastC, lastT):
        p = s.p
        if dy.active:
            for md in dy.ms:
                if md.st == 3:
                    s.bi_save = s.bi; s.time_save = s.time
                    s.finish(md, 3, lastC, lastT, 'forced close at the last candle: no candle at/after the time exit (data missing)')
            if dy.st == 0: dy.status = 2; dy.why = 'no candle at/after the 10am open'
            if dy.status == 0 and dy.bars10 < p['exitT'] - p['openT']: dy.status = 1
            s.cv[0] += 1; s.cv[dy.status + 1] += 1

    def newDay(s, key, dow, prev):
        d = Day(key, 1 <= dow <= 5)
        if prev is not None and prev.rthN >= 390: d.pdH = prev.rthH; d.pdL = prev.rthL
        return d

    def run(s, bars):
        p = s.p
        # ATR(14) via RMA like ta.atr
        n = len(bars); atr = [None] * n; trs = []
        for i, b in enumerate(bars):
            tr = b['h'] - b['l'] if i == 0 else max(b['h'] - b['l'], abs(b['h'] - bars[i - 1]['c']), abs(b['l'] - bars[i - 1]['c']))
            trs.append(tr)
            if i == p['atrLen'] - 1: atr[i] = sum(trs[:p['atrLen']]) / p['atrLen']
            elif i >= p['atrLen']: atr[i] = (atr[i - 1] * (p['atrLen'] - 1) + tr) / p['atrLen']
        for i, b in enumerate(bars):
            s.bi = i; s.time = b['t']; s.tclose = b['t'] + MS; s.open = b['o']; s.high = b['h']; s.low = b['l']; s.close = b['c']
            s.m, dkey, dow = ny(b['t']); s.atr = atr[i]
            s.h2 = bars[i - 2]['h'] if i >= 2 else None; s.l2 = bars[i - 2]['l'] if i >= 2 else None; s.t2 = bars[i - 2]['t'] if i >= 2 else None
            s.msgs_bar = []
            s.bufH.append(s.high); s.bufL.append(s.low); s.bufI.append(i); s.bufT.append(s.time)
            while len(s.bufH) > 12: s.bufH.pop(0); s.bufL.pop(0); s.bufI.pop(0); s.bufT.pop(0)
            if s.m >= 960 and (s.pM is None or s.pM < 960): s.sHi = s.high; s.sLo = s.low
            else:
                s.sHi = s.high if s.sHi is None else max(s.sHi, s.high); s.sLo = s.low if s.sLo is None else min(s.sLo, s.low)
            s.pM = s.m
            if s.cur is None or s.cur.key != dkey:
                if s.cur is not None:
                    s.finalize(s.cur, s.pClose, s.pCloseT)
                    if s.cur.active: s.lastAct = s.cur
                s.cur = s.newDay(dkey, dow, s.lastAct); s.days.append(s.cur)
                if s.cur.active:
                    if s.firstKey is None: s.firstKey = dkey
                    s.lastKey = dkey
            if s.cur.active: s.dayStep(s.cur)
            s.pClose = s.close; s.pCloseT = s.tclose
        return s
