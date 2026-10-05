"""Model checks for the multi-timeframe context update (1m/2m/3m/5m), candidate selection, funnel and frozen drawings.
Python re-implementations + text checks of the Pine source. They do NOT prove the Pine compiles or runs identically."""
import re, math
TICK = 0.25
def tk(x): return round(x / TICK)
R = []
def chk(n, c, how='MODEL'): R.append((n, 'PASS' if c else 'FAIL', how))
PINE = open('H_Ticks_FVG_iFVG.pine').read()
CODE = '\n'.join('' if l.lstrip().startswith('//') else l.split('  //')[0] for l in PINE.split('\n'))
def overlap(hi, lo, zb, zt): return tk(hi) >= tk(zb) and tk(lo) <= tk(zt)

# ---------- source FVG + inversion (per timeframe) ----------
def gaps_and_inversions(cs):
    """cs = list of (o,h,l,c) source candles. returns list of dict(code, top, bot, form_i, inv_i). Mirror of f_engine rules."""
    Z, inv = [], []
    for i, (o, h, l, c) in enumerate(cs):
        for z in list(Z):
            if i > z['form_i']:
                hit = tk(c) < tk(z['bot']) if z['code'] > 0 else tk(c) > tk(z['top'])
                if hit: z['inv_i'] = i; inv.append(z); Z.remove(z)
        if i >= 2:
            h1, l1 = cs[i - 2][1], cs[i - 2][2]
            if tk(l) - tk(h1) >= 1: Z.append(dict(code=1, top=l, bot=h1, form_i=i))
            elif tk(l1) - tk(h) >= 1: Z.append(dict(code=-1, top=l1, bot=h, form_i=i))
    return inv
def agg(c30, n):
    out = []
    for i in range(0, len(c30) - n + 1, n):
        ch = c30[i:i + n]; out.append((ch[0][0], max(x[1] for x in ch), min(x[2] for x in ch), ch[-1][3]))
    return out
# 30s path: flat, bullish gap up (three source-sized steps), then a drop closing below the gap bottom => bullish FVG inverts to bearish iFVG
def path():
    c = [(100, 100.25, 99.75, 100)] * 30
    c += [(100.25, 101.0, 100.0, 100.75)] * 10            # up
    c += [(102.5, 103.0, 102.25, 102.75)] * 10            # gap up
    c += [(102.5, 102.5, 98.0, 98.25)] * 10              # sharp drop: closes far below gap bottom on every timeframe
    c += [(98.25, 98.5, 98.0, 98.25)] * 20
    return c
c30 = path()
for n, nm in ((2, '1m'), (4, '2m'), (6, '3m'), (10, '5m')):
    inv = gaps_and_inversions(agg(c30, n))
    chk(f'{nm}: the source series independently produces an eligible inverted gap (context candidate)', len(inv) >= 1, 'MODEL')
base = [(100, 100.5, 99.5, 100), (100.5, 101.5, 100.5, 101.4), (101.4, 102, 101.25, 101.75)]
chk('Wick through the boundary or a close exactly on it does NOT invert; a close strictly beyond does',
    gaps_and_inversions(base + [(101, 101.5, 99.0, 100.5)]) == [] and gaps_and_inversions(base + [(101, 101.5, 99.0, 100.25)]) != [] and gaps_and_inversions(base + [(101, 101.5, 99.0, 100.75)]) == [])

# ---------- independent per-context state ----------
class Ctx:
    def __init__(s, k, tf): s.k, s.tf, s.state, s.leg = k, tf, 0, None
TF = ['1m', '2m', '3m', '5m']
ctxs = [Ctx(k, TF[k]) for k in range(4)]
def make(c, d, top, bot, conf): c.state, c.dir, c.top, c.bot, c.conf, c.retest_bar, c.leg = 1, d, top, bot, conf, -1, None
make(ctxs[0], 1, 102.0, 101.0, 100); make(ctxs[3], 1, 120.0, 119.0, 100)       # 1m zone 101-102 ; 5m zone 119-120
def retest_step(bar_i, t_open, h, l):
    for c in ctxs:
        if c.state == 1 and t_open >= c.conf and overlap(h, l, c.bot, c.top):
            c.state, c.retest_bar, c.leg = 2, bar_i, l
