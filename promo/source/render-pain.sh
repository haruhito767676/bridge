#!/bin/bash
# サイト用「こんなこと」動画: clip_pain.html を 1 本で書き出して、章ごとの mp4 へ切り出す (1280x720)
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
OUT=../../site/public/media
rm -rf $S/clip_pain_seg $S/clip_pain.mov
FILM=clip_pain.html DUR=41.0 node render-all.mjs $S/clip_pain.mov 240 > $S/clip_pain.log 2>&1
i=0
for spec in "mail 0 10.6" "slack 10.6 10.8" "cloud 21.4 10.6" "roundtrip 32.0 9.0"; do
  set -- $spec
  ffmpeg -y -loglevel error -ss $2 -t $3 -i $S/clip_pain.mov -an -vf "scale=1280:720:flags=lanczos" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart $OUT/pain-$1.mp4
  ffmpeg -y -loglevel error -ss $(echo "$3 / 2" | bc -l) -i $OUT/pain-$1.mp4 -frames:v 1 -q:v 3 $OUT/pain-$1.jpg
done
echo done pain
