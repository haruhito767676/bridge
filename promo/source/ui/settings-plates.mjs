// 「はじめかた」用: 実アプリの設定画面 (案A) を、状態ごとに撮る。SCHEME=light node settings-plates.mjs → plates-light/settings/
import { open, send, ev, sleep, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const OUT = path.join(DIR, 'plates-light', 'settings'); mkdirSync(OUT, { recursive: true });
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 320, height: 600, scale: 1 } }); writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')); console.log('saved', n); };
const WINKEY = '5d0b81c47e2a96f3b0c8e1d7a4f52963c8e0b17d4a9f6235e8c1b70d2a4f9e38';
const KEY = 'a3f9c2e17b48d0562e9ca41f7d83b60c5e12f8a9047bd63c1e5a7f20984d3b6c';
for (const [plat, key, me, other] of [['darwin', 'mac', '自分のMac', '会社用PC'], ['win32', 'win', '会社用PC', '自分のMac']]) {
  await open(plat, me);
  const H = key === 'mac' ? ['⌥Space', 'Alt+Space', '⌥⌘V', 'Alt+CommandOrControl+V'] : ['Ctrl+Shift+Space', 'Ctrl+Shift+Space', 'Ctrl+Alt+Shift+V', 'Control+Alt+Shift+V'];
  await ev(`(()=>{const st=document.createElement('style');st.textContent='#handle{display:none!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}';document.head.appendChild(st);
    window.bridge.saveSettings=async()=>({ok:true});window.bridge.getSettings=async()=>({deviceName:${JSON.stringify(me)},secretToken:${JSON.stringify(key === 'mac' ? KEY : WINKEY)},autoScan:true,peers:[],openAtLogin:true,autoPaste:false,showSourceApp:true,version:'1.0.0',
      hotkeyLabel:${JSON.stringify(H[0])},toggleShortcut:${JSON.stringify(H[1])},defaultToggleShortcut:${JSON.stringify(H[1])},defaultToggleShortcutLabel:${JSON.stringify(H[0])},
      pasteHotkeyLabel:${JSON.stringify(H[2])},pasteShortcut:${JSON.stringify(H[3])},defaultPasteShortcut:${JSON.stringify(H[3])},defaultPasteShortcutLabel:${JSON.stringify(H[2])}});})()`);
  await ev(`window.__emit('sync-status', {peers:[],onlineCount:0})`); await sleep(300);
  await ev(`window.__emit('shelter-expanded',{focus:false}); window.__emit('open-settings')`); await sleep(1000);
  await ev(`(()=>{const k=document.getElementById('setting-token');k.value=${JSON.stringify(key === 'mac' ? KEY : WINKEY)};document.getElementById('setting-device-name').value=${JSON.stringify(me)};})()`); await sleep(300);
  await ev(`document.activeElement&&document.activeElement.blur();getSelection().removeAllRanges()`); await sleep(200);
  await shot(`${key}-off`);
  if (key === 'mac') {
    await ev(`document.getElementById('setting-token-copy').click()`); await sleep(450); await shot('mac-copied'); await sleep(2200);
  } else {
    await ev(`navigator.clipboard.readText=async()=>${JSON.stringify(KEY)}`);
    await ev(`document.getElementById('setting-token-paste').click()`); await ev(`document.activeElement&&document.activeElement.blur();getSelection().removeAllRanges()`); await sleep(400); await shot('win-pasted'); await sleep(2200);
  }
  await ev(`window.__emit('sync-status', {peers:[{device:${JSON.stringify(other)},host:'192.168.1.21',online:true,enabled:true}],onlineCount:1})`); await sleep(500);
  await shot(`${key}-on`);
}
process.exit(0);
