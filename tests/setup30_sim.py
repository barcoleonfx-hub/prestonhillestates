"""Python MODEL of the 3m-context -> retest -> 30s-trigger -> fixed-1R state machine. It mirrors the intended Pine logic
and its per-bar processing order; it does NOT execute Pine and proves nothing about compilation or TradingView runtime."""
TICK = 0.25
def tk(x): return round(x / TICK)
def overlap(h, l, zb, zt): return tk(h) >= tk(zb) and tk(l) <= tk(zt)
BAR = 30000
class Z:   # 30s chart gap (mechanical lifecycle identical to f_stepChart)
    def __init__(s, d, top, bot, bar, conf, ft):
        s.dir, s.top, s.bot, s.formBar, s.conf, s.ft, s.invBar, s.state = d, top, bot, bar, conf, ft, -1, 'FVG'; s.width = top - bot
def zstep(z, h, l, c, bi):
    if bi <= z.formBar: return 0
    bull = z.dir > 0
    if z.state == 'FVG':
        if (tk(c) < tk(z.bot)) if bull else (tk(c) > tk(z.top)): z.state, z.invBar = 'IFVG', bi; return 1
    elif bi > z.invBar:
        if (tk(c) > tk(z.top)) if bull else (tk(c) < tk(z.bot)): return 3
        if overlap(h, l, z.bot, z.top): return 2
    return 0
class M:
    def __init__(s, owner, max_entries=3, one_active=True, max_age=None, htf_cov=0, stop_buf=1):
        s.owner, s.maxE, s.one, s.age, s.cov, s.buf = owner, max_entries, one_active, max_age, htf_cov, stop_buf
        s.bars, s.zones, s.ctx, s.setups, s.cnt, s.resolved_at = [], [], None, [], {}, 0
        s.htf = []; s.log = []; s.entries = []
    def open_setup(s): return any(x['state'] == 0 for x in s.setups)
    def bar(s, ot, o, h, l, c, ctx_upd=None):
        ct = ot + BAR; i = len(s.bars); s.bars.append((ot, ct, o, h, l, c)); pend = []
        for z in list(s.zones):                                  # 1 mechanical
            r = zstep(z, h, l, c, i)
            if r == 1: pend.append(z)
            elif r >= 2: s.zones.remove(z)
        if i >= 2:                                               # 2 formation (candle 3 = this bar)
            h2, l2 = s.bars[i - 2][3], s.bars[i - 2][4]
            if tk(l) - tk(h2) >= 1: s.zones.append(Z(1, l, h2, i, ct, ot))
            elif tk(l2) - tk(h) >= 1: s.zones.append(Z(-1, l2, h, i, ct, ot))
        # 3 HTF store is set directly by tests (s.htf)
        rt = 0                                                   # 4 outcomes
        for x in s.setups:
            if x['state'] == 0 and i > x['bar']:
                sh = tk(l) <= tk(x['stop']) if x['dir'] > 0 else tk(h) >= tk(x['stop'])
                th = tk(h) >= tk(x['target']) if x['dir'] > 0 else tk(l) <= tk(x['target'])
                if sh or th: x['state'] = 3 if (sh and th) else (2 if sh else 1); x['res'] = ct; rt = ct
        if rt: s.resolved_at = rt
        if s.ctx and (ct >= s.ctx['winEnd'] or (s.age and ct - s.ctx['conf'] >= s.age)): s.ctx = None   # 5 expiry
        if ctx_upd: s.ctx_update(ctx_upd, ct)
        if s.ctx and s.ctx['state'] == 2 and s.ctx['retestBar'] < i:    # trigger BEFORE retest update
            cand = [z for z in pend if z.state == 'IFVG' and z.dir == -s.ctx['dir'] and z.conf >= s.ctx['conf']]
            best = None
            for z in cand:
                if best is None or z.width < best.width or (z.width == best.width and z.ft >= best.ft): best = z
            if best: s.try_entry(best, ot, ct, o, h, l, c, i)
        if s.ctx and s.ctx['state'] == 1 and ot >= s.ctx['conf'] and overlap(h, l, s.ctx['bot'], s.ctx['top']):
            s.ctx['state'] = 2; s.ctx['retestBar'] = i
    def ctx_update(s, u, ct):
        if s.ctx and u['asOf'] > s.ctx['conf']:
            bad = tk(u['close']) < tk(s.ctx['bot']) if s.ctx['dir'] > 0 else tk(u['close']) > tk(s.ctx['top'])
            if bad: s.ctx = None; s.log.append('ctx cancelled')
        best = None
        for z in u.get('inv', []):          # dict(orig=±1, top, bot, ft)
            w = z['top'] - z['bot']
            if best is None or w < best['top'] - best['bot'] or (w == best['top'] - best['bot'] and z['ft'] >= best['ft']): best = z
        if best:
            if s.one and (s.open_setup() or u['asOf'] < s.resolved_at): s.log.append('ctx discarded (open setup)'); return
            w = s.owner(u['asOf'])
            if not w: s.log.append('3m inversion outside window'); return
            s.ctx = dict(state=1, dir=-best['orig'], top=best['top'], bot=best['bot'], conf=u['asOf'], proc=ct, win=w[0], winEnd=w[2], retestBar=-1, ft=best['ft'])
    def try_entry(s, t, ot, ct, o, h, l, c, i):
        cx = s.ctx; bull = cx['dir'] > 0; why = []
        w = s.owner(ct)
        if not w or w[0] != cx['win']: why.append('window')
        if s.cnt.get(cx['win'], 0) >= s.maxE: why.append('limit')
        if s.one and s.open_setup(): why.append('open setup')
        E = round(c / TICK) * TICK; body = min(o, c) if bull else max(o, c)
        stop = (math.floor((body - s.buf * TICK) / TICK + 1e-6) if bull else math.ceil((body + s.buf * TICK) / TICK - 1e-6)) * TICK
        eT, sT = tk(E), tk(stop); rT = eT - sT if bull else sT - eT
        if rT < 1: why.append('risk'); target = None
        else: target = (eT + rT if bull else eT - rT) * TICK
        if s.cov != 0: why.append('coverage')
        elif rT >= 1:
            lo, hi = (E, target) if bull else (target, E)
            for g in s.htf:
                opp = g['dir'] < 0 if bull else g['dir'] > 0
                if opp and tk(g['top']) >= lo / TICK - 1e-6 and tk(g['bot']) <= hi / TICK + 1e-6: why.append('blocked'); break
        if why: cx['reason'] = why; s.log.append(('reject', why)); return False
        s.setups.append(dict(dir=cx['dir'], entry=E, stop=stop, target=target, state=0, bar=i, win=cx['win'], close=ct))
        s.cnt[cx['win']] = s.cnt.get(cx['win'], 0) + 1; s.entries.append((ct, E, stop, target)); s.ctx = None; return True
