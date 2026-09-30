#!/usr/bin/env python3
"""サイト用 (ライト): デバイスの出身バッジで絞り込む場面。film8 のヒーロー (パネルを大きく映す) を切り出し、
   ライトモードのパネル画像 (plates-light) と淡い背景にして、縦長 (4:5) に切り取る。
   絞り込み中の時間だけ、少しゆっくり見せる。"""
FL0, K = 12.3, 1.25
TA0 = FL0 + .35; TP0 = TA0 + 6.28 * K; TH0 = TP0 + 8.35
s = open('film8.html', encoding='utf8').read()
assert s.count('ui/plates/manifest.js') == 1
s = s.replace('ui/plates/', 'ui/plates-light/')
s = s.replace('<title>Bridge Multi-Device Film v8</title>', '<title>Bridge clip: filter (light)</title>')
CSS = """
#s2bg{background:radial-gradient(60% 80% at 30% 15%,#ffffff 0%,rgba(255,255,255,0) 60%),linear-gradient(160deg,#dff1ff,#e9e4ff)!important}
.glow{display:none!important}
#camwrap{display:none!important}
#hlA,#hlB,#hlC,#hlD{display:none!important}
.panel.glass{border-radius:14px!important;background:rgba(248,248,250,.82)!important;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.14),0 30px 80px rgba(0,0,0,.22)!important}
#fade{background:#f6f7fa!important}
"""
assert s.count('</style>') == 1
s = s.replace('</style>', CSS + '</style>')
D = 3.4
inject = f"""
<script>
(() => {{
  const orig = window.renderAt, TH0 = {TH0:.4f}, D = {D};
  const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  // 絞り込み中 (film では TH0+1.91〜2.56) を少しゆっくり
  const map = c => c < 1.9 ? c : c < 2.9 ? 1.9 + (c - 1.9) * .66 : 2.56 + (c - 2.9);
  window.renderAt = t => {{
    orig(TH0 + map(t));
    document.getElementById('s2').style.opacity = 1;
    document.getElementById('fade').style.opacity = Math.max(1 - cl(t / .3), cl((t - (D - .35)) / .35)).toFixed(3);
  }};
  window.__ready = window.__ready.then(() => {{ window.renderAt(0); return true; }});
}})();
</script>
</body>"""
assert s.count('</body>') == 1
s = s.replace('</body>', inject)
open('clip_filter_light.html', 'w', encoding='utf8').write(s)
print('clip_filter_light.html', 'dur', D)
