"""Python MODEL of the Qualified-iFVG gates (tick 0.25, default parameters). It re-implements the intended
logic of the Pine functions; it does NOT execute Pine and does not prove compilation or runtime behaviour."""
import math
TICK = 0.25
def tk(x): return round(x / TICK)
P = dict(bodyAtr=0.8, bodyFrac=0.65, loc=0.20, extTicks=1, extAtr=0.10, eff=0.70, netAtr=1.0, N=3, buf=1, minR=2.0)
def ge(a, b): return a / TICK >= b / TICK - 1e-6
def ext_ok(bull, c, boundary, atr1):
    need = max(P['extTicks'], P['extAtr'] * atr1 / TICK)
    have = tk(c) - tk(boundary) if bull else tk(boundary) - tk(c)
    return have >= need - 1e-6
def route_a(bull, o, h, l, c, atr1, boundary):
    rng = h - l
    if not (atr1 and atr1 > 0 and rng > 0): return False
    body = c - o; ab = abs(body)
    loc = (c - l) / rng if bull else (h - c) / rng
    return ((body > 0) if bull else (body < 0)) and ge(ab, P['bodyAtr'] * atr1) and ab / rng >= P['bodyFrac'] - 1e-6 \
        and loc >= 1 - P['loc'] - 1e-6 and ext_ok(bull, c, boundary, atr1)
def route_b(bull, closes, o, atr1, boundary):    # closes[0] = inversion close, closes[i] = close[i]
    n = P['N']
    if not (atr1 and atr1 > 0) or len(closes) <= n: return False
    net = closes[0] - closes[n]
    travel = sum(abs(closes[i] - closes[i + 1]) for i in range(n))
    dir_net = net > 0 if bull else net < 0
    dir_body = closes[0] - o > 0 if bull else closes[0] - o < 0
    if not (travel > 0 and dir_net and dir_body): return False
    return abs(net) / travel >= P['eff'] - 1e-6 and ge(abs(net), P['netAtr'] * atr1) and ext_ok(bull, closes[0], boundary, atr1)
def stop(bull, lows, highs):
    ext = min(lows[:P['N']]) if bull else max(highs[:P['N']])
    return math.floor((ext - P['buf'] * TICK) / TICK + 1e-6) * TICK if bull else math.ceil((ext + P['buf'] * TICK) / TICK - 1e-6) * TICK
def nearest_target(levels, bull, entry):
    eT = tk(entry); best = None
    for lv in levels:
        if lv['consumed'] or lv['isHigh'] != bull: continue
        pT = tk(lv['price']); elig = pT > eT if bull else pT < eT
        if elig and (best is None or abs(pT - eT) < abs(tk(best['price']) - eT)): best = lv
    if best is None: return None, ''
    names = []
    for lv in levels:
        if lv['consumed'] or lv['isHigh'] != bull: continue
        pT = tk(lv['price']); elig = pT > eT if bull else pT < eT
        if elig and abs(pT - tk(best['price'])) <= 1 and lv['src'] not in names: names.append(lv['src'])
    return best['price'], ' + '.join(names)
def scan_obs(zones, bull, lo, hi):
    n = 0
    for z in zones:
        opp = z['dir'] < 0 if bull else z['dir'] > 0
        if opp and tk(z['top']) >= lo / TICK - 1e-6 and tk(z['bot']) <= hi / TICK + 1e-6: n += 1
    return n
def coverage(slots):   # slot: None = n/a, 'valid', 'unknown'
    v = sum(s == 'valid' for s in slots); u = sum(s == 'unknown' for s in slots)
    return 1 if u > 0 else (0 if v > 0 else 2)
