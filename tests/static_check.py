"""Static review of H_Ticks_FVG_iFVG.pine (text-level only; does NOT compile Pine)."""
import re, sys
src = open(sys.argv[1] if len(sys.argv) > 1 else 'H_Ticks_FVG_iFVG.pine').read()
lines = src.split('\n')
def strip(l):
    out, q, i = '', False, 0
    while i < len(l):
        ch = l[i]
        if ch == '"' and (i == 0 or l[i-1] != '\\'): q = not q
        if not q and l[i:i+2] == '//': break
        out += ch; i += 1
    return out
code = '\n'.join(strip(l) for l in lines)
R = []
def chk(n, c): R.append((n, 'PASS' if c else 'FAIL'))
chk('line 1 is //@version=6', lines[0].strip() == '//@version=6')
chk('brackets balanced ()[]{}', all(code.count(a) == code.count(b) for a, b in ('()', '[]', '{}')))
# string literal sanity: even quote count per line (ignoring escaped)
bad = [i+1 for i, l in enumerate(lines) if len(re.findall(r'(?<!\\)"', strip(l))) % 2]
chk('quotes balanced per line %s' % bad[:5], not bad)
chk('no descending "by -1" loops', 'by -1' not in code)
fdefs = re.findall(r'^(f_\w+)\(', code, re.M)
order = {f: m.start() for f in fdefs for m in [re.search(r'^%s\(' % f, code, re.M)]}
used_before = []
for f in fdefs:
    for m in re.finditer(r'\b%s\(' % f, code):
        if m.start() < order[f] and not code[m.start()-0:m.start()+len(f)+1].startswith(f + '(') or (m.start() < order[f]):
            used_before.append(f)
chk('every f_ function defined before first use %s' % sorted(set(used_before))[:5], not used_before)
chk('no unused f_ functions %s' % [f for f in fdefs if len(re.findall(r'\b%s\(' % f, code)) < 2], all(len(re.findall(r'\b%s\(' % f, code)) >= 2 for f in fdefs))
inputs = re.findall(r'^(?:\w+\s+)?(\w+)\s*=\s*input\.', code, re.M)
inputs = re.findall(r'^\w+\s+(\w+)\s*=\s*input\.', code, re.M)
unused = [i for i in inputs if len(re.findall(r'\b%s\b' % i, code)) < 2]
chk('no unused inputs %s' % unused, not unused)
types = re.findall(r'^type (\w+)', code, re.M)
chk('removed identifiers gone', not re.search(r'inRelAtr|inSlipTicks|inCostTicks|inTimeStopMin|memBudget|effBudget|qMsg|sMsg|alOutcome|inBudget', code))
chk('no 30-record cap', not re.search(r'setups\.size\(\)\s*>\s*30', code))
chk('exactly one alert( call', len(re.findall(r'(?<![\w.])alert\(', code)) == 1)
chk('4H obstacle source defaults ON, 1D OFF', 'bool   en3 = input.bool(true' in code and 'bool   en4 = input.bool(false' in code and 'bool   en1 = input.bool(true' in code and 'bool   en2 = input.bool(true' in code)
chk('alert defaults: entry/target/stop ON, ambiguous OFF', 'alEntry = input.bool(true' in code and 'alTarget = input.bool(true' in code and 'alStop = input.bool(true' in code and 'alAmb = input.bool(false' in code)
chk('f_syncDraw updates border colour + text colour + coords', all(x in code for x in ('box.set_border_color(z.bx', 'box.set_text_color(z.bx', 'box.set_top(z.bx', 'box.set_bottom(z.bx', 'box.set_left(z.bx')))
chk('f_drawCtx updates all properties', all(x in code for x in ('box.set_border_color(cx.bx', 'box.set_text_color(cx.bx', 'box.set_bgcolor(cx.bx', 'box.set_top(cx.bx')))
chk('default colours black/green/red, solid', 'input.color(color.black, "Entry' in code and 'input.color(color.green, "Target' in code and 'input.color(color.red, "Stop' in code and code.count('style = line.style_solid, width = 2') == 3)
chk('no strategy() declaration', not re.search(r'^strategy\(', code, re.M))
chk('no bar_index/last_bar_index history gate', 'last_bar_index' not in code)
w = max(len(n) for n, _ in R)
for n, r in R: print(f'{n:{w}} {r}')
print(sum(r == 'PASS' for _, r in R), '/', len(R))
sys.exit(0 if all(r == 'PASS' for _, r in R) else 1)
