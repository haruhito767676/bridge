#!/usr/bin/env python3
"""film6.html を元に film7.html を作る (導入を 1 回ずつ / バッジ削除 / グレイン削除 / iMac 送信 / 南京錠が運ぶ)。"""
import re, sys
src = open('film6.html', encoding='utf-8').read()
s = src

def rep(a, b, count=1):
    global s
    assert a in s, 'missing: ' + a[:80]
    s = s.replace(a, b, count)

def between(a, b, new):
    """a の先頭から b の先頭 (含まない) までを new で置き換える"""
    global s
    i = s.index(a); j = s.index(b, i)
    s = s[:i] + new + s[j:]

# ------------------------------------------------------------------ CSS / HTML
rep('<title>Bridge Multi-Device Film</title>', '<title>Bridge Multi-Device Film v7</title>')
# 「送信済み」ボタン (緑の丸チェックは廃止)
between('.pok{', '.smsg{', '.psend.sent{background:rgba(48,209,88,.16);color:#30d158;box-shadow:inset 0 0 0 1.5px rgba(48,209,88,.5)}\n')
rep('#lead{', '#lead2{position:absolute;left:960px;top:92px;transform:translate(-50%,-50%);font:800 66px/1 var(--display);color:#fff;white-space:nowrap;letter-spacing:-.02em}\n#lead{')
# グレイン (canvas) は廃止
rep('#grain{position:absolute;left:-60px;top:-60px;width:2040px;height:1200px;opacity:.022;pointer-events:none}\n', '')
rep(' <canvas id="grain" width="680" height="400"></canvas>\n', '')
rep('<div id="lead">こんなこと、していませんか？</div>', '<div id="lead">こんなこと、していませんか？</div>\n    <div id="lead2" style="display:none"></div>')
# 「自分のMac」などのバッジは廃止 (アプリ UI の出身チップは残る)
between('      <div id="chips">', '      <div id="cards"></div>', '')
rep('    <div id="chipTop" class="chip2" style="left:960px;top:40px;opacity:0"><i></i><span id="chipTopT"></span></div>\n', '')
# iMac の Slack: 送信済みの吹き出し
rep('            <div class="inp"><span class="pt"><i id="slkHl"></i>',
    '            <div id="slkSent" style="position:absolute;left:30px;right:30px;bottom:112px;display:flex;gap:16px;opacity:0"><div class="av" style="background:#0a84ff"></div><div><div class="b1" style="width:70px"></div><div style="font:600 21px var(--mono);color:#7fb5ff;white-space:nowrap;margin-top:2px">https://github.com/example-team/ec-renewal/pull/42</div></div></div>\n            <div class="inp"><span class="pt"><i id="slkHl"></i>')
# 南京錠のシーン
between('  <!-- 南京錠 -->', '  <!-- 橋への収束 -->', '''  <!-- 南京錠 → 運んで届ける -->
  <div id="lockScene" class="L">
    <div class="glow" id="gLock" style="left:10px;top:230px;width:1100px;height:760px;background:radial-gradient(closest-side,rgba(255,255,255,.24),rgba(255,255,255,0))"></div>
    <svg id="lockTrail" class="L" viewBox="0 0 1920 1080" style="overflow:visible">
      <defs><filter id="trb" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="8"/></filter></defs>
      <path id="trailG" fill="none" stroke="#fff" stroke-width="16" stroke-linecap="round" filter="url(#trb)" opacity=".5" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>
      <path id="trailP" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>
    </svg>
    <div id="rcv" style="position:absolute;left:1350px;top:140px;width:320px;height:600px;transform-origin:0 0"><div id="rcvPanel" style="position:absolute;left:0;top:0;width:320px;height:600px"></div></div>
    <div id="lockMover" class="L" style="transform-origin:960px 660px">
      <div id="lockGroup" class="L">
        <svg class="L" id="lockSvg" viewBox="0 0 1920 1080" style="overflow:visible">
          <defs><filter id="lgb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
            <linearGradient id="shg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f5f8"/><stop offset="1" stop-color="#c9ccd6"/></linearGradient></defs>
          <g id="shGroup">
            <path id="shGlow" d="M830 545 L830 390 A130 130 0 0 1 1090 390 L1090 545" fill="none" stroke="#0a84ff" stroke-width="56" stroke-linecap="round" filter="url(#lgb)" opacity=".8"/>
            <path id="shPath" d="M830 545 L830 390 A130 130 0 0 1 1090 390 L1090 545" fill="none" stroke="url(#shg)" stroke-width="42" stroke-linecap="round"/>
          </g>
        </svg>
        <div id="lockBody">
          <div class="lrow" style="top:34px"><i style="background:#0a84ff"></i><b style="width:250px"></b></div>
          <div class="lrow" style="top:80px"><i style="background:#bf5af2"></i><b style="width:190px"></b></div>
          <div class="lrow" style="top:126px"><i style="background:#30d158"></i><b style="width:280px"></b></div>
          <svg id="keyhole" width="60" height="110" viewBox="0 0 60 110"><circle cx="30" cy="30" r="26" fill="#0b0b0f"/><path d="M19 46 L41 46 L48 104 L12 104 Z" fill="#0b0b0f"/></svg>
        </div>
      </div>
      <div id="lockPen"></div>
    </div>
  </div>

''')
rep('max="34.1"', 'max="42.3"')

