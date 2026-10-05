# Verification for indicator C ("H Ticks - 10AM Precision Model C"): (1) TEXT checks on the Pine source, (2) scenario tests on tests/c_model.py,
# a Python port of the same decision logic. NOTHING HERE COMPILES OR RUNS THE PINE SCRIPT; it does not prove TradingView behaviour.
import re, sys, os, copy, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, os.path.dirname(__file__))
import c_model as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = open(os.path.join(ROOT, 'H_Ticks_C_10AM_Precision.pine'), encoding='utf-8').read()
OLD = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'c_before_precision.pine'), encoding='utf-8').read() if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'c_before_precision.pine')) else None
CODE = '\n'.join(l for l in SRC.split('\n') if not l.strip().startswith('//'))
res = []
def chk(name, ok):
    res.append(bool(ok)); print(f'{name[:128]:128s} {"PASS" if ok else "FAIL"}')

NYZ = ZoneInfo('America/New_York')
def T(y, mo, d, hh, mm):
    return int(dt.datetime(y, mo, d, hh, mm, tzinfo=NYZ).timestamp() * 1000)

def fn_text(src, name):
    m = re.search(r'^' + re.escape(name) + r'\(.*?\) =>\n', src, re.M)
    e = re.search(r'^\S', src[m.end():], re.M)
    return src[m.start(): m.end() + (e.start() if e else len(src))]

