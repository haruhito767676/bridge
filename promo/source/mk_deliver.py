#!/usr/bin/env python3
"""サイト用 (ライト): 「入れたら、もう、届いている。」 — Mac (送る側) と Windows (受け取る側) を左右に並べた 1 本の動画 (1920x1080)。
   画面の作りは clip_compare と同じ (右半分を角丸の「画面」として並べる)。パネルは実アプリの UI (ui/plates-deliver)。
   Windows 側はパネルを開いたままにして、Mac から送ったものが先頭に積もっていくのを見せる (カーソルは Mac だけ)。
     1 文字     … メモの文を選んでコピー → 同期の輪 → Windows のパネルに現れる
     2 画像     … 画像を選んでコピー → 現れる (サムネイル付き)
     3 ファイル … Finder から右端のつまみへドラッグ → 現れる
     4 フォルダ … 同上 (フォルダごと)
     5 大きなファイル … 同上。Windows の行はスピナーと進捗 (「42% · 176.4MB / 420.0MB · …」) になり、届くと本物のファイルに置き換わる
   キーボードのバッジは出さない。"""
DUR = 22.8

COLS = {'pptx': ('#ff8a2a', 'PPT'), 'mov': ('#5b5f6a', 'MOV')}


def fsvg(ext):
    c, t = COLS[ext]
    return (f'<svg viewBox="0 0 64 64">'
            f'<path d="M12 4h28l14 14v38a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#ffffff" stroke="#b4b8c4" stroke-width="1.6"/><path d="M40 4l14 14H44a4 4 0 0 1-4-4z" fill="#dfe2ea" stroke="#b4b8c4" stroke-width="1.6" stroke-linejoin="round"/>'
            f'<rect x="8" y="34" width="34" height="16" rx="3" fill="{c}"/><text x="25" y="46.2" font-family="-apple-system,Helvetica,sans-serif" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">{t}</text></svg>')


FOLDER = ('<svg viewBox="0 0 100 100"><path d="M8 26a7 7 0 0 1 7-7h20l9 9h41a7 7 0 0 1 7 7v45a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7z" fill="#7cc4ff"/>'
          '<path d="M8 38h84v40a7 7 0 0 1-7 7H15a7 7 0 0 1-7-7z" fill="#3f98f2"/></svg>')

