"""Shared polite-fetch helpers for the BinaSmart banking-pack harvest.

Stdlib only (no requests on this machine).
"""
import gzip
import hashlib
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) BinaSmart-research (+https://bina.et)"

BASE = os.path.dirname(os.path.abspath(__file__))

_SSL_CTX = ssl.create_default_context()
_SSL_CTX_LAX = ssl.create_default_context()
_SSL_CTX_LAX.check_hostname = False
_SSL_CTX_LAX.verify_mode = ssl.CERT_NONE


class Fetcher:
    def __init__(self, host, outdir, delay=5.0, log_path=None, persistent=False):
        self.host = host
        self.outdir = outdir
        self.delay = delay
        self.last = 0.0
        self.consecutive_failures = 0
        self.manifest = []
        self.seen = set()
        os.makedirs(outdir, exist_ok=True)
        self.log_path = log_path or os.path.join(outdir, "progress.log")
        self.jsonl = os.path.join(outdir, "manifest.jsonl")
        self.lax_ssl = False
        # nbe.gov.et / ethiotelecom.et time out on ~half of NEW TCP connections but are
        # fast and reliable over a kept-alive one, so reuse a single connection per host.
        self.persistent = persistent
        self._conns = {}

    # ---- persistent-connection transport -------------------------------
    def _conn(self, scheme, netloc, fresh=False):
        import http.client
        key = (scheme, netloc)
        if fresh or key not in self._conns:
            old = self._conns.pop(key, None)
            if old is not None:
                try:
                    old.close()
                except Exception:
                    pass
            if scheme == "https":
                c = http.client.HTTPSConnection(
                    netloc, timeout=90,
                    context=(_SSL_CTX_LAX if self.lax_ssl else _SSL_CTX))
            else:
                c = http.client.HTTPConnection(netloc, timeout=90)
            self._conns[key] = c
        return self._conns[key]

    def _raw_persistent(self, url, timeout=90, _depth=0):
        p = urllib.parse.urlparse(url)
        scheme, netloc = p.scheme or "https", p.netloc
        # http.client needs a latin-1/ASCII request line, but NBE has Amharic-named
        # uploads, so percent-encode any non-ASCII (leaving existing %XX untouched).
        path = urllib.parse.quote(p.path or "/", safe="/%:@&=+$,~*'()!;")
        query = urllib.parse.quote(p.query, safe="%:@&=+$,~*'()!;/?")
        target = urllib.parse.urlunparse(("", "", path, p.params, query, ""))
        headers = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json,application/pdf,*/*",
            "Accept-Language": "en,am;q=0.8",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
            "Host": netloc,
        }
        last_err = None
        for fresh in (False, True):   # retry once on a fresh connection
            c = self._conn(scheme, netloc, fresh=fresh)
            try:
                c.timeout = timeout
                c.request("GET", target, headers=headers)
                r = c.getresponse()
                body = r.read()
                hdrs = dict(r.getheaders())
                enc = (hdrs.get("Content-Encoding") or hdrs.get("content-encoding") or "").lower()
                if enc == "gzip":
                    try:
                        body = gzip.decompress(body)
                    except Exception:
                        pass
                elif enc == "deflate":
                    try:
                        body = zlib.decompress(body, -zlib.MAX_WBITS)
                    except Exception:
                        pass
                # follow redirects ourselves
                if r.status in (301, 302, 303, 307, 308) and _depth < 5:
                    loc = hdrs.get("Location") or hdrs.get("location")
                    if loc:
                        nxt = urllib.parse.urljoin(url, loc)
                        if urllib.parse.urlparse(nxt).netloc != netloc:
                            return self.raw(nxt, delay=0, timeout=timeout)  # cross-host: plain urllib
                        return self._raw_persistent(nxt, timeout=timeout, _depth=_depth + 1)
                return r.status, hdrs, body
            except Exception as e:
                last_err = e
                try:
                    c.close()
                except Exception:
                    pass
                self._conns.pop((scheme, netloc), None)
        raise last_err

    def log(self, msg):
        line = "%s %s\n" % (time.strftime("%H:%M:%S"), msg)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(line)
        sys.stdout.write(line)
        sys.stdout.flush()

    def _sleep(self, delay=None):
        d = self.delay if delay is None else delay
        wait = d - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()

    def raw(self, url, delay=None, timeout=60):
        """Return (status, headers, body_bytes). Raises on hard failure."""
        self._sleep(delay)
        if self.persistent:
            return self._raw_persistent(url, timeout=max(timeout, 90))
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json,application/pdf,*/*",
            "Accept-Language": "en,am;q=0.8",
            "Accept-Encoding": "gzip, deflate",
        })
        ctx = _SSL_CTX_LAX if self.lax_ssl else _SSL_CTX
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                body = r.read()
                enc = (r.headers.get("Content-Encoding") or "").lower()
                if enc == "gzip":
                    try:
                        body = gzip.decompress(body)
                    except Exception:
                        pass
                elif enc == "deflate":
                    try:
                        body = zlib.decompress(body, -zlib.MAX_WBITS)
                    except Exception:
                        pass
                return r.status, dict(r.headers), body
        except urllib.error.HTTPError as e:
            body = b""
            try:
                body = e.read()
            except Exception:
                pass
            return e.code, dict(e.headers or {}), body

    def get(self, url, delay=None, timeout=60, retry=True):
        """Polite GET with one retry on 5xx/timeout. Returns (status, ctype, body) or (None, err, b'')."""
        for attempt in (0, 1):
            try:
                status, headers, body = self.raw(url, delay=delay, timeout=timeout)
                ctype = (headers.get("Content-Type") or headers.get("content-type") or "").split(";")[0].strip()
                if status >= 500 and attempt == 0 and retry:
                    self.log("RETRY %s (status %s)" % (url, status))
                    time.sleep(5)
                    continue
                if status >= 400:
                    self.consecutive_failures += 1
                else:
                    self.consecutive_failures = 0
                return status, ctype, body
            except Exception as e:
                if attempt == 0 and retry:
                    self.log("RETRY %s (%s: %s)" % (url, type(e).__name__, e))
                    time.sleep(5)
                    continue
                self.consecutive_failures += 1
                self.record_failure(url, "%s: %s" % (type(e).__name__, e))
                return None, "%s: %s" % (type(e).__name__, e), b""
        return None, "unreachable", b""

    def record_failure(self, url, err):
        entry = {"url": url, "status": None, "error": err,
                 "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        self.manifest.append(entry)
        with open(self.jsonl, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def save(self, url, status, ctype, body, kind=None, post_type=None, lang=None, extra=None):
        ext = kind or ext_for(ctype, url)
        name = hashlib.sha1(url.encode("utf-8")).hexdigest() + "." + ext
        path = os.path.join(self.outdir, name)
        with open(path, "wb") as f:
            f.write(body)
        entry = {
            "url": url,
            "file": name,
            "status": status,
            "contentType": ctype,
            "bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "title": title_of(body) if ext in ("html", "xml") else None,
            "postType": post_type,
            "lang": lang or lang_of(url, body if ext == "html" else b""),
        }
        if extra:
            entry.update(extra)
        self.manifest.append(entry)
        with open(self.jsonl, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry

    def fetch_and_save(self, url, post_type=None, delay=None, kind=None, max_bytes=15 * 1024 * 1024):
        if url in self.seen:
            return None
        self.seen.add(url)
        status, ctype, body = self.get(url, delay=delay)
        if status is None:
            self.log("FAIL %s -> %s" % (url, ctype))
            return None
        if status >= 400:
            self.record_failure(url, "HTTP %s" % status)
            self.log("HTTP %s %s" % (status, url))
            return None
        if len(body) > max_bytes:
            self.record_failure(url, "too large: %d bytes" % len(body))
            self.log("SKIP (too large %d) %s" % (len(body), url))
            return None
        e = self.save(url, status, ctype, body, kind=kind, post_type=post_type)
        self.log("OK %s %s (%d bytes, %s)" % (status, url, len(body), ctype))
        return e

    def resume(self):
        """Re-adopt everything a previous run already saved (by url) so a restart
        does not re-fetch it. Failure rows are NOT adopted - those get retried."""
        if not os.path.exists(self.jsonl):
            return 0
        kept, n = [], 0
        for line in open(self.jsonl, encoding="utf-8"):
            try:
                e = json.loads(line)
            except Exception:
                continue
            if not e.get("file"):
                continue
            if not os.path.exists(os.path.join(self.outdir, e["file"])):
                continue
            if e["url"] in self.seen:
                continue
            self.seen.add(e["url"])
            kept.append(e)
            n += 1
        # rewrite the jsonl with only the surviving rows, then keep appending
        with open(self.jsonl, "w", encoding="utf-8") as f:
            for e in kept:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
        self.manifest = kept
        self.log("RESUME: adopted %d already-saved URLs" % n)
        return n

    def write_manifest(self):
        path = os.path.join(self.outdir, "manifest.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.manifest, f, ensure_ascii=False, indent=1)
        return path

    def stop(self):
        return self.consecutive_failures >= 10


def ext_for(ctype, url):
    c = (ctype or "").lower()
    if "pdf" in c or url.lower().split("?")[0].endswith(".pdf"):
        return "pdf"
    if "json" in c:
        return "json"
    if "xml" in c or url.lower().split("?")[0].endswith(".xml"):
        return "xml"
    if "html" in c:
        return "html"
    if "msword" in c or url.lower().split("?")[0].endswith((".doc", ".docx")):
        return "docx" if url.lower().endswith("x") else "doc"
    if "excel" in c or "spreadsheet" in c or url.lower().split("?")[0].endswith((".xls", ".xlsx")):
        return "xlsx" if url.lower().endswith("x") else "xls"
    return "html"


_TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.I | re.S)


def title_of(body):
    m = _TITLE_RE.search(body[:200000])
    if not m:
        return None
    try:
        t = m.group(1).decode("utf-8", "replace")
    except Exception:
        return None
    t = re.sub(r"\s+", " ", t).strip()
    import html as _html
    return _html.unescape(t)[:300]


AMHARIC = re.compile(r"[ሀ-፿]")


def lang_of(url, body):
    p = urllib.parse.urlparse(url).path
    if p.startswith("/am/") or "/am/" in p or "/amharic" in p.lower():
        return "am"
    if body:
        try:
            txt = body.decode("utf-8", "ignore")
        except Exception:
            txt = ""
        hits = len(AMHARIC.findall(txt))
        if hits > 80:
            return "am"
    return "en"


HREF_RE = re.compile(rb'href\s*=\s*["\']([^"\'#]+)', re.I)
SRC_RE = re.compile(rb'(?:src|data-href|data-url)\s*=\s*["\']([^"\'#]+)', re.I)


def links(body, base_url):
    out = []
    for rx in (HREF_RE, SRC_RE):
        for m in rx.finditer(body):
            try:
                u = m.group(1).decode("utf-8", "ignore").strip()
            except Exception:
                continue
            if not u or u.startswith(("mailto:", "tel:", "javascript:", "data:")):
                continue
            out.append(urllib.parse.urljoin(base_url, u))
    return out


EXCLUDE_PAT = re.compile(
    r"(/wp-admin|/wp-login|/wp-json/wp/v2/users|/feed/?$|\?s=|/search|/\?p=|"
    r"/news|/event|/press|/career|/job-|/vacanc|/tender|/procure|/gallery|/photo|"
    r"/magazine|/birritu|/blog/page|/tag/|/author/|/comment|/cart|/checkout|/my-account|"
    r"/login|/signin|/register|/wp-content/uploads/.*\.(jpg|jpeg|png|gif|svg|webp|mp4|mp3|zip)$)",
    re.I)

ASSET_EXT = re.compile(r"\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff2?|ttf|eot|mp4|mp3|avi|zip|rar)(\?|$)", re.I)


def excluded(url):
    p = urllib.parse.urlparse(url)
    target = p.path + ("?" + p.query if p.query else "")
    if ASSET_EXT.search(target):
        return True
    if EXCLUDE_PAT.search(target):
        return True
    return False


def norm(url):
    p = urllib.parse.urlparse(url)
    path = p.path
    if path.endswith("/") and len(path) > 1:
        path = path[:-1]
    q = p.query
    # drop tracking / pagination noise
    if q:
        keep = [kv for kv in q.split("&") if not kv.split("=")[0].lower().startswith(("utm_", "fbclid", "gclid", "replytocom"))]
        q = "&".join(keep)
    return urllib.parse.urlunparse((p.scheme, p.netloc.lower(), path, "", q, ""))
