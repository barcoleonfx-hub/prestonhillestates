from c_pine_lib import *
import c_pine_lib as _L
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
ok('parent: with no area at all the Fib candidate WAITS for a parent (overlap filter OFF does not bypass the parent requirement); no order, no trade', len(pl) == 0 and len(trades(it, 6)) == 0 and setups(it)[0].f['parWait'] is True and setups(it)[0].f['fibSt'] == 1, (setups(it)[0].f['parWait'], setups(it)[0].f['fibSt'], [(m.f['st'], m.f['why']) for m in plans(it, 6)]))
old = run(b, src=OLD, inject=lv, inputs=NOAREA)
ok('parent: the PRE-AUDIT source armed a Fib order with no parent', len([m for m in plans(old, 6) if m.f['st'] in (2, 3, 4) and m.f['why'] == '' or m.f['st'] == 2]) >= 1, [(m.f['st'], m.f['why']) for m in plans(old, 6)])
it = run(b, inject=lv, inputs=dict(inPRejOn=False))
pl = plans(it, 6, 'Fib 0.705')
ok('parent: with areas present, Fib arms and records a parent (overlap filter OFF)', len(pl) == 1 and pl[0].f['st'] in (2, 3) and pl[0].f['parId'] > 0, [(m.f['st'], m.f['why']) for m in pl])
it = run(b, inject=lv, inputs=dict(inPRejOn=False, inFibArea=True))
pl = plans(it, 6, 'Fib 0.705')
par = pl[0].f['areaK'] if pl else None
ok('parent: the optional overlap filter is a SEPARATE condition (entry 19993.75 vs the chosen parent)', len(pl) == 1 and ((pl[0].f['st'] == 4 and 'overlap' in pl[0].f['why']) or pl[0].f['st'] in (2, 3)), [(m.f['st'], m.f['why'], m.f['aLo'], m.f['aHi']) for m in pl])


