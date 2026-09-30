// 「はじめかた」1 章の締め: 初回起動 (履歴が空) のパネルを撮る。SCHEME=light node empty-plates.mjs → plates-light/settings/empty-{mac,win}.png
import { open, send, ev, sleep, DIR } from './harness.mjs';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
for (const [plat, key, me] of [['darwin', 'mac', '自分のMac'], ['win32', 'win', '会社用PC']]) {
  await open(plat, me);
  await ev(`window.__emit('sync-status', {peers:[],onlineCount:0}); window.__emit('restore-items', []); window.__emit('shelter-expanded',{focus:false});`); await sleep(1200);
  await ev(`document.activeElement&&document.activeElement.blur()`); await sleep(200);
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 320, height: 600, scale: 1 } });
  writeFileSync(path.join(DIR, 'plates-light', 'settings', `empty-${key}.png`), Buffer.from(r.data, 'base64')); console.log('saved', key);
}
process.exit(0);
