#!/bin/bash
# usage: clipstills.sh <film.html> <dur> t1 t2 ...   → stills_<film>/tX.XX.png
cd "$(dirname "$0")"
f=$1; d=$2; shift 2
rm -rf stills stills_$f; mkdir -p stills_$f
FILM=$f DUR=$d node render.mjs stills "$@" 2>&1 | tail -1
mv stills/*.png stills_$f/