# =============================================================== 9. funnel reconciliation, blocking, consumption
def rc(it): return list(it.g('rcN'))
def lab(i): return ['candidate armed', 'cap', 'target', 'filter', 'invalid', 'daily', 'order', 'no area', 'inval', 'exp', 'day', 'other', 'data', 'active'][i]
# (a) Standard rejected by the stop cap, Precision off: the setup is EXHAUSTED and a later sweep creates a new setup
SECOND = [(20006, 20012, 20005, 20011), (20011, 20020, 20010, 20019), (20019, 20033, 20018, 20032)]   # runs up through an injected high at 20030
b, lv = sc(BASE + SECOND)
it = run(b, inject=lv + [('EQH', 1, 20030.0)], inputs=dict(inCxCap=20, inCmpVar=False))
ok('funnel: Standard stop-cap rejection + Precision off -> setup #1 ends "exhausted" (does not keep blocking)', setups(it)[0].f['st'] == 8 and 'exhausted' in setups(it)[0].f['why'], (setups(it)[0].f['st'], setups(it)[0].f['why']))
ok('funnel: ...so the next sweep (#2) is NOT ignored by an idle blocker', len(setups(it)) >= 2 and rc(it)[1] == 1 and list(it.g('blkC'))[2] == 0 and list(it.g('blkC'))[3] == 0, (len(setups(it)), rc(it), list(it.g('blkC'))))
ok('funnel: setup #1 is classified once, as "candidate rejected: stop cap"', setups(it)[0].f['endCat'] == 'candidate rejected: stop cap', setups(it)[0].f['endCat'])
# (b) with Precision enabled the same setup still has attempts left (Fib/rejection) -> it is kept, and the ignored sweep is COUNTED by blocker state
it = run(b, inject=lv + [('EQH', 1, 20030.0)], inputs=dict(inCxCap=20, inCmpVar=True))
ok('funnel: with Precision enabled the setup keeps its remaining attempts; the blocked sweep is counted with the blocker state', setups(it)[0].f['st'] == 2 and sum(list(it.g('blkC'))) >= 1, (setups(it)[0].f['st'], list(it.g('blkC'))))
# (c) reconciliation identity: classified + still-active == area-qualified
tot = rc(it)[15]; cls = sum(rc(it)[0:13])
ok('funnel: reconciliation identity (classified + still active = area-qualified setups)', cls <= tot and tot >= 1, (cls, tot))
# (d) outside any entry window: window 20:00-21:00, the setup rolls over at 18:00 without ever seeing a window
flat_tail = [None] * 100
b, lv = sc(BASE + flat_tail)
it = run(b + stream(b[-1]['t'] + 60000, T(*D, 18, 5), lambda t: (20006, 20006.5, 20005.5, 20006)), inject=lv, inputs=dict(inCxWin='2000-2100', inCxHard='21:00', inCxAgeMin=2000, inCmpVar=False))
ok('funnel: setup that never saw an entry window is classified "rolled to the next trading day"', setups(it)[0].f['endCat'].startswith('no candidate: rolled') and rc(it)[10] == 1, (setups(it)[0].f['endCat'], setups(it)[0].f['st'], rc(it)))
# (e) in window but no executable fresh area: every area was already traded through (stale) before the window
STALE = [(20006, 20007, 19986, 19990), (19990, 20010, 19989, 20009)]
b, lv = sc(BASE + STALE + [None] * 3, start=(*D, 8, 0))
it = run(b + stream(b[-1]['t'] + 60000, T(*D, 16, 40), lambda t: (20009, 20009.5, 20008.5, 20009)), inject=lv, inputs=dict(inCmpVar=False, inAFvg=False, inABrk=False, inARb=False, inAIf=False))
st1 = setups(it)[0]
ok('funnel: window seen but nothing executable/fresh -> "no executable fresh area", no candidate', st1.f['candN'] == 0 and st1.f['winSeen'] and not st1.f['execSeen'] and st1.f['endCat'].startswith('no candidate: in window'), (st1.f['candN'], st1.f['winSeen'], st1.f['execSeen'], st1.f['endCat'], st1.f['why']))
# (f) candidate armed is its own category
b, lv = sc(BASE + [(20006, 20007, 19994.5, 19996), (19996, 20110, 19996, 20100)] + [None] * 3)
it = run(b + stream(b[-1]['t'] + 60000, T(*D, 18, 5), lambda t: (20100, 20100.5, 20099.5, 20100)), inject=lv, inputs=dict(inCmpVar=False))
ok('funnel: an armed candidate is classified "candidate armed"', setups(it)[0].f['endCat'] == 'candidate armed' or rc(it)[0] == 1, (setups(it)[0].f['endCat'], rc(it)))
# (g) Fib candidate waits for a parent instead of being consumed
ONLYRB = dict(inAFvg=False, inAOb=False, inABrk=False, inAIf=False, inARb=True, inPRejOn=False, inRbWick=0.95)
RBC = [(20006, 20006, 19999, 20006)]      # a wick candle after the window opens: it becomes the first valid parent
b, lv = sc(BASE + FIBX + [None] * 14 + RBC + [None] * 3, start=(*D, 8, 0))
it = run(b, inject=lv, inputs=ONLYRB)
fp = plans(it, 6, 'Fib 0.705'); st1 = setups(it)[0]
ok('consumption: with no parent at the window start the stored Fib candidate WAITS (not consumed)', st1.f['parWait'] is True and len(fp) == 1, (st1.f['parWait'], st1.f['fibSt'], [(m.f['st'], m.f['why']) for m in fp]))
ok('consumption: ...and arms once a valid parent (the later rejection block) exists', len(fp) == 1 and fp[0].f['areaK'] == 'RB' and fp[0].f['armT'] >= at(9, 40) and fp[0].f['st'] in (2, 3, 4), [(m.f['areaK'], m.f['armT'], m.f['st'], m.f['why']) for m in fp])

# (h) a Fib endpoint that goes stale BEFORE any entry window is not an evaluated candidate: the setup is attributed to the entry window
STL = [(20006, 20006, 19993, 20004)]
b, lv = sc(BASE + FIBX + [None] * 3 + STL + [None] * 4, start=(*D, 4, 0))
it = run(b + stream(b[-1]['t'] + 60000, T(*D, 18, 5), lambda t: (20006, 20006.5, 20005.5, 20006)), inject=lv, inputs=dict(inCmpVar=True, inPRejOn=False, inCxWin='2000-2100', inCxHard='21:00', inCxAgeMin=2000))
st1 = setups(it)[0]
ok('funnel: pre-window stale Fib is NOT a candidate; setup attributed to the entry window (rolled); stale still counted as a reason', st1.f['candN'] == 0 and rc(it)[3] == 0 and rc(it)[10] == 1 and 'stale fib' in list(it.g('rjK')), (st1.f['candN'], rc(it), list(it.g('rjK'))))