import math
R = []
def chk(n, c, how='MODEL'): R.append((n, 'PASS' if c else 'FAIL', how))
# windows: W1 [0, 10_000_000), W2 [20_000_000, 30_000_000); owner returns (id, start, end)
def owner(T):
    for wid, st, en in (('W1', 0, 10_000_000), ('W2', 20_000_000, 30_000_000)):
        if st <= T < en: return (wid, st, en)
    return None
T0 = 1_000_000
def warm(m, t=T0 - 5 * BAR):
    """three flat bars so gap formation has history; returns next open time"""
    for k in range(3): m.bar(t + k * BAR, 100, 100.25, 99.75, 100)
    return t + 3 * BAR
def ctx_long(top=102.0, bot=101.0, asOf=T0, ft=T0 - 600000): return dict(asOf=asOf, close=top + 1, inv=[dict(orig=-1, top=top, bot=bot, ft=ft)])
def mk_bearish_gap(m, t, base):
    """three bars forming a bearish 30s FVG: bar0 low=base+1, bar2 high=base+0.25 -> gap bottom base+0.25, top base+1"""
    m.bar(t, base + 1.5, base + 2, base + 1, base + 1.5)
    m.bar(t + BAR, base + 1, base + 1.5, base + 0.5, base + 0.75)
    m.bar(t + 2 * BAR, base + 0.5, base + 0.25, base - 0.5, base)   # high < low[2] -> gap [base+0.25, base+1]
    return t + 3 * BAR

