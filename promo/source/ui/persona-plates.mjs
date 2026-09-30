// 「どんな仕事でも、ちゃんと残る。」用: 職種ごとの履歴を、実 UI (Mac) で撮る。SCHEME=light で撮る。
//   plates-persona/<office|creator|engineer>/{chrome.png,row<i>.png}  … 行の部品 (幅 320, 透明背景)
//   plates-persona/manifest.js  … window.PMAN = { <persona>: { dz, rows, ... } }
//   plates-persona/popup/{q0..q3}.png … エンジニア章のポップアップ (「ssh」を 1 文字ずつ入力)
import { open, send, ev, sleep, APP, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const D = (n) => path.join(APP, 'assets/demo', n);
const icon = (n) => 'file://' + path.join(DIR, 'appicons', n + '.png');
const MIN = 60000, HOUR = 3600000;
const BASE = (() => { const d = new Date(); d.setHours(13, 26, 0, 0); return d.getTime(); })();
const mid = new Date(); mid.setHours(0, 0, 0, 0);
const app = (n) => ({ name: n, icon: icon(n) });
const remote = { 会社用PC: 'win32', 自宅iMac: 'darwin' };
// [種別, 内容, アプリ, 何分前 (負: 昨日の N 時間前), 出身デバイス]
const T = (text, a, ago, from) => ({ k: 'text', text, a, ago, from });
const F = (name, a, ago, from) => ({ k: 'file', name, a, ago, from });
const PERSONAS = {
  office: {
    newItem: T('9月度 売上合計 ¥12,840,000', 'Excel', 0.2),
    items: [
      T('16時からの定例、資料共有をお願いします', 'Teams', 25, '会社用PC'),
      F('経費精算_9月.xlsx', 'Excel', 70),
      F('請求書_9月.pdf', 'Excel', 130, '会社用PC'),
      T('第2会議室に変更', 'Teams', 190),
      F('週次レポート_W37.pptx', 'PowerPoint', 250),
      F('契約更新のご案内_最終.docx', 'Word', 320, '自宅iMac'),
      T('納期は10/31(金)でお願いします', 'Outlook', 400),
      F('プロジェクト計画書_v2.pptx', 'PowerPoint', 470),
      F('請求書送付リスト_9月.xlsx', 'Excel', -120),
      F('要件定義書_v3.docx', 'Word', -300),
    ],
  },
  creator: {
    newFile: F('バナー案_C案.png', null, 0.2),
    items: [
      T('#0A84FF', 'Figma', 8),
      F('アイコンセット_v2.png', 'Figma', 40),
      T('https://www.figma.com/file/abcd1234/EC-Renewal', 'Chrome', 75, '自宅iMac'),
      F('ロゴ_v4.png', 'Figma', 130),
      F('バナー案_A案.png', 'Figma', 200),
      T('Noto Sans JP / Bold / 32px / 行間 1.5', 'Figma', 280),
      F('バナー案_B案.png', 'Figma', 340),
      F('名刺デザイン案.png', 'Figma', 420, '自宅iMac'),
      F('デザインガイドライン_v2.pdf', 'Pages', -100),
      F('サイトマップ.pdf', 'Pages', -260),
    ],
  },
  engineer: {
    items: [
      T('git checkout -b fix/stock-alert', 'Terminal', 6),
      T('https://github.com/example-team/ec-renewal/pull/42', 'Chrome', 22),
      T("TypeError: Cannot read properties of undefined (reading 'id')", 'Terminal', 55),
      T('docker compose up -d', 'Terminal', 100),
      F('デプロイスクリプト.txt', 'Terminal', 160),
      T('kubectl logs -f deploy/api --tail=100', 'Terminal', 230, '会社用PC'),
      T('ssh deploy@192.168.1.42 -p 2222', 'Terminal', 300, '会社用PC'),
      T('npm run build && npm run deploy', 'Terminal', 380),
      F('環境変数一覧_本番.xlsx', 'Excel', -100),
      T('ssh-keygen -t ed25519 -C "deploy@example.com"', 'Terminal', -260),
    ],
  },
};
const OUT = path.join(DIR, 'plates-persona'); mkdirSync(OUT, { recursive: true });
const tsOf = (d) => d.ago < 0 ? mid.getTime() - (-d.ago) * MIN : BASE - d.ago * MIN;   // 負なら昨日 (0:00 の N 分前)
const toSaved = (d) => {
  const base = { timestamp: tsOf(d), sourceApp: d.a ? app(d.a) : null, fromDevice: d.from || null, fromPlatform: d.from ? remote[d.from] : null };
  return d.k === 'file' ? { kind: 'file', path: D(d.name), name: d.name, ...base } : { kind: 'clip-text', text: d.text, name: d.text, ...base };
};
const listGeom = () => ev(`(()=>{
  const dz=document.getElementById('drop-zone').getBoundingClientRect();
  const rows=[...document.querySelectorAll('#file-list > li')].map(li=>{const r=li.getBoundingClientRect();return {cls:li.className,top:r.top,height:r.height,text:(li.querySelector('.item-title,.section-header')||li).textContent.slice(0,40)}});
  return {dz:{top:dz.top,bottom:dz.bottom,left:dz.left,right:dz.right},rows};
})()`);
let DZB = 600;
const shotTo = async (file, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...clip, scale: 1 } }); writeFileSync(file, Buffer.from(r.data, 'base64')); };
const manifest = {};
for (const [key, P] of Object.entries(PERSONAS)) {
  const dir = path.join(OUT, key); mkdirSync(dir, { recursive: true });
  await open('darwin', '自分のMac');
  await ev(`window.__emit('restore-items', ${JSON.stringify(P.items.map(toSaved))}); window.__emit('shelter-expanded',{focus:false});`); await sleep(1300);
  if (P.newItem) {
    await ev(`window.__emit('clipboard-item', ${JSON.stringify({ type: 'clipboard-text', text: P.newItem.text, timestamp: tsOf(P.newItem), sourceApp: app(P.newItem.a) })})`); await sleep(1300);
  } else if (P.newFile) {
    await ev(`Date.now = () => ${tsOf(P.newFile)}; window.__emit('add-file', ${JSON.stringify({ path: D(P.newFile.name), name: P.newFile.name, timestamp: tsOf(P.newFile) })})`); await sleep(1500);
  }
  const g = await listGeom(); DZB = g.dz.bottom;
  const M = manifest[key] = { dz: g.dz, rows: g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text })), hasNew: !!(P.newItem || P.newFile) };
  for (let i = 0; i < g.rows.length; i++) {
    const r = g.rows[i];
    if (r.top < g.dz.top - 5 || r.top >= g.dz.bottom - 4) { M.rows[i].skipped = true; continue; }
    const y = Math.max(0, r.top - 2);
    await shotTo(path.join(dir, `row${i}.png`), { x: 0, y, width: 320, height: Math.max(4, Math.min(DZB - y, r.height + 4)) });
  }
  await ev(`document.getElementById('file-list').style.setProperty('visibility','hidden')`); await sleep(300);
  await shotTo(path.join(dir, 'chrome.png'), { x: 0, y: 0, width: 320, height: 600 });
  console.log('done', key, M.rows.length, 'rows');
}
writeFileSync(path.join(OUT, 'manifest.js'), 'window.PMAN=' + JSON.stringify(manifest) + ';');

// エンジニア章のポップアップ (⌥⌘V): 「ssh」を 1 文字ずつ入力
{
  const dir = path.join(OUT, 'popup'); mkdirSync(dir, { recursive: true });
  const pitems = PERSONAS.engineer.items.map((d) => { const s = toSaved(d); return d.k === 'file' ? { kind: 'file', path: s.path, name: s.name, timestamp: s.timestamp } : { kind: 'clip-text', text: s.text, timestamp: s.timestamp, sourceApp: s.sourceApp }; });
  await open('darwin', '自分のMac', 'popup.html', [300, 380]);
  await ev(`window.__emit('popup-items', ${JSON.stringify({ items: pitems })})`); await sleep(1300);
  const shot = (n) => shotTo(path.join(dir, n + '.png'), { x: 0, y: 0, width: 300, height: 380 });
  await shot('q0');
  const q = 'ssh';
  for (let i = 1; i <= q.length; i++) {
    await ev(`(()=>{const e=document.getElementById('popup-search'); e.value=${JSON.stringify(q.slice(0, i))}; e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(450);
    await shot('q' + i);
  }
  console.log('popup done');
}
process.exit(0);
