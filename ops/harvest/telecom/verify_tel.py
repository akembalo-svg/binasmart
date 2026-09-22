import json,os,subprocess,sys
# BINA_SERVER=user@host, no default (see README.md). BINA_REMOTE_DIR overrides where the harvest lives.
SERVER=os.environ.get("BINA_SERVER","")
REMOTE=os.environ.get("BINA_REMOTE_DIR","/root/storage/packs/telecom-manual")
if not SERVER: sys.exit("set BINA_SERVER=user@host first")
BASE=os.path.dirname(os.path.abspath(__file__))
tot_ok=tot_bad=0
for h in sys.argv[1:]:
    D=os.path.join(BASE,"out","telecom",h)
    rows=[json.loads(l) for l in open(os.path.join(D,"manifest.jsonl"),encoding="utf-8")]
    saved=[r for r in rows if r.get("file")]
    r=subprocess.run(["ssh","-o","BatchMode=yes",SERVER,"cd %s/%s && sha256sum *.html *.pdf *.json *.xml 2>/dev/null"%(REMOTE,h)],capture_output=True,timeout=110)
    rem={}
    for line in r.stdout.decode().splitlines():
        d,n=line.split(None,1); rem[n.strip().lstrip("*")]=d
    ok=bad=miss=0
    for e in saved:
        d=rem.get(e["file"])
        if d is None: miss+=1; print("MISSING",e["file"],e["url"])
        elif d!=e["sha256"]: bad+=1; print("DIFF",e["file"])
        else: ok+=1
    # ancillary files: compare sha of local vs remote for manifest.json README.md sums.txt manifest.jsonl
    anc=0
    for n in ("manifest.json","manifest.jsonl","README.md","sums.txt"):
        import hashlib
        ld=hashlib.sha256(open(os.path.join(D,n),"rb").read()).hexdigest()
        rr=subprocess.run(["ssh","-o","BatchMode=yes",SERVER,"sha256sum %s/%s/%s"%(REMOTE,h,n)],capture_output=True,timeout=60)
        if rr.stdout.decode().split()[:1]==[ld]: anc+=1
        else: print("ANC DIFF",n)
    extra=set(rem)-set(e["file"] for e in saved)
    print("%s manifest=%d verified=%d mismatched=%d missing=%d extra=%d ancillary_ok=%d/4"%(h,len(saved),ok,bad,miss,len(extra),anc))
    tot_ok+=ok; tot_bad+=bad+miss
print("TOTAL verified",tot_ok,"problems",tot_bad)
