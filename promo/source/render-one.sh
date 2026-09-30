#!/bin/bash
# usage: render-one.sh <name> <dur>   (clip_<name>.html → ../clips/bridge-clip-<name>.mp4)
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
n=$1; d=$2
mkdir -p ../clips
rm -rf $S/clip_${n}_seg $S/clip_$n.mov
FILM=clip_$n.html DUR=$d node render-all.mjs $S/clip_$n.mov 240 > $S/clip_$n.log 2>&1
ffmpeg -y -loglevel error -i $S/clip_$n.mov -an -vf scale=1280:720:flags=lanczos -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart ../clips/bridge-clip-$n.mp4
echo "done $n"
