#!/usr/bin/env python3
"""サイト用 (ライト): 実際の操作どおりの「デバイスで絞り込む」クリップ。
   他デバイス出身の項目を右クリック → 「"会社用PC" のアイテムだけ表示」 → 絞り込み → チップの ✕ で解除。
   パネルを、PC の画面の右端 (壁紙の上) に映す。縦長 (720x1040) に切り取る (render-crop.sh 908:20)。
   パネルの画像は ui/plates-light (SCHEME=light node ui/plates.mjs)。"""
import json
FL0, K = 12.3, 1.25
TA0 = FL0 + .35; TP0 = TA0 + 6.28 * K; TH0 = TP0 + 8.35
man = json.load(open('ui/plates-light/manifest.json', encoding='utf8'))['mac']
ck = man['ctx']['click']; menu = man['ctx']['menu']; chip = man['chip']
item = next(i for i in menu['items'] if 'アイテムだけ表示' in i['text'])
HS, PX, PY = 1.62, 1090, 54
pt = lambda x, y: [round(PX + HS * x, 1), round(PY + HS * y, 1)]
A = pt(ck['x'], ck['y'])                                                   # 右クリックする位置
B = pt(item['left'] + item['width'] / 2, item['top'] + item['height'] / 2)  # メニューの項目
C = pt(chip['clear']['left'] + chip['clear']['width'] / 2, chip['clear']['top'] + chip['clear']['height'] / 2)   # チップの ✕

s = open('film8.html', encoding='utf8').read()
assert s.count('ui/plates/manifest.js') == 1
s = s.replace('ui/plates/', 'ui/plates-light/')
s = s.replace('<title>Bridge Multi-Device Film v8</title>', '<title>Bridge clip: filter (light)</title>')
CSS = """
#s2,#s2bg{background:#fbfbfa!important}
#wp{position:absolute;left:908px;top:20px;width:720px;height:1040px;background:radial-gradient(90% 55% at 90% 96%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(90% 55% at 8% 6%,#9fe8d3 0%,rgba(159,232,211,0) 62%),radial-gradient(80% 50% at 45% 50%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(170deg,#e3f4ff,#e8e4ff)}
.glow{display:none!important}
#camwrap{display:none!important}
#hlA,#hlB,#hlC,#hlD,#cursorH,#hring{display:none!important}
.panel.glass{border-radius:14px!important;background:rgba(250,250,251,.86)!important;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12),0 26px 64px -20px rgba(20,20,25,.34),0 0 0 1px rgba(0,0,0,.05)!important}
#fade{background:#f6f7fa!important}
#ctxWrap{position:absolute;left:0;top:0;width:320px;height:600px;transform-origin:0 0;visibility:hidden}
#ctxWrap img{position:absolute;left:0;top:0;width:320px;height:600px}
#curs{position:absolute;left:0;top:0;width:34px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.35));opacity:0}
"""
assert s.count('</style>') == 1
s = s.replace('</style>', CSS + '</style>')
a = '<div id="hero">'
assert s.count(a) == 1
s = s.replace(a, a + '<div id="wp"></div>')
D = 7.4
inject = f"""
<div id="ctxWrap" class="panel glass"><img id="ctxM" src="ui/plates-light/mac/ctx-menu.png"><img id="ctxH" src="ui/plates-light/mac/ctx-hover.png" style="opacity:0"></div>
<svg id="curs" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
<script>
(() => {{
  const orig = window.renderAt, TH0 = {TH0:.4f}, K = {K}, D = {D};
  const $ = id => document.getElementById(id);
  const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const ease = x => {{ x = cl(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }};
  const lerp = (a, b, p) => a + (b - a) * p;
  // film のヒーロー内の時間 t (9.55〜12.02) を、クリップの時間 c から対応づける (途中は操作のためにゆっくり)
  const KN = [[0, 9.55], [.9, 10.27], [3.0, 10.62], [3.6, 11.08], [4.7, 11.6], [5.2, 12.0], [5.9, 12.02]];
  const tOf = c => {{ for (let i = 1; i < KN.length; i++) if (c <= KN[i][0]) return lerp(KN[i - 1][1], KN[i][1], (c - KN[i - 1][0]) / (KN[i][0] - KN[i - 1][0])); return KN[KN.length - 1][1]; }};
  const A = {A}, B = {B}, C = {C}, S0 = [1740, 930];
  const HS = {HS}, PX = {PX}, PY = {PY};
  $('ctxWrap').style.transform = `translate(${{PX}}px,${{PY}}px) scale(${{HS}})`;
  $('s2').appendChild($('ctxWrap')); $('s2').appendChild($('curs'));
  const cpos = c => {{
    if (c < 1.55) return [lerp(S0[0], A[0], ease((c - .9) / .65)), lerp(S0[1], A[1], ease((c - .9) / .65))];
    if (c < 1.95) return A;
    if (c < 2.5) return [lerp(A[0], B[0], ease((c - 1.95) / .55)), lerp(A[1], B[1], ease((c - 1.95) / .55))];
    if (c < 3.9) return B;
    if (c < 4.6) return [lerp(B[0], C[0], ease((c - 3.9) / .7)), lerp(B[1], C[1], ease((c - 3.9) / .7))];
    if (c < 5.0) return C;
    return [lerp(C[0], C[0] + 90, ease((c - 5.0) / .9)), lerp(C[1], C[1] + 60, ease((c - 5.0) / .9))];
  }};
  window.renderAt = c => {{
    orig(TH0 + (tOf(c) - 9.55) * K);
    $('s2').style.opacity = 1;
    const menuOn = c >= 1.6 && c < 3.0, hov = c >= 2.45;
    $('ctxWrap').style.visibility = menuOn ? 'visible' : 'hidden';
    $('ctxH').style.opacity = hov ? 1 : 0;
    $('hpanel').style.visibility = menuOn ? 'hidden' : '';
    const p = cpos(c), pressed = (c > 1.55 && c < 1.65) || (c > 2.96 && c < 3.06) || (c > 4.64 && c < 4.74);
    $('curs').style.transform = `translate3d(${{p[0].toFixed(1)}}px,${{p[1].toFixed(1)}}px,0) scale(${{pressed ? .86 : 1}})`;
    $('curs').style.opacity = (cl((c - .85) / .12) * (1 - cl((c - 5.35) / .4))).toFixed(3);
    $('fade').style.opacity = Math.max(1 - cl(c / .3), cl((c - (D - .35)) / .35)).toFixed(3);
  }};
  window.__ready = window.__ready.then(async () => {{ await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => {{ i.onload = i.onerror = r; }}))); window.renderAt(0); return true; }});
}})();
</script>
</body>"""
assert s.count('</body>') == 1
s = s.replace('</body>', inject)
open('clip_filter_light.html', 'w', encoding='utf8').write(s)
print('clip_filter_light.html dur', D, 'A', A, 'B', B, 'C', C)