# =============================================================== 9b. macro mode (sweep must occur inside 09:50-10:10)
b, lv = sc(BASE)      # the sweep candle opens at 09:40
it = run(b, inject=lv, inputs=dict(inCmpVar=False, inCxLvCS=False))
ok('macro: OFF (default) - the 09:40 sweep starts a setup', len(setups(it)) == 1, len(setups(it)))
it = run(b, inject=lv, inputs=dict(inCmpVar=False, inCxLvCS=False, inCxMacro=True))
ok('macro: ON with 09:50-10:10 - a 09:40 sweep is ignored (no setup), counted as outside the macro', len(setups(it)) == 0 and rc(it)[14] >= 1, (len(setups(it)), rc(it)[14]))
it = run(b, inject=lv, inputs=dict(inCmpVar=False, inCxLvCS=False, inCxMacro=True, inCxMacroWin='0935-0950'))
ok('macro: ON with a window containing 09:40 - the setup is created and reaches its CISD', len(setups(it)) == 1 and setups(it)[0].f['st'] == 2, [(s.f['st'], s.f['why']) for s in setups(it)])
it = run(b, inject=lv, inputs=dict(inCmpVar=False, inCxLvCS=False, inCxMacro=True, inCxMacroWin='0940-0945'))
ok('macro: the window start is inclusive and the end exclusive (09:40-09:45 admits the 5m source candle starting 09:40; the check uses the 1m candle that crossed the level)', len(setups(it)) == 1, len(setups(it)))
it = run(b, inject=lv, inputs=dict(inCmpVar=False, inCxLvCS=False, inCxMacro=True, inCxMacroWin='0930-0940'))
ok('macro: a window ending at 09:40 excludes the 09:40 candle', len(setups(it)) == 0, len(setups(it)))

# =============================================================== 10. target audit
b, lv = sc(BASE)
it = run(b, inject=lv + [('ORH', 1, 20050.0)], inject_at={5: [('EQH', 1, 20040.0, at(23, 0) + 86400000)]}, inputs=dict(inCmpVar=False))
md = plans(it, 5)[0]
ok('target: a NEARER eligible unswept level (20050) is chosen over the farther PDH (20100)', md.f['tgt'] == 20050.0 and md.f['tgtTy'] == 'ORH', (md.f['tgt'], md.f['tgtTy']))
ok('target: the audit text names the level, origin, availability and status', 'ORH' in md.f['tgtAud'] and 'origin' in md.f['tgtAud'] and 'known' in md.f['tgtAud'] and 'untouched' in md.f['tgtAud'], md.f['tgtAud'])
ok('target: a nearer level that was already swept (CSH) or not yet known (20040) is reported as ineligible', 'nearer but ineligible' in md.f['tgtAud'] and ('swept' in md.f['tgtAud'] or 'not yet known' in md.f['tgtAud']), md.f['tgtAud'])
tr_ = [l for l in L(it, 'lvls') if l.f['ty'] == 'ORH'][0].f
ok('target: the chosen level was unswept when armed', tr_['st'] < 2 and tr_['known'] <= md.f['armT'], tr_)

