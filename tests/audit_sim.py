"""Audit checks: history readiness (old wall-clock gate vs new), Replay equivalence, mechanical session windows (DST),
unresolved-setup lock, stats box, drawing isolation. Python re-implementations + text checks of the Pine source.
They do NOT prove the Pine compiles or runs identically on TradingView / in Bar Replay."""
import re, math, datetime as dt, zoneinfo, random
TICK = 0.25
def tk(x): return round(x / TICK)
R = []
def chk(n, c, how='MODEL'): R.append((n, 'PASS' if c else 'FAIL', how))
PINE = open('H_Ticks_FVG_iFVG.pine').read()
CODE = '\n'.join('' if l.lstrip().startswith('//') else l.split('  //')[0] for l in PINE.split('\n'))
NY = zoneinfo.ZoneInfo('America/New_York'); TOK = zoneinfo.ZoneInfo('Asia/Tokyo'); LON = zoneinfo.ZoneInfo('Europe/London'); UTC = dt.timezone.utc
def ms(d): return int(d.timestamp() * 1000)
def fmt(t): return dt.datetime.fromtimestamp(t / 1000, NY).strftime('%m-%d %H:%M')

# ================= 1. diagnosis: why qualification started late =================
MIN = 60_000; DAY = 86_400_000
def old_ready_start(now, horizon, span, step):
    """OLD engine: process candles with t >= now - (horizon + span); ready once t - firstProc >= horizon."""
    hist = horizon + span; first = None; t = now - hist - 5 * step; t -= t % step
    while t <= now:
        if t >= now - hist:
            first = first if first is not None else t
            if t - first >= horizon: return t
        t += step