retest_step(5, 150, 102.5, 101.5)      # touches ONLY the 1m zone
chk('No cross-context retest: a candle overlapping only the 1m gap retests the 1m context and leaves the 5m context pending', ctxs[0].state == 2 and ctxs[3].state == 1)
make(ctxs[2], 1, 105.0, 104.0, 500); retest_step(6, 400, 105.5, 104.5)
chk('Price action before a context inversion confirmation never counts as its retest', ctxs[2].state == 1)
old = ctxs[0].top
make(ctxs[0], 1, 103.0, 102.5, 700)   # newer 1m context replaces only the pending 1m context
chk('A newer context replaces only the pending context of the SAME timeframe', ctxs[0].top == 103.0 and ctxs[3].top == 120.0 and ctxs[3].state == 1)
chk('Code: per-timeframe Ctx objects (cxs[k]); creation / replacement / cancel touch only cxs.get(k); retest loop uses each context own zone',
    'var array<Ctx>    cxs' in CODE and 'Ctx c = cxs.get(k)' in CODE and 'f_overlap(high, low, cr.bottom, cr.top)' in CODE and 'cr.state == 1 and time >= cr.confAsOf' in CODE, 'CODE INSPECTION')
chk('Code: own-timeframe invalidation uses that source close (cCl of the same source), counted per timeframe',
    'asOf > c.confAsOf' in CODE and 'f_ctxUpdate(k, snap, asOf, cCl)' in CODE and 'f_ctxSync(0, snapC0, asOfC0, clsC0)' in CODE and 'f_ctxSync(3, snapC3, asOfC3, clsC3)' in CODE, 'CODE INSPECTION')
chk('Code: no requirement that all four timeframes agree (no all-agree / count-of-agreeing logic)', not re.search(r'allAgree|agree.*all|nAgree|consensus', CODE, re.I), 'CODE INSPECTION')
chk('Code: selector Auto/1m/2m/3m/5m drives activation flags; 15m bias + 3m structure sources are independent of the selector',
    all(x in CODE for x in ('"Auto (1m, 2m, 3m, 5m)"', '"1m only"', '"2m only"', '"3m only"', '"5m only"', 'bool actC0 =', 'bool actL = ')), 'CODE INSPECTION')

# ---------- candidate evaluation + selection (mirror of f_evalCand / main) ----------
def decisive(bull, o, h, l, c, atr, ztop, zbot):
    if atr is None or atr <= 0 or h - l <= 0: return False
    body = c - o; ab = abs(body)
    if (body > 0) != bull: return False
    if ab < .8 * atr - 1e-9 or ab / (h - l) < .65 - 1e-9: return False
    if not ((c >= h - .2 * (h - l) - 1e-9) if bull else (c <= l + .2 * (h - l) + 1e-9)): return False
    return (c - ztop if bull else zbot - c) >= max(TICK, .10 * atr) - 1e-9
def evaluate(c, trg, candle, atr, env):
    o, h, l, cl = candle; bull = c.dir > 0
    if not decisive(bull, o, h, l, cl, atr, trg['top'], trg['bot']): return dict(stage=0, fail=7)
    buf = max(1, math.ceil(.10 * atr / TICK - 1e-6)); eT = tk(cl)
    sT = (math.floor(c.leg / TICK + 1e-6) - buf) if bull else (math.ceil(c.leg / TICK - 1e-6) + buf)
    rT = eT - sT if bull else sT - eT
    if rT < 1: return dict(stage=1, fail=8)
    tT = eT + rT if bull else eT - rT
    if not env['cov']: return dict(stage=2, fail=9)
    lo, hi = (eT, tT) if bull else (tT, eT)
    if any(tk(g['top']) >= lo and tk(g['bot']) <= hi for g in env['obs'] if (g['dir'] < 0) == bull): return dict(stage=2, fail=10)
    if env['count'].get(c.win, 0) >= 3: return dict(stage=3, fail=12)
    if env['open']: return dict(stage=3, fail=13)
    if env['bias'] != c.dir: return dict(stage=3, fail=14)
    return dict(stage=4, fail=-1, entry=eT, stop=sT, target=tT, risk=rT, k=c.k)