# =============================================================== 11. display
b, lv = sc(BASE + FIBX)
it = run(b, inject=lv, draw=True, inputs=dict(inCmpVar=False))
T_ = it.tables
sumc = T_['position.top_right'].cells
ok('display: default view shows ONLY the summary panel', len(sumc) == 7 and all(len(T_[k].cells) == 0 for k in T_ if k != 'position.top_right'), {k: len(v.cells) for k, v in T_.items()})
ok('display: summary says Precision is OFF and how to enable it', 'PREC: OFF' in sumc[(0, 3)] and 'COMPARE' in sumc[(0, 3)], sumc[(0, 3)])
ok('display: summary rows (preset/variant, setup, STD, PREC, last reject, warning)', sumc[(0, 0)].startswith('H Ticks C') and sumc[(0, 1)].startswith('Setup:') and sumc[(0, 2)].startswith('STD:') and 'Last reject' in sumc[(0, 4)] and 'SAMPLE' in sumc[(0, 5)], list(sumc.values()))
boxes = [o for o in it.objs if o.kind == 'box.new' and not o.dead]
lines = [o for o in it.objs if o.kind == 'line.new' and not o.dead]
ok('display: a pending Standard plan draws a dashed red risk box and a dashed green reward box', any(str(o.kw.get('border_style')) == 'line.style_dashed' and str(o.kw.get('border_color')) == 'color.red' for o in boxes) and any(str(o.kw.get('border_color')) == 'color.green' for o in boxes), [(o.kw.get('border_style'), o.kw.get('border_color')) for o in boxes])
ok('display: the entry line is black', any(str(o.kw.get('color')) == 'color.black' for o in lines), [o.kw.get('color') for o in lines])
it = run(b, inject=lv, draw=True, inputs=dict(inCmpVar=True, inDbgView='All (overlaps)'))
T_ = it.tables
ok('display: debug mode fills the diagnostic tables', len(T_['position.top_center'].cells) > 10 and len(T_['position.middle_left'].cells) >= 8 and len(T_['position.bottom_center'].cells) > 5, {k: len(v.cells) for k, v in T_.items()})
fun = T_['position.middle_right'].cells
ok('display: disabled method columns are hidden, enabled ones shown (no "off" cells)', not any(v == 'off' for v in fun.values()) and (3, 0) in fun and (4, 0) in fun and fun[(1, 0)] == 'STD', {k: v for k, v in fun.items() if k[1] == 0})
it = run(b, inject=lv, draw=True, inputs=dict(inCmpVar=True, inDbgView='All (overlaps)', inPFibOn=False, inPRejOn=False))
fun = it.tables['position.middle_right'].cells
ok('display: with both Precision methods off only STD and PREC columns appear', (3, 0) not in fun and (2, 0) in fun, {k: v for k, v in fun.items() if k[1] == 0})
# lifecycle: an invalidated setup is not drawn by default and is truncated at its end when historical context is on
INV = [(20006, 20007, 19980, 19983)]       # trades through the frozen sweep extreme 19985 -> setup ended, Standard order never armed because the cap is tiny
b, lv = sc(BASE + INV + [None] * 3)
it = run(b, inject=lv, draw=True, inputs=dict(inCmpVar=False, inCxCap=20))
labels = [o for o in it.objs if o.kind == 'label.new' and not o.dead]
ok('lifecycle: an ended setup is hidden by default', not any('SWEEP #1' in str(o.kw.get('text')) for o in labels), [str(o.kw.get('text'))[:30] for o in labels])
it = run(b, inject=lv, draw=True, inputs=dict(inCmpVar=False, inCxCap=20, inCxHistCtx=True))
st1 = setups(it)[0]; endT = st1.f['endT']
orange = [o for o in it.objs if o.kind == 'line.new' and str(o.kw.get('color')) == 'color.orange' and not o.dead]
aqua = [o for o in it.objs if o.kind == 'line.new' and str(o.kw.get('color')) == 'color.aqua' and not o.dead]
ok('lifecycle: with Historical Context the ended setup is drawn but never extends past its end time', st1.f['st'] == 8 and endT > 0 and orange and all(o.kw['x2'] <= endT for o in orange) and all(o.kw['x2'] <= endT for o in aqua if o.kw['x1'] < endT), (endT, [o.kw['x2'] for o in orange]))
# completed trade boxes: configurable count, latest first
def day_bars(d):
    bs = candles((*d, 9, 30), BASE + [(20006, 20007, 19994.5, 19996), (19996, 20110, 19996, 20100)])
    return bs
days3 = [(2025, 3, 12), (2025, 3, 13), (2025, 3, 14)]
allb = []; inj = {}
for d in days3:
    inj[len(allb)] = [('PDL', -1, 19990.0, None), ('PDH', 1, 20100.0, None)]
    allb += day_bars(d)