PAGE = r'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Bridge clip: deliver</title>
<style>
:root{--display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Hiragino Sans","Noto Sans JP",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;--S:1.13778}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#eceef5;font-family:var(--display);-webkit-font-smoothing:antialiased;color:#1d1d1f}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden}
.half{position:absolute;top:28px;width:911px;height:1024px;overflow:hidden;border-radius:22px;box-shadow:0 0 0 1px rgba(20,30,60,.1),0 22px 54px -18px rgba(20,30,60,.3)}
#hm{left:33px}#hw{left:976px}
.cam{position:absolute;left:0;top:0;width:1600px;height:900px;transform-origin:0 0;transform:translate3d(-910.2px,0,0) scale(var(--S))}
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
.win{position:absolute;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.2),0 30px 80px rgba(20,30,60,.3);z-index:4;transform-origin:50% 50%}
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
/* 画像 */
.imgbox{position:relative;margin:22px auto 0;width:380px;height:249px;border-radius:6px}
.imgbox img{width:380px;height:249px;display:block;border-radius:6px;box-shadow:0 0 0 1px rgba(0,0,0,.1)}
.imgbox .selring{position:absolute;inset:-4px;border-radius:9px;box-shadow:0 0 0 3px #0a84ff;opacity:0}
/* Finder */
.fgrid{display:flex;gap:0;padding:26px 8px 0}
.fi{width:134px;text-align:center}
.fi .ic{position:relative;width:88px;height:88px;margin:0 auto;border-radius:14px;display:flex;align-items:center;justify-content:center}
.fi .ic svg{width:70px;height:70px}
.fi .nm{margin:8px 2px 0;padding:2px 5px;border-radius:6px;font:500 12px/1.35 var(--display);white-space:nowrap;display:inline-block}
.fi.sel .ic{background:rgba(0,0,0,.09)}
.fi.sel .nm{background:#0a84ff;color:#fff}
/* ドラッグ中のカード */
.gtile{position:absolute;left:0;top:0;width:64px;height:64px;border-radius:14px;background:rgba(255,255,255,.96);box-shadow:0 0 0 1px rgba(0,0,0,.12),0 14px 30px rgba(20,30,60,.3);display:flex;align-items:center;justify-content:center;z-index:48;opacity:0;transform-origin:0 0}
.gtile svg{width:46px;height:46px}
/* Bridge パネル */
.pslot{position:absolute;left:1280px;top:150px;width:320px;height:600px;z-index:10}
.panel{position:absolute;left:0;top:0;width:320px;height:600px;overflow:hidden}
.panel.glass{border-radius:14px 0 0 14px;background:rgba(250,250,251,.86);backdrop-filter:blur(30px) saturate(1.7);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.12),0 26px 64px -20px rgba(20,20,25,.34),0 0 0 1px rgba(0,0,0,.05)}
.panel.fluent{border-radius:8px 0 0 8px;background:#fbfbfc;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1),0 26px 64px -20px rgba(20,20,25,.34)}
.panel img,.pview img{position:absolute;left:0;width:320px;height:auto}
.panel .full{position:absolute;left:0;top:0;width:320px;height:600px}
.pview{position:absolute;left:0;overflow:hidden;width:320px}
.rw1{position:absolute;left:0;top:0;width:320px}
.sp{position:absolute;border-radius:50%;box-sizing:border-box}
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
    <div class="win" id="wMemo" style="left:830px;top:70px;width:420px;height:740px"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:12px">メモ</span></div>
      <div class="memo"><span class="sl" style="width:280px;margin-bottom:14px"></span><span class="sl" style="width:220px;margin-bottom:26px"></span><span class="ln" id="mln"><i class="selbar" id="msel"></i><span class="t">次回定例は10/15(木) 14:00</span></span><span class="sl" style="width:300px;margin-top:26px"></span><span class="sl" style="width:250px;margin-top:14px"></span>
        <span class="sl" style="width:320px;margin-top:34px"></span><span class="sl" style="width:270px;margin-top:14px"></span><span class="sl" style="width:200px;margin-top:14px"></span></div></div>
    <div class="win" id="wImg" style="left:830px;top:150px;width:420px;height:370px;opacity:0"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:12px">KPI ダッシュボード</span></div>
      <div class="imgbox" id="mimg"><img src="../../assets/demo/KPIダッシュボード.png"><i class="selring" id="mselring"></i></div></div>
    <div class="win" id="wFin" style="left:830px;top:150px;width:420px;height:300px;opacity:0"><div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:12px">書類</span></div>
      <div class="fgrid">
        <div class="fi" id="fi0"><div class="ic" id="fi0i">__PPTX__</div><div class="nm">提案資料…方針.pptx</div></div>
        <div class="fi" id="fi1"><div class="ic" id="fi1i">__FOLDER__</div><div class="nm">プロジェクト資料</div></div>
        <div class="fi" id="fi2"><div class="ic" id="fi2i">__MOV__</div><div class="nm">デモ撮影_素材.mov</div></div>
      </div></div>
    <div class="pill" id="mpill"></div>
    <div class="pslot" id="mslot"><div class="panel glass" id="mpanel"></div></div>
    <div class="gtile" id="g0">__PPTX__</div><div class="gtile" id="g1">__FOLDER__</div><div class="gtile" id="g2">__MOV__</div>
    <svg class="cursor" id="mcur" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
  </div></div></div>
  <div class="half" id="hw"><div class="cam"><div class="scr win">
    <div class="wn" style="left:830px;top:50px;width:420px;height:740px"><div class="cap">メモ帳<span class="cb"><i><svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg></i><i><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg></i><i><svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8"/></svg></i></span></div>
      <div class="memo" style="padding-top:38px"><span class="sl" style="width:300px;margin-bottom:14px"></span><span class="sl" style="width:240px;margin-bottom:14px"></span><span class="sl" style="width:280px;margin-bottom:14px"></span><span class="sl" style="width:200px;margin-bottom:14px"></span></div></div>
    <div class="pslot" id="wslot" style="transform:none"><div class="panel fluent" id="wpanel"></div></div>
    <div class="taskbar"><div class="tray"><svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4.2 4.2 0 0 1 5 0"/></svg>
      <span class="stat" id="wstat" style="width:22px;height:22px"><svg viewBox="0 0 20 20" style="width:22px;height:22px"><circle cx="10" cy="10" r="7" stroke="rgba(0,0,0,.18)" stroke-width="2.4"/><circle id="wring" cx="10" cy="10" r="7" stroke="#0a84ff" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="44" stroke-dashoffset="44" transform="rotate(-90 10 10)"/><path id="wtick" d="M6.5 10.3l2.4 2.4 4.6-5" stroke="#1f9d4a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0"/></svg></span>
      <div><div class="clk">13:26</div><div>2026/09/30</div></div></div></div>
  </div></div></div>
  <div id="fade"></div>
</div>
<script src="ui/plates-deliver/manifest.js"></script>
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
const E = { out: bez(.16, 1, .3, 1), inOut: bez(.65, 0, .35, 1), cur: bez(.4, 0, .25, 1) };
const W0 = 2 * Math.PI / 0.32, crit = dt => dt <= 0 ? 0 : 1 - (1 + W0 * dt) * Math.exp(-W0 * dt);   // 実アプリと同じ臨界減衰 (応答 0.32 秒・行き過ぎない)
const mk = (src, par, cls) => { const i = new Image(); i.src = src; i.decoding = 'sync'; if (cls) i.className = cls; par.appendChild(i); return i; };

// ---------------------------------------------------------------- 時間割
const DROP = [9.5, 12.5, 15.5], OPEN = DROP.map(t => t - .85), CLOSE = DROP.map(t => t + .55);   // Mac パネル: つまみに近づくと開き、ドロップして離れると閉じる
const PRESS = [8.0, 11.0, 14.0], DRAG = PRESS.map(t => t + .25);
const ARR = { 5: 2.6, 4: 5.8, 3: 10.05, 2: 13.05, 1: 15.9 };   // 受信側の行 (manifest の行番号) が現れる時刻 (1 = 大きなファイル)
const T_PROG0 = 16.2, T_DONE = 19.95;                           // 大きなファイル: 進捗の開始 / 届いて本物のファイルに置き換わる
const RINGS = [[2.0, 2.55], [5.2, 5.75], [9.55, 10.0], [12.55, 13.0], [15.55, 19.9]];   // 同期の輪 (Mac) [始まり, 終わり]。Windows は少し遅れる

// ---------------------------------------------------------------- Windows パネル (受信側)
const MW = MANIFEST.win, wbase = 'ui/plates-deliver/win/';
const wslot = $('wpanel');
mk(wbase + 'chrome.png', wslot).style.top = '0';
const wv = document.createElement('div'); wv.className = 'pview'; wv.style.top = MW.dz.top + 'px'; wv.style.height = (MW.dz.bottom - MW.dz.top) + 'px'; wslot.appendChild(wv);
const WR = MW.rows.map((r, i) => {
  if (r.skipped) return null;
  if (i === 1) {
    const box = document.createElement('div'); box.className = 'rw1'; wv.appendChild(box);
    const done = mk(wbase + 'row1.png', box); done.style.top = '0';
    const sync = [...Array(11)].map((_, k) => { const im = mk(wbase + `sync${k}.png`, box); im.style.top = '0'; return im; });
    const sp = MW.sync.spinner, el = document.createElement('div'); el.className = 'sp';
    el.style.cssText = `left:${sp.x}px;top:${sp.y}px;width:${sp.w}px;height:${sp.h}px;border:${sp.border} solid ${sp.track};border-top-color:${sp.head}`; box.appendChild(el);
    return { i, top: r.top, el: box, done, sync, sp: el };
  }
  const im = mk(wbase + `row${i}.png`, wv); return { i, top: r.top, el: im };
});
const HEIGHT = i => MW.rows[i + 1].top - MW.rows[i].top;   // 行 i が増えたときに下の行を押し下げる量
function updateWin(T) {
  const ins = {}; for (const r of Object.keys(ARR)) ins[r] = crit(T - ARR[r]);
  WR.forEach(r => {
    if (!r) return;
    let y = r.top - 2 - MW.dz.top, o = 1, sc = 1, bl = 0;
    for (const a of Object.keys(ARR)) if (+a < r.i) y -= HEIGHT(+a) * (1 - ins[a]);
    if (ARR[r.i] !== undefined) { const p = ins[r.i]; o = clamp(p * 1.5); y -= 18 * (1 - p); sc = .96 + .04 * clamp(p); bl = 6 * (1 - clamp(p)); }
    r.el.style.opacity = o.toFixed(3); r.el.style.transform = `translate3d(0,${y.toFixed(2)}px,0) scale(${sc.toFixed(4)})`; r.el.style.filter = bl > .2 ? `blur(${bl.toFixed(1)}px)` : '';
  });
  // 大きなファイル: 受信中 (スピナー + 進捗) → 届いて本物のファイルに置き換わる
  const r1 = WR[1], prog = P(T, T_PROG0, T_DONE - .1), idx = Math.min(10, Math.floor(prog * 10.999));
  const doneP = P(T, T_DONE, T_DONE + .15);
  r1.sync.forEach((im, k) => im.style.opacity = (k === idx ? 1 - doneP : 0).toFixed(3));
  r1.done.style.opacity = doneP.toFixed(3);
  r1.sp.style.opacity = (1 - doneP).toFixed(3); r1.sp.style.transform = `rotate(${((T * 450) % 360).toFixed(1)}deg)`;
}

// ---------------------------------------------------------------- Mac パネル (送信側): ドロップ前 (over) / 後 (after)
const mbase = 'ui/plates-deliver/mac/', MO = [], MA = [];
[3, 4, 5].forEach((k, j) => { const a = mk(mbase + `over${k}.png`, $('mpanel'), 'full'), b = mk(mbase + `after${k}.png`, $('mpanel'), 'full'); a.style.opacity = b.style.opacity = 0; MO.push(a); MA.push(b); });

// ---------------------------------------------------------------- カーソル
function path(kf, u) {
  if (u <= kf[0][0]) return [kf[0][1], kf[0][2]];
  for (let i = 1; i < kf.length; i++) if (u <= kf[i][0]) { const a = kf[i - 1], b = kf[i], p = E.cur(P(u, a[0], b[0])); return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)]; }
  const l = kf[kf.length - 1]; return [l[1], l[2]];
}
let M = null;   // 画面座標 (x 800〜1600 が映る) で測った、文・画像・Finder のアイコンの位置
const measure = () => {
  const box = id => { const r = $(id).getBoundingClientRect(), f = $(id).closest('.half').getBoundingClientRect(); return { x: (r.left - f.left) / S + 800, y: (r.top - f.top) / S, w: r.width / S, h: r.height / S }; };
  M = { ln: box('mln'), img: box('mimg'), f: [box('fi0i'), box('fi1i'), box('fi2i')] };
};
const DROPXY = [1440, 300], NEAR = [1520, 380];
// 同期の輪 (終わると ✓ → 消える)。events の遅れ (lag) は Windows 側
function ring(T, pre, lag) {
  let vis = 0, pr = 0, done = 0, gone = 0;
  for (const [s0, e0] of RINGS) {
    const s = s0 + lag, e = e0 + lag * .5;
    if (T >= s - .25 && T < e + .9) { vis = P(T, s - .25, s); pr = E.inOut(P(T, s, e)); done = P(T, e, e + .15); gone = P(T, e + .6, e + .9); }
  }
  $(pre + 'ring').setAttribute('stroke-dashoffset', (44 * (1 - pr)).toFixed(2)); $(pre + 'ring').style.opacity = (1 - done).toFixed(3);
  $(pre + 'tick').style.opacity = (done * (1 - gone)).toFixed(3);
  $(pre + 'stat').style.opacity = (vis * (1 - gone)).toFixed(3);
}