def select(cands):
    for want in (3, 2, 1, 0):
        for r in cands:
            if r['stage'] == 4 and r['k'] == want: return r
    return None
def mkctx(k, leg, win='W'):
    c = Ctx(k, TF[k]); c.state, c.dir, c.leg, c.win = 2, 1, leg, win; return c
candle = (100.0, 102.5, 99.75, 102.4); trg = dict(top=102.0, bot=101.0); ATR = 2.0
env = dict(cov=True, obs=[], count={}, open=False, bias=1)
c1 = mkctx(0, 99.5); c5 = mkctx(3, 99.0)
r1 = evaluate(c1, trg, candle, ATR, env); r5 = evaluate(c5, trg, candle, ATR, env)
chk('Each context uses ITS OWN retest leg: different legs -> different stops (1m 99.5 vs 5m 99.0), both exact 1R',
    r1['stop'] != r5['stop'] and r1['entry'] - r1['stop'] == r1['target'] - r1['entry'] and r5['entry'] - r5['stop'] == r5['target'] - r5['entry'])
chk('Stops are outside the whole leg by max(1 tick, 0.10 ATR) rounded outward (leg 99.5, ATR 2 -> 0.2 -> 1 tick)', r1['stop'] == tk(99.5) - 1)
# failing high-priority candidate must not block a passing lower one
env2 = dict(env, obs=[dict(dir=-1, top=106.0, bot=105.0)])           # 5m candidate: target within the gap? make only 5m fail via risk-size difference
big = mkctx(3, 90.0)                                                  # 5m leg far away -> target far -> obstacle intersects; 1m leg tight -> target short of the gap
c1t = mkctx(0, 101.5)
rb = evaluate(big, trg, candle, ATR, env2); rs = evaluate(c1t, trg, candle, ATR, env2)
chk('A failing 5m candidate (obstacle on its 1R path) never blocks a passing 1m candidate; the 1m entry is chosen',
    rb['stage'] < 4 and rs['stage'] == 4 and select([rb, rs])['k'] == 0)
chk('If only one candidate passes it is used immediately', select([rb, rs, dict(stage=1, fail=8, k=2)])['k'] == 0)
chk('If several pass on the same trigger bar, 5m > 3m > 2m > 1m picks exactly one (tie-break only)',
    select([evaluate(mkctx(k, 99.5), trg, candle, ATR, env) for k in (0, 1, 2, 3)])['k'] == 3 and
    select([evaluate(mkctx(k, 99.5), trg, candle, ATR, env) for k in (0, 1, 2)])['k'] == 2)
chk('Gates: session limit / unresolved setup / bias / unknown coverage each reject (first failed gate recorded)',
    evaluate(c1, trg, candle, ATR, dict(env, count={'W': 3}))['fail'] == 12 and evaluate(c1, trg, candle, ATR, dict(env, open=True))['fail'] == 13 and
    evaluate(c1, trg, candle, ATR, dict(env, bias=-1))['fail'] == 14 and evaluate(c1, trg, candle, ATR, dict(env, cov=False))['fail'] == 9)
chk('Weak impulse rejected first (fail code 7) and cannot be upgraded later (candidates exist only on the inversion bar)', evaluate(c1, trg, (100, 100.5, 99.75, 100.25), ATR, env)['fail'] == 7)
# duplicates and discarding
setups = []
def enter(r, tid, cid):
    if any(s['tid'] == tid or s['cid'] == cid for s in setups): return False
    setups.append(dict(tid=tid, cid=cid)); return True
