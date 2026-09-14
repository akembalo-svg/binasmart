#!/bin/sh
# OCR one column of a scanned bilingual gazette: ocr-column.sh <pdf> <out.txt> <left|right|full> <lang> [x-split-fraction]
# The English column of a Negarit Gazette is the right half; tesseract reads it far better alone, in eng only.
pdf=$1; out=$2; side=$3; lang=$4; frac=${5:-0.48}
tmp=$(mktemp -d)
pages=$(pdfinfo "$pdf" | awk '/^Pages:/{print $2}')
: > "$out"
p=1
while [ "$p" -le "$pages" ]; do
  size=$(pdfinfo -f $p -l $p "$pdf" | awk '/^Page.*size:/{print $4, $6; exit}')
  w=$(echo "$size" | awk '{printf "%d", $1*300/72}'); h=$(echo "$size" | awk '{printf "%d", $2*300/72}')
  case $side in
    right) x=$(echo "$w $frac" | awk '{printf "%d", $1*$2}'); cw=$((w - x)) ;;
    left)  x=0; cw=$(echo "$w $frac" | awk '{printf "%d", $1*(1-$2)}') ;;
    *)     x=0; cw=$w ;;
  esac
  pdftoppm -f $p -l $p -r 300 -x $x -y 0 -W $cw -H $h -gray -png "$pdf" "$tmp/pg" >/dev/null 2>&1
  img=$(ls "$tmp"/pg*.png | head -1)
  printf '\n\n=== page %s ===\n' "$p" >> "$out"
  tesseract "$img" - -l "$lang" --psm 4 2>/dev/null >> "$out"
  rm -f "$tmp"/pg*.png
  p=$((p + 1))
done
rmdir "$tmp"
echo "ocr done: $out ($pages pages)"
