#!/usr/bin/env bash
# Give every published Amharic article a voice (Ogg + MP3 + length label), newest first, ONE AT A TIME.
# Owner's ask 27 Sep 2026: "add voice to more articles, but the site must not get busy". So each voice is made:
#   - at the lowest CPU and disk priority (nice 19, ionice idle), on 2 of the 4 cores (thread caps below),
#   - only when the 1-minute load is under LOAD_MAX (waits otherwise), and never two at once (flock).
# Measured on the first test (27 Sep): page median 0.628s before, 0.627s while a voice was being made.
# Articles that already have public/news/audio/<slug>.ogg are skipped, so the script can be re-run any time.
#   bash ops/news/voice-queue.sh            all missing voices (also nightly from cron, 00:15 UTC = 03:15 Addis)     LIMIT=5 bash ops/news/voice-queue.sh   first five
set -u
exec 9>/tmp/bina-voice-queue.lock; flock -n 9 || { echo "already running"; exit 0; }
cd /var/www/connectcare/binasmart || exit 1
unset NODE_CHANNEL_FD                       # a node child inherits it from some shells and aborts on exit
LOG=/root/storage/news-audio-backup/queue.log
LOAD_MAX=${LOAD_MAX:-4.5}; LIMIT=${LIMIT:-0}
SLUGS=$(node --env-file=.env -e "
const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient();
p.newsPost.findMany({ where: { published: true, lang: 'am' }, select: { slug: true }, orderBy: { publishedAt: 'desc' } })
 .then(r => { console.log(r.map(x => x.slug).join('\n')); return p.\$disconnect(); });")
done=0; failed=0; skipped=0; start=$(date +%s)
for s in $SLUGS; do
  [ -f "public/news/audio/$s.ogg" ] && { skipped=$((skipped+1)); continue; }
  [ "$LIMIT" -gt 0 ] && [ $((done+failed)) -ge "$LIMIT" ] && break
  while awk -v m="$LOAD_MAX" '{exit !($1 > m)}' /proc/loadavg; do echo "$(date -u +%FT%TZ) load $(cut -d' ' -f1 /proc/loadavg) > $LOAD_MAX, waiting" >> "$LOG"; sleep 120; done
  t0=$(date +%s); echo "$(date -u +%FT%TZ) START $s" >> "$LOG"
  if nice -n 19 ionice -c3 env OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 \
       node --env-file=.env ops/news/make-audio.js "$s" >> "$LOG" 2>&1 && [ -f "public/news/audio/$s.mp3" ]; then
    done=$((done+1)); echo "$(date -u +%FT%TZ) DONE $s in $(( $(date +%s)-t0 ))s" >> "$LOG"
  else
    failed=$((failed+1)); echo "$(date -u +%FT%TZ) FAILED $s" >> "$LOG"
  fi
done
mins=$(( ($(date +%s)-start)/60 ))
# Nightly run (cron 00:15 UTC): stay quiet on nights with nothing new - only report when a voice was made or failed.
[ $((done+failed)) -eq 0 ] && { echo "$(date -u +%FT%TZ) nothing new" >> "$LOG"; exit 0; }
MSG="🔊 Article voices - batch finished
New voices: $done · failed: $failed · already had one: $skipped
Time: $mins min, one at a time at low priority.
Every voiced article plays on Android and iPhone (Ogg + MP3). Log: $LOG"
. /root/.config/gcc-monitor.env
curl -s -m 20 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" --data-urlencode "chat_id=${TG_CHAT}" --data-urlencode "text=${MSG}" \
  | python3 -c "import json,sys;print('telegram ok:',json.load(sys.stdin).get('ok'))" >> "$LOG" 2>&1