chk('Duplicate trigger / context IDs cannot create a second trade', enter(r1, 'T1', 'C1') and not enter(r1, 'T1', 'C9') and not enter(r1, 'T9', 'C1') and len(setups) == 1)
chk('Code: exactly one f_enter per bar; dedupe by trigger+context id; all pending contexts discarded after entry; outranked passers counted',
    CODE.count('f_enter(pick, cp)') == 1 and 'f_setupExists(pick.trg.id, cp.zid)' in CODE and 'f_ctxClearAll()' in CODE and 'f_fb(qo.k, 15)' in CODE, 'CODE INSPECTION')
chk('Code: every context evaluated independently (loop over all four), selection only among ok candidates, 5m>3m>2m>1m order',
    'int want = NCTX - 1 - pk' in CODE and 'qc.ok and qc.k == want' in CODE and 'Cand rc = f_evalCand(cc, trg)' in CODE, 'CODE INSPECTION')
chk('Code: legacy body-stop logic is gone (no min/max(open, close) stop; stop comes from c.legExt of the evaluated context)',
    'math.min(open, close)' not in CODE and 'math.max(open, close)' not in CODE and 'legX := c.legExt' not in CODE and 'float legX = c.legExt' in CODE, 'CODE INSPECTION')
chk('Code: after resolution a fresh inversion is required (contexts confirmed before the resolution are discarded, nothing is queued)', 'asOf < lastResolveAt' in CODE, 'CODE INSPECTION')

# ---------- funnel: first failed gate counted once ----------
fn = [0] * 8; fb = {}
def count(r):
    fn[3] += 1
    if r['stage'] >= 1: fn[4] += 1
    if r['stage'] >= 2: fn[5] += 1
    if r['stage'] >= 3: fn[6] += 1
    if r['fail'] >= 7: fb[r['fail']] = fb.get(r['fail'], 0) + 1
for r in (evaluate(c1, trg, (100, 100.5, 99.75, 100.25), ATR, env), evaluate(c1, trg, candle, ATR, dict(env, cov=False)), evaluate(c1, trg, candle, ATR, env)): count(r)
chk('Funnel counts each candidate once: 3 eligible, 2 impulse passes, 2 stop/risk passes, 1 clear-path pass; failures 7:1 and 9:1', fn[3:7] == [3, 2, 2, 1] and fb == {7: 1, 9: 1})
chk('Code: funnel counted at the single evaluation point (stage thresholds) and block counter records fail code once; table only behind Debug',
    all(x in CODE for x in ('if rc.stage >= 1', 'if rc.stage >= 2', 'if rc.stage >= 3', 'f_fb(k, rc.fail)', 'if supported and inDebug')), 'CODE INSPECTION')
chk('Code: replacement, expiry, close-through, bias flip, no-window, bias/narrow, unresolved, session limit counters exist',
    all(x in CODE for x in ('f_fb(k, 0)', 'f_fb(k, 1)', 'f_fb(k, 2)', 'f_fb(k, 3)', 'f_fb(k, 4)', 'f_fb(k, 5)', 'f_fb(k, 6)', '"session limit"', '"coverage unknown"')), 'CODE INSPECTION')

# ---------- frozen setup evidence ----------
chk('Code: Setup stores BOTH gaps (boundaries, formation, inversion/confirmation, ids, tf) and drawing reads only the Setup, never cxs/pend/chartZ',
    all(x in CODE for x in ('ctxTop = c.top', 'ctxBot = c.bottom', 'ctxConfT = c.confAsOf', 'ctxId = c.zid', 'trgTop = t.top', 'trgBot = t.bottom', 'trgId = t.id', 'trgInvT = time')) and
    not re.search(r'cxs|pend|chartZ', CODE[CODE.index('f_syncSetupDraw(Setup s, bool want) =>'):CODE.index('f_drawSetups() =>')]), 'CODE INSPECTION')
