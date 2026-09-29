// film.html のタイムラインに同期したサウンドトラックを波形から合成する (依存なし)
// 120 BPM (1 拍 = 0.5s)。出力: audio.wav (48kHz / 24bit / stereo)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SR = 48000, DUR = 15, N = SR * DUR;
const L = new Float32Array(N), R = new Float32Array(N);
const revL = new Float32Array(N), revR = new Float32Array(N); // reverb send
const padBus = [new Float32Array(N), new Float32Array(N)];     // サイドチェインをかけるバス
const TAU = Math.PI * 2;
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

function add(i, l, r, send = 0) { if (i < 0 || i >= N) return; L[i] += l; R[i] += r; if (send) { revL[i] += l * send; revR[i] += r * send; } }
const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// ---------- instruments ----------
function kick(t0, amp = 1, send = .05, len = .55) {
  let ph = 0; const s0 = Math.round(t0 * SR);
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR, f = 44 + 120 * Math.exp(-t * 30) + 30 * Math.exp(-t * 200);
    ph += TAU * f / SR;
    let v = Math.sin(ph) * Math.exp(-t * 5.5) * amp;
    v += rnd() * Math.exp(-t * 400) * .25 * amp;
    v = Math.tanh(v * 1.6) * .8;
    add(s0 + k, v, v, send);
  }
}
function boom(t0, amp = 1, send = .35) { // シネマティックなインパクト
  kick(t0, amp * 1.1, send, .9);
  let ph = 0, lp = 0; const s0 = Math.round(t0 * SR);
  for (let k = 0; k < 2.6 * SR; k++) {
    const t = k / SR; ph += TAU * (36 + 20 * Math.exp(-t * 6)) / SR;
    const sub = Math.sin(ph) * Math.exp(-t * 2.2) * .7;
    lp += (rnd() - lp) * .06; const nz = lp * Math.exp(-t * 5) * 1.4;
    const v = (sub + nz) * amp;
    add(s0 + k, v, v, send);
  }
}
function clap(t0, amp = .6, send = .25) {
  const s0 = Math.round(t0 * SR); let bp1 = 0, bp2 = 0;
  for (let k = 0; k < .35 * SR; k++) {
    const t = k / SR;
    const burst = t < .03 ? (Math.floor(t / .009) % 2 ? .5 : 1) : 1;
    const n = rnd(); bp1 += (n - bp1) * .35; bp2 += (bp1 - bp2) * .35; const hp = bp1 - bp2 * .9;
    const v = (hp * Math.exp(-t * 16) * burst + Math.sin(TAU * 190 * t) * Math.exp(-t * 30) * .4) * amp;
    add(s0 + k, v * .9, v, send);
  }
}
function hat(t0, amp = .18, open = false, p = .2) {
  const s0 = Math.round(t0 * SR); let a = 0, b = 0; const [pl, pr] = pan(p);
  const len = open ? .3 : .06;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR, n = rnd(); a += (n - a) * .5; b += (a - b) * .5; const hp = n - b;
    const v = hp * Math.exp(-t * (open ? 12 : 70)) * amp;
    add(s0 + k, v * pl, v * pr, .05);
  }
}
function crash(t0, amp = .5, len = 3.5) {
  const s0 = Math.round(t0 * SR); let a = 0;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR, nl = rnd(), nr = rnd(); a += (nl - a) * .3;
    const env = Math.exp(-t * 1.5) * (1 - Math.exp(-t * 400));
    add(s0 + k, (nl - a) * env * amp, (nr - a) * env * amp, .4);
  }
}
function tick(t0, f = 3200, amp = .18, p = 0) {
  const s0 = Math.round(t0 * SR); const [pl, pr] = pan(p);
  for (let k = 0; k < .05 * SR; k++) { const t = k / SR; const v = Math.sin(TAU * f * t) * Math.exp(-t * 180) * amp; add(s0 + k, v * pl, v * pr, .15); }
}
function ping(t0, f = 1760, amp = .2, p = 0, dec = 9) {
  const s0 = Math.round(t0 * SR); const [pl, pr] = pan(p);
  for (let k = 0; k < 1.2 * SR; k++) {
    const t = k / SR;
    const v = (Math.sin(TAU * f * t) + .35 * Math.sin(TAU * f * 2.01 * t) * Math.exp(-t * 8) + .15 * Math.sin(TAU * f * 3 * t) * Math.exp(-t * 20)) * Math.exp(-t * dec) * amp * (1 - Math.exp(-t * 2000));
    add(s0 + k, v * pl, v * pr, .45);
  }
}
// SVF バンドパスでノイズを掃引するウーッシュ / ライザー
function sweep(t0, t1, f0, f1, amp, shape = 'rise', q = .5, panFrom = -.6, panTo = .6) {
  const s0 = Math.round(t0 * SR), n = Math.round((t1 - t0) * SR);
  let low = 0, band = 0, ph = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    const f = f0 * Math.pow(f1 / f0, x);
    const F = 2 * Math.sin(Math.PI * Math.min(f, 12000) / SR);
    const inp = rnd();
    low += F * band; const high = inp - low - q * band; band += F * high;
    let env = shape === 'rise' ? Math.pow(x, 2.2) : shape === 'fall' ? Math.pow(1 - x, 2) : Math.sin(Math.PI * x) ** 2;
    ph += TAU * (f * .25) / SR;
    const tone = shape === 'rise' ? Math.sin(ph) * .25 * x : 0;
    const v = (band * 1.4 + tone) * env * amp;
    const [pl, pr] = pan(panFrom + (panTo - panFrom) * x);
    add(s0 + k, v * pl, v * pr, .3);
  }
}
function revSwell(t0, t1, notes, amp) { // 逆再生シンバル風の吸い込み
  const s0 = Math.round(t0 * SR), n = Math.round((t1 - t0) * SR); let a = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n, env = Math.pow(x, 3), nz = rnd(); a += (nz - a) * .25;
    let tone = 0; notes.forEach(m => tone += Math.sin(TAU * mtof(m) * k / SR));
    const v = ((nz - a) * .6 + tone * .12) * env * amp;
    add(s0 + k, v, v * .95, .3);
  }
}
function bass(t0, m, len, amp = .32) {
  const s0 = Math.round(t0 * SR), f = mtof(m); let ph = 0, lp = 0;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR; ph = (ph + f / SR) % 1;
    const saw = ph * 2 - 1, sq = ph < .5 ? 1 : -1;
    const cut = .02 + .22 * Math.exp(-t * 14);
    lp += ((saw * .7 + sq * .3) - lp) * cut;
    const env = Math.min(1, t * 400) * Math.exp(-t * 3) * (t > len - .02 ? (len - t) / .02 : 1);
    const v = (lp + Math.sin(TAU * f * t) * .6) * env * amp;
    add(s0 + k, v, v, 0);
  }
}
function pad(t0, t1, notes, amp = .07, att = .4, rel = .6, bright = .035) {
  const s0 = Math.round(t0 * SR), n = Math.round((t1 - t0 + rel) * SR);
  const voices = [];
  notes.forEach((m, i) => [-9, 0, 8].forEach((c, j) => voices.push({ f: mtof(m) * Math.pow(2, c / 1200), ph: Math.random(), p: ((i + j) % 3 - 1) * .7 })));
  let lpL = 0, lpR = 0, lpL2 = 0, lpR2 = 0;
  const len = t1 - t0;
  for (let k = 0; k < n; k++) {
    const t = k / SR;
    let l = 0, r = 0;
    for (const v of voices) { v.ph = (v.ph + v.f / SR) % 1; const s = v.ph * 2 - 1; const [pl, pr] = pan(v.p); l += s * pl; r += s * pr; }
    const cut = bright * (1 + .5 * Math.sin(t * 1.7));
    lpL += (l - lpL) * cut; lpR += (r - lpR) * cut; lpL2 += (lpL - lpL2) * cut; lpR2 += (lpR - lpR2) * cut;
    const env = Math.min(1, t / att) * (t > len ? Math.max(0, 1 - (t - len) / rel) : 1);
    const i = s0 + k; if (i >= N) break;
    padBus[0][i] += lpL2 * env * amp; padBus[1][i] += lpR2 * env * amp;
  }
}
function pluck(t0, m, amp = .16, p = 0) {
  const s0 = Math.round(t0 * SR), f = mtof(m); const [pl, pr] = pan(p);
  for (let k = 0; k < 1.6 * SR; k++) {
    const t = k / SR;
    const v = (Math.sin(TAU * f * t) + .5 * Math.sin(TAU * f * 2 * t) * Math.exp(-t * 6) + .2 * Math.sin(TAU * f * 4.01 * t) * Math.exp(-t * 14)) * Math.exp(-t * 3.2) * amp * Math.min(1, t * 800);
    add(s0 + k, v * pl, v * pr, .5);
  }
}
function glitch(t0, len, amp = .25) {
  const s0 = Math.round(t0 * SR), n = Math.round(len * SR); let hold = 0, cnt = 0;
  for (let k = 0; k < n; k++) {
    if (cnt-- <= 0) { hold = rnd(); cnt = 20 + Math.floor(Math.abs(rnd()) * 200); }
    const gate = Math.floor(k / (SR * .018)) % 2;
    const v = hold * gate * amp * (1 - k / n);
    add(s0 + k, v, -v, .1);
  }
}

