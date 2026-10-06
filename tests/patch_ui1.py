import re
P='/home/user/prestonhillestates/H_Ticks_C_10AM_Precision.pine'
src=open(P).read()
def rep(a,b,c=1):
    global src
    n=src.count(a); assert n==c,(a[:80],n); src=src.replace(a,b)
def fn_span(name):
    i=src.index('\n'+name+'(')+1
    m=re.search(r'\n(?=\S)', src[i+len(name):]); return i, i+len(name)+m.start()+1
def repl_fn(name,new):
    global src
    i,j=fn_span(name); src=src[:i]+new.rstrip('\n')+'\n\n'+src[j:]

# ---------- types / state
rep("    int fibSt = 0\n","    int endT = 0\n    string endCat = \"\"\n    bool winSeen = false\n    bool execSeen = false\n    bool counted = false\n    bool parWait = false\n    int candN = 0\n    string candCat = \"\"\n    bool candArmed = false\n    bool seqBlock = false\n    bool busyBlock = false\n    int fibSt = 0\n")
rep("    int parId = 0\n","    int parId = 0\n    string tgtAud = \"\"\n")
rep("var array<string> dayWhy = array.new_string(0)    // detailed reasons for the latest day","var array<string> dayWhy = array.new_string(0)    // detailed reasons for the latest day\nvar array<string> lastRsn = array.from(\"\")        // newest rejection / cancellation reason\nvar array<int> rcN = array.new_int(16, 0)         // setup-level reconciliation: 0-13 exclusive categories, 15 = area-qualified setups\nvar array<int> blkC = array.new_int(4, 0)         // sweeps ignored, by the state of the blocking setup")
# f_why remembers the newest reason
rep("    dayWhy.push(f_hm(time_close) + \" \" + detail)\n","    dayWhy.push(f_hm(time_close) + \" \" + detail)\n    lastRsn.set(0, detail)\n")
# unswept levels superseded counter
rep("            if sup and lv.st < 2\n                lv.st := 3\n","            if sup and lv.st < 2\n                lv.st := 3\n                if lv.side != 0\n                    cxN.set(5, cxN.get(5) + 1)\n")

# ---------- lifecycle end + reconciliation (placed before f_cxFn)
rep("// funnel counter for a contextual plan:","""// Setup lifecycle end. Every end goes through here: the end time is recorded (drawings stop there) and each AREA-QUALIFIED setup is classified into ONE
// exclusive reconciliation category (precedence: a candidate was evaluated > daily trade limit > an existing active order > window seen but nothing executable
// > how the setup ended). Candidate/order counters elsewhere are per variant and NOT exclusive with these.
f_cxRecLabel(int c) =>
    array<string> L = array.from("candidate armed", "candidate rejected: stop cap", "candidate rejected: no target / min-R", "candidate rejected: filter / stale / parent", "candidate rejected: sizing / invalid", "no candidate: daily trade limit", "no candidate: an existing order was active", "no candidate: in window but no executable fresh area", "no candidate: invalidated (price beyond the sweep extreme)", "no candidate: expired (age limit)", "no candidate: rolled to the next trading day (never inside an entry window / nothing executable)", "no candidate: superseded / exhausted / other", "no candidate: missing data", "still active (data ended)")
    L.get(c)

f_cxEnd(Setup st, string why, string kind) =>
    if st.st != 8
        st.st := 8
        st.why := why
        st.endT := time_close
        int c = 11
        if st.candN > 0
            c := st.candArmed ? 0 : (st.candCat == "stop" ? 1 : (st.candCat == "target" ? 2 : (st.candCat == "filter" ? 3 : 4)))
        else if st.seqBlock
            c := 5
        else if st.busyBlock
            c := 6
        else if kind == "data"
            c := 12
        else if st.winSeen and not st.execSeen
            c := 7
        else if kind == "inval"
            c := 8
        else if kind == "exp"
            c := 9
        else if kind == "day"
            c := 10
        st.endCat := f_cxRecLabel(c)
        if st.hadArea and not st.counted
            st.counted := true
            rcN.set(c, rcN.get(c) + 1)
    true

// funnel counter for a contextual plan:""")
# f_cxDrop: record first candidate's category
repl_fn('f_cxDrop','''f_cxDrop(Mdl md, string why, string cat, int col) =>
    md.st := 4
    md.why := why
    f_cxFn(md, col)
    f_why(cat, md.meth + ": " + why)
    f_msgK(3, md.slot, "REJECTED - " + md.meth + ": " + why)
    Setup s = f_cxSetupBy(md.sid)
    if not na(s) and s.candCat == ""
        s.candCat := cat == "stop cap" ? "stop" : (cat == "no target" or cat == "min R" ? "target" : (cat == "filter" or cat == "stale fib" or cat == "no parent" ? "filter" : "other"))
    false''')