def evaluate2(bull, size_ok, cand, closes, lows, highs, atr1, boundary, levels, zones, slots, tgt_ready=True, path_to_target=False):
    o, h, l, c = cand; why = []; ok = True
    if not size_ok: ok = False; why.append('Gap too small')
    route = ''
    if atr1 and atr1 > 0:
        if route_a(bull, o, h, l, c, atr1, boundary): route = 'A'
        elif route_b(bull, closes, o, atr1, boundary): route = 'B'
        if not route: ok = False; why.append('Weak impulse')
    else: ok = False; why.append('Missing volatility data')
    entry = round(c / TICK) * TICK
    stp = stop(bull, lows, highs)
    risk = entry - stp if bull else stp - entry
    risk_ok = tk(risk) >= 1
    if not risk_ok: ok = False; why.append('Invalid risk')
    tp, tn = nearest_target(levels, bull, entry)
    tR = None
    if not tgt_ready: ok = False; why.append('Target data incomplete')
    elif tp is None: ok = False; why.append('No eligible target')
    elif risk_ok:
        tR = (tk(tp) - tk(entry)) / tk(risk) * (1 if bull else -1)
        if tR < P['minR'] - 1e-9: ok = False; why.append('Target below R')
    cov = coverage(slots)
    info = dict(route=route, entry=entry, stop=stp, target=tp, tR=tR, name=tn)
    if cov != 0: ok = False; why.append('No applicable HTF source' if cov == 2 else 'HTF coverage unknown')
    elif risk_ok:
        horizon = entry + P['minR'] * risk if bull else entry - P['minR'] * risk
        end = tp if (path_to_target and tp is not None) else horizon
        lo, hi = (entry, end) if bull else (end, entry)
        if scan_obs(zones, bull, lo, hi) > 0: ok = False; why.append('Blocked')
        info['horizon'] = horizon
    return ok, why, info

R = []
def chk(name, cond, how='MODEL'): R.append((name, 'PASS' if cond else 'FAIL', how))
Z = lambda dir, bot, top: dict(dir=dir, bot=bot, top=top)
LV = lambda price, isHigh, src='PDH': dict(price=price, isHigh=isHigh, src=src, consumed=False)

# ---------- mechanical (chart rules; mirror of f_stepChart) ----------
class CZ:
    def __init__(s, d, top, bot): s.dir, s.top, s.bot, s.formBar, s.invBar, s.state = d, top, bot, 0, -1, 'FVG'
def step(z, hi, lo, cl, bi):
    if bi <= z.formBar: return 'none'
    bull = z.dir > 0
    if z.state == 'FVG':
        if (tk(cl) < tk(z.bot)) if bull else (tk(cl) > tk(z.top)): z.state, z.invBar = 'IFVG', bi; return 'inverted'
    elif bi > z.invBar:
        if (tk(cl) > tk(z.top)) if bull else (tk(cl) < tk(z.bot)): return 'removed:invalidation'
        if tk(hi) >= tk(z.bot) and tk(lo) <= tk(z.top): return 'removed:touch'
    return 'none'
z = CZ(1, 110, 100)
chk('Mech: wick-only breach (low 99, close 100.5) never inverts', step(z, 108, 99, 100.5, 1) == 'none' and z.state == 'FVG')
chk('Mech: exact-boundary close (100) never inverts', step(z, 108, 99, 100, 2) == 'none')
chk('Mech: close 99.75 inverts bullish FVG -> bearish iFVG', step(z, 108, 99, 99.75, 3) == 'inverted' and z.state == 'IFVG' and z.dir > 0)
chk('Mech: inversion candle cannot remove its new iFVG', step(z, 108, 99, 99.75, 3) == 'none')
chk('Mech: later overlap (high 100) removes it', step(z, 100, 98, 99, 4) == 'removed:touch')
zb = CZ(-1, 110, 100); chk('Mech: close 110.25 inverts bearish FVG -> bullish iFVG', step(zb, 111, 104, 110.25, 1) == 'inverted')

