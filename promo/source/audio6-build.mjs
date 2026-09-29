// audio5.mjs の楽器定義 (head) とミックス (tail) を再利用し、編曲 (audio6-body.txt) だけ差し替えて audio6.mjs を作り、実行する。
import fs from 'node:fs';
const src = fs.readFileSync('audio5.mjs', 'utf8');
const a = src.indexOf('// ---------- arrangement'), m = src.indexOf('// ---------- mix ----------');
if (a < 0 || m < 0) throw new Error('audio5.mjs のマーカーが見つかりません');
let head = src.slice(0, a), tail = src.slice(m);
if (!head.includes('DUR = 19.4')) throw new Error('DUR の定義が見つかりません');
head = head.replace('DUR = 19.4', 'DUR = 34.1').replace(/audio5\.wav/g, 'audio6.wav').replace('film5.html (マルチデバイス版)', 'film6.html');
if (!tail.includes('18.45')) throw new Error('フェードアウトの定義が見つかりません');
tail = tail.replace(/18\.45/g, '33.2').replace(/audio5\.wav/g, 'audio6.wav');
fs.writeFileSync('audio6.mjs', head + fs.readFileSync('audio6-body.txt', 'utf8') + tail);
await import('./audio6.mjs');
