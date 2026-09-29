// film.html のタイムラインに同期したサウンドトラックを波形から合成する (依存なし)
// 120 BPM (1 拍 = 0.5s)。出力: audio.wav (48kHz / 24bit / stereo)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SR = 48000, DUR = 33, N = SR * DUR;
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

// ---------- arrangement (D major, 120 BPM, 1 小節 = 2s) ----------
const B = .5;
const CH = { D: [50, 57, 62, 66, 69], A: [49, 57, 61, 64, 69], Bm: [47, 54, 59, 62, 66], G: [43, 55, 59, 62, 67] };
const ROOT = { D: 38, A: 37, Bm: 35, G: 31 };
const kicks = [];
for (let bar = 0; bar < 14; bar++) {
  const c = ['D', 'A', 'Bm', 'G'][bar % 4], t0 = bar * 2, t1 = t0 + 2, notes = CH[c];
  const beat = bar >= 2 && bar < 14, full = (bar >= 6 && bar < 9) || bar >= 12;
  pad(t0, t1, notes, .05, .5, .35, .03);
  const arp = [0, 2, 3, 4, 3, 2, 3, 4], step = beat ? B / 2 : B;
  for (let k = 0, t = t0; t < t1 - .01; t += step, k++) pluck(t, notes[arp[k % 8]] + 12, beat ? .04 : .05, (k % 2) ? .35 : -.35);
  if (!beat) continue;
  for (let k = 0; k < 4; k++) {
    const t = t0 + k * B;
    if (k % 2 === 0) { kick(t, .5, .03); kicks.push(t); } else clap(t, full ? .15 : .1, .25);
    hat(t + B / 2, full ? .07 : .045, false, .25);
    if (full) { hat(t + B / 4, .03, false, -.3); hat(t + B * .75, .03, false, -.3); }
  }
  for (let t = t0; t < t1 - .01; t += B / 2) bass(t, ROOT[c] + ((Math.round((t - t0) / (B / 2)) % 4 === 3) ? 12 : 0), B / 2 * .8, .2);
}
// エンド: 28s から G → D で解決
pad(28, 29.2, CH.G, .05, .1, .3, .03); bass(28, 31, 1.2, .2);
boom(29.2, .36, .5); crash(29.2, .1, 3.2); kicks.push(29.2);
pad(29.2, 32.6, [50, 57, 62, 64, 66, 69, 76], .055, .05, .5, .03); bass(29.2, 38, 2.6, .22);
[[29.8, 74], [30.2, 78], [30.55, 81], [30.95, 86], [31.3, 85], [31.7, 81]].forEach(([t, m], i) => pluck(t, m, .06, (i % 2) ? .4 : -.4));
ping(.4, 1174.7, .035, 0, 3); ping(1.6, 1760, .03, .3, 5);
[4.1, 11.9, 18.7, 24.7].forEach((t, i) => sweep(t - .35, t + .35, 500, 2600, .14, 'bell', .7, (i % 2) ? .6 : -.6, (i % 2) ? -.6 : .6));
ping(6.0, 1760, .05, -.3, 9); sweep(7.2, 9.0, 700, 1800, .06, 'bell', .9, -.7, .7); ping(10.0, 2349, .05, .3, 8); ping(10.08, 3136, .03, .3, 9);
sweep(12.1, 12.7, 2600, 700, .08, 'bell', .8, .8, .4);
for (let i = 0; i < 10; i++) tick(12.5 + i * .09, 2600 + i * 120, .03, .5);
ping(15.2, 1760, .06, .5, 8); ping(15.28, 2637, .04, .5, 9);
tick(16.4, 1700, .13, .4); tick(16.41, 4800, .05, .4); ping(16.5, 2093, .04, .4, 8);
[20.0, 20.12, 20.24].forEach((t, i) => { tick(t, 650 + i * 70, .14, -.3 + i * .3); tick(t + .004, 3000, .04, 0); });
ping(22.3, 1318.5, .04, .2, 10); tick(22.75, 2200, .06, .2); tick(23.05, 900, .1, 0);
ping(23.25, 1760, .05, 0, 8); ping(23.33, 2637, .04, 0, 8);
[25.9, 26.08, 26.26].forEach((t, i) => ping(t, [1174.7, 1480, 1760][i], .03, -.4 + i * .4, 9));

// ---------- mix ----------
// パッドにサイドチェイン (キックの位置でダッキング)

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
  const fade = t > 31.8 ? Math.max(0, 1 - (t - 31.8) / 1.2) ** 1.5 : 1;
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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio3.wav');
writeFileSync(out, buf);
console.log('audio3.wav written, peak', peak.toFixed(3));