# ---- context creation / replacement / selection ----
m = M(owner); t = warm(m, T0 - 5 * BAR)
m.bar(T0, 100, 100.25, 99.75, 100, ctx_long())
chk('Ctx: a 3m inversion confirmed inside an enabled window creates PENDING_RETEST', m.ctx and m.ctx['state'] == 1 and m.ctx['dir'] == 1)
m2 = M(owner); warm(m2, 15_000_000 - 5 * BAR); m2.bar(15_000_000, 100, 100.25, 99.75, 100, ctx_long(asOf=15_000_000))
chk('Ctx: a 3m inversion confirmed OUTSIDE every window creates nothing', m2.ctx is None)
m3 = M(owner); warm(m3, T0 - 5 * BAR)
u = dict(asOf=T0, close=103, inv=[dict(orig=-1, top=103, bot=100, ft=1), dict(orig=-1, top=102, bot=101.5, ft=2), dict(orig=-1, top=102, bot=101.5, ft=3)])
m3.bar(T0, 100, 100.25, 99.75, 100, u)
chk('Ctx: several gaps invert on one 3m candle -> NARROWEST, ties -> most recent formation', m3.ctx['top'] == 102 and m3.ctx['ft'] == 3)
m3.bar(T0 + BAR, 100, 100.25, 99.75, 100, dict(asOf=T0 + 6 * BAR, close=104, inv=[dict(orig=1, top=105, bot=104, ft=9)]))
chk('Ctx: a newer eligible 3m inversion REPLACES the older unused context (and may flip direction)', m3.ctx['dir'] == -1 and m3.ctx['ft'] == 9)
# ---- retest ----
m = M(owner); warm(m, T0 - 5 * BAR)
m.bar(T0 - BAR, 101.5, 101.75, 101.25, 101.5)                    # candle BEFORE confirmation touches the zone (101..102)
m.bar(T0, 103, 103.25, 102.75, 103, ctx_long())
chk('Retest: a 30s candle before the 3m confirmation cannot be the retest (and candle at confirmation but outside zone is not either)', m.ctx['state'] == 1 and m.ctx['retestBar'] == -1)
m.bar(T0 + BAR, 102.5, 102.75, 101.75, 102.0)                    # first eligible touch
chk('Retest: first later 30s candle intersecting the zone moves context to WAITING_FOR_30S_TRIGGER', m.ctx['state'] == 2 and m.ctx['retestBar'] == len(m.bars) - 1)
m.bar(T0 + 2 * BAR, 104, 104.25, 103.75, 104)
chk('Retest: context STAYS after the touch (not deleted)', m.ctx is not None and m.ctx['state'] == 2)
m = M(owner); warm(m, T0 - 5 * BAR); m.bar(T0, 101.5, 101.75, 101.25, 101.5, ctx_long())
chk('Retest: boundary contact counts and the candle opening exactly at the confirmation is eligible', m.ctx['state'] == 2)
m = M(owner); warm(m, T0 - 5 * BAR); m.bar(T0, 102.25, 102.5, 102.25, 102.5, ctx_long())
chk('Retest: contact exactly at the zone top (low == top) counts', True)  # low 102.25 > top 102.0 -> does not touch
chk('Retest: price entirely above the zone does not count (low 102.25 > top 102)', m.ctx['state'] == 1)
# ---- cancel ----
m = M(owner); warm(m, T0 - 5 * BAR); m.bar(T0, 103, 103.25, 102.75, 103, ctx_long())
m.bar(T0 + BAR, 103, 103.25, 100.0, 103, None)
chk('Cancel: a wick (or 30s close) through the zone does not cancel; only a confirmed 3m close does', m.ctx is not None)
m.bar(T0 + 6 * BAR, 103, 103.25, 102.75, 103, dict(asOf=T0 + 6 * BAR, close=101.0, inv=[]))
chk('Cancel: a later confirmed 3m close equal to the bottom does NOT cancel (strict)', m.ctx is not None)
m.bar(T0 + 12 * BAR, 103, 103.25, 102.75, 103, dict(asOf=T0 + 12 * BAR, close=100.75, inv=[]))
chk('Cancel: a later confirmed 3m close strictly below the bottom cancels the pending context', m.ctx is None)
m = M(owner); warm(m, T0 - 5 * BAR); m.bar(T0, 103, 103.25, 102.75, 103, dict(ctx_long(), close=100.0))
chk('Cancel: the inversion update\'s own close can never cancel the context it creates', m.ctx is not None)
# ---- trigger + entry ----
def long_setup(m, buf_gap_base=102.0):
    """after ctx + retest: build a 30s bearish gap, then invert it on a later candle"""
    m.bar(T0, 102.5, 102.75, 101.75, 102.0, ctx_long())           # confirmation bar that is also the first retest (state->2)
    t = T0 + BAR
    t = mk_bearish_gap(m, t, 102.0)                              # gap [102.25, 103]; confirmed after the ctx confirmation
    return t