function render(T) {
  if (!M) measure();
  updateWin(T);
  // ---- Mac の窓 (メモ → 画像 → Finder) ----
  const memoOut = P(T, 3.85, 4.02), imgIn = P(T, 4.05, 4.35), imgOut = P(T, 6.65, 6.82), finIn = P(T, 6.85, 7.15);
  $('wMemo').style.opacity = (1 - memoOut).toFixed(3); $('wMemo').style.transform = `scale(${(1 - .03 * memoOut).toFixed(4)})`;
  $('wImg').style.opacity = (imgIn * (1 - imgOut)).toFixed(3); $('wImg').style.transform = `scale(${(.96 + .04 * E.out(imgIn) - .03 * imgOut).toFixed(4)})`;
  $('wFin').style.opacity = finIn.toFixed(3); $('wFin').style.transform = `scale(${(.96 + .04 * E.out(finIn)).toFixed(4)})`;
  // ---- 1 文字: 選択 (ドラッグ) ----
  const L = M.ln;
  $('msel').style.width = (L.w + 6) * E.inOut(P(T, 1.0, 1.75)) * (T < 3.4 ? 1 : 1 - P(T, 3.4, 3.55)) + 'px';
  // ---- 2 画像: 選択の枠 ----
  $('mselring').style.opacity = (E.out(P(T, 4.95, 5.05)) * (1 - P(T, 6.0, 6.15))).toFixed(3);
  // ---- 3〜5: Finder の選択 ----
  [0, 1, 2].forEach(k => $('fi' + k).classList.toggle('sel', T >= PRESS[k] && T < DROP[k] + .2));
  // ---- Mac のパネル: つまみに近づくと開き、ドロップして離れると閉じる ----
  let openP = 0;
  DROP.forEach((d, k) => { if (T >= OPEN[k]) { const p = T < CLOSE[k] ? crit(T - OPEN[k]) : 1 - crit(T - CLOSE[k]); openP = Math.max(openP, p); } });
  $('mslot').style.transform = `translate3d(${(340 * (1 - clamp(openP))).toFixed(1)}px,0,0)`; $('mslot').style.opacity = openP > .002 ? 1 : 0;
  $('mpill').style.opacity = (1 - clamp(openP * 3)).toFixed(3);
  DROP.forEach((d, k) => {
    MO[k].style.opacity = (T >= OPEN[k] && T < d ? 1 : 0);
    const nxt = k < 2 ? OPEN[k + 1] : 1e9;
    MA[k].style.opacity = (T >= d && T < nxt ? P(T, d, d + .12) : 0).toFixed(3);
    if (T >= d && T < d + .12) MO[k].style.opacity = (1 - P(T, d, d + .12)).toFixed(3);
  });
  // ---- 同期の輪 ----
  ring(T, 'm', 0); ring(T, 'w', .1);
  // ---- ドラッグ中のカード ----
  const kfs = [[0.4, 1420, 560], [0.9, L.x - 6, L.y + L.h / 2], [1.0, L.x - 6, L.y + L.h / 2], [1.75, L.x + L.w, L.y + L.h / 2], [2.4, L.x + L.w + 60, L.y + L.h / 2 + 70],
    [4.75, M.img.x + M.img.w * .55, M.img.y + M.img.h * .5], [5.9, M.img.x + M.img.w * .55, M.img.y + M.img.h * .5]];
  const F = M.f.map(f => [f.x + f.w / 2 + 6, f.y + f.h / 2 + 6]);
  DROP.forEach((d, k) => {
    const nx = k < 2 ? F[k + 1] : [1300, 560], tArr = k < 2 ? PRESS[k + 1] - .15 : d + 1.3;
    if (k === 0) kfs.push([PRESS[0] - .15, F[0][0], F[0][1]]);
    kfs.push([PRESS[k], F[k][0], F[k][1]], [DRAG[k], F[k][0], F[k][1]], [OPEN[k] + .3, NEAR[0], NEAR[1]], [d - .05, DROPXY[0], DROPXY[1]], [d + .15, DROPXY[0], DROPXY[1]], [tArr, nx[0], nx[1]]);
  });
  const p = path(kfs, T);
  const pressed = [[1.0, 1.75], [4.95, 5.05], [8.0, 9.5], [11.0, 12.5], [14.0, 15.5]].some(([a, b]) => T > a - .02 && T < b) ? .86 : 1;
  const c = $('mcur'); c.style.transform = `translate3d(${p[0].toFixed(1)}px,${p[1].toFixed(1)}px,0) scale(${pressed})`; c.style.opacity = (P(T, .4, .6) * (1 - P(T, 17.0, 17.5))).toFixed(3);
  // ドラッグ中のカード: つかんだ位置からカーソルについてくる。ドロップで縮んでパネルに吸い込まれる
  [0, 1, 2].forEach(k => {
    const g = $('g' + k), on = T >= DRAG[k] && T < DROP[k] + .22, sh = P(T, DROP[k], DROP[k] + .2);
    g.style.opacity = on ? (E.out(P(T, DRAG[k], DRAG[k] + .12)) * (1 - sh)).toFixed(3) : 0;
    g.style.transform = `translate3d(${(p[0] + 8).toFixed(1)}px,${(p[1] + 10).toFixed(1)}px,0) scale(${(1 - .45 * sh).toFixed(3)}) rotate(${(-4 * (1 - sh)).toFixed(1)}deg)`;
  });
  $('fade').style.opacity = Math.max(1 - P(T, 0, .35), P(T, DUR - .4, DUR)).toFixed(3);
}
window.renderAt = T => render(clamp(T, 0, DUR));
window.__ready = (async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; measure(); render(0); return true; })();
</script></body></html>
'''
page = (PAGE.replace('__DUR__', str(DUR)).replace('__PPTX__', fsvg('pptx')).replace('__MOV__', fsvg('mov')).replace('__FOLDER__', FOLDER))
open('clip_deliver.html', 'w', encoding='utf8').write(page)
print('clip_deliver.html dur', DUR)
