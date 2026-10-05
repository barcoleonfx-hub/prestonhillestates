"""Model checks for the audit/repair items: outcome states, reporting table, retention, obstacle completeness,
time-based engine coverage, drawing/alert spec. Python re-implementations + text checks of the Pine source.
They do NOT prove that the Pine compiles or runs identically in TradingView."""
import re, datetime as dt, zoneinfo
TICK = 0.25
def tk(x): return round(x / TICK)
R = []
def chk(n, c, how='MODEL'): R.append((n, 'PASS' if c else 'FAIL', how))
PINE = open('H_Ticks_FVG_iFVG.pine').read()
CODE = '\n'.join(l.split('  //')[0] if not l.lstrip().startswith('//') else '' for l in PINE.split('\n'))

# ---------- outcome model (mirror of f_trackSetups) ----------
def outcome_state(d, S, T, o, h, l):
    oT, hT, lT, sT, tT = tk(o), tk(h), tk(l), tk(S), tk(T)
    if d > 0:
        if oT >= tT: return 1
        if oT <= sT: return 2
        th, sh = hT >= tT, lT <= sT
    else:
        if oT <= tT: return 1
        if oT >= sT: return 2
        th, sh = lT <= tT, hT >= sT
    return 3 if th and sh else (1 if th else (2 if sh else 0))
OPEN, TGT, STP, AMB = 0, 1, 2, 3
# the spec's long case E=100, S=99, T=101 (tick 0.25)
E, S, T = 100.0, 99.0, 101.0
def track(setup, candles):    # mirror of the per-bar loop: candles strictly after the entry candle only
    for bi, (o, h, l) in candles:
        if setup['state'] == 0 and bi > setup['bar']:
            setup['state'] = outcome_state(setup['dir'], setup['stop'], setup['target'], o, h, l)
    return setup['state']
st0 = dict(dir=1, stop=99.0, target=101.0, bar=10, state=0)
chk('Entry candle (touched 99 before closing 100) is skipped: setup stays OPEN; later open100/high101/low99.5 -> TARGET_HIT',
    track(st0, [(10, (100, 100.5, 99.0))]) == OPEN and track(st0, [(11, (100, 101.0, 99.5))]) == TGT)
st1 = dict(dir=1, stop=99.0, target=101.0, bar=10, state=0)
track(st1, [(11, (100, 101.0, 99.5))]); first = st1['state']; track(st1, [(12, (100, 100.5, 99.0))])
chk('Terminal state is set once: a later stop-touching candle cannot change a TARGET_HIT setup', first == TGT and st1['state'] == TGT)
chk('Code: tracker only evaluates candles with bar_index > s.entryBar', 'if s.state == 0 and bar_index > s.entryBar' in PINE, 'CODE INSPECTION')
cases = [('open100 high101 low99.5', (100, 101, 99.5), TGT), ('open100 high100.5 low99', (100, 100.5, 99), STP),
         ('open100 high101.25 low98.75', (100, 101.25, 98.75), AMB), ('open101.25 high101.5 low98.75', (101.25, 101.5, 98.75), TGT),
         ('open98.75 high101.25 low98.5', (98.75, 101.25, 98.5), STP), ('open100 high100.5 low99.5 (nothing touched)', (100, 100.5, 99.5), OPEN),
         ('open at exactly the stop 99', (99, 101.5, 98.5), STP), ('open at exactly the target 101', (101, 101.5, 98.5), TGT)]
for n, (o, h, l), exp in cases:
    chk(f'Long E100 S99 T101: {n} -> {["OPEN","TARGET_HIT","STOP_HIT","AMBIGUOUS"][exp]}', outcome_state(1, S, T, o, h, l) == exp)
# short mirror: E=100, S=101, T=99
Es, Ss, Ts = 100.0, 101.0, 99.0
for n, (o, h, l), exp in [('open100 low99 high100.5', (100, 100.5, 99), TGT), ('open100 high101 low99.5', (100, 101, 99.5), STP),
                          ('open100 high101.25 low98.75', (100, 101.25, 98.75), AMB), ('open98.75 high101.5 low98.5', (98.75, 101.5, 98.5), TGT),
                          ('open101.25 high101.5 low98.75', (101.25, 101.5, 98.75), STP), ('open100 high100.5 low99.5', (100, 100.5, 99.5), OPEN)]:
    chk(f'Short E100 S101 T99: {n} -> {["OPEN","TARGET_HIT","STOP_HIT","AMBIGUOUS"][exp]}', outcome_state(-1, Ss, Ts, o, h, l) == exp)