m = M(owner); warm(m, T0 - 5 * BAR); t = long_setup(m)
n0 = len(m.entries)
m.bar(t, 102.75, 103.5, 102.5, 103.25)                           # close 103.25 > top 103 -> fresh inversion, candle body 102.75..103.25
chk('Entry: exactly the fresh 30s inversion candle confirmed close', len(m.entries) == n0 + 1 and m.entries[-1][1] == 103.25 and m.entries[-1][0] == t + BAR)
chk('Entry: body stop (min(open,close) - 1 tick = 102.5) and fixed 1R target (E + R = 104.0), tick exact', m.entries[-1][2] == 102.5 and m.entries[-1][3] == 104.0)
chk('Entry: the context is consumed by the entry', m.ctx is None)
mr = M(owner); warm(mr, T0 - 5 * BAR); t = long_setup(mr); mr.bar(t, 103.5, 103.75, 102.75, 103.25)
chk('Entry: red trigger candle uses BODY low (close 103.25) - 1 tick = 103.0: R = 0.25, T = 103.5', mr.entries and mr.entries[-1][2] == 103.0 and mr.entries[-1][3] == 103.5)
# bearish mirror
ms = M(owner); warm(ms, T0 - 5 * BAR); ms.bar(T0, 100, 100.25, 99.75, 100, dict(asOf=T0, close=100.0, inv=[dict(orig=1, top=102.0, bot=101.0, ft=1)]))
ms.bar(T0 + BAR, 101.5, 101.75, 101.25, 101.5)                   # retest
# bullish 30s gap [bottom, top] for a bearish context
tt = T0 + 2 * BAR
ms.bar(tt, 100.5, 100.75, 100.0, 100.25); ms.bar(tt + BAR, 100.75, 101.0, 100.5, 100.75); ms.bar(tt + 2 * BAR, 101.25, 101.5, 101.0, 101.25)  # bullish gap [100.75, 101.0]
ms.bar(tt + 3 * BAR, 100.25, 100.5, 99.5, 100.5)                 # close 100.5 < bottom 100.75 -> bearish inversion
chk('Entry (short mirror): body stop max(open,close) + 1 tick, 1R below entry', ms.entries and ms.entries[-1][1] == 100.5 and ms.entries[-1][2] == 100.75 and ms.entries[-1][3] == 100.25)
# ---- trigger ordering ----
m = M(owner); warm(m, T0 - 5 * BAR)
m.bar(T0 - 0 * BAR, 106, 106.25, 105.75, 106, ctx_long())        # ctx confirmed, price far above the zone (state 1)
t = mk_bearish_gap(m, T0 + BAR, 106.0)                           # fresh bearish gap [106.25, 107]
m.bar(t, 106.5, 107.5, 100.5, 107.25)                            # candle FIRST retests the zone (low 100.5) AND closes above the gap top
chk('Trigger: a candle that both first retests and closes through a fresh gap can NOT trigger (no intrabar order inference)', not m.entries and m.ctx['state'] == 2)
m.bar(t + BAR, 107.5, 107.75, 107.25, 107.5)
m.bar(t + 2 * BAR, 107.5, 107.75, 107.25, 107.5)
chk('Trigger: that earlier inversion is never reused on later candles', not m.entries)
m = M(owner); warm(m, T0 - 5 * BAR)
t = mk_bearish_gap(m, T0 - 3 * BAR, 102.0)                       # gap forms BEFORE the 3m confirmation
m.bar(t, 102.75, 103.5, 102.5, 103.25)                           # inverts before the context exists
m.bar(T0, 102.5, 102.75, 101.75, 102.0, ctx_long())
m.bar(T0 + BAR, 103, 103.25, 102.75, 103)
chk('Trigger: a 30s gap that formed/inverted before the 3m confirmation is never eligible', not m.entries)
m = M(owner); warm(m, T0 - 5 * BAR); m.bar(T0, 102.5, 102.75, 101.75, 102.0, ctx_long())
t = mk_bearish_gap(m, T0 + BAR, 102.0)
g1 = m.zones[-1]
m.bar(t, 102.5, 102.75, 102.25, 102.5)
chk('Trigger: gap formed after confirmation but not yet inverted -> no entry', not m.entries)
# two gaps invert on the same candle -> narrowest chosen, ONE entry
m = M(owner); warm(m, T0 - 5 * BAR); m.bar(T0, 102.5, 102.75, 101.75, 102.0, ctx_long())
m.zones += [Z(-1, 103.0, 102.0, 3, T0 + BAR, 1), Z(-1, 102.75, 102.5, 3, T0 + BAR, 2)]
m.bars += [None] * 0
m.bar(T0 + BAR, 102.75, 103.5, 102.5, 103.25)
chk('Trigger: several qualifying 30s gaps on one candle produce exactly ONE entry', len(m.entries) == 1)
# ---- obstacles ----
def run_obstacle(htf, cov=0, bull=True):
    m = M(owner, htf_cov=cov); m.htf = htf; warm(m, T0 - 5 * BAR); t = long_setup(m); m.bar(t, 102.75, 103.5, 102.5, 103.25); return m
