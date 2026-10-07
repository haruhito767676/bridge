// 「はじめかた」用: 実アプリの設定画面と、デバイスの追加 (ペアリング) の画面を、状態ごとに撮る。
//   SCHEME=light node settings-plates.mjs → plates-light/settings/ (と、ボタンの位置 buttons.json)
import { open, send, ev, sleep, DIR } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const OUT = path.join(DIR, 'plates-light', 'settings'); mkdirSync(OUT, { recursive: true });
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: 320, height: 600, scale: 1 } }); writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')); console.log('saved', n); };
const KEY = 'a3f9c2e17b48d0562e9ca41f7d83b60c5e12f8a9047bd63c1e5a7f20984d3b6c';
const SAS = '483291';
const BTN = {};
const SPIN = {};   // 回る輪の位置と色 (動画では、輪だけを別に描いて回す)   // ボタンの中心 (パネルの左上が原点)
const where = async (key, sel, text) => {
  BTN[key] = await ev(`(()=>{const e=${text ? `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(text)})` : `document.querySelector(${JSON.stringify(sel)})`};const r=e.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]})()`);
};
const click = (sel, text) => ev(text ? `[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()` : `document.querySelector(${JSON.stringify(sel)}).click()`);
for (const [plat, key, me, other, otherHost] of [['darwin', 'mac', '自分のMac', '会社用PC', '192.168.1.21'], ['win32', 'win', '会社用PC', '自分のMac', '192.168.1.12']]) {
  await open(plat, me);
  const H = key === 'mac' ? ['⌥Space', 'Alt+Space', '⌥⌘V', 'Alt+CommandOrControl+V'] : ['Ctrl+Shift+Space', 'Ctrl+Shift+Space', 'Ctrl+Alt+Shift+V', 'Control+Alt+Shift+V'];
  await ev(`(()=>{const st=document.createElement('style');st.textContent='#handle{display:none!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important}';document.head.appendChild(st);
    window.bridge.saveSettings=async()=>({ok:true});window.bridge.getSettings=async()=>({deviceName:${JSON.stringify(me)},secretToken:${JSON.stringify(KEY)},autoScan:true,peers:[],openAtLogin:true,autoPaste:false,showSourceApp:true,version:'2.1.0',
      hotkeyLabel:${JSON.stringify(H[0])},toggleShortcut:${JSON.stringify(H[1])},defaultToggleShortcut:${JSON.stringify(H[1])},defaultToggleShortcutLabel:${JSON.stringify(H[0])},
      pasteHotkeyLabel:${JSON.stringify(H[2])},pasteShortcut:${JSON.stringify(H[3])},defaultPasteShortcut:${JSON.stringify(H[3])},defaultPasteShortcutLabel:${JSON.stringify(H[2])}});})()`);
  await ev(`(()=>{const st=document.createElement('style');st.textContent='.pair-spinner{visibility:hidden!important}';document.head.appendChild(st)})()`);
  await ev(`window.__emit('sync-status', {peers:[],onlineCount:0})`); await sleep(300);
  await ev(`window.__emit('shelter-expanded',{focus:false}); window.__emit('open-settings')`); await sleep(1000);
  await ev(`document.activeElement&&document.activeElement.blur();getSelection().removeAllRanges()`); await sleep(200);
  await shot(`${key}-off`);
  if (key === 'mac') {
    // 追加される側 (ホスト)
    await where('mac-add', '#pair-host-open');
    await click('#pair-host-open'); await sleep(900);
    SPIN.mac = await ev(`(()=>{const e=document.querySelector('.pair-spinner'),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.left+r.width/2,y:r.top+r.height/2,size:r.width,track:c.borderLeftColor,arc:c.borderTopColor,border:parseFloat(c.borderTopWidth)}})()`);
    await shot('mac-wait');
    await ev(`window.__emit('pair-state',{role:'host',phase:'connecting',peerName:${JSON.stringify(other)},expiresAt:Date.now()+104000,failures:0,accepted:null})`); await sleep(200);
    await ev(`window.__emit('pair-state',{role:'host',phase:'sas',sas:${JSON.stringify(SAS)},peerName:${JSON.stringify(other)},expiresAt:Date.now()+100000,failures:0,accepted:null})`); await sleep(500);
    await where('mac-match', '#pair-actions button', '一致'); await shot('mac-sas');
    await ev(`window.__emit('pair-state',{role:'host',phase:'sas',sas:${JSON.stringify(SAS)},peerName:${JSON.stringify(other)},expiresAt:Date.now()+98000,failures:0,accepted:true})`); await sleep(500); await shot('mac-sas-ok');
    await ev(`window.__emit('pair-state',{role:'host',phase:'closed',closedReason:'done',peerName:${JSON.stringify(other)},failures:0,accepted:true})`); await sleep(500);
    await where('mac-done', '#pair-actions button', '完了'); await shot('mac-done');
    await click('#pair-actions button', '完了'); await sleep(900);
  } else {
    // 参加する側
    await where('win-find', '#pair-join-open');
    await ev(`window.__PAIR_CANDIDATES=[]`);
    await click('#pair-join-open'); await sleep(600);
    await ev(`window.__PAIR_CANDIDATES=[{id:'p1',name:${JSON.stringify(other)},host:${JSON.stringify(otherHost)}}]`); await sleep(1700);
    await where('win-pick', '.pair-choice button'); await shot('win-list');
    await click('.pair-choice button'); await sleep(300);
    await ev(`window.__emit('pair-state',{role:'join',phase:'sas',sas:${JSON.stringify(SAS)},peerName:${JSON.stringify(other)}})`); await sleep(500);
    await where('win-match', '#pair-actions button', '一致'); await shot('win-sas');
    await ev(`window.__emit('pair-state',{role:'join',phase:'waiting-host',sas:${JSON.stringify(SAS)},peerName:${JSON.stringify(other)}})`); await sleep(500);
    SPIN.win = await ev(`(()=>{const e=document.querySelector('.pair-spinner'),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {x:r.left+r.width/2,y:r.top+r.height/2,size:r.width,track:c.borderLeftColor,arc:c.borderTopColor,border:parseFloat(c.borderTopWidth)}})()`);
    await shot('win-sas-ok');
    await ev(`window.__emit('pair-state',{role:'join',phase:'done',peerName:${JSON.stringify(other)}})`); await sleep(500);
    await where('win-done', '#pair-actions button', '完了'); await shot('win-done');
    await click('#pair-actions button', '完了'); await sleep(900);
  }
  await ev(`window.__emit('sync-status', {peers:[{device:${JSON.stringify(other)},host:${JSON.stringify(otherHost)},online:true,enabled:true}],onlineCount:1})`); await sleep(500);
  await ev(`document.activeElement&&document.activeElement.blur()`);
  await shot(`${key}-on`);
}
writeFileSync(path.join(OUT, 'buttons.json'), JSON.stringify({ ...BTN, spin: SPIN }, null, 1));
console.log(BTN);
process.exit(0);
