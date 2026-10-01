#!/usr/bin/env python3
"""サイト用 (ライト): 「Mac では Mac らしく、Windows では Windows らしく。」 — Mac と Windows を左右に並べた 1 本の動画 (1920x1080)。
   それぞれの画面の右半分を、角丸の「画面」として間を空けて並べる (中央で急に切れて見えないように)。
   パネルは実アプリの UI (ui/plates-light/{mac,win})。Mac はコピー元のアプリのアイコンが付き、Windows は付かない (既定の設定どおり)。
     1 コピー … メモの文を選んで、コピー → メニューバー (Mac) / タスクトレイ (Windows) の状態アイコンに同期の進み具合が出て、✓
     2 開く   … 右端のつまみにマウスを重ねる → パネルが開く (実アプリと同じ、行き過ぎない臨界減衰のスプリング 0.32 秒)。いまコピーした文が先頭に入っている
     3 取り出す … 履歴の古い項目をクリック → コピーされて ✓ → パネルが閉じる → メモの空いた行に貼り付け
   キーボードのバッジは出さない。"""
DUR = 11.6

PAGE = r'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Bridge clip: compare</title>
<style>
:root{--display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Hiragino Sans","Noto Sans JP",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;--S:1.13778}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#eceef5;font-family:var(--display);-webkit-font-smoothing:antialiased;color:#1d1d1f}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden}
.half{position:absolute;top:28px;width:911px;height:1024px;overflow:hidden;border-radius:22px;box-shadow:0 0 0 1px rgba(20,30,60,.1),0 22px 54px -18px rgba(20,30,60,.3)}
#hm{left:33px}#hw{left:976px}
.cam{position:absolute;left:0;top:0;width:1600px;height:900px;transform-origin:0 0;transform:translate3d(-910.2px,0,0) scale(var(--S))}   /* 画面の右半分 (x 800〜1600) を 911px に */
.scr{position:absolute;left:0;top:0;width:1600px;height:900px;overflow:hidden}
.scr.mac{background:radial-gradient(70% 60% at 92% 96%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(70% 60% at 6% 8%,#9fe8d3 0%,rgba(159,232,211,0) 62%),radial-gradient(60% 50% at 50% 50%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(160deg,#e3f4ff,#e8e4ff)}
.scr.win{background:radial-gradient(60% 70% at 18% 12%,#9fc4ff 0%,rgba(159,196,255,0) 62%),radial-gradient(70% 70% at 88% 88%,#e2b6ff 0%,rgba(226,182,255,0) 62%),radial-gradient(50% 50% at 55% 45%,#c9e6ff 0%,rgba(201,230,255,0) 64%),linear-gradient(135deg,#dbe8ff,#f4ecff)}
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
.memo{padding:34px 34px 0;font:21px/1.6 var(--display);color:#222}
.memo .sl{display:block}
.ln{position:relative;display:inline-block;white-space:nowrap}
.ln .t{position:relative;z-index:1}
.selbar{position:absolute;left:-3px;top:2px;bottom:2px;width:0;background:rgba(10,132,255,.28);border-radius:3px}
.pblock{position:relative;min-height:68px;margin:22px 0}
.pblock .pt{display:block;opacity:0;white-space:normal}
.caret{position:absolute;left:0;top:5px;width:2px;height:28px;background:#222;opacity:0}
/* Bridge パネル */
.pslot{position:absolute;left:1280px;top:150px;width:320px;height:600px;z-index:10}
.panel{position:absolute;left:0;top:0;width:320px;height:600px;overflow:hidden}
.panel.glass{border-radius:14px 0 0 14px;background:rgba(250,250,251,.86);backdrop-filter:blur(30px) saturate(1.7);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12),0 26px 64px -20px rgba(20,20,25,.34),0 0 0 1px rgba(0,0,0,.05)}
.panel.fluent{border-radius:8px 0 0 8px;background:#fbfbfc;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1),0 26px 64px -20px rgba(20,20,25,.34)}
.panel img,.pview img{position:absolute;left:0;width:320px;height:auto}
.pview{position:absolute;left:0;overflow:hidden;width:320px}
.pill{position:absolute;left:1592px;top:400px;width:6px;height:72px;border-radius:3px;background:rgba(0,0,0,.28);z-index:9}
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
    <div class="win" style="left:830px;top:70px;width:420px;height:740px"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:12px">メモ</span></div>
      <div class="memo"><span class="sl" style="width:280px;margin-bottom:14px"></span><span class="sl" style="width:220px;margin-bottom:26px"></span><span class="ln" id="mln"><i class="selbar" id="msel"></i><span class="t">次回定例は10/15(木) 14:00</span></span><span class="sl" style="width:300px;margin-top:26px"></span><span class="sl" style="width:250px;margin-top:14px"></span>
        <div class="pblock" id="mpb"><span class="pt" id="mpt">本日17時までにデザイン差し戻しをお願いします🙏</span><i class="caret" id="mcaret"></i></div>
        <span class="sl" style="width:320px"></span><span class="sl" style="width:270px;margin-top:14px"></span><span class="sl" style="width:200px;margin-top:14px"></span></div></div>
    <div class="pill" id="mpill"></div>
    <div class="pslot" id="mslot"></div>
    <svg class="cursor" id="mcur" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
  </div></div></div>
  <div class="half" id="hw"><div class="cam"><div class="scr win">
    <div class="wn" style="left:830px;top:50px;width:420px;height:740px"><div class="cap">メモ帳<span class="cb"><i><svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg></i><i><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg></i><i><svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8"/></svg></i></span></div>
      <div class="memo" style="padding-top:38px"><span class="sl" style="width:280px;margin-bottom:14px"></span><span class="sl" style="width:220px;margin-bottom:26px"></span><span class="ln" id="wln"><i class="selbar" id="wsel"></i><span class="t">次回定例は10/15(木) 14:00</span></span><span class="sl" style="width:300px;margin-top:26px"></span><span class="sl" style="width:250px;margin-top:14px"></span>
        <div class="pblock" id="wpb"><span class="pt" id="wpt">本日17時までにデザイン差し戻しをお願いします🙏</span><i class="caret" id="wcaret"></i></div>
        <span class="sl" style="width:320px"></span><span class="sl" style="width:270px;margin-top:14px"></span><span class="sl" style="width:200px;margin-top:14px"></span></div></div>
    <div class="pill" id="wpill"></div>
    <div class="pslot" id="wslot"></div>
    <div class="taskbar"><div class="tray"><svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4.2 4.2 0 0 1 5 0"/></svg>
      <span class="stat" id="wstat" style="width:22px;height:22px"><svg viewBox="0 0 20 20" style="width:22px;height:22px"><circle cx="10" cy="10" r="7" stroke="rgba(0,0,0,.18)" stroke-width="2.4"/><circle id="wring" cx="10" cy="10" r="7" stroke="#0a84ff" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="44" stroke-dashoffset="44" transform="rotate(-90 10 10)"/><path id="wtick" d="M6.5 10.3l2.4 2.4 4.6-5" stroke="#1f9d4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0"/></svg></span>
      <div><div class="clk">13:26</div><div>2026/09/30</div></div></div></div>
    <svg class="cursor" id="wcur" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
  </div></div></div>
  <div id="fade"></div>
</div>
<script src="ui/plates-light/manifest.js"></script>
<script>
'use strict';
const DUR = __DUR__, S = 1024 / 900;
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
const E = { out: bez(.16, 1, .3, 1), inOut: bez(.65, 0, .35, 1), in: bez(.5, 0, .75, 0) };
const COPROW = 3;   // 履歴の古い項目 (3 行目: 「本日17時までにデザイン差し戻しを…」) をクリックして取り出す
class Panel {
  constructor(key, slot, cls) {
    const m = this.m = MANIFEST[key]; const base = `ui/plates-light/${key}/`;
    const el = document.createElement('div'); el.className = 'panel ' + cls; slot.appendChild(el);
    const mk = (src, par) => { const i = new Image(); i.src = src; i.decoding = 'sync'; par.appendChild(i); return i; };
    mk(base + 'chrome.png', el).style.top = '0';
    const v = document.createElement('div'); v.className = 'pview'; v.style.top = m.dz.top + 'px'; v.style.height = (m.dz.bottom - m.dz.top) + 'px'; el.appendChild(v);
    this.n = m.rows.map((r, i) => r.skipped ? null : { i, top: r.top, h: r.height, img: mk(base + `row${i}.png`, v) });
    this.cop = mk(base + `row${COPROW}-copied.png`, v); this.cop.style.opacity = 0;
    this.dzTop = m.dz.top;
  }
  rowY(i) { const r = this.m.rows[i]; return 150 + r.top + r.height / 2; }
  update(cop) {
    const top = this.dzTop;
    this.n.forEach(r => {
      if (!r) return;
      const tr = `translate3d(0,${(r.top - 2 - top).toFixed(2)}px,0)`;
      r.img.style.transform = tr;
      if (r.i === COPROW) { r.img.style.opacity = (1 - cop).toFixed(3); this.cop.style.opacity = cop.toFixed(3); this.cop.style.transform = tr; }
    });
  }
}
const PM = new Panel('mac', $('mslot'), 'glass'), PW = new Panel('win', $('wslot'), 'fluent');
const ROWY = PM.rowY(COPROW);
function path(kf, u) {
  if (u <= kf[0][0]) return [kf[0][1], kf[0][2]];
  for (let i = 1; i < kf.length; i++) if (u <= kf[i][0]) { const a = kf[i - 1], b = kf[i], p = E.inOut(P(u, a[0], b[0])); return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)]; }
  const l = kf[kf.length - 1]; return [l[1], l[2]];
}
// 時間割 (両 OS で同じ)。開閉は実アプリと同じ臨界減衰のスプリング (応答 0.32 秒・行き過ぎない)
const W0 = 2 * Math.PI / 0.32, crit = dt => dt <= 0 ? 0 : 1 - (1 + W0 * dt) * Math.exp(-W0 * dt);
const T_SEL0 = 1.0, T_SEL1 = 1.75, T_COPY = 2.0, T_S0 = 2.3, T_S1 = 3.7, T_HOVER = 4.3, T_CLICK = 6.2, T_LEAVE = 7.3, T_PCLICK = 8.3, T_PASTE = 8.6;
let M = null;   // 画面座標 (x 800〜1600 が映る) で測った、文・貼り付け位置
const measure = () => {
  const box = id => { const r = $(id).getBoundingClientRect(), f = $(id).closest('.half').getBoundingClientRect(); return { x: (r.left - f.left) / S + 800, y: (r.top - f.top) / S, w: r.width / S, h: r.height / S }; };
  const a = box('mln'), b = box('mpb'), c = box('wln'), d = box('wpb');
  M = { m: a, mp: b, w: c, wp: d };
};
function side(T, k, PN) {
  const L = k === 'm' ? M.m : M.w, PB = k === 'm' ? M.mp : M.wp;
  // ---- 開く / 閉じる ----
  const openP = T < T_LEAVE ? crit(T - T_HOVER) : 1 - crit(T - T_LEAVE);
  const x = 340 * (1 - clamp(openP));
  $(k + 'slot').style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; $(k + 'slot').style.opacity = openP > .002 ? 1 : 0;
  $(k + 'pill').style.opacity = (1 - clamp(openP * 3)).toFixed(3);
  // ---- 取り出し: 古い項目をクリック → ✓ ----
  const cop = E.out(P(T, T_CLICK, T_CLICK + .08));
  PN.update(cop);
  // ---- テキストの選択 (ドラッグ) → コピー → 状態アイコン ----
  $(k + 'sel').style.width = (L.w + 6) * E.inOut(P(T, T_SEL0, T_SEL1)) * (T < T_S1 + 1.2 ? 1 : 1 - P(T, T_S1 + 1.2, T_S1 + 1.3)) + 'px';
  const pr = E.inOut(P(T, T_S0, T_S1)), done = P(T, T_S1, T_S1 + .2), gone = P(T, T_S1 + 1.0, T_S1 + 1.4);
  $(k + 'ring').setAttribute('stroke-dashoffset', (44 * (1 - pr)).toFixed(2)); $(k + 'ring').style.opacity = (1 - done).toFixed(3);
  $(k + 'tick').style.opacity = (done * (1 - gone)).toFixed(3);
  $(k + 'stat').style.opacity = (P(T, T_S0 - .25, T_S0) * (1 - gone)).toFixed(3);
  // ---- 貼り付け ----
  const pp = E.out(P(T, T_PASTE, T_PASTE + .35)); $(k + 'pt').style.opacity = pp.toFixed(3); $(k + 'pt').style.transform = `translate3d(0,${(8 * (1 - pp)).toFixed(1)}px,0)`;
  $(k + 'caret').style.opacity = (T >= T_PCLICK && T < T_PASTE) ? ((Math.floor(T * 2.2) % 2 === 0) ? 1 : 0) : 0;
  // ---- カーソル ----
  const a = [L.x - 6, L.y + L.h / 2], b = [L.x + L.w, L.y + L.h / 2], pt = [PB.x + 4, PB.y + 18];
  const kf = [[0.4, 1420, 560], [0.9, a[0], a[1]], [T_SEL0, a[0], a[1]], [T_SEL1, b[0], b[1]], [3.0, b[0] + 70, b[1] + 80], [T_HOVER - .2, 1591, 436], [5.2, 1591, 436], [T_CLICK - .3, 1440, ROWY], [T_CLICK + .9, 1440, ROWY], [T_LEAVE + .9, pt[0] + 40, pt[1] + 26], [T_PCLICK, pt[0], pt[1]], [T_PASTE + 1.2, pt[0], pt[1]]];
  const p = path(kf, T), op = P(T, .4, .6) * (1 - P(T, 10.0, 10.4));
  const press = (T > T_SEL0 - .06 && T < T_SEL0 + .08) || (T > T_CLICK - .06 && T < T_CLICK + .08) || (T > T_PCLICK - .06 && T < T_PCLICK + .08) ? .86 : 1;
  const c = $(k + 'cur'); c.style.transform = `translate3d(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px,0) scale(${press})`; c.style.opacity = op.toFixed(3);
}
function render(T) {
  if (!M) measure();
  side(T, 'm', PM); side(T, 'w', PW);
  $('fade').style.opacity = Math.max(1 - P(T, 0, .35), P(T, DUR - .4, DUR)).toFixed(3);
}
window.renderAt = T => render(clamp(T, 0, DUR));
window.__ready = (async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; render(0); return true; })();
</script></body></html>
'''
open('clip_compare.html', 'w', encoding='utf8').write(PAGE.replace('__DUR__', str(DUR)))
print('clip_compare.html dur', DUR)
