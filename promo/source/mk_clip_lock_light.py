#!/usr/bin/env python3
"""サイト用 (ライト): 「あなただけに、届く。」の南京錠クリップ。clip_lock.html (mk_clips.py) から、ライトの見た目に変えたもの。
   パネルが南京錠になって閉じ、運ばれ、相手の画面で開く。壁紙・パネル・錠の色・軌跡をサイトの明るい配色にする。
   終わりの状態を 1.5 秒止めてから、フェードして頭に戻る。1920x1080 で書き出す → 1600x900 (render-crop.sh)"""
s = open('clip_lock.html', encoding='utf8').read()

def rep(a, b, n=1):
    global s
    assert s.count(a) == n, (s.count(a), a[:70])
    s = s.replace(a, b)

assert 'ui/plates/' in s
s = s.replace('ui/plates/', 'ui/plates-light/')
rep('<title>Bridge clip: lock</title>', '<title>Bridge clip: lock (light)</title>')
WALL = ('radial-gradient(70% 60% at 92% 96%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(70% 60% at 6% 8%,#9fe8d3 0%,rgba(159,232,211,0) 62%),'
        'radial-gradient(60% 50% at 50% 50%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(160deg,#e3f4ff,#e8e4ff)')
CSS = f"""
#s2,#s2bg{{background:{WALL}!important}}
.glow{{display:none!important}}
.panel.glass{{border-radius:14px!important;background:rgba(250,250,251,.86)!important;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12),0 26px 64px -20px rgba(20,20,25,.34),0 0 0 1px rgba(0,0,0,.05)!important}}
.panel.fluent{{background:#fbfbfc!important;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1),0 26px 64px -20px rgba(20,20,25,.34)!important}}
#fade{{background:#f6f7fa!important}}
"""
assert s.count('</style>') == 1
s = s.replace('</style>', CSS + '</style>')
# 錠: 影の色 / 弦の色 (明るい背景でも見えるように) / 軌跡と波紋はアクセントの青
rep('0 50px 110px rgba(0,20,120,.55)', '0 40px 90px rgba(30,40,90,.38)')
rep('<stop offset="0" stop-color="#f4f5f8"/><stop offset="1" stop-color="#c9ccd6"/>', '<stop offset="0" stop-color="#c3c8d6"/><stop offset="1" stop-color="#8189a0"/>')
rep("c.setAttribute('stroke', '#fff'); $('rings')", "c.setAttribute('stroke', '#0a84ff'); $('rings')")
rep("p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-linecap', 'round'", "p.setAttribute('stroke', '#0a84ff'); p.setAttribute('stroke-linecap', 'round'")
# 終わりを止める
import re
m = re.search(r'T0 = ([\d.]+), D = ([\d.]+);', s); assert m
T0, D = m.group(1), float(m.group(2))
rep(m.group(0), f'T0 = {T0}, D0 = {D}, D = {D + 1.5};')
rep('orig(T0 + t);', 'orig(T0 + Math.min(t, D0 - .1));')
open('clip_lock_light.html', 'w', encoding='utf8').write(s)
print('clip_lock_light.html dur', D + 1.5)
