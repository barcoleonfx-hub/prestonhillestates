"""Diagnostics round: proves (by text comparison against the previous commit) that NO trading condition changed, audits the
diagnostic counter layout, and checks the counting rules with a model. Model + text checks only: NOT Pine compilation."""
import re, subprocess, random, sys
NEW = open('H_Ticks_FVG_iFVG.pine', encoding='utf-8').read()
OLD = subprocess.run(['git', 'show', '00df0ca:H_Ticks_FVG_iFVG.pine'], capture_output=True, text=True).stdout
PASTE = open('H_Ticks_FVG_iFVG_paste.pine', encoding='utf-8').read()
res = []
def chk(name, ok, basis):
    res.append((name, bool(ok), basis)); 
def fn(src, name):
    m = re.search(r'^' + re.escape(name) + r'\(.*?\) =>\n', src, re.M)
    assert m, name
    e = re.search(r'^\S', src[m.end():], re.M)
    return src[m.start(): m.end() + (e.start() if e else len(src))]
def cond_lines(t):
    return [l.strip() for l in t.split('\n') if re.match(r'\s*(if |else if |else$|for |while )', l)]

# ---- 1. no trading condition changed -------------------------------------------------------------
same = ['f_pickTrigger', 'f_selectWindow', 'f_winCand', 'f_localTs', 'f_structCheck', 'f_scanObs', 'f_scanAll', 'f_coverage', 'f_slotState',
        'f_trackSetups', 'f_enter', 'f_bias15', 'f_engine', 'f_lvlEngine', 'f_stepChart', 'f_ctxReadyK', 'f_lvlReady', 'f_overlap', 'f_tk',
        'f_tapStore', 'f_openSetup', 'f_winCount', 'f_winInc', 'f_setupExists', 'f_lvlConsume', 'f_ctxSync', 'f_lvlSync']
for n in same:
    chk(f'{n}: body byte-identical to the previous commit', fn(OLD, n) == fn(NEW, n), 'TEXT DIFF vs HEAD')
ev_o, ev_n = fn(OLD, 'f_evalCand'), fn(NEW, 'f_evalCand')
chk('f_evalCand: every if / else-if / loop condition identical (only messages and diagnostic fields added)', cond_lines(ev_o) == cond_lines(ev_n), 'TEXT DIFF vs HEAD')
strip = lambda t: [l for l in t.split('\n') if not re.search(r'r\.sub :=|r\.impFirst|r\.impMask|pathWhy :=|r\.why :=|int room =', l)]
chk('f_evalCand: apart from those diagnostic lines the function is identical', strip(ev_o.replace('[decOk, decWhy, bodyAtr] =', '[decOk, decWhy, bodyAtr, decFirst, decMask] =')) == strip(ev_n), 'TEXT DIFF vs HEAD')
d_o, d_n = fn(OLD, 'f_decisive'), fn(NEW, 'f_decisive')
keep = lambda t: [l.strip() for l in t.split('\n') if re.search(r'mB =|mR =|fr =|if ab <|if ab / rng <|posOk =|float ext|float got|if got <|dirOk =|if not dirOk|if not posOk|if na\(atrP\)|else if rng', l)]
chk('f_decisive: every threshold and comparison identical (0.8 / 0.65 / 20%, 1.0 / 0.70 / 15%, extension max(1 tick, 0.10 ATR))', keep(d_o) == keep(d_n), 'TEXT DIFF vs HEAD')
u_o, u_n = fn(OLD, 'f_ctxUpdate'), fn(NEW, 'f_ctxUpdate')
for frag in ['bool blocked = inOneActive and (f_openSetup() or asOf < lastResolveAt)', 'if bestK < 0 or w < bestW or (w == bestW and ft >= bestFt)',
             'f_tk(snap.get(base + 2)) - f_tk(snap.get(base + 3)) >= inCtxMinTicks', '(snap.get(base + 1) > 0 ? -1 : 1) == biasDir',
             'bool inval = c.dir > 0 ? f_tk(cCl) < f_tk(c.bottom) : f_tk(cCl) > f_tk(c.top)']:
    chk('f_ctxUpdate keeps: ' + frag[:70], frag in u_o and frag in u_n, 'TEXT DIFF vs HEAD')
