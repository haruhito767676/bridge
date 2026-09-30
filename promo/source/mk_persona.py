#!/usr/bin/env python3
"""サイト用 (ライト): 「どんな仕事でも、ちゃんと残る。」 — 1 本の動画に 3 章。
   章 1 オフィスワーカー … Excel で売上合計をコピー → 画面右端にカーソル → パネルが開いて、先頭に入っている
   章 2 クリエイター     … Finder の書き出し画像をパネルへドラッグ → 履歴に入る
   章 3 エンジニア       … ターミナルで ⌥⌘V → 「ssh」と打って絞り込み → Enter で貼り付け
   画角: 広い画面 (Mac の画面ごと) → アクティブなウィンドウ + 右端のパネルへ寄る → 引く。
   パネル/ポップアップは実アプリの UI (ui/persona-plates.mjs を SCHEME=light で撮ったもの)。
   1 章 = 8.4 秒 (章の切り替えは、サイト側のボタンで頭出しする)。1920x1080 で書き出し。"""
CH, N = 8.4, 3
DUR = round(CH * N, 3)

PAGE = r'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Bridge clip: persona</title>
<style>
:root{--display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Hiragino Sans","Noto Sans JP",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#f4f5f8;font-family:var(--display);-webkit-font-smoothing:antialiased;color:#1d1d1f}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden}
#cam{position:absolute;left:0;top:0;width:1600px;height:900px;transform-origin:0 0}
#scr{position:absolute;left:0;top:0;width:1600px;height:900px;overflow:hidden;
  background:radial-gradient(70% 60% at 92% 96%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(70% 60% at 6% 8%,#9fe8d3 0%,rgba(159,232,211,0) 62%),radial-gradient(60% 50% at 50% 50%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(160deg,#e3f4ff,#e8e4ff)}
.scene{position:absolute;left:0;top:0;width:1600px;height:900px}
.menubar{position:absolute;left:0;right:0;top:0;height:28px;background:rgba(255,255,255,.52);backdrop-filter:blur(20px) saturate(1.6);display:flex;align-items:center;justify-content:space-between;padding:0 14px;font:500 13.5px var(--display);color:#1d1d1f}
.menubar>div{display:flex;align-items:center}
.menubar b{font-weight:700;margin-right:20px}
.menubar span{margin-right:20px;opacity:.86}
.menubar svg{width:14px;height:14px;margin-right:20px;fill:#1d1d1f}
.dock{position:absolute;left:50%;bottom:10px;height:70px;padding:0 12px;border-radius:22px;background:rgba(255,255,255,.4);box-shadow:inset 0 0 0 1px rgba(255,255,255,.6),0 12px 34px rgba(30,40,80,.18);backdrop-filter:blur(24px) saturate(1.5);display:flex;align-items:center;gap:10px;transform:translateX(-50%)}
.dock .di{position:relative;width:52px;height:52px;flex:none}
.dock .di img{width:52px;height:52px;display:block}
.dock .di.run::after{content:"";position:absolute;left:50%;bottom:-8px;width:4.5px;height:4.5px;margin-left:-2.2px;border-radius:3px;background:rgba(0,0,0,.55)}
.dock .sep{width:1.5px;height:46px;border-radius:1px;background:rgba(0,0,0,.16);flex:none;margin:0 2px}
.win{position:absolute;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.2),0 30px 80px rgba(20,30,60,.3)}
.win .bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;font:600 13px var(--display);color:rgba(0,0,0,.6);background:#f3f3f5;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08)}
.tl{width:12px;height:12px;border-radius:6px;background:#ff5f57;flex:none}.tl.y{background:#febc2e}.tl.g{background:#28c840}
/* Excel */
.xl .rib{height:30px;background:#217346;display:flex;align-items:center;gap:20px;padding:0 16px;font:600 12px var(--display);color:rgba(255,255,255,.92)}
.xl .fbar{position:absolute;left:0;right:0;top:70px;height:30px;background:#fff;box-shadow:inset 0 -1px 0 rgba(0,0,0,.1);display:flex;align-items:center;font:13px var(--display);color:#222}
.xl .fbar .nb{width:72px;text-align:center;box-shadow:inset -1px 0 0 rgba(0,0,0,.1);height:100%;line-height:30px}
.xl .fbar .fx{width:34px;text-align:center;color:#888;font-style:italic}
.xl .grid{position:absolute;left:0;top:100px;right:0;bottom:0;font:13px var(--display);color:#222}
.xl .ch{position:absolute;top:0;height:24px;background:#f1f2f4;box-shadow:inset -1px -1px 0 rgba(0,0,0,.1);text-align:center;line-height:24px;color:#666;font-size:12px}
.xl .rh{position:absolute;left:0;width:40px;height:26px;background:#f1f2f4;box-shadow:inset -1px -1px 0 rgba(0,0,0,.1);text-align:center;line-height:26px;color:#666;font-size:12px}
.xl .c{position:absolute;height:26px;line-height:26px;padding:0 8px;box-shadow:inset -1px -1px 0 rgba(0,0,0,.07);white-space:nowrap;overflow:hidden}
.xl .c.r{text-align:right}.xl .c.h{background:#f6f7f9;font-weight:700}.xl .c.tt{font-weight:700}
#xsel{position:absolute;box-shadow:inset 0 0 0 2px #217346;background:rgba(33,115,70,.09);pointer-events:none}
#xants{position:absolute;pointer-events:none}
/* Finder */
.fn .side{position:absolute;left:0;top:40px;bottom:0;width:130px;background:#f0f1f5;box-shadow:inset -1px 0 0 rgba(0,0,0,.07)}
.fn .side i{display:block;height:9px;border-radius:5px;background:rgba(0,0,0,.12);margin:20px 16px 0}
.fitem{position:absolute;width:170px;height:170px}
.fitem .th{position:absolute;left:10px;top:0;width:150px;height:100px;border-radius:8px;object-fit:cover;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 6px 16px rgba(0,0,0,.12);background:#fff}
.fitem .nm{position:absolute;left:6px;right:6px;top:110px;text-align:center;font:500 12.5px/1.3 var(--display);padding:2px 6px;border-radius:6px;word-break:break-all;color:#222}
.fitem.sel .th{box-shadow:0 0 0 3px rgba(10,132,255,.55),0 6px 16px rgba(0,0,0,.12)}
.fitem.sel .nm{background:#0a84ff;color:#fff}
.fitem.out{opacity:.45}
#ghost{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.gtile{position:absolute;left:0;top:0;width:96px;height:68px;border-radius:8px;background:#fff center/cover;box-shadow:0 0 0 1px rgba(0,0,0,.18),0 16px 34px rgba(0,0,0,.3)}
/* Terminal */
.tm{background:#fdfdfd}
.tm .bar{background:#e9e9ec}
.tm .body{position:absolute;left:0;right:0;top:40px;bottom:0;padding:14px 20px;font:15px/22px var(--mono);color:#1d1d1f;white-space:pre}
.tm .dim{color:#7a7a80}
.caret{display:inline-block;width:9px;height:18px;background:#1d1d1f;vertical-align:-3px}
/* Bridge panel / popup */
.pslot{position:absolute;left:1280px;top:130px;width:320px;height:600px}
.panel{position:absolute;left:0;top:0;width:320px;height:600px;overflow:hidden;border-radius:14px 0 0 14px;background:rgba(250,250,251,.86);backdrop-filter:blur(30px) saturate(1.7);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12),0 26px 64px -20px rgba(20,20,25,.34),0 0 0 1px rgba(0,0,0,.05)}
.panel img,.pview img{position:absolute;left:0;width:320px;height:auto}
.pview{position:absolute;left:0;overflow:hidden;width:320px}
.pill{position:absolute;left:1592px;top:400px;width:6px;height:72px;border-radius:3px;background:rgba(0,0,0,.28)}
#newhl{position:absolute;left:8px;width:304px;border-radius:10px;background:rgba(10,132,255,.2);opacity:0}
.popglass{position:absolute;width:300px;height:380px;border-radius:14px;overflow:hidden;transform-origin:0 0;background:rgba(250,250,252,.82);backdrop-filter:blur(30px) saturate(1.7);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.16),0 24px 70px rgba(0,0,0,.28)}
.popglass img{position:absolute;left:0;top:0;width:300px;height:380px}
#curs{position:absolute;left:0;top:0;width:28px;height:36px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));z-index:50}
#fade{position:absolute;left:0;top:0;width:1920px;height:1080px;background:#f4f5f8;opacity:1;pointer-events:none;z-index:99}
</style></head>
<body>
<div id="stage"><div id="cam"><div id="scr">
__SCENES__
  <div id="ghost"></div>
  <svg id="curs" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
</div></div>
<div id="fade"></div></div>
<script src="ui/plates-persona/manifest.js"></script>
<script>
'use strict';
const CH = __CH__, N = __N__, DUR = __DUR__;
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const P = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
const bez = (x1, y1, x2, y2) => x => {
  if (x <= 0) return 0; if (x >= 1) return 1;
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 22; i++) { u = (lo + hi) / 2; const bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u; if (bx < x) lo = u; else hi = u; }
  return 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
};
const E = { out: bez(.16, 1, .3, 1), inOut: bez(.65, 0, .35, 1), soft: bez(.45, 0, .2, 1), in: bez(.5, 0, .75, 0) };
function spring(dt, k = 140, c = 22) {
  if (dt <= 0) return 0;
  const w0 = Math.sqrt(k), z = c / (2 * w0);
  if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + (z * w0 / wd) * Math.sin(wd * dt)); }
  return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt);
}
const DEMO = '../../assets/demo/';

// ---------- カメラ: 広い画面 → (ウィンドウ + 右端のパネル) へ寄る → 引く ----------
const WIDE = { cx: 800, cy: 450, s: 1.2 }, NEAR = { cx: 1048, cy: 432, s: 1.74 };
function camAt(u) {
  const a = E.soft(P(u, .9, 1.95)), b = E.soft(P(u, 5.85, 6.95)), p = a * (1 - b);
  const s = Math.exp(lerp(Math.log(WIDE.s), Math.log(NEAR.s), p));
  return { cx: lerp(WIDE.cx, NEAR.cx, p), cy: lerp(WIDE.cy, NEAR.cy, p), s: s * (1 + .012 * P(u, 2, 5.85) * (1 - b)) };
}

// ---------- パネル (実アプリの行の部品を並べる) ----------
class Panel {
  constructor(key, slot) {
    const m = this.m = PMAN[key]; const base = `ui/plates-persona/${key}/`;
    const el = this.el = document.createElement('div'); el.className = 'panel'; slot.appendChild(el);
    const mk = (src, par) => { const i = new Image(); i.src = src; i.decoding = 'sync'; par.appendChild(i); return i; };
    const c = mk(base + 'chrome.png', el); c.style.top = '0';
    const v = this.view = document.createElement('div'); v.className = 'pview'; v.style.top = m.dz.top + 'px'; v.style.height = (m.dz.bottom - m.dz.top) + 'px'; el.appendChild(v);
    this.n = m.rows.map((r, i) => r.skipped ? null : { i, top: r.top, h: r.height, img: mk(base + `row${i}.png`, v) });
    this.dzTop = m.dz.top;
    const hl = this.hl = document.createElement('div'); hl.id = 'newhl'; el.appendChild(hl);
    if (m.hasNew) { hl.style.top = (m.rows[1].top - 2) + 'px'; hl.style.height = (m.rows[1].height + 4) + 'px'; }
  }
  // ins: 先頭の項目 (rows[1]) が入る量 0..1 / hl: 入った項目を光らせる量
  update(ins, hl = 0) {
    const n = this.n, top = this.dzTop, sh = n[2].top - n[1].top, has = this.m.hasNew;
    n.forEach(r => {
      if (!r) return;
      let y = r.top - 2, o = 1, blur = 0, sc = 1;
      if (has) {
        if (r.i >= 2) y -= sh * (1 - ins);
        if (r.i === 1) { o = clamp(ins * 1.5); y -= 18 * (1 - ins); sc = .96 + .04 * clamp(ins); blur = 6 * (1 - clamp(ins)); }
      }
      r.img.style.opacity = o.toFixed(3);
      r.img.style.transform = `translate3d(0,${(y - top).toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
      r.img.style.filter = blur > .2 ? `blur(${blur.toFixed(1)}px)` : '';
    });
    this.hl.style.opacity = hl.toFixed(3);
  }
}
const panels = {};
['office', 'creator'].forEach((k, i) => { panels[k] = new Panel(k, $('slot' + (i + 1))); });

// ---------- カーソル: [時刻, x, y] のキーフレーム (区間ごとにイーズ) ----------
function path(kf, u) {
  if (u <= kf[0][0]) return [kf[0][1], kf[0][2]];
  for (let i = 1; i < kf.length; i++) if (u <= kf[i][0]) { const a = kf[i - 1], b = kf[i], p = E.inOut(P(u, a[0], b[0])); return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)]; }
  const l = kf[kf.length - 1]; return [l[1], l[2]];
}
const cur = $('curs');
function setCursor(pos, op, press) { cur.style.transform = `translate3d(${pos[0].toFixed(1)}px,${pos[1].toFixed(1)}px,0) scale(${press ? .86 : 1})`; cur.style.opacity = op.toFixed(3); }

// ---------- 章 1: Excel ----------
const XL = { x: 610, y: 160 };   // ウィンドウの左上
const XA9 = [XL.x + 40 + 8, XL.y + 124 + 8 * 26 + 13];   // A9 の左端
const KF1 = [[1.45, 1010, 640], [2.3, XA9[0] + 14, XA9[1]], [2.42, XA9[0] + 14, XA9[1]], [2.95, 900, XA9[1]], [3.7, 900, XA9[1]], [4.35, 1592, 438], [5.9, 1592, 438], [6.6, 1500, 520]];
function scene1(u) {
  const dragP = E.inOut(P(u, 2.45, 2.95)), started = u >= 2.42;
  const sel = $('xsel'); sel.style.display = started ? '' : 'none';
  const w = lerp(190, 320, dragP); sel.style.width = w + 'px'; sel.style.left = (40) + 'px'; sel.style.top = '232px'; sel.style.height = '26px';
  const ants = $('xants'), copied = u >= 3.25 && u < 5.95; ants.style.display = copied ? '' : 'none';
  ants.firstElementChild.setAttribute('stroke-dashoffset', (-(u - 3.25) * 22).toFixed(1));
  $('xnb').textContent = 'A9';
  const open = spring(u - 4.42, 110, 16);
  $('slot1').style.transform = `translate3d(${(340 * (1 - open)).toFixed(1)}px,0,0)`; $('slot1').style.opacity = u < 4.4 ? 0 : 1;
  $('pill1').style.opacity = (1 - P(u, 4.3, 4.55)).toFixed(3);
  panels.office.update(1, .95 * P(u, 4.7, 4.95) * (1 - P(u, 5.0, 6.0)));
  return { cur: path(KF1, u), op: P(u, 1.45, 1.7) * (1 - P(u, 6.6, 7.0)), press: u > 2.42 && u < 2.5 };
}

// ---------- 章 2: Finder → パネルへドラッグ ----------
const FILES2 = ['バナー案_A案.png', 'バナー案_B案.png', 'バナー案_C案.png', 'アイコンセット_v2.png', 'ロゴ_v4.png', '名刺デザイン案.png'];
const FX0 = 610 + 130, FY0 = 160 + 40;
const C_CENTER = [FX0 + 170 * 2 + 85, FY0 + 24 + 50];
const KF2 = [[1.45, 1010, 700], [2.4, C_CENTER[0] + 6, C_CENTER[1] + 4], [2.95, C_CENTER[0] + 6, C_CENTER[1] + 4], [3.75, 1360, 300], [4.45, 1428, 264], [4.6, 1428, 264], [5.9, 1240, 520]];
function scene2(u) {
  const sel = u >= 2.5 && u < 4.6, drag = u >= 3.0 && u < 4.75;
  document.querySelectorAll('#s2files .fitem').forEach((el, i) => { el.classList.toggle('sel', i === 2 && sel); el.classList.toggle('out', i === 2 && drag); });
  const open = spring(u - 3.55, 105, 15);
  $('slot2').style.transform = `translate3d(${(340 * (1 - open)).toFixed(1)}px,0,0)`; $('slot2').style.opacity = u < 3.5 ? 0 : 1;
  $('pill2').style.opacity = (1 - P(u, 3.45, 3.7)).toFixed(3);
  const ins = spring(u - 4.55, 95, 14);
  panels.creator.update(clamp(ins, 0, 1.06), 0);
  const g = $('ghost'), pos = path(KF2, u);
  const gs = 1 - .55 * E.in(P(u, 4.5, 4.75)), go = drag ? (1 - E.in(P(u, 4.55, 4.78))) : 0;
  g.style.opacity = go.toFixed(3); g.style.transform = `translate3d(${(pos[0] + 8).toFixed(1)}px,${(pos[1] + 10).toFixed(1)}px,0) scale(${gs.toFixed(3)})`;
  return { cur: pos, op: P(u, 1.45, 1.7) * (1 - P(u, 6.5, 6.9)), press: u > 2.42 && u < 2.52 };
}

// ---------- 章 3: ターミナル + ⌥⌘V ----------
const CMD = 'ssh deploy@192.168.1.42 -p 2222';
const CARET3 = [610 + 20 + 13 * 9.03, 160 + 40 + 14 + 22];
function scene3(u) {
  const pOpen = spring(u - 2.35, 150, 17), pOut = 1 - E.in(P(u, 4.45, 4.62));
  const q = u >= 3.75 ? 3 : u >= 3.45 ? 2 : u >= 3.15 ? 1 : 0;
  ['pop0', 'popq1', 'popq2', 'popq3'].forEach((id, i) => $(id).style.opacity = i === q ? 1 : 0);
  const pop = $('popIm'); pop.style.left = (CARET3[0] + 4) + 'px'; pop.style.top = (CARET3[1] + 28) + 'px';
  pop.style.opacity = (clamp(pOpen * 1.6) * pOut).toFixed(3);
  pop.style.transform = `translate3d(0,${(8 * (1 - clamp(pOpen))).toFixed(1)}px,0) scale(${(.96 + .04 * clamp(pOpen)).toFixed(4)})`;
  const pasted = u >= 4.5, ran = u >= 5.2;
  const blink = Math.floor(u * 2) % 2 === 0 || (u > 2.2 && u < 4.5);
  const cm = '<span class="caret" style="opacity:' + (blink ? 1 : 0) + '"></span>';
  $('tmBody').innerHTML = `<span class="dim">Last login: Wed Sep 30 09:12:41 on ttys001</span>\n` +
    `haru@mbp ~ % ${pasted ? CMD : ''}${ran ? '' : cm}` + (ran ? `\n<span class="dim">Welcome to Ubuntu 22.04.4 LTS (GNU/Linux 5.15.0-101-generic)</span>\ndeploy@stg-01:~$ ${cm}` : '');
  return { cur: [1180, 560], op: 0, press: false };
}

const SCENES = [scene1, scene2, scene3];
const RUN = [[0, 5], [0, 2], [0, 6]];
function render(T) {
  T = clamp(T, 0, DUR - 1e-4);
  const c = Math.min(N - 1, Math.floor(T / CH)), u = T - c * CH;
  document.querySelectorAll('.scene').forEach((el, i) => el.style.display = i === c ? '' : 'none');
  const r = SCENES[c](u);
  setCursor(r.cur, r.op, r.press);
  const k = camAt(u);
  $('cam').style.transform = `translate3d(${(960 - k.cx * k.s).toFixed(2)}px,${(540 - k.cy * k.s).toFixed(2)}px,0) scale(${k.s.toFixed(4)})`;
  $('fade').style.opacity = Math.max(1 - P(u, 0, .32), P(u, CH - .38, CH)).toFixed(3);
}
window.renderAt = t => render(t);
window.__ready = (async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; render(0); return true; })();
</script></body></html>
'''

APPS = ['Finder', 'Chrome', 'Slack', 'Notion', 'Figma', 'Excel', 'Terminal']
TRASH = '<svg width="52" height="52" viewBox="0 0 64 64"><defs><linearGradient id="tgS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f5"/><stop offset="1" stop-color="#9aa0ad"/></linearGradient></defs><path d="M18 20h28l-2.5 34a4 4 0 0 1-4 3.6H24.5a4 4 0 0 1-4-3.6z" fill="rgba(255,255,255,.5)" stroke="#8a90a0" stroke-width="2.5"/><rect x="14" y="14" width="36" height="6" rx="3" fill="#aeb3c0"/><rect x="26" y="9" width="12" height="6" rx="2.5" fill="#aeb3c0"/><path d="M26 26v24M32 26v24M38 26v24" stroke="rgba(120,125,140,.5)" stroke-width="2" stroke-linecap="round"/></svg>'
APPLE = '<svg viewBox="0 0 24 24"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>'


def shell(idx, appname, menus, running, body, slot=True):
    dock = ''.join(f'<span class="di{" run" if a in running else ""}"><img src="ui/appicons/{a}.png"></span>' for a in APPS) + f'<i class="sep"></i><span class="di">{TRASH}</span>'
    mb = f'<div class="menubar"><div>{APPLE}<b>{appname}</b>' + ''.join(f'<span>{m}</span>' for m in menus) + '</div><div><span>100%</span><span>13:26</span></div></div>'
    sl = f'<div class="pill" id="pill{idx}"></div>' + (f'<div class="pslot" id="slot{idx}" style="opacity:0"></div>' if slot else '')
    return f'<div class="scene" id="scene{idx}">{mb}{body}{sl}<div class="dock">{dock}</div></div>'


# --- 章 1: Excel ---
cols = [('A', 40, 190), ('B', 230, 130), ('C', 360, 130), ('D', 490, 130)]
rows = [
    ['項目', '8月', '9月', '前月比'],
    ['ECサイト改修', '¥6,200,000', '¥7,100,000', '+14.5%'],
    ['保守運用', '¥2,400,000', '¥2,400,000', '±0%'],
    ['デザイン制作', '¥1,800,000', '¥2,250,000', '+25.0%'],
    ['撮影・素材', '¥620,000', '¥590,000', '-4.8%'],
    ['その他', '¥480,000', '¥500,000', '+4.2%'],
    ['', '', '', ''], ['', '', '', ''],
    ['9月度 売上合計', '¥12,840,000', '', ''],
    ['', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', ''],
]
g = ''.join(f'<div class="ch" style="left:{x}px;width:{w}px">{n}</div>' for n, x, w in cols)
for r, row in enumerate(rows):
    y = 24 + r * 26
    g += f'<div class="rh" style="top:{y}px">{r + 1}</div>'
    for ci, txt in enumerate(row):
        n, x, w = cols[ci]
        cls = 'c' + (' h' if r == 0 else '') + (' r' if (ci > 0 and r > 0 and txt) else '') + (' tt' if r == 8 else '')
        g += f'<div class="{cls}" style="left:{x}px;top:{y}px;width:{w}px">{txt}</div>'
# 選択枠と、コピー後の点線 (グリッドの座標: 上端は列見出しの下 = 24px)
g += '<div id="xsel" style="left:40px;top:232px;width:190px;height:26px"></div>'
g += '<svg id="xants" style="left:40px;top:232px" width="320" height="26" viewBox="0 0 320 26"><rect x="1.5" y="1.5" width="317" height="23" fill="none" stroke="#217346" stroke-width="2" stroke-dasharray="6 5"/></svg>'
xl = ('<div class="win xl" style="left:610px;top:160px;width:640px;height:470px"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:14px">売上管理_2026.xlsx</span></div>'
      '<div class="rib"><span>ホーム</span><span style="opacity:.6">挿入</span><span style="opacity:.6">ページ レイアウト</span><span style="opacity:.6">数式</span><span style="opacity:.6">データ</span></div>'
      '<div class="fbar"><div class="nb" id="xnb">A1</div><div class="fx">fx</div><div>9月度 売上合計</div></div>'
      f'<div class="grid">{g}</div></div>')
# --- 章 2: Finder ---
FILES2 = ['バナー案_A案.png', 'バナー案_B案.png', 'バナー案_C案.png', 'アイコンセット_v2.png', 'ロゴ_v4.png', '名刺デザイン案.png']
fi = ''
for i, n in enumerate(FILES2):
    col, row = i % 3, i // 3
    fi += f'<div class="fitem" style="left:{130 + col * 170}px;top:{24 + row * 190}px"><img class="th" src="../../assets/demo/{n}"><div class="nm">{n}</div></div>'
fn = ('<div class="win fn" style="left:610px;top:160px;width:640px;height:470px"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:14px">書き出し</span></div>'
      '<div class="side"><i style="width:60px"></i><i style="width:84px"></i><i style="width:52px"></i><i style="width:74px"></i></div>'
      f'<div id="s2files" style="position:absolute;left:0;top:40px;right:0;bottom:0">{fi}</div></div>')
# --- 章 3: ターミナル ---
tm = ('<div class="win tm" style="left:610px;top:160px;width:640px;height:470px"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:14px">haru — -zsh — 80×24</span></div>'
      '<div class="body" id="tmBody"></div></div>'
      '<div class="popglass" id="popIm" style="left:760px;top:270px;opacity:0"><img id="pop0" src="ui/plates-persona/popup/q0.png"><img id="popq1" src="ui/plates-persona/popup/q1.png" style="opacity:0"><img id="popq2" src="ui/plates-persona/popup/q2.png" style="opacity:0"><img id="popq3" src="ui/plates-persona/popup/q3.png" style="opacity:0"></div>')

scenes = (
    shell(1, 'Excel', ['ファイル', '編集', '表示', '挿入', '書式', 'ツール', 'データ', 'ウインドウ', 'ヘルプ'], ['Finder', 'Excel'], xl)
    + shell(2, 'Finder', ['ファイル', '編集', '表示', '移動', 'ウインドウ', 'ヘルプ'], ['Finder', 'Figma'], fn)
    + shell(3, 'ターミナル', ['シェル', '編集', '表示', 'ウインドウ', 'ヘルプ'], ['Finder', 'Terminal'], tm, slot=False)
)
out = PAGE.replace('__SCENES__', scenes).replace('__CH__', str(CH)).replace('__N__', str(N)).replace('__DUR__', str(DUR))
open('clip_persona.html', 'w', encoding='utf8').write(out)
print('clip_persona.html dur', DUR)
