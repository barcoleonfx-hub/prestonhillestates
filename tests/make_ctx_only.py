# Builds the contextual-only Powell Model C from the combined (contextual + legacy preset) source, removing the legacy engine because the combined script
# exceeded TradingView's 100,256-token compiled limit (CE10117). The legacy engine lives on as H_Ticks_C_Legacy_10AM.pine.
import re
src=open('/home/user/prestonhillestates/tests/c_combined.pine').read()
def rep(a,b,c=1):
    global src
    assert src.count(a)==c,(a[:80],src.count(a)); src=src.replace(a,b)
def fn_span(name):
    i=src.index('\n'+name+'(')+1
    m=re.search(r'\n(?=\S)', src[i+len(name):]); j=i+len(name)+m.start()+1
    # also swallow comment lines directly above the function
    lines_before=src[:i].split('\n')
    k=len(lines_before)-1
    while k>0 and lines_before[k-1].startswith('//'): k-=1
    start=sum(len(l)+1 for l in lines_before[:k])
    return start, j
def rm_fn(name):
    global src
    i,j=fn_span(name); src=src[:i]+src[j:]
for f in ['f_plan','f_cond','f_fillTry','f_fillStep','f_posStep','f_invalidate','f_waitB','f_waitC','f_cReject','f_pivotUpdate','f_precTrig','f_rejectP','f_planP','f_waitP','f_fillStepP','f_modelStep','f_confirm','f_dayStep','f_finalize','f_exceeded','f_fibLvl','f_drawPlan','f_drawDay','f_stName','f_drawTables']:
    rm_fn(f)
# ---- header
i=src.index("// ────"); j=src.index('indicator("H Ticks')
src=src[:i]+"""// ────────────────────────────────────────────────────────────────────────────────────────────────────────────
// H Ticks — Powell Model C (CONTEXTUAL engine). Indicator C; A and B are untouched. The earlier 10:00 open retest engine is a separate script
// (H_Ticks_C_Legacy_10AM.pine) because the combined script exceeded TradingView's compiled-token limit (CE10117: 100,256).
// RESEARCH MODEL. PROFITABILITY IS UNPROVEN. These are OUR mechanical interpretation of the Powell Model C guide, NOT Powell's official rules.
// Everything is a simulation on completed 1-minute candles (NQ / MNQ primary). Not compiled/chart-verified by the author.
//
// PIPELINE: timestamped liquidity levels -> sweep of a PRE-EXISTING level -> CISD (a later close through the first open of the opposing run into the
// sweep) -> price areas (FVG / order block / breaker / rejection block / iFVG) -> execution.
//   STANDARD  = limit at the CE of the selected area; stop beyond the FULL sweep extreme + buffer; target = nearest unswept opposing liquidity at arming.
//   PRECISION = same setup, refined by sub-methods (NOT extra variants): Fib 0.705 (stop beyond 0.79) or a local rejection CE inside the parent area.
// Provenance: [GUIDE] described in the guide, [OURS] our mechanical interpretation, [OPT] optional experimental filter, [ENG] engineering approximation.
// Higher-timeframe candles are aggregated from the 1m chart, published only when complete, and used only after they complete.
// EXECUTION POLICY: limit fills on a later candle (touch, or trade-through if strict); fill price = limit (no improvement). An active limit is never assumed
// cancelled before a gap: a gap through entry AND stop is a flagged ambiguous gap event (filled at the limit, stopped at the open, counted as a loss).
// Entry + stop + target on one candle, or stop + target on a later candle: ambiguous, counted as a loss. Slippage adverse; commission per contract per side.
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────
"""+src[j:]
rep("const int NL = 5\n","")
# ---- time / slots
for l in ["int openT = f_mins(inMan, 0)\n","int manE = f_mins(inMan, 5)\n","int cutT = f_mins(inCut, 0)\n","int exitT = f_mins(inCut, 5)\n","bool cfgOk = orS < orE and openT < manE and manE <= cutT and cutT < exitT and orE <= openT\n","bool isCx = inPreset != \"Legacy 10am\"\n","float atrV = ta.atr(inAtrLen)\n","float h2 = high[2]\n","float l2 = low[2]\n","int t2 = time[2]\n"]:
    rep(l,"")