# =============================================== 1. TEXT CHECKS ===============================================
defs = set(re.findall(r'^(f_\w+)\(', CODE, re.M)); calls = set(re.findall(r'\b(f_\w+)\(', CODE))
chk('every called f_ function is defined', not (calls - defs))
chk('no unused helper functions', not [d for d in defs if len(re.findall(r'\b' + d + r'\(', CODE)) < 2])
chk('indicator (not a strategy), exact title', 'indicator("H Ticks — Powell Model C"' in SRC and 'strategy(' not in CODE)
chk('all time logic uses America/New_York; no timenow / wall-clock', 'const string TZ = "America/New_York"' in SRC and 'timenow' not in CODE)
chk('1-minute standard candles only, warning otherwise', 'timeframe.multiplier == 1' in CODE and 'chart.is_standard' in CODE and 'needs STANDARD 1-MINUTE candles' in CODE)
chk('only one request.* call: the optional SMT peer on the SAME 1m timeframe (no HTF request, no lookahead); HTF candles are self-aggregated', CODE.count('request.') == 1 and 'request.security(inSmt != "Off" ? inSmtSym : syminfo.tickerid, "1"' in CODE and 'lookahead' not in CODE)
chk('state changes only on confirmed bars', 'barstate.isconfirmed' in CODE and 'if supported and cfgAll and barstate.isconfirmed' in CODE)
chk('alerts only on confirmed realtime bars', 'barstate.isrealtime and aMsgs.size() > 0' in CODE and 'alert.freq_once_per_bar_close' in CODE)
# shared setup / precision timing
chk('open captured only when the 10:00 candle is processed (at its close); missing 10am candle -> ineligible', 'if m != openT' in CODE and 'missing 10am candle' in CODE)
chk('ATR frozen from the last candle before the open', 'if m < openT\n        dy.atrPre := atrV' in CODE)
chk('reversal counted only on candles AFTER the manipulation candle', 'if dy.st == 2 and bar_index > dy.qBar' in CODE)
chk('models never step on the confirmation candle', 'if bar_index > dy.confBar\n            f_cReject(dy)' in CODE)
chk('orders fill only on candles after the arming candle (Standard and Precision)', 'if bar_index > md.armBar\n                if md.slot == 4' in CODE)
chk('Precision starts idle: it can only wait after f_confirm initialises it (no pre-confirmation signal)', 'mp.st := 1' in CODE and 'if slotOn.get(4)\n            Mdl mp = dy.ms.get(4)' in CODE and 'f_waitP(dy, md)' in CODE)
chk('pivot becomes known only on the right-side candle close; judged AFTER the candle is evaluated', fn_text(CODE, 'f_waitP').index('f_precTrig') < fn_text(CODE, 'f_waitP').index('f_pivotUpdate') and 'dy.pvKn := bar_index' in CODE and 'bar_index > dy.pvKn' in CODE)
chk('pivot candle must be formed after the reversal confirmation', 'bufI.get(c) > dy.confBar' in CODE)
chk('pivot is consumed once exceeded', 'dy.pvDead := true' in CODE and 'not dy.pvDead' in CODE)
chk('trigger wick frozen only from the closed candle (judged inside the candle-close step)', 'md.tT := time' in CODE and 'md.tHi := high' in CODE and 'md.tBase :=' in CODE)
chk('zero-range candles rejected', 'if rng > 0' in fn_text(CODE, 'f_precTrig'))
chk('Precision stop = trigger candle extreme +/- buffer; cap rejects, never compresses', 'md.tLo - inPBuf * tk' in CODE and 'md.tHi + inPBuf * tk' in CODE and 'riskT > inPStopCap' in CODE and 'stop not compressed' in CODE)
chk('minimum R is checked on the rounded entry / stop / target', 'math.abs(tgtR - entry) / dist' in CODE and 'pR < inMinR' in CODE)
chk('nearest eligible target only; no farther substitution', 'math.min(c1, c2)' in CODE and 'math.max(c1, c2)' in CODE and 'No eligible liquidity target' in CODE)
chk('targets must be unswept (post-open extremes / extremes since the previous 16:00)', 'not (dy.poHi > dy.orH)' in CODE and 'not (sHi > dy.pdH)' in CODE and 'not (dy.poLo < dy.orL)' in CODE and 'not (sLo < dy.pdL)' in CODE)
chk('target frozen at arming (stored on the model, never recomputed)', 'md.tgt := tgtR' in CODE and 'md.tgt :=' not in fn_text(CODE, 'f_posStep'))
chk('precision pending order cancel rules: expiry and target-before-entry only; NO silent cancellation on a gap (flagged gap event instead)', all(x in fn_text(CODE, 'f_fillStepP') for x in ('inPExp', 'target was reached before the entry')) and 'local stop level breached' not in fn_text(CODE, 'f_fillStepP') and 'gap through entry AND stop' in fn_text(CODE, 'f_fillTry'))
chk('Fixed-R target is a separate labelled mode', 'inPTgt == "Fixed R"' in CODE and '"fixed-R"' in CODE)
chk('retries are not implemented (documented)', 'Precision retries are NOT implemented' in CODE)
chk('whole-contract sizing only (int contracts, floor)', 'int inQty = input.int' in CODE and 'math.floor(inCashRisk' in CODE)
chk('both variants stay independent: separate slot, funnel, trades and statistics per slot', 'const int NS = 9' in CODE and 't.slot == slot' in CODE and 'slotNm' in CODE)
chk('only the selected variant raises alerts', 'if slot == selSlot' in CODE and 'int selSlot = isCx ? (selVar == 1 ? 6 : 5) : (selVar == 1 ? 4 : stdSel)' in CODE)
chk('STD / PREC labels, pending vs filled vs cancelled styles', all(x in CODE for x in ('"STD"', '"PREC"', 'PENDING', 'FILLED', 'CANCELLED', 'line.style_dashed', 'line.style_dotted')))
chk('expired / unfilled orders create no Trade (trades are pushed only at fill)', len(re.findall(r'trades\.push\(', CODE)) == 2 and 'trades.push(t)' in fn_text(CODE, 'f_fillTry') and 'trades.push(t)' in fn_text(CODE, 'f_cxFillTry'))
chk('standard entry models A/B/C/C-wick still present (mapped into Standard)', all(x in CODE for x in ('f_waitB', 'f_waitC', 'f_cReject', 'A: plain retest', 'B: retest + iFVG', 'C: Fib overlap + rejection', 'Rejection wick (experimental)')))
chk('f_newDay creates exactly NS models (the runtime error RE10045 on array.get index 4)', len(re.findall(r'Mdl\.new\(slot = \d\)', fn_text(CODE, 'f_newDay'))) == int(re.search(r'const int NS = (\d+)', CODE).group(1)))
chk('paste file exists (size reported, TradingView limit NOT verified)', os.path.exists(os.path.join(ROOT, 'H_Ticks_C_10AM_Precision_paste.pine')))
if OLD:
    for f in ['f_posStep', 'f_waitB', 'f_waitC', 'f_cReject', 'f_exceeded', 'f_fibLvl', 'f_invalidate', 'f_cond']:
        chk(f'Standard {f} byte-identical to the pre-Precision version', fn_text(OLD, f) == fn_text(SRC, f))
    chk('Legacy f_fillStep no longer invalidates before a gap: it delegates to f_fillTry (execution-safety correction)', 'f_fillTry(dy, md)' in fn_text(SRC, 'f_fillStep') and 'invalidated: the candle opened beyond' not in fn_text(SRC, 'f_fillStep'))