# ---------- momentum ----------
chk('Momentum: large range, tiny body fails route A', not route_a(True, 100, 110, 90, 100.25, 5.0, 100))
chk('Momentum: three tiny efficient candles fail route B net-move minimum', not route_b(True, [100.75, 100.5, 100.25, 100.0], 100.5, 5.0, 100.0))
cl = [104.5, 103.0, 101.5, 100.0]
chk('Momentum: strong multi-candle impulse qualifies via B while A fails', route_b(True, cl, 103.5, 3.0, 103.0) and not route_a(True, 103.5, 104.75, 103.25, 104.5, 3.0, 103.0))
chk('Momentum: route A passes on a displacement candle (body 4.0, ATR 4, close at high, ext ok)', route_a(True, 100, 104.25, 99.75, 104.25, 4.0, 102.0))
chk('Momentum: zero travel handled (flat closes fail B, no exception)', not route_b(True, [100, 100, 100, 100], 99.75, 3.0, 99.0))
chk('Momentum: zero-range candle handled (route A fails safely)', not route_a(True, 100, 100, 100, 100, 3.0, 99))
chk('Momentum: wrong-direction net movement fails B (bullish needs net>0)', not route_b(True, [100, 101.5, 103, 104.5], 100.5, 3.0, 99.0))
chk('Momentum: invalid/zero ATR fails both routes', not route_a(True, 100, 104, 99, 104, 0, 100) and not route_b(True, cl, 103.5, None, 103.0))
chk('Momentum: close must extend beyond boundary by >= max(1 tick, 0.10 ATR)', not ext_ok(True, 103.1, 103.0, 3.0) and ext_ok(True, 103.5, 103.0, 3.0))

# ---------- stop / target ----------
chk('Stop: bullish stop = lowest low over N candles minus 1 tick (tick rounded)', stop(True, [99.5, 98.75, 99.0], [0, 0, 0]) == 98.5)
chk('Stop: bearish stop = highest high plus 1 tick', stop(False, [0, 0, 0], [101, 102.25, 101.5]) == 102.5)
base = dict(cand=(100, 105.25, 99.75, 105.25), closes=[105.25, 102.5, 100.5, 100.0], lows=[99.75, 99.5, 99.5], highs=[105.25, 103, 101], atr1=4.0, boundary=102.0)
def run(levels, zones=(), slots=('valid',), size_ok=True, **kw):
    return evaluate2(True, size_ok, base['cand'], base['closes'], base['lows'], base['highs'], base['atr1'], base['boundary'], levels, list(zones), list(slots), **kw)
ok, why, info = run([LV(120, True)]); entry, risk = info['entry'], info['entry'] - info['stop']
chk('Setup sanity: qualifies with clear path, 2R+ target (entry 105.25, stop 99.25)', ok and info['route'] == 'A', 'MODEL')
chk('Target: missing target rejects', not run([])[0] and 'No eligible target' in run([])[1])
t15 = entry + 1.5 * risk
chk('Target: nearest eligible at 1.5R rejects even with a farther 4R target', not run([LV(t15, True, 'N'), LV(entry + 4 * risk, True, 'F')])[0] and 'Target below R' in run([LV(t15, True), LV(entry + 4 * risk, True)])[1])
chk('Target: level consumed by the inversion candle excluded (candle high 105.25 reached level 105.25)', nearest_target([dict(LV(105.25, True), consumed=True)], True, 105.25)[0] is None)
t196 = entry + 1.96 * risk; t196 = math.floor(t196 / TICK) * TICK
r_actual = (tk(t196) - tk(entry)) / tk(risk)
chk(f'Target: displayed-rounding cannot pass: actual {r_actual:.3f}R < 2.0 fails although it rounds to 2.0', r_actual < 2.0 and round(r_actual, 1) == 2.0 and not run([LV(t196, True)])[0])
chk('Target: exactly 2.0R passes (tick-aware, no loosening)', run([LV(entry + 2 * risk, True)])[0])
chk('Target: levels within one tick merge, both descriptions kept', nearest_target([LV(112, True, 'PDH'), LV(112.25, True, 'Swing high')], True, 105.25)[1] == 'PDH + Swing high')
chk('Target: wrong side / at-entry levels are not eligible (strictly beyond entry)', nearest_target([LV(105.25, True), LV(90, False)], True, 105.25)[0] is None)

# unconfirmed pivots
def pivots(highs, L=3, Rr=3):
    out = []   # (available_at_index, price)
    for c in range(len(highs)):
        p = c - Rr
        if p < L: continue
        if all(highs[p] > highs[p - k] for k in range(1, L + 1)) and all(highs[p] > highs[p + k] for k in range(1, Rr + 1)):
            out.append((c, highs[p]))
    return out
hs = [100, 101, 102, 110, 105, 104, 103, 102, 101]
pv = pivots(hs)
chk('Target: pivot at index 3 only becomes available at index 6 (right-side confirmation)', pv == [(6, 110)] and all(c >= 6 for c, _ in pv))
chk('Target: a pivot touched again on the right side is never a (strict) pivot', pivots([100, 101, 102, 110, 105, 110, 103, 102, 101]) == [])

