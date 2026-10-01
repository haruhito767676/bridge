#!/usr/bin/env python3
"""サイト用 (ライト): 「こんなこと、していませんか？」の動画 4 本。Bridge は出ない。困っている様子 (遠回り・待ち) だけを見せる。
   ch1 資料を、自分宛てにメールで送る     … Mac でメールを作って添付・送信 → Windows でメールを更新して待ち、添付を保存
   ch2 Slack の「自分だけ」に URL を貼る  … Mac で URL をコピーして Slack へ貼る → Windows で Slack を開いて探し、コピーしてブラウザへ
   ch3 クラウドに上げて、落とし直す       … Mac でアップロードを待つ → Windows でクラウドを開き、探して、ダウンロードを待つ
   ch4 ブラウザとドキュメントの往復       … 1 台の画面で、コピーして貼る、を何度も行き来する
   メニューバー / タスクバーの時計を進めて「時間がかかった」ことを、文字なしで見せる。
   4 章を 1 本の HTML にして書き出し、章ごとに mp4 へ切り出す (render-pain.sh)。"""
CHS = [12.5, 16.2, 12.5, 9.4]   # どの章も、最後の動きのあと 1.5 秒は止まった絵を見せてから暗転する
STARTS = [round(sum(CHS[:i]), 3) for i in range(4)]
DUR = round(sum(CHS), 3)