rep("bool cfgAll = isCx ? cxCfgOk : cfgOk","bool cfgAll = cxCfgOk")
i=src.index("int stdSel = "); j=src.index("bool stdOn = ")
src=src[:i]+"int selVar = inVariant == \"Precision\" ? 1 : 0\nint selSlot = selVar == 1 ? 6 : 5\n"+src[j:]
i=src.index("var array<bool> slotOn = "); j=src.index("\n",i)
src=src[:i]+"var array<bool> slotOn = array.from(false, false, false, false, false, stdOn, precOn, precOn, precOn)"+src[j:]
rep("var array<float> bufH = array.new_float(0)\nvar array<float> bufL = array.new_float(0)\nvar array<int> bufI = array.new_int(0)\nvar array<int> bufT = array.new_int(0)\nvar float sHi = na      // extreme since the most recent 16:00 NY (previous regular-session close)\nvar float sLo = na\nvar int pM = na\n","")
open('/home/user/prestonhillestates/tests/_ctx_stage.pine','w').write(src)
print('stage written', len(src))

# ======== stage 2: main loop, types, drawing dispatch, inputs
src=open('/home/user/prestonhillestates/tests/_ctx_stage.pine').read()
rep("""    bufH.push(high)
    bufL.push(low)
    bufI.push(bar_index)
    bufT.push(time)
    while bufH.size() > 12
        bufH.shift()
        bufL.shift()
        bufI.shift()
        bufT.shift()
    if mOpen >= 960 and (na(pM) or pM < 960)
        sHi := high
        sLo := low
    else
        sHi := na(sHi) ? high : math.max(sHi, high)
        sLo := na(sLo) ? low : math.min(sLo, low)
    pM := mOpen
""","")
rep("            if isCx\n                f_cxFinalize(cur, pClose, pCloseT)\n            else\n                f_finalize(cur, pClose, pCloseT)\n","            f_cxFinalize(cur, pClose, pCloseT)\n")
rep("    if isCx\n        f_cxBar(cur)\n    else if cur.active\n        f_dayStep(cur)\n","    f_cxBar(cur)\n")
rep("""                if not isCx
                    f_drawDay(dd)
                shownKeys.push(dd.key)""","""                shownKeys.push(dd.key)""")
i=src.index("    if isCx\n        if inCxVisCtx"); 
src=src[:i]+"""    if inCxVisCtx
        f_cxDrawLevels()
        for q in sets
            if shownKeys.includes(q.dayKey) and (inCxHist or q.dayKey == cur.key)
                f_cxDrawSetup(q)
    for md in plans
        if shownKeys.includes(md.dayKey) and (inCxHist or md.dayKey == cur.key) and slotOn.get(md.slot) and inVisPlan and (inShowBoth or md.slot == selSlot)
            f_cxDrawPlan(md)
    f_cxTables()
"""
# newDay without models
i,j=fn_span('f_newDay')
src=src[:i]+"""f_newDay(int key, int dow, Day prev) =>
    Day d = Day.new(key = key, active = dow >= dayofweek.monday and dow <= dayofweek.friday)
    d

"""+src[j:]
# Day type
i=src.index("// Day state."); j=src.index("// ──────", i)
src=src[:i]+"""// Per NY calendar day bookkeeping (coverage only). st: 0 waiting, 1 window seen, 9 ineligible. status: 0 complete, 1 partial, 2 no window start candle, 4 no levels.
type Day
    int key
    bool active = true
    int status = 0
    int st = 0
    string why = ""
    int bars10 = 0

"""+src[j:]
# Mdl legacy fields
for f in ["    float fT = na\n","    float fB = na\n","    int fCT\n","    bool fInv = false\n","    string trigNm = \"\"\n","    int tT\n","    float tHi = na\n","    float tLo = na\n","    float tBase = na\n","    float sLvl = na\n","    int sT\n"]:
    rep(f,"")
open('/home/user/prestonhillestates/tests/_ctx_stage2.pine','w').write(src)
print('stage2', len(src))

# ======== stage 3: drop inputs / constants that nothing references any more
src=open('/home/user/prestonhillestates/tests/_ctx_stage2.pine').read()
removed=[]
while True:
    changed=False
    lines=src.split('\n')
    body='\n'.join(l for l in lines if not l.lstrip().startswith('//'))
    for idx,l in enumerate(lines):
        m=re.match(r'^(?:string|bool|int|float) (in[A-Za-z0-9_]+) = input\.',l) or re.match(r'^const (?:string|int) ([A-Za-z0-9_]+) = ',l)
        if m:
            nm=m.group(1)
            others=len(re.findall(r'\b'+nm+r'\b','\n'.join(x for j,x in enumerate(lines) if j!=idx and not x.lstrip().startswith('//'))))
            if others==0:
                removed.append(nm); lines.pop(idx); changed=True; break
    src='\n'.join(lines)
    if not changed: break
print('removed unreferenced:',len(removed)); print(' '.join(removed))
open('/home/user/prestonhillestates/H_Ticks_C_10AM_Precision.pine','w').write(src)
print('final', len(src))
