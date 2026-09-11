# -*- coding: utf-8 -*-
"""Hide or re-open the public repo, and keep the website honest either way.

  python3 repo_visibility.py hide      # repo private, pages stop claiming it is open
  python3 repo_visibility.py restore   # repo public, pages say so again
  python3 repo_visibility.py status

Why this is not just `gh repo edit --visibility`: five places on the live site point at the repo, and
two of them make a claim that a visitor can check. If the repo goes private and the pages still say
"ክፍት ምንጭ" with a link, every visitor gets a 404 and a statement that is no longer true. A broken
promise on the page is worse than either state, so visibility and wording move together.

Separately, and regardless of hiding: both pages say "The harness is public at github.com/...", and
the harnesses were made private earlier this evening. That sentence is already false and is corrected
in both modes.
"""
import re, subprocess, sys

ROOT = "/var/www/connectcare/binasmart/"
REPO = "akembalo-svg/binasmart"
AM, OM, LLMS = ROOT + "public/amharic-ai.html", ROOT + "public/oromo-ai.html", ROOT + "public/llms.txt"

mode = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()

# ---------------------------------------------------------------- the wording, both ways
# (file, public text, private text)
SWAPS = [
    (AM, "ክፍት ምንጭ — github.com/akembalo-svg/binasmart",
         "የቢናስማርት የራሱ ኮድ — በአዲስ አበባ የተጻፈ"),
    (OM, "Banaa &mdash; github.com/akembalo-svg/binasmart",
         "Koodii mataa BinaSmart &mdash; Finfinnee keessatti barreeffame"),
    (LLMS, "- Source code: https://github.com/akembalo-svg/binasmart",
           "- Source code: proprietary, not public at this time"),
]

# This one is corrected in BOTH modes: the harnesses came out of the repo this evening, so "the
# harness is public" is false either way. What stays true is that the method is described in full.
HARNESS_OLD = re.compile(
    r"The harness is public at <a href=\"https://github\.com/akembalo-svg/binasmart\">"
    r"github\.com/akembalo-svg/binasmart</a>[^.]*\.")
HARNESS_NEW = ("The method is described in full above so it can be reproduced independently; "
               "the harness itself is not published.")


def gh_visibility():
    r = subprocess.run(["gh", "repo", "view", REPO, "--json", "visibility", "-q", ".visibility"],
                       capture_output=True, text=True)
    return r.stdout.strip() or ("error: " + r.stderr.strip()[:80])


def set_visibility(v):
    r = subprocess.run(["gh", "repo", "edit", REPO, "--visibility", v, "--accept-visibility-change-consequences"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("  gh failed: " + (r.stderr or r.stdout)[:300])
        return False
    return True


def apply_text(private):
    changed = 0
    for path, pub, priv in SWAPS:
        s = open(path, encoding="utf-8").read()
        want, other = (priv, pub) if private else (pub, priv)
        if other in s:
            s = s.replace(other, want)
            open(path, "w", encoding="utf-8").write(s)
            changed += 1
            print("  %-24s -> %s" % (path.split("/")[-1], "private wording" if private else "public wording"))
        elif want in s:
            print("  %-24s already correct" % path.split("/")[-1])
    # the harness sentence, corrected either way
    for path in (AM, OM):
        s = open(path, encoding="utf-8").read()
        if HARNESS_OLD.search(s):
            open(path, "w", encoding="utf-8").write(HARNESS_OLD.sub(HARNESS_NEW, s))
            print("  %-24s corrected the 'harness is public' claim" % path.split("/")[-1])
            changed += 1
    return changed


print("repo %s is currently: %s" % (REPO, gh_visibility()))

if mode == "status":
    for path, pub, priv in SWAPS:
        s = open(path, encoding="utf-8").read()
        print("  %-24s %s" % (path.split("/")[-1],
              "says PUBLIC" if pub in s else ("says private" if priv in s else "neither?")))
    sys.exit(0)

if mode == "hide":
    if set_visibility("private"):
        print("repo set to PRIVATE")
        apply_text(private=True)
elif mode == "restore":
    if set_visibility("public"):
        print("repo set to PUBLIC")
        apply_text(private=False)
else:
    print("usage: repo_visibility.py hide|restore|status")
    sys.exit(2)

print("\nnow: %s" % gh_visibility())
