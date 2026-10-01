// 「コピーしたら、もう、届いている。」クリップ用: 実 UI の部品を撮る (SCHEME=light node deliver-plates.mjs)
//   plates-deliver/win/…  … 受信側 (Windows): 最終状態 (届いた 5 件が先頭に並ぶ) の行 + 大きなファイルの受信中フレーム
//   plates-deliver/mac/…  … 送信側 (Mac): ドロップの前 (over) / 後 (after) のパネル全体
import { open, send, ev, sleep, APP, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
const D = (n) => path.join(APP, 'assets/demo', n);
const icon = (n) => 'file://' + path.join(DIR, 'appicons', n + '.png');
const MIN = 60000, HOUR = 3600000;
const BASE = (() => { const d = new Date(); d.setHours(13, 26, 0, 0); return d.getTime(); })();
const mid = new Date(); mid.setHours(0, 0, 0, 0);
const dataUrl = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');
const FOLDER_ICON = { darwin: dataUrl(path.join(APP, 'site/icons/folder.png')), win32: dataUrl(path.join(APP, 'site/icons/folder-win.png')) };
const ME = '自分のMac', OTHER = '会社用PC';
const OUT = path.join(DIR, 'plates-deliver'); mkdirSync(OUT, { recursive: true });
const manifest = {};

// ---- 履歴のもとになる項目 (plates.mjs と同じ。新しく入る項目は含めない) ----
const DATA = [
  { id: 't1', k: 'text', text: 'https://github.com/example-team/ec-renewal/pull/42', o: ME, ago: 8 * MIN, app: 'Chrome' },
  { id: 't2', k: 'text', text: '本日17時までにデザイン差し戻しをお願いします🙏', o: '自宅iMac', ago: 35 * MIN, app: 'Slack' },
  { id: 'f1', k: 'file', name: '見積書_ECサイト改修_v2.pdf', o: OTHER, ago: 40 * MIN, app: 'Excel' },
  { id: 't3', k: 'text', text: '在庫アラートのしきい値を10→15に変更してもらえますか？', o: OTHER, ago: 80 * MIN, app: 'Slack' },
  { id: 'i1', k: 'image', name: 'clipboard_2026-09-14_15-40-00.png', o: OTHER, ago: 3 * HOUR, app: 'Excel' },
  { id: 'f2', k: 'file', name: '検収書_9月分.pdf', o: '自宅iMac', ago: 4 * HOUR, app: 'Pages' },
  { id: 'f3', k: 'file', name: 'ロゴ差分_v3.png', o: OTHER, ago: 5 * HOUR, app: 'Figma' },
  { id: 't4', k: 'text', text: 'ssh deploy@192.168.1.42 -p 2222', o: OTHER, ago: 6 * HOUR, app: 'Terminal' },
  { id: 'f4', k: 'file', name: '議事録_1010_定例MTG.txt', o: ME, ago: 7 * HOUR, app: 'Notion' },
  { id: 't5', k: 'text', text: '会議室Bを10:00〜11:00で予約しました。プロジェクターの予約も忘れずに。', o: ME, ago: 8 * HOUR, app: 'Notion' },
  { id: 'f5', k: 'file', name: '契約書_業務委託.docx', o: '自宅iMac', ago: 9 * HOUR, app: 'Word' },
  { id: 't6', k: 'text', text: 'npm run build && npm run deploy', o: ME, ago: 10 * HOUR, app: 'Terminal' },
  { id: 'f6', k: 'file', name: '経費精算_9月.xlsx', o: OTHER, y: 2 * HOUR, app: 'Excel' },
  { id: 'i2', k: 'image', name: 'clipboard_2026-09-13_11-05-00.png', o: '自宅iMac', y: 4 * HOUR, app: 'Chrome' },
  { id: 't7', k: 'text', text: 'https://www.figma.com/file/abcd1234/EC-Renewal', o: ME, y: 6 * HOUR, app: 'Chrome' },
  { id: 'f7', k: 'file', name: '納品リスト_10月.xlsx', o: '自宅iMac', y: 8 * HOUR, app: 'Excel' },
];
// ---- Mac から送る 5 件 (古い順)。受信側では「自分のMac」から届いた項目になる ----
const ARR = [
  { id: 'a1', k: 'text', text: '次回定例は10/15(木) 14:00', app: 'Notion', ago: 50000 },
  { id: 'a2', k: 'image', path: D('KPIダッシュボード.png'), name: 'clipboard_2026-09-30_13-25-20.png', app: 'Excel', ago: 40000 },
  { id: 'a3', k: 'file', path: D('提案資料_リニューアル方針.pptx'), name: '提案資料_リニューアル方針.pptx', ago: 30000 },
  { id: 'a4', k: 'file', path: '/Users/demo/プロジェクト資料', name: 'プロジェクト資料', folder: true, ago: 20000 },
  { id: 'a5', k: 'file', path: '/Users/demo/デモ撮影_素材.mov', name: 'デモ撮影_素材.mov', ago: 10000 },
];
const PLAT = { [ME]: 'darwin', [OTHER]: 'win32', '自宅iMac': 'darwin' };
const tsOf = (d) => d.y != null ? mid.getTime() - d.y : BASE - d.ago;

const itemOf = (d, dev) => {   // dev: 'mac' | 'win' (見ている側)
  const win = dev === 'win', me = win ? OTHER : ME;
  const remote = d.o !== undefined ? d.o !== me : win;   // 新しい 5 件は常に「自分のMac」出身
  const from = d.o !== undefined ? d.o : ME;
  const base = { timestamp: tsOf(d), sourceApp: win || !d.app || d.k === 'file' && d.id.startsWith('a') ? null : { name: d.app, icon: icon(d.app) }, fromDevice: remote ? from : null, fromPlatform: remote ? PLAT[from] : null };
  if (d.k === 'file') return { kind: 'file', path: d.path || D(d.name), name: d.name, ...(d.folder ? { originKind: 'folder' } : {}), ...base };
  if (d.k === 'image') return { kind: 'clip-image', path: d.path || D(d.name), name: d.name, isImage: true, ...base };
  return { kind: 'clip-text', text: d.text, name: d.text.replace(/\s+/g, ' '), ...base };
};

// ページ内のモックを上書き: フォルダ / 動画ファイルのアイコンと種類名
const patch = (platform) => `(()=>{
  const FI=${JSON.stringify(FOLDER_ICON[platform])}, orig=window.bridge.getFileIcon, origK=window.bridge.getFileKind;
  const isFolder=(p)=>!/\\.[A-Za-z0-9]{1,5}$/.test(String(p));
  window.bridge.getFileIcon=async(p)=>isFolder(p)?FI:orig(p);
  window.bridge.getFileKind=async(p)=>isFolder(p)?${JSON.stringify(platform === 'win32' ? 'ファイル フォルダー' : 'フォルダ')}:/\\.mov$/i.test(p)?${JSON.stringify(platform === 'win32' ? 'MOV ファイル' : 'QuickTime ムービー')}:origK(p);
  window.resetSelectionAndFocus=()=>{};
})()`;

let DZB = 600;
const clipOf = (r) => { const y = Math.max(0, r.top - 2); return { x: 0, y, width: 320, height: Math.max(4, Math.min(DZB - y, r.height + 4)) }; };
async function shotTo(file, clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { ...clip, scale: 1 } });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
}
const listGeom = () => ev(`(()=>{
  const dz=document.getElementById('drop-zone').getBoundingClientRect();
  const rows=[...document.querySelectorAll('#file-list > li')].map(li=>{const r=li.getBoundingClientRect();return {cls:li.className,top:r.top,height:r.height,text:(li.querySelector('.item-title,.section-header')||li).textContent.slice(0,40)}});
  return {dz:{top:dz.top,bottom:dz.bottom,left:dz.left,right:dz.right},rows};
})()`);
async function restore(dev, arrCount) {
  const platform = dev === 'win' ? 'win32' : 'darwin';
  const items = [...DATA, ...ARR.slice(0, arrCount)].map((d) => itemOf(d, dev));
  await ev(patch(platform));
  await ev(`window.__emit('restore-items', ${JSON.stringify(items)}); window.__emit('shelter-expanded',{focus:false});`);
  await sleep(1500);
}