FIXR = dict(inCmpVar=False, inCxTgt='Fixed R', inCxFixR=3.0)
it = run(allb, inject_at=inj, draw=True, inputs=dict(FIXR, inCxNDone=2))
done = [m for m in plans(it, 5) if m.f['st'] == 4 and m.f['tr'] is not None]
exits = [o for o in it.objs if o.kind == 'label.new' and not o.dead and str(o.kw.get('text')).startswith('x ')]
ok('boxes: three completed Standard trades exist across three days', len(done) == 3, [(m.f['dayKey'], m.f['st'], m.f['why']) for m in plans(it, 5)])
ok('boxes: only the configured number (2) of completed trade boxes is kept, with exit markers', len(exits) == 2, [str(o.kw.get('text')) for o in exits])
it = run(allb, inject_at=inj, draw=True, inputs=dict(FIXR, inCxNDone=3))
exits = [o for o in it.objs if o.kind == 'label.new' and not o.dead and str(o.kw.get('text')).startswith('x ')]
ok('boxes: raising the setting to 3 keeps all three', len(exits) == 3, len(exits))


# =============================================================== 12. guide-faithful mode
G15 = [(15, (20000, 20001, 19994, 19995)), (15, (19995, 19996, 19990.5, 19991)), (15, (19991, 19992, 19985, 19987)), (15, (19987, 19999.5, 19987, 19999)), (15, (19999, 20008, 19999, 20006))]   # 09:00-10:15: sweep of 19990, CISD at 10:15
RET = [(5, (20006, 20007, 20005.5, 20006.5)), (5, (20006.5, 20006.5, 19998, 19998.5)), (5, (19998.5, 19999, 19995, 19996))]   # retracement run into the 15m FVG
TRIG = (5, (19996, 20009, 19995.5, 20008))     # 10:30 bullish candle closing through the run's open (20006.5)
def gd_bars(extra=(), trig=TRIG):
    return seq((*D, 9, 0), G15 + RET + [trig] + list(extra))
