import sys,json
sys.path.insert(0,'.')
from common import Fetcher
f=Fetcher("x","out/_recon",delay=5,persistent=True)
res={}
for name,u in [("pages","https://www.eca.et/wp-json/wp/v2/pages?per_page=100&_fields=link,title,modified"),
 ("posts","https://www.eca.et/wp-json/wp/v2/posts?per_page=100&_fields=link,title,modified"),
 ("media","https://www.eca.et/wp-json/wp/v2/media?per_page=100&_fields=source_url,mime_type,media_details&mime_type=application/pdf")]:
    for pg in (1,2,3):
        st,h,b=f.raw(u+"&page=%d"%pg)
        print(name,pg,st,len(b),h.get('X-WP-TotalPages'),h.get('X-WP-Total'))
        if st!=200: break
        res.setdefault(name,[]).extend(json.loads(b))
        if pg>=int(h.get('X-WP-TotalPages') or 1): break
json.dump(res,open("out/_recon/eca_rest.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
for k,v in res.items():
    print(k,len(v))
    for x in v: print("  ",x.get('link') or x.get('source_url'),(x.get('title') or {}).get('rendered','') if isinstance(x.get('title'),dict) else '')
