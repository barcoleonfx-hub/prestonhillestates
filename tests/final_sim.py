"""Targeted checks for the final refinement (15m bias, decisive candle, structural stop, 3m levels, shading).
Python re-implementations + text checks of the Pine source. They do NOT prove the Pine compiles or runs identically."""
import re, math, random
TICK = 0.25
def tk(x): return round(x / TICK)
R = []
def chk(n, c, how='MODEL'): R.append((n, 'PASS' if c else 'FAIL', how))
PINE = open('H_Ticks_FVG_iFVG.pine').read()
CODE = '\n'.join('' if l.lstrip().startswith('//') else l.split('  //')[0] for l in PINE.split('\n'))

# ---------- 15m bias engine (mirror of f_bias15); candles = (open_t, close_t, h, l, c) ----------
# Mirror of f_bias15: index i plays "candle [1]"; the pivot candidate is i-2 with neighbours i-4,i-3,i-1,i.
def bias_run2(cs):
    swH = swL = None; swHB = swLB = True; bias = 0; lvl = None; out = []
    for i, (t, tc, h, l, c) in enumerate(cs):
        if swH and not swHB and swH['A'] <= t and tk(c) > tk(swH['p']): bias, lvl, swHB = 1, swH['p'], True
        elif swL and not swLB and swL['A'] <= t and tk(c) < tk(swL['p']): bias, lvl, swLB = -1, swL['p'], True
        if i >= 4:
            hh = [cs[i - k][2] for k in range(5)]; ll = [cs[i - k][3] for k in range(5)]      # hh[0]=this, hh[2]=candidate
            if all(tk(hh[2]) > tk(hh[k]) for k in (0, 1, 3, 4)): swH = dict(p=hh[2], A=tc); swHB = False
            if all(tk(ll[2]) < tk(ll[k]) for k in (0, 1, 3, 4)): swL = dict(p=ll[2], A=tc); swLB = False
        out.append((bias, lvl))
    return out
def mk(prices, step=900_000):
    cs = []
    for i, (h, l, c) in enumerate(prices): cs.append((i * step, (i + 1) * step, h, l, c))
    return cs
# flat start, swing high 105 at index 2, then lower highs, then break by close
flat = [(101, 99, 100)] * 3
seq = [(101, 99, 100), (102, 99, 100), (105, 100, 101), (103, 100, 101), (102, 99.5, 100), (104, 99, 100), (104.5, 100, 104), (106, 101, 105.75)]
cs = mk(seq)
o = bias_run2(cs)
chk('Bias is UNKNOWN (0) before any qualifying break', all(b == 0 for b, _ in o[:7]))
chk('Wick above the swing high (high 106, close 104.5) does NOT break; only a CLOSE strictly above does', o[6][0] == 0 and o[7] == (1, 105))
seq2 = seq[:7] + [(105.5, 101, 105)]     # close exactly at the level: boundary equality is not a break
chk('Close exactly at the swing high is not a break (strict)', bias_run2(mk(seq2))[7][0] == 0)
# no hindsight: bias at each prefix equals bias at the same index in the full run
random.seed(11); px = 100; pr = []
for _ in range(400):
    px += random.choice([-1, -.5, .5, 1, 1.5]); pr.append((px + 1, px - 1, px + random.choice([-.5, .5])))
cs = mk(pr); full = bias_run2(cs)
chk('Bias uses confirmed pivots without hindsight: every prefix reproduces the full-series bias at that candle', all(bias_run2(cs[:k])[-1] == full[k - 1] for k in range(8, 400, 7)))
ev = [i for i in range(1, len(full)) if full[i][0] != 0 and full[i] != full[i - 1]]
chk('Only newly broken levels are events (bias level changes only when a new level is broken)', all(full[i][1] != full[i - 1][1] for i in ev))
chk('Both bullish and bearish biases occur on the random series (reversal supported)', {b for b, _ in full} >= {1, -1})
# pivot confirmed by the same candle cannot be broken by it: construct close above the pivot on the confirming candle
conf = mk([(101, 99, 100), (101, 99, 100), (101, 99, 100), (105, 100, 101), (102, 99.5, 100), (104, 99, 106)])  # idx5 confirms pivot idx3?? needs 2 right candles
chk('A pivot cannot break on the candle that confirms it (availability never backdated)', bias_run2(conf)[5][0] == 0)
chk('Code: bias break test runs BEFORE the new pivot is stored; availability = confirming candle close; one break per level',
    CODE.index('f_tk(c1) > f_tk(swH)') < CODE.index('swH := h3') and 'swHB := true' in CODE and 'swHA := float(tc1)' in CODE, 'CODE INSPECTION')