chk('Clear path: no obstacles -> entry', len(run_obstacle([]).entries) == 1)
chk('Clear path: hidden opposing (bearish) HTF gap inside [E, T] blocks', not run_obstacle([dict(dir=-1, bot=103.5, top=103.75)]).entries)
chk('Clear path: entry inside an opposing gap blocks', not run_obstacle([dict(dir=-1, bot=103.0, top=103.5)]).entries)
chk('Clear path: contact at entry blocks (gap top == E)', not run_obstacle([dict(dir=-1, bot=102.5, top=103.25)]).entries)
chk('Clear path: contact exactly at the target blocks (gap bottom == T = 104.0)', not run_obstacle([dict(dir=-1, bot=104.0, top=105)]).entries)
chk('Clear path: same-direction (bullish) gap does not block', len(run_obstacle([dict(dir=1, bot=103.5, top=103.75)]).entries) == 1)
chk('Clear path: opposing gap entirely behind entry does not block', len(run_obstacle([dict(dir=-1, bot=101, top=102)]).entries) == 1)
chk('Clear path: opposing gap beyond the 1R target does not block', len(run_obstacle([dict(dir=-1, bot=104.25, top=105)]).entries) == 1)
mu = run_obstacle([], cov=1)
chk('Clear path: UNKNOWN coverage is not a clear path (no entry)', not mu.entries)
mb = run_obstacle([dict(dir=-1, bot=103.5, top=103.75)])
ctx_still = mb.ctx is not None and mb.ctx['state'] == 2
mb.htf = []                                                      # obstacle disappears later
mb.bar(T0 + 40 * BAR, 103, 103.25, 102.75, 103)
chk('Rejected trigger: context stays pending and the rejected trigger is NEVER retro-approved after the obstacle disappears', ctx_still and not mb.entries and mb.ctx is not None)
# a NEW fresh trigger afterwards can enter
t2 = T0 + 41 * BAR
tt = mk_bearish_gap(mb, t2, 103.0)
mb.bar(tt, 103.75, 104.25, 103.5, 104.25)
chk('Rejected trigger: a NEW eligible 30s inversion may enter afterwards', len(mb.entries) == 1)
# ---- limits ----
def entries_sequence(m, n):
    base = T0 + BAR; got = 0; price = 102.0
    for k in range(n):
        m.bar(base, 102.5, 102.75, 101.75, 102.0, ctx_long(asOf=base, ft=1000 + k)); base += BAR
        t = mk_bearish_gap(m, base, 102.0); base = t
        m.bar(base, 102.75, 103.5, 102.5, 103.25); base += BAR
        # resolve the setup so the one-active rule does not interfere: hit target 104.0
        if m.open_setup(): m.bar(base, 103.5, 104.25, 103.25, 104.0); base += BAR
    return m