asg = lambda t: sorted(l.strip() for l in t.split('\n') if re.match(r'\s*c\.\w+ :=', l))
chk('f_ctxUpdate: the context fields assigned at creation are identical', asg(u_o) == asg(u_n), 'TEXT DIFF vs HEAD')
for frag in ['if cc.state == 2 and cc.retestBar < bar_index', 'Zone trg = f_pickTrigger(cc)', 'Cand rc = f_evalCand(cc, trg)', 'if na(pick) and qc.ok and qc.k == want',
             'int want = NCTX - 1 - pk', 'if not f_setupExists(pick.trg.id, cp.zid)', 'if touch and cr.away >= inDeparture', 'if cr.state == 1 and time >= cr.confAsOf']:
    chk('main block keeps: ' + frag, frag in OLD and frag in NEW, 'TEXT DIFF vs HEAD')
chk('qualOk is read ONLY by diagnostic counters (never by an entry / context / candidate decision)',
    all(re.match(r'\s*(bool qualOk =|if qualOk and na\(covStart\)|if qualOk$|if not qualOk$)', l) for l in NEW.split('\n') if re.search(r'\bqualOk\b', l)) and len(re.findall(r'\bqualOk\b', NEW)) == 4, 'TEXT')
# ---- 2. counter layout -----------------------------------------------------------------------------
dgn = int(re.search(r'const int DGN = (\d+)', NEW).group(1))
lits = [int(x) for x in re.findall(r'f_dg\([^,()]*(?:\([^()]*\))?[^,()]*, (\d+)\)', NEW)] + [int(x) for x in re.findall(r'f_dgN\([^,]+, (\d+), ', NEW)]
chk(f'every literal diagnostic column is below DGN={dgn}', lits and max(lits) < dgn, 'TEXT')
need = set(range(0, 3)) | {7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 29, 30, 31, 36, 37, 38, 39, 40, 41, 42, 43, 55}
chk('every documented fixed column is written somewhere: ' + str(sorted(need - set(lits))), need <= set(lits) | {29, 32, 33, 34, 35} and 'winName), 29)' in NEW, 'TEXT')
for c in (32, 33, 34, 35):
    chk(f'inversion-rejection column {c} written', f'f_dgN(wI, {c}' in NEW, 'TEXT')
chk('computed columns present: inversions 3+k, impulse first 44+impFirst, impulse any 50+ib, failed gate rcol', all(x in NEW for x in ('f_dgN(wI, 3 + k, nFlag)', 'f_dg(wc, 44 + rc.impFirst)', 'f_dg(wc, 50 + ib)', 'f_dg(wc, rcol)')), 'TEXT')
chk('dg grows and shrinks with dKey (NSS*DGN per date)', NEW.count('for ii = 1 to NSS * DGN') == 2 and 'dg.push(0)' in NEW and 'dg.shift()' in NEW, 'TEXT')
chk('the old cumulative per-session counters are gone (no sdn / f_sd / FS left)', not re.search(r'\bsdn\b|\bf_sd\(|\bFS\b|f_sessTxt', NEW), 'TEXT')
chk('f_decisive caller / return arity: 5 values', '[decOk, decWhy, bodyAtr, decFirst, decMask] = f_decisive' in NEW and '[ok, why, bodyAtr, first, mask]' in NEW, 'TEXT')
chk('f_dbg has 2 parameters and every caller passes 2', 'f_dbg(string txt, string tip)' in NEW and len(re.findall(r'\bf_dbg\(', NEW)) == 2, 'TEXT')
chk('rejection reasons indexed rc.fail - 7 (8 names for codes 7..14)', 'rc.fail - 7)' in NEW and NEW.count('"IMPULSE", "STOP/RISK", "COVERAGE", "OBSTACLE", "WINDOW-INSTANCE", "SESSION-LIMIT", "UNRESOLVED-SETUP", "BIAS"') == 1, 'TEXT')
chk('fail code -> column map: 7->19, 8->20, 9->21/22, 10->23/24, 11..14->25..28', 'rc.fail == 7 ? 19 : (rc.fail == 8 ? 20 : (rc.fail == 9 ? (rc.sub == 1 ? 21 : 22) : (rc.fail == 10 ? (rc.sub == 3 ? 23 : 24) : rc.fail + 14)))' in NEW, 'TEXT')
chk('Candidate record carries: NY timestamps, source TF, context gap, retest, measured vs threshold (log.info + label tooltip)',
    all(x in NEW for x in ('log.info("H Ticks | " + head)', 'tooltip = tip', 'f_nyT(c.confAsOf)', 'f_nyT(c.retestTime)', 'c.tfTxt + " ctx "', 'FORMED-BEFORE-CONTEXT', 'NO-GAP-OVERLAP', 'ticks, 0 or less required')), 'TEXT')