# ------------------------------------------------------------------ JS: 定数
rep('const W = 1920, H = 1080, DUR = 34.1;\nconst K = 1.25;                      // 3 台の場面 (旧 3.0〜13.5s) を伸ばす倍率\nconst TA0 = 7.2, TH0 = 19.5, F2 = 17.85;\n',
'''const W = 1920, H = 1080, DUR = 42.3;
const K = 1.25;                          // 3 台の場面 (旧 3.0〜13.5s) を伸ばす倍率
const FL0 = 12.9;                        // 青い点が画面いっぱいに膨らみ始める時刻 (導入の終わり)
const TA0 = FL0 + .35;                   // Mac の場面 (旧タイムラインの 3.0s)
const TP0 = TA0 + 6.28 * K;              // Windows → iMac のパン開始
const TH0 = TP0 + 5.45;                  // パネル拡大 (ヒーロー) の開始
const LK0 = TH0 + 4.3;                   // パネル → 南京錠
const COL = LK0 + 5.25;                  // 青い面が一点へ収束し始める時刻
const F2 = COL - 10.05;                  // 橋 (film4 の時間) との差
''')
rep("const LKT = chars($('lockTxt'), '暗号化されて、届く。');",
    "const LD1 = chars($('lead'), 'こんなこと、していませんか？');\nconst LD2 = chars($('lead2'), 'それ、全部いらなくなります。');")

