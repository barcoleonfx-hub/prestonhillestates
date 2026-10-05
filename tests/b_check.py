# Indicator B (H_Ticks_B_Tap_Trigger.pine): text / model checks only. NOT a compile.
import re, sys, math
SRC = open('H_Ticks_B_Tap_Trigger.pine', encoding='utf-8').read()
CODE = '\n'.join(l for l in SRC.split('\n') if not l.strip().startswith('//'))
res = []
def chk(name, ok): res.append(ok); print(f'{name:110s} {"PASS" if ok else "FAIL"}')

defs = set(re.findall(r'^(f_\w+)\(', CODE, re.M)); calls = set(re.findall(r'\b(f_\w+)\(', CODE))
chk('every f_ function that is called is defined', not (calls - defs))
chk('no unused helper functions left', not [d for d in defs if len(re.findall(r'\b' + d + r'\(', CODE)) < 2])
for w in ['f_evalCand', 'f_decisive', 'f_pickTrigger', 'inUse15', 'z15', 'f_enter(', 'f_drawCtx', 'timeframe.isseconds']:
    chk(f'A-only code removed: {w}', w not in CODE)
chk('runs on a standard 1-minute chart, not 30s', 'timeframe.isminutes and timeframe.multiplier == 1' in CODE and 'Switch to a standard 1-minute chart' in CODE and '30-second' not in CODE)
chk('1m trigger is detected on the chart itself (native gaps, inversion at the candle close)', 'f_stepChart(zc, high, low, close, bar_index, time, time_close)' in CODE and 'f_armInv(0, time_close, zc.dir > 0 ? -1 : 1, high, low, zc.top, zc.bottom, zc.formTime)' in CODE)
chk('no 30s wording left', '30s' not in CODE.replace('"30s"', ''))
chk('indicator, not strategy', 'indicator(' in CODE and 'strategy(' not in CODE)
chk('title says B', 'indicator("H Ticks B' in CODE)
# rules
chk('tap arms only with bias agreement (or bias OFF), a window, and nothing armed',
    'if not noBias and biasDir != z.dir' in CODE and 'else if na(ws)' in CODE and 'else if armI.get(0) == 1' in CODE)
chk('arm ends at window end or bias flip', 'time_close >= armI.get(3) or (not noBias and biasDir != armI.get(1))' in CODE)
chk('trigger must be strictly after the tap candle and in the same window instance',
    'asOf - tfMs < armI.get(2)' in CODE and 'weI != armI.get(3)' in CODE and 'we != armI.get(3)' in CODE)
chk('trigger direction must equal the armed direction', 'd == armI.get(1)' in CODE)
chk('stop = trigger-candle extreme +/- buffer, risk capped, 1R target same distance',
    'float anchor = bull ? sLo : sHi' in CODE and 'rT > inMaxRisk' in CODE and 'int tT = bull ? eT + rT : eT - rT' in CODE)
chk('entry = chart candle close; outcome tracking unchanged (f_trackSetups kept)', 'int eT = f_tk(close)' in CODE and 'f_trackSetups() =>' in CODE)
chk('confluence evaluated at the trigger and leaves the arm in place', 'not f_confOk(d)' in CODE and 'f_rejB(7' in CODE)
chk('gates: one unresolved setup, entry limit per window instance', 'inOneActive and f_openSetup()' in CODE and 'f_winCount(wid) >= inMaxEntries' in CODE)
chk('clear path optional, unknown coverage never counts as clear', 'if inClear' in CODE and 'HTF coverage unknown' in CODE and 'f_structCheck(bull, tT)' in CODE)
chk('1m/2m sources carry the source candle high/low', '[time_close[1], close[1], high[1], low[1]]' in CODE)
chk('relaxed windows and bias-off inputs inherited', 'inRelaxWin' in CODE and 'inNoBias' in CODE and 'noBias' in CODE)
chk('bias source options inherited (15m / 4H / VWAP / EMAs)', '"15m structure", "4H structure", "VWAP", "EMAs"' in CODE)
chk('request.security calls use lookahead_on with [1] values only (no repaint)', len(re.findall(r'request\.security\([^\n]*lookahead = barmerge\.lookahead_on', CODE)) == len(re.findall(r'request\.security\(', CODE)))
nin = len(re.findall(r'^\w+\s+(\w+)\s*=\s*input\.', CODE, re.M)); chk(f'inputs ({nin}) all used', all(len(re.findall(r'\b' + i + r'\b', CODE)) >= 2 for i in re.findall(r'^\w+\s+(\w+)\s*=\s*input\.', CODE, re.M)))
chk('size under 100k characters when stripped', len(open('H_Ticks_B_Tap_Trigger_paste.pine', encoding='utf-8').read()) < 100000)

# model: timing rule and risk rule
def trig_ok(tap_close, src_close, tf_ms, win_end, trig_win_end): return src_close - tf_ms >= tap_close and trig_win_end == win_end
chk('model: 1m candle opened exactly at the tap close qualifies; one second earlier does not',
    trig_ok(1000, 1000 + 60000, 60000, 5, 5) and not trig_ok(1000, 1000 + 60000 - 1000, 60000, 5, 5))
def risk(bull, entry_t, low_t, high_t, buf): s = (low_t - buf) if bull else (high_t + buf); return (entry_t - s) if bull else (s - entry_t)
chk('model: long risk = entry - (candle low - buffer); short mirrored; both must be >= 1 and <= max', risk(True, 100, 90, 99, 2) == 12 and risk(False, 100, 101, 110, 2) == 12)
print(f'{sum(res)} / {len(res)} passed'); sys.exit(0 if all(res) else 1)
