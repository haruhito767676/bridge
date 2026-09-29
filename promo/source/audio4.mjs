// film4.html (15s ショーリール) のタイムラインに同期したサウンドトラックを波形から合成する (依存なし)
// 120 BPM (1 拍 = 0.5s)。出力: audio4.wav (48kHz / 24bit / stereo)
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

// ---------- arrangement (D major, 120 BPM) ----------
const B = .5;
const CH = { D: [50, 57, 62, 66, 69], A: [49, 57, 61, 64, 69], Bm: [47, 54, 59, 62, 66], G: [43, 55, 59, 62, 67] };
const ROOT = { D: 38, A: 33, Bm: 35, G: 31 };
// [開始, 終了, コード]
const SECT = [[0, 3, 'D'], [3, 5, 'Bm'], [5, 6.5, 'G'], [6.5, 8.5, 'D'], [8.5, 10.4, 'A'], [10.4, 11.4, 'Bm'], [11.4, 11.95, 'G'], [11.95, 12.3, 'A']];
const chordAt = t => { for (const [a, b, c] of SECT) if (t >= a && t < b) return c; return 'D'; };
const kicks = [];
const K = (t, a = .5) => { kick(t, a, .03); kicks.push(t); };

// --- pads ---
SECT.forEach(([a, b, c]) => pad(a, b, CH[c], a < 3 ? .04 : .05, .4, .3, .03));
pad(12.3, 15.0, [50, 57, 62, 66, 69, 74, 78], .06, .05, .9, .03);

// --- 0.0 - 0.5 : spark & riser ---
ping(.14, 2349, .05, 0, 6); sweep(0, .5, 900, 5200, .05, 'rise', .7, -.4, .4);
// 0.5 : first hit (“コピー” が立ち上がる)
K(.5, .7); boom(.5, .16, .3);
[0.55, .62, .69].forEach((t, i) => { pluck(t, [74, 78, 81][i], .07, (i % 2) ? .3 : -.3); tick(t, 3400 + i * 300, .05, 0); });
ping(.95, 1568, .04, .3, 10); tick(.95, 900, .08, .3);
for (let t = 1.0; t < 1.5; t += B / 2) hat(t, .03, false, .25);
// 1.5 : push (ペースト) 
sweep(1.38, 1.98, 500, 4200, .12, 'bell', .55, .9, -.9);
K(1.5, .65); clap(1.5, .16, .3);
[0, 1, 2, 3].forEach(i => tick(1.52 + i * .045, 2400 + i * 350, .06, .4 - i * .25));
ping(1.98, 1174.7, .07, 0, 7); K(1.98, .3); tick(1.98, 200, .12, 0);
// 2.0 - 2.5 : four on the floor builds
[2.0, 2.5].forEach(t => K(t, .5)); [2.25, 2.75].forEach(t => hat(t, .05, false, .25));
clap(2.0, .1, .2);
// 2.45 - 3.0 : letters fall, dot squeezes, riser
[0, 1, 2, 3].forEach(i => tick(2.45 + i * .04, 1800 - i * 260, .05, -.3 + i * .2));
sweep(2.4, 3.0, 300, 7000, .17, 'rise', .6, -.8, .8);
revSwell(2.5, 3.0, [62, 66, 69, 74], .05);
for (let i = 0; i < 8; i++) tick(2.6 + i * .05, 2200 + i * 200, .03, .5);