# ------------------------------------------------------------------ JS: 導入 (1 回ずつ) + 青い点
between('// ================= S0 : こんなこと、していませんか？ =================', '// ================== panels (実アプリの Renderer を撮った部品画像) ==================',
r'''// ================= S0 : こんなこと、していませんか？ (1 つずつ、1 回だけ) =================
const PDF = '<svg width="34" height="42" viewBox="0 0 64 64"><path d="M12 4h28l14 14v38a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#eceef2"/><path d="M40 4l14 14H44a4 4 0 0 1-4-4z" fill="#b9b9c2"/><rect x="8" y="34" width="34" height="16" rx="3" fill="#ff453a"/></svg>';
const LOCKS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#98989f" stroke-width="1.6" stroke-linecap="round"><rect x="3" y="7" width="10" height="7" rx="1.6"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2"/></svg>';
const CARD_HTML = [
  // 1 : 自分宛てにメール
  `<div class="pbar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span>新規メッセージ</span></div>
   <div class="prow" style="top:68px"><b>宛先</b><span class="pchip"><i class="av"></i>自分</span></div>
   <div class="prow" style="top:122px"><b>件名</b><span class="pln" style="width:200px"></span></div>
   <div class="pdiv" style="top:176px"></div>
   <span class="pln" style="position:absolute;left:36px;top:204px;width:520px"></span>
   <span class="pln" style="position:absolute;left:36px;top:236px;width:340px"></span>
   <div class="patt">${PDF}<span class="pln" style="width:110px;margin-left:12px"></span></div>
   <div class="psend">送信</div>`,
  // 2 : Slack の「自分だけ」チャンネルに URL
  `<div class="pbar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span># 自分だけ</span>${LOCKS}</div>
   <div class="smsg" style="top:70px"><i class="av" style="background:#5b8cff;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:80px"></span><span class="pln" style="width:320px"></span></div></div>
   <div class="smsg" style="top:142px"><i class="av" style="background:#ff8a4c;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:100px"></span><span class="pln" style="width:400px"></span></div></div>
   <div class="smsg snew" style="top:214px"><i class="av" style="background:#34c759;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:70px"></span><span class="urlt">https://drive.example.com/f/8Kx2</span></div></div>
   <div class="sinput"><span class="styp"></span><i class="cur"></i></div>`,
  // 3 : クラウドへ上げて、落とし直す
  `<svg width="760" height="400" viewBox="0 0 760 400" style="position:absolute;left:0;top:0">
     <g fill="none" stroke="#98989f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
       <g transform="translate(70,222)"><rect x="18" y="0" width="112" height="76" rx="8"/><path d="M0 92h148"/></g>
       <g transform="translate(542,222)"><rect x="18" y="0" width="112" height="76" rx="8"/><path d="M0 92h148"/></g>
       <path class="cld" d="M300 150a34 34 0 0 1 4-68 48 48 0 0 1 92-6 38 38 0 0 1 8 74z" stroke="#c9ccd6"/>
       <path class="cring" d="M300 150a34 34 0 0 1 4-68 48 48 0 0 1 92-6 38 38 0 0 1 8 74z" stroke="#0a84ff" stroke-width="5" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>
     </g>
     <rect class="dbar" x="546" y="330" width="140" height="8" rx="4" fill="rgba(255,255,255,.12)"/>
     <rect class="dfill" x="546" y="330" width="0" height="8" rx="4" fill="#0a84ff"/>
   </svg>
   <div class="ftok" style="position:absolute;left:0;top:0;width:46px;height:56px;margin:-28px 0 0 -23px">${PDF.replace('width="34" height="42"', 'width="46" height="56"')}</div>`,
  // 4 : ブラウザとドキュメントを往復
  `<div class="pw wl" style="left:36px;top:54px;width:330px;height:300px"><div class="t"><i class="on"></i><i></i><i style="width:50px"></i></div>
     <span class="ln" style="top:70px;width:230px"></span><span class="ln" style="top:100px;width:190px"></span><span class="ln" style="top:130px;width:250px"></span><span class="ln" style="top:160px;width:150px"></span></div>
   <div class="pw wr" style="left:394px;top:54px;width:330px;height:300px"><div class="t"><i style="width:120px"></i></div>
     <span class="ln" style="top:70px;width:250px"></span><span class="ln" style="top:100px;width:210px"></span><span class="ln" style="top:130px;width:170px"></span><span class="ln" style="top:160px;width:240px"></span></div>
   <div class="snip"><span class="pln" style="width:86px;background:rgba(255,255,255,.75)"></span></div>`,
];
const OPEN_T0 = [1.7, 3.5, 5.0, 7.35];            // 各カードの開始 (前のカードは完了した状態のまま残る)
const HOPS = [[.05, .5], [.55, .95], [1.0, 1.35], [1.4, 1.7], [1.75, 2.0], [2.05, 2.25], [2.3, 2.48], [2.5, 2.66]];   // 往復は回を重ねるごとに速くなる
const SWAP = 10.25, SK0 = 12.0;                    // 「それ、全部いらなくなります。」に切り替え / 点への吸い込み開始
const OPEN = [{ x: 150, y: 170 }, { x: 1010, y: 170 }, { x: 150, y: 610 }, { x: 1010, y: 610 }].map((s, i) => {
  const el = document.createElement('div'); el.className = 'pc'; el.innerHTML = CARD_HTML[i]; el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; el.style.opacity = 0; $('s0').appendChild(el);
  return { ...s, t0: OPEN_T0[i], el, cx: s.x + 380, cy: s.y + 200, q: sel => el.querySelector(sel) };
});
const URLT = 'https://drive.example.com/f/8Kx2';
// c = カード開始からの経過秒。すべて c だけの関数 (履歴に依存しない) なので、途中からシークしても同じ絵になる
function cardUpd(i, c) {
  const e = OPEN[i];
  if (i === 0) {
    const p = E.out(P(c, .2, .7)), att = e.q('.patt'), send = e.q('.psend');
    att.style.transform = `translate3d(${(1 - p) * 250}px,${(1 - p) * 80}px,0)`; att.style.opacity = P(c, .2, .35);
    const pr = c > 1.05 && c < 1.2, sent = c >= 1.2;
    send.textContent = sent ? '✓ 送信済み' : '送信'; send.classList.toggle('sent', sent);
    send.style.transform = `scale(${pr ? .9 : 1})`; send.style.boxShadow = pr ? '0 0 0 6px rgba(10,132,255,.35)' : (sent ? 'inset 0 0 0 1.5px rgba(48,209,88,.5)' : 'none');
  } else if (i === 1) {
    const n = Math.floor(clamp((c - .15) / .75) * URLT.length), t = e.q('.styp'), nm = e.q('.snew');
    const txt = c < 1.0 ? URLT.slice(0, n) : ''; if (t._v !== txt) { t.textContent = txt; t._v = txt; }
    const p = E.out(P(c, 1.0, 1.35)); nm.style.transform = `translate3d(0,${(1 - p) * 70}px,0)`; nm.style.opacity = P(c, 1.0, 1.12);
  } else if (i === 2) {
    const tok = e.q('.ftok'), ring = e.q('.cring'), fill = e.q('.dfill');
    const A = [144, 262], C = [352, 112], B = [616, 262];
    let x = A[0], y = A[1], o = 1;
    if (c >= .1 && c < .85) { const p = E.inOut(P(c, .1, .85)); x = lerp(A[0], C[0], p); y = lerp(A[1], C[1], p) - 60 * Math.sin(Math.PI * p); }
    else if (c >= .85 && c < 1.25) { x = C[0]; y = C[1]; o = 0; }
    else if (c >= 1.25 && c < 1.95) { const p = E.inOut(P(c, 1.25, 1.95)); x = lerp(C[0], B[0], p); y = lerp(C[1], B[1], p) - 60 * Math.sin(Math.PI * p); }
    else if (c >= 1.95) { x = B[0]; y = B[1]; }
    tok.style.transform = `translate3d(${x}px,${y}px,0)`; tok.style.opacity = o;
    ring.style.strokeDashoffset = (1 - E.inOut(P(c, .85, 1.2))).toFixed(3);
    fill.setAttribute('width', (140 * E.out(P(c, 1.95, 2.25))).toFixed(1));
  } else {
    const snip = e.q('.snip'), wl = e.q('.wl'), wr = e.q('.wr');
    const L_ = [200, 226], R_ = [560, 226];
    let pos = L_, side = 0;
    HOPS.forEach(([a, b], k) => {
      const from = k % 2 ? R_ : L_, to = k % 2 ? L_ : R_;
      if (c >= b) { pos = to; side = k % 2 ? 0 : 1; }
      else if (c >= a) { const p = E.inOut(P(c, a, b)); pos = [lerp(from[0], to[0], p), lerp(from[1], to[1], p) - 50 * Math.sin(Math.PI * p)]; side = p > .85 ? (k % 2 ? 0 : 1) : (k % 2 ? 1 : 0); }
    });
    snip.style.transform = `translate3d(${pos[0] - 55}px,${pos[1] - 22}px,0)`;
    wl.style.boxShadow = side === 0 ? 'inset 0 0 0 2px rgba(10,132,255,.9)' : 'inset 0 0 0 1.5px rgba(255,255,255,.14)';
    wr.style.boxShadow = side === 1 ? 'inset 0 0 0 2px rgba(10,132,255,.9)' : 'inset 0 0 0 1.5px rgba(255,255,255,.14)';
  }
}
function opener(T) {
  if (!show($('s0'), T < FL0 + .1)) return;
  const l1 = $('lead'), l2 = $('lead2');
  // 冒頭: 0.6 秒の黒 → 問いかけがゆっくり現れる
  const a1 = E.out(P(T, .6, 1.4));
  S(l1, { pre: 'translate(-50%,-50%) ', y: 24 * (1 - a1), o: a1, blur: 12 * (1 - a1) });
  LD1.c.forEach((ch, i) => { const d = E.in(P(T, SWAP + i * .02, SWAP + i * .02 + .3)); ch.style.transform = `translate3d(0,${(135 * d).toFixed(2)}%,0)`; });
  // 「それ、全部いらなくなります。」(その場で文字が入れ替わる) → 吸い込みで縮む
  const sk = E.in(P(T, SK0 - .05, SK0 + .5));
  show(l2, T > SWAP);
  S(l2, { pre: 'translate(-50%,-50%) ', s: 1 - .9 * sk, o: 1 - clamp((sk - .6) / .4), blur: 12 * sk });
  LD2.c.forEach((ch, i) => { const e = spring(T - (SWAP + .18) - i * .03, 130, 19); ch.style.transform = `translate3d(0,${(115 * (1 - e)).toFixed(2)}%,0)`; ch.style.opacity = P(T, SWAP + .18 + i * .03, SWAP + .25 + i * .03); });
  const dim = E.inOut(P(T, SWAP, SWAP + .45));
  OPEN.forEach((c, i) => {
    const el = c.el, u = T - c.t0;
    if (u < 0) { el.style.opacity = 0; return; }
    const e = spring(u, 120, 16), o = P(u, 0, .16), sp = E.in(P(T, SK0 + i * .07, SK0 + i * .07 + .55));
    const dx = (960 - c.cx) * sp, dy = (540 - c.cy) * sp;
    el.style.transform = `translate3d(${dx.toFixed(1)}px,${(dy + 46 * (1 - e)).toFixed(1)}px,0) scale(${((.94 + .06 * e) * (1 - .96 * sp)).toFixed(4)})`;
    el.style.opacity = (o * (1 - .65 * dim) * (1 - clamp((sp - .7) / .3))).toFixed(3);
    const bl = 12 * (1 - E.out(P(u, 0, .5))) + 10 * sp; el.style.filter = bl > .2 ? `blur(${bl.toFixed(1)}px)` : '';
    cardUpd(i, u);
  });
}
const FLOOD_MAX = 74;
function flood(T) {
  const el = $('flood');
  if (!show(el, T > SK0 - .15 && T < FL0 + .45)) return;
  let s = .5 * spring(T - (SK0 - .1), 200, 15);
  for (let i = 0; i < 4; i++) { const d = T - (SK0 + i * .07 + .5); if (d > 0 && d < .6) s *= 1 + .16 * Math.exp(-d * 12) * Math.cos(d * 30); }
  s = lerp(s, .82, E.out(P(T, FL0 - .25, FL0)));
  if (T > FL0) s = .82 * (1 + (FLOOD_MAX - 1) * E.expo(P(T, FL0, FL0 + .4)));
  const mix = E.inOut(P(T, SK0 + .05, SK0 + .55)), glow = 1 - P(T, FL0 + .05, FL0 + .25);
  el.style.background = `rgb(${Math.round(lerp(255, 10, mix))},${Math.round(lerp(255, 132, mix))},255)`;
  el.style.boxShadow = glow > .01 ? `0 0 ${40 * glow}px ${10 * glow}px rgba(10,132,255,.55)` : 'none';
  el.style.transform = `translate3d(960px,540px,0) scale(${s.toFixed(4)})`;
}

''')

