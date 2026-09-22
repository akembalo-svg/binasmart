import sys,os,json,re,html
sys.path.insert(0,'.')
from common import Fetcher
OUT='out/telecom/www.eca.et'
f=Fetcher("www.eca.et",OUT,delay=5,persistent=True)
f.resume()
for name,u in [("pages","https://www.eca.et/wp-json/wp/v2/pages?per_page=100"),
 ("posts","https://www.eca.et/wp-json/wp/v2/posts?per_page=100"),
 ("media-pdf","https://www.eca.et/wp-json/wp/v2/media?per_page=100&mime_type=application/pdf")]:
    if u in f.seen: continue
    f.seen.add(u)
    st,ct,b=f.get(u)
    if st==200:
        e=f.save(u,st,ct,b,kind="json",lang="en",extra={"kind":"index"})
        f.log("OK %s %d"%(u,len(b)))
        if name=="pages":
            for p in json.loads(b):
                t=re.sub(r'<[^>]+>',' ',html.unescape(p['content']['rendered'])); t=' '.join(t.split())
                print(p['link'],len(t),t[:150])
f.write_manifest()
