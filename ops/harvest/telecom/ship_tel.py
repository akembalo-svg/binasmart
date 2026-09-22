"""Ship out/telecom/<host>/ to the server over ssh (base64 on stdin, no scp).
usage: ship_tel.py <host> [--verify]
Resumable: compares remote size listing, resends only missing/short files.
"""
import base64, gzip, hashlib, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
# BINA_SERVER=user@host names the server that receives the harvest. There is deliberately no default: an
# address written in a public repository is an address for everyone.
SERVER = os.environ.get("BINA_SERVER", "")
if not SERVER:
    sys.exit("set BINA_SERVER=user@host first (the server that receives the harvest)")
HOST = sys.argv[1]
LOCAL = os.path.join(BASE, "out", "telecom", HOST)
REMOTE = os.environ.get("BINA_REMOTE_DIR", "/root/storage/packs/telecom-manual") + "/" + HOST
CHUNK = 4000000  # raw bytes per ssh call


def ssh(cmd, data=None, timeout=110):
    return subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", SERVER, cmd],
                          input=data, capture_output=True, timeout=timeout)


def remote_sizes():
    r = ssh("mkdir -p %s && find %s -maxdepth 1 -type f -printf '%%f %%s\\n'" % (REMOTE, REMOTE))
    m = {}
    for line in r.stdout.decode().splitlines():
        p = line.rsplit(" ", 1)
        if len(p) == 2 and p[1].isdigit():
            m[p[0]] = int(p[1])
    return m


def send(name, path):
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        first = True
        while True:
            chunk = fh.read(CHUNK)
            if not chunk and not first:
                break
            op = ">" if first else ">>"
            r = ssh("base64 -d | gunzip %s %s/%s.part" % (op, REMOTE, name), base64.b64encode(gzip.compress(chunk, 6)))
            if r.returncode != 0:
                return False
            first = False
            if len(chunk) < CHUNK:
                break
    r = ssh("mv %s/%s.part %s/%s" % (REMOTE, name, REMOTE, name))
    return r.returncode == 0


def main():
    files = sorted(f for f in os.listdir(LOCAL) if os.path.isfile(os.path.join(LOCAL, f))
                   and not f.endswith(".log") and f != "manifest.jsonl.tmp")
    deadline = time.time() + 100
    rs = remote_sizes()
    todo = [f for f in files if rs.get(f) != os.path.getsize(os.path.join(LOCAL, f))]
    print("%s local=%d remote=%d todo=%d" % (HOST, len(files), len(rs), len(todo)), flush=True)
    def one(f):
        if time.time() > deadline:
            return False
        try:
            return send(f, os.path.join(LOCAL, f))
        except Exception as e:
            print("ERR", f, e, flush=True)
            return False
    with ThreadPoolExecutor(5) as ex:
        n = sum(1 for ok in ex.map(one, todo) if ok)
    print("sent %d this call, remaining %d" % (n, len(todo) - n), flush=True)


main()