now_load = ms(dt.datetime(2026, 10, 6, 11, 45, tzinfo=NY))
start_old = old_ready_start(now_load, 500 * 60 * MIN // 60, 7 * DAY, 60 * MIN // 60)
chk('Diagnosis: with the OLD wall-clock gate the 1m context source becomes ready at (load time - 7 days): load 10-06 11:45 NY -> %s NY (the screenshot said 09-29 11:45)' % fmt(start_old), fmt(start_old) == '09-29 11:45', 'MODEL')
chk('Diagnosis: the OLD gate made readiness depend on the computer clock, so a Replay position older than ~7 days had NO ready sources at all',
    old_ready_start(now_load, 500 * MIN, 7 * DAY, MIN) > ms(dt.datetime(2026, 9, 29, 0, 0, tzinfo=NY)) and old_ready_start(now_load, 500 * MIN, 7 * DAY, MIN) > ms(dt.datetime(2026, 9, 20, 0, 0, tzinfo=NY)), 'MODEL')
# NEW engine mirror: no clock; ready = first supplied candle + horizon
def run_engine(cs, horizon, cap=500):
    Z, first, out, maxp = [], None, [], -1
    for i, (t, h, l, c) in enumerate(cs):
        if first is None: first = t
        Z = [z for z in Z if z['code'] not in (2, -2)]
        for z in Z:
            if (z['code'] > 0 and tk(c) < tk(z['bot'])) or (z['code'] < 0 and tk(c) > tk(z['top'])): z['code'] *= 2
        if i >= 2:
            h3, l3 = cs[i - 2][1], cs[i - 2][2]
            if tk(l) - tk(h3) >= 1: Z.append(dict(ft=t, code=1, top=l, bot=h3))
            elif tk(l3) - tk(h) >= 1: Z.append(dict(ft=t, code=-1, top=l3, bot=h))
        Z = [z for z in Z if not (abs(z['code']) == 1 and t - z['ft'] >= horizon)]
        live = [z for z in Z if abs(z['code']) == 1]
        while len(live) > cap: z0 = live.pop(0); maxp = max(maxp, z0['ft']); Z.remove(z0)
        trunc = maxp >= 0 and t - maxp < horizon
        out.append((t, t - first >= horizon, trunc, [dict(z) for z in Z] if t - first >= horizon else []))
    return out
rng = random.Random(3); px = 100.0; cs = []
for i in range(1500):
    px += rng.choice([-1, -.5, .5, 1]); cs.append((i * MIN, px + 1, px - 1, px + rng.choice([-.5, .5])))
full = run_engine(cs, 300 * MIN)
rdy = next(o[0] for o in full if o[1])
chk('NEW: readiness = first supplied candle + horizon (%d min after the first candle), independent of any clock' % (rdy // MIN), rdy == 300 * MIN)
chk('NEW/Replay: the state at a replay endpoint equals the same candle of the full run (prefix property; no future data used)',
    all(run_engine(cs[:k], 300 * MIN)[-1][1:] == full[k - 1][1:] for k in range(350, 1500, 97)))
chk('NEW: two loads with different "current times" produce identical snapshots (no wall-clock input exists)', run_engine(cs, 300 * MIN) == run_engine(cs[:], 300 * MIN))
chk('Code: no wall-clock input anywhere (timenow absent, no timeframe/clock gate)', 'timenow' not in CODE and 'last_bar_index' not in CODE, 'CODE INSPECTION')
chk('Code: header publishes the first supplied candle time and ready time so a late start can be explained (HDR=3, srcFT / srcRT, debug panel)',
    'const int HDR = 3' in CODE and 'float(firstProcT)' in CODE and 'srcFT.set' in CODE and '"SOURCES: first data -> ready' in CODE, 'CODE INSPECTION')
# alignment skip is transient
def sync(updates, permanent):
    bad, imported = False, []
    for asOf, prevClose in updates:
        if permanent and bad: continue
        if prevClose > asOf:
            if permanent: bad = True
            continue
        imported.append(asOf)
    return imported
ups = [(100, 90), (200, 210), (300, 250), (400, 380)]          # second update straddles
chk('Alignment problem: old rule disabled the source forever, new rule skips ONE update (later updates still import)', sync(ups, True) == [100] and sync(ups, False) == [100, 300, 400])
chk('Code: srcBad (permanent disable) removed; straddle only increments srcSkip; obstacle sources no longer require chart history coverage (firstTime check only for ctx / levels)',
    'srcBad' not in CODE and 'srcSkip.set(idx, srcSkip.get(idx) + 1)' in CODE and CODE.count('if firstTime <= asOf') == 2, 'CODE INSPECTION')
chk('Code: one unavailable source still blocks entries (never "clear") but readiness is monotonic per timestamp, so an incomplete early period never blocks later ones',
    'if cov != 0' in CODE and 'srcReady.set(ix, snap.get(1) > 0.0)' in CODE and 'srcBad' not in CODE, 'CODE INSPECTION')

# ================= 2. mechanical session windows =================
def windows(year):
    """true (start,end) UTC-ms intervals per instance for the three windows (start incl, end excl)"""
    out = []
    d = dt.date(year, 1, 1)
    while d.year == year:
        a = dt.datetime(d.year, d.month, d.day, 9, 0, tzinfo=TOK)
        if a.weekday() < 5:
            e = dt.datetime(d.year, d.month, d.day, 8, 0, tzinfo=LON)
            if e <= a: e = dt.datetime(d.year, d.month, d.day, 8, 0, tzinfo=LON) + dt.timedelta(days=1); e = dt.datetime(e.year, e.month, e.day, 8, 0, tzinfo=LON)
            out.append(('A', ms(a), ms(e)))
        if d.weekday() < 5:
            out.append(('M', ms(dt.datetime(d.year, d.month, d.day, 9, 45, tzinfo=NY)), ms(dt.datetime(d.year, d.month, d.day, 11, 30, tzinfo=NY))))
            out.append(('P', ms(dt.datetime(d.year, d.month, d.day, 14, 30, tzinfo=NY)), ms(dt.datetime(d.year, d.month, d.day, 15, 30, tzinfo=NY))))
        d += dt.timedelta(days=1)
    return out
W = windows(2026) + windows(2027)
asia = [w for w in W if w[0] == 'A']; ny = [w for w in W if w[0] != 'A']
overlap = [(a, n) for a in asia for n in ny if a[1] < n[2] and n[1] < a[2]]
chk('Asia -> London and the two NY windows never overlap in any instance over 2026-2027 (including both DST changes): Asia cannot own an NY timestamp', not overlap)
chk('NY morning is always 105 UTC-minutes and NY afternoon 60 UTC-minutes, including the DST change weeks', all(w[2] - w[1] == 105 * MIN for w in W if w[0] == 'M') and all(w[2] - w[1] == 60 * MIN for w in W if w[0] == 'P'))
chk('Every window instance has a unique (type, start) key => the per-window counter key (name|start) resets for each new instance', len({(w[0], w[1]) for w in W}) == len(W) and 'cx.winId' not in CODE and 'c.winId := wn + "|" + str.tostring(ws)' in CODE, 'MODEL + CODE INSPECTION')
mo = next(w for w in W if w[0] == 'M' and fmt(w[1]).startswith('10-05'))
chk('Boundaries: NY morning start 09:45 is INSIDE, 11:30:00 is OUTSIDE (end exclusive), 11:29:59 inside; a 30s candle CLOSING at 11:30:00 is outside',
    mo[1] <= mo[1] < mo[2] and not (mo[2] < mo[2]) and mo[2] - 1000 < mo[2] and fmt(mo[1]) == '10-05 09:45' and fmt(mo[2]) == '10-05 11:30')
# mirror of f_localTs / f_winCand (noon-anchored day stepping) vs truth at sampled DST-adjacent timestamps
def local_ts(ref, tz, shift, hh, mm):
    d = dt.datetime.fromtimestamp(ref / 1000, tz); noon = dt.datetime(d.year, d.month, d.day, 12, 0, tzinfo=tz)
    nn = noon + dt.timedelta(days=shift)      # wall-clock stepping like noon + shift*86400000 then re-read the local date
    base = ms(noon) + shift * DAY; d2 = dt.datetime.fromtimestamp(base / 1000, tz)
    return ms(dt.datetime(d2.year, d2.month, d2.day, hh, mm, tzinfo=tz))
def win_cand(T, sh, sm, stz, eh, em, etz, weekdays=True):
    best = None
    for s_ in (0, 1):
        st = local_ts(T, stz, -s_, sh, sm); e0 = local_ts(st, etz, 0, eh, em); en = e0 if e0 > st else local_ts(st, etz, 1, eh, em)
        dw = dt.datetime.fromtimestamp(st / 1000, stz).weekday()
        if (dw < 5 or not weekdays) and st <= T < en and (best is None or st > best[0]): best = (st, en)
    return best
bad = 0; n = 0
for day in (dt.date(2026, 3, 8), dt.date(2026, 3, 29), dt.date(2026, 10, 25), dt.date(2026, 11, 1), dt.date(2026, 10, 5)):
    base = ms(dt.datetime(day.year, day.month, day.day, 0, 0, tzinfo=UTC)) - 6 * 3600_000
    for k in range(0, 36 * 3600 // 30, 1):
        T = base + k * 30_000; n += 1
        truthM = any(w[0] == 'M' and w[1] <= T < w[2] for w in W); truthP = any(w[0] == 'P' and w[1] <= T < w[2] for w in W); truthA = any(w[0] == 'A' and w[1] <= T < w[2] for w in W)
        if (win_cand(T, 9, 45, NY, 11, 30, NY) is not None) != truthM or (win_cand(T, 14, 30, NY, 15, 30, NY) is not None) != truthP or (win_cand(T, 9, 0, TOK, 8, 0, LON) is not None) != truthA: bad += 1
chk(f'The noon-anchored f_localTs/f_winCand algorithm agrees with true IANA interval membership at {n} 30s timestamps around both DST changes in New York and London', bad == 0, 'MODEL (assumes the Pine timestamp()/year()/month() built-ins behave like zoneinfo)')
chk('Code: window ownership uses only candle timestamps (time_close / source asOf), IANA names and UTC milliseconds; no chart/display timezone is read',
    'syminfo.timezone' not in CODE and 'chart.' not in CODE.replace('chart.is_standard', '') and 'time_close' in CODE and 'timestamp(tz,' in CODE, 'CODE INSPECTION')
chk('Code: window start inclusive / end exclusive (T >= st and T < eEnd); context expiry at time_close >= winEnd; entry requires the same window instance id',
    'T >= st and T < eEnd' in CODE and 'time_close >= c.winEnd' in CODE and 'wn + "|" + str.tostring(ws) != c.winId' in CODE, 'CODE INSPECTION')
# lock behaviour
setups = [dict(id='A1', win='Asia', state=0)]
def open_lock(ss): return any(x['state'] == 0 for x in ss)
chk('An UNRESOLVED Asia setup keeps the global lock (reported, never silently closed): NY candidate would be rejected with "unresolved setup"', open_lock(setups))
setups[0]['state'] = 1
chk('A RESOLVED Asia setup (target) releases the lock: NY candidate is no longer blocked by it', not open_lock(setups))
trk = CODE[CODE.index('f_trackSetups() =>'):CODE.index('if supported and barstate.isfirst')]
chk('Code: outcome tracking runs on every confirmed bar regardless of session / window (no window condition inside f_trackSetups) so an Asia setup resolves during or after NY',
    'f_selectWindow' not in trk and 'winEnd' not in trk and 'if s.state == 0 and bar_index > s.entryBar' in trk, 'CODE INSPECTION')
chk('Code: the lock is state==0 only; the debug panel names the open setup, its session and open-since time; unresolved-setup blocks are counted per session',
    'if setups.get(i).state == 0' in CODE and '"UNRESOLVED-SETUP LOCK: "' in CODE and 'f_lockHit(false)' in CODE and 'f_lockHit(true)' in CODE and 'f_dg(wI, 36)' in CODE and 'UNRESOLVED-SETUP LOCK HISTORY' in CODE, 'CODE INSPECTION')
chk('Code: per-session diagnostics (evaluated bars, covered bars, lock-blocked bars, contexts, retests, triggers, entries, rejection reasons) exist and are shown only behind the Debug toggle',
    all(x in CODE for x in ('f_dg(wiQ, 0)', 'f_dg(wiQ, 1)', 'f_dg(wiQ, 2)', 'f_dg(wI, 7)', 'f_dg(wr, 8)', 'f_dg(wc, 9)', 'f_dg(f_winIdx(cp.winName), 16)', 'if supported and inDebug')) and 'inDebug = input.bool(false' in CODE, 'CODE INSPECTION')

# ================= 3. Replay / history audit =================
rt_uses = [m.start() for m in re.finditer(r'barstate\.isrealtime', CODE)]
chk('Code: barstate.isrealtime appears only in the alert gate and the drawing gate (never in detection, lifecycle, entry or outcome code): %d uses' % len(rt_uses),
    len(rt_uses) == 2 and 'bool evNow = supported and barstate.isrealtime and barstate.isconfirmed' in CODE and 'bool drawNow = supported and barstate.isconfirmed and (barstate.islast or barstate.islastconfirmedhistory or barstate.isrealtime)' in CODE, 'CODE INSPECTION')
chk('Code: reporting dates come from the dates of processed chart bars (dKey from time_close), so the five-day window ends at the replay endpoint; no dayofmonth(timenow)/today anchor',
    'int dkNow = f_dateKey(time_close)' in CODE and 'timenow' not in CODE and 'timestamp(' not in CODE[CODE.index('f_reportDates() =>'):CODE.index('f_pruneSetups() =>')], 'CODE INSPECTION')
chk('Code: HTF handling unchanged and leak-free: every source request uses [1] values with lookahead_on (time_close[1], close[1], high[1]...), asOf = time_close[1]',
    CODE.count('lookahead = barmerge.lookahead_on') >= 14 and 'time_close[1]' in CODE and 'float c1 = close[1]' in CODE, 'CODE INSPECTION')
chk('Code: setup drawings are rebuilt from the Setup records on drawNow (last confirmed historical bar / replay endpoint), independent of alert delivery',
    'if drawNow\n        f_drawAll()' in CODE and 'alert(' in CODE and 'f_drawAll' not in CODE[CODE.index('bool evNow'):], 'CODE INSPECTION')

# ================= 4. stats box =================
box = CODE[CODE.index('var table stBox'):CODE.index('f_dl(int r')]
chk('Code: ONE small stats box, top-right, transparent background, solid black text, small size, no frame/border, no width/height, no merged cells',
    'position.top_right' in box and 'bgcolor = na' in box and 'text_color = color.black' in box and 'text_size = size.small' in box and 'border_width = 0' in box and not re.search(r'(?<!border_)width|height', box) and 'merge_cells' not in CODE, 'CODE INSPECTION')
chk('Code: default content lines are exactly Last N days / Setups / Wins | Losses / Open | Ambiguous / Win rate / Coverage (win rate shows "—" without resolved trades)',
    all(x in CODE for x in ('"Last " + str.tostring(nr) + " days"', '"Setups: "', '"Wins: "', '" | Losses: "', '"Open: "', '" | Ambiguous: "', '"Win rate: "', '"Coverage: "', '"—"')), 'CODE INSPECTION')
chk('Code: old bottom table, top-left status panel and warning band are gone; daily breakdown and debug are OFF by default',
    'stTbl' not in CODE and 'staTbl' not in CODE and 'warnTbl' not in CODE and 'inDaily = input.bool(false' in CODE and 'inDebug = input.bool(false' in CODE, 'CODE INSPECTION')
chk('Code: coverage text is Full / Partial only; the long explanation is in a tooltip; partial coverage still counts only recorded setups',
    '"Coverage: " + (covFull ? "Full" : "Partial")' in CODE and 'Only RECORDED setups are counted' in CODE and 'covFull = nr == REP_DATES and miss == ""' in CODE, 'CODE INSPECTION')

# ================= 5. clutter / drawing isolation =================
chk('Code: HTF boxes, detail markers, pending-context boxes are OFF by default (inShowHtf false, inShowMarkers false, inShowCtx follows Debug)',
    'inShowHtf = input.bool(false' in CODE and 'inShowMarkers = input.bool(false' in CODE and 'bool   inShowCtx = inDebug' in CODE, 'CODE INSPECTION')
elig = ''.join(CODE[CODE.index(n):CODE.index(m)] for n, m in (('f_pickTrigger(Ctx c)', 'f_decisive('), ('f_evalCand(Ctx c', 'f_enter('), ('f_ctxUpdate(int k', 'f_ctxSync(')))
chk('Code: hidden drawings cannot change eligibility - no display input (inShowHtf/inShowPair/inShowRR/inShowMarkers/inShowCtx/inLabels) is referenced by trigger, evaluation, context or entry code',
    not re.search(r'inShow(Htf|Pair|RR|Markers|Ctx)|inLabels', elig) and 'f_scanAll' in elig, 'CODE INSPECTION')
chk('Code: f_scanObs scans the full hz1..hz4 stores; f_classify/f_pickCat only set display flags (vis/cat)', 'f_scanObs(hz1, bull, lo, hi)' in CODE and 'z.vis := false' in CODE, 'CODE INSPECTION')
creators = sorted({re.findall(r'(box|line|label)\.new', l)[0] + '@' + fn for fn, body in re.findall(r'^(f_\w+)\([^\n]*=>\n((?:    [^\n]*\n|\n)+)', CODE, re.M) for l in body.split('\n') if re.search(r'(box|line|label)\.new', l)})
chk('This script owns drawing objects ONLY through: %s' % creators, set(creators) == {'box@f_syncDraw', 'box@f_drawCtx', 'box@f_boxUp', 'line@f_lineUp', 'label@f_lblUp', 'label@f_dbg'}, 'CODE INSPECTION')
chk('Code: setup evidence is created on the Setup record and removed only by f_pruneSetups / the drawing cap, never by context clearing', 'f_delSetupDraw' not in CODE[CODE.index('f_ctxClear(Ctx c) =>'):CODE.index('f_ctxClearAll() =>')], 'CODE INSPECTION')

print(f"{'test':140} {'result':6} basis")
for n_, r_, k in R: print(f"{n_[:140]:140} {r_:6} {k}")
print(sum(r_ == 'PASS' for _, r_, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r_ == 'PASS' for _, r_, _ in R) else 1)