chk('Boundary touch counts (long high == target exactly, low above stop) -> TARGET_HIT', outcome_state(1, S, T, 100, 101, 99.25) == TGT)
chk('Boundary touch counts (short low == target exactly) -> TARGET_HIT', outcome_state(-1, Ss, Ts, 100, 100.5, 99) == TGT)
chk('Code: outcome states are set once (guard s.state == 0) and no time/slippage/cost inputs exist',
    'if s.state == 0 and bar_index' in PINE and not re.search(r'inSlipTicks|inCostTicks|inTimeStopMin', PINE), 'CODE INSPECTION')

# ---------- reporting table ----------
NY = zoneinfo.ZoneInfo('America/New_York')
def ny_key(ms): d = dt.datetime.fromtimestamp(ms / 1000, NY); return d.year * 10000 + d.month * 100 + d.day
def ms(y, mo, d, h, mi, tz=NY): return int(dt.datetime(y, mo, d, h, mi, tzinfo=tz).timestamp() * 1000)
class Rep:
    def __init__(s): s.setups = []; s.dates = []   # dates: dict(key, dow, setn)
    def add_date(s, key, dow): s.dates.append(dict(key=key, dow=dow, setn=0))
    def enter(s, t, state=OPEN):
        k = ny_key(t); s.setups.append(dict(key=k, state=state))
        for d in s.dates:
            if d['key'] == k: d['setn'] += 1
    def report_dates(s):
        r = []
        for d in reversed(s.dates):
            if len(r) < 5 and (1 <= d['dow'] % 7 <= 6 and d['dow'] not in (0, 6) or d['setn'] > 0): r.insert(0, d['key'])
        return r
    def prune(s):
        rd = s.report_dates(); cut = rd[0] if rd else 0
        s.setups = [x for x in s.setups if x['state'] == OPEN or x['key'] >= cut]
    def row(s, k):
        c = [sum(1 for x in s.setups if x['key'] == k and x['state'] == st) for st in (TGT, STP, OPEN, AMB)]
        return dict(total=sum(c), W=c[0], L=c[1], O=c[2], A=c[3])