GDI = dict(inCmpVar=False, inGdH1=False, inGuide=True)
b = gd_bars([(5, (20008, 20009, 20007, 20008))])
it = run(b, inject=LV, inputs=GDI)
st1 = setups(it)[0]; md = [m for m in plans(it, 5)]
ok('guide: the sweep and CISD are read on 15m (CISD confirmed at 10:15)', st1.f['dir'] == 1 and st1.f['st'] == 2 and st1.f['cisdT'] == at(10, 15), (st1.f['st'], st1.f['why'], st1.f['cisdT']))
ok('guide: Standard enters on a CLOSING confirmation candle inside the zone (method "Close trigger", market order)', len(md) == 1 and md[0].f['meth'] == 'Close trigger' and md[0].f['mkt'] is True, [(m.f['meth'], m.f['st'], m.f['why']) for m in md])
tr = trades(it, 5)
ok('guide: the order fills at the NEXT candle\'s open (10:35 open = 20008), not at a resting limit', len(tr) == 1 and abs(tr[0].f['entryPx'] - 20008.0) < 1e-9 and tr[0].f['fillT'] == at(10, 35), [(t.f['entryPx'], t.f['fillT']) for t in tr])
ok('guide: stop beyond the sweep extreme (94 ticks <= cap 100); target the nearest unswept liquidity; planned R >= 3', md and abs(md[0].f['stp'] - 19984.5) < 1e-9 and md[0].f['tgt'] == 20100.0 and md[0].f['plannedR'] >= 3.0, (md[0].f['stp'], md[0].f['tgt'], md[0].f['plannedR']) if md else None)
it2 = run(b, inject=LV, inputs=dict(GDI, inGdCap=80)); m2 = plans(it2, 5)
ok('guide: stop too wide -> the local-structure stop (retracement extreme 19995 - buffer)', len(m2) == 1 and abs(m2[0].f['stp'] - 19994.5) < 1e-9, [(m.f['stp'], m.f['why']) for m in m2])
it3 = run(b, inject=LV, inputs=dict(GDI, inGdCap=40)); m3 = plans(it3, 5)
ok('guide: still too wide -> rejected (never squeezed), no trade', len(m3) == 1 and m3[0].f['st'] == 4 and 'stop-cap' in m3[0].f['why'] and not trades(it3, 5), [(m.f['st'], m.f['why']) for m in m3])
it4 = run(b, inject=LV, inputs=dict(inCmpVar=False, inGuide=True))
m4 = plans(it4, 5)
ok('guide: by default the 1H CISD must agree - with none available the candidate is rejected with that reason', len(m4) == 1 and m4[0].f['st'] == 4 and '1H CISD' in m4[0].f['why'], [(m.f['st'], m.f['why']) for m in m4])
bad = (5, (19996, 19999, 19994, 19995))
it5 = run(gd_bars(trig=bad), inject=LV, inputs=GDI)
ok('guide: a non-confirming candle (bearish / no close through the run open) is not a trigger', len(plans(it5, 5)) == 0, [(m.f['meth'], m.f['why']) for m in plans(it5, 5)])
it6 = run(b, inject=LV, inputs=dict(GDI, inGuide=False))
ok('guide: OFF restores the previous behaviour (limit-at-CE Standard, no Close trigger plans)', not any(m.f['meth'] == 'Close trigger' for m in plans(it6, 5)), [(m.f['meth']) for m in plans(it6, 5)])
# trailing: +1R then back -> stopped at -0.5R; +2R then back -> break-even; trail OFF -> still open
FIL = (5, (20008, 20009, 20007, 20008))
UP1 = [FIL, (5, (20011, 20035, 20010, 20034)), (5, (20034, 20034.5, 19990, 19992))]
UP2 = [FIL, (5, (20011, 20060, 20010, 20058)), (5, (20058, 20058.5, 19990, 19992))]
it7 = run(gd_bars(UP1), inject=LV, inputs=GDI); t7 = trades(it7, 5)
ok('guide trail: +1R then a pullback is stopped at -0.5R (trailed stop, effective from the next candle)', len(t7) == 1 and abs(t7[0].f['exitPx'] - 19996.25) < 1e-9 and 'trailed' in t7[0].f['note'] and -0.6 < t7[0].f['netR'] < -0.4, [(t.f['exitPx'], t.f['netR'], t.f['note']) for t in t7])
it8 = run(gd_bars(UP2), inject=LV, inputs=GDI); t8 = trades(it8, 5)
ok('guide trail: +2R then a pullback exits at break-even', len(t8) == 1 and abs(t8[0].f['exitPx'] - 20008.0) < 1e-9 and abs(t8[0].f['netR']) < 1e-9, [(t.f['exitPx'], t.f['netR']) for t in t8])
it9 = run(gd_bars(UP1), inject=LV, inputs=dict(GDI, inGdTrail=False)); t9 = trades(it9, 5)
ok('guide trail: with the trail OFF the same path leaves the trade open (stop untouched)', len(t9) == 1 and t9[0].f['isOpen'] is True, [(t.f['isOpen'], t.f['exitPx']) for t in t9])
# significant levels only
flat_bars = stream(T(*D, 9, 30), T(*D, 11, 30), lambda t: (20000, 20003 if t == T(*D, 9, 45) else 20000.5, 19999.5, 20000))
ig = run(flat_bars, inputs=dict(inGuide=True)); ng = run(flat_bars, inputs=dict(inGuide=False))
ok('guide: current-session levels are not created in guide mode (they are otherwise)', not any(l.f['ty'] in ('CSH', 'CSL') for l in L(ig, 'lvls')) and any(l.f['ty'] in ('CSH', 'CSL') for l in L(ng, 'lvls')), ([l.f['ty'] for l in L(ig, 'lvls')], [l.f['ty'] for l in L(ng, 'lvls')]))
# CISD tracker on the 1H timeframe
def hourly(t):
    hh = 8 + (t - T(*D, 8, 0)) / 3600000.0
    path = [(8, 20000.0), (9, 20000.0), (10, 19980.0), (11, 19960.0), (12, 20010.0)]
    for (h0, p0), (h1, p1) in zip(path, path[1:]):
        if h0 <= hh < h1:
            f = lambda x: p0 + (p1 - p0) * (x - h0) / (h1 - h0)
            a = f(hh); b2 = f(hh + 1 / 60.0)
            return (a, max(a, b2), min(a, b2), b2)
    return (20010.0, 20010.5, 20009.5, 20010.0)
hb = stream(T(*D, 8, 0), T(*D, 12, 5), hourly)
ith = run(hb, inputs=dict(inCmpVar=False, inGuide=True))
ok('guide: the 1H CISD tracker flips bullish when a 1H candle closes through the open of the opposing run, stamped at that candle\'s close', list(ith.g('ctS'))[4] == 1 and list(ith.g('ctT'))[4] == T(*D, 12, 0), (list(ith.g('ctS')), list(ith.g('ctT'))))


print('passed', _L.PASS, 'failed', len(_L.FAIL), 'skipped', len(_L.SKIPPED))
sys.exit(1 if _L.FAIL else 0)