# ------------------------------------------------------------------ Panel: フィルタ対応を「文字一致」で自動計算
rep("    this.dzTop = m.dz.top;\n  }",
"""    this.dzTop = m.dz.top;
    this.mapNF = {};
    if (hero) m.filter.rows.forEach((f, j) => { const i = m.rows.findIndex(r => !r.skipped && r.text === f.text && r.cls.includes('section-header') === f.cls.includes('section-header')); if (i >= 0 && !(i in this.mapNF)) this.mapNF[i] = j; });
  }""")
rep("    const mapNF = { 0: 0, 4: 1, 5: 2, 6: 3 };\n", "    const mapNF = this.mapNF;\n")
rep("let PM, PI, PW, PH;", "let PM, PI, PW, PH, PW2;")
rep("  PH = new Panel('mac', $('hpanel'), true);\n", "  PH = new Panel('mac', $('hpanel'), true);\n  PW2 = new Panel('win', $('rcvPanel')); PW2.update({ ins: 0 });\n")

# ------------------------------------------------------------------ リング / 画面揺れ
between('// ---------- rings & shake ----------', '// ================== S2 : devices ==================',
'''// ---------- rings & shake ----------
const RINGS = [
  { t0: FL0, R: 640, pos: () => [960, 540] },
  { t0: TL(4.06), R: 380, pos: () => worldToScreen(...rowC('mac', PM), VIEW.v1) },
  { t0: TL(6.24), R: 200, pos: () => worldToScreen(...rowC('imac', PI), VIEW.v2) },
  { t0: TL(6.36), R: 200, pos: () => worldToScreen(...rowC('win', PW), VIEW.v2) },
  { t0: TL(8.32), R: 160, pos: () => worldToScreen(...rowC('win', PW), VIEW.v3) },
  { t0: LK0 + 1.75, R: 560, pos: () => [560, 690] },
  { t0: LK0 + 3.2, R: 300, pos: () => [1235, 320] },
  { t0: 12.3 + F2, R: 1300, pos: () => [960, 552] },
].map(r => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('fill', 'none'); c.setAttribute('stroke', '#fff'); $('rings').appendChild(c); return { ...r, c }; });
const SHAKES = [[FL0, 1], [TL(4.06), .3], [LK0 + 1.75, .8], [LK0 + 3.2, .35], [12.3 + F2, 1.1]];
function shake(t) {
  let a = 0, ang = 0;
  for (const [t0, amp] of SHAKES) { const d = t - t0; if (d > 0 && d < 1.2) { const env = Math.exp(-d * 9) * amp; a += env; ang += env * Math.sin(d * 55 + t0); } }
  return { a, x: a * 11 * Math.sin(t * 83), y: a * 9 * Math.sin(t * 97 + 1.3), r: ang * .25, s: 1 + .012 * Math.min(1, a * 1.4) };
}

''')