# =============================================== 2. SCENARIOS ===============================================
from c_helpers import bar, mkday, run, tr_of, col, FIX
NEXT = lambda y, mo, d: mkday(y, mo, d, start=(9, 0), end=(9, 5))   # a following day so the previous day is finalized

# S1: plain retest A, short. 10:03 (confirmation candle) already touches the 10am open at 20002 -> no fill that candle.
S1 = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20002, 20014), (10, 2): (20014, 20016, 19995, 19996),
      (10, 3): (19996, 20002, 19985, 19990), (10, 4): (19990, 20001, 19989, 19998), (10, 5): (19998, 19999, 19980, 19982)}
e = run(mkday(2026, 3, 4, S1), **FIX)
tr = tr_of(e, 0)
chk('S1 A: exactly one trade; fill NOT on the confirmation candle (10:03), but on 10:04', len(tr) == 1 and tr[0].fillT == T(2026, 3, 4, 10, 4))
chk('S1 A: entry 20000, stop beyond the frozen extreme +2 ticks, target exactly 1R', tr and tr[0].entryPx == 20000 and tr[0].stopPx == 20016.5 and tr[0].tgtPx == 19983.5)
chk('S1 A: outcome target, net R = +1 (zero costs)', tr and tr[0].outcome == 1 and abs(tr[0].netR - 1.0) < 1e-9)
d = e.days[0]
chk('S1: manipulation qualified on 10:01; confirmation on 10:03 (two closes after the manipulation candle)', d.qBar != d.confBar and d.confT == T(2026, 3, 4, 10, 4) and d.mExt == 20016)
chk('S1: funnel eligible=1 qualified=1 reversals=1 armed=1 filled=1', [col(e, 0, c) for c in (0, 1, 3, 5, 6)] == [1, 1, 1, 1, 1])
# S10: manipulation and reversal cannot share a candle
S10 = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20020, 19990, 19995)}
e = run(mkday(2026, 3, 4, S10), **FIX); d = e.days[0]
chk('S10: a candle that spikes AND closes through the open qualifies but never confirms itself (cnt starts next candle)', d.st in (2, 7) and d.confBar == -1)
# S11: both thresholds crossed on the first candle
S11 = {(10, 0): (20000, 20016, 19984, 20000)}
e = run(mkday(2026, 3, 4, S11), **FIX)
chk('S11: ambiguous first candle skipped by default and counted', e.cv[6] == 1 and col(e, 0, 1) == 0)
e = run(mkday(2026, 3, 4, S11), thr_mode='Fixed points', ambInit='Use larger excursion')
chk('S11b: option "use larger excursion" proceeds', col(e, 0, 1) == 1)
# S2: stop-cap rejection (the stop is not squeezed)
S2 = copy.deepcopy(S1); S2[(10, 1)] = (20003, 20030, 20002, 20014)
e = run(mkday(2026, 3, 4, S2), **FIX)
chk('S2: structural stop wider than 80 ticks -> rejected, no trade, no compression', len(e.trades) == 0 and col(e, 0, 8) == 1)
# S3: unfilled order cancelled at the cutoff; excluded from trades
S3 = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20002, 20014), (10, 2): (20014, 20016, 19995, 19996), (10, 3): (19996, 19999, 19985, 19990)}
for mnt in range(4, 46): S3[(10, mnt)] = (19990, 19995, 19985, 19990)
e = run(mkday(2026, 3, 4, S3), **FIX)
chk('S3: untouched limit is cancelled at 10:45, counted as unfilled, creates no trade', len(e.trades) == 0 and col(e, 0, 7) == 1 and col(e, 0, 6) == 0)
# S4: time exit at the 11:00 candle open
S4 = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20002, 20014), (10, 2): (20014, 20016, 19995, 19996), (10, 3): (19996, 19999, 19985, 19990), (10, 4): (19990, 20001, 19989, 19998)}
for mnt in range(5, 60): S4[(10, mnt)] = (19998, 19999, 19990, 19996)
S4[(11, 0)] = (19993, 19999, 19990, 19995)
e = run(mkday(2026, 3, 4, S4), **FIX); tr = tr_of(e, 0)
chk('S4: remaining position closed at the 11:00 candle OPEN and reported as a time exit', len(tr) == 1 and tr[0].outcome == 3 and tr[0].exitPx == 19993 and tr[0].exitT == T(2026, 3, 4, 11, 0))
# S5: ambiguous later candle -> conservative loss, flagged
S5 = copy.deepcopy(S1); S5[(10, 5)] = (19998, 20017, 19980, 19990)
e = run(mkday(2026, 3, 4, S5), **FIX); tr = tr_of(e, 0)
chk('S5: later candle containing stop AND target = AMBIGUOUS, treated as the stop (net R -1), counted separately', tr and tr[0].outcome == 4 and abs(tr[0].netR + 1.0) < 1e-9 and col(e, 0, 10) == 1)
# S5b: ambiguity on the fill candle
S5b = copy.deepcopy(S1); S5b[(10, 4)] = (19990, 20017, 19983, 19998)
e = run(mkday(2026, 3, 4, S5b), **FIX); tr = tr_of(e, 0)
chk('S5b: fill candle with stop and target both reachable = ambiguous loss; excursions flagged uncertain', tr and tr[0].outcome == 4 and tr[0].excUnc)
# S6: gap through the stop
S6 = copy.deepcopy(S1); S6[(10, 5)] = (20020, 20022, 20018, 20019)
e = run(mkday(2026, 3, 4, S6), **FIX); tr = tr_of(e, 0)
chk('S6: gap through the stop exits at the open (worse than 1R)', tr and tr[0].outcome == 2 and tr[0].exitPx == 20020 and tr[0].netR < -1.0)
# S12: no price improvement on a favourable gap through the target
S12 = copy.deepcopy(S1); S12[(10, 5)] = (19970, 19975, 19968, 19972)
e = run(mkday(2026, 3, 4, S12), **FIX); tr = tr_of(e, 0)
chk('S12: gap through the target fills AT the target (no improvement credited)', tr and tr[0].outcome == 1 and tr[0].exitPx == 19983.5)
# S7: missing 10am candle; S8: warm-up; S-partial
e = run(mkday(2026, 3, 4, S1, skip=((10, 0),)) + NEXT(2026, 3, 5), **FIX)
chk('S7: missing 10am candle -> day INELIGIBLE (status 2), not "no setup", not eligible', e.cv[3] == 1 and col(e, 0, 0) == 0 and len(e.trades) == 0)
e = run(mkday(2026, 3, 4, S1, start=(9, 55)) + NEXT(2026, 3, 5), thr_mode='ATR')
chk('S8: insufficient ATR warm-up -> INELIGIBLE (status 3) in ATR mode', e.cv[4] == 1 and col(e, 0, 0) == 0)
e = run(mkday(2026, 3, 4, S1, skip=((10, 20), (10, 21))) + NEXT(2026, 3, 5), **FIX)
chk('S9: missing candles inside 10:00-11:00 -> partial coverage is flagged (never silently complete)', e.cv[2] == 1 and e.cv[1] == 0)
# DST: same 10:00 NY open in winter (EST) and summer (EDT)
ew = run(mkday(2026, 3, 6, S1), **FIX); es = run(mkday(2026, 3, 9, S1), **FIX)
offw = dt.datetime(2026, 3, 6, 10, 0, tzinfo=NYZ).utcoffset(); offs = dt.datetime(2026, 3, 9, 10, 0, tzinfo=NYZ).utcoffset()
chk('DST: UTC offsets differ (winter vs summer) yet the same NY 10:00 open is captured and the same trade results', offw != offs and ew.days[0].oT == T(2026, 3, 6, 10, 0) and es.days[0].oT == T(2026, 3, 9, 10, 0) and len(ew.trades) == len(es.trades) == 1 and ew.trades[0].netR == es.trades[0].netR)
# ATR threshold frozen BEFORE the open (the manipulation cannot inflate it)
big = {(10, 0): (20000, 20003, 19998, 20001), (10, 1): (20001, 20300, 19990, 20150)}
e = run(mkday(2026, 3, 4, big, fill=20.0), thr_mode='ATR')
d = e.days[0]
chk('ATR mode: threshold = 0.5 x ATR frozen from the last candle before 10:00 (a huge manipulation does not change it)', d.thr is not None and abs(d.thr - 0.5 * d.atrPre) < 1e-9 and d.atrPre < 45)
# determinism / reload
a = run(mkday(2026, 3, 4, S1), **FIX); b = run(mkday(2026, 3, 4, S1), **FIX)
sig = lambda eng: [(t.slot, t.fillT, t.exitT, t.entryPx, t.stopPx, t.tgtPx, t.outcome, round(t.netR, 9)) for t in eng.trades]
chk('Reload: identical data produces identical signals and trades', sig(a) == sig(b) and a.fnl == b.fnl)