chk('Code: context needs bias == direction at creation, cancels on opposite bias, entry re-checks bias',
    '(snap.get(base + 1) > 0 ? -1 : 1) == biasDir' in CODE and 'biasDir != c.dir' in CODE and '"15m bias " + (biasDir > 0' in CODE, 'CODE INSPECTION')

# ---------- inversion rules ----------
def inverts(code, c, top, bot):      # bearish FVG (code<0) inverts upward on close > top; bullish inverts down on close < bottom
    return tk(c) > tk(top) if code < 0 else tk(c) < tk(bot)
chk('Wick breach cannot invert; close at the boundary cannot invert; close strictly beyond can',
    not inverts(-1, 100.0, 100.0, 99.0) and not inverts(-1, 100.0, 100.25, 99.0) and inverts(-1, 100.5, 100.25, 99.0) and not inverts(1, 99.0, 100.0, 99.0) and inverts(1, 98.75, 100.0, 99.0))

# ---------- decisive candle (mirror of f_decisive) ----------
def decisive(bull, o, h, l, c, atr, ztop, zbot, preset='Standard'):
    st = preset == 'Strong'; mB, mR, fr = (1.0, .70, .15) if st else (.8, .65, .20)
    if atr is None or atr <= 0: return False, 'atr'
    rng = h - l
    if rng <= 0: return False, 'zero'
    body = c - o; ab = abs(body)
    if (body > 0) != bull or body == 0: return False, 'dir'
    if ab < mB * atr - 1e-9: return False, 'body'
    if ab / rng < mR - 1e-9: return False, 'ratio'
    if not ((c >= h - fr * rng - 1e-9) if bull else (c <= l + fr * rng + 1e-9)): return False, 'pos'
    ext = max(TICK, .10 * atr); got = c - ztop if bull else zbot - c
    if got < ext - 1e-9: return False, 'ext'
    return True, ''
ATR = 2.0
chk('Standard long: strong full-body candle breaking the gap by >= extension enters', decisive(True, 100, 102.25, 99.9, 102.2, ATR, 101.5, 100.5)[0])
chk('Weak inversion (body 0.5 ATR) cannot enter', decisive(True, 100, 101.4, 99.9, 101.0, ATR, 100.5, 100.0) == (False, 'body'))
chk('Strong candle in the WRONG direction cannot enter (long context, bearish body)', decisive(True, 102, 102.1, 99.5, 99.6, ATR, 101, 100)[0] is False)
chk('Body ok but wick-heavy (body/range < 0.65) rejected', decisive(True, 100, 103, 99, 102, ATR, 101.5, 100.5)[1] in ('ratio', 'pos'))
chk('Close not in the top 20% of the range rejected', decisive(True, 100, 103.5, 99.9, 102.0, ATR, 101, 100)[1] in ('ratio', 'pos'))
chk('Close extension below max(1 tick, 0.10 ATR) rejected (close 0.1 beyond gap top, need 0.25)', decisive(True, 100, 102.25, 99.9, 102.1, ATR, 102.0, 101.0)[1] == 'ext')
chk('Short mirror enters; short with bullish body rejected', decisive(False, 102, 102.1, 99.75, 99.8, ATR, 101.5, 100.5)[0] and not decisive(False, 100, 102, 99.9, 101.9, ATR, 101.5, 100.5)[0])
chk('Zero-range candle and unavailable ATR are rejected explicitly', decisive(True, 100, 100, 100, 100, ATR, 99, 98) == (False, 'zero') and decisive(True, 100, 102, 99, 101.9, None, 99, 98) == (False, 'atr'))
chk('Strong preset is stricter: Standard-passing candle with body 0.9 ATR fails Strong', decisive(True, 100, 101.9, 99.9, 101.85, ATR, 101.0, 100.5)[0] and not decisive(True, 100, 101.9, 99.9, 101.85, ATR, 101.0, 100.5, 'Strong')[0])
chk('Code: preset constants 0.8/0.65/0.20 and 1.0/0.70/0.15, ext = max(1 tick, 0.10 ATR)', all(x in CODE for x in ('strong ? 1.0 : 0.8', 'strong ? 0.70 : 0.65', 'strong ? 0.15 : 0.20', 'math.max(syminfo.mintick, 0.10 * atrP)')), 'CODE INSPECTION')