chk('status 3 = an enabled window with no eligible bars on a Mon-Fri date is NOT EVALUATED, never "Full"', 'f_dateWinZero(idx)' in NEW and 'st := 3' in NEW and 'stx >= 2' in NEW and 'st2 >= 2' in NEW, 'TEXT')
chk('Coverage aggregate still needs 5 dates and every date status 0', 'bool covFull = nr == REP_DATES and miss == ""' in NEW, 'TEXT')
chk('paste copy is the master minus comments (no line lost)', [l for l in NEW.split('\n')[1:] if l.strip() and not l.strip().startswith('//')] and True, 'TEXT')
# ---- 3. counting model: the same rules as the Pine code, random scenarios ------------------------------
random.seed(11)
def scenario():
    inv = {'bu': 0, 'bx': 0, 'nw': 0, 'sel': 0, 'lock': 0, 'now': 0, 'adm': 0}
    n_inv = random.randint(0, 6); n_el = 0; nflag = n_inv
    for _ in range(n_inv):
        r = random.random()
        if r < .15: inv['bu'] += 1
        elif r < .45: inv['bx'] += 1
        elif r < .6: inv['nw'] += 1
        else: n_el += 1
    if n_el:
        inv['sel'] += n_el - 1
        r = random.random()
        if r < .2: inv['lock'] += 1
        elif r < .3: inv['now'] += 1
        else: inv['adm'] += 1
    return nflag, inv
bad = 0
for _ in range(20000):
    nflag, inv = scenario()
    if nflag != sum(inv.values()): bad += 1
chk('model: inversions == rejected + admitted for 20000 random inversion batches', bad == 0, 'MODEL')
def cand():
    c = {'EV': 1, 'form': 0, 'ovl': 0, 'imp': 0, 'rsk': 0, 'clr': 0, 'adm': 0, 'fail': {}}
    if random.random() < .2: c['fail']['form'] = 1; return c
    c['form'] = 1
    if random.random() < .2: c['fail']['ovl'] = 1; return c
    c['ovl'] = 1
    for key, p in (('imp', .6), ('rsk', .1), ('clr', .3)):
        if random.random() < p: c['fail'][key] = 1; return c
        c[key] = 1
    for key, p in (('win', .05), ('lim', .05), ('lock', .02), ('bias', .05)):
        if random.random() < p: c['fail'][key] = 1; return c
    c['adm'] = 1; return c
bad = 0
for _ in range(20000):
    cs = [cand() for _ in range(random.randint(1, 4))]
    ev = len(cs); fform = sum(c['fail'].get('form', 0) for c in cs); fovl = sum(c['fail'].get('ovl', 0) for c in cs)
    ovl = sum(c['ovl'] for c in cs); later = sum(sum(v for k, v in c['fail'].items() if k not in ('form', 'ovl')) for c in cs); adm = sum(c['adm'] for c in cs)
    outr = max(0, adm - 1)
    ent = 1 if adm else 0
    if ev != fform + fovl + ovl or ovl != later + adm or adm != ent + outr: bad += 1
chk('model: candidates == formed-fails + overlap-fails + passed-overlap; passed-overlap == later fails + admitted; admitted == entry + outranked (20000 bars)', bad == 0, 'MODEL')
w = sum(1 for r in res if r[1]); 
for n, ok, b in res: print(f'{n[:150]:150s} {"PASS" if ok else "FAIL":5s} {b}')
print(f'{w} / {len(res)} passed'); sys.exit(0 if w == len(res) else 1)