# ---- Model B and C, independence
S1b = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20003, 20014), (10, 2): (20014, 20016, 20010, 20012),
       (10, 3): (20012, 20013, 19990, 19995), (10, 4): (19995, 20002, 19988, 19992), (10, 5): (19992, 20001, 19990, 19993), (10, 6): (19993, 19994, 19975, 19978)}
SC = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20003, 20014), (10, 2): (20014, 20016, 19990, 19995),
      (10, 3): (19995, 19998, 19950, 19960), (10, 4): (19960, 19970, 19955, 19965), (10, 5): (19994, 20000.5, 19990, 19992),
      (10, 6): (19992, 20000, 19985, 19990), (10, 7): (19990, 19995, 19950, 19955)}
eB = run(mkday(2026, 3, 4, S1b), model='B', **FIX)
chk('B: frozen bullish FVG inverted before the confirmation -> order armed at the confirmation, filled later', col(eB, 1, 5) == 1 and len(tr_of(eB, 1)) == 1 and tr_of(eB, 1)[0].fillT > eB.days[0].confT - 60000)
eC = run(mkday(2026, 3, 4, SC), model='C', **FIX)
dC = eC.days[0]
chk('C: the 10am open lies inside the frozen 61.8-79% zone; anchors frozen (extreme 20015, lowest low 19950)', dC.fibOk and dC.mExt == 20016 and dC.oppX == 19950)
chk('C: precision limit = wick midpoint, armed only after the rejection candle closed; no fill on that candle', col(eC, 2, 5) == 1 and (not tr_of(eC, 2) or tr_of(eC, 2)[0].fillT > dC.rejT))
eAll = run(mkday(2026, 3, 4, S1b), compare=True, **FIX)
eA1 = run(mkday(2026, 3, 4, S1b), model='A', **FIX); eB1 = run(mkday(2026, 3, 4, S1b), model='B', **FIX)
same = lambda x, y: [(t.fillT, t.exitT, t.outcome, t.netR) for t in x] == [(t.fillT, t.exitT, t.outcome, t.netR) for t in y]
chk('Independent models: compare mode gives each slot exactly its stand-alone result (A and B)', same(tr_of(eAll, 0), tr_of(eA1, 0)) and same(tr_of(eAll, 1), tr_of(eB1, 1)) and eAll.fnl[0:15] == eA1.fnl[0:15] and eAll.fnl[15:30] == eB1.fnl[15:30])