// ---------- arrangement ----------
const B = .5;
// 0.00-0.50: 立ち上がり
sweep(0.02, .5, 180, 5200, .5, 'rise', .35, 0, 0);
ping(.1, 880, .06, 0, 5);
// 0.50 / 0.58 キーが落ちる
boom(.5, .9, .3); clap(.5, .35); kick(.58, .6); tick(.84, 2400, .22); tick(.86, 3600, .12);
pad(.5, 2.0, [53, 60, 64, 67, 69, 76], .05, .3, .4);   // Fmaj9
ping(.9, 1318.5, .1, -.3); ping(1.0, 1760, .08, .3);
sweep(1.45, 2.0, 400, 9000, .55, 'rise', .3, -.8, .8);  // ズームイン
revSwell(1.6, 2.0, [69, 76], .5);

// 2.00-7.50 ビート
boom(2.0, .8, .3); crash(2.0, .28, 2.5);
for (let t = 2.0; t < 7.49; t += B) kick(t, t === 2.0 ? 0 : .85, .04);
for (let t = 2.0; t < 7.4; t += B) { hat(t + B / 2, .16, (Math.round(t / B) % 4) === 3, .25); hat(t + B * .75, .07, false, -.25); }
for (let t = 3.0; t < 7.4; t += 1.0) clap(t, .4, .22);
const chords = [
  [2.0, 4.0, 45, [57, 64, 67, 71, 72]],      // Am9
  [4.0, 5.75, 41, [53, 60, 64, 67, 69]],     // Fmaj9
  [5.75, 7.5, 43, [55, 62, 67, 71, 74]],     // G
];
chords.forEach(([a, b, root, notes]) => {
  pad(a, b, notes, .055, .15, .25);
  for (let t = a; t < b - .01; t += B / 2) bass(t, (Math.round((t - a) / (B / 2)) % 4 === 2) ? root + 12 : root, B / 2 * .85, .28);
});
ping(2.36, 1318.5, .09, -.5); ping(2.8, 1568, .08, .4);
[[3.22, 1760, .5], [3.52, 1318.5, -.6], [3.7, 2093, .5], [3.88, 1568, -.6]].forEach(([t, f, p]) => ping(t, f, .12, p, 11));
tick(3.25, 2000, .2, .5); tick(3.3, 2600, .12, .5);
for (let i = 0; i < 12; i++) tick(3.5 + i * .02, 4200 + (i % 3) * 300, .05, .4);    // タイピング
sweep(3.62, 4.0, 300, 8000, .55, 'rise', .3, -.3, .9);
boom(4.0, .55, .25);
sweep(4.42, 4.8, 2500, 500, .35, 'bell', .6, .9, .3);                           // パネルが開く
for (let i = 0; i < 6; i++) tick(4.6 + i * .055, 2600 + i * 180, .09, .6);
ping(5.62, 2349, .12, .6, 10); ping(5.66, 3136, .06, .6, 12);                       // 新着
ping(6.08, 1568, .1, .6, 8); ping(6.14, 2093, .1, .6, 8);                          // 同期完了
tick(6.33, 1800, .3, .5); tick(6.35, 5200, .1, .5);                                 // クリック
ping(6.42, 1318.5, .08, .4, 7);
sweep(7.05, 7.5, 250, 10000, .7, 'rise', .25, .9, -.9);
revSwell(7.2, 7.5, [67, 74], .6);

