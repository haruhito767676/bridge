// audio5.mjs の楽器定義 (head) とミックス (tail) を再利用し、編曲 (audio8-body.txt) だけ差し替えて audio8.mjs を作り、実行する。
import fs from 'node:fs';
const src = fs.readFileSync('audio5.mjs', 'utf8');
const a = src.indexOf('// ---------- arrangement'), m = src.indexOf('// ---------- mix ----------');
if (a < 0 || m < 0) throw new Error('audio5.mjs のマーカーが見つかりません');
let head = src.slice(0, a), tail = src.slice(m);
if (!head.includes('DUR = 19.4')) throw new Error('DUR の定義が見つかりません');
head = head.replace('DUR = 19.4', 'DUR = 45.6').replace(/audio5\.wav/g, 'audio8.wav').replace('film5.html (マルチデバイス版)', 'film8.html');
if (!tail.includes('18.45')) throw new Error('フェードアウトの定義が見つかりません');
tail = tail.replace(/18\.45/g, '44.7').replace(/audio5\.wav/g, 'audio8.wav');
fs.writeFileSync('audio8.mjs', head + fs.readFileSync('audio8-body.txt', 'utf8') + tail);
await import('./audio8.mjs');