# ---- Precision
def prec_day(extra=None, orLow=19970.0, **kw):
    spec = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20002, 20014), (10, 2): (20014, 20016, 19995, 19996),
            (10, 3): (19996, 19998, 19985, 19990), (10, 4): (19990, 19996, 19988, 19992),
            (10, 5): (19994, 20000.5, 19992, 19993), (10, 6): (19994, 19998, 19990, 19992), (10, 7): (19992, 19994, 19969.5, 19972)}
    if extra: spec.update(extra)
    return run(mkday(2026, 3, 4, spec, orLow=orLow), variant='Precision', **{**FIX, **kw})
e = prec_day(); d = e.days[0]; md = d.ms[4]; trp = tr_of(e, 4)
chk('PREC: confirmation on 10:03; no precision order before it', d.confT == T(2026, 3, 4, 10, 4) and md.armBar > d.confBar)
chk('PREC rejection: trigger candle 10:05; entry = wick midpoint 19997.25; stop = high + 2 ticks = 20001.0 (15 ticks)', abs(md.tHi - 20000.5) < 1e-9 and md.tT == T(2026, 3, 4, 10, 5) and md.lim == 19997.25 and md.stp == 20001.0)
chk('PREC: order armed on 10:05 close; no fill on the trigger candle itself (it touched the limit)', md.armBar == d.confBar + 2 and (not trp or trp[0].fillT > md.tT))
chk('PREC: planned R computed on rounded prices (target = opening-range low 19970, nearest unswept)', md.tgt == 19970.0 and abs(md.plannedR - (19997.25 - 19970.0) / 3.75) < 1e-9 and md.plannedR >= 5.0)
chk('PREC: filled once, target hit, label "Rejection", plan stored on the trade', len(trp) == 1 and trp[0].outcome == 1 and 'Rejection' in trp[0].note and trp[0].plannedR >= 5.0)
frozen = (md.lim, md.stp, md.tgt)
chk('PREC: entry / stop / target never change after arming', frozen == (19997.25, 20001.0, 19970.0))
e2 = prec_day(orLow=19978.75); chk('PREC: minimum-R check on rounded prices: 4.93R rejected (col 13), no trade, no farther target substituted', col(e2, 4, 13) == 1 and not tr_of(e2, 4))
e2 = prec_day(orLow=19978.5); chk('PREC: exactly 5.00R passes', col(e2, 4, 5) == 1)
e2 = prec_day(extra={(10, 5): (19994, 20014.0, 19992, 19993)}); chk('PREC: stop beyond the 40-tick cap is REJECTED, not compressed', col(e2, 4, 8) == 1 and not tr_of(e2, 4) and e2.days[0].ms[4].stp is None)
e2 = prec_day(orLow=None); chk('PREC: no eligible liquidity target -> reported (col 11), no trade', col(e2, 4, 11) == 1 and not tr_of(e2, 4))
e2 = prec_day(extra={(10, 4): (19990, 19996, 19960, 19992)}); chk('PREC: opening-range low already swept after the open -> ineligible target (col 11), none substituted', col(e2, 4, 11) == 1 and not tr_of(e2, 4))
e2 = prec_day(extra={(10, 6): (19994, 19994.5, 19991, 19993), (10, 7): (19993, 19994, 19990, 19992), (10, 8): (19992, 19994, 19990, 19991), (10, 9): (19991, 19993, 19990, 19991)})
chk('PREC: unfilled order expires after 3 subsequent candles; counted unfilled; NO trade (excluded from win rates)', col(e2, 4, 7) == 1 and not tr_of(e2, 4) and col(e2, 4, 6) == 0)
e2 = prec_day(extra={(10, 6): (19994, 19995, 19960, 19962)}); chk('PREC: target reached before the entry cancels the order', col(e2, 4, 7) == 1 and not tr_of(e2, 4))
e2 = prec_day(extra={(10, 6): (20010, 20012, 20008, 20009)}); chk('PREC (model): a candle opening beyond the stop is a flagged gap event trade (ambiguous, exit at the open), not a silent cancellation', len(tr_of(e2, 4)) == 1 and tr_of(e2, 4)[0].gap and tr_of(e2, 4)[0].outcome == 4 and tr_of(e2, 4)[0].exitPx == 20010)
# rejection candle requirements
e2 = prec_day(extra={(10, 5): (19994, 20001, 19992, 20000.5)}); chk('PREC: close not below the 10am open -> no trigger', col(e2, 4, 4) == 0)
e2 = prec_day(extra={(10, 5): (20000.4, 20000.5, 19991, 19992)}); chk('PREC: wick share below 40% -> no trigger', col(e2, 4, 4) == 0)
e2 = prec_day(extra={(10, 5): (20000.5, 20000.5, 20000.5, 20000.5)}); chk('PREC: zero-range candle rejected', col(e2, 4, 4) == 0)
e2 = prec_day(extra={(10, 5): (19990, 19994, 19989, 19993)}); chk('PREC: candle that never reaches the precision band is not a trigger', col(e2, 4, 4) == 0)
# precision cannot signal before confirmation
pre = {(10, 2): (20014, 20016, 19995, 19996), (10, 1): (20003, 20015, 20002, 20014)}
pre = prec_day(extra={(10, 2): (19996, 20001, 19992, 19993)}); pm = pre.days[0].ms[4]
chk('PREC: a perfect rejection candle BEFORE the reversal confirmation cannot trigger; the trigger comes only after it', pm.tT is not None and pm.tT > pre.days[0].confT - 60000 and pm.tT != T(2026, 3, 4, 10, 2))
pre = prec_day(extra={(10, 3): (19996, 20001, 19987, 19990)}); pm = pre.days[0].ms[4]
chk('PREC: even if the confirmation candle itself has a perfect rejection shape it cannot trigger (models do not step on it)', pm.tT != T(2026, 3, 4, 10, 3))
only = run(mkday(2026, 3, 4, {(10, 0): (20000, 20005, 19999, 20003)}), variant='Precision', **FIX)
chk('PREC: with no confirmed setup the precision model stays idle (state 0)', all(m_.st == 0 for m_ in only.days[0].ms))
# secondary sweep
SW = {(10, 0): (20000, 20005, 19999, 20003), (10, 1): (20003, 20015, 20002, 20014), (10, 2): (20014, 20016, 19995, 19996),
      (10, 3): (19996, 19998, 19985, 19990), (10, 4): (19990, 19997, 19988, 19992), (10, 5): (19992, 19998.5, 19990, 19991),
      (10, 6): (19991, 19997, 19989, 19990), (10, 7): (19994, 20000.5, 19992, 19993), (10, 8): (19994, 19998, 19990, 19992), (10, 9): (19992, 19994, 19970.5, 19972)}
