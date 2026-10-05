# A small tree-walking interpreter for the Pine subset used by indicator C. It EXECUTES THE ACTUAL PINE SOURCE TEXT (parsed chunk by chunk with the
# third-party pynescript parser) bar by bar with mocked built-ins. It is NOT TradingView: built-in semantics are my own re-implementation and any
# difference from TradingView's runtime is invisible here. Draw/table/alert calls are stubs. Strict rules deliberately mirror Pine runtime errors:
# array index bounds, writes to global variables from inside functions, unknown fields and unknown names all raise.
import re, os, math, pickle, hashlib, datetime as dt
from zoneinfo import ZoneInfo
import pynescript.ast as A

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.pine_ast_cache')
os.makedirs(CACHE, exist_ok=True)

class PineError(Exception): pass
class Brk(Exception): pass
class Cont(Exception): pass

class Obj:
    def __init__(s, tname, f): s.t = tname; s.f = f
    def __repr__(s): return '<%s %s>' % (s.t, {k: v for k, v in s.f.items() if not isinstance(v, (list, Obj))})

class PArr(list): pass
class Stub:
    def __init__(s, *a, **k): s.a = a; s.k = k
class NSname(str): pass

def chunks_of(src):
    out = []; cur = []
    for l in src.split('\n'):
        st = l.strip()
        if st == '' or st.startswith('//'):
            if cur: cur.append('')
            continue
        if not l[0].isspace():
            if cur: out.append('\n'.join(cur).rstrip() + '\n')
            cur = [l]
        else:
            cur.append(l)
    if cur: out.append('\n'.join(cur).rstrip() + '\n')
    return out

def strip_comments_line(l):
    q = False
    for i, ch in enumerate(l):
        if ch == '"': q = not q
        if not q and l[i:i + 2] == '//': return l[:i].rstrip()
    return l

def parse_chunks(src):
    src = '\n'.join(strip_comments_line(l) for l in src.split('\n'))
    res = []
    for c in chunks_of(src):
        h = hashlib.md5(c.encode()).hexdigest(); p = os.path.join(CACHE, h + '.pkl')
        if os.path.exists(p): node = pickle.load(open(p, 'rb'))
        else:
            node = A.parse(c); pickle.dump(node, open(p, 'wb'))
        res.extend(node.body)
    return res

NY = ZoneInfo('America/New_York')

class Env:
    def __init__(s, parent=None, is_fn=False): s.v = {}; s.p = parent; s.fn = is_fn
    def find(s, n):
        e = s
        while e is not None:
            if n in e.v: return e
            e = e.p
        return None

