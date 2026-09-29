// 「その場でペースト」ポップアップ (popup.html) の実 UI を撮る。plates/popup/sel0.png, sel1.png (300x380, 透明背景)
import { open, send, ev, sleep, APP, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const icon = (n) => 'file://' + path.join(DIR, 'appicons', n + '.png');
const D = (n) => path.join(APP, 'assets/demo', n);
const MIN = 60000, HOUR = 3600000, now = (() => { const d = new Date(); d.setHours(13, 26, 0, 0); return d.getTime(); })();
const ic = (n) => ({ name: n, icon: icon(n) });
const T_ = (text, ago, app) => ({ kind: 'clip-text', text, timestamp: now - ago, sourceApp: ic(app) });
const F_ = (name, ago) => ({ kind: 'file', path: D(name), name, timestamp: now - ago });
const I_ = (name, ago) => ({ kind: 'clip-image', path: D(name), name, timestamp: now - ago });
const items = [
  T_('次回定例は10/15(木) 14:00', .2 * MIN, 'Notion'),
  T_('https://github.com/example-team/ec-renewal/pull/42', 8 * MIN, 'Chrome'),
  T_('レビュー観点：決済まわりの分岐だけ見てください', 20 * MIN, 'Notion'),
  T_('本日17時までにデザイン差し戻しをお願いします🙏', 35 * MIN, 'Slack'),
  F_('見積書_ECサイト改修_v2.pdf', 40 * MIN),
  T_('在庫アラートのしきい値を10→15に変更してもらえますか？', 80 * MIN, 'Slack'),
  I_('clipboard_2026-09-14_15-40-00.png', 3 * HOUR),
  F_('検収書_9月分.pdf', 4 * HOUR),
  F_('ロゴ差分_v3.png', 5 * HOUR),
  T_('ssh deploy@192.168.1.42 -p 2222', 6 * HOUR, 'Terminal'),
  F_('議事録_1010_定例MTG.txt', 7 * HOUR),
  T_('会議室Bを10:00〜11:00で予約しました。', 8 * HOUR, 'Notion'),
  F_('契約書_業務委託.docx', 9 * HOUR),
  T_('npm run build && npm run deploy', 10 * HOUR, 'Terminal'),
];
const OUT = path.join(DIR, 'plates', 'popup'); mkdirSync(OUT, { recursive: true });
await open('darwin', '自宅iMac', 'popup.html', [300, 380]);
await ev(`window.__emit('popup-items', ${JSON.stringify({ items })})`); await sleep(1300);
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 300, height: 380, scale: 1 } }); writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')); console.log('saved', n); };
await shot('sel0');
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))`); await sleep(400);
await shot('sel1');
// 検索: 「レビュー」を 1 文字ずつ入力 (実際の絞り込み)
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}))`); await sleep(300);
await shot('q0');
const q = 'レビュー';
for (let i = 1; i <= q.length; i++) {
  await ev(`(()=>{const e=document.getElementById('popup-search'); e.value=${JSON.stringify(q.slice(0, i))}; e.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(450);
  await shot('q' + i);
}
process.exit(0);