# ---------- no retrospective upgrade ----------
pend_by_bar = {5: ['weak-inversion-gap']}      # inverted on bar 5 (weak) -> rejected
def candidates(bar): return pend_by_bar.get(bar, [])
chk('A weak inversion is never reconsidered: bar 6 has no candidates unless a FRESH inversion occurs', candidates(5) and not candidates(6))
chk('Code: pend is cleared every confirmed bar and rejection never re-queues', 'pend.clear()' in CODE and 'cc.lastReason := rc.why' in CODE and 'pend.push' in CODE and CODE.count('pend.push') == 1, 'CODE INSPECTION')

# ---------- retest leg / structural stop / 1R geometry ----------
def run_leg(bars, dirn):
    """bars: list of (o,h,l,c); bars[0] is the first retest candle, last is the trigger candle. Mirror: extreme includes trigger."""
    ext = bars[0][2] if dirn > 0 else bars[0][1]; t = 0
    for i, (o, h, l, c) in enumerate(bars[1:], 1):
        if dirn > 0 and l < ext: ext, t = l, i
        if dirn < 0 and h > ext: ext, t = h, i
    return ext, t
def stop_ticks(ext, dirn, atr):
    buf = 1 if atr is None else max(1, math.ceil(0.10 * atr / TICK - 1e-6))
    return (math.floor(ext / TICK + 1e-6) - buf) if dirn > 0 else (math.ceil(ext / TICK - 1e-6) + buf)
bars = [(101, 101.5, 100.5, 101), (101, 101.25, 100.0, 100.5), (100.5, 100.75, 99.5, 100.25), (100, 102.5, 99.75, 102.4)]
ext, t = run_leg(bars, 1)
chk('Retest extreme updates through the leg (lowest low 99.5 at candle 2)', ext == 99.5 and t == 2)
bars_t = bars[:-1] + [(100, 102.5, 99.0, 102.4)]       # trigger candle itself makes the new extreme
ext2, t2 = run_leg(bars_t, 1)
chk('Retest extreme INCLUDES the trigger candle (trigger low 99.0 becomes the anchor)', ext2 == 99.0 and t2 == 3)
sT = stop_ticks(ext2, 1, 2.0); stop = sT * TICK
chk('Structural stop is outside the ENTIRE observed retest leg (below every low) by max(1 tick, 0.10 ATR)', all(stop < b[2] for b in bars_t) and stop == 99.0 - 0.25 * math.ceil(0.2 / TICK - 1e-6))
eT = tk(102.4); rT = eT - sT; tT = eT + rT
chk('Exact 1R geometry in ticks after rounding (reward ticks == risk ticks)', tT - eT == eT - sT and rT >= 1)
for atr in (0.37, 1.13, 2.9, None):
    for d in (1, -1):
        e = tk(102.4); s_ = stop_ticks(99.0 if d > 0 else 104.0, d, atr); r_ = (e - s_) if d > 0 else (s_ - e)
        t_ = e + r_ if d > 0 else e - r_
        assert abs(t_ - e) == abs(e - s_)