// --- 3.0 : flood impact ---
boom(3.0, .5, .5); crash(3.0, .12, 3.2); K(3.0, .7);
sweep(3.0, 3.5, 5000, 400, .08, 'fall', .5, .6, -.6);
[3.32].forEach(t => { ping(t, 1760, .09, -.3, 7); ping(t + .05, 2349, .05, -.3, 9); tick(t, 2800, .1, -.3); });
// groove 3.0 - 6.0
function groove(t0, t1, full) {
  for (let t = t0; t < t1 - .001; t += B) {
    const i = Math.round(t / B);
    K(t, .5);
    if (i % 2 === 1) clap(t, full ? .16 : .1, .25);
    hat(t + B / 2, full ? .07 : .05, false, .25);
    if (full) { hat(t + B / 4, .03, false, -.3); hat(t + B * .75, .03, false, -.3); }
  }
  for (let t = t0; t < t1 - .001; t += B / 2) {
    const c = chordAt(t), sub = Math.round((t - t0) / (B / 2)) % 4 === 3;
    bass(t, ROOT[c] + (sub ? 12 : 0), B / 2 * .8, .2);
  }
  for (let t = t0, k = 0; t < t1 - .001; t += B / 2, k++) {
    const notes = CH[chordAt(t)], arp = [0, 2, 3, 4, 3, 2, 3, 4];
    pluck(t, notes[arp[k % 8]] + 12, .04, (k % 2) ? .35 : -.35);
  }
}
groove(3.5, 5.95, true); K(3.0, .5); K(3.5 - B, .0);
// pan whoosh + comet sparkles
sweep(3.85, 4.9, 600, 2600, .11, 'bell', .8, -.8, .8);
for (let i = 0; i < 9; i++) ping(3.95 + i * .1, 3136 - i * 160, .022, -.6 + i * .15, 12);
// 4.9 : landing
boom(4.9, .28, .5); ping(4.9, 1174.7, .08, 0, 5);
[0, 1, 2, 3, 4].forEach(i => ping(4.94 + i * .06, [1568, 1975, 2349, 2637, 3136][i], .035, -.5 + i * .25, 9));
// headline chars
for (let i = 0; i < 8; i++) tick(5.15 + i * .04, 2000 + i * 150, .035, -.4 + i * .1);
// 5.95 - 6.7 : shrink to tile
K(5.95 - .01, .0);
sweep(5.9, 6.7, 4200, 500, .12, 'bell', .6, .8, -.8);
// tiles pop
[6.30, 6.42, 6.54, 6.66, 6.78, 6.90].forEach((t, i) => { tick(t, 900 + i * 140, .12, -.5 + i * .2); ping(t + .01, [1174.7, 1318.5, 1480, 1568, 1760, 2093][i], .045, -.5 + i * .2, 12); });
for (let i = 0; i < 12; i++) tick(6.85 + i * .05, 2600 + (i % 3) * 200, .018, .5);
// 6.5 - 8.4 : tight groove
groove(6.5, 8.4, true);
// 8.45 - 9.3 : zoom build
sweep(8.3, 9.3, 400, 9000, .2, 'rise', .55, -.9, .9);
revSwell(8.4, 9.3, [57, 61, 64, 69], .07);
for (let i = 0; i < 18; i++) { const t = 8.5 + i * (.8 / 18) * (1 - i * .018); tick(t, 1800 + i * 90, .05 + i * .003, (i % 2) ? .3 : -.3); }
// 9.3 : “0”
boom(9.3, .5, .5); crash(9.3, .1, 2.6); K(9.3, .7); ping(9.3, 2349, .06, 0, 5); ping(9.32, 1174.7, .06, 0, 5);
sweep(9.4, 9.72, 3800, 600, .07, 'bell', .6, .6, -.6); tick(9.72, 3600, .1, 0);
// 10.0 - 10.48 : field collapses to a dot (suck-in) 
sweep(10.0, 10.48, 6000, 260, .13, 'fall', .5, .8, -.4);
// dot appears
ping(10.48, 2637, .05, 0, 10); tick(10.48, 5200, .05, 0);
// --- 10.4 - 12.3 : the pen draws ---
for (let t = 10.5; t < 12.3 - .01; t += B) K(t, .3 + .25 * ((t - 10.5) / 1.8));
for (let t = 10.75; t < 12.3 - .01; t += B) hat(t, .045, false, .2);
for (let t = 11.0; t < 12.3 - .01; t += B / 4) hat(t, .022, false, -.3);
for (let t = 10.5; t < 12.3 - .01; t += B / 2) bass(t, ROOT[chordAt(t)], B / 2 * .8, .16);
// scale pluck synchronised with the arch being drawn
[74, 76, 78, 79, 81, 83, 85, 86, 88, 90].forEach((m, i) => pluck(10.9 + i * .093, m, .06, (i % 2) ? .45 : -.45));
{ // pitch glide following the pen
  const s0 = Math.round(10.88 * SR), n = Math.round(.9 * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const x = k / n, f = 300 * Math.pow(6, x * x); ph += TAU * f / SR; const env = Math.sin(Math.PI * x) ** 1.2 * .05; add(s0 + k, Math.sin(ph) * env, Math.sin(ph) * env, .4); }
}
// deck & hangers appear
[11.5, 11.7, 11.77, 11.84, 11.95, 12.05].forEach((t, i) => tick(t, 700 + i * 260, .07, -.4 + i * .16));
revSwell(11.55, 12.3, [62, 66, 69, 74, 78], .09);
sweep(11.6, 12.3, 500, 9500, .2, 'rise', .5, -.9, .9);
for (let i = 0; i < 14; i++) tick(11.9 + i * .03, 2400 + i * 160, .028, (i % 2) ? .5 : -.5);
// --- 12.3 : the reveal ---
boom(12.3, .62, .6); crash(12.3, .2, 3.8); K(12.3, .8); clap(12.3, .2, .4);
sweep(12.3, 12.9, 8000, 500, .1, 'fall', .5, .7, -.7);
[[12.36, 74], [12.44, 78], [12.52, 81], [12.6, 86], [12.72, 90], [12.9, 93]].forEach(([t, m], i) => pluck(t, m, .07, (i % 2) ? .4 : -.4));
ping(12.3, 2349, .07, 0, 4); ping(12.3, 1174.7, .06, 0, 4);
bass(12.3, 38, 2.6, .22);
// wordmark & tagline
for (let i = 0; i < 6; i++) tick(12.78 + i * .045, 1800 + i * 200, .04, -.5 + i * .2);
ping(12.95, 1760, .04, 0, 7);
for (let i = 0; i < 16; i++) tick(13.3 + i * .022, 3000 + (i % 4) * 300, .012, (i % 2) ? .5 : -.5);
[[13.1, 74], [13.5, 78], [13.9, 81]].forEach(([t, m], i) => pluck(t, m, .04, (i % 2) ? .4 : -.4));
// gentle pulse in the tail
[12.8, 13.3, 13.8].forEach(t => K(t, .18));

// ---------- mix ----------
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
  const fade = t > 14.1 ? Math.max(0, 1 - (t - 14.1) / .9) ** 1.5 : 1;
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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio4.wav');
writeFileSync(out, buf);
console.log('audio4.wav written, peak', peak.toFixed(3));
