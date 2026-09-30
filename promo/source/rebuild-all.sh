#!/bin/bash
# film8.html (mk_film8.py で生成済み) から派生物をすべて作り直す。小さいものから順に。
cd "$(dirname "$0")"
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
mux() { # <video.mov> <audio.wav> <out.mp4> <volume dB>
  ffmpeg -y -loglevel error -i "$1" -i "$2" -map 0:v -map 1:a -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -movflags +faststart \
    -c:a aac -b:a 256k -af "volume=$4dB,alimiter=limit=0.9:level=false" -shortest "$3"
}
python3 mk_short.py && python3 mk_clips.py && python3 mk_shelf.py || exit 1
for spec in "sync 8.63" "search 6.7" "shelf 9.0"; do set -- $spec; bash render-one.sh $1 $2; done
echo "CLIPS_DONE"
rm -rf $S/videoS_seg $S/videoS.mov
FILM=film_s.html DUR=15.75 node render-all.mjs $S/videoS.mov 240 > $S/renderS.log 2>&1
mux $S/videoS.mov audioS.wav ../bridge-pr-multidevice-16s.mp4 2
echo "SHORT_DONE"
rm -rf $S/video8_seg $S/video8.mov
FILM=film8.html DUR=45.6 node render-all.mjs $S/video8.mov 240 > $S/render8.log 2>&1
mux $S/video8.mov audio8.wav ../bridge-pr-multidevice-46s.mp4 3.8
ffmpeg -y -loglevel error -ss 36.7 -i ../bridge-pr-multidevice-46s.mp4 -frames:v 1 ../bridge-pr-multidevice-poster.png
echo "REBUILD_FINISHED"
