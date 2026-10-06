import re
P='/home/user/prestonhillestates/H_Ticks_C_10AM_Precision.pine'
src=open(P).read()
def rep(a,b,c=1):
    global src
    n=src.count(a); assert n==c,(a[:80],n); src=src.replace(a,b)
def fn_span(name):
    i=src.index('\n'+name+'(')+1
    m=re.search(r'\n(?=\S)', src[i+len(name):]); return i, i+len(name)+m.start()+1
# inputs
lines=src.split('\n')
lines=[l for l in lines if not re.match(r'^(?:bool|int|float|string) (inFChop|inChopN|inChopMin|inSmt|inSmtSym|inSmtLook) = input\.',l)]
src='\n'.join(lines)
rep('[esH, esL] = request.security(inSmt != "Off" ? inSmtSym : syminfo.tickerid, "1", [high, low])\n','')
rep("    int smt = -1\n","")
for v in ("sBt = array.new_int(0)","sEsL = array.new_float(0)","sEsH = array.new_float(0)","sNqL = array.new_float(0)","sNqH = array.new_float(0)"):
    t=("var array<int> " if 'int' in v.split('=')[1] else "var array<float> ")+v+"\n"
    rep(t,"")
i,j=fn_span('f_cxSmt'); 
# also swallow the comment line above f_cxSmt
k=src.rfind('\n',0,i-1)+1
if src[k:i].startswith('//'): i=k
src=src[:i]+src[j:]
rep('    if inSmt != "Off"\n        st.smt := f_cxSmt(st)\n','')
i=src.index('    if r == "" and inFChop'); j=src.index('    r\n',i)
src=src[:i]+src[j:]
i=src.index('    // SMT buffers (1m)'); j=src.index('    // 1) level statuses')
src=src[:i]+src[j:]
rep("not implemented: NWOG/NDOG, trailing, SMT target role","not implemented: NWOG/NDOG, SMT, chop filter")
open(P,'w').write(src)
print('trimmed')
