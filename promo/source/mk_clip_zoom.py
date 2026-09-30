#!/usr/bin/env python3
"""サイト用: iMac の Slack ウィンドウ (ポップアップ) だけを大きく映す画角。
   clip_search_zoom.html      … ダーク (README 用と同じ配色)
   clip_search_zoom_light.html … ライト (サイトは白基調なので、こちらを使う)
   カメラ v4 (iMac 全体) を、Slack ウィンドウ + ポップアップの範囲 (画面座標 720x540) に寄せる。
   1920x1080 で書き出したあと、中央 1440x1080 (4:3) を切り出す (render-zoom.sh)。"""
s = open('clip_search.html', encoding='utf8').read()
a = "v4: { cx: -1720, cy: -25, s: 1.1 }"
assert s.count(a) == 1
# 画面座標 (420, 375) が中心: iMac の画面の原点は世界座標 (-2440, -430)
dark = s.replace(a, "v4: { cx: -2020, cy: -55, s: 2.0 }")
open('clip_search_zoom.html', 'w', encoding='utf8').write(dark)

LIGHT_CSS = """
.wp-imac{background:radial-gradient(60% 80% at 85% 92%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(70% 80% at 10% 15%,#9fe8d3 0%,rgba(159,232,211,0) 62%),radial-gradient(50% 60% at 55% 55%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(160deg,#e3f4ff,#e8e4ff)}
.slack{background:#fff;color:#1d1c1d}
.win.slack .bar{color:rgba(0,0,0,.6)}
.slack .msg .b1{background:rgba(0,0,0,.2)}
.slack .msg .b2{background:rgba(0,0,0,.1)}
.slack .stxt{color:#1d1c1d}
.slack .inp{background:rgba(0,0,0,.025);box-shadow:inset 0 0 0 1px rgba(0,0,0,.2);color:#1d1c1d}
.slack .inp span.pt i{background:rgba(10,132,255,.22)}
#slkSent div[style*="mono"]{color:#0a66d8!important}
.popglass{background:rgba(250,250,252,.82);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.16),0 24px 70px rgba(0,0,0,.28)}
#fade{background:#f6f7fa!important}
"""
light = dark.replace('ui/plates/popup/', 'ui/plates/popup-light/')
assert 'popup-light' in light
assert light.count('</style>') >= 1
light = light.replace('</style>', LIGHT_CSS + '</style>', 1)
open('clip_search_zoom_light.html', 'w', encoding='utf8').write(light)
print('clip_search_zoom.html / clip_search_zoom_light.html written')
