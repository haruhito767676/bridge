#!/usr/bin/env python3
"""clip_shelf.html: 「ファイル棚」クリップ (film8 と同じ Mac の画角・同じ背景)
   Finder 風のウィンドウで 2 ファイルを選ぶ → 画面右端のつまみへドラッグ → シェルフが開いてドロップ
   → メールの新規メッセージへ、シェルフからドラッグして添付
"""
import re
film = open('film8.html', encoding='utf8').read()
style = re.search(r'<style>(.*?)</style>', film, re.S).group(1)

DUR = 9.0
PAGE = r'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>Bridge clip: shelf</title>
<style>''' + style + r'''
#s2bg,#s2{background:#0a84ff}
.fin{background:#1f1f22;color:#f0f0f2}
.fin .bar{background:rgba(255,255,255,.05)}
.fin .side{position:absolute;left:0;top:44px;bottom:0;width:130px;background:rgba(255,255,255,.04)}
.fin .side i{display:block;height:10px;border-radius:5px;background:rgba(255,255,255,.14);margin:22px 18px 0}
.fitem{position:absolute;width:140px;height:150px}
.fitem .ic{position:absolute;left:26px;top:4px;width:88px;height:88px;border-radius:14px}
.fitem .ic img{width:88px;height:88px;object-fit:contain;display:block}
.fitem .ic.th img{width:84px;height:84px;margin:2px;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.2);background:#fff;object-fit:cover}
.fitem .nm{position:absolute;left:4px;right:4px;top:98px;text-align:center;font:500 14px/1.3 var(--display);padding:2px 4px;border-radius:6px;word-break:break-all}
.fitem.sel .ic{background:rgba(255,255,255,.18)}
.fitem.sel .nm{background:#0a84ff;color:#fff}
.mail{background:#1d1d20;color:#f0f0f2}
.fin.inactive .tl{background:#57575c}
.msend{position:absolute;right:30px;bottom:18px;height:46px;padding:0 26px;border-radius:23px;background:#0a84ff;color:#fff;font:700 18px var(--display);display:flex;align-items:center;gap:8px}
.msend.sent{background:rgba(48,209,88,.16);color:#30d158;box-shadow:inset 0 0 0 1.5px rgba(48,209,88,.5)}
.dock .dot{position:absolute;bottom:5px;width:5px;height:5px;border-radius:3px;background:rgba(255,255,255,.85)}
.mail .row{position:absolute;left:30px;right:30px;height:34px;display:flex;align-items:center;gap:18px;font:500 17px var(--display);color:#98989f}
.mail .row b{font-weight:500;width:50px}
.mail .ln{position:absolute;height:12px;border-radius:6px;background:rgba(255,255,255,.14)}
.mail .div{position:absolute;left:0;right:0;height:1px;background:rgba(255,255,255,.08)}
.mail .attach{position:absolute;left:30px;right:30px;top:256px;height:134px;border-radius:14px;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.1);background:rgba(255,255,255,.03)}
.chip3{position:absolute;height:54px;padding:0 20px 0 12px;border-radius:14px;background:rgba(255,255,255,.09);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);display:flex;align-items:center;gap:12px;font:600 16px var(--display);color:#eee;white-space:nowrap}
.chip3 img{width:36px;height:36px;object-fit:contain;border-radius:6px}
#ghost{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none}
.gcard{position:absolute;left:0;top:0;height:56px;padding:0 18px 0 10px;border-radius:12px;background:rgba(40,40,46,.94);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2),0 18px 40px rgba(0,0,0,.5);display:flex;align-items:center;gap:10px;font:600 15px var(--display);color:#fff;white-space:nowrap;transform-origin:0 0}
.gcard img{width:36px;height:36px;object-fit:contain;border-radius:5px}
.gtile{position:absolute;left:0;top:0;width:60px;height:60px;border-radius:12px;background:rgba(48,48,54,.95);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 14px 30px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.gtile img{width:44px;height:44px;object-fit:contain;border-radius:5px}
.gbadge{position:absolute;left:0;top:0;min-width:26px;height:26px;padding:0 8px;border-radius:13px;background:#0a84ff;color:#fff;font:700 15px var(--display);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(0,0,0,.4)}
#tabpill{position:absolute;left:1428px;top:400px;width:6px;height:72px;border-radius:3px;background:rgba(255,255,255,.55)}
#curs{position:absolute;left:0;top:0;width:34px;height:44px;filter:drop-shadow(0 4px 8px rgba(0,0,0,.5))}
</style></head>
<body class="cap">
<div id="stage"><div id="world" class="L">
  <div id="s2" class="L">
    <div id="s2bg" class="L" style="background:linear-gradient(150deg,#0a84ff 0%,#0a84ff 36%,#3f6cf5 70%,#6a55ee 100%)"></div>
    <div class="glow" style="left:-300px;top:-200px;width:1500px;height:1100px;background:radial-gradient(closest-side,rgba(255,255,255,.3),rgba(255,255,255,0))"></div>
    <div class="glow" style="left:1000px;top:400px;width:1400px;height:900px;background:radial-gradient(closest-side,rgba(150,110,255,.5),rgba(150,110,255,0))"></div>
    <div id="cam" style="position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;transform:translate3d(960px,540px,0) scale(1.1)">
      <div class="dev" id="devMac" style="left:-742px;top:-472px">
        <div class="lid" style="width:1484px;height:944px;border-radius:34px"></div>
        <div class="base" style="left:-110px;top:938px;width:1704px;height:34px;border-radius:0 0 46px 46px;background:linear-gradient(180deg,#d8dbe1,#8f939b);box-shadow:0 40px 80px rgba(0,20,110,.45)"><div style="position:absolute;left:50%;top:0;width:240px;height:12px;margin-left:-120px;border-radius:0 0 14px 14px;background:linear-gradient(180deg,#9da1a9,#c3c6cc)"></div></div>
        <div style="position:absolute;left:650px;top:22px;width:184px;height:26px;border-radius:0 0 14px 14px;background:#09090b;z-index:3"></div>
        <div class="screen" id="scMac" style="left:22px;top:22px;width:1440px;height:900px;border-radius:12px">
          <div class="wp wp-mac"></div>
          <div class="menubar"><div id="mbF"><b>Finder</b><span>ファイル</span><span>編集</span><span>表示</span><span>移動</span><span>ウインドウ</span><span>ヘルプ</span></div><div id="mbM" style="display:none"><b>メール</b><span>ファイル</span><span>編集</span><span>表示</span><span>メッセージ</span><span>ウインドウ</span><span>ヘルプ</span></div><div><span>100%</span><span>13:26</span></div></div>

          <div class="win fin" style="left:90px;top:140px;width:640px;height:440px">
            <div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:14px">書類</span></div>
            <div class="side"><i style="width:70px"></i><i style="width:90px"></i><i style="width:60px"></i><i style="width:80px"></i></div>
            <div id="fitems"></div>
          </div>

          <div class="win mail" id="mail" style="left:470px;top:320px;width:600px;height:460px;opacity:0">
            <div class="bar"><i class="tl"></i><i class="tl y"></i><i class="tl g"></i><span style="margin-left:14px">新規メッセージ</span></div>
            <div class="row" style="top:56px"><b>宛先</b><span style="display:inline-flex;align-items:center;gap:8px;height:28px;padding:0 12px 0 5px;border-radius:14px;background:rgba(10,132,255,.22);color:#9fcbff;font:600 15px var(--display)"><i style="width:18px;height:18px;border-radius:9px;background:#5b8cff;display:block"></i>自分</span></div>
            <div class="row" style="top:96px"><b>件名</b><span class="ln" style="position:static;width:180px"></span></div>
            <div class="div" style="top:142px"></div>
            <span class="ln" style="left:30px;top:168px;width:420px"></span><span class="ln" style="left:30px;top:196px;width:300px"></span>
            <div class="attach" id="attach"></div>
            <div class="msend" id="msend">送信</div>
          </div>

          <div id="tabpill"></div>
          <div class="pslot" id="slotMac" style="left:1120px;top:150px;width:320px;height:600px">
            <div class="panel glass"><img id="pb" src="ui/plates/shelf/before.png" style="position:absolute;left:0;top:0;width:320px;height:600px"><img id="po" src="ui/plates/shelf/over.png" style="position:absolute;left:0;top:0;width:320px;height:600px;opacity:0"><img id="pa" src="ui/plates/shelf/after.png" style="position:absolute;left:0;top:0;width:320px;height:600px;opacity:0"></div>
          </div>
          <div class="dock"><span class="di run"><img src="ui/appicons/Finder.png"></span><span class="di" id="diM"><img src="ui/appicons/Mail.png"></span><span class="di run"><img src="ui/appicons/Chrome.png"></span><span class="di"><img src="ui/appicons/Slack.png"></span><span class="di"><img src="ui/appicons/Notion.png"></span><span class="di"><img src="ui/appicons/Figma.png"></span><i class="sep"></i><span class="di"><svg width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="tgS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f5"/><stop offset="1" stop-color="#9aa0ad"/></linearGradient></defs><path d="M18 20h28l-2.5 34a4 4 0 0 1-4 3.6H24.5a4 4 0 0 1-4-3.6z" fill="rgba(255,255,255,.28)" stroke="url(#tgS)" stroke-width="2.5"/><rect x="14" y="14" width="36" height="6" rx="3" fill="url(#tgS)"/><rect x="26" y="9" width="12" height="6" rx="2.5" fill="url(#tgS)"/><path d="M26 26v24M32 26v24M38 26v24" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linecap="round"/></svg></span></div>
          <div id="ghost"></div>
          <svg id="curs" viewBox="0 0 34 44"><path d="M3 2v34l9-8 6 14 7-3-6-14 12-1z" fill="#fff" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/></svg>
        </div>
      </div>
    </div>
  </div>
  <div id="fade" class="L" style="background:#000;opacity:1;pointer-events:none"></div>
</div></div>
<script>
'use strict';
const DUR = ''' + str(DUR) + r''';
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
function spring(dt, k = 140, c = 22) {
  if (dt <= 0) return 0;
  const w0 = Math.sqrt(k), z = c / (2 * w0);
  if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * dt) * (Math.cos(wd * dt) + (z * w0 / wd) * Math.sin(wd * dt)); }
  return 1 - Math.exp(-w0 * dt) * (1 + w0 * dt);
}
const A = 'ui/clipicons/', DEMO = '../../assets/demo/';
const FILES = [
  { name: '提案資料_リニューアル方針.pptx', short: '提案資料_リニューアル方針.pptx', icon: A + 'file-pptx.png', th: false },
  { name: '画面遷移図.png', short: '画面遷移図.png', icon: DEMO + '画面遷移図.png', th: true },
  { name: '契約書_業務委託.docx', short: '契約書_業務委託.docx', icon: A + 'file-docx.png', th: false },
  { name: '請求書_9月.pdf', short: '請求書_9月.pdf', icon: A + 'file-pdf.png', th: false },
  { name: '経費精算_9月.xlsx', short: '経費精算_9月.xlsx', icon: A + 'file-xlsx.png', th: false },
  { name: '議事録_1010_定例MTG.txt', short: '議事録_1010_定例MTG.txt', icon: A + 'file-txt.png', th: false },
];
// Finder の中の位置 (画面座標): ウィンドウ (90,140) の中、サイドバー 130px の右から 3 列
const FX = 90 + 130 + 24, FY = 140 + 44 + 30;
const items = FILES.map((f, i) => {
  const col = i % 3, row = (i / 3) | 0, x = FX + col * 152, y = FY + row * 172;
  const el = document.createElement('div'); el.className = 'fitem'; el.style.left = (x - 90) + 'px'; el.style.top = (y - 140) + 'px';
  el.innerHTML = `<div class="ic${f.th ? ' th' : ''}"><img src="${f.icon}"></div><div class="nm">${f.name}</div>`;
  document.querySelector('.fin').appendChild(el);
  return { ...f, el, cx: x + 70, cy: y + 48 };
});
// 添付チップ / ドラッグ中のカード
const chips = [0, 1].map(i => { const f = FILES[i === 0 ? 1 : 0], el = document.createElement('div'); el.className = 'chip3'; el.style.left = '14px'; el.style.top = (12 + i * 62) + 'px'; el.style.opacity = 0; el.innerHTML = `<img src="${f.icon}" style="${f.th ? 'background:#fff;box-shadow:0 0 0 1px rgba(255,255,255,.25)' : ''}"><span>${f.name}</span>`; $('attach').appendChild(el); return el; });
function gcard(f) { const c = document.createElement('div'); c.className = 'gcard'; c.innerHTML = `<img src="${f.icon}"><span>${f.name}</span>`; return c; }
const ghost = $('ghost');
function gtile(f) { const c = document.createElement('div'); c.className = 'gtile'; c.innerHTML = `<img src="${f.icon}">`; return c; }
const g2 = [gtile(FILES[0]), gtile(FILES[1])]; g2[0].style.transform = 'translate(-12px,-10px) rotate(-6deg)'; g2[1].style.transform = 'translate(0,0) rotate(3deg)';
const badge = document.createElement('div'); badge.className = 'gbadge'; badge.textContent = '2'; badge.style.transform = 'translate(-26px,-26px)';
const g1 = [gcard(FILES[1]), gcard(FILES[0])];
[...g2, badge, ...g1].forEach(e => ghost.appendChild(e));

const cur = $('curs');
// 各区間 [t0, t1] のカーソル移動 (画面座標)。到着点は「指先」
const bz = (p0, c1, c2, p1, t) => { const q = 1 - t; return [q * q * q * p0[0] + 3 * q * q * t * c1[0] + 3 * q * t * t * c2[0] + t * t * t * p1[0], q * q * q * p0[1] + 3 * q * q * t * c1[1] + 3 * q * t * t * c2[1] + t * t * t * p1[1]]; };
const I1 = [items[0].cx + 8, items[0].cy + 10], I2 = [items[1].cx + 8, items[1].cy + 10];
const START = [980, 700], ROW1 = [1120 + 96, 150 + 142], ROW2 = [1120 + 96, 150 + 204];
const MAILA = [470 + 190, 320 + 300];   // メールの添付欄
const T = { sel1: 1.15, sel2: 1.5, drag0: 1.85, panel: 2.3, drop: 3.05, mail: 3.7, rowA: 4.55, rowA0: 4.9, dropA: 5.75, rowB: 6.1, rowB0: 6.3, dropB: 7.05, send: 8.0 };
function curPos(t) {
  if (t < T.sel1) { const p = E.inOut(P(t, .4, T.sel1 - .05)); return bz(START, [START[0] - 200, START[1] - 120], [I1[0] + 240, I1[1] + 120], I1, p); }
  if (t < T.sel2) { const p = E.inOut(P(t, T.sel1 + .1, T.sel2 - .05)); return [lerp(I1[0], I2[0], p), lerp(I1[1], I2[1], p)]; }
  if (t < T.drag0) return I2;
  if (t < T.drop) { const p = E.inOut(P(t, T.drag0, T.drop - .05)); return bz(I2, [I2[0] + 300, I2[1] - 70], [1120 - 120, ROW1[1] - 40], [ROW1[0] + 40, ROW1[1] + 30], p); }
  if (t < T.rowA) { const p = E.inOut(P(t, T.drop + .3, T.rowA - .05)); const a = [ROW1[0] + 40, ROW1[1] + 30]; return [lerp(a[0], ROW1[0] - 40, p), lerp(a[1], ROW1[1], p)]; }
  if (t < T.rowA0) return [ROW1[0] - 40, ROW1[1]];
  if (t < T.dropA) { const p = E.inOut(P(t, T.rowA0, T.dropA - .05)); return bz([ROW1[0] - 40, ROW1[1]], [ROW1[0] - 280, ROW1[1] + 40], [MAILA[0] + 250, MAILA[1] - 160], [MAILA[0] - 130, MAILA[1] - 10], p); }
  if (t < T.rowB) { const p = E.inOut(P(t, T.dropA + .12, T.rowB - .02)); const a = [MAILA[0] - 130, MAILA[1] - 10]; return [lerp(a[0], ROW2[0] - 40, p), lerp(a[1], ROW2[1], p) - 40 * Math.sin(Math.PI * p)]; }
  if (t < T.rowB0) return [ROW2[0] - 40, ROW2[1]];
  if (t < T.dropB) { const p = E.inOut(P(t, T.rowB0, T.dropB - .05)); return bz([ROW2[0] - 40, ROW2[1]], [ROW2[0] - 280, ROW2[1] + 60], [MAILA[0] + 250, MAILA[1] - 140], [MAILA[0] + 120, MAILA[1] - 10], p); }
  const a = [MAILA[0] + 120, MAILA[1] - 10], b = [470 + 600 - 30 - 56, 320 + 460 - 18 - 23]; const p = E.inOut(P(t, T.dropB + .3, T.send - .05)); return [lerp(a[0], b[0], p), lerp(a[1], b[1], p)];
}
function render(t) {
  // 選択
  items[0].el.classList.toggle('sel', t >= T.sel1 && t < T.drop + .1);
  items[1].el.classList.toggle('sel', t >= T.sel2 && t < T.drop + .1);
  // つまみ → シェルフ (ドラッグが近づくと開く。ドロップ後は開いたまま)
  const pan = spring(t - T.panel, 110, 16);
  $('slotMac').style.transform = `translate3d(${(340 * (1 - pan)).toFixed(1)}px,0,0)`;
  $('slotMac').style.opacity = t < T.panel - .02 ? 0 : 1;
  $('tabpill').style.opacity = (1 - P(t, T.panel - .1, T.panel + .15)).toFixed(3);
  const over = t >= T.panel + .2 && t < T.drop, drop = E.out(P(t, T.drop, T.drop + .28));
  $('pb').style.opacity = t < T.drop ? (over ? 0 : 1) : 0;
  $('po').style.opacity = t < T.drop ? (over ? 1 : 0) : (1 - drop).toFixed(3);
  $('pa').style.opacity = drop.toFixed(3);
  // メールが前面に来る: メニューバー / Finder の信号機 / Dock の点
  const mf = t >= T.mail + .05;
  $('mbF').style.display = mf ? 'none' : ''; $('mbM').style.display = mf ? '' : 'none';
  document.querySelector('.fin').classList.toggle('inactive', mf);
  $('diM').classList.toggle('run', mf);
  // 送信ボタン: 最後にクリックして「送信済み」
  const snd = $('msend'), sent = t >= T.send + .1;
  snd.textContent = sent ? '✓ 送信済み' : '送信'; snd.classList.toggle('sent', sent);
  snd.style.transform = `scale(${t > T.send && t < T.send + .1 ? .92 : 1})`;
  // メール
  const m = spring(t - T.mail, 120, 16);
  $('mail').style.opacity = clamp(P(t, T.mail, T.mail + .18)).toFixed(3);
  $('mail').style.transform = `translate3d(0,${(40 * (1 - m)).toFixed(1)}px,0) scale(${(.94 + .06 * m).toFixed(4)})`;
  // 添付チップ
  const c1 = spring(t - T.dropA, 150, 15), c2 = spring(t - T.dropB, 150, 15);
  chips[0].style.opacity = clamp(P(t, T.dropA, T.dropA + .1)); chips[0].style.transform = `translate3d(0,${(14 * (1 - c1)).toFixed(1)}px,0) scale(${(.9 + .1 * c1).toFixed(3)})`;
  chips[1].style.opacity = clamp(P(t, T.dropB, T.dropB + .1)); chips[1].style.transform = `translate3d(0,${(14 * (1 - c2)).toFixed(1)}px,0) scale(${(.9 + .1 * c2).toFixed(3)})`;
  // ゴースト
  const cp = curPos(t);
  const d1 = t >= T.drag0 && t < T.drop + .2, dA = t >= T.rowA0 && t < T.dropA + .18, dB = t >= T.rowB0 && t < T.dropB + .18;
  const gs = d1 ? 1 - .55 * E.in(P(t, T.drop - .05, T.drop + .18)) : 1;
  const fo = d1 ? 1 - E.in(P(t, T.drop + .02, T.drop + .2)) : 1;
  [g2[0], g2[1], badge].forEach(e => e.style.display = d1 ? '' : 'none');
  g1[0].style.display = dA ? '' : 'none'; g1[1].style.display = dB ? '' : 'none';
  const gp = dA ? P(t, T.dropA, T.dropA + .18) : dB ? P(t, T.dropB, T.dropB + .18) : 0;
  ghost.style.opacity = (d1 ? fo : 1 - gp).toFixed(3);
  ghost.style.transform = `translate3d(${(cp[0] + 6).toFixed(1)}px,${(cp[1] + 8).toFixed(1)}px,0) scale(${(d1 ? gs : 1 - .3 * gp).toFixed(3)})`;
  // カーソル
  const press = (t > T.sel1 && t < T.sel1 + .12) || (t > T.sel2 && t < T.sel2 + .12) ? .86 : 1;
  cur.style.transform = `translate3d(${cp[0].toFixed(1)}px,${cp[1].toFixed(1)}px,0) scale(${press})`;
  cur.style.opacity = P(t, .3, .5);
  $('fade').style.opacity = Math.max(1 - P(t, 0, .3), P(t, DUR - .35, DUR)).toFixed(3);
}
window.renderAt = t => render(clamp(t, 0, DUR));
window.__ready = (async () => { await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); await document.fonts.ready; render(0); return true; })();
</script></body></html>
'''
open('clip_shelf.html', 'w', encoding='utf8').write(PAGE)
print('clip_shelf.html written, dur', DUR)
