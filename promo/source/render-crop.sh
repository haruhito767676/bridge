#!/bin/bash
# usage: render-crop.sh <name> <dur> <out.mp4> <crop=W:H:X:Y> <scale=W:H>   (1920x1080 で書き出し → 切り出し → 縮小)
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
n=$1; d=$2; out=$3; crop=$4; sc=$5
rm -rf $S/clip_${n}_seg $S/clip_$n.mov
FILM=clip_$n.html DUR=$d node render-all.mjs $S/clip_$n.mov 240 > $S/clip_$n.log 2>&1
ffmpeg -y -loglevel error -i $S/clip_$n.mov -an -vf "crop=$crop,scale=$sc:flags=lanczos" -c:v libx264 -preset slow -crf 19 -pix_fmt yuv420p -movflags +faststart $out
echo "done $n"