// 7.50-10.00 モンタージュ: 1 拍ごとに叩く
[7.5, 8.0, 8.5, 9.0, 9.5].forEach((t, i) => {
  boom(t, .7, .2); clap(t, .45, .2);
  crash(t, .12, .45);
  pad(t, t + .45, [[55, 62, 67, 71], [53, 60, 65, 69], [57, 64, 69, 72], [53, 60, 64, 69], [55, 62, 67, 71]][i], .06, .01, .08, .06);
  for (let k = 1; k < 4; k++) hat(t + k * B / 4, .12, false, (k % 2) ? .4 : -.4);
  bass(t, [43, 41, 45, 41, 43][i], .22, .34); bass(t + .25, [43, 41, 45, 41, 43][i] + 12, .2, .26);
});
for (let k = 0; k < 12; k++) tick(8.54 + k * .018, 3000 + (k * 997) % 3000, .06, (k % 2) ? .6 : -.6); // スクランブル
glitch(8.5, .14, .12);
tick(8.8, 900, .25, 0); tick(8.81, 2400, .1, 0);                                    // 鍵が閉まる
kick(9.02, .45); kick(9.08, .45); kick(9.14, .5);                                     // ⌥⌘V
ping(9.2, 2637, .08, .5, 10);
[9.5, 9.545, 9.59, 9.635].forEach((t, i) => tick(t, 1500 + i * 400, .16, -.6 + i * .4)); // タイル
sweep(9.72, 10.0, 8000, 300, .45, 'fall', .4, .8, -.2);
revSwell(9.7, 10.0, [64, 71], .5);