repl_fn('f_cxNewMdl','''f_cxNewMdl(int slot, Setup st, string meth) =>
    Mdl md = Mdl.new(slot = slot, dir = st.dir, dayKey = dkey, sid = st.id, xExt = st.ext, meth = meth)
    plans.push(md)
    while plans.size() > 150
        plans.shift()
    st.candN += 1
    f_cxFn(md, 4)
    md''')
# target audit
repl_fn('f_cxTarget','''f_cxTarget(int d, float entry) =>
    Lvl best = na
    float rejPx = na
    string rej = ""
    for lv in lvls
        if lv.side == d and (d > 0 ? lv.px > entry + tk : lv.px < entry - tk)
            if lv.st < 2 and lv.known <= time_close
                if na(best) or (d > 0 ? lv.px < best.px : lv.px > best.px)
                    best := lv
            else if na(rejPx) or (d > 0 ? lv.px < rejPx : lv.px > rejPx)
                rejPx := lv.px
                rej := lv.ty + " " + str.tostring(lv.px, format.mintick) + (lv.st == 2 ? " swept " + f_hm(lv.swT) : " not yet known")
    string aud = "no eligible level"
    if not na(best)
        aud := best.ty + " L" + str.tostring(best.id) + " " + str.tostring(best.px, format.mintick) + " origin " + str.format_time(best.origin, "MM-dd HH:mm", TZ) + " known " + str.format_time(best.known, "MM-dd HH:mm", TZ) + " " + (best.st == 1 ? "touched, unswept" : "untouched")
        if not na(rejPx) and (d > 0 ? rejPx < best.px : rejPx > best.px)
            aud += " | nearer but ineligible: " + rej
    [best, aud]''')
rep("            string tt = \"liquidity\"\n","            string tt = \"liquidity\"\n            string aud = \"fixed R\"\n")
rep("                tl := f_cxTarget(st.dir, entry)\n                tgt := na(tl) ? na : tl.px","                [tl0, aud0] = f_cxTarget(st.dir, entry)\n                tl := tl0\n                aud := aud0\n                tgt := na(tl) ? na : tl.px")
rep("                    md.tgtTy := na(tl) ? \"fixed-R\" : tl.ty\n","                    md.tgtTy := na(tl) ? \"fixed-R\" : tl.ty\n                    md.tgtAud := aud\n                    st.candArmed := true\n")
rep("\" | plan \" + str.tostring(md.plannedR, \"#.0\") + \"R \" + md.tgtType + (md.plannedR >= 4.0 ? \" (4R+)\" : \"\"), meth = md.meth, sid = md.sid)","\" | plan \" + str.tostring(md.plannedR, \"#.0\") + \"R \" + md.tgtType + (md.plannedR >= 4.0 ? \" (4R+)\" : \"\") + \" | tgt \" + md.tgtAud, meth = md.meth, sid = md.sid)")
open(P,'w').write(src)
print('ui1 ok')