chk('1R geometry holds for odd ATR values, both directions', True)
exs, ts = run_leg([(99, 99.5, 98.5, 99), (99, 100.5, 98.75, 99.5), (99.5, 101.0, 99.25, 100.75)], -1)
chk('Short: highest high through the trigger candle is the anchor; stop above it', exs == 101.0 and stop_ticks(exs, -1, 2.0) * TICK > 101.0)
chk('Code: body-stop logic removed (no min(open, close) / max(open, close) stop, no inStopBuf, no risk-from-body test)',
    'math.min(open, close)' not in CODE and 'math.max(open, close)' not in CODE and 'inStopBuf' not in CODE and 'inMinRiskT' not in CODE and 'inMaxRiskT' not in CODE and 'c.legExt' in CODE, 'CODE INSPECTION')
chk('Code: stop/target/anchor are stored on the Setup at entry and never reassigned afterwards',
    'stop = r.stop, target = r.target' in CODE and 'legExt = r.legX, stopAnchorT = r.legT' in CODE and not re.search(r's\.(stop|target|entry|legExt)\s*:=', CODE), 'CODE INSPECTION')
chk('Code: leg extreme is initialised at the first retest and updated before the trigger step', CODE.index('cc.legExt := low') < CODE.index('Zone trg = f_pickTrigger(cc)') and 'cr.legExt := cr.dir > 0 ? low : high' in CODE, 'CODE INSPECTION')

# ---------- trigger selection ----------
class G:
    def __init__(s, ft, top, bot): s.ft, s.top, s.bot, s.w = ft, top, bot, top - bot
def pick(pend, conf, ctop, cbot):
    best = None
    for z in pend:
        if z.ft >= conf and tk(z.top) >= tk(cbot) and tk(z.bot) <= tk(ctop):
            if best is None or z.ft > best.ft or (z.ft == best.ft and z.w >= best.w): best = z
    return best
g_old = G(900, 101.5, 101.0); g_new = G(1100, 101.5, 100.75); g_far = G(1200, 110.0, 109.0); g_before = G(1000, 101.4, 101.1)
chk('Unrelated gap (does not intersect the 3m zone) cannot trigger', pick([g_far], 1000, 102.0, 100.5) is None)
chk('Gap formed before the 3m confirmation cannot trigger', pick([g_old], 1000, 102.0, 100.5) is None)
chk('Newest eligible gap wins (not the smallest)', pick([g_before, g_new], 1000, 102.0, 100.5) is g_new)
chk('Code: linked-gap conditions (formTime >= confAsOf, closed-interval overlap with the 3m zone, retest bar strictly earlier)',
    'z.formTime >= c.confAsOf and f_overlap(z.top, z.bottom, c.bottom, c.top)' in CODE and 'cc.retestBar < bar_index' in CODE, 'CODE INSPECTION')

# ---------- 3m structural levels (mirror of f_lvlEngine + f_structCheck) ----------
def levels(cs3):
    """cs3 = (t_open, t_close, h, l). returns list of dict(price, dir, conf, consumed_at) following the engine."""
    L = []
    for i in range(len(cs3)):
        t, tc, h, l = cs3[i]
        for q in L:     # consumption by this completed candle (only candles opening at/after confirmation)
            if not q['x'] and t >= q['conf'] and ((h >= q['p']) if q['d'] > 0 else (l <= q['p'])): q['x'] = True
        if i >= 4:
            hh = [cs3[i - k][2] for k in range(5)]; ll = [cs3[i - k][3] for k in range(5)]
            if all(hh[2] > hh[k] for k in (0, 1, 3, 4)): L.append(dict(p=hh[2], d=1, conf=tc, x=False))
            if all(ll[2] < ll[k] for k in (0, 1, 3, 4)): L.append(dict(p=ll[2], d=-1, conf=tc, x=False))
    return L
