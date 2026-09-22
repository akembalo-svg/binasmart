import sys,os
sys.path.insert(0,'.')
from common import Fetcher
f=Fetcher("x","out/_recon",delay=5,persistent=True)
for u in sys.argv[1:]:
    try:
        st,h,b=f.raw(u)
        print(u,st,len(b),h.get('Content-Type'),h.get('Location'))
        open("out/_recon/"+u.split('//')[1].replace('/','_')[:80],'wb').write(b)
    except Exception as e: print(u,"ERR",e)