class Interp:
    def __init__(self, src, inputs=None):
        self.body = parse_chunks(src); self.inputs = inputs or {}
        self.G = Env(); self.types = {}; self.funcs = {}; self.varDone = set(); self.alerts = []; self.stubs = []
        self.hist = []; self.bar = None; self.atr = {}; self.state_ids = {}
        for n in self.body:
            if isinstance(n, A.TypeDef): self.types[n.name] = n
            elif isinstance(n, A.FunctionDef): self.funcs[n.name] = n
        self.run_order = [n for n in self.body if not isinstance(n, (A.TypeDef, A.FunctionDef))]

    # ------------------------------------------------------------ bar execution
    def feed(self, b, i, last=False, islast=False):
        self.bar = b; self.bi = i; self.last = last
        self.hist.append(b)
        if len(self.hist) > 5: self.hist.pop(0)
        self.alerts_bar = []
        for n in self.run_order:
            self.exec_top(n)

    def exec_top(self, n): self.exec_stmt(n, self.G, top=True)

    # ------------------------------------------------------------ statements
    def exec_block(self, body, env):
        v = None
        for s in body: v = self.exec_stmt(s, env)
        return v

    def lookup_fn_env(self, env):
        e = env
        while e is not None:
            if e.fn: return e
            e = e.p
        return None

    def exec_stmt(self, n, env, top=False):
        t = type(n).__name__
        if t == 'Expr': return self.eval(n.value, env)
        if t == 'Assign':
            tgt = n.target
            mode = type(n.mode).__name__ if getattr(n, 'mode', None) is not None else ''
            if mode == 'Var' and top:
                key = id(n)
                if key in self.varDone: return None
                self.varDone.add(key)
            val = self.eval_assign_value(n, env)
            if isinstance(tgt, A.Tuple):
                for e, x in zip(tgt.elts, val): env.v[e.id] = x
            else:
                env.v[tgt.id] = val
            return val
        if t in ('ReAssign', 'AugAssign'):
            val = self.eval(n.value, env)
            tgt = n.target
            if isinstance(tgt, A.Attribute):
                o = self.eval(tgt.value, env)
                if not isinstance(o, Obj) or tgt.attr not in o.f: raise PineError('bad field assign %s' % tgt.attr)
                if t == 'AugAssign': val = self.binop(n.op, o.f[tgt.attr], val)
                o.f[tgt.attr] = val; return val
            e = env.find(tgt.id)
            if e is None: raise PineError('assign to undeclared %s' % tgt.id)
            if e is self.G and self.lookup_fn_env(env) is not None: raise PineError('write to GLOBAL %s from a function' % tgt.id)
            if t == 'AugAssign': val = self.binop(n.op, e.v[tgt.id], val)
            e.v[tgt.id] = val; return val
        if t == 'If':
            if self.truthy(self.eval(n.test, env)): return self.exec_block(n.body, Env(env))
            return self.exec_block(n.orelse, Env(env))
        if t == 'ForTo':
            a = self.eval(n.start, env); b = self.eval(n.end, env)
            st = self.eval(n.by, env) if getattr(n, 'by', None) is not None else None
            step = (st if st else (1 if b >= a else -1))
            i = a
            rng = []
            while (i <= b if step > 0 else i >= b): rng.append(i); i += step
            for i in rng:
                e = Env(env); e.v[n.target.id] = i
                try: self.exec_block(n.body, e)
                except Brk: break
                except Cont: continue
            return None
        if t == 'ForIn':
            arr = self.eval(n.iter, env)
            for x in list(arr):
                e = Env(env); e.v[n.target.id] = x
                try: self.exec_block(n.body, e)
                except Brk: break
                except Cont: continue
            return None
        if t == 'While':
            g = 0
            while self.truthy(self.eval(n.test, env)):
                g += 1
                if g > 100000: raise PineError('loop limit')
                try: self.exec_block(n.body, Env(env))
                except Brk: break
                except Cont: continue
            return None
        if t == 'Break': raise Brk()
        if t == 'Continue': raise Cont()
        raise PineError('unsupported stmt ' + t)

    def eval_assign_value(self, n, env):
        v = n.value
        if isinstance(n.target, A.Name) and isinstance(v, A.Call):
            d = self.dotted(v.func)
            if d and d.startswith('input.') and n.target.id in self.inputs:
                return self.inputs[n.target.id]
        return self.eval(v, env)

    def truthy(self, v): return bool(v) if v is not None else False

    # ------------------------------------------------------------ expressions
    def dotted(self, f):
        if isinstance(f, A.Name): return f.id
        if isinstance(f, A.Attribute):
            b = self.dotted(f.value)
            return None if b is None else b + '.' + f.attr
        if isinstance(f, A.Specialize): return self.dotted(f.value)
        return None

    def eval(self, n, env):
        t = type(n).__name__
        if t == 'Constant': return n.value
        if t == 'Name': return self.name(n.id, env)
        if t == 'Attribute':
            d = self.dotted(n)
            base = n.value
            if isinstance(base, A.Name) and env.find(base.id) is None and base.id not in self.name_builtin_vars():
                return self.const_attr(d)
            o = self.eval(base, env)
            if isinstance(o, Obj):
                if n.attr not in o.f: raise PineError('no field %s on %s' % (n.attr, o.t))
                return o.f[n.attr]
            raise PineError('attr on non-object %s' % d)
        if t == 'Subscript':
            base = n.value; k = self.eval(n.slice, env)
            if isinstance(base, A.Name) and base.id in ('high', 'low', 'open', 'close', 'time', 'time_close'):
                if k >= len(self.hist): return None
                b = self.hist[-1 - k]
                return {'high': b['h'], 'low': b['l'], 'open': b['o'], 'close': b['c'], 'time': b['t'], 'time_close': b['t'] + 60000}[base.id]
            raise PineError('unsupported subscript')
        if t == 'BinOp': return self.binop(n.op, self.eval(n.left, env), self.eval(n.right, env))
        if t == 'UnaryOp':
            v = self.eval(n.operand, env); o = type(n.op).__name__
            if o == 'Not': return (not v) if v is not None else True
            if v is None: return None
            return -v if o == 'USub' else v
        if t == 'BoolOp':
            o = type(n.op).__name__
            if o == 'And':
                for x in n.values:
                    if not self.truthy(self.eval(x, env)): return False
                return True
            for x in n.values:
                if self.truthy(self.eval(x, env)): return True
            return False
        if t == 'Compare':
            l = self.eval(n.left, env); res = True
            for op, c in zip(n.ops, n.comparators):
                r = self.eval(c, env); o = type(op).__name__
                if o in ('Eq', 'NotEq'):
                    eq = (l == r) if not (isinstance(l, Obj) or isinstance(r, Obj)) else (l is r)
                    ok = eq if o == 'Eq' else (not eq)
                else:
                    if l is None or r is None: ok = False
                    else: ok = {'Lt': l < r, 'LtE': l <= r, 'Gt': l > r, 'GtE': l >= r}[o]
                res = res and ok; l = r
            return res
        if t == 'Conditional':
            return self.eval(n.body, env) if self.truthy(self.eval(n.test, env)) else self.eval(n.orelse, env)
        if t == 'Tuple': return tuple(self.eval(x, env) for x in n.elts)
        if t == 'Call': return self.call(n, env)
        if t == 'If' or t == 'ForTo' or t == 'ForIn' or t == 'While': return self.exec_stmt(A.Expr(value=n), env) if False else self.exec_stmt(n, env)
        raise PineError('unsupported expr ' + t)

    def name_builtin_vars(self):
        return ('high', 'low', 'open', 'close', 'time', 'time_close', 'bar_index', 'volume', 'na')

    def binop(self, op, a, b):
        o = type(op).__name__
        if o == 'Add' and (isinstance(a, str) or isinstance(b, str)):
            if a is None or b is None: return None
            return a + b
        if a is None or b is None: return None
        if o == 'Add': return a + b
        if o == 'Sub': return a - b
        if o == 'Mult': return a * b
        if o == 'Div': return a / b if b != 0 else None
        if o == 'Mod': return math.fmod(a, b) if isinstance(a, float) or isinstance(b, float) else (abs(a) % abs(b)) * (1 if a >= 0 else -1)
        raise PineError('binop ' + o)

    def name(self, id, env):
        e = env.find(id)
        if e is not None: return e.v[id]
        b = self.bar
        m = {'high': 'h', 'low': 'l', 'open': 'o', 'close': 'c'}
        if id in m: return b[m[id]]
        if id == 'time': return b['t']
        if id == 'time_close': return b['t'] + 60000
        if id == 'bar_index': return self.bi
        if id == 'volume': return 1.0
        if id == 'na': return None
        if id in self.funcs: return id
        raise PineError('unknown name ' + id)

    CONST = {'syminfo.mintick': 0.25, 'syminfo.pointvalue': 20.0, 'syminfo.root': 'NQ', 'syminfo.ticker': 'NQ1!', 'syminfo.tickerid': 'CME_MINI:NQ1!',
             'chart.is_standard': True, 'timeframe.isticks': False, 'timeframe.isminutes': True, 'timeframe.multiplier': 1,
             'dayofweek.monday': 2, 'dayofweek.friday': 6, 'format.mintick': '#mintick', 'math.pi': math.pi}

    def const_attr(self, d):
        if d in self.CONST: return self.CONST[d]
        if d == 'barstate.isconfirmed': return True
        if d == 'barstate.isrealtime': return False
        if d == 'barstate.islastconfirmedhistory': return self.last
        if d == 'barstate.islast': return self.last
        return NSname(d)

    # ------------------------------------------------------------ calls
    def call(self, n, env):
        fn = n.func
        d = self.dotted(fn)
        args = []; kw = {}
        for a in n.args:
            v = self.eval(a.value, env)
            if getattr(a, 'name', None): kw[a.name] = v
            else: args.append(v)
        # user type constructor
        if isinstance(fn, (A.Attribute, A.Specialize)) and d and d.endswith('.new') and d[:-4] in self.types:
            return self.construct(d[:-4], args, kw, env)
        # user function
        if isinstance(fn, A.Name) and fn.id in self.funcs and env.find(fn.id) is None:
            return self.call_user(self.funcs[fn.id], args, kw)
        # method on object / array
        if isinstance(fn, A.Attribute):
            base = fn.value
            bn = self.dotted(base)
            is_ns = isinstance(base, A.Name) and env.find(base.id) is None and base.id not in self.name_builtin_vars()
            if not is_ns:
                o = self.eval(base, env)
                return self.method(o, fn.attr, args, kw)
        return self.builtin(d, args, kw, n, env)

    def call_user(self, fd, args, kw):
        e = Env(self.G, is_fn=True)
        for i, p in enumerate(fd.args):
            if i < len(args): e.v[p.name] = args[i]
            elif p.name in kw: e.v[p.name] = kw[p.name]
            else: e.v[p.name] = None
        return self.exec_block(fd.body, e)

    def construct(self, tn, args, kw, env):
        td = self.types[tn]; f = {}
        for st in td.body:
            nm = st.target.id
            f[nm] = self.eval(st.value, Env(self.G)) if getattr(st, 'value', None) is not None else None
        for k, v in kw.items():
            if k not in f: raise PineError('unknown field %s.%s' % (tn, k))
            f[k] = v
        return Obj(tn, f)

    def method(self, o, m, a, kw):
        if isinstance(o, PArr):
            def chk(i):
                if not isinstance(i, (int, float)) or i < 0 or i >= len(o): raise PineError('array index %s out of bounds (size %d)' % (i, len(o)))
                return int(i)
            if m == 'push': o.append(a[0]); return None
            if m == 'get': return o[chk(a[0])]
            if m == 'set': o[chk(a[0])] = a[1]; return None
            if m == 'size': return len(o)
            if m == 'last':
                if not o: raise PineError('last() on empty array')
                return o[-1]
            if m == 'first':
                if not o: raise PineError('first() on empty array')
                return o[0]
            if m == 'pop':
                if not o: raise PineError('pop on empty')
                return o.pop()
            if m == 'shift':
                if not o: raise PineError('shift on empty')
                return o.pop(0)
            if m == 'clear': o.clear(); return None
            if m == 'includes': return a[0] in o
            if m == 'indexof': return o.index(a[0]) if a[0] in o else -1
            if m == 'remove': return o.pop(chk(a[0]))
            if m == 'median':
                s = sorted(x for x in o if x is not None); n = len(s)
                return None if n == 0 else (s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0)
            if m == 'join': return a[0].join(str(x) for x in o)
        raise PineError('unsupported method %s on %s' % (m, type(o).__name__))

    def tostr(self, v, fmt=None):
        if v is None: return 'NaN'
        if isinstance(v, str): return v
        if fmt == '#mintick': return '%.2f' % v
        if fmt:
            m = re.match(r'#\.?(#*|0*)', fmt)
            dec = len(fmt.split('.')[1]) if '.' in fmt else 0
            return ('%.' + str(dec) + 'f') % v
        if isinstance(v, bool): return 'true' if v else 'false'
        if isinstance(v, int): return str(v)
        return repr(round(v, 10))

    def builtin(self, d, a, kw, n, env):
        b = self.bar
        if d is None: raise PineError('uncallable')
        if d in ('int',): return None if a[0] is None else int(a[0])
        if d in ('float',): return None if a[0] is None else float(a[0])
        if d == 'na': return a[0] is None
        if d == 'nz': return (a[1] if len(a) > 1 else 0) if a[0] is None else a[0]
        if d == 'indicator' or d == 'alertcondition' or d == 'log.info': return None
        if d == 'alert': self.alerts.append((self.bi, a[0])); return None
        if d.startswith('input.'):
            if d == 'input.session': return a[0]
            return a[0] if a else kw.get('defval')
        if d == 'request.security':
            return (b.get('esh'), b.get('esl'))
        if d == 'ta.atr':
            key = id(n); st = self.atr.setdefault(key, {'tr': [], 'v': None, 'bi': -1})
            if st['bi'] != self.bi:
                st['bi'] = self.bi; p = self.hist[-2] if len(self.hist) > 1 else None
                tr = b['h'] - b['l'] if p is None else max(b['h'] - b['l'], abs(b['h'] - p['c']), abs(b['l'] - p['c']))
                st['tr'].append(tr); L = a[0]
                if len(st['tr']) == L: st['v'] = sum(st['tr']) / L
                elif len(st['tr']) > L: st['v'] = (st['v'] * (L - 1) + tr) / L
            return st['v']
        if d.startswith('math.'):
            f = d[5:]
            if f == 'floor': return None if a[0] is None else math.floor(a[0])
            if f == 'ceil': return None if a[0] is None else math.ceil(a[0])
            if f == 'round':
                return None if a[0] is None else math.floor(a[0] + 0.5)
            if f == 'abs': return None if a[0] is None else abs(a[0])
            if f in ('max', 'min'):
                v = [x for x in a if x is not None]
                if len(v) < len(a): return None
                return max(v) if f == 'max' else min(v)
            if f == 'round_to_mintick': return None if a[0] is None else math.floor(a[0] / 0.25 + 0.5) * 0.25
            if f == 'sqrt': return math.sqrt(a[0])
        if d.startswith('str.'):
            f = d[4:]
            if f == 'tostring': return self.tostr(a[0], a[1] if len(a) > 1 else None)
            if f == 'tonumber': return float(a[0]) if a[0] not in (None, '') else None
            if f == 'length': return len(a[0])
            if f == 'substring': return a[0][a[1]:a[2]]
            if f == 'trim': return a[0].strip()
            if f == 'pos':
                i = a[0].find(a[1]); return None if i < 0 else i
            if f == 'format_time':
                tz = ZoneInfo(a[2]) if len(a) > 2 else NY
                x = dt.datetime.fromtimestamp(a[0] / 1000.0, tz)
                return x.strftime(a[1].replace('HH', '%H').replace('mm', '%M').replace('ss', '%S').replace('MM', '%m').replace('dd', '%d').replace('yyyy', '%Y'))
        if d in ('year', 'month', 'dayofmonth', 'hour', 'minute', 'dayofweek'):
            tz = ZoneInfo(a[1]) if len(a) > 1 else NY
            x = dt.datetime.fromtimestamp(a[0] / 1000.0, tz)
            return {'year': x.year, 'month': x.month, 'dayofmonth': x.day, 'hour': x.hour, 'minute': x.minute, 'dayofweek': (x.isoweekday() % 7) + 1}[d]
        if d == 'timestamp':
            tz = ZoneInfo(a[0])
            return int(dt.datetime(int(a[1]), int(a[2]), int(a[3]), int(a[4]), int(a[5]), int(a[6]), tzinfo=tz).timestamp() * 1000)
        if d == 'array.from': return PArr(a)
        if d in ('array.new', 'array.new_float', 'array.new_int', 'array.new_string', 'array.new_bool'):
            if d == 'array.new' or not a: return PArr()
            return PArr([a[1] if len(a) > 1 else None] * int(a[0]))
        if d in ('table.new', 'label.new', 'line.new', 'box.new'):
            return Stub()
        if d in ('table.cell', 'table.clear', 'line.delete', 'label.delete', 'box.delete'): self.stubs.append(d); return None
        if d.startswith('color.'): return d
        raise PineError('unsupported builtin ' + d)

    # ------------------------------------------------------------ helpers for tests
    def g(self, name): return self.G.v[name]
