#!/bin/bash
# Commit what a scheduled job wrote, and nothing else (1 Oct 2026). The monthly and weekly refreshes rewrote
# knowledge/banking (237 files) and knowledge/places and left them uncommitted, so the server's tree drifted from
# git every run. A job calls this with its OWN paths: they are staged (new, changed and deleted files) and committed
# with `git commit -- <paths>`, so nothing another session staged rides along. Never pushes.
#   ops/git-commit-own.sh "<message>" <path> [<path>...]
set -u
ROOT="${GIT_OWN_ROOT:-/var/www/connectcare/binasmart}"   # GIT_OWN_ROOT: tests only
MSG="${1:-}"; shift || true
[ -z "$MSG" ] || [ $# -eq 0 ] && { echo "[git-own] usage: git-commit-own.sh <message> <path>..."; exit 0; }
cd "$ROOT" || exit 0
[ -e .git/index.lock ] && { echo "[git-own] git busy (index.lock): nothing committed"; exit 0; }
git add -A -- "$@" 2>/dev/null
if git diff --cached --quiet -- "$@"; then echo "[git-own] nothing to commit in $*"; exit 0; fi
N=$(git diff --cached --name-only -- "$@" | wc -l)
git commit -q -m "$MSG ($N files)" -- "$@" && echo "[git-own] committed $(git log -1 --format=%h): $MSG ($N files)" || echo "[git-own] commit failed"
exit 0