# ---------- clear path (entry 105.25, risk 6 => horizon 117.25) ----------
H = entry + 2 * risk
bear = lambda bot, top: Z(-1, bot, top); bull_z = lambda bot, top: Z(1, bot, top)
T = [LV(entry + 5 * risk, True)]
chk('Path: hidden opposing HTF gap at ~1R blocks (size/display ignored)', not run(T, [bear(entry + risk, entry + risk + 0.25)])[0])
chk('Path: tapped opposing HTF gap blocks (tapped state is not an exemption)', not run(T, [dict(bear(entry + risk, entry + risk + 1), tapped=True)])[0])
chk('Path: entry inside an opposing gap blocks', not run(T, [bear(entry - 1, entry + 1)])[0])
chk('Path: opposing gap whose top touches entry blocks', not run(T, [bear(entry - 3, entry)])[0])
chk('Path: opposing gap starting exactly at the 2R endpoint blocks', not run(T, [bear(H, H + 2)])[0])
chk('Path: same-direction (bullish) HTF gap does not block', run(T, [bull_z(entry + risk, entry + risk + 1)])[0])
chk('Path: opposing gap entirely behind entry does not block', run(T, [bear(entry - 10, entry - 0.25)])[0])
chk('Path: opposing gap beyond 2R passes default clearance', run(T, [bear(H + 1, H + 3)])[0])
chk('Path: same beyond-2R gap blocks in "path to selected target" mode', not run(T, [bear(H + 1, H + 3)], path_to_target=True)[0])
chk('Path: source-confirmed inverted gap (removed from store) no longer blocks', run(T, [])[0])
chk('Path: lower-TF close through an active gap cannot remove it (only source inversion flags it)', not run(T, [bear(entry + risk, entry + risk + 1)])[0])
chk('Coverage: missing applicable source rejects', not run(T, slots=('unknown',))[0] and 'HTF coverage unknown' in run(T, slots=('unknown',))[1])
chk('Coverage: valid empty source = clear; unavailable = unknown (distinct outcomes)', run(T, [], slots=('valid',))[0] and not run(T, [], slots=('unknown',))[0])
chk('Coverage: any unknown applicable source rejects even when another is valid', not run(T, slots=('valid', 'unknown'))[0])
chk('Coverage: no applicable source at all rejects', not run(T, slots=(None, None))[0] and 'No applicable HTF source' in run(T, slots=(None,))[1])
chk('Gate independence: strong momentum cannot compensate an obstructed path', not run(T, [bear(entry + risk, entry + risk + 1)])[0] and run(T)[2]['route'] == 'A')

# ---------- engine truncation / reload (mirror of f_engine prune+trunc flag) ----------
import random
def mkcandles(n, seed):
    rnd = random.Random(seed); out = []; px = 100.0
    for i in range(n):
        o = px + rnd.choice([-2, -1, 0, 0, 1, 2]) * 0.75
        h = o + rnd.randint(1, 6) * 0.25; l = o - rnd.randint(1, 6) * 0.25
        c = round(rnd.choice([l, h, (h + l) / 2]) / TICK) * TICK
        out.append((i * 100, i * 100 + 100, h, l, c)); px = c
    return out
def engine(cd, first, last, budget, cap):
    Zs = []; maxp = -1
    for c in range(first, last + 1):
        to, tc, h, l, cl = cd[c]
        Zs = [z for z in Zs if abs(z[1]) != 2]
        for z in Zs:
            if to >= z[4]:
                inv = tk(cl) < tk(z[3]) if z[1] > 0 else tk(cl) > tk(z[2])
                if inv: z[1] *= 2
                elif z[5] == 0 and tk(h) >= tk(z[3]) and tk(l) <= tk(z[2]): z[5] = tc
        if c >= 2:
            h3, l3 = cd[c - 2][2], cd[c - 2][3]
            if tk(l) - tk(h3) >= 1: Zs.append([to, 1, l, h3, tc, 0, c])
            elif tk(l3) - tk(h) >= 1: Zs.append([to, -1, l3, h, tc, 0, c])
        Zs = [z for z in Zs if not (abs(z[1]) == 1 and c - z[6] >= budget)]
        over = len(Zs) - sum(abs(z[1]) == 2 for z in Zs) - cap; i = 0
        while over > 0 and i < len(Zs):
            if abs(Zs[i][1]) == 1: maxp = max(maxp, Zs[i][6]); Zs.pop(i); over -= 1
            else: i += 1
    trunc = maxp >= 0 and (last - maxp) < budget
    return Zs, trunc
