// 「その場でペースト」ポップアップ (popup.html) の実 UI を撮る。plates/popup/sel0.png, sel1.png (300x380, 透明背景)
import { open, send, ev, sleep, APP, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const icon = (n) => 'file://' + path.join(DIR, 'appicons', n + '.png');
const D = (n) => path.join(APP, 'assets/demo', n);
const MIN = 60000, HOUR = 3600000, now = Date.now();
const items = [
  { kind: 'clip-text', text: '明日14時、会議室Bでキックオフ', timestamp: now - .2 * MIN, sourceApp: { name: 'Notion', icon: icon('Notion') } },
  { kind: 'clip-text', text: 'https://github.com/example-team/ec-renewal/pull/42', timestamp: now - 8 * MIN, sourceApp: { name: 'Chrome', icon: icon('Chrome') } },
  { kind: 'clip-text', text: '本日17時までにデザイン差し戻しをお願いします🙏', timestamp: now - 35 * MIN, sourceApp: { name: 'Slack', icon: icon('Slack') } },
  { kind: 'file', path: D('見積書_ECサイト改修_v2.pdf'), name: '見積書_ECサイト改修_v2.pdf', timestamp: now - 40 * MIN },
  { kind: 'clip-text', text: '在庫アラートのしきい値を10→15に変更してもらえますか？', timestamp: now - 80 * MIN, sourceApp: { name: 'Slack', icon: icon('Slack') } },
  { kind: 'clip-image', path: D('clipboard_2026-09-14_15-40-00.png'), name: 'clipboard_2026-09-14_15-40-00.png', timestamp: now - 3 * HOUR },
  { kind: 'file', path: D('検収書_9月分.pdf'), name: '検収書_9月分.pdf', timestamp: now - 5 * HOUR },
];
const OUT = path.join(DIR, 'plates', 'popup'); mkdirSync(OUT, { recursive: true });
await open('darwin', '自宅iMac', 'popup.html', [300, 380]);
await ev(`window.__emit('popup-items', ${JSON.stringify({ items })})`); await sleep(1300);
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 300, height: 380, scale: 1 } }); writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')); console.log('saved', n); };
await shot('sel0');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`); await sleep(400);
await shot('sel1');
process.exit(0);