# ------------------------------------------------------------------ 3 台の場面 (バッジ廃止 / iMac で送信)
between('function camera(T, t) {', '// ================== hero panel (実 UI を大きく) ==================',
r'''function camera(T, t) {
  if (T < TP0) {
    if (t < 4.5) return VIEW.v1;
    if (t < 6.95) return camAt(VIEW.v1, VIEW.v2, E.soft(P(t, 4.5, 5.75)));
    return camAt(VIEW.v2, VIEW.v3, E.soft(P(t, 6.95, 7.85)));
  }
  if (T < TP0 + 1.05) {
    const p = E.soft(P(T, TP0, TP0 + 1.05));
    return { cx: lerp(VIEW.v3.cx, VIEW.v4.cx, p), cy: -25, s: VIEW.v3.s * (1 - .55 * Math.sin(Math.PI * p)) };
  }
  return VIEW.v4;
}
const URL_PASTE = 'https://github.com/example-team/ec-renewal/pull/42';
function s2(T) {
  const el = $('s2');
  if (!show(el, T > TA0 - .15 && T < COL - .15)) return;
  const t = tA(T);
  el.style.opacity = P(T, TA0 - .15, TA0 + .2).toFixed(3);
  const camOn = T < TH0 + .05;
  const c = camera(T, t);
  const breathe = (t > 5.75 && t < 6.95) ? 1 + .006 * Math.sin((t - 5.75) * 2.2) : 1;
  const camS = c.s * breathe;
  $('cam').style.transform = `translate3d(${960 - c.cx * camS}px,${540 - c.cy * camS}px,0) scale(${camS.toFixed(5)})`;
  const camW = $('camwrap');
  show(camW, camOn);
  const dfade = 1 - E.in(P(T, TH0 - .45, TH0));
  camW.style.opacity = dfade.toFixed(3);
  camW.style.filter = dfade < .98 ? `blur(${(14 * (1 - dfade)).toFixed(1)}px)` : '';
  show($('devMac'), T < TP0 + 1.25);
  show($('devImac'), (t > 4.7 && t < 7.2) || (T > TP0 - .45 && camOn));
  show($('devWin'), t > 4.7 && T < TP0 + 1.55);
  if (camOn) {
    const rise = spring(t - 3.0, 90, 15);
    S($('devMac'), { y: 420 * (1 - rise), s: .94 + .06 * rise, o: P(t, 3.0, 3.22) });
    S($('devImac'), { o: E.out(P(t, 4.6, 5.2)) });
    S($('devWin'), { o: E.out(P(t, 4.6, 5.2)) });
    // ---- Mac: 選択 → コピー ----
    $('selHl').style.transform = `scaleX(${E.out(P(t, 3.45, 3.78)).toFixed(4)})`;
    PM.update({ ins: spring(t - 4.06, 120, 15) });
    // ---- 配信カード ----
    const A = rowC('mac', PM), B = rowC('imac', PI), Cc = rowC('win', PW);
    const flights = [{ id: 'cI', to: B, t0: 5.5, t1: 6.2, arc: 'aI', panel: PI, lift: -470 }, { id: 'cW', to: Cc, t0: 5.6, t1: 6.32, arc: 'aW', panel: PW, lift: -470 }];
    flights.forEach((f, k) => {
      const card = $(f.id), pf = E.inOut(P(t, f.t0, f.t1)), pop = E.out(P(t, f.t0 - .16, f.t0 + .1)), land = E.in(P(t, f.t1 - .02, f.t1 + .22));
      const vis = t > f.t0 - .16 && t < f.t1 + .25;
      show(card, vis);
      const c1_ = [A[0] + (f.to[0] - A[0]) * .2, A[1] + f.lift], c2_ = [A[0] + (f.to[0] - A[0]) * .8, f.to[1] + f.lift];
      const pos = CURVE_PT(A, c1_, c2_, f.to, pf);
      if (vis) {
        const sc = lerp(1, 2.6, pop) * lerp(1, .5, land), h = f.panel.m.rows[1].height + 4;
        card.style.transform = `translate3d(${(pos[0] - 160).toFixed(1)}px,${(pos[1] - h / 2).toFixed(1)}px,0) scale(${sc.toFixed(3)}) rotate(${((k ? 1 : -1) * 5 * Math.sin(Math.PI * pf)).toFixed(2)}deg)`;
        card.style.opacity = (pop * (1 - land)).toFixed(3);
      }
      const arc = $(f.arc);
      arc.setAttribute('d', `M${A[0]} ${A[1]} C${c1_[0]} ${c1_[1]}, ${c2_[0]} ${c2_[1]}, ${f.to[0]} ${f.to[1]}`);
      arc.setAttribute('pathLength', 1); arc.style.strokeDasharray = '1 1';
      const dr = E.inOut(P(t, f.t0 - .1, f.t1)), fa = 1 - E.in(P(t, f.t1 + .1, f.t1 + .7));
      arc.style.strokeDashoffset = (1 - dr).toFixed(4); arc.style.opacity = (.7 * fa * (t > f.t0 - .1 ? 1 : 0)).toFixed(3);
    });
    // ---- 受け取り側: 会社用PC (シェルフ → クリック → コピー → 貼り付け) ----
    PI.update({ ins: spring(t - 6.2, 120, 15) });
    PW.update({ ins: spring(t - 6.32, 120, 15), sel: E.out(P(t, 8.28, 8.34)), cop: E.out(P(t, 8.42, 8.5)) });
    $('slotWin').style.transform = `translate3d(${(340 * E.in(P(t, 8.66, 9.0))).toFixed(1)}px,0,0)`;
    $('slotImac').style.transform = `translate3d(${(340 * E.in(P(T, TP0 + .25, TP0 + .7))).toFixed(1)}px,0,0)`;
    // ---- 見出し (既存のまま) ----
    HLA.c.forEach((ch, i) => { const e = spring(t - 5.1 - i * .03, 130, 19), d = E.in(P(t, 6.75 + i * .012, 6.75 + i * .012 + .3)); ch.style.transform = `translate3d(0,${(115 * (1 - e) + 135 * d).toFixed(2)}%,0)`; ch.style.opacity = P(t, 5.1 + i * .03, 5.17 + i * .03); });
    show($('hlA'), t > 5.05 && t < 7.4);
    // ---- Windows: クリックして貼り付け ----
    const cur = $('cursorW'); show(cur, t > 7.75 && t < 9.4);
    {
      const tgt = [SLOT.win[0] + 200, SLOT.win[1] + PW.m.rows[1].top + 30];
      const p = E.inOut(P(t, 7.8, 8.28)), from = [1180, 640];
      const cx = lerp(from[0], tgt[0], p), cy = lerp(from[1], tgt[1], p) - 30 * Math.sin(Math.PI * p);
      const clk = t > 8.3 && t < 8.44 ? .84 : 1;
      cur.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0) scale(${clk})`;
      cur.style.opacity = P(t, 7.75, 7.9) * (1 - E.in(P(t, 8.62, 8.9)));
    }
    const pasted = t > 8.98;
    const words = pasted ? '明日14時、会議室Bでキックオフ' : '';
    if ($('pasteWords')._v !== words) { $('pasteWords').textContent = words; $('pasteWords')._v = words; }
    $('pasteHl').style.opacity = pasted ? (.9 * (1 - P(t, 9.05, 9.6))).toFixed(3) : 0;
    $('pasteCaret').style.opacity = (Math.floor(t * 2.4) % 2 === 0 || pasted) ? 1 : 0;
    // ---- 自宅iMac: その場でペースト → Enter で送信 ----
    const pop = $('popIm'), pIn = spring(T - (TP0 + 1.5), 150, 16), pOut = E.in(P(T, TP0 + 2.97, TP0 + 3.19));
    const popO = P(T, TP0 + 1.5, TP0 + 1.65) * (1 - pOut);
    show(pop, T > TP0 + 1.45 && T < TP0 + 3.25);
    if (pop.style.display !== 'none') {
      pop.style.opacity = popO.toFixed(3);
      pop.style.transform = `translate3d(0,${(24 * (1 - pIn) - 10 * pOut).toFixed(1)}px,0) scale(${((.92 + .08 * pIn) * (1 - .04 * pOut)).toFixed(4)})`;
      const sw = E.out(P(T, TP0 + 2.3, TP0 + 2.42)); $('pop0').style.opacity = (1 - sw).toFixed(3); $('pop1').style.opacity = sw.toFixed(3);
    }
    const ip = T > TP0 + 3.07 && T < TP0 + 3.7, iw = ip ? URL_PASTE : '';
    if ($('slkWords')._v !== iw) { $('slkWords').textContent = iw; $('slkWords')._v = iw; }
    $('slkHl').style.opacity = ip ? (.9 * (1 - P(T, TP0 + 3.15, TP0 + 3.7))).toFixed(3) : 0;
    $('slkCaret').style.opacity = (ip || Math.floor(T * 2.4) % 2 === 0) ? 1 : 0;
    const sent = E.out(P(T, TP0 + 3.7, TP0 + 4.05)), sn = $('slkSent');
    sn.style.opacity = P(T, TP0 + 3.7, TP0 + 3.85).toFixed(3); sn.style.transform = `translate3d(0,${((1 - sent) * 70).toFixed(1)}px,0)`;
    $('s2gA').style.transform = `translate3d(${(-c.cx * .02 + 40 * Math.sin(T * .8)).toFixed(1)}px,${(20 * Math.sin(T * .6)).toFixed(1)}px,0)`;
    $('s2gB').style.transform = `translate3d(${(c.cx * -.015).toFixed(1)}px,${(30 * Math.sin(T * .7 + 1)).toFixed(1)}px,0)`;
  }
  else { show($('hlA'), false); show($('popIm'), false); show($('cursorW'), false); }
  hero(T);
}

''')

