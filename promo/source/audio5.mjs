// film5.html (マルチデバイス版) のタイムラインに同期したサウンドトラックを波形から合成する (依存なし)
// 120 BPM (1 拍 = 0.5s)。出力: audio5.wav (48kHz / 24bit / stereo)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SR = 48000, DUR = 19.4, N = Math.round(SR * DUR);
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
const B = .5, F = 4.35; // F: 橋のシークエンス (film4 の 10.4〜15s) を後ろへずらした量
const CH = { D: [50, 57, 62, 66, 69], A: [49, 57, 61, 64, 69], Bm: [47, 54, 59, 62, 66], G: [43, 55, 59, 62, 67] };
const ROOT = { D: 38, A: 33, Bm: 35, G: 31 };
const SECT = [[0, 3, 'D'], [3, 5, 'Bm'], [5, 7, 'G'], [7, 9.5, 'D'], [9.5, 11.5, 'Bm'], [11.5, 13.1, 'G'], [13.1, 14.75, 'A'], [14.75, 15.75, 'Bm'], [15.75, 16.3, 'G'], [16.3, 16.65, 'A']];
const chordAt = t => { for (const [a, b, c] of SECT) if (t >= a && t < b) return c; return 'D'; };
const kicks = [];
const K = (t, a = .5) => { kick(t, a, .03); kicks.push(t); };

SECT.forEach(([a, b, c]) => pad(a, b, CH[c], a < 3 ? .04 : .05, .4, .3, .03));
pad(12.3 + F, 19.4, [50, 57, 62, 66, 69, 74, 78], .06, .05, .9, .03);

// ===== 0 - 3.0 : opener (film4 と同じ) =====
ping(.14, 2349, .05, 0, 6); sweep(0, .5, 900, 5200, .05, 'rise', .7, -.4, .4);
K(.5, .7); boom(.5, .16, .3);
[0.55, .62, .69].forEach((t, i) => { pluck(t, [74, 78, 81][i], .07, (i % 2) ? .3 : -.3); tick(t, 3400 + i * 300, .05, 0); });
ping(.95, 1568, .04, .3, 10); tick(.95, 900, .08, .3);
for (let t = 1.0; t < 1.5; t += B / 2) hat(t, .03, false, .25);
sweep(1.38, 1.98, 500, 4200, .12, 'bell', .55, .9, -.9);
K(1.5, .65); clap(1.5, .16, .3);
[0, 1, 2, 3].forEach(i => tick(1.52 + i * .045, 2400 + i * 350, .06, .4 - i * .25));
ping(1.98, 1174.7, .07, 0, 7); K(1.98, .3); tick(1.98, 200, .12, 0);
[2.0, 2.5].forEach(t => K(t, .5)); [2.25, 2.75].forEach(t => hat(t, .05, false, .25));
clap(2.0, .1, .2);
[0, 1, 2, 3].forEach(i => tick(2.45 + i * .04, 1800 - i * 260, .05, -.3 + i * .2));
sweep(2.4, 3.0, 300, 7000, .17, 'rise', .6, -.8, .8);
revSwell(2.5, 3.0, [62, 66, 69, 74], .05);
for (let i = 0; i < 8; i++) tick(2.6 + i * .05, 2200 + i * 200, .03, .5);

// ===== 3.0 : flood =====
boom(3.0, .5, .5); crash(3.0, .12, 3.2); K(3.0, .7);
sweep(3.0, 3.6, 5000, 500, .08, 'fall', .5, .6, -.6);