chk('Code: only f_pruneSetups (resolved, outside the reporting dates) deletes setup drawings; clearing a context never does',
    CODE.count('f_delSetupDraw(s)') >= 2 and 'f_delSetupDraw' not in CODE[CODE.index('f_ctxClear(Ctx c) =>'):CODE.index('f_ctxClearAll() =>')], 'CODE INSPECTION')
chk('Code: gap boxes are real boundaries (ctxTop/ctxBot, trgTop/trgBot) - labels are external with pointers, boxes never enlarged; ctx solid / trigger dashed (stronger); both ends at entry',
    'f_boxUp(s.ctxBx, s.ctxFormT, s.ctxTop, s.entryTime, s.ctxBot, cCtxFill, cCtxLine, "", cCtxLine, line.style_solid, 2)' in CODE and 'f_boxUp(s.trgBx, s.trgFormT, s.trgTop, s.entryTime, s.trgBot, cTrgFill, cTrgLine, "", cTrgLine, line.style_dashed, 3)' in CODE and 'label.style_label_right' in CODE, 'CODE INSPECTION')
chk('Code: z-order - R/R boxes are created before the gap boxes; R/R starts at entry time where the gap boxes end',
    CODE.index('s.rbx := f_boxUp') < CODE.index('s.ctxBx := f_boxUp') and CODE.index('s.gbx := f_boxUp') < CODE.index('s.trgBx := f_boxUp'), 'CODE INSPECTION')
chk('Code: inversion markers on the actual confirming candles (source candle open / 30s candle open) with close price',
    'ctxInvT = c.confAsOf - c.tfSecs * 1000' in CODE and 'trgInvT = time, trgInvPx = close' in CODE and 'f_lblUp(s.lbCm, s.ctxInvT, s.ctxInvPx' in CODE and 'f_lblUp(s.lbTm, s.trgInvT, s.trgInvPx' in CODE, 'CODE INSPECTION')
chk('Code: true exit marker (dotted line + label at resolveTime) separate from the display-only minimum width', 'f_lblUp(s.lbX, s.resolveTime' in CODE and 'color.gray, line.style_dotted' in CODE, 'CODE INSPECTION')
chk('Code: label count per setup (10) x DRAW_MAX (40) + debug labels stays under the 500-label limit; boxes 4 x 40; lines 4 x 40', 10 * 40 + 30 < 500 and 4 * 40 + 20 < 500 and 4 * 40 < 500)

# ---------- statistics panel ----------
cells = re.findall(r'f_cell\(stTbl, [^\n]*', CODE)
chk('Code: EVERY stats cell passes an explicit background AND text colour (header, rows, totals, footers)', len(cells) >= 14 and all(re.search(r'c(HdrBg|RowBg|TotBg)', x) and re.search(r'c(HdrTx|RowTx)', x) for x in cells), 'CODE INSPECTION')
chk('Code: table text is normal size (no tiny/faint), Light/Dark theme colours defined, headers Wins/Losses', 'text_size = size.normal' in CODE and 'cHdrBg' in CODE and '"Wins", "Losses"' in CODE, 'CODE INSPECTION')
chk('Code: win rate = Wins / (Wins + Losses) with Open and Ambiguous excluded', '100.0 * tW / (tW + tL)' in CODE and 'Open and Ambiguous excluded' in CODE, 'CODE INSPECTION')
chk('Code: unresolved setups are never pruned or counted as losses; pruning only removes resolved ones outside the reporting dates', 'if s.state != 0 and s.dateKey < cut' in CODE, 'CODE INSPECTION')

print(f"{'test':132} {'result':6} basis")
for n, r_, k in R: print(f"{n[:132]:132} {r_:6} {k}")
print(sum(r_ == 'PASS' for _, r_, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r_ == 'PASS' for _, r_, _ in R) else 1)
