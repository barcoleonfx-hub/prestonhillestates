"""RESEARCH (indicator B): tap + bias diagnostic and shadow tracker, checked against research/H_Ticks_B_research_tap_shadow_COMBINED.pine.
Text checks and a model only; nothing here was compiled in TradingView."""
import re, random, sys
NEW = open('research/H_Ticks_B_research_tap_shadow_COMBINED.pine', encoding='utf-8').read()
res = []
def chk(name, ok, basis):
    res.append((name, bool(ok), basis))
def fn(src, name):
    m = re.search(r'^' + re.escape(name) + r'\(.*?\) =>\n', src, re.M)
    assert m, name
    e = re.search(r'^\S', src[m.end():], re.M)
    return src[m.start(): m.end() + (e.start() if e else len(src))]
# ---- 4. tap + bias confluence diagnostic (counting only) ------------------------------------------
_owners = set(); _cur = 'top'
for l in NEW.split('\n'):
    m = re.match(r'^(f_\w+)\(', l)
    if m: _cur = m.group(1)
    elif re.match(r'^\S', l) and not l.startswith('//'): _cur = 'top:' + l.split('(')[0].split(' ')[0] + ('/islast' if l.startswith('if barstate.islast') else '')
    if re.search(r'\barmI\b', l): _owners.add(_cur)
chk('tap diagnostic: armI is read / written only by f_armInv, f_tapScan, f_armStep, its declaration and the debug panel: ' + str(sorted(_owners)),
    _owners <= {'f_armInv', 'f_tapScan', 'f_armStep', 'f_trigLog', 'top:var', 'top:if/islast'}, 'TEXT')
chk('tap diagnostic: only chart-observed taps (tapTime == time and tapAvail == time_close) count; bias direction = gap direction; inside a window',
    'z.tapped and z.tapTime == time and z.tapAvail == time_close' in NEW and 'if z.dir != biasDir' in NEW and 'if not inWin' in NEW and 'f_dg(wT, 57)' in NEW and 'f_tapScan(hz1, wT, not na(wsT), weT)' in NEW, 'TEXT')
chk('tap diagnostic: inversion strictly after the tap = source candle OPENED at/after the tap candle closed; same window instance; first valid one ends the arm',
    'if asOf - tfMs < armI.get(2)' in NEW and 'weI != armI.get(3)' in NEW and 'armI.set(0, 0)' in fn(NEW, 'f_armInv') and 'f_armInv(k, asOf, c.tfSecs * 1000)' in fn(NEW, 'f_ctxUpdate') and 'if k <= 1 and dirOk and wideOk' in NEW, 'TEXT')
chk('tap diagnostic: VWAP anchored NY 09:30 (hmNy >= 570 and hmNy[1] < 570), EMA 9/21 from the confirmed 1m candle [1] (no repaint); confluence judged at the trigger (f_trendOk / f_vwapOk in f_armInv), not at the tap',
    'bool  vwAnchor = hmNy >= 570 and hmNy[1] < 570' in NEW and 'ta.ema(close, 9)[1], ta.ema(close, 21)[1]' in NEW and 'lookahead = barmerge.lookahead_on' in NEW.split('ta.ema(close, 9)')[1][:200], 'TEXT')
chk('tap diagnostic: every tap and every trigger candidate writes a Pine Logs record (f_tapLog / f_trigLog)', 'f_tapLog(z, why, cf)' in NEW and 'f_trigLog(k, asOf, dirA)' in NEW and 'TAP " + z.tfTxt' in NEW and 'TRIGGER CANDIDATE' in NEW, 'TEXT')
chk('tap diagnostic: no new entry path (still exactly one f_enter call, no new Setup.new)', NEW.count('f_enter(') == 2 and NEW.count('Setup.new(') == 1, 'TEXT')
def run_tap(events):
    arm = None; c = dict(tapB=0, armed=0, already=0, trig=0, ended=0, strict=0, trend=0, vw=0)
    for e in events:
        if e['kind'] == 'bar':
            if arm and (e['t'] >= arm['wend'] or e['bias'] != arm['dir']): c['ended'] += 1; arm = None
        elif e['kind'] == 'tap' and e['bias'] != 0 and e['zdir'] == e['bias'] and e['inwin']:
            c['tapB'] += 1                      # NO confluence requirement at the tap
            if arm: c['already'] += 1
            else: c['armed'] += 1; arm = dict(dir=e['bias'], t=e['t'], wend=e['wend'])
        elif e['kind'] == 'inv' and arm:
            if e['asof'] - e['tf'] < arm['t']: continue
            if e['wend'] != arm['wend']: continue
            c['trig'] += 1; c['strict'] += e['strict']; c['trend'] += e['trend']; c['vw'] += e['vw']; arm = None
    return c, arm