# ------------------------------------------------------------------ ヒーロー (パネル → 左へ寄って錠前になる)
between('// ================== hero panel (実 UI を大きく) ==================', '// ================== 南京錠 ==================',
r'''// ================== hero panel (実 UI を大きく) ==================
function hero(T) {
  const h = $('hero'), t = tH(T);
  if (!show(h, T > TH0 - .1 && T < LK0 + .7)) return;
  const e = spring(t - 9.55, 100, 17);
  const HS = 1.62, px = 1090, py = 54;
  const m = E.in(P(T, LK0, LK0 + .55)), sM = lerp(HS * (.86 + .14 * e), .5, m);
  $('hpanel').style.transformOrigin = '0 0';
  S($('hpanel'), { x: lerp(px + 260 * (1 - e), 560 - 160 * sM, m), y: lerp(py + 20 * (1 - e), 690 - 300 * sM, m), s: sM, o: P(t, 9.55, 9.8) * (1 - E.in(P(T, LK0 + .2, LK0 + .6))), blur: 16 * (1 - E.out(P(t, 9.55, 10.1))) + 22 * m });
  const filt = E.inOut(P(t, 10.62, 11.08)) * (1 - E.inOut(P(t, 11.6, 12.0)));
  const syncIns = spring(t - 12.05, 130, 16);
  const syncP = t < 12.02 ? null : E.inOut(P(t, 12.3, 13.0));
  const done = E.out(P(t, 13.0, 13.12));
  PH.update({ ins: 1, filt, syncIns: t > 12.0 ? syncIns : 0, syncP, syncDone: done });
  const tA_ = [9.72, 11.4], tC = [11.75, 13.0];
  HLB.c.forEach((ch, i) => { const e1 = spring(t - tA_[0] - i * .028, 130, 19), d = E.in(P(t, tA_[1] + i * .012, tA_[1] + i * .012 + .28)); ch.style.transform = `translate3d(0,${(115 * (1 - e1) + 135 * d).toFixed(2)}%,0)`; ch.style.opacity = P(t, tA_[0] + i * .028, tA_[0] + .07 + i * .028); });
  HLC.c.forEach((ch, i) => { const e1 = spring(t - tC[0] - i * .035, 130, 19), d = E.in(P(t, 12.88 + i * .012, 12.88 + i * .012 + .3)); ch.style.transform = `translate3d(0,${(115 * (1 - e1) + 135 * d).toFixed(2)}%,0)`; ch.style.opacity = P(t, tC[0] + i * .035, tC[0] + .07 + i * .035); });
  const a = $('hlB'), c2 = $('hlC');
  a.style.left = '150px'; a.style.top = '360px'; c2.style.left = '150px'; c2.style.top = '360px';
  show(a, t < 11.7); show(c2, t > 11.7);
  const cur = $('cursorH'); show(cur, t > 10.0 && t < 11.05);
  if (cur.style.display !== 'none') {
    const r4 = PH.n.find(r => r && /見積書_EC/.test(PH.m.rows[r.i].text)), chipY = py + HS * (r4.top + 50), chipX = px + HS * 130;
    const p = E.inOut(P(t, 10.05, 10.5)), from = [1690, 900];
    const cx = lerp(from[0], chipX, p), cy = lerp(from[1], chipY, p) - 40 * Math.sin(Math.PI * p);
    const clk = t > 10.55 && t < 10.68 ? .84 : 1;
    cur.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0) scale(${clk})`;
    cur.style.opacity = P(t, 10.0, 10.15) * (1 - E.in(P(t, 10.8, 11.02)));
    const rg = $('hring'), rp = P(t, 10.55, 10.95);
    rg.style.opacity = rp > 0 && rp < 1 ? (1 - rp).toFixed(3) : 0;
    rg.style.left = (chipX - 30 - 60 * rp) + 'px'; rg.style.top = (chipY - 30 - 60 * rp) + 'px'; rg.style.width = (60 + 120 * rp) + 'px'; rg.style.height = (60 + 120 * rp) + 'px';
  } else $('hring').style.opacity = 0;
}

''')