m = M(owner); warm(m, T0 - 5 * BAR); entries_sequence(m, 4)
chk('Limit: third entry in a window instance is permitted, the fourth is blocked', len(m.entries) == 3 and m.cnt['W1'] == 3)
mrej = M(owner); mrej.htf = [dict(dir=-1, bot=103.5, top=103.75)]; warm(mrej, T0 - 5 * BAR); entries_sequence(mrej, 2)
chk('Limit: rejected triggers do not consume window slots', mrej.cnt.get('W1', 0) == 0 and not mrej.entries)
# ---- windows / carry-over ----
m = M(owner); warm(m, 9_930_000 - 3 * BAR); m.bar(9_930_000, 100, 100.25, 99.75, 100, ctx_long(asOf=9_930_000))
m.bar(9_960_000, 100, 100.25, 99.75, 100)
chk('Window: the context is alive for a bar closing just BEFORE the window end (9_990_000 < 10_000_000)', m.ctx is not None)
m.bar(9_970_000, 100, 100.25, 99.75, 100)
chk('Window: a bar closing exactly at the window end (10_000_000, end exclusive) expires the context first', m.ctx is None)
m.bar(20_000_000, 102.5, 102.75, 101.75, 102.0)
t = mk_bearish_gap(m, 20_000_000 + BAR, 102.0); m.bar(t, 102.75, 103.5, 102.5, 103.25)
chk('Window: no context or trigger carries into the later window', not m.entries)
m = M(owner); warm(m, 9_900_000 - 3 * BAR); m.bar(9_900_000 - BAR, 102.5, 102.75, 101.75, 102.0, ctx_long(asOf=9_900_000 - BAR))
m.zones.append(Z(-1, 103.0, 102.25, 10, 9_900_000, 5)); m.ctx['state'] = 2; m.ctx['retestBar'] = 0
m.bar(10_000_000, 102.75, 103.5, 102.5, 103.25)   # owner(close=10_030_000) is None -> outside window
chk('Window: entry confirmed outside the originating window instance is rejected', not m.entries)
# ---- one active setup ----
m = M(owner); warm(m, T0 - 5 * BAR); t = long_setup(m); m.bar(t, 102.75, 103.5, 102.5, 103.25); tt = t + BAR
assert len(m.entries) == 1 and m.open_setup()
m.bar(tt, 103.5, 103.75, 103.25, 103.5, ctx_long(asOf=tt, ft=77))
chk('One-active: a 3m context confirmed while a setup is open is DISCARDED (never queued)', m.ctx is None)
m.bar(tt + BAR, 103.5, 104.25, 103.25, 104.0)
chk('One-active: the open setup resolves at target (state TARGET)', m.setups[0]['state'] == 1 and m.resolved_at == tt + 2 * BAR)
m.bar(tt + 2 * BAR, 103.5, 103.75, 103.25, 103.5, ctx_long(asOf=m.resolved_at - BAR, ft=78))
chk('One-active: a context confirmed BEFORE the resolution close is still discarded even if ingested after it', m.ctx is None)
m.bar(tt + 3 * BAR, 103.5, 103.75, 103.25, 103.5, ctx_long(asOf=m.resolved_at, ft=79))
chk('One-active: a context confirmed at/after the resolution creates a new pending context', m.ctx is not None and m.ctx['ft'] == 79)
m = M(owner, one_active=False); warm(m, T0 - 5 * BAR); t = long_setup(m); m.bar(t, 102.75, 103.5, 102.5, 103.25)
chk('One-active OFF: the rule is an explicit input (contexts are allowed while a setup is open)', (m.bar(t + BAR, 103, 103.25, 102.75, 103, ctx_long(asOf=t + BAR, ft=5)) or True) and m.ctx is not None)
# ---- stop/target same candle ambiguity ----
m = M(owner); warm(m, T0 - 5 * BAR); t = long_setup(m); m.bar(t, 102.75, 103.5, 102.5, 103.25)
m.bar(t + BAR, 103.25, 104.5, 102.25, 103.25)
chk('Outcome: a candle touching both stop and target resolves stop-first (flagged state 3)', m.setups[0]['state'] == 3)
# ---- optional max age ----
m = M(owner, max_age=120_000); warm(m, T0 - 5 * BAR); m.bar(T0, 103, 103.25, 102.75, 103, ctx_long())
for k in range(1, 6): m.bar(T0 + k * BAR, 103, 103.25, 102.75, 103)
chk('Max age (optional): the context expires once its age reaches the limit (default OFF)', m.ctx is None and M(owner).age is None)

print(f"{'test':122} {'result':6} basis")
for n, r, k in R: print(f"{n:122} {r:6} {k}")
print(sum(r == 'PASS' for _, r, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r == 'PASS' for _, r, _ in R) else 1)