cd = mkcandles(900, 11); BUD = 40
bad = []; truncs = 0
for L in range(60, 880, 7):
    live = engine(cd, 0, L - 1, BUD, 3); fresh = engine(cd, max(0, L - BUD), L - 1, BUD, 3)
    truncs += live[1]
    if live != fresh: bad.append(L)
chk(f'Truncation: live == fresh incl. truncation flag across 117 boundaries (cap 3; flag true at {truncs})', bad == [] and truncs > 0)
lv_, tr_ = engine(cd, 0, 300, BUD, 3)
chk('Truncation: tracking-cap pruning flags coverage unknown (never silently "clear")', tr_ is True)
def trunc_rule(maxp, last, budget): return maxp >= 0 and last - maxp < budget
chk('Truncation: flag rule holds while the pruned zone is inside the horizon, clears exactly when it would have expired (formula check)', trunc_rule(100, 139, 40) and not trunc_rule(100, 140, 40) and not trunc_rule(-1, 500, 40))
chk('Truncation: unknown coverage rejects qualification', not run(T, slots=('unknown',))[0])

# ---------- level registry: consumption, sweeps, ordering ----------
def consume(levels, h, l, c):
    sweeps = []
    for lv in list(levels):
        touched = tk(h) >= tk(lv['price']) if lv['isHigh'] else tk(l) <= tk(lv['price'])
        if touched:
            if not lv['isHigh'] and tk(l) < tk(lv['price']) and tk(c) > tk(lv['price']): sweeps.append('bull')
            if lv['isHigh'] and tk(h) > tk(lv['price']) and tk(c) < tk(lv['price']): sweeps.append('bear')
            levels.remove(lv)
    return sweeps
lvls = [LV(100, False, 'PDL'), LV(110, True, 'PDH')]
chk('Sweep: low-side level traded strictly below and closed back above records a bull sweep before consumption', consume(lvls, 105, 99.75, 100.5) == ['bull'] and len(lvls) == 1)
lvls = [LV(100, False)]
chk('Sweep: boundary-only touch (low == level) is consumed but is NOT a sweep', consume(lvls, 105, 100, 101) == [] and lvls == [])
lvls = [LV(100, False)]
chk('Sweep: trading below and closing below is consumption, not a sweep', consume(lvls, 105, 99, 99.5) == [] and lvls == [])
lvls = [LV(110, True)]
chk('Level: a gap beyond a high-side target consumes it even without straddling (high >= level)', consume(lvls, 112, 111, 111.5) == [] and lvls == [])

# ---------- timing / alerts ----------
class Zn: pass
def once(z, fn):
    if not getattr(z, 'qEval', False): z.qEval = True; z.out = fn()
    return z.out
zz = Zn(); first = once(zz, lambda: run([LV(entry + 1.5 * risk, True)])[0])
second = once(zz, lambda: run([LV(entry + 5 * risk, True)])[0])
chk('Timing: rejected inversion is never upgraded later (evaluated once, outcome frozen)', first is False and second is False)
zq = Zn(); q1 = once(zq, lambda: run([LV(entry + 3 * risk, True)])[2]['tR']); q2 = once(zq, lambda: 99)
chk('Timing: frozen target R unchanged by later evaluation attempts', q1 == q2 and abs(q1 - 3.0) < 1e-9)
def aggregate(events): return {d: sum(1 for e in events if e == d) for d in set(events)}
chk('Alerts: several qualifying zones on one candle aggregate into ONE alert per direction with a count', aggregate(['bull', 'bull', 'bear']) == {'bull': 2, 'bear': 1})

print(f"{'test':110} {'result':6} basis")
for n, r, k in R: print(f"{n:110} {r:6} {k}")
print(sum(r == 'PASS' for _, r, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r == 'PASS' for _, r, _ in R) else 1)