# ------------------------------------------------------------------ 南京錠 → 運んで届ける
between('// ================== 南京錠 ==================', '// ================== S4 : bridge (film4 と同じ。時間だけ F2 ぶん後ろ) ==================',
r'''// ================== 南京錠 → 運んで、相手の画面で開く ==================
const shLen = $('shPath').getTotalLength();
const OPEN_Y = -64;
const LK_S = [560, 660], LK_A = [1235, 320];              // 錠前の出発点 / 到着点 (中心)
const RCV = { x: 1350, y: 140, s: 1.3 };                 // 受け取り側 (Windows のシェルフ)
const lkC1 = [LK_S[0] + 220, LK_S[1] - 250], lkC2 = [LK_A[0] - 300, LK_A[1] - 110];
{ const d = `M${LK_S[0]} ${LK_S[1]} C${lkC1[0]} ${lkC1[1]} ${lkC2[0]} ${lkC2[1]} ${LK_A[0]} ${LK_A[1]}`; $('trailG').setAttribute('d', d); $('trailP').setAttribute('d', d); }
function lockScene(T) {
  const el = $('lockScene');
  if (!show(el, T > LK0 - .1 && T < COL - .05)) return;
  const out = E.in(P(T, COL - .6, COL - .25));
  el.style.opacity = (1 - out).toFixed(3); el.style.filter = out > .02 ? `blur(${(14 * out).toFixed(1)}px)` : '';
  const tClick = LK0 + 1.75, tTr0 = LK0 + 2.1, tArr = LK0 + 3.2;
  // ---- 胴 (パネルが縮んで錠前の胴になる) ----
  const bodyIn = spring(T - (LK0 + .38), 120, 17), body = $('lockBody');
  body.style.transformOrigin = '50% 50%';
  S(body, { s: .55 + .45 * bodyIn, o: P(T, LK0 + .33, LK0 + .6), blur: 14 * (1 - E.out(P(T, LK0 + .33, LK0 + .8))) });
  const clk = T > tClick ? Math.exp(-(T - tClick) * 11) * Math.sin((T - tClick) * 46) : 0;
  body.style.transform += ` translate3d(0,${(5 * clk).toFixed(2)}px,0)`;
  // ---- 弦を点が描き、「カチッ」と閉まる。到着したら開く ----
  const draw = E.inOut(P(T, LK0 + .85, LK0 + 1.65));
  const dash = (p, len, k) => { p.style.strokeDasharray = len; p.style.strokeDashoffset = (len * (1 - k)).toFixed(2); p.style.opacity = k > 0 ? 1 : 0; };
  dash($('shPath'), shLen, draw); dash($('shGlow'), shLen, draw);
  const close = spring(T - tClick, 200, 15), open = T > tArr ? spring(T - tArr, 170, 13) : 0;
  $('shGroup').setAttribute('transform', `translate(0 ${(OPEN_Y * ((1 - close) + open)).toFixed(2)})`);
  $('shGlow').style.opacity = (draw > 0 ? .85 * (1 - E.in(P(T, tClick + .05, tClick + .55))) : 0).toFixed(3);
  const pen = $('lockPen'), pt = $('shPath').getPointAtLength(draw * shLen);
  const penO = P(T, LK0 + .7, LK0 + .82) * (1 - E.in(P(T, tClick - .3, tClick - .15)));
  pen.style.transform = `translate3d(${pt.x.toFixed(1)}px,${(pt.y + OPEN_Y).toFixed(1)}px,0) scale(${(.9 + .5 * Math.sin(Math.PI * draw)).toFixed(3)})`;
  pen.style.opacity = penO.toFixed(3); show(pen, penO > .01);
  // ---- 鍵穴: 施錠で青く点灯 / 到着で消灯 ----
  const on = E.out(P(T, tClick, tClick + .25)) * (1 - E.out(P(T, tArr, tArr + .25)));
  $('keyhole').style.filter = `drop-shadow(0 0 ${(22 * on).toFixed(1)}px rgba(10,132,255,${on.toFixed(2)}))`;
  $('keyhole').querySelectorAll('circle,path').forEach(n => n.setAttribute('fill', on > .01 ? `rgb(${Math.round(lerp(11, 10, on))},${Math.round(lerp(11, 132, on))},${Math.round(lerp(15, 255, on))})` : '#0b0b0f'));
  $('lockBody').querySelectorAll('.lrow').forEach(r => { r.style.opacity = (.85 - .45 * on).toFixed(3); });
  // ---- 運ぶ: 出発点 → (弧を描いて) → 相手のシェルフの前 → 開く → 行になって収まる ----
  const pr = E.inOut(P(T, tTr0, tTr1_(tTr0)));
  let mx = LK_S[0], my = LK_S[1], ms = 1, mr = 0, mo = 1;
  if (T >= tTr0) { const q = CURVE_PT(LK_S, lkC1, lkC2, LK_A, pr); mx = q[0]; my = q[1]; ms = lerp(1, .5, pr); mr = 7 * Math.sin(Math.PI * pr); }
  const row = PW2.m.rows[1], R1 = [RCV.x + RCV.s * 160, RCV.y + RCV.s * (row.top + row.height / 2)];
  const ab = E.in(P(T, tArr + .38, tArr + .78));
  if (ab > 0) { mx = lerp(LK_A[0], R1[0], ab); my = lerp(LK_A[1], R1[1], ab); ms = lerp(.5, .16, ab); mo = 1 - clamp((ab - .55) / .45); }
  const mover = $('lockMover');
  mover.style.transform = `translate3d(${(mx - 960).toFixed(1)}px,${(my - 660).toFixed(1)}px,0) rotate(${mr.toFixed(2)}deg) scale(${ms.toFixed(4)})`;
  mover.style.opacity = mo.toFixed(3);
  // 軌跡
  const tr = E.inOut(P(T, tTr0, tArr)), tf = 1 - E.in(P(T, tArr + .1, tArr + .6));
  ['trailG', 'trailP'].forEach(id => { const p = $(id); p.style.strokeDashoffset = (1 - tr).toFixed(4); p.style.opacity = (T > tTr0 ? (id === 'trailG' ? .5 : .8) * tf : 0).toFixed(3); });
  $('gLock').style.opacity = (E.out(P(T, LK0 + .3, LK0 + 1.4)) * (1 - E.in(P(T, tTr0, tTr0 + .5)))).toFixed(3);
  // 受け取り側 (Windows のシェルフ)
  const rv = E.out(P(T, LK0 + 1.9, LK0 + 2.5));
  S($('rcv'), { x: 80 * (1 - rv), s: RCV.s, o: rv });
  PW2.update({ ins: spring(T - (tArr + .42), 130, 15) });
}
function tTr1_(tTr0) { return tTr0 + 1.1; }
const ZX = 640;
function s5(T) {
  const b = $('s3blue'), on = T > COL - .55 && T < COL + .5;
  if (!show(b, on)) return;
  b.style.opacity = E.out(P(T, COL - .5, COL - .2)).toFixed(3);
  if (T < COL) b.style.clipPath = 'none';
  else { const r = lerp(1700, 14, E.inOut(P(T, COL, COL + .43))); b.style.clipPath = `circle(${r.toFixed(1)}px at ${ZX}px 540px)`; }
}

''')

# ------------------------------------------------------------------ グレイン削除
rep("const gctx = $('grain').getContext('2d');\n{ const id = gctx.createImageData(680, 400); for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } gctx.putImageData(id, 0, 0); }\n", '')
rep("  const f = Math.floor(T * 60);\n  $('grain').style.transform = `translate3d(${(hash(f) * 60).toFixed(0)}px,${(hash(f + 77) * 60).toFixed(0)}px,0)`;\n", '')

# フィルタ表示で、画面の下 (畳まれた位置) にある行は画像が無い → 作らない
rep("this.f = m.filter.rows.map((r, i) => ({ i, top: r.top, h: r.height, img: mkImg(base + `frow${i}.png`, v) }));",
    "this.f = m.filter.rows.map((r, i) => ({ i, top: r.top, h: r.height, img: r.top >= m.dz.bottom - 4 ? null : mkImg(base + `frow${i}.png`, v) }));")
rep("        if (Object.values(mapNF).includes(i)) { fr.img.style.opacity = 0; return; }",
    "        if (!fr.img) return;\n        if (Object.values(mapNF).includes(i)) { fr.img.style.opacity = 0; return; }")

open('film7.html', 'w', encoding='utf-8').write(s)
print('film7.html written', len(s))
