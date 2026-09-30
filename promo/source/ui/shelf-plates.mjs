// 「ファイルの一時置き場」クリップ用: パネルの 3 状態を実 UI で撮る。
//   plates/shelf/before.png … 履歴だけ (Mac 自身のもの)
//   plates/shelf/over.png   … ファイルをドラッグして重ねた状態 (body.drag-mode: 枠がアクセント色で光る)
//   plates/shelf/after.png  … ドロップされて、先頭に 2 件のファイルが入った状態
import { open, send, ev, sleep, APP, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const D = (n) => path.join(APP, 'assets/demo', n);
const icon = (n) => 'file://' + path.join(DIR, 'appicons', n + '.png');
const MIN = 60000, HOUR = 3600000;
const BASE = (() => { const d = new Date(); d.setHours(13, 26, 0, 0); return d.getTime(); })();
const mid = new Date(); mid.setHours(0, 0, 0, 0);
const T_ = (text, ago, app) => ({ kind: 'clip-text', text, name: text, timestamp: BASE - ago, sourceApp: { name: app, icon: icon(app) }, fromDevice: null, fromPlatform: null });
const F_ = (name, ago, app) => ({ kind: 'file', path: D(name), name, timestamp: BASE - ago, sourceApp: { name: app, icon: icon(app) }, fromDevice: null, fromPlatform: null });
const Y_ = (it, y) => ({ ...it, timestamp: mid.getTime() - y });
const saved = [
  T_('https://github.com/example-team/ec-renewal/pull/42', 8 * MIN, 'Chrome'),
  F_('議事録_1010_定例MTG.txt', 7 * HOUR, 'Notion'),
  T_('会議室Bを10:00〜11:00で予約しました。プロジェクターの予約も忘れずに。', 8 * HOUR, 'Notion'),
  T_('npm run build && npm run deploy', 10 * HOUR, 'Terminal'),
  Y_(T_('https://www.figma.com/file/abcd1234/EC-Renewal', 0, 'Chrome'), 6 * HOUR),
  Y_(F_('進行スケジュール.csv', 0, 'Numbers'), 12 * HOUR),
];
const dropped = [
  { path: D('提案資料_リニューアル方針.pptx'), name: '提案資料_リニューアル方針.pptx', timestamp: BASE - 15000 },
  { path: D('画面遷移図.png'), name: '画面遷移図.png', timestamp: BASE - 14000 },
];
const OUT = path.join(DIR, 'plates', 'shelf'); mkdirSync(OUT, { recursive: true });
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 320, height: 600, scale: 1 } }); writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')); console.log('saved', n); };

await open('darwin', '自分のMac');
await ev(`window.__emit('restore-items', ${JSON.stringify(saved)}); window.__emit('shelter-expanded',{focus:false});`); await sleep(1400);
await shot('before');
await ev(`document.body.classList.add('drag-mode')`); await sleep(400);
await shot('over');
await ev(`document.body.classList.remove('drag-mode')`); await sleep(300);
for (const [i, f] of dropped.entries()) { await ev(`Date.now = () => ${BASE - 15000 + i * 1000}; window.__emit('add-file', ${JSON.stringify(f)})`); await sleep(400); }
await sleep(1200);
await shot('after');
process.exit(0);