// 10.00-12.00 収束
boom(10.0, .75, .4); crash(10.0, .22, 2.5);
pad(10.0, 12.0, [52, 59, 64, 68, 71], .065, .2, .2, .045);      // E
bass(10.0, 40, 1.0, .3); bass(11.0, 40, .5, .3);
[10.5, 10.625, 10.75, 10.875, 11.0, 11.125, 11.25].forEach((t, i) => pluck(t, [76, 80, 83, 88, 83, 80, 76][i], .07, (i % 2) ? .5 : -.5));
// スネアロール (加速)
{ let t = 11.0, step = .125; while (t < 11.96) { clap(t, .12 + .3 * (t - 11) , .15); t += step; if (t > 11.5) step = .0625; if (t > 11.75) step = .03125; } }
sweep(11.1, 12.0, 150, 12000, .9, 'rise', .2, -.9, .9);
revSwell(11.3, 12.0, [64, 68, 71], .7);

// 12.00-15.00 ロゴ
boom(12.0, 1.15, .5); crash(12.0, .45, 3.0); clap(12.0, .4, .4);
pad(12.0, 14.6, [48, 55, 60, 64, 67, 71, 74], .07, .05, .4, .05);   // Cmaj9
bass(12.0, 36, 2.4, .32);
[[12.12, 72], [12.24, 76], [12.36, 79], [12.48, 83], [12.72, 84], [13.2, 86], [13.44, 88], [13.7, 91]].forEach(([t, m], i) => pluck(t, m, .085, (i % 2) ? .45 : -.45));
sweep(12.55, 13.2, 1500, 300, .22, 'bell', .6, -.5, .5);     // ロックアップへ移動
ping(13.2, 2093, .06, 0, 4); ping(13.26, 3136, .04, .3, 4);    // スイープの光
for (let k = 0; k < 10; k++) tick(13.5 + k * .018, 3500 + (k * 613) % 2500, .035, (k % 2) ? .5 : -.5);

// ---------- mix ----------
// パッドにサイドチェイン (キックの位置でダッキング)
const kicks = []; for (let t = 2.0; t < 7.49; t += B) kicks.push(t); [7.5, 8, 8.5, 9, 9.5, 10, 12].forEach(t => kicks.push(t));
for (let i = 0; i < N; i++) {
  const t = i / SR; let duck = 1;
  for (const k of kicks) { const d = t - k; if (d >= 0 && d < .4) duck = Math.min(duck, .35 + .65 * Math.min(1, d / .28)); }
  L[i] += padBus[0][i] * duck; R[i] += padBus[1][i] * duck;
  revL[i] += padBus[0][i] * duck * .4; revR[i] += padBus[1][i] * duck * .4;
}
// Schroeder reverb
function reverb(inp, combs, aps, fb = .82, damp = .3) {
  const out = new Float32Array(N);
  combs.forEach(d => { const buf = new Float32Array(d); let idx = 0, lp = 0; for (let i = 0; i < N; i++) { const y = buf[idx]; lp = y * (1 - damp) + lp * damp; buf[idx] = inp[i] + lp * fb; idx = (idx + 1) % d; out[i] += y / combs.length; } });
  aps.forEach(d => { const buf = new Float32Array(d); let idx = 0; for (let i = 0; i < N; i++) { const b = buf[idx]; const x = out[i]; const y = -x * .5 + b; buf[idx] = x + b * .5; idx = (idx + 1) % d; out[i] = y; } });
  return out;
}
const wetL = reverb(revL, [1557, 1617, 1491, 1422, 1277, 1356], [225, 556, 441]);
const wetR = reverb(revR, [1580, 1640, 1514, 1445, 1300, 1379], [248, 579, 464]);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = t > 14.4 ? Math.max(0, 1 - (t - 14.4) / .6) ** 1.5 : 1;
  const fin = Math.min(1, t / .01);
  L[i] = Math.tanh((L[i] + wetL[i] * .9) * .62) * fade * fin;
  R[i] = Math.tanh((R[i] + wetR[i] * .9) * .62) * fade * fin;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = .72 / peak;
// 24bit WAV
const buf = Buffer.alloc(44 + N * 6);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 6, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 6, 28); buf.writeUInt16LE(6, 32); buf.writeUInt16LE(24, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 6, 40);
for (let i = 0; i < N; i++) {
  const o = 44 + i * 6;
  buf.writeIntLE(Math.round(clamp(L[i] * g, -1, 1) * 8388607), o, 3);
  buf.writeIntLE(Math.round(clamp(R[i] * g, -1, 1) * 8388607), o + 3, 3);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio.wav');
writeFileSync(out, buf);
console.log('audio.wav written, peak', peak.toFixed(3));