es = run(mkday(2026, 3, 4, SW, orLow=19970.0), variant='Precision', pTrig='Secondary sweep', **FIX); ds = es.days[0]; ms_ = ds.ms[4]
chk('SWEEP: pivot high 19998.5 (10:05) became known at the close of 10:06 and was swept by the LATER candle 10:07', ds.pvKn == ds.confBar + 3 and ms_.sLvl == 19998.5 and ms_.tT == T(2026, 3, 4, 10, 7) and ms_.tT > T(2026, 3, 4, 10, 6))
chk('SWEEP: swept level frozen; label "Secondary sweep" in sweep mode', ms_.trigNm == 'Secondary sweep')
ee = run(mkday(2026, 3, 4, SW, orLow=19970.0), variant='Precision', pTrig='Either', **FIX)
chk('EITHER: rejection and sweep qualify on the same candle -> ONE candidate labelled "Sweep + Rejection"', ee.days[0].ms[4].trigNm == 'Sweep + Rejection' and col(ee, 4, 4) == 1)
er = run(mkday(2026, 3, 4, SW, orLow=19970.0), variant='Precision', pTrig='Rejection', **FIX)
chk('REJECTION mode on the same data fires on the first rejection candle', er.days[0].ms[4].trigNm == 'Rejection')
# swept pivot must have been known: a sweep on the right-side candle itself does not create a pivot
SWX = copy.deepcopy(SW); SWX[(10, 6)] = (19991, 20001, 19989, 19990)
ex = run(mkday(2026, 3, 4, SWX, orLow=19970.0), variant='Precision', pTrig='Secondary sweep', **FIX)
chk('SWEEP: a candle exceeding the would-be pivot on the right-side candle means NO pivot (no future-looking pivot)', ex.days[0].pvP is None or ex.days[0].pvP != 19998.5)
# standard unchanged with Precision disabled / compare toggled
base = run(mkday(2026, 3, 4, S1b, orLow=19970.0), model='A', **FIX)
both = run(mkday(2026, 3, 4, S1b, orLow=19970.0), model='A', cmpVar=True, **FIX)
chk('STANDARD unchanged: with Precision off Standard equals itself; comparing both variants leaves Standard slot results identical', same(tr_of(base, 0), tr_of(both, 0)) and base.fnl[0:15] == both.fnl[0:15])
chk('VARIANTS independent: a Standard fill does not suppress the Precision candidate (and vice versa)', both.slotOn[0] and both.slotOn[4] and (len(tr_of(both, 0)) >= 1))
solo = run(mkday(2026, 3, 4, S1b, orLow=19970.0), variant='Precision', **FIX)
chk('VARIANTS independent: Precision alone equals Precision inside the comparison', same(tr_of(solo, 4), tr_of(both, 4)) and solo.fnl[60:75] == both.fnl[60:75])
# sizing: whole contracts, rounded down; rejection if less than one contract
e2 = prec_day(sizeMode='Fixed cash risk', cash=500.0); chk('SIZING: cash risk 500 / (15 ticks x $5) = 6 whole contracts', tr_of(e2, 4) and tr_of(e2, 4)[0].qty == 6 and abs(tr_of(e2, 4)[0].riskUsd - 15 * 0.25 * 20 * 6) < 1e-9)
e2 = prec_day(sizeMode='Fixed cash risk', cash=50.0); chk('SIZING: budget below one contract -> sizing rejection (col 14), no fractional contracts', col(e2, 4, 14) == 1 and not tr_of(e2, 4))
# costs
e2 = prec_day(comm=2.5, slip=1); t2 = tr_of(e2, 4)[0]
chk('COSTS: commission per contract per side and adverse slippage reduce net R below gross R', t2.netR < t2.grossR)


