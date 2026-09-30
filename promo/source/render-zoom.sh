#!/bin/bash
# サイト用の寄り画角クリップ: 1920x1080 で書き出し → 中央 1440x1080 (4:3) を切り出し → 1200x900
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
n=$1; d=$2; out=$3
rm -rf $S/clip_${n}_seg $S/clip_$n.mov
FILM=clip_$n.html DUR=$d node render-all.mjs $S/clip_$n.mov 240 > $S/clip_$n.log 2>&1
ffmpeg -y -loglevel error -i $S/clip_$n.mov -an -vf "crop=1440:1080:240:0,scale=1200:900:flags=lanczos" -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart $out
echo "done $n"