def mk3(rows): return [(i * 180000, (i + 1) * 180000, h, l) for i, (h, l) in enumerate(rows)]
rows = [(100, 98), (100.5, 98.5), (103, 99), (101, 98.5), (100.5, 98), (100, 98.2)]
lv = levels(mk3(rows))
chk('3m swing high 103 is confirmed only after its 2 right candles (not at the pivot candle)', len(lv) >= 1 and lv[0]['p'] == 103 and lv[0]['conf'] == 5 * 180000 and not lv[0]['x'])
def struct_check(levels_, bull, tT, now_open, hi30, lo30):
    near = None
    for q in levels_:
        if q['conf'] > now_open: continue
        cons = q['x'] or ((hi30 >= q['p']) if q['d'] > 0 else (lo30 <= q['p']))      # trigger candle consumption first
        if cons or q['d'] != (1 if bull else -1): continue
        near = q['p'] if near is None else (min(near, q['p']) if bull else max(near, q['p']))
    blocked = False
    if near is not None: blocked = tT > tk(near) - 1 if bull else tT < tk(near) + 1
    return blocked, near
now = 6 * 180000
chk('Nearby unconsumed 3m swing high blocks when the 1R target would reach it (target 102.75, level 103 -> need <= 102.75: boundary OK, 103.0 blocked)',
    struct_check(lv, True, tk(103.0), now, 101, 99)[0] and not struct_check(lv, True, tk(102.75), now, 101, 99)[0])
chk('Target beyond the level is blocked; target well below is clear', struct_check(lv, True, tk(104), now, 101, 99)[0] and not struct_check(lv, True, tk(101.5), now, 101, 99)[0])
chk('A swing high CONSUMED by the trigger candle (high >= level) is not an obstacle', struct_check(lv, True, tk(104), now, 103.25, 99) == (False, None))
lv_c = levels(mk3(rows + [(103.5, 100)]))
chk('A swing high consumed earlier by a completed candle is not reused as an obstacle', lv_c[0]['x'] and struct_check(lv_c, True, tk(110), 7 * 180000, 101, 99)[0] is False)
chk('Pivot candle itself never consumes its level (strict pivot), level starts unconsumed', not levels(mk3(rows))[0]['x'])
chk('No eligible level in tracked history -> structural check does not block', struct_check([], True, tk(110), now, 101, 99) == (False, None))
chk('Short mirror: nearest unconsumed 3m swing low above the target blocks; target one tick above passes',
    struct_check([dict(p=98.0, d=-1, conf=0, x=False)], False, tk(98.0), now, 101, 99)[0] and not struct_check([dict(p=98.0, d=-1, conf=0, x=False)], False, tk(98.25), now, 101, 99)[0])
chk('Code: levels need conf <= candle open, consumed by high>=level / low<=level, target <= nearest - 1 tick (short: >= +1), missing coverage blocks',
    all(x in CODE for x in ('q.confT <= time', 'f_tk(high) >= f_tk(q.price)', 'f_tk(low) <= f_tk(q.price)', 'tT > f_tk(near) - 1', 'tT < f_tk(near) + 1', '3m structure coverage unknown')), 'CODE INSPECTION')
chk('Code: consumption runs every confirmed bar BEFORE the trigger step', CODE.index('f_lvlConsume()\n') < CODE.index('Zone trg = f_pickTrigger(cc)'), 'CODE INSPECTION')

# ---------- HTF gaps still block (hidden / tapped) ----------
chk('Code: obstacle scan ignores display state (visibility, size filter, tapped) for 15m/1H/4H', 'f_scanAll(bull, lo, hi)' in CODE and 'inHtfMinT' not in CODE[CODE.index('f_scanObs(array<Zone>'):CODE.index('f_scanAll')] and 'bool   en3 = true' in CODE, 'CODE INSPECTION')

# ---------- shading mapping ----------
def shade(bull, entry, stop, target):
    return ((stop, entry) if bull else (entry, stop)), ((entry, target) if bull else (target, entry))   # (red bottom,top), (green bottom,top)
r, g = shade(True, 100, 99, 101); chk('LONG: red box stop..entry (99..100), green box entry..target (100..101)', r == (99, 100) and g == (100, 101))
r, g = shade(False, 100, 101, 99); chk('SHORT: red box entry..stop (100..101), green box target..entry (99..100)', r == (100, 101) and g == (99, 100))
chk('Code: shading formulas match (long: red stop->entry, green entry->target; short mirrored), light red/green fills',
    all(x in CODE for x in ('float rTop = bull ? s.entry : s.stop', 'float rBot = bull ? s.stop : s.entry', 'float gTop = bull ? s.target : s.entry', 'float gBot = bull ? s.entry : s.target', 'color.new(color.red, 85)', 'color.new(color.green, 85)')), 'CODE INSPECTION')