PAGE = r'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Bridge clip: pain</title>
<style>
:root{--display:-apple-system,BlinkMacSystemFont,"SF Pro Display","Hiragino Sans","Noto Sans JP",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:#eceef5;font-family:var(--display);-webkit-font-smoothing:antialiased;color:#1d1d1f}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden}
#cam{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}
.chap{position:absolute;left:0;top:0;width:0;height:0}
.scr{position:absolute;top:0;width:1200px;height:675px;overflow:hidden}   /* 画面は 1200x675 (16:9)。1.6 倍でちょうど 1920x1080 に収まる */
.scr.mac{background:radial-gradient(70% 60% at 92% 96%,#ffd9a0 0%,rgba(255,217,160,0) 62%),radial-gradient(70% 60% at 6% 8%,#9fe8d3 0%,rgba(159,232,211,0) 62%),radial-gradient(60% 50% at 50% 50%,#b9d3ff 0%,rgba(185,211,255,0) 64%),linear-gradient(160deg,#e3f4ff,#e8e4ff)}
.scr.win{background:radial-gradient(60% 70% at 18% 12%,#9fc4ff 0%,rgba(159,196,255,0) 62%),radial-gradient(70% 70% at 88% 88%,#e2b6ff 0%,rgba(226,182,255,0) 62%),radial-gradient(50% 50% at 55% 45%,#c9e6ff 0%,rgba(201,230,255,0) 64%),linear-gradient(135deg,#dbe8ff,#f4ecff)}
.menubar{position:absolute;left:0;right:0;top:0;height:28px;z-index:30;background:rgba(255,255,255,.52);backdrop-filter:blur(20px) saturate(1.6);display:flex;align-items:center;justify-content:space-between;padding:0 14px;font:500 13.5px var(--display);color:#1d1d1f}
.menubar>div{display:flex;align-items:center}
.menubar b{font-weight:700;margin-right:20px}
.menubar span{margin-right:20px;opacity:.86}
.menubar svg{width:14px;height:14px;margin-right:20px;fill:#1d1d1f}
.menubar .st{display:flex;align-items:center;gap:14px}
.menubar .st svg{width:16px;height:16px;margin:0;fill:none;stroke:#1d1d1f;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.menubar .st span{margin:0}
.menubar .st span:last-child{font-weight:600;font-size:17px;letter-spacing:.01em}
.taskbar .tray>div>div:first-child{font-weight:600;font-size:16px}
.dock{position:absolute;left:50%;bottom:10px;height:70px;padding:0 12px;border-radius:22px;z-index:30;background:rgba(255,255,255,.4);box-shadow:inset 0 0 0 1px rgba(255,255,255,.6),0 12px 34px rgba(30,40,80,.18);backdrop-filter:blur(24px) saturate(1.5);display:flex;align-items:center;gap:10px;transform:translateX(-50%)}
.dock .di{position:relative;width:52px;height:52px;flex:none}
.dock .di img{width:52px;height:52px;display:block}
.dock .di.run::after{content:"";position:absolute;left:50%;bottom:-8px;width:4.5px;height:4.5px;margin-left:-2.2px;border-radius:3px;background:rgba(0,0,0,.55)}
.dock .sep{width:1.5px;height:46px;border-radius:1px;background:rgba(0,0,0,.16);flex:none;margin:0 2px}
.taskbar{position:absolute;left:0;right:0;bottom:0;height:52px;z-index:30;background:rgba(244,246,252,.8);backdrop-filter:blur(30px) saturate(1.5);box-shadow:inset 0 .5px 0 rgba(0,0,0,.1)}
.taskbar .mid{position:absolute;left:50%;top:0;height:52px;transform:translateX(-50%);display:flex;align-items:center;gap:8px}
.taskbar .ti{position:relative;width:34px;height:34px;flex:none}
.taskbar .ti img,.taskbar .ti svg{width:34px;height:34px;display:block}
.taskbar .ti.run::after{content:"";position:absolute;left:50%;bottom:-8px;width:8px;height:3px;margin-left:-4px;border-radius:2px;background:rgba(0,0,0,.35)}
.taskbar .ti.act::after{content:"";position:absolute;left:50%;bottom:-8px;width:16px;height:3px;margin-left:-8px;border-radius:2px;background:#0067c0}
.taskbar .tray{position:absolute;right:18px;top:0;height:52px;display:flex;align-items:center;gap:14px;font:12px/1.25 var(--display);color:#222;text-align:right}
.taskbar .tray svg{width:15px;height:15px;stroke:#222;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.win{position:absolute;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 0 0 .5px rgba(0,0,0,.2),0 30px 80px rgba(20,30,60,.3);z-index:4}
.win .bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;font:600 13px var(--display);color:rgba(0,0,0,.6);background:#f3f3f5;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08)}
.win.inact .bar{color:rgba(0,0,0,.35)}
.win.inact .tl,.win.inact .tl.y,.win.inact .tl.g{background:rgba(0,0,0,.14)}
.tl{width:12px;height:12px;border-radius:6px;background:#ff5f57;flex:none}.tl.y{background:#febc2e}.tl.g{background:#28c840}
.wn{position:absolute;border-radius:8px;overflow:hidden;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.16),0 24px 60px rgba(20,30,60,.3);z-index:4}
.wn .cap{height:36px;display:flex;align-items:center;padding:0 0 0 14px;font:12px var(--display);color:#333;background:#eef0f6;position:relative}
.wn .cap .cb{position:absolute;right:0;top:0;display:flex;height:36px}
.wn .cap .cb i{width:46px;display:flex;align-items:center;justify-content:center}
.wn .cap .cb svg{width:11px;height:11px;stroke:#333;fill:none;stroke-width:1.1}
.wn .cap.dark .cb svg{stroke:#fff}
.lk{position:relative;display:inline-block;white-space:nowrap}
.lk .t{position:relative;z-index:1}
.selbar{position:absolute;left:-3px;top:-3px;bottom:-3px;width:0;background:rgba(10,132,255,.3);border-radius:3px}
.sl{height:9px;border-radius:5px;background:rgba(0,0,0,.1)}
.sl.d{background:rgba(0,0,0,.18)}
.dicon{position:absolute;width:88px;z-index:1;text-align:center;font:500 11.5px/1.3 var(--display);color:#23262e;text-shadow:0 0 5px rgba(255,255,255,.85)}
.dicon svg{display:block;width:56px;height:56px;margin:0 auto 4px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.22))}
.dicon span{display:inline-block;max-width:84px;padding:1px 4px;border-radius:4px;word-break:break-all}
.chip{display:inline-flex;align-items:center;gap:8px;height:52px;padding:0 20px 0 10px;border-radius:12px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.06);font:600 14px var(--display);color:#222;white-space:nowrap}
.chip svg{width:34px;height:34px;flex:none}
.chip small{display:block;font:500 11.5px var(--display);color:#8a8a90}
.pbar{height:6px;border-radius:3px;background:rgba(0,0,0,.1);overflow:hidden}
.pbar i{display:block;height:100%;width:0;background:#0a84ff;border-radius:3px}
.spin{width:18px;height:18px;border-radius:50%;border:2.4px solid rgba(10,132,255,.25);border-top-color:#0a84ff}
#ghost{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:40}
#curs{position:absolute;left:0;top:0;width:28px;height:36px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.35));z-index:50}
#fade{position:absolute;left:0;top:0;width:1920px;height:1080px;background:#eceef5;opacity:1;pointer-events:none;z-index:99}
.btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 24px;border-radius:20px;background:#0a84ff;color:#fff;font:700 15px var(--display);box-shadow:0 4px 12px rgba(10,132,255,.35)}
mark.sel{background:rgba(10,132,255,.28);color:inherit;border-radius:3px}
</style></head>
<body>
<div id="stage"><div id="cam">
__CHAPS__
<div id="ghost"><div id="gz" style="position:absolute;left:0;top:0;width:52px;height:52px">__ZIP__</div></div>
<svg id="curs" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
</div><div id="fade"></div></div>
<script>
'use strict';
const CHS = __CHS__, STARTS = __STARTS__, DUR = __DUR__;
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
function path(kf, u) {
  if (u <= kf[0][0]) return [kf[0][1], kf[0][2]];
  for (let i = 1; i < kf.length; i++) if (u <= kf[i][0]) {
    const a = kf[i - 1], b = kf[i], p = E.inOut(P(u, a[0], b[0]));
    if (b.length > 3) { const q = 1 - p; return [q * q * q * a[1] + 3 * q * q * p * b[3] + 3 * q * p * p * b[5] + p * p * p * b[1], q * q * q * a[2] + 3 * q * q * p * b[4] + 3 * q * p * p * b[6] + p * p * p * b[2]]; }
    return [lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
  }
  const l = kf[kf.length - 1]; return [l[1], l[2]];
}
const cur = $('curs'), ghost = $('ghost');
const setCur = (pos, op, press) => { cur.style.transform = `translate3d(${pos[0].toFixed(1)}px,${pos[1].toFixed(1)}px,0) scale(${press ? .86 : 1})`; cur.style.opacity = op.toFixed(3); };
const B = 1760;   // 座標を書くときの 2 台目の基準 (旧: 1600x900 の座標系)
const SB = 1400;  // 2 台目の画面の実際の x (1 台目は 0、画面は 1200 幅)
// 書いた座標 → 実際の座標: 1 台目 (Mac) は x-400、2 台目 (Windows) は x-B+SB-400 と y-226
const conv = p => p[0] >= B - 200 ? [p[0] - B + SB - 400, p[1] - 226] : [p[0] - 400, p[1]];
const clk = (id, m) => { const e = $(id); if (e) e.textContent = '13:' + String(m).padStart(2, '0'); };
const wait = (u, a, b) => Math.min(1, Math.max(0, (u - a) / (b - a)));

// ---------- 章 1: メールを自分宛てに送る ----------
const M1 = { attach: [1340, 92], send: [1304, 550], refresh: [B + 903, 308], row: [B + 780, 362], chipB: [B + 1069, 478] };
const KF1 = [[0.4, 1450, 650], [1.3, M1.attach[0], M1.attach[1], 1500, 500, 1400, 300], [1.9, M1.attach[0], M1.attach[1]], [2.9, M1.send[0], M1.send[1], 1500, 300, 1400, 600], [3.2, M1.send[0], M1.send[1]],
  [5.4, B + 1300, 520], [6.0, M1.refresh[0], M1.refresh[1], B + 1100, 400, B + 1000, 330], [6.35, M1.refresh[0], M1.refresh[1]],
  [8.1, M1.row[0], M1.row[1], B + 900, 420, B + 800, 380], [8.5, M1.row[0], M1.row[1]], [9.3, M1.chipB[0], M1.chipB[1]], [9.7, M1.chipB[0], M1.chipB[1]], [10.3, B + 1300, 640]];
function ch1(u) {
  const pan = E.soft(P(u, 4.1, 5.1));
  // A: 添付 → 送信 → 送信中 → 閉じる
  $('c1_chip').style.opacity = wait(u, 1.9, 2.05).toFixed(3);
  const sp = P(u, 3.3, 4.0); $('c1_prog').firstElementChild.style.width = (sp * 100).toFixed(1) + '%'; $('c1_prog').style.opacity = (u >= 3.3 && u < 4.1) ? 1 : 0;
  const closeP = E.in(P(u, 3.95, 4.2)); $('c1_win').style.opacity = (1 - closeP).toFixed(3); $('c1_win').style.transform = `scale(${(1 - .06 * closeP).toFixed(4)})`;
  clk('c1_clkA', u >= 4.0 ? 27 : 26);
  // B: 更新 → くるくる → 届く → 開く → 添付を保存
  const spin = u >= 6.35 && u < 8.0; $('c1_spin').style.opacity = spin ? 1 : 0; $('c1_spin').style.transform = `rotate(${(u * 360).toFixed(0)}deg)`;
  const nr = spring(u - 8.0, 130, 16); $('c1_new').style.opacity = clamp(P(u, 8.0, 8.15)).toFixed(3);
  $('c1_rows').style.transform = `translate3d(0,${(64 * clamp(nr, 0, 1.03)).toFixed(1)}px,0)`;
  $('c1_new').style.transform = `translate3d(0,${(-64 * (1 - nr)).toFixed(1)}px,0)`;
  $('c1_read').style.opacity = clamp(P(u, 8.55, 8.75)).toFixed(3); $('c1_empty').style.opacity = 1 - clamp(P(u, 8.5, 8.6));
  const dp = P(u, 9.7, 10.35); $('c1_dl').firstElementChild.style.width = (dp * 100).toFixed(1) + '%'; $('c1_dl').style.opacity = u >= 9.7 ? 1 : 0;
  $('c1_saved').style.opacity = wait(u, 10.4, 10.55).toFixed(3);
  clk('c1_clkB', u >= 8.0 ? 31 : 27);
  return { cam: pan, pos: path(KF1, u), op: wait(u, 0.4, 0.6) * (1 - wait(u, 3.95, 4.2)) + wait(u, 5.2, 5.4), press: (u > 1.28 && u < 1.42) || (u > 2.88 && u < 3.02) || (u > 6.0 && u < 6.14) || (u > 8.1 && u < 8.24) || (u > 9.28 && u < 9.42) };
}

// ---------- 章 2: Slack の「自分だけ」へ URL を貼る ----------
// 位置は、画面に置いた部品を DOM から測る (カメラの拡大・移動に左右されないよう、変形を外して測る)
const camRect = id => { const cam = $('cam'), prev = cam.style.transform; cam.style.transform = 'none'; const r = $(id).getBoundingClientRect(); cam.style.transform = prev; return { x: r.left, y: r.top, w: r.width, h: r.height }; };
let M2 = null;
function measure2() {
  const bm = $('c2_bmsgs'), prev = bm.style.transform; bm.style.transform = 'translate3d(0,-' + SC2 + 'px,0)';   // スクロールし終わった位置で測る
  const R = id => camRect(id), C = r => [r.x + r.w / 2, r.y + r.h / 2];
  M2 = { addr: R('c2_addrtxt'), dkSlack: R('c2_dkSlack'), input: R('c2_input'), tbSlack: R('c2_tbSlack'), bch: R('c2_bch'), blist: R('c2_bview'), blink: R('c2_blink'), tbChrome: R('c2_tbChrome'), baddr: R('c2_baddr') };
  bm.style.transform = prev; M2.C = C;
}
const SC2 = 306;   // 向こうの Slack の履歴をスクロールする量
const TM = { sel0: 1.5, sel1: 2.1, dock: 3.55, inp: 4.75, paste: 5.15, enter: 5.85 };
const TW = { tb: 7.85, ch: 8.85, scr0: 9.2, scr1: 10.1, sel0: 10.45, sel1: 11.05, tbc: 12.05, ad: 13.05, paste: 13.4, enter: 13.9 };
function ch2(u) {
  if (!M2) measure2();
  const C = M2.C, pan = E.soft(P(u, 6.3, 7.3));
  // ---- A: Chrome の URL を選んでコピー → Dock の Slack → 入力欄に貼る → 送信 ----
  $('c2_asel').style.width = ((M2.addr.w + 6) * E.inOut(P(u, TM.sel0, TM.sel1))) + 'px';
  const front = u >= TM.dock;   // Slack を前面へ (Chrome は背面に残る)
  $('c2_chrome').classList.toggle('inact', front); $('c2_slack').style.zIndex = front ? 5 : 2;
  $('c2_mbname').textContent = front ? 'Slack' : 'Chrome';
  const pasted = u >= TM.paste && u < TM.enter; $('c2_ph').style.opacity = pasted ? 0 : 1; $('c2_ptxt').style.opacity = pasted ? 1 : 0;
  const sent = E.out(P(u, TM.enter, TM.enter + .4)); $('c2_sent').style.height = (62 * sent).toFixed(1) + 'px'; $('c2_sent').style.opacity = clamp(sent * 1.4).toFixed(3);
  clk('c2_clkA', u >= TM.enter ? 27 : 26);
  // ---- B: タスクバーの Slack → チャンネル → スクロール → リンクを選ぶ → Chrome → アドレス欄に貼る → 開く ----
  const so = E.out(P(u, TW.tb + .1, TW.tb + .45)); $('c2_bslack').style.opacity = so.toFixed(3); $('c2_bslack').style.transform = `scale(${(.97 + .03 * so).toFixed(4)})`;
  const chsel = u >= TW.ch; $('c2_bch').style.background = chsel ? 'rgba(255,255,255,.18)' : 'transparent';
  $('c2_bview').style.opacity = chsel ? 1 : 0;
  const sc = E.inOut(P(u, TW.scr0, TW.scr1)); $('c2_bmsgs').style.transform = `translate3d(0,${(-SC2 * sc).toFixed(1)}px,0)`;
  $('c2_lsel').style.width = ((M2.blink.w + 6) * E.inOut(P(u, TW.sel0, TW.sel1))) + 'px';
  const co = E.out(P(u, TW.tbc + .1, TW.tbc + .45)); $('c2_bchrome').style.opacity = co.toFixed(3); $('c2_bchrome').style.transform = `scale(${(.97 + .03 * co).toFixed(4)})`;
  $('c2_bslack').style.zIndex = 4; $('c2_bchrome').style.zIndex = 5;
  $('c2_tbSlack').classList.toggle('act', u >= TW.tb && u < TW.tbc); $('c2_tbChrome').classList.toggle('act', u >= TW.tbc);
  $('c2_baddrtxt').style.opacity = u >= TW.paste ? 1 : 0; $('c2_bph').style.opacity = u >= TW.paste ? 0 : 1;
  $('c2_bpage').style.opacity = wait(u, TW.enter, TW.enter + .25).toFixed(3);
  clk('c2_clkB', u >= TW.tbc ? 30 : u >= TW.tb ? 29 : 28);
  // ---- カーソル (どれも、測った位置へ) ----
  const aS = [M2.addr.x - 4, M2.addr.y + M2.addr.h / 2], aE = [M2.addr.x + M2.addr.w, aS[1]], dk = C(M2.dkSlack), inp = [M2.input.x + 70, M2.input.y + M2.input.h / 2];
  const kfA = [[0.4, aS[0] + 300, aS[1] + 260], [1.35, aS[0], aS[1]], [TM.sel0, aS[0], aS[1]], [TM.sel1, aE[0], aE[1]], [2.7, aE[0] + 20, aE[1] + 8], [TM.dock - .15, dk[0], dk[1]], [TM.dock + .1, dk[0], dk[1]], [TM.inp - .1, inp[0], inp[1]], [6.0, inp[0], inp[1]]];
  const tbS = C(M2.tbSlack), ch = C(M2.bch), lk = [M2.blink.x - 4, M2.blink.y + M2.blink.h / 2], le = [M2.blink.x + M2.blink.w, lk[1]], tbC = C(M2.tbChrome), ad = [M2.baddr.x + 70, M2.baddr.y + M2.baddr.h / 2], lc = C(M2.blist);
  const kfB = [[6.9, tbS[0] + 300, tbS[1] - 280], [TW.tb - .15, tbS[0], tbS[1]], [TW.tb + .1, tbS[0], tbS[1]], [TW.ch - .1, ch[0], ch[1]], [TW.ch + .2, ch[0], ch[1]], [TW.scr0 + .3, lc[0], lc[1]], [TW.scr1, lc[0], lc[1] + 30], [TW.sel0 - .1, lk[0], lk[1]], [TW.sel0, lk[0], lk[1]], [TW.sel1, le[0], le[1]], [11.4, le[0] + 20, le[1] + 14],
    [TW.tbc - .15, tbC[0], tbC[1]], [TW.tbc + .1, tbC[0], tbC[1]], [TW.ad - .1, ad[0], ad[1]], [TW.ad + .2, ad[0], ad[1]], [14.6, ad[0] + 4, ad[1]]];
  const onA = u < 6.4, pos = onA ? path(kfA, u) : path(kfB, u);
  const press = [1.4, TM.dock, TM.inp, TW.tb, TW.ch, TW.sel0 - .05, TW.tbc, TW.ad].some(c => u > c - .02 && u < c + .12);
  return { raw: true, cam: pan, pos, op: onA ? wait(u, 0.4, 0.6) * (1 - wait(u, 6.0, 6.35)) : wait(u, 7.0, 7.2), press };
}

// ---------- 章 3: クラウドに上げて、落とし直す ----------
const DI3 = [474, 160];
const KF3 = [[0.5, 1300, 600], [1.2, DI3[0], DI3[1], 1000, 600, 700, 300], [1.4, DI3[0], DI3[1]], [2.6, 1070, 310, 600, 160, 900, 200], [3.0, 1070, 310], [4.4, 1400, 560],
  [6.8, B + 1200, 500, B + 1300, 600, B + 1100, 350], [7.6, B + 780, 372, B + 1000, 400, B + 900, 380], [8.0, B + 780, 372], [9.2, B + 780, 678, B + 900, 500, B + 800, 600], [9.6, B + 780, 678], [10.6, B + 1300, 700]];
function ch3(u) {
  const pan = E.soft(P(u, 5.4, 6.4));
  const drag = u >= 1.4 && u < 2.9;
  $('c3_dic').style.opacity = 1;
  const pos = path(KF3, u);
  ghost.style.opacity = (drag ? 1 - E.in(P(u, 2.85, 3.0)) : 0).toFixed(3);
  const gp = conv(pos); ghost.style.transform = `translate3d(${(gp[0] + 6).toFixed(1)}px,${(gp[1] + 8).toFixed(1)}px,0)`;
  const up = P(u, 3.05, 5.3); $('c3_up').style.opacity = u >= 3.05 ? 1 : 0; $('c3_upbar').firstElementChild.style.width = (up * 100).toFixed(1) + '%'; $('c3_uppct').textContent = Math.round(up * 100) + '%';
  $('c3_upok').style.opacity = wait(u, 5.3, 5.4);
  clk('c3_clkA', u >= 5.3 ? 28 : 27);
  // B: 資料フォルダ → 探す → ダウンロード
  const dirsel = u >= 8.0; $('c3_bfolders').style.opacity = dirsel ? 0 : 1; $('c3_bfiles').style.opacity = dirsel ? 1 : 0;
  const sc = E.inOut(P(u, 8.1, 8.9)); $('c3_bfiles').firstElementChild.style.transform = `translate3d(0,${(-140 * sc).toFixed(1)}px,0)`;
  const fs = u >= 9.6; $('c3_bfilehl').style.opacity = fs ? 1 : 0;
  const dl = P(u, 9.7, 10.6); $('c3_bdl').style.opacity = u >= 9.7 ? 1 : 0; $('c3_bdlbar').firstElementChild.style.width = (dl * 100).toFixed(1) + '%';
  clk('c3_clkB', u >= 8.0 ? 33 : 29);
  return { cam: pan, pos, op: wait(u, 0.5, 0.7) * (u < 5.3 ? 1 : (u < 6.6 ? 0 : 1)), press: (u > 1.38 && u < 1.5) || (u > 7.98 && u < 8.1) || (u > 9.58 && u < 9.7) };
}

// ---------- 章 4: ブラウザとドキュメントの往復 ----------
const LINES = [[470, 204], [470, 284], [470, 364]];   // ブラウザの中の行 (画面座標)
const DOCP = [[1046, 188], [1046, 234], [1046, 280]];
const T4 = [1.0, 3.3, 5.6];
function ch4(u) {
  let k = 0; T4.forEach((t, i) => { if (u >= t) k = i + 1; });
  const kf = [[0.4, 1000, 600]];
  T4.forEach((t, i) => {
    kf.push([t + 0.2, LINES[i][0] - 30, LINES[i][1] + 4, 900 + i * 20, 500, 500, LINES[i][1] + 60]);   // 行の左へ
    kf.push([t + 0.9, LINES[i][0] + 300, LINES[i][1] + 4]);                                      // ドラッグして選択
    kf.push([t + 1.1, LINES[i][0] + 300, LINES[i][1] + 4]);
    kf.push([t + 1.9, DOCP[i][0] + 40, DOCP[i][1] + 10, 1100, 300 + i * 30, 1000, 260]);           // ドキュメントへ
  });
  kf.push([8.4, 1300, 600]);
  const pos = path(kf, u);
  [0, 1, 2].forEach(i => {
    const t = T4[i];
    $('c4_sel' + i).style.width = (308 * P(u, t + .2, t + .9)) + 'px'; $('c4_sel' + i).style.opacity = (u >= t + .2 && u < t + 1.95) ? 1 : 0;
    $('c4_d' + i).style.opacity = u >= t + 1.95 ? 1 : 0;
  });
  // アクティブなウィンドウの切り替え: ブラウザ ↔ ドキュメント
  let doc = false; T4.forEach(t => { if (u >= t + 1.9 && u < t + 3.0) doc = true; }); if (u >= T4[2] + 1.9) doc = true;
  $('c4_web').classList.toggle('inact', doc); $('c4_doc').classList.toggle('inact', !doc);
  $('c4_mbname').textContent = doc ? 'Pages' : 'Chrome';
  clk('c4_clk', u >= T4[2] + 2.0 ? 29 : u >= T4[1] + 2.0 ? 28 : u >= T4[0] + 2.0 ? 27 : 26);
  return { cam: 0, pos, op: wait(u, 0.4, 0.6) * (1 - wait(u, 8.0, 8.4)), press: T4.some(t => (u > t + .18 && u < t + .3) || (u > t + 1.88 && u < t + 2.0)) };
}

const CHF = [ch1, ch2, ch3, ch4], CAMB = [B, B, B, 0];
function render(T) {
  T = clamp(T, 0, DUR - 1e-4);
  let c = 0; for (let i = 0; i < 4; i++) if (T >= STARTS[i]) c = i;
  const u = T - STARTS[c], CH = CHS[c];
  document.querySelectorAll('.chap').forEach((el, i) => el.style.display = i === c ? '' : 'none');
  ghost.style.opacity = 0;
  const r = CHF[c](u);
  setCur(r.raw ? r.pos : conv(r.pos), clamp(r.op), r.press);
  const va = { cx: 600, cy: 337.5 }, vb = { cx: SB + 600, cy: 337.5 }, cx = lerp(va.cx, CAMB[c] ? vb.cx : va.cx, r.cam), cy = lerp(va.cy, CAMB[c] ? vb.cy : va.cy, r.cam), s = 1.6;
  $('cam').style.transform = `translate3d(${(960 - cx * s).toFixed(2)}px,${(540 - cy * s).toFixed(2)}px,0) scale(${s})`;
  $('fade').style.opacity = Math.max(1 - P(u, 0, .32), P(u, CH - .38, CH)).toFixed(3);
}
window.renderAt = t => render(t);
window.__ready = (async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; render(0); return true; })();
</script></body></html>
'''

# ---------------- 共通の部品 ----------------
TRASH = '<svg width="52" height="52" viewBox="0 0 64 64"><path d="M18 20h28l-2.5 34a4 4 0 0 1-4 3.6H24.5a4 4 0 0 1-4-3.6z" fill="rgba(255,255,255,.5)" stroke="#8a90a0" stroke-width="2.5"/><rect x="14" y="14" width="36" height="6" rx="3" fill="#aeb3c0"/><rect x="26" y="9" width="12" height="6" rx="2.5" fill="#aeb3c0"/><path d="M26 26v24M32 26v24M38 26v24" stroke="rgba(120,125,140,.5)" stroke-width="2" stroke-linecap="round"/></svg>'
APPLE = '<svg viewBox="0 0 24 24"><path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>'
WIFI = '<svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4.2 4.2 0 0 1 5 0"/><circle cx="12" cy="19" r=".6" fill="#1d1d1f"/></svg>'
BATT = '<svg viewBox="0 0 26 24" style="width:22px"><rect x="2" y="7" width="19" height="10" rx="2.5"/><path d="M23 10.5v3"/><rect x="4" y="9" width="14" height="6" rx="1" fill="#1d1d1f" stroke="none"/></svg>'
WINLOGO = '<svg viewBox="0 0 20 20"><rect x="1" y="1" width="8.2" height="8.2" fill="#0a6fd8"/><rect x="10.8" y="1" width="8.2" height="8.2" fill="#0a6fd8"/><rect x="1" y="10.8" width="8.2" height="8.2" fill="#0a6fd8"/><rect x="10.8" y="10.8" width="8.2" height="8.2" fill="#0a6fd8"/></svg>'
COLS = {'pdf': ('#ff453a', 'PDF'), 'docx': ('#2b7cff', 'DOC'), 'xlsx': ('#30b45a', 'XLS'), 'pptx': ('#ff8a2a', 'PPT'), 'txt': ('#8e8e93', 'TXT'), 'zip': ('#a66cff', 'ZIP')}
CLOUD = '<svg viewBox="0 0 64 64"><path d="M20 46h26a10 10 0 0 0 1-19.9A14 14 0 0 0 20 28a9 9 0 0 0 0 18z" fill="#eaf3ff" stroke="#0a84ff" stroke-width="3" stroke-linejoin="round"/></svg>'


def fsvg(ext, cls=''):
    c, t = COLS[ext]
    return (f'<svg class="{cls}" viewBox="0 0 64 64">'
            f'<path d="M12 4h28l14 14v38a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#ffffff" stroke="#b4b8c4" stroke-width="1.6"/><path d="M40 4l14 14H44a4 4 0 0 1-4-4z" fill="#dfe2ea" stroke="#b4b8c4" stroke-width="1.6" stroke-linejoin="round"/>'
            f'<rect x="8" y="34" width="34" height="16" rx="3" fill="{c}"/><text x="25" y="46.2" font-family="-apple-system,Helvetica,sans-serif" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">{t}</text></svg>')


def tls(): return '<i class="tl"></i><i class="tl y"></i><i class="tl g"></i>'


def capbtn():
    return ('<span class="cb"><i><svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg></i><i><svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg></i><i><svg viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8"/></svg></i></span>')


def mac(clkid, appname, appid, menus, dockicons, running, body, left=0, ox=-400):
    pre = clkid.split('_')[0]
    mb = (f'<div class="menubar"><div>{APPLE}<b id="{appid}">{appname}</b>' + ''.join(f'<span>{m}</span>' for m in menus)
          + f'</div><div class="st">{WIFI}{BATT}<span>100%</span><span id="{clkid}">13:26</span></div></div>')
    dk = ''.join(f'<span class="di{" run" if a in running else ""}" id="{pre}_dk{a}"><img src="ui/appicons/{a}.png"></span>' for a in dockicons) + f'<i class="sep"></i><span class="di">{TRASH}</span>'
    return f'<div class="scr mac" style="left:{left}px">{mb}<div style="position:absolute;left:{ox}px;top:0">{body}</div><div class="dock">{dk}</div></div>'


def winpc(clkid, icons, running, body, left=1400, ox=-400, oy=-226):
    pre = clkid.split('_')[0]
    tb = (f'<div class="taskbar"><div class="mid"><span class="ti">{WINLOGO}</span>'
          + ''.join(f'<span class="ti{" act" if a == running else ""}" id="{pre}_tb{a}"><img src="ui/appicons/{a}.png"></span>' for a in icons)
          + f'</div><div class="tray"><svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4.2 4.2 0 0 1 5 0"/></svg><div><div id="{clkid}">13:26</div><div>2026/09/30</div></div></div></div>')
    return f'<div class="scr win" style="left:{left}px"><div style="position:absolute;left:{ox}px;top:{oy}px">{body}</div>{tb}</div>'


# ================= 章 1: メール =================
mailA = ('<div class="win" id="c1_win" style="left:560px;top:70px;width:820px;height:520px"><div class="bar">' + tls() + '<span style="margin-left:14px">新規メッセージ</span>'
         '<svg style="margin-left:auto;width:20px;height:20px;opacity:.5" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round"><path d="M20 11.5l-7.7 7.7a5 5 0 0 1-7-7l8.4-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4L15 7.3"/></svg></div>'
         '<div style="position:absolute;left:28px;top:56px;display:flex;align-items:center;gap:14px;font:15px var(--display);color:#8a8a90"><b style="font-weight:500;width:44px">宛先</b><span style="display:inline-flex;align-items:center;gap:8px;height:26px;padding:0 12px 0 5px;border-radius:13px;background:rgba(10,132,255,.14);color:#0a63c9;font:600 13.5px var(--display)"><i style="width:17px;height:17px;border-radius:9px;background:#5b8cff;display:block"></i>自分</span></div>'
         '<div style="position:absolute;left:28px;top:96px;display:flex;align-items:center;gap:14px;font:15px var(--display);color:#8a8a90"><b style="font-weight:500;width:44px">件名</b><span style="color:#1d1d1f">資料</span></div>'
         '<div style="position:absolute;left:0;right:0;top:142px;height:1px;background:rgba(0,0,0,.08)"></div>'
         '<div style="position:absolute;left:28px;top:160px;width:300px"><div class="sl" style="width:260px;margin-bottom:12px"></div><div class="sl" style="width:200px"></div></div>'
         '<div style="position:absolute;left:28px;right:28px;top:300px;height:110px;border-radius:12px;box-shadow:inset 0 0 0 1.5px rgba(0,0,0,.1);background:rgba(0,0,0,.02)"><div class="chip" id="c1_chip" style="position:absolute;left:14px;top:14px;opacity:0">' + fsvg('pdf') + '<div>資料.pdf<small>PDF · 212 KB</small></div></div></div>'
         '<div class="btn" style="position:absolute;right:24px;bottom:20px">送信</div>'
         '<div id="c1_prog" class="pbar" style="position:absolute;left:0;right:0;bottom:0;height:5px;border-radius:0;opacity:0"><i></i></div></div>')
scrA1 = mac('c1_clkA', 'メール', 'c1_mb', ['ファイル', '編集', '表示', 'メールボックス', 'メッセージ', 'ウインドウ', 'ヘルプ'], ['Finder', 'Mail', 'Chrome', 'Slack'], ['Finder', 'Mail'], mailA)
rowsB = ''.join(f'<div style="height:64px;padding:12px 14px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06)"><div class="sl d" style="width:{w}px;margin-bottom:9px"></div><div class="sl" style="width:{w2}px"></div></div>' for w, w2 in [(90, 200), (120, 170), (70, 220), (100, 150)])
newrow = ('<div id="c1_new" style="position:absolute;left:0;right:0;top:0;height:64px;padding:12px 14px 12px 26px;background:rgba(10,132,255,.08);box-shadow:inset 0 -1px 0 rgba(0,0,0,.06);opacity:0">'
          '<i style="position:absolute;left:10px;top:26px;width:8px;height:8px;border-radius:4px;background:#0a84ff"></i>'
          '<div style="font:700 13px var(--display);margin-bottom:5px">自分</div><div style="font:600 12px var(--display);color:#444">資料 📎</div></div>')
mailB = ('<div class="wn" style="left:480px;top:250px;width:1000px;height:580px"><div class="cap">メール' + capbtn() + '</div>'
         '<div style="position:absolute;left:0;top:36px;width:150px;bottom:0;background:#f5f6fa;box-shadow:inset -1px 0 0 rgba(0,0,0,.07)">' + ''.join(f'<div class="sl" style="width:{w}px;margin:18px 16px 0"></div>' for w in (70, 96, 60, 84)) + '</div>'
         '<div style="position:absolute;left:150px;top:36px;width:300px;bottom:0;box-shadow:inset -1px 0 0 rgba(0,0,0,.07)">'
         '<div style="height:44px;display:flex;align-items:center;padding:0 14px;gap:10px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.07)"><b style="font:700 15px var(--display)">受信トレイ</b>'
         '<span style="margin-left:auto;width:26px;height:26px;position:relative"><svg id="c1_refresh" viewBox="0 0 24 24" fill="none" stroke="#444" stroke-width="2" stroke-linecap="round" style="position:absolute;inset:0;width:26px;height:26px;padding:3px"><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v5h-5"/></svg>'
         '<span class="spin" id="c1_spin" style="position:absolute;left:4px;top:4px;opacity:0"></span></span></div>'
         '<div style="position:absolute;left:0;right:0;top:44px;bottom:0;overflow:hidden"><div id="c1_rows">' + rowsB + '</div>' + newrow + '</div></div>'
         '<div style="position:absolute;left:450px;top:36px;right:0;bottom:0;background:#fff">'
         '<div id="c1_empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="1.4"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div>'
         '<div id="c1_read" style="position:absolute;inset:0;padding:30px 34px;opacity:0"><div style="font:700 20px var(--display);margin-bottom:6px">資料</div><div style="font:13px var(--display);color:#8a8a90;margin-bottom:26px">自分</div>'
         '<div class="sl" style="width:300px;margin-bottom:12px"></div><div class="sl" style="width:220px;margin-bottom:34px"></div>'
         '<div class="chip" id="c1_chipB" style="position:relative;overflow:hidden">' + fsvg('pdf') + '<div>資料.pdf<small>PDF · 212 KB</small></div></div>'
         '<div id="c1_dl" class="pbar" style="width:200px;margin-top:14px;opacity:0"><i></i></div></div></div></div>')
saved = f'<div class="dicon" id="c1_saved" style="left:1490px;top:290px;opacity:0">{fsvg("pdf")}<span>資料.pdf</span></div>'
scrB1 = winpc('c1_clkB', ['Mail', 'Chrome', 'Excel', 'Word'], 'Mail', mailB + saved)

# ================= 章 2: Slack =================
# 画面の座標 (1200x675) で書く。Mac は左上が (0,0)、Windows も同じ (mac()/winpc() の基準をずらさない: ox=0, oy=0)
def msgs(items):
    out = ''
    for c, w, w2 in items:
        out += f'<div style="display:flex;gap:12px;height:62px;flex:none"><u style="width:34px;height:34px;border-radius:8px;background:{c};display:block;flex:none"></u><div><div class="sl d" style="width:{w}px;margin-bottom:8px"></div><div class="sl" style="width:{w2}px"></div></div></div>'
    return out


URL = 'https://www.example.com/blog/2026/clipboard-sync'
SIDEBAR = ('<div style="font:700 15px var(--display);margin-bottom:16px">ワークスペース</div>'
           '<div style="font:13px var(--display);opacity:.7;line-height:30px"># general<br># デザイン<br># 開発</div>')
chromeA = ('<div class="win" id="c2_chrome" style="left:140px;top:70px;width:860px;height:490px"><div class="bar" style="background:#e6e7ec;height:40px">' + tls()
           + '<span style="margin-left:16px;flex:1;height:26px;border-radius:13px;background:#fff;display:flex;align-items:center;padding:0 14px;font:13px var(--display);color:#555"><span class="lk" id="c2_addrtxt"><i class="selbar" id="c2_asel"></i><span class="t">' + URL + '</span></span></span></div>'
           '<div style="position:absolute;left:60px;top:76px;right:60px"><div class="sl d" style="width:340px;height:16px;margin-bottom:24px"></div>' + ''.join('<div class="sl" style="margin-bottom:14px;width:%dpx"></div>' % w for w in (700, 660, 680, 470, 670, 590)) + '</div></div>')
slackA = ('<div class="win" id="c2_slack" style="left:200px;top:96px;width:860px;height:464px;z-index:2"><div class="bar" style="background:#4a154b;color:#fff">' + tls() + '<span style="margin-left:14px;color:#fff">Slack</span></div>'
          '<div style="position:absolute;left:0;top:40px;width:220px;bottom:0;background:#3f0e40;color:#fff;padding:14px">' + SIDEBAR
          + '<div style="font:13px var(--display);line-height:30px;background:rgba(255,255,255,.18);border-radius:6px;padding:0 8px;margin:4px -8px"># 自分だけ</div></div>'
          '<div style="position:absolute;left:220px;top:40px;right:0;bottom:0;background:#fff">'
          '<div style="height:46px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08);display:flex;align-items:center;padding:0 20px;font:700 15px var(--display)"># 自分だけ</div>'
          '<div style="position:absolute;left:24px;right:24px;top:46px;bottom:100px;display:flex;flex-direction:column;justify-content:flex-end;gap:14px;padding-bottom:10px;overflow:hidden">'
          + msgs([('#a66cff', 100, 260), ('#ff8f4a', 90, 300), ('#3ccf5e', 120, 220)])
          + '<div id="c2_sent" style="display:flex;gap:12px;flex:none;overflow:hidden;height:0;opacity:0"><u style="width:34px;height:34px;border-radius:8px;background:#0a84ff;display:block;flex:none"></u><div><div class="sl d" style="width:70px;margin-bottom:8px"></div><div style="font:13px var(--mono);color:#1264a3;white-space:nowrap">' + URL + '</div></div></div></div>'
          '<div id="c2_input" style="position:absolute;left:24px;right:24px;bottom:22px;height:64px;border-radius:10px;box-shadow:inset 0 0 0 1.5px rgba(0,0,0,.2);padding:14px 16px;font:13px var(--display)"><span id="c2_ph" style="color:#aaa">メッセージを入力</span><span id="c2_ptxt" style="opacity:0;position:absolute;left:16px;top:14px;font:13px var(--mono);color:#1264a3;white-space:nowrap">' + URL + '</span></div></div></div>')
scrA2 = mac('c2_clkA', 'Chrome', 'c2_mbname', ['ファイル', '編集', '表示', '履歴', 'ブックマーク', 'ウインドウ', 'ヘルプ'], ['Finder', 'Chrome', 'Slack', 'Notion', 'Figma', 'Numbers', 'Pages', 'Word'], ['Finder', 'Chrome', 'Slack'], chromeA + slackA, ox=0)
slackB = ('<div class="wn" id="c2_bslack" style="left:100px;top:30px;width:1000px;height:570px;opacity:0"><div class="cap dark" style="background:#4a154b;color:#fff">Slack' + capbtn() + '</div>'
          '<div style="position:absolute;left:0;top:36px;width:230px;bottom:0;background:#3f0e40;color:#fff;padding:14px">' + SIDEBAR
          + '<div id="c2_bch" style="font:13px var(--display);line-height:30px;border-radius:6px;padding:0 8px;margin:4px -8px;color:#fff"># 自分だけ</div></div>'
          '<div style="position:absolute;left:230px;top:36px;right:0;bottom:0;background:#fff;overflow:hidden">'
          '<div style="height:46px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08);display:flex;align-items:center;padding:0 20px;font:700 15px var(--display)"># 自分だけ</div>'
          '<div id="c2_bview" style="position:absolute;left:0;right:0;top:46px;bottom:0;overflow:hidden;opacity:0"><div id="c2_bmsgs" style="position:absolute;left:24px;top:24px;display:flex;flex-direction:column;gap:14px">'
          + msgs([('#ff8f4a', 90, 320), ('#3ccf5e', 120, 240), ('#a66cff', 70, 360), ('#0a84ff', 100, 200), ('#ff8f4a', 110, 300), ('#3ccf5e', 80, 260), ('#a66cff', 130, 210), ('#ff8f4a', 90, 340)])
          + '<div style="display:flex;gap:12px;height:62px;flex:none"><u style="width:34px;height:34px;border-radius:8px;background:#0a84ff;display:block;flex:none"></u><div><div class="sl d" style="width:70px;margin-bottom:8px"></div><div style="font:13px var(--mono);color:#1264a3"><span class="lk" id="c2_blink"><i class="selbar" id="c2_lsel"></i><span class="t">' + URL + '</span></span></div></div></div></div></div></div></div>')
chromeB = ('<div class="wn" id="c2_bchrome" style="left:160px;top:50px;width:900px;height:550px;opacity:0"><div class="cap" style="background:#dfe1e8">' + capbtn()
           + '<span id="c2_baddr" style="margin-left:0;width:560px;height:24px;border-radius:12px;background:#fff;display:flex;align-items:center;padding:0 12px;font:12px var(--display);color:#555;position:relative"><span id="c2_bph" style="color:#aaa">検索または URL を入力</span><span id="c2_baddrtxt" style="opacity:0;position:absolute;left:12px">' + URL + '</span></span></div>'
           '<div id="c2_bpage" style="position:absolute;left:60px;top:70px;right:60px;opacity:0"><div class="sl d" style="width:340px;height:16px;margin-bottom:24px"></div>' + ''.join('<div class="sl" style="margin-bottom:14px;width:%dpx"></div>' % w for w in (800, 760, 780, 540)) + '</div></div>')
scrB2 = winpc('c2_clkB', ['Chrome', 'Slack', 'Notion', 'Excel'], '', slackB + chromeB, ox=0, oy=0)

# ================= 章 3: クラウド =================
def drive(idp, body, extra=''):
    return (f'<div class="win" id="{idp}" style="left:600px;top:70px;width:900px;height:520px"><div class="bar" style="background:#e6e7ec">' + tls() + '<span style="margin-left:16px;flex:1;height:26px;border-radius:13px;background:#fff;display:flex;align-items:center;padding:0 14px;font:13px var(--display);color:#555">cloud-drive.example.com</span></div>'
            '<div style="position:absolute;left:0;right:0;top:40px;height:56px;display:flex;align-items:center;gap:12px;padding:0 24px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08)"><span style="width:34px;height:34px;display:block">' + CLOUD + '</span><b style="font:700 17px var(--display)">ドライブ</b></div>' + body + '</div>')
upA = ('<div style="position:absolute;left:40px;right:40px;top:130px;height:220px;border-radius:14px;box-shadow:inset 0 0 0 2px rgba(10,132,255,.35);background:rgba(10,132,255,.04);display:flex;align-items:center;justify-content:center"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="rgba(10,132,255,.5)" stroke-width="1.6" stroke-linecap="round"><path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg></div>'
       '<div id="c3_up" style="position:absolute;left:40px;right:40px;top:390px;height:76px;border-radius:12px;box-shadow:0 0 0 1px rgba(0,0,0,.1);padding:14px 18px;opacity:0"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><span style="width:30px;height:30px;display:block">' + fsvg('zip') + '</span><b style="font:600 14px var(--display)">資料一式.zip</b><span id="c3_uppct" style="margin-left:auto;font:600 13px var(--mono);color:#666">0%</span><span id="c3_upok" style="opacity:0;color:#1f9d4a;font:700 14px var(--display)">✓</span></div><div id="c3_upbar" class="pbar"><i></i></div></div>')
scrA3 = mac('c3_clkA', 'Chrome', 'c3_mb', ['ファイル', '編集', '表示', '履歴', 'ブックマーク', 'ウインドウ', 'ヘルプ'], ['Finder', 'Chrome', 'Slack', 'Notion', 'Figma', 'Numbers', 'Pages', 'Word'], ['Finder', 'Chrome'],
            drive('c3_win', upA) + f'<div class="dicon" id="c3_dic" style="left:430px;top:120px">{fsvg("zip")}<span>資料一式.zip</span></div>')
folders = ''.join(f'<div style="display:flex;align-items:center;gap:14px;height:56px;padding:0 24px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06)"><svg width="28" height="28" viewBox="0 0 24 24" fill="#8ab4f8"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg><div class="sl d" style="width:{w}px"></div></div>' for w in (120, 90, 140, 100))
files = ''.join(f'<div style="display:flex;align-items:center;gap:14px;height:56px;padding:0 24px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06)"><span style="width:30px;height:30px;display:block">{fsvg("txt")}</span><div class="sl d" style="width:{w}px"></div></div>' for w in (140, 110, 160, 100, 130, 120, 150, 90))
target = f'<div style="display:flex;align-items:center;gap:14px;height:56px;padding:0 24px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.06);background:rgba(10,132,255,.08)"><span style="width:30px;height:30px;display:block">{fsvg("zip")}</span><b style="font:600 14px var(--display)">資料一式.zip</b></div>'
driveB = ('<div id="c3_bfolders" style="position:absolute;left:0;right:0;top:96px">' + folders + '</div>'
          '<div id="c3_bfiles" style="position:absolute;left:0;right:0;top:96px;bottom:0;overflow:hidden;opacity:0"><div>' + files + target + files[:0] + '</div></div>'
          '<div id="c3_bfilehl" style="position:absolute;left:0;right:0;top:400px;height:56px;background:rgba(10,132,255,.1);opacity:0"></div>'
          '<div id="c3_bdl" style="position:absolute;left:20px;bottom:18px;width:300px;padding:12px 16px;border-radius:10px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.14),0 10px 24px rgba(0,0,0,.14);opacity:0"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="width:26px;height:26px;display:block">' + fsvg('zip') + '</span><b style="font:600 13px var(--display)">資料一式.zip</b></div><div id="c3_bdlbar" class="pbar"><i></i></div></div>')
driveBwin = ('<div class="wn" id="c3_bwin" style="left:560px;top:250px;width:940px;height:580px"><div class="cap" style="background:#dfe1e8">' + capbtn() + '<span style="width:520px;height:24px;border-radius:12px;background:#fff;display:flex;align-items:center;padding:0 12px;font:12px var(--display);color:#555">cloud-drive.example.com</span></div>'
             '<div style="position:absolute;left:0;right:0;top:36px;height:56px;display:flex;align-items:center;gap:12px;padding:0 24px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.08)"><span style="width:34px;height:34px;display:block">' + CLOUD + '</span><b style="font:700 17px var(--display)">ドライブ</b></div>' + driveB.replace('top:96px', 'top:92px') + '</div>')
scrB3 = winpc('c3_clkB', ['Chrome', 'Slack', 'Notion', 'Excel'], 'Chrome', driveBwin)

# ================= 章 4: 往復 =================
web = ('<div class="win" id="c4_web" style="left:430px;top:70px;width:560px;height:520px"><div class="bar" style="background:#e6e7ec">' + tls() + '<span style="margin-left:16px;flex:1;height:26px;border-radius:13px;background:#fff;display:flex;align-items:center;padding:0 14px;font:13px var(--display);color:#555">www.example.com/report</span></div>'
       '<div style="position:absolute;left:36px;right:36px;top:64px"><div class="sl d" style="width:240px;height:16px;margin-bottom:24px"></div>'
       + ''.join(f'<div style="position:relative;height:80px"><div class="sl" style="position:absolute;top:8px;width:470px"></div><i id="c4_sel{i}" style="position:absolute;left:-4px;top:24px;height:21px;width:0;background:rgba(10,132,255,.3);border-radius:3px"></i><div class="sl d" style="position:absolute;top:30px;width:300px"></div><div class="sl" style="position:absolute;top:56px;width:400px"></div></div>' for i in range(3)) + '</div></div>')
docsl = ''.join(f'<div id="c4_d{i}" style="position:absolute;left:36px;top:{112 + i * 46}px;opacity:0;width:300px"><div class="sl d" style="width:300px;height:12px"></div></div>' for i in range(3))
doc = ('<div class="win inact" id="c4_doc" style="left:1010px;top:70px;width:560px;height:520px"><div class="bar" style="background:#f3f3f5">' + tls() + '<span style="margin-left:14px">レポート — Pages</span></div>'
       '<div style="position:absolute;left:36px;top:62px;width:300px"><div class="sl d" style="width:220px;height:16px"></div></div>' + docsl + '</div>')
scrA4 = mac('c4_clk', 'Chrome', 'c4_mbname', ['ファイル', '編集', '表示', '履歴', 'ブックマーク', 'ウインドウ', 'ヘルプ'], ['Finder', 'Chrome', 'Pages', 'Slack', 'Notion', 'Numbers'], ['Finder', 'Chrome', 'Pages'], web + doc)

chaps = ''.join(f'<div class="chap" id="chap{i + 1}">{s}</div>' for i, s in enumerate([scrA1 + scrB1, scrA2 + scrB2, scrA3 + scrB3, scrA4]))
out = PAGE.replace('__ZIP__', fsvg('zip')).replace('__CHAPS__', chaps).replace('__CHS__', str(CHS)).replace('__STARTS__', str(STARTS)).replace('__DUR__', str(DUR))
open('clip_pain.html', 'w', encoding='utf8').write(out)
print('clip_pain.html dur', DUR, 'starts', STARTS)
