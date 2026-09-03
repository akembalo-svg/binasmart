#!/bin/bash
# Render a news/tender share card to public/og-<slug>.png, at the size the meta actually declares.
#
#   ops/og/render-card.sh <template.html> <slug> [--keep]
#
# Why this exists: the card templates are already 1200x630 in CSS, but they were being rendered with
# a 2x device scale, so every file landed at 2400x1260 and four times the weight. newsShell() declares
# og:image:width 1200 / height 630, and no platform renders larger than that, so the extra pixels were
# thrown away by every consumer. This script pins the correct invocation so it cannot drift again.
#
# The filename matters: ogFor() in server.js looks for public/og-<slug>.png by convention and silently
# falls back to the generic bina-news.png if it is not there. The slug must match the post slug exactly.
set -euo pipefail

TPL="${1:-}"; SLUG="${2:-}"; KEEP="${3:-}"
if [ -z "$TPL" ] || [ -z "$SLUG" ]; then
  echo "usage: $0 <template.html> <slug> [--keep]" >&2
  echo "   e.g: $0 /root/card-nyc.html nyc-schools-ai-ban" >&2
  exit 2
fi
[ -f "$TPL" ] || { echo "no such template: $TPL" >&2; exit 1; }
case "$SLUG" in *[!a-z0-9-]*) echo "slug must be lowercase letters, digits and hyphens: $SLUG" >&2; exit 1;; esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/public/og-$SLUG.png"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Chromium cannot read from every directory under snap confinement; copy the template next to $HOME.
# Not a hidden directory: AppArmor blocks dotdirs for the chromium snap, and the render fails silently.
WORK="$HOME/og-render"
mkdir -p "$WORK"
cp "$TPL" "$WORK/card.html"

# 1200x630 at scale 1. --force-device-scale-factor=1 is the whole point: without it the output is 2x.
chromium-browser --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot="$WORK/card.png" --virtual-time-budget=8000 \
  "file://$WORK/card.html" >/dev/null 2>&1 || true

[ -s "$WORK/card.png" ] || { echo "render produced nothing — check the template" >&2; exit 1; }

DIM=$(identify -format '%wx%h' "$WORK/card.png")
[ "$DIM" = "1200x630" ] || echo "warning: rendered $DIM, expected 1200x630 (check the template's html/body size)" >&2

RAW=$(stat -c%s "$WORK/card.png")
pngquant --quality=70-92 --speed 1 --force --output "$TMP/opt.png" "$WORK/card.png" 2>/dev/null || cp "$WORK/card.png" "$TMP/opt.png"
OPT=$(stat -c%s "$TMP/opt.png")
# Never ship a "smaller" file that is actually bigger.
[ "$OPT" -lt "$RAW" ] || cp "$WORK/card.png" "$TMP/opt.png"

if [ -f "$OUT" ]; then
  BK="/root/storage/og-backup-replaced"; mkdir -p "$BK"
  cp -p "$OUT" "$BK/og-$SLUG.$(date +%s).png"
  echo "replacing an existing card (previous copy kept in $BK)"
fi
cp "$TMP/opt.png" "$OUT"

printf 'wrote %s\n  %s  %.0f KB raw -> %.0f KB\n' "$OUT" "$DIM" "$(echo "$RAW/1024" | bc -l)" "$(echo "$(stat -c%s "$OUT")/1024" | bc -l)"
echo "  og:image will be https://bina.et/static/og-$SLUG.png"
echo "  it is served only if the post slug is exactly: $SLUG"
[ "$KEEP" = "--keep" ] && echo "  template kept at $WORK/card.html" || rm -f "$WORK/card.html" "$WORK/card.png"
exit 0
