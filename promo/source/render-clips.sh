#!/bin/bash
# クリップを書き出す: 1920x1080 ProRes → 1280x720 H.264 (無音、ループ向け)
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
OUT=../clips; mkdir -p $OUT
for spec in "sync 8.63" "search 6.7" "lock 4.5"; do
  set -- $spec; n=$1; d=$2
  rm -rf $S/clip_${n}_seg $S/clip_$n.mov
  FILM=clip_$n.html DUR=$d node render-all.mjs $S/clip_$n.mov 240 > $S/clip_$n.log 2>&1
  ffmpeg -y -loglevel error -i $S/clip_$n.mov -an -vf scale=1280:720:flags=lanczos -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart $OUT/bridge-clip-$n.mp4
  echo "done $n"
done
echo CLIPS_FINISHED