function groove(t0, t1, full, lvl = 1) {
  for (let t = t0; t < t1 - .001; t += B) {
    const i = Math.round(t / B);
    K(t, .5 * lvl);
    if (i % 2 === 1) clap(t, (full ? .16 : .1) * lvl, .25);
    hat(t + B / 2, (full ? .07 : .05) * lvl, false, .25);
    if (full) { hat(t + B / 4, .03 * lvl, false, -.3); hat(t + B * .75, .03 * lvl, false, -.3); }
  }
  for (let t = t0; t < t1 - .001; t += B / 2) {
    const c = chordAt(t), sub = Math.round((t - t0) / (B / 2)) % 4 === 3;
    bass(t, ROOT[c] + (sub ? 12 : 0), B / 2 * .8, .2 * lvl);
  }
  for (let t = t0, k = 0; t < t1 - .001; t += B / 2, k++) {
    const notes = CH[chordAt(t)], arp = [0, 2, 3, 4, 3, 2, 3, 4];
    pluck(t, notes[arp[k % 8]] + 12, .04 * lvl, (k % 2) ? .35 : -.35);
  }
}
groove(3.5, 9.4, true);
// Mac: 選択 → ⌘C → 行が入る
sweep(3.4, 3.8, 700, 2600, .05, 'rise', .8, -.3, .3);
tick(3.98, 900, .1, -.2); tick(4.02, 1150, .1, .2); tick(4.04, 3800, .05, 0);
ping(4.06, 1760, .09, 0, 7); ping(4.12, 2637, .05, 0, 9);
// 引き → 3 台
sweep(4.5, 5.8, 500, 2800, .12, 'bell', .8, -.8, .8);
for (let i = 0; i < 17; i++) tick(5.1 + i * .03, 1800 + i * 90, .025, -.5 + i * .06);
// 配信カード
sweep(5.42, 6.32, 900, 3400, .08, 'bell', .8, -.9, .9);
[[6.2, 1568], [6.32, 1975]].forEach(([t, f], i) => { ping(t, f, .08, i ? .5 : -.5, 8); ping(t + .05, f * 1.5, .04, i ? .5 : -.5, 10); tick(t, 1200, .08, i ? .5 : -.5); });
[6.3, 6.38, 6.46].forEach((t, i) => tick(t, 1400 + i * 260, .05, -.4 + i * .4));
// 会社用PC へ寄る
sweep(6.95, 7.85, 500, 2200, .11, 'bell', .8, -.8, .8);
tick(8.3, 1700, .13, .3); tick(8.31, 4800, .05, .3); ping(8.32, 2093, .05, .3, 8);
tick(8.7, 800, .1, -.2); tick(8.74, 1000, .1, .2);
ping(8.86, 1318.5, .06, 0, 6); ping(8.9, 1760, .05, 0, 8); ping(8.98, 2637, .04, 0, 9);
// デバイスが消えてヒーローへ
sweep(9.15, 9.55, 4200, 500, .1, 'fall', .6, .8, -.8);
K(9.55, .6); ping(9.56, 1174.7, .07, 0, 6);
for (let i = 0; i < 14; i++) tick(9.72 + i * .028, 1900 + i * 110, .02, -.4 + i * .06);
groove(9.55, 13.0, false, .9);
// クリック → 絞り込み
tick(10.55, 1500, .12, .3); ping(10.58, 1976, .06, .3, 8);
sweep(10.6, 11.1, 1600, 3200, .06, 'bell', .8, -.5, .5);
for (let i = 0; i < 12; i++) tick(11.4 + i * .028, 1900 + i * 100, .018, .3 - i * .05);
sweep(11.6, 12.0, 3000, 1500, .05, 'bell', .8, .4, -.4);
// 同期の進捗
ping(12.05, 1568, .07, 0, 7);
for (let i = 0; i <= 10; i++) tick(12.3 + i * .07, 1000 + i * 170, .04 + i * .002, (i % 2) ? .3 : -.3);
ping(13.0, 2637, .07, 0, 6); ping(13.02, 2093, .06, 0, 7);
// 「0」へ
sweep(13.0, 13.5, 400, 9000, .18, 'rise', .55, -.9, .9);
revSwell(13.05, 13.5, [57, 61, 64, 69], .07);
for (let i = 0; i < 10; i++) tick(13.05 + i * .045 * (1 - i * .03), 1800 + i * 110, .05 + i * .003, (i % 2) ? .3 : -.3);
boom(13.5, .5, .5); crash(13.5, .1, 2.6); K(13.5, .7); ping(13.5, 2349, .06, 0, 5); ping(13.52, 1174.7, .06, 0, 5);
sweep(13.95, 14.25, 3800, 600, .07, 'bell', .6, .6, -.6); tick(14.25, 3600, .1, 0);

