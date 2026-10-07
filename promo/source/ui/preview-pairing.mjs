// ペアリングの画面を、状態ごとに 1 枚の画像へ並べる (実機が手元にないときの見た目の確認用)
//   PLAT=win32|darwin SCHEME=light|dark OUTFILE=/path.png node preview-pairing.mjs
import { open, send, ev, sleep } from './harness.mjs';
import { writeFileSync } from 'node:fs';
const plat = process.env.PLAT || 'win32', me = plat === 'win32' ? '会社用PC' : '自分のMac', other = plat === 'win32' ? '自分のMac' : '会社用PC';
const dir = process.env.OUTDIR;
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 320, height: 600, scale: 1 } }); writeFileSync(`${dir}/${n}.png`, Buffer.from(r.data, 'base64')); };
const click = (sel, text) => ev(text ? `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()` : `document.querySelector(${JSON.stringify(sel)}).click()`);
const emit = (st) => ev(`window.__emit('pair-state',${JSON.stringify(st)})`);
await open(plat, me);
await ev(`(()=>{const st=document.createElement('style');st.textContent='#handle{display:none!important}';document.head.appendChild(st);
  window.bridge.getSettings=async()=>({deviceName:${JSON.stringify(me)},secretToken:'x'.repeat(64),autoScan:true,peers:[],openAtLogin:true,autoPaste:false,showSourceApp:true,version:'2.1.0',hotkeyLabel:'Ctrl+Shift+Space',toggleShortcut:'Ctrl+Shift+Space',defaultToggleShortcut:'Ctrl+Shift+Space',defaultToggleShortcutLabel:'Ctrl+Shift+Space',pasteHotkeyLabel:'Ctrl+Alt+Shift+V',pasteShortcut:'Control+Alt+Shift+V',defaultPasteShortcut:'Control+Alt+Shift+V',defaultPasteShortcutLabel:'Ctrl+Alt+Shift+V'});})()`);
await ev(`window.__emit('shelter-expanded',{focus:false}); window.__emit('open-settings')`); await sleep(900);
await shot('1-settings');
// 参加する側
await click('#pair-join-open'); await sleep(500); await shot('2-join-searching');
await ev(`window.__PAIR_CANDIDATES=[{id:'p1',name:${JSON.stringify(other)},host:'192.168.1.12'}]`); await sleep(1600); await shot('3-join-list');
await click('.pair-choice button'); await sleep(200);
await emit({ role: 'join', phase: 'sas', sas: '483291', peerName: other }); await sleep(300); await shot('4-code');
await emit({ role: 'join', phase: 'waiting-host', sas: '483291', peerName: other }); await sleep(300); await shot('5-waiting');
await emit({ role: 'join', phase: 'failed', reason: 'rejected', peerName: other }); await sleep(300); await shot('6-mismatch');
await emit({ role: 'join', phase: 'done', peerName: other }); await sleep(300); await shot('7-done');
process.exit(0);