# ---------------- contextual preset: text checks ----------------
print('--- contextual / legacy-preservation checks ---')
BASE = open(os.path.join(ROOT, 'tests', 'c_before_powell.pine'), encoding='utf-8').read()
for f in ['f_finish', 'f_plan', 'f_cond', 'f_posStep', 'f_invalidate', 'f_waitB', 'f_waitC', 'f_cReject', 'f_pivotUpdate', 'f_precTrig', 'f_rejectP', 'f_planP', 'f_waitP', 'f_modelStep', 'f_confirm', 'f_dayStep', 'f_finalize', 'f_exceeded', 'f_fibLvl']:
    chk(f'Legacy 10am {f} byte-identical to the pre-contextual version', fn_text(BASE, f).strip() == fn_text(SRC, f).strip())
chk('Legacy preset selectable; contextual is a separate preset input appended at the END of the legacy inputs', 'options = ["Contextual (Powell guide)", "Legacy 10am"]' in CODE and CODE.index('inVisOR = input') < CODE.index('inPreset = input'))
chk('legacy slots are off when contextual is selected and vice versa', 'not isCx and stdOn' in CODE and 'isCx and stdOn, isCx and precOn' in CODE)
chk('f_newDay creates NS models', len(re.findall(r'Mdl\.new\(slot = \d\)', fn_text(CODE, 'f_newDay'))) == 9)
chk('NY clock: trading day = date of (time + 6h); aggregation buckets from minutes since 18:00 NY', 'time + 21600000' in CODE and 'ms18 = (mOpen - 1080 + 1440) % 1440' in CODE)
chk('levels are statused BEFORE new levels are created on the same candle', CODE.index('f_cxLvlStatus()\n    Setup st = f_cxCur()') < CODE.index('f_cxLevelsBar()\n    Agg A = f_cxSrc()'))
chk('sweep needs the level known before the sweeping candle began', 'lv.known <= lv.swOpen' in CODE and 'time >= lv.known' in CODE)
chk('CISD cannot be confirmed by the sweep candle itself', 'st.st == 1 and st.swOpen != c0t' in CODE)
chk('Fib formulas (long/short) use the input ratios', 'hx - inFibE * rg : lx + inFibE * rg' in CODE and 'hx - inFibS * rg : lx + inFibS * rg' in CODE)
chk('Fib anchor only when the swing became known on THIS candle (no back-dating) and after the CISD candle', 'pvKn.get(q) == time_close and pvOp.get(q) >= st.cisdOpen' in CODE)
chk('Fib stale rule present (detection-time and continuous tracking)', 'already traversed before the swing anchor' in CODE and 'f_cxFibTrack' in CODE and 'f_cxFibDetect' in CODE and 'f_cxFibArm' in CODE)
chk('stop cap rejects, never compresses', 'never squeezed' in CODE and 'f_cxDrop(md, "stop-cap rejection' in CODE)
chk('target = nearest UNSWEPT level known at arming (st < 2), no substitution', 'lv.st < 2 and lv.known <= time_close' in CODE and 'no eligible unswept opposing liquidity target' in CODE)
chk('reward checked on rounded prices', 'float tgtR = math.round_to_mintick(tgt)' in CODE and 'pR = math.abs(tgtR - entry) / dist' in CODE)
chk('orders armed on candle N are eligible only from N+1', 'md.st == 2 and bar_index > md.armBar' in CODE)
chk('precision stop ends the attempt, not the setup', 'st.precSt := outcome == 1 ? 2 : 0' in CODE)
chk('contextual gap policy: no cancellation before a gap; gap event flagged', 'open <= md.stp' not in fn_text(CODE, 'f_cxPlanStep') and 'md.xExt' not in fn_text(CODE, 'f_cxPlanStep') and 'gap through entry AND stop' in fn_text(CODE, 'f_cxFillTry') and 't.gap := true' in fn_text(CODE, 'f_cxFillTry'))
chk('daily sequence: 50% of first trade actual risk, whole contracts rounded down', 'math.floor(mult * firstRisk / perC)' in CODE)
chk('SMT target role not claimed; reversal role only', '"Reversal"' in CODE and 'target role is NOT implemented' in CODE)
chk('contextual alerts include setup id and method', 'setup #" + str.tostring(md.sid)' in CODE and 'f_msgK(4,' in CODE)
chk('every contextual funnel/perf column labelled by method', '"PREC-Fib"' in CODE and '"PREC-Rej"' in CODE)
print(f'{sum(res)} / {len(res)} passed'); sys.exit(0 if all(res) else 1)