// ===== 橋: film4 の 10.0 以降を +F =====
sweep(10.0 + F, 10.48 + F, 6000, 260, .13, 'fall', .5, .8, -.4);
ping(10.48 + F, 2637, .05, 0, 10); tick(10.48 + F, 5200, .05, 0);
for (let t = 10.5 + F; t < 12.3 + F - .01; t += B) K(t, .3 + .25 * ((t - 10.5 - F) / 1.8));
for (let t = 10.75 + F; t < 12.3 + F - .01; t += B) hat(t, .045, false, .2);
for (let t = 11.0 + F; t < 12.3 + F - .01; t += B / 4) hat(t, .022, false, -.3);
for (let t = 10.5 + F; t < 12.3 + F - .01; t += B / 2) bass(t, ROOT[chordAt(t)], B / 2 * .8, .16);
[74, 76, 78, 79, 81, 83, 85, 86, 88, 90].forEach((m, i) => pluck(10.9 + F + i * .093, m, .06, (i % 2) ? .45 : -.45));
{
  const s0 = Math.round((10.88 + F) * SR), n = Math.round(.9 * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const x = k / n, f = 300 * Math.pow(6, x * x); ph += TAU * f / SR; const env = Math.sin(Math.PI * x) ** 1.2 * .05; add(s0 + k, Math.sin(ph) * env, Math.sin(ph) * env, .4); }
}
[11.5, 11.7, 11.77, 11.84, 11.95, 12.05].forEach((t, i) => tick(t + F, 700 + i * 260, .07, -.4 + i * .16));
revSwell(11.55 + F, 12.3 + F, [62, 66, 69, 74, 78], .09);
sweep(11.6 + F, 12.3 + F, 500, 9500, .2, 'rise', .5, -.9, .9);
for (let i = 0; i < 14; i++) tick(11.9 + F + i * .03, 2400 + i * 160, .028, (i % 2) ? .5 : -.5);
boom(12.3 + F, .62, .6); crash(12.3 + F, .2, 3.8); K(12.3 + F, .8); clap(12.3 + F, .2, .4);
sweep(12.3 + F, 12.9 + F, 8000, 500, .1, 'fall', .5, .7, -.7);
[[12.36, 74], [12.44, 78], [12.52, 81], [12.6, 86], [12.72, 90], [12.9, 93]].forEach(([t, m], i) => pluck(t + F, m, .07, (i % 2) ? .4 : -.4));
ping(12.3 + F, 2349, .07, 0, 4); ping(12.3 + F, 1174.7, .06, 0, 4);
bass(12.3 + F, 38, 2.6, .22);
for (let i = 0; i < 6; i++) tick(12.78 + F + i * .045, 1800 + i * 200, .04, -.5 + i * .2);
ping(12.95 + F, 1760, .04, 0, 7);
for (let i = 0; i < 16; i++) tick(13.3 + F + i * .022, 3000 + (i % 4) * 300, .012, (i % 2) ? .5 : -.5);
[[13.1, 74], [13.5, 78], [13.9, 81]].forEach(([t, m], i) => pluck(t + F, m, .04, (i % 2) ? .4 : -.4));
[12.8, 13.3, 13.8].forEach(t => K(t + F, .18));

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
  const fade = t > 18.45 ? Math.max(0, 1 - (t - 18.45) / .9) ** 1.5 : 1;
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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio5.wav');
writeFileSync(out, buf);
console.log('audio5.wav written, peak', peak.toFixed(3));
