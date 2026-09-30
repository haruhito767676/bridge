#!/usr/bin/env python3
"""film8.html から機能クリップ (見出しなし・UI だけ) を切り出す HTML を作る。
   clip_sync.html   … Mac でコピー → 3 台に届く → Windows のシェルフをクリックして貼る
   clip_search.html … iMac: ポップアップから貼って送信 → 検索して貼って送信
   clip_lock.html   … パネルが南京錠になり、閉じて、運ばれ、相手の画面で開く
"""
FL0, K = 12.3, 1.25
TA0 = FL0 + .35
TP0 = TA0 + 6.28 * K
TH0 = TP0 + 8.35
LK0 = TH0 + 4.3
COL = LK0 + 5.25

CLIPS = {
    'sync':   dict(t0=TA0 + .12, t1=TP0 + .9),
    'search': dict(t0=TP0 + 1.2, t1=TP0 + 7.9),
    'lock':   dict(t0=LK0 - .1, t1=COL - .85),
}
base = open('film8.html', encoding='utf8').read()

def make(name, c):
    s = base
    dur = round(c['t1'] - c['t0'], 3)
    s = s.replace('<title>Bridge Multi-Device Film v8</title>', f'<title>Bridge clip: {name}</title>')
    if name == 'sync':
        # カメラを Windows に留める (iMac へパンしない) / 導入の波紋と揺れは出さない
        a = "  if (T < TP0) {\n    if (t < 4.5) return VIEW.v1;"
        assert s.count(a) == 1; s = s.replace(a, "  if (T < TP0 + 99) {\n    if (t < 4.5) return VIEW.v1;")
        a = "{ t0: FL0, R: 640,"; assert s.count(a) == 1; s = s.replace(a, "{ t0: -100, R: 640,")
        a = "const SHAKES = [[FL0, 1],"; assert s.count(a) == 1; s = s.replace(a, "const SHAKES = [[-100, 1],")
    inject = f"""
<script>
(() => {{
  const orig = window.renderAt, T0 = {c['t0']:.4f}, D = {dur};
  const st = document.createElement('style'); st.textContent = '#hlA,#hlB,#hlC,#hlD{{display:none!important}}'; document.head.appendChild(st);
  const cl = v => v < 0 ? 0 : v > 1 ? 1 : v;
  window.renderAt = t => {{
    orig(T0 + t);
    document.getElementById('s2').style.opacity = 1;
    document.getElementById('fade').style.opacity = Math.max(1 - cl(t / .25), cl((t - (D - .3)) / .3)).toFixed(3);
  }};
  window.__ready = window.__ready.then(() => {{ window.renderAt(0); return true; }});
}})();
</script>
</body>"""
    assert s.count('</body>') == 1
    s = s.replace('</body>', inject)
    open(f'clip_{name}.html', 'w', encoding='utf8').write(s)
    print(name, 'T0=%.2f dur=%.2f' % (c['t0'], dur))

for n, c in CLIPS.items():
    make(n, c)