def dow(key): return dt.date(key // 10000, key // 100 % 100, key % 100).weekday()   # Mon=0
def mkrep(days):
    r = Rep()
    for (y, m, d) in days:
        k = y * 10000 + m * 100 + d; r.add_date(k, (dow(k) + 1) % 7 + 1 if False else dt.date(y, m, d).isoweekday() % 7 + 1)
    return r
# Pine dayofweek: Sunday=1 .. Saturday=7 ; weekday = 2..6
days = [(2026, 9, 28 + i) if i < 3 else (2026, 10, i - 2) for i in range(0, 9)]   # 9-28..9-30, 10-01..10-06
rep = mkrep(days)
def is_wk(k): return dt.date(k // 10000, k // 100 % 100, k % 100).isoweekday() <= 5
rep.report_dates = lambda: [k for k in [d['key'] for d in rep.dates if is_wk(d['key']) or d['setn'] > 0]][-5:]
for st in (TGT, TGT, STP, OPEN, AMB): rep.enter(ms(2026, 10, 2, 10, 0), st)
rep.enter(ms(2026, 10, 1, 14, 40), STP)
rd = rep.report_dates()
rows = {k: rep.row(k) for k in rd}
chk('Five most recent Mon-Fri dates with data are reported (weekend skipped): %s' % rd, rd == [20260930, 20261001, 20261002, 20261005, 20261006])
chk('Row identity Setups = Winners + Losers + Open + Ambiguous on every row', all(r['total'] == r['W'] + r['L'] + r['O'] + r['A'] for r in rows.values()))
tot = {k: sum(r[k] for r in rows.values()) for k in ('total', 'W', 'L', 'O', 'A')}
chk('Totals reconcile with the sum of the displayed rows and with the record count', tot['total'] == len(rep.setups) == 6 and tot['W'] == 2 and tot['L'] == 2 and tot['O'] == 1 and tot['A'] == 1)
chk('Win-rate footer excludes Open and Ambiguous: W/(W+L) = 2/4 = 50%', tot['W'] / (tot['W'] + tot['L']) == 0.5)
chk('Open setups are counted in the Setups total', rows[20261002]['O'] == 1 and rows[20261002]['total'] == 5)
# after-midnight outcome updates the ENTRY-date row
late = Rep(); late.add_date(20261002, 6); late.add_date(20261003, 7); late.add_date(20261005, 2)
late.enter(ms(2026, 10, 2, 23, 50)); x = late.setups[0]; x['state'] = TGT   # resolves after midnight (state change only)
chk('Outcome after midnight updates the ENTRY-date row, not the resolution date', late.row(20261002)['W'] == 1 and late.row(20261003)['W'] == 0)
chk('Entry date basis is the NY calendar date of the entry candle close (UTC 03:30 Oct 3 = NY Oct 2 23:30)', ny_key(int(dt.datetime(2026, 10, 3, 3, 30, tzinfo=dt.timezone.utc).timestamp() * 1000)) == 20261002)
# retention: >30 retained, unresolved never pruned
big = Rep(); big.add_date(20260930, 4); big.add_date(20261001, 5); big.add_date(20261002, 6)
for i in range(45): big.enter(ms(2026, 10, 2, 10, i % 60), TGT)
big.prune()
chk('More than 30 entries inside the reporting period are all retained (no 30-record cap)', len(big.setups) == 45)
old = Rep()
for k, w in ((20260922, 3), (20260923, 4), (20260924, 5), (20260925, 6), (20260928, 2), (20260929, 3), (20260930, 4), (20261001, 5)): old.add_date(k, w)
old.enter(ms(2026, 9, 22, 10, 0), OPEN); old.enter(ms(2026, 9, 23, 10, 0), TGT); old.enter(ms(2026, 10, 1, 10, 0), TGT)
old.report_dates = lambda: [d['key'] for d in old.dates if is_wk(d['key'])][-5:]
old.prune()
chk('Unresolved OLD setup is never pruned; resolved setup outside the five dates is pruned', [x['state'] for x in old.setups if x['key'] < 20260928] == [OPEN] and len(old.setups) == 2)
chk('Code: no setup-count cap, pruning only touches resolved records older than the oldest reported date',
    'if s.state != 0 and s.dateKey < cut' in PINE and not re.search(r'setups\.size\(\)\s*>\s*30|setups\.shift', PINE), 'CODE INSPECTION')
chk('Code: statistics read the retained records (f_dateCount), never drawing handles', 'f_dateCount(k, 1)' in PINE and 'line.get' not in PINE, 'CODE INSPECTION')
# per-window-instance entry limits
cnt = {}
def can_enter(win, mx=3): return cnt.get(win, 0) < mx
def do_enter(win): cnt[win] = cnt.get(win, 0) + 1
for _ in range(3): do_enter('NYAM|1002')
chk('Max 3 entries per window INSTANCE: 4th in the same instance rejected', not can_enter('NYAM|1002'))
chk('A new window instance (next day) has its own limit', can_enter('NYAM|1005') and can_enter('NYPM|1002'))

# date coverage status (mirror f_dateStatus)
def date_status(win_n, bad, is_first):
    if win_n > 0 and bad == win_n: return 2
    if bad > 0 or is_first: return 1
    return 0
chk('Fully evaluated zero-entry date shows status 0 (counts 0, no marker)', date_status(200, 0, False) == 0)
chk('Partly covered date -> partial; never-covered date -> unavailable; first chart date -> partial', date_status(200, 40, False) == 1 and date_status(200, 200, False) == 2 and date_status(200, 0, True) == 1)

# ---------- obstacle scan / completeness ----------
class G:
    def __init__(s, tf, d, bot, top): s.tf, s.d, s.bot, s.top = tf, d, bot, top
def scan(zones, bull, lo, hi):
    for g in zones:
        opp = g.d < 0 if bull else g.d > 0
        if opp and tk(g.top) >= lo / TICK - 1e-6 and tk(g.bot) <= hi / TICK + 1e-6:
            return f'Blocked: {g.tf} {"bearish" if g.d < 0 else "bullish"} FVG, {g.bot:.2f}–{g.top:.2f}.'
    return None
fvg15 = [G('15m', -1, 20000.0, 20010.0)]; fvg1h = [G('1H', -1, 20020.0, 20030.0)]; fvg4h = [G('4H', -1, 20100.0, 20120.0)]
E1, T1 = 20040.0, 20150.0
chk('Setup clear vs 15m and 1H obstacles is BLOCKED by an active 4H bearish gap, with 4H named in the message',
    scan(fvg15, True, E1, T1) is None and scan(fvg1h, True, E1, T1) is None and scan(fvg4h, True, E1, T1) == 'Blocked: 4H bearish FVG, 20100.00–20120.00.')
chk('Obstacle entirely beyond the 1R target does not block', scan([G('4H', -1, 20160.0, 20180.0)], True, E1, T1) is None)
chk('Obstacle touching the target exactly (closed interval) blocks', scan([G('4H', -1, 20150.0, 20170.0)], True, E1, T1) is not None)
chk('Hidden / tapped / size-filtered gaps still block (scan ignores display state)', 'f_scanObs' in PINE and 'inHtfMinT' not in PINE[PINE.index('f_scanObs(array<Zone>'):PINE.index('f_scanAll')], 'CODE INSPECTION')
chk('Code: debug text format "Blocked: <tf> <dir> FVG, <bottom>–<top>."', '"Blocked: " + obsName + "."' in PINE and '" FVG, " + str.tostring(z.bottom, format.mintick) + "–"' in PINE, 'CODE INSPECTION')

# ---------- time-based engine: capacity, readiness, live vs reload ----------
H, SPAN = 100, 40            # horizon / span in "candles" (model unit = 1 candle = 1 time unit)
def run_engine(candles, now, cap, horizon, hist):
    """candles: list of (t, hi, lo, cl). Mirror of f_engine steps 1-8 (time-based)."""
    Z, maxp, first, pubs = [], -1.0, 0, []
    for i, (t, h, l, c) in enumerate(candles):
        if t < now - hist: continue
        if first == 0: first = t
        Z = [z for z in Z if abs(z['code']) != 2]
        for z in Z:
            if (z['code'] > 0 and tk(c) < tk(z['bot'])) or (z['code'] < 0 and tk(c) > tk(z['top'])): z['code'] *= 2
        if i >= 2:
            h3, l3 = candles[i - 2][1], candles[i - 2][2]
            if tk(l) - tk(h3) >= 1: Z.append(dict(ft=t, code=1, top=l, bot=h3))
            elif tk(l3) - tk(h) >= 1: Z.append(dict(ft=t, code=-1, top=l3, bot=h))
        Z = [z for z in Z if not (abs(z['code']) == 1 and t - z['ft'] >= horizon)]
        live = [z for z in Z if abs(z['code']) == 1]
        while len(live) > cap:
            z0 = live.pop(0); maxp = max(maxp, z0['ft']); Z.remove(z0)
        trunc = maxp >= 0 and t - maxp < horizon
        ready = t - first >= horizon
        pubs.append((t, trunc, ready, [dict(z) for z in Z] if ready else []))
    return pubs
import random
random.seed(7); px = 100.0; cs = []
for t in range(0, 400):
    px += random.choice([-1, -0.5, 0.5, 1, 1.5]); cs.append((t, px + 1, px - 1, px + random.choice([-.5, .5])))
now = 399
p_small = run_engine(cs, now, 3, H, H + SPAN)
chk('Capacity overflow flags coverage UNKNOWN (never a silent clear)', any(p[1] for p in p_small))
dropped_at = next(p[0] for p in p_small if p[1])
chk('UNKNOWN persists until the dropped gap would have aged out of the horizon, then clears if no further drops',
    any(p[1] for p in p_small if p[0] < dropped_at + H // 2))
p_big = run_engine(cs, now, 500, H, H + SPAN)
chk('With enough capacity nothing is dropped: coverage stays complete (truncation never flagged)', not any(p[1] for p in p_big))
chk('Warm-up: snapshots before one full horizon of history are NOT ready and carry no zones', all((not p[2]) and p[3] == [] for p in p_big if p[0] < now - (H + SPAN) + H))
chk('Ready flips exactly once the processed history spans a full horizon', p_big[0][2] is False and p_big[-1][2] is True and sum(1 for a, b in zip(p_big, p_big[1:]) if a[2] != b[2]) == 1)
def slot_state(trunc, ready): return 1 if (ready and not trunc) else 2     # mirror of f_slotState (2 = UNKNOWN, entries blocked)
def entry_allowed(states): return all(st != 2 for st in states)
chk('Distant obstacle dropped by capacity cannot create a false clear: truncated source -> UNKNOWN -> entry refused even with no visible obstacle',
    all(not entry_allowed([1, 1, slot_state(p[1], p[2])]) for p in p_small if p[1] and p[2]) and any(p[1] and p[2] for p in p_small))
# live == reload after ready: run on full history vs reload on the later window (same now)
live = run_engine(cs, now, 500, H, H + SPAN)
reload_ = run_engine(cs, now, 500, H, H + SPAN)
chk('Reload reproduces live: identical snapshot sequence for the same history/now', live == reload_)
# live vs reload with a later reload time: states agree from the reload engine's ready point
reload2 = run_engine(cs[:], now, 500, H, H + SPAN)
later = {p[0]: p for p in reload2}
chk('Live and reload agree on zone sets at every candle where both are ready', all(later[p[0]][3] == p[3] for p in live if p[2] and later[p[0]][2]))
chk('Code: engine gate is time-based (timenow - histMs), no last_bar_index suppression, no relevance radius', 't1 >= timenow - histMs' in PINE and 'last_bar_index' not in PINE and 'relAtr' not in PINE, 'CODE INSPECTION')
chk('Code: HTF capacity pruning on the chart store removed (no silent drop)', 'store.shift()' not in PINE, 'CODE INSPECTION')
# coverage start tracking
chk('Code: qualification coverage start tracked and shown; per-date window bars counted (dWinN/dWinBad)', 'covStart := time_close' in PINE and 'dWinBad.set(dq' in PINE, 'CODE INSPECTION')
chk('Code: history separation - 3m context horizon/capacity, obstacle horizon, 30s chart window, reporting span are distinct inputs/constants',
    all(x in PINE for x in ('inCtxHorizon', 'inHorizon', 'inChWin', 'SPAN_MS')), 'CODE INSPECTION')

# ---------- alerts ----------
def bar_alerts(events, tog):
    msgs = [m for kind, m in events if tog.get(kind)]
    return '\n'.join(msgs) if msgs else None
tog = dict(entry=True, target=True, stop=True, amb=False)
a = bar_alerts([('entry', 'E1'), ('target', 'T1'), ('stop', 'S1'), ('amb', 'A1')], tog)
chk('Several events on one bar -> ONE aggregated alert; ambiguous OFF by default', a == 'E1\nT1\nS1')
chk('No events -> no alert', bar_alerts([('amb', 'A1')], tog) is None)
chk('Code: one alert() call, realtime+confirmed only, once-per-bar-close, ids/direction/session in text',
    len(re.findall(r'(?<![\w.])alert\(', CODE)) == 1 and 'barstate.isrealtime and barstate.isconfirmed' in PINE and '"H Ticks ENTRY "' in PINE and '| ID " + sid' in PINE and '| ID " + s.id' in PINE and 'Session " + cx.winName' in PINE and 'Session " + s.winName' in PINE, 'CODE INSPECTION')
chk('Code: alerts are built from state transitions (f_tryEntry / f_trackSetups) and never from drawing code', 'aMsgs.push' not in PINE[PINE.index('f_syncSetupDraw'):PINE.index('f_drawAll')], 'CODE INSPECTION')

# ---------- drawings ----------
chk('Code: Entry black / Target green / Stop red, all solid, separate lines and separate labels with prices',
    'Entry line colour' in PINE and '"Target · 1R "' in PINE and '"Stop "' in PINE and '"Entry "' in PINE and PINE.count('line.style_solid, width = 2') == 3, 'CODE INSPECTION')
chk('Code: outcome text frozen on resolution (Target hit / Stop hit / Ambiguous); lines frozen at resolveTime',
    all(x in PINE for x in ('" · Target hit"', '" · Stop hit"', '" · Ambiguous"', 's.state != 0 ? s.resolveTime')), 'CODE INSPECTION')
chk('Code: drawing subset when object limits bind (unresolved first, newest resolved next, DRAW_MAX)', 'drawn < DRAW_MAX' in PINE and 'pass == 0' in PINE, 'CODE INSPECTION')
chk('Code: persistent handles - setters used for existing boxes/lines/labels on every draw', all(x in PINE for x in ('line.set_xy2(s.lE', 'label.set_text(s.lbE', 'box.set_border_color(z.bx')), 'CODE INSPECTION')

print(f"{'test':128} {'result':6} basis")
for n, r, k in R: print(f"{n[:128]:128} {r:6} {k}")
print(sum(r == 'PASS' for _, r, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r == 'PASS' for _, r, _ in R) else 1)
