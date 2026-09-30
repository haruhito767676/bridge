#!/usr/bin/env python3
"""サイト用 (ライト): 「Mac では Mac らしく、Windows では Windows らしく。」 — Mac と Windows を左右に並べた 1 本の動画。
   同じ操作を、それぞれの OS の画面で見せる (画面の右半分を映す。パネルは実アプリの UI: ui/plates-light/{mac,win})。
     1 開く   … 右端のつまみにマウスを重ねる → パネルが開く (実アプリと同じ、行き過ぎない臨界減衰のスプリング 0.32 秒)
     2 コピー … 先頭に項目が入る → メニューバー (Mac) / タスクトレイ (Windows) の状態アイコンに同期の進み具合が出る
     3 選ぶ   … 項目をクリック → コピーされて ✓ が出る (クリックしても青くはならない: 青い選択はキーボード操作のとき)
   キーボードのバッジは出さない。1920x1080 で書き出す (左 960 が Mac、右 960 が Windows)。"""
DUR = 9.8

PAGE = r'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Bridge clip: compare</title>
<style>
:root{--display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Hiragino Sans","Noto Sans JP",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#eceef5;font-family:var(--display);-webkit-font-smoothing:antialiased;color:#1d1d1f}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden}
.half{position:absolute;top:0;width:960px;height:1080px;overflow:hidden}
#hm{left:0}#hw{left:960px}
.cam{position:absolute;left:0;top:0;width:1600px;height:900px;transform-origin:0 0;transform:translate3d(-960px,0,0) scale(1.2)}   /* 画面の右半分 (x 800〜1600) を 960px に */
.scr{position:absolute;left:0;top:0;width:1600px;height:900px;overflow:hidden}
.scr.mac{background:radial-gradient(70% 60% at 92% 96%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(70% 60% at 6% 8%,#9fe8d3 0%,rgba(159,232,211,0) 62%),radial-gradient(60% 50% at 50% 50%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(160deg,#e3f4ff,#e8e4ff)}
.scr.win{background:radial-gradient(60% 70% at 18% 12%,#9fc4ff 0%,rgba(159,196,255,0) 62%),radial-gradient(70% 70% at 88% 88%,#e2b6ff 0%,rgba(226,182,255,0) 62%),radial-gradient(50% 50% at 55% 45%,#c9e6ff 0%,rgba(201,230,255,0) 64%),linear-gradient(135deg,#dbe8ff,#f4ecff)}
#divider{position:absolute;left:959px;top:0;width:2px;height:1080px;background:rgba(255,255,255,.75);z-index:60;box-shadow:0 0 0 .5px rgba(0,0,0,.06)}
.menubar{position:absolute;left:0;right:0;top:0;height:28px;z-index:30;background:rgba(255,255,255,.52);backdrop-filter:blur(20px) saturate(1.6);display:flex;align-items:center;justify-content:flex-end;padding:0 14px;font:500 13.5px var(--display);color:#1d1d1f;gap:14px}
.menubar svg{width:16px;height:16px;fill:none;stroke:#1d1d1f;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.menubar .clk{font-weight:600;font-size:17px}
.taskbar{position:absolute;left:0;right:0;bottom:0;height:52px;z-index:30;background:rgba(244,246,252,.8);backdrop-filter:blur(30px) saturate(1.5);box-shadow:inset 0 .5px 0 rgba(0,0,0,.1)}
.taskbar .tray{position:absolute;right:18px;top:0;height:52px;display:flex;align-items:center;gap:14px;font:12px/1.25 var(--display);color:#222;text-align:right}
.taskbar .tray svg{width:17px;height:17px;stroke:#222;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.taskbar .tray .clk{font-weight:600;font-size:16px}
.win{position:absolute;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.2),0 30px 80px rgba(20,30,60,.3);z-index:4}
.win .bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;font:600 13px var(--display);color:rgba(0,0,0,.6);background:#f3f3f5;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08)}
.tl{width:12px;height:12px;border-radius:6px;background:#ff5f57;flex:none}.tl.y{background:#febc2e}.tl.g{background:#28c840}
.wn{position:absolute;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.16),0 24px 60px rgba(20,30,60,.3);z-index:4}
.wn .cap{height:36px;display:flex;align-items:center;padding:0 0 0 14px;font:12px var(--display);color:#333;background:#eef0f6;position:relative}
.wn .cap .cb{position:absolute;right:0;top:0;display:flex;height:36px}
.wn .cap .cb i{width:46px;display:flex;align-items:center;justify-content:center}
.wn .cap .cb svg{width:11px;height:11px;stroke:#333;fill:none;stroke-width:1.1}
.sl{height:9px;border-radius:5px;background:rgba(0,0,0,.1)}
.txt{position:absolute;left:130px;top:92px;font:21px/1.7 var(--display);color:#222;white-space:nowrap}
.txt mark{background:rgba(10,132,255,.28);color:inherit;border-radius:3px;padding:1px 0}
/* Bridge パネル */
.pslot{position:absolute;left:1280px;top:150px;width:320px;height:600px;z-index:10}
.panel{position:absolute;left:0;top:0;width:320px;height:600px;overflow:hidden}
.panel.glass{border-radius:14px 0 0 14px;background:rgba(250,250,251,.86);backdrop-filter:blur(30px) saturate(1.7);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12),0 26px 64px -20px rgba(20,20,25,.34),0 0 0 1px rgba(0,0,0,.05)}
.panel.fluent{border-radius:8px 0 0 8px;background:#fbfbfc;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1),0 26px 64px -20px rgba(20,20,25,.34)}
.panel img,.pview img{position:absolute;left:0;width:320px;height:auto}
.pview{position:absolute;left:0;overflow:hidden;width:320px}
.pill{position:absolute;left:1592px;top:400px;width:6px;height:72px;border-radius:3px;background:rgba(0,0,0,.28);z-index:9}
/* キーボード */
.keys{position:absolute;left:1120px;top:790px;z-index:40;display:flex;gap:8px;opacity:0}
.keys b{min-width:52px;height:46px;padding:0 14px;border-radius:10px;background:rgba(255,255,255,.92);box-shadow:0 1px 0 rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.12),0 8px 18px rgba(0,0,0,.16);display:flex;align-items:center;justify-content:center;font:600 17px var(--display);color:#222;transition:none}
.keys b.dn{background:#fff;transform:translateY(2px);box-shadow:0 0 0 1px rgba(10,132,255,.6),0 2px 6px rgba(0,0,0,.14);color:#0a63c9}
/* 状態アイコン (同期の進み具合) */
.stat{position:relative;width:20px;height:20px;display:inline-block}
.stat svg{position:absolute;inset:0;width:20px;height:20px;stroke:none;fill:none}
.cursor{position:absolute;left:0;top:0;width:28px;height:36px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));z-index:50}
#fade{position:absolute;left:0;top:0;width:1920px;height:1080px;background:#eceef5;opacity:1;pointer-events:none;z-index:99}
</style></head>
<body>
<div id="stage">
  <div class="half" id="hm"><div class="cam"><div class="scr mac">
    <div class="menubar"><svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4.2 4.2 0 0 1 5 0"/></svg><svg viewBox="0 0 26 24" style="width:22px"><rect x="2" y="7" width="19" height="10" rx="2.5"/><path d="M23 10.5v3"/><rect x="4" y="9" width="14" height="6" rx="1" fill="#1d1d1f" stroke="none"/></svg>
      <span class="stat" id="mstat"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" stroke="rgba(0,0,0,.18)" stroke-width="2.4"/><circle id="mring" cx="10" cy="10" r="7" stroke="#0a84ff" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="44" stroke-dashoffset="44" transform="rotate(-90 10 10)"/><path id="mtick" d="M6.5 10.3l2.4 2.4 4.6-5" stroke="#1f9d4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0"/></svg></span>
      <span>100%</span><span class="clk">13:26</span></div>
    <div class="win" style="left:700px;top:60px;width:570px;height:790px"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:12px">メモ</span></div><div class="txt"><span class="sl" style="display:block;width:300px;margin-bottom:16px"></span><span class="sl" style="display:block;width:240px;margin-bottom:22px"></span><span id="mtxt">次回定例は10/15(木) 14:00</span><span class="sl" style="display:block;width:330px;margin-top:26px"></span><span class="sl" style="display:block;width:280px;margin-top:14px"></span><span class="sl" style="display:block;width:310px;margin-top:14px"></span><span class="sl" style="display:block;width:200px;margin-top:14px"></span></div></div>
    <div class="pill" id="mpill"></div>
    <div class="pslot" id="mslot"></div>
    <svg class="cursor" id="mcur" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
  </div></div></div>
  <div class="half" id="hw"><div class="cam"><div class="scr win">
    <div class="wn" style="left:700px;top:40px;width:570px;height:780px"><div class="cap">メモ帳<span class="cb"><i><svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg></i><i><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg></i><i><svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8"/></svg></i></span></div><div class="txt" style="top:60px"><span class="sl" style="display:block;width:300px;margin-bottom:16px"></span><span class="sl" style="display:block;width:240px;margin-bottom:22px"></span><span id="wtxt">次回定例は10/15(木) 14:00</span><span class="sl" style="display:block;width:330px;margin-top:26px"></span><span class="sl" style="display:block;width:280px;margin-top:14px"></span><span class="sl" style="display:block;width:310px;margin-top:14px"></span><span class="sl" style="display:block;width:200px;margin-top:14px"></span></div></div>
    <div class="pill" id="wpill"></div>
    <div class="pslot" id="wslot"></div>
    <div class="taskbar"><div class="tray"><svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4.2 4.2 0 0 1 5 0"/></svg>
      <span class="stat" id="wstat" style="width:22px;height:22px"><svg viewBox="0 0 20 20" style="width:22px;height:22px"><circle cx="10" cy="10" r="7" stroke="rgba(0,0,0,.18)" stroke-width="2.4"/><circle id="wring" cx="10" cy="10" r="7" stroke="#0a84ff" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="44" stroke-dashoffset="44" transform="rotate(-90 10 10)"/><path id="wtick" d="M6.5 10.3l2.4 2.4 4.6-5" stroke="#1f9d4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0"/></svg></span>
      <div><div class="clk">13:26</div><div>2026/09/30</div></div></div></div>
    <svg class="cursor" id="wcur" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
  </div></div></div>
  <div id="divider"></div>
  <div id="fade"></div>
</div>
<script src="ui/plates-light/manifest.js"></script>
<script>
'use strict';
const DUR = __DUR__;
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
const E = { out: bez(.16, 1, .3, 1), inOut: bez(.65, 0, .35, 1), in: bez(.5, 0, .75, 0), flyout: bez(.1, .9, .2, 1) };
function spring(dt, k = 140, c = 22) {
  if (dt <= 0) return 0;
  const w0 = Math.sqrt(k), z = c / (2 * w0);
  if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + (z * w0 / wd) * Math.sin(wd * dt)); }
  return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt);
}
class Panel {
  constructor(key, slot, cls) {
    const m = this.m = MANIFEST[key]; const base = `ui/plates-light/${key}/`;
    const el = document.createElement('div'); el.className = 'panel ' + cls; slot.appendChild(el);
    const mk = (src, par) => { const i = new Image(); i.src = src; i.decoding = 'sync'; par.appendChild(i); return i; };
    mk(base + 'chrome.png', el).style.top = '0';
    const v = document.createElement('div'); v.className = 'pview'; v.style.top = m.dz.top + 'px'; v.style.height = (m.dz.bottom - m.dz.top) + 'px'; el.appendChild(v);
    this.n = m.rows.map((r, i) => r.skipped ? null : { i, top: r.top, h: r.height, img: mk(base + `row${i}.png`, v) });
    this.sel = mk(base + 'new-selected.png', v); this.sel.style.opacity = 0;
    this.cop = mk(base + 'new-copied.png', v); this.cop.style.opacity = 0;
    this.dzTop = m.dz.top;
  }
  rowY() { const r = this.m.rows[1]; return 150 + r.top + r.height / 2; }
  update(ins, sel, cop) {
    const n = this.n, top = this.dzTop, sh = n[2].top - n[1].top;
    n.forEach(r => {
      if (!r) return;
      let y = r.top - 2, o = 1, blur = 0, sc = 1;
      if (r.i >= 2) y -= sh * (1 - ins);
      if (r.i === 1) { o = clamp(ins * 1.5); y -= 18 * (1 - ins); sc = .96 + .04 * clamp(ins); blur = 6 * (1 - clamp(ins)); }
      const tr = `translate3d(0,${(y - top).toFixed(2)}px,0) scale(${sc.toFixed(4)})`, fl = blur > .2 ? `blur(${blur.toFixed(1)}px)` : '';
      if (r.i === 1) {
        r.img.style.opacity = (o * (1 - Math.max(sel, cop))).toFixed(3);
        this.sel.style.opacity = (sel * (1 - cop) * clamp(ins * 1.5)).toFixed(3); this.cop.style.opacity = (cop * clamp(ins * 1.5)).toFixed(3);
        this.sel.style.transform = tr; this.cop.style.transform = tr;
      } else r.img.style.opacity = o.toFixed(3);
      r.img.style.transform = tr; r.img.style.filter = fl;
    });
  }
}
const PM = new Panel('mac', $('mslot'), 'glass'), PW = new Panel('win', $('wslot'), 'fluent');
const ROWY = PM.rowY();
function path(kf, u) {
  if (u <= kf[0][0]) return [kf[0][1], kf[0][2]];
  for (let i = 1; i < kf.length; i++) if (u <= kf[i][0]) { const a = kf[i - 1], b = kf[i], p = E.inOut(P(u, a[0], b[0])); return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)]; }
  const l = kf[kf.length - 1]; return [l[1], l[2]];
}
// 時間割 (両 OS で同じ)。開閉は実アプリと同じ臨界減衰のスプリング (応答 0.32 秒・行き過ぎない)
const W0 = 2 * Math.PI / 0.32, crit = dt => dt <= 0 ? 0 : 1 - (1 + W0 * dt) * Math.exp(-W0 * dt);
const T_HOVER = 1.5, T_COPY = 3.85, T_SYNC0 = 4.6, T_SYNC1 = 6.0, T_CLICK = 7.1, T_LEAVE = 8.3;
let TXT0 = null;   // 選択するテキストの左端 (画面座標)
const measure = () => { const r = $('mtxt').getBoundingClientRect(); TXT0 = [(r.left + 960) / 1.2, (r.top + r.height / 2) / 1.2, r.width / 1.2]; };
const ROWC = [1440, ROWY];
function kfs() {
  const a = [TXT0[0] - 6, TXT0[1]], b = [TXT0[0] + TXT0[2], TXT0[1]];
  return [[0.9, 1300, 520], [T_HOVER, 1591, 436], [2.4, 1591, 436], [3.1, a[0], a[1]], [3.2, a[0], a[1]], [3.7, b[0], b[1]], [4.6, b[0] + 60, b[1] + 60], [6.5, ROWC[0], ROWC[1]], [7.2, ROWC[0], ROWC[1]], [8.0, ROWC[0], ROWC[1]], [8.9, 1000, 640]];
}
let t = 0;
function render(T) {
  t = T; if (!TXT0) measure();
  const KF = kfs();
  // ---- 開く / 閉じる (つまみにマウスを重ねると開き、離れると閉じる) ----
  const open = T < T_LEAVE ? crit(T - T_HOVER) : 1 - crit(T - (T_LEAVE + .15)) + (T < T_LEAVE + .15 ? 0 : 0);
  const openP = T < T_LEAVE + .15 ? crit(T - T_HOVER) : 1 - crit(T - (T_LEAVE + .15));
  const x = 340 * (1 - clamp(openP, 0, 1));
  $('mslot').style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; $('mslot').style.opacity = openP > .002 ? 1 : 0;
  $('wslot').style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; $('wslot').style.opacity = openP > .002 ? 1 : 0;
  $('mpill').style.opacity = $('wpill').style.opacity = (1 - clamp(openP * 3)).toFixed(3);
  // ---- 項目が入る / クリックでコピー (✓) ----
  const ins = 1 - Math.exp(-(T - T_COPY) * 9) * (1 + (T - T_COPY) * 9);   // 臨界減衰: 行き過ぎずに収まる
  const insV = T < T_COPY ? 0 : clamp(ins);
  const cop = E.out(P(T, T_CLICK, T_CLICK + .08)) * (1 - E.in(P(T, T_CLICK + 1.0, T_CLICK + 1.2)));
  PM.update(insV, 0, cop); PW.update(insV, 0, cop);
  // ---- 状態アイコン: 同期の進み具合 → ✓ ----
  const pr = E.inOut(P(T, T_SYNC0, T_SYNC1)), done = P(T, T_SYNC1, T_SYNC1 + .2), gone = P(T, T_SYNC1 + 1.0, T_SYNC1 + 1.4);
  ['m', 'w'].forEach(k => {
    $(k + 'ring').setAttribute('stroke-dashoffset', (44 * (1 - pr)).toFixed(2)); $(k + 'ring').style.opacity = (1 - done).toFixed(3);
    $(k + 'tick').style.opacity = (done * (1 - gone)).toFixed(3);
  });
  // ---- テキストの選択 ----
  ['mtxt', 'wtxt'].forEach(id => { const e = $(id); const on = T >= 3.2 && T < T_COPY + .9; e.innerHTML = on ? '<mark>次回定例は10/15(木) 14:00</mark>' : '次回定例は10/15(木) 14:00'; });
  // ---- カーソル ----
  const p = path(KF, T), op = P(T, 0.9, 1.1) * (1 - P(T, 8.8, 9.2)), press = (T > T_CLICK - .05 && T < T_CLICK + .08) || (T > 3.15 && T < 3.25) ? .86 : 1;
  ['mcur', 'wcur'].forEach(id => { const c = $(id); c.style.transform = `translate3d(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px,0) scale(${press})`; c.style.opacity = op.toFixed(3); });
  $('fade').style.opacity = Math.max(1 - P(T, 0, .35), P(T, DUR - .4, DUR)).toFixed(3);
}
window.renderAt = T => render(clamp(T, 0, DUR));
window.__ready = (async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; render(0); return true; })();
</script></body></html>
'''
open('clip_compare.html', 'w', encoding='utf8').write(PAGE.replace('__DUR__', str(DUR)))
print('clip_compare.html dur', DUR)