// ================= 受信側 (Windows) =================
{
  const dir = path.join(OUT, 'win'); mkdirSync(dir, { recursive: true });
  // 1) 枠 (chrome) とリスト領域は 320x600 で撮る
  await open('win32', OTHER);
  await restore('win', 5);
  const g0 = await listGeom();
  const M = manifest.win = { dz: g0.dz, rows: [] };
  await ev(`document.getElementById('file-list').style.setProperty('visibility','hidden')`); await sleep(300);
  await shotTo(path.join(dir, 'chrome.png'), { x: 0, y: 0, width: 320, height: 600 });
  // 2) 行は縦に長い画面で撮る (届く前は、いまは見えない下の行が見えているため。どの状態でも使えるよう全部撮る)
  await open('win32', OTHER, 'index.html', [320, 2000]);
  await restore('win', 5);
  const g = await listGeom(); DZB = g.dz.bottom;
  M.rows = g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text }));
  for (let i = 0; i < g.rows.length; i++) await shotTo(path.join(dir, `row${i}.png`), clipOf(g.rows[i]));
  console.log('win rows done', g.rows.length, 'dz', JSON.stringify(M.dz));
}
// 大きなファイルの受信中 (a5 だけが「同期中」。スピナーは動画側で回すので、行からは消して位置と色だけ測る)
{
  const dir = path.join(OUT, 'win');
  await open('win32', OTHER);
  await restore('win', 4);
  await ev(`(()=>{const s=document.createElement('style'); s.textContent='.spinner{visibility:hidden !important}'; document.head.appendChild(s);})()`);
  const a5 = ARR[4], total = 420 * 1048576;
  await ev(`window.__emit('sync-pending',{syncId:'s5',kind:'file',name:${JSON.stringify(a5.name)},timestamp:${tsOf(a5)},fromDevice:${JSON.stringify(ME)},fromPlatform:'darwin',originKind:null})`); await sleep(900);
  for (let i = 0; i <= 10; i++) {
    await ev(`window.__emit('sync-progress',{syncId:'s5',received:${Math.round(total * i / 10)},total:${total}})`); await sleep(520);
    const g = await listGeom(); DZB = g.dz.bottom; const ri = g.rows.findIndex((r) => /syncing/.test(r.cls));
    if (ri < 0) { console.log('no syncing row at', i); continue; }
    if (i === 0) {
      const sp = await ev(`(()=>{const li=document.querySelector('#file-list > li.syncing'); const s=li.querySelector('.spinner'); s.style.visibility='visible'; const r=s.getBoundingClientRect(), c=getComputedStyle(s), lr=li.getBoundingClientRect(); const o={x:r.left,y:r.top-(lr.top-2),w:r.width,h:r.height,border:c.borderTopWidth,track:c.borderLeftColor,head:c.borderTopColor}; s.style.visibility=''; return o;})()`);
      manifest.win.sync = { rows: g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text })), idx: ri, spinner: sp };
    }
    await shotTo(path.join(dir, `sync${i}.png`), clipOf(g.rows[ri]));
  }
  console.log('win sync done', JSON.stringify(manifest.win.sync.spinner));
}

// ================= 送信側 (Mac): ドロップ前 (over) / 後 (after) のパネル全体 =================
{
  const dir = path.join(OUT, 'mac'); mkdirSync(dir, { recursive: true });
  const full = (n) => shotTo(path.join(dir, n + '.png'), { x: 0, y: 0, width: 320, height: 600 });
  // k 件目 (3, 4, 5 件目) をドロップする: 前 = 直前までの a1..a(k-1) + over、後 = a1..ak
  for (const k of [3, 4, 5]) {
    await open('darwin', ME);
    await restore('mac', k - 1);
    await ev(`document.body.classList.add('drag-mode')`); await sleep(450);
    await full(`over${k}`);
    await ev(`document.body.classList.remove('drag-mode')`); await sleep(300);
    await open('darwin', ME);
    await restore('mac', k);
    await full(`after${k}`);
    console.log('mac', k);
  }
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(path.join(OUT, 'manifest.js'), 'window.MANIFEST=' + JSON.stringify(manifest) + ';');
process.exit(0);
