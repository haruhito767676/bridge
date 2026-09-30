#!/bin/bash
# クリップ (mp4) → README 用のアニメーション WebP (docs/media/clip-*.webp)。15fps・幅 960px・ループ
cd "$(dirname "$0")/../.."
S=/private/tmp/claude-501/-Users-inoueharuhito-GitHub-bridge/411d1c0f-6b3f-46ea-8193-91c0fb7d1855/scratchpad
mkdir -p docs/media
for n in sync search shelf lock; do
  rm -rf $S/wp_$n && mkdir $S/wp_$n
  ffmpeg -y -loglevel error -i promo/clips/bridge-clip-$n.mp4 -vf "fps=15,scale=960:-1:flags=lanczos" $S/wp_$n/f%04d.png
  img2webp -loop 0 -lossy -q ${Q:-72} -m 4 -d 67 $S/wp_$n/f*.png -o docs/media/clip-$n.webp 2>&1 | tail -1
  ls -la docs/media/clip-$n.webp | awk '{print $5, $9}'
done