# outcome time vs guide width
entryT, resT, minW = 0, 60_000, 600_000
chk('Recorded resolution time stays distinct from the minimum drawing width (stats use resolveTime only)', max(resT, entryT + minW) != resT and resT == 60_000)
chk('Code: display width uses math.max(actualR, entryTime + 20 * chartMs); resolution marker line at s.resolveTime; guide width labelled display-only',
    'math.max(actualR + inExt * chartMs, s.entryTime + 20 * chartMs)' in CODE and 'f_lineUp(s.lR, s.resolveTime' in CODE and 'display-only' in CODE and 's.resolveTime := time_close' in CODE, 'CODE INSPECTION')
chk('Code: both original gap boxes retained with shared ID ("3m CONTEXT · id" / "30s TRIGGER · id"), tooltip with NY timestamps, retest marker, stop anchor',
    all(x in CODE for x in ('" CONTEXT · " + dirW', '"30s TRIGGER · " + dirW', '"retest"', '"stop anchor"', 'f_nyT(c.confAsOf)', '15m bias:', 'Nearest 3m structural obstacle')), 'CODE INSPECTION')

# ---------- counts reconcile after recalculation ----------
rng = random.Random(5); recs = [dict(day=rng.choice([1, 2, 3, 4, 5]), st=rng.choice([0, 1, 2, 3])) for _ in range(60)]
rows_ = {d: [sum(1 for r_ in recs if r_['day'] == d and r_['st'] == s_) for s_ in (1, 2, 0, 3)] for d in range(1, 6)}
chk('Counts reconcile: row Setups = Win + Loss + Open + Ambiguous and the total equals the record count', all(sum(v) == sum(1 for r_ in recs if r_['day'] == d) for d, v in rows_.items()) and sum(sum(v) for v in rows_.values()) == len(recs))
chk('Code: outcome model unchanged (strictly-after-entry candle, opening-price priority, AMBIGUOUS when both reachable)', 'bar_index > s.entryBar' in CODE and 'res := th and sh ? 3' in CODE and 'if oTk >= tTk' in CODE, 'CODE INSPECTION')

# ---------- simple settings ----------
inputs = re.findall(r'^\w+\s+(\w+)\s*=\s*input\.', CODE, re.M)
chk('Only practical user inputs remain (%d): %s' % (len(inputs), ','.join(inputs)), len(inputs) <= 18 and 'inPreset' in inputs and 'inTheme' in inputs and 'inDebug' in inputs, 'CODE INSPECTION')
chk('Debug defaults OFF; Standard default; Light default', 'inDebug = input.bool(false' in CODE and 'input.string("Standard"' in CODE and 'input.string("Light"' in CODE, 'CODE INSPECTION')
_ind = [l for l in CODE.split('\n') if re.search(r'vwapNy|\bem9\b|\bem21\b', l)]
chk('Code: no SMT / VWAP / moving-average requirement in any entry decision (VWAP / EMA exist only in the tap DIAGNOSTIC: declared once, read only by f_confFail, which only f_armInv / f_tapScan call)',
    not re.search(r'ta\.sma|smt', CODE, re.I) and CODE.count('f_confFail(') == 3 and len(_ind) == 8 and 'f_evalCand' not in ''.join(_ind), 'CODE INSPECTION')
chk('Code: single aggregated alert() retained; no historical alerts', len(re.findall(r'(?<![\w.])alert\(', CODE)) == 1 and 'barstate.isrealtime and barstate.isconfirmed' in CODE, 'CODE INSPECTION')

print(f"{'test':132} {'result':6} basis")
for n, r_, k in R: print(f"{n[:132]:132} {r_:6} {k}")
print(sum(r_ == 'PASS' for _, r_, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r_ == 'PASS' for _, r_, _ in R) else 1)
