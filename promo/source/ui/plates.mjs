// 3 台 (自分のMac / 自宅iMac / 会社用PC) それぞれの視点で、実 UI の「部品」を撮る。
//   plates/<dev>/chrome.png      … 検索欄・セグメント・フッター (リスト非表示)
//   plates/<dev>/row-<id>.png    … リストの 1 行 (透明背景, 幅 320)
//   plates/manifest.json         … 各部品の論理座標
import { open, send, ev, sleep, APP, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const D = (n) => path.join(APP, 'assets/demo', n);
const icon = (n) => 'file://' + path.join(DIR, 'appicons', n + '.png');
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const APPS = ['Excel', 'Notion', 'Figma', 'Pages', 'Numbers', 'Chrome', 'Slack', 'Terminal', 'Word', 'Outlook', 'Teams', 'PowerPoint'];
const appMap = Object.fromEntries(APPS.map((n) => [n, { name: n, icon: icon(n) }]));

const DEVS = {
  mac: { me: '自分のMac', platform: 'darwin', skin: 'darwin' },
  imac: { me: '自宅iMac', platform: 'darwin', skin: 'darwin' },
  win: { me: '会社用PC', platform: 'win32', skin: 'win32' },
};
const NEW_TEXT = '明日14時、会議室Bでキックオフ';
const OWNER = { mac: '自分のMac', imac: '自宅iMac', win: '会社用PC' };
const PLAT = { '自分のMac': 'darwin', '自宅iMac': 'darwin', '会社用PC': 'win32' };
// id, kind, payload, origin device name, ago, app
const DATA = [
  { id: 'new', k: 'text', text: NEW_TEXT, o: '自分のMac', ago: 0.2 * MIN, app: 'Notion' },
  { id: 't1', k: 'text', text: 'https://github.com/example-team/ec-renewal/pull/42', o: '自分のMac', ago: 8 * MIN, app: 'Chrome' },
  { id: 't2', k: 'text', text: '本日17時までにデザイン差し戻しをお願いします🙏', o: '自宅iMac', ago: 35 * MIN, app: 'Slack' },
  { id: 'f1', k: 'file', name: '見積書_ECサイト改修_v2.pdf', o: '会社用PC', ago: 40 * MIN, app: 'Excel' },
  { id: 't3', k: 'text', text: '在庫アラートのしきい値を10→15に変更してもらえますか？', o: '会社用PC', ago: 80 * MIN, app: 'Slack' },
  { id: 'i1', k: 'image', name: 'clipboard_2026-09-14_15-40-00.png', o: '会社用PC', ago: 3 * HOUR, app: 'Excel' },
  { id: 'f2', k: 'file', name: '検収書_9月分.pdf', o: '自宅iMac', ago: 5 * HOUR, app: 'Pages' },
  { id: 'f3', k: 'file', name: 'ロゴ差分_v3.png', o: '会社用PC', ago: 7 * HOUR, app: 'Figma' },
  { id: 't4', k: 'text', text: 'ssh deploy@192.168.1.42 -p 2222', o: '会社用PC', ago: 9 * HOUR, app: 'Terminal' },
];

const OUT = path.join(DIR, 'plates'); mkdirSync(OUT, { recursive: true });
const manifest = {};

async function emitAll(devKey, upTo) {
  const dev = DEVS[devKey], now = Date.now();
  const items = DATA.filter((d) => !upTo || upTo.includes(d.id));
  const saved = items.filter((d) => d.id !== 'new').map((d) => {
    const remote = d.o !== dev.me;
    const base = { timestamp: now - d.ago, sourceApp: { name: d.app, icon: icon(d.app) }, fromDevice: remote ? d.o : null, fromPlatform: remote ? PLAT[d.o] : null };
    if (d.k === 'file') return { kind: 'file', path: D(d.name), name: d.name, ...base };
    if (d.k === 'image') return { kind: 'clip-image', path: D(d.name), name: d.name, isImage: true, ...base };
    return { kind: 'clip-text', text: d.text, name: d.text.replace(/\s+/g, ' '), ...base };
  });
  const nw = items.find((d) => d.id === 'new');
  await ev(`window.__emit('restore-items', ${JSON.stringify(saved)}); window.__emit('shelter-expanded',{focus:false});`);
  await sleep(1300);
  if (nw) {
    const remote = nw.o !== dev.me;
    await ev(`window.__emit('clipboard-item', ${JSON.stringify({ type: 'clipboard-text', text: nw.text, timestamp: now - nw.ago, sourceApp: { name: nw.app, icon: icon(nw.app) }, ...(remote ? { fromDevice: nw.o, fromPlatform: PLAT[nw.o] } : {}) })})`);
    await sleep(1300);
  }
}
let DZB = 600; // リスト領域の下端 (これより下のフッター等は行の部品に含めない)
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

for (const [key, dev] of Object.entries(DEVS)) {
  const dir = path.join(OUT, key); mkdirSync(dir, { recursive: true });
  await open(dev.skin, dev.me);
  await emitAll(key);
  const M = manifest[key] = { me: dev.me };
  // 1) 行
  const g = await listGeom(); DZB = g.dz.bottom; M.dz = g.dz; M.rows = g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text }));
  for (let i = 0; i < g.rows.length; i++) {
    const r = g.rows[i];
    if (r.top < g.dz.top - 5 || r.top >= g.dz.bottom - 4) { M.rows[i].skipped = true; continue; }
    await shotTo(path.join(dir, `row${i}.png`), clipOf(r));
  }
  // 2) 先頭アイテム (new) の状態違い: selected / copied
  const idx = g.rows.findIndex((r) => /file-item/.test(r.cls));
  for (const st of ['selected', 'copied']) {
    await ev(`(()=>{const it=items.find(x=>x.text===${JSON.stringify(NEW_TEXT)}); const li=itemElements.get(it);
      li.classList.remove('selected','copied','has-copied'); li.querySelectorAll('.copied-mark').forEach(m=>m.remove());
      if('${st}'==='selected'){ li.classList.add('selected'); } else { li.classList.remove('selected'); showCopiedFeedback(it); } })()`);
    await sleep(st === 'copied' ? 160 : 600);
    await shotTo(path.join(dir, `new-${st}.png`), clipOf(g.rows[idx]));
  }
  await ev(`(()=>{const li=itemElements.get(items.find(x=>x.text===${JSON.stringify(NEW_TEXT)})); li.classList.remove('selected','copied'); li.querySelectorAll('.copied-mark').forEach(m=>m.remove());})()`);
  // 3) chrome (リスト非表示)
  await ev(`document.getElementById('file-list').style.setProperty('visibility','hidden')`);
  await sleep(300);
  await shotTo(path.join(dir, 'chrome.png'), { x: 0, y: 0, width: 320, height: 600 });
  console.log('done', key);
}
// 4) Mac 視点: デバイス絞り込み (会社用PC) と 同期中プレースホルダ
{
  await open('darwin', '自分のMac');
  await emitAll('mac');
  const dir = path.join(OUT, 'mac');
  await ev(`setDeviceFilter('会社用PC'); render();`); await sleep(900);
  const g = await listGeom(); DZB = g.dz.bottom; manifest.mac.filter = { rows: g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text })) };
  await ev(`document.getElementById('file-list').style.setProperty('visibility','hidden')`); await sleep(300);
  await send('Page.captureScreenshot', { format: 'png' }).then((r) => writeFileSync(path.join(dir, 'chrome-filter.png'), Buffer.from(r.data, 'base64')));
  await ev(`document.getElementById('file-list').style.removeProperty('visibility')`);
  // 絞り込み中の各行 (通常の行と同じ見た目だが並びと section が変わる)
  for (let i = 0; i < g.rows.length; i++) { const r = g.rows[i]; if (r.top < g.dz.top - 5 || r.top >= g.dz.bottom - 4) continue; await shotTo(path.join(dir, `frow${i}.png`), clipOf(r)); }
  console.log('filter done');
}
{
  await open('darwin', '自分のMac');
  await emitAll('mac', ['t1', 't2']);
  const dir = path.join(OUT, 'mac'); const P = [];
  await ev(`window.__emit('sync-pending',{syncId:'s1',kind:'file',name:'見積書_ECサイト改修_v3.pdf',timestamp:Date.now(),fromDevice:'会社用PC',fromPlatform:'win32',originKind:null})`); await sleep(700);
  const total = 2.4 * 1024 * 1024;
  for (let i = 0; i <= 10; i++) {
    await ev(`window.__emit('sync-progress',{syncId:'s1',received:${total * i / 10},total:${total}})`); await sleep(500);
    const g = await listGeom(); DZB = g.dz.bottom; const ri = g.rows.findIndex((r) => /syncing|downloading/.test(r.cls));
    if (ri < 0) { console.log('no syncing row at', i, JSON.stringify(g.rows.map((r) => r.cls))); continue; }
    if (i === 0) manifest.mac.sync = { rows: g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text })), idx: ri };
    await shotTo(path.join(dir, `sync${i}.png`), clipOf(g.rows[ri]));
  }
  // 完了 → 実体に置き換わる
  await ev(`window.__emit('sync-pending-remove',{syncId:'s1'}); window.__emit('add-file',{path:${JSON.stringify(D('見積書_ECサイト改修_v2.pdf'))},name:'見積書_ECサイト改修_v3.pdf',timestamp:Date.now(),syncId:'s1',fromDevice:'会社用PC',fromPlatform:'win32',sourceApp:${JSON.stringify(appMap.Excel)}})`); await sleep(1300);
  const g = await listGeom(); DZB = g.dz.bottom; const ri = g.rows.findIndex((r) => /file-item/.test(r.cls));
  await shotTo(path.join(dir, 'sync-done.png'), clipOf(g.rows[ri]));
  manifest.mac.syncDone = { rows: g.rows.map((r) => ({ cls: r.cls, top: r.top, height: r.height, text: r.text })), idx: ri };
  console.log('sync done');
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(path.join(OUT, 'manifest.js'), 'window.MANIFEST=' + JSON.stringify(manifest) + ';');
process.exit(0);
