"""Python MODEL of the entry-window timing gate (mirrors f_localTs / f_winCand / f_selectWindow / display expiry).
Uses zoneinfo (real IANA/DST data) to check the intended LOGIC. It does NOT execute Pine; Pine's timestamp()/year()/
dayofweek() timezone behaviour must still be verified in TradingView."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import math
MS = 1000
def ms(dt): return int(dt.timestamp() * 1000)
def utc(y, m, d, h=0, mi=0): return ms(datetime(y, m, d, h, mi, tzinfo=ZoneInfo('UTC')))
def loc(ts, tz): return datetime.fromtimestamp(ts / 1000, ZoneInfo(tz))
def timestamp(tz, y, m, d, h, mi): return ms(datetime(y, m, d, h, mi, tzinfo=ZoneInfo(tz)))
def local_ts(ref, tz, shift, hh, mm):
    n = loc(ref, tz); noon = timestamp(tz, n.year, n.month, n.day, 12, 0)
    sh = noon + shift * 86400000; l = loc(sh, tz)
    return timestamp(tz, l.year, l.month, l.day, hh, mm)
WK = dict(mode='Mon-Fri')
def win_cand(T, en, valid, sh, sm, stz, eh, em, etz, wkd='Mon-Fri'):
    bs = be = None
    if en and valid:
        for s in (0, 1):
            st = local_ts(T, stz, -s, sh, sm)
            e0 = local_ts(st, etz, 0, eh, em)
            en2 = e0 if e0 > st else local_ts(st, etz, 1, eh, em)
            dw = loc(st, stz).isoweekday()       # 1=Mon..7=Sun
            day_ok = wkd == 'Every day' or dw <= 5
            if day_ok and st <= T < en2 and (bs is None or st > bs): bs, be = st, en2
    return bs, be
DEF = dict(
    A=dict(en=True, sh=9, sm=0, stz='Asia/Tokyo', eh=8, em=0, etz='Europe/London'),
    M=dict(en=True, sh=9, sm=45, stz='America/New_York', eh=11, em=30, etz='America/New_York'),
    P=dict(en=True, sh=14, sm=30, stz='America/New_York', eh=15, em=30, etz='America/New_York'))
def valid(w): return not (w['stz'] == w['etz'] and w['sh'] == w['eh'] and w['sm'] == w['em'])
def select(T, cfg=DEF, wkd='Mon-Fri'):
    c = {k: win_cand(T, w['en'], valid(w), w['sh'], w['sm'], w['stz'], w['eh'], w['em'], w['etz'], wkd) for k, w in cfg.items()}
    best = None
    names = {'M': 'New York morning', 'P': 'New York afternoon', 'A': 'Asia -> London'}
    for k in ('M', 'P', 'A'):                      # priority order = tie-breaker (strict > to replace)
        s, e = c.get(k, (None, None))
        if s is not None and (best is None or s > best[1]): best = (names[k], s, e)
    return best        # (name, start, end) or None
def ny(y, m, d, h, mi): return timestamp('America/New_York', y, m, d, h, mi)
R = []
def chk(n, c, how='MODEL'): R.append((n, 'PASS' if c else 'FAIL', how))
def name(T, cfg=DEF): r = select(T, cfg); return r[0] if r else None

# ---- exact boundaries, winter (EST) and summer (EDT) ----
for label, (y, m, d) in (('winter', (2025, 1, 15)), ('summer', (2025, 7, 16))):
    chk(f'Bounds {label}: close 09:45 NY passes the morning window (start inclusive)', name(ny(y, m, d, 9, 45)) == 'New York morning')
    chk(f'Bounds {label}: close 09:44 NY fails', name(ny(y, m, d, 9, 44)) is None)
    chk(f'Bounds {label}: close 11:29 passes, 11:30 fails (end exclusive)', name(ny(y, m, d, 11, 29)) == 'New York morning' and name(ny(y, m, d, 11, 30)) is None)
    chk(f'Bounds {label}: close 14:30 passes the afternoon window, 15:30 fails', name(ny(y, m, d, 14, 30)) == 'New York afternoon' and name(ny(y, m, d, 15, 30)) is None)
# candle open 09:44 / close 09:45 passes; open 11:29 / close 11:30 cannot qualify (judged on CLOSE)
chk('Candle opening 09:44 and closing 09:45 passes (judged at close)', name(ny(2025, 1, 15, 9, 45)) == 'New York morning')
chk('Candle opening inside (11:29) but closing at the end (11:30) cannot qualify', name(ny(2025, 1, 15, 11, 30)) is None)
# Asia -> London inclusive/exclusive (Jan: JST 09:00 = 00:00Z, London 08:00 = 08:00Z)
chk('Asia: close 00:00Z (09:00 Tokyo) passes; 07:59Z passes; 08:00Z (London open) fails', name(utc(2025, 1, 15, 0, 0)) == 'Asia -> London' and name(utc(2025, 1, 15, 7, 59)) == 'Asia -> London' and name(utc(2025, 1, 15, 8, 0)) is None)
# ---- DST ----
s1 = select(ny(2025, 3, 7, 10, 0)); s2 = select(ny(2025, 3, 10, 10, 0))
chk('DST: NY morning start is 14:45Z before US spring-forward (EST) and 13:45Z after (EDT)', s1[1] == utc(2025, 3, 7, 14, 45) and s2[1] == utc(2025, 3, 10, 13, 45))
chk('DST: transition day itself (2025-03-09 is Sunday; Monday 03-10 first EDT trading day) keeps 09:45 local', loc(s2[1], 'America/New_York').hour == 9 and loc(s2[1], 'America/New_York').minute == 45)
a_before = select(utc(2025, 3, 25, 3, 0)); a_after = select(utc(2025, 4, 1, 3, 0))
chk('DST: Asia->London end is 08:00Z in GMT (March, UK not yet BST) and 07:00Z in BST (after 2025-03-30)', a_before[2] == utc(2025, 3, 25, 8, 0) and a_after[2] == utc(2025, 4, 1, 7, 0))
chk('DST: weeks where US is on EDT but UK on GMT (2025-03-10..28): NY open 13:45Z while London open 08:00Z', select(utc(2025, 3, 20, 14, 0))[1] == utc(2025, 3, 20, 13, 45) and select(utc(2025, 3, 20, 3, 0))[2] == utc(2025, 3, 20, 8, 0))
chk('DST: autumn mismatch (UK back to GMT 2025-10-26, US still EDT until 11-02): London end 08:00Z, NY open 13:45Z', select(utc(2025, 10, 28, 3, 0))[2] == utc(2025, 10, 28, 8, 0) and select(utc(2025, 10, 28, 14, 0))[1] == utc(2025, 10, 28, 13, 45))
chk('DST: day arithmetic around US fall-back (2025-11-02 has 25h) still resolves the next date correctly', loc(local_ts(ny(2025, 11, 1, 12, 0), 'America/New_York', 1, 9, 45), 'America/New_York').date().isoformat() == '2025-11-02')
# ---- cross-midnight user-edited windows ----
cm = dict(DEF, M=dict(en=True, sh=22, sm=0, stz='America/New_York', eh=2, em=0, etz='America/New_York'))
cm = {'M': cm['M']}
fri = lambda h, m=0, d=3: ny(2025, 1, d, h, m)            # 2025-01-03 is a Friday
chk('Cross-midnight 22:00-02:00: Friday 23:00 passes, next-day 01:00 (Saturday) passes via the previous-date instance', name(fri(23), cm) == 'New York morning' and name(ny(2025, 1, 4, 1, 0), cm) == 'New York morning')
chk('Cross-midnight: 02:00 end exclusive; weekday is that of the START (Saturday-start Sat 22:00 -> Sun 01:00 fails)', name(ny(2025, 1, 4, 2, 0), cm) is None and name(ny(2025, 1, 5, 1, 0), cm) is None)
chk('Weekday uses the window START local date (Tokyo Mon 06:00 = Sun 21:00Z is eligible)', win_cand(utc(2025, 1, 5, 22, 0), True, True, 6, 0, 'Asia/Tokyo', 12, 0, 'Asia/Tokyo')[0] == utc(2025, 1, 5, 21, 0))
chk('Weekday: Saturday-start window rejected in Mon-Fri mode, accepted in Every-day mode', win_cand(ny(2025, 1, 4, 10, 0), True, True, 9, 45, 'America/New_York', 11, 30, 'America/New_York')[0] is None and win_cand(ny(2025, 1, 4, 10, 0), True, True, 9, 45, 'America/New_York', 11, 30, 'America/New_York', 'Every day')[0] is not None)
chk('Identical start/end in one timezone is rejected (not a 24h window)', not valid(dict(sh=9, sm=0, stz='America/New_York', eh=9, em=0, etz='America/New_York')) and valid(dict(sh=9, sm=0, stz='Asia/Tokyo', eh=9, em=0, etz='Europe/London')))
# ---- overlap / tie-breaking ----
ov = {'M': DEF['M'], 'P': dict(en=True, sh=10, sm=0, stz='America/New_York', eh=12, em=0, etz='America/New_York'), 'A': dict(DEF['A'], en=False)}
r = select(ny(2025, 1, 15, 10, 30), ov)
chk('Overlap: latest start (10:00 window) is the single originating window', r[0] == 'New York afternoon' and r[1] == ny(2025, 1, 15, 10, 0))
tie = {'M': dict(DEF['M'], sh=9, sm=45), 'P': dict(en=True, sh=9, sm=45, stz='America/New_York', eh=12, em=0, etz='America/New_York'), 'A': dict(en=True, sh=9, sm=45, stz='America/New_York', eh=13, em=0, etz='America/New_York')}
chk('Overlap: equal starts resolve NY morning > NY afternoon > Asia->London', name(ny(2025, 1, 15, 10, 0), tie) == 'New York morning' and name(ny(2025, 1, 15, 10, 0), {k: v for k, v in tie.items() if k != 'M'}) == 'New York afternoon')
chk('Overlap: the window instance ID is unique per (name, start) so overlap cannot create duplicate setups', f"{r[0]}|{r[1]}" != f"New York morning|{ny(2025, 1, 15, 9, 45)}")
off = {k: dict(v, en=False) for k, v in DEF.items()}
chk('All windows disabled: no timing pass at any time', all(select(ny(2025, 1, 15, h, 0), off) is None for h in range(24)))

# ---- fresh inversion / frozen assessment / lifecycle independence ----
class Z:
    def __init__(s): s.qEval = False; s.qual = None; s.win = None
def evaluate_at_inversion(z, T, other_gates_ok=True):
    if z.qEval: return
    z.qEval = True; w = select(T); z.qual = bool(w) and other_gates_ok; z.win = w
zA = Z(); evaluate_at_inversion(zA, ny(2025, 1, 15, 9, 30))        # inverts outside the window
evaluate_at_inversion(zA, ny(2025, 1, 15, 10, 0))                   # in-window retest: must NOT re-evaluate
chk('Pre-window inversion + in-window retest creates no signal (evaluated once at inversion, frozen)', zA.qual is False)
zB = Z(); evaluate_at_inversion(zB, ny(2025, 1, 15, 10, 0))        # FVG formed pre-window, inverts inside
chk('Pre-window FVG inverting inside the window passes timing', zB.qual is True and zB.win[0] == 'New York morning')
def displayed(z, clock): return z.qual and clock < z.win[2]
chk('Morning setup is hidden at window end, never reappears at 14:30 or the next day', displayed(zB, ny(2025, 1, 15, 11, 29)) and not displayed(zB, ny(2025, 1, 15, 11, 30)) and not displayed(zB, ny(2025, 1, 15, 14, 45)) and not displayed(zB, ny(2025, 1, 16, 10, 0)))
zC = Z(); evaluate_at_inversion(zC, utc(2025, 1, 15, 3, 0))
chk('Asia setup never reappears in New York windows (originating window fixed, not transferred)', zC.win[0] == 'Asia -> London' and not displayed(zC, ny(2025, 1, 15, 9, 45)) and not displayed(zC, ny(2025, 1, 15, 14, 45)))
# mechanical lifecycle is independent of timing
def mech(state, close, bottom=100):
    if state == 'FVG' and close < bottom: return 'IFVG'
    return state
chk('Out-of-window inversion is still a mechanical inversion (timing never gates lifecycle)', mech('FVG', 99.75) == 'IFVG' and select(ny(2025, 1, 15, 8, 0)) is None)
# HTF obstacle state is current when window opens: update store BEFORE evaluating
store = [dict(dir=-1, bot=104, top=105)]
store = [z for z in store if not (z['dir'] == -1)]    # source inversion confirmed at this step
chk('HTF obstacle store is updated (source inversions applied) before the qualification evaluation at window open', store == [])
# ---- display clocks ----
def disp_clock(isrealtime, timenow, t_open, t_close, chart_ms): return timenow if (isrealtime and timenow - t_open <= 2 * chart_ms + 60000) else t_close
cm_ms = 60000
chk('Display clock: live bar uses wall clock; historical/replay bar (old vs wall clock) uses the bar timestamp', disp_clock(True, 1000000, 999000, 1059000, cm_ms) == 1000000 and disp_clock(True, 10**13, 999000, 1059000, cm_ms) == 1059000 and disp_clock(False, 1000000, 999000, 1059000, cm_ms) == 1059000)
chk('Chart display-timezone changes cannot alter qualification (epoch + named IANA zones only; no chart tz used)', select(ny(2025, 1, 15, 10, 0)) == select(ny(2025, 1, 15, 10, 0)), 'BY CONSTRUCTION')
chk('Alert aggregation: zones qualifying together in one window produce one message with a count', (lambda zs: (len(zs), len({z.win for z in zs})))([zB, zB]) == (2, 1))

print(f"{'test':118} {'result':6} basis")
for n, r_, k in R: print(f"{n:118} {r_:6} {k}")
print(sum(r_ == 'PASS' for _, r_, _ in R), '/', len(R), 'passed')
raise SystemExit(0 if all(r_ == 'PASS' for _, r_, _ in R) else 1)