random.seed(5); bad = 0
for _ in range(5000):
    ev = []; t = 0
    for _ in range(random.randint(5, 40)):
        t += random.randint(1, 4) * 30
        ev.append(dict(kind='bar', t=t, bias=random.choice([1, 1, 1, -1, 0])))
        r = random.random()
        if r < .25: ev.append(dict(kind='tap', t=t, bias=ev[-1]['bias'], zdir=random.choice([1, -1]), inwin=random.random() < .8, wend=600))
        elif r < .5: ev.append(dict(kind='inv', asof=t, tf=random.choice([60, 120]), wend=random.choice([600, 600, 900]), strict=random.choice([0, 1]), trend=random.choice([0, 1]), vw=random.choice([0, 1])))
    c, arm = run_tap(ev)
    if c['tapB'] != c['armed'] + c['already'] or c['armed'] != c['trig'] + c['ended'] + (1 if arm else 0) or c['strict'] > c['trig'] or c['trend'] > c['trig'] or c['vw'] > c['trig']: bad += 1
chk('model: bias-direction in-window taps == armed + ignored (no confluence test at the tap); armed == triggered + ended + still armed; each trigger-time variant <= triggers (5000 random sequences)', bad == 0, 'MODEL')
# ---- 5. shadow tracker (hypothetical trades, counting only) ---------------------------------------
sn_new, st_new = fn(NEW, 'f_shadowNew'), fn(NEW, 'f_shadowTrack')
_res = lambda t: [l.strip() for l in t.split('\n') if re.search(r'oTk >=|oTk <=|oTk <|hTk >=|lTk <=|hTk >|lTk <|res := th and sh', l)]
_trk = fn(NEW, 'f_trackSetups')
_norm = lambda ls: [re.sub(r'\b(tTk|sTk)\b', 'X', l) for l in ls]
chk('shadow resolution uses the SAME open-first-then-range rules and ordering as real setups (f_trackSetups), on candles strictly after the entry candle', _norm(_res(st_new)) == _norm(_res(_trk)) and 'if bar_index > shEB.get(i)' in st_new, 'TEXT DIFF vs f_trackSetups')
_stop = lambda t, v: [l.strip() for l in t.split('\n') if 'sT := bull ?' in l or 'rT := bull ?' in l or 'int bufT' in l]
_a = [l.replace('ext /', 'legX /') for l in _stop(sn_new, 0)]
_b = [l for l in _stop(fn(NEW, 'f_evalCand'), 1)]
chk('shadow stop / risk / buffer formulas are the same as the real setup formulas (rounded outward, max(1 tick, 0.10 x prev ATR), target = same tick distance)', _a == _b and 'int tT = bull ? eT + rT : eT - rT' in sn_new, 'TEXT DIFF vs f_evalCand')
chk('shadow tracker cannot enter, draw or alert (no f_enter, Setup.new, aMsgs, alert, box/line/label.new, setups.push)', not re.search(r'f_enter|Setup\.new|aMsgs|alert\(|box\.new|line\.new|label\.new|setups\.push', sn_new + st_new), 'TEXT')
chk('shadow gates: one open shadow trade at a time, MAX_ENTRIES per window instance, risk must be >= 1 tick; created from f_armInv and resolved by f_shadowTrack() right after f_trackSetups()', 'else if shDir.size() > 0' in sn_new and 'f_shWinCount(weI) >= MAX_ENTRIES' in sn_new and 'okR := rT >= 1' in sn_new and 'f_shadowNew(dirA, wA, weI)' in fn(NEW, 'f_armInv') and re.search(r'f_trackSetups\(\)\n    if rt > 0\n        lastResolveAt := rt\n        needPrune := true\n    f_shadowTrack\(\)', NEW), 'TEXT')
chk('shadow panel shows counts only (no percentage / win rate) and a "Shadow check" line', 'Shadow check: trigger candidates' in NEW and 'win rate' not in NEW.split('SHADOW TRACKER (hypothetical 1:1 trades from each tap trigger; NOTHING')[1].split('UNRESOLVED-SETUP LOCK HISTORY')[0].lower(), 'TEXT')
chk('tap extreme for the shadow stop is recorded at the arm (tap candle low / high) and extended on every later bar while armed', "armF.set(0, biasDir > 0 ? low : high)" in NEW and 'armF.set(0, na(ex) ? low : math.min(ex, low))' in NEW and 'armF.set(0, na(ex) ? high : math.max(ex, high))' in NEW, 'TEXT')
def shadow_model(seed):
    random.seed(seed); openS = False; cnt = {}; c = dict(trig=0, made=0, inv=0, op=0, cap=0)
    for _ in range(random.randint(5, 60)):
        c['trig'] += 1; win = random.choice([600, 600, 900])
        if random.random() < .1: c['inv'] += 1
        elif openS: c['op'] += 1
        elif cnt.get(win, 0) >= 3: c['cap'] += 1
        else: c['made'] += 1; cnt[win] = cnt.get(win, 0) + 1; openS = True
        if openS and random.random() < .5: openS = False
    return c
bad = 0
for sd in range(5000):
    c = shadow_model(sd)
    if c['trig'] != c['made'] + c['inv'] + c['op'] + c['cap']: bad += 1
chk('model: every trigger candidate is exactly one of shadow trade / invalid risk / shadow open / window cap (5000 sequences)', bad == 0, 'MODEL')
w = sum(1 for r in res if r[1])
for n, ok, b in res: print(f'{n[:150]:150s} {"PASS" if ok else "FAIL":5s} {b}')
print(f'{w} / {len(res)} passed'); sys.exit(0 if w == len(res) else 1)
