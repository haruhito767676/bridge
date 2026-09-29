// film6.html のタイムラインに同期したサウンドトラックを波形から合成する (依存なし)
// 120 BPM (1 拍 = 0.5s)。出力: audio6.wav (48kHz / 24bit / stereo)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SR = 48000, DUR = 34.1, N = Math.round(SR * DUR);
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

// ---------- arrangement (film6: 導入 → 3 台 → その場でペースト → パネル → 南京錠 → 橋) ----------
const B = .5, b2 = .625, F2 = 17.85;               // b2 = 96 BPM (3 台の場面を 1.25 倍に伸ばした拍)
const TL = l => 7.2 + (l - 3) * 1.25, TH = l => 19.5 + (l - 9.55) * 1.25;
const CH = { D: [50, 57, 62, 66, 69], A: [49, 57, 61, 64, 69], Bm: [47, 54, 59, 62, 66], G: [43, 55, 59, 62, 67] };
const ROOT = { D: 38, A: 33, Bm: 35, G: 31 };
const SECT = [[0, 6.85, 'D'], [6.85, 10.6, 'Bm'], [10.6, 14.3, 'G'], [14.3, 18.5, 'D'], [18.5, 22.2, 'Bm'], [22.2, 25.5, 'G'], [25.5, 27.85, 'A'], [27.85, 29.4, 'Bm'], [29.4, 30.15, 'A']];
const chordAt = t => { for (const [a, b, c] of SECT) if (t >= a && t < b) return c; return 'D'; };
const kicks = [];
const K = (t, a = .5) => { kick(t, a, .03); kicks.push(t); };

SECT.forEach(([a, b, c]) => pad(a, b, CH[c], a < 6.85 ? .035 : .05, .4, .3, .03));
pad(12.3 + F2, 34.1, [50, 57, 62, 66, 69, 74, 78], .06, .05, .9, .03);

// ===== 0 - 6.85 : 「こんなこと、していませんか？」 (乾いた・無機質な音) =====
ping(.3, 1568, .035, 0, 8);
[.9, 2.3, 3.7, 5.0].forEach((t, i) => { tick(t, 700 + i * 120, .1, -.3 + i * .2); ping(t + .02, 1174.7 * (1 + i * .12), .035, -.3 + i * .2, 12); });
// メール: 添付が入り、送信を押す (サイクルごとに繰り返す)
for (let c = 0; .9 + c * 1.9 + 1.0 < 6.1; c++) {
  const t0 = .9 + c * 1.9;
  sweep(t0 + .25, t0 + .75, 900, 2200, .03, 'rise', .6, .5, -.5);
  tick(t0 + 1.0, 1400, .12, -.4); ping(t0 + 1.22, 1568, .05, -.4, 10);
  sweep(t0 + 1.2, t0 + 1.6, 1200, 3200, .04, 'bell', .6, -.5, .5);
}
// Slack: URL を打って投稿
for (let c = 0; 2.3 + c * 2.1 + 1.3 < 6.1; c++) {
  const t0 = 2.3 + c * 2.1;
  for (let i = 0; i < 32; i++) tick(t0 + .2 + i * .85 / 32, 2200 + (i % 5) * 160, .02, .4);
  tick(t0 + 1.22, 900, .08, .4); ping(t0 + 1.22, 1318.5, .05, .4, 10);
}
// クラウド: 上がって、落ちる
for (let c = 0; 3.7 + c * 2.5 + .95 < 6.1; c++) {
  const t0 = 3.7 + c * 2.5;
  sweep(t0 + .15, t0 + .95, 500, 1800, .05, 'rise', .6, -.6, .2);
  ping(t0 + 1.3, 1760, .04, 0, 10); sweep(t0 + 1.3, t0 + 2.0, 1800, 600, .05, 'fall', .6, .2, .6);
}
// タブとドキュメントを往復
[[.1, -.6], [.5, .6], [.55, .6], [.9, -.6], [.95, -.6], [1.28, .6], [1.32, .6], [1.62, -.6]].forEach(([u, p], i) => tick(5.0 + u, 1100 + (i % 2) * 400, .08, p));
// 全部が点に吸い込まれる
sweep(5.55, 6.15, 300, 5200, .14, 'rise', .6, -.8, .8);
ping(6.05, 2349, .05, 0, 6);
[0, 1, 2, 3].forEach(i => { const t = 6.15 + i * .07 + .5; tick(t, 500 + i * 80, .12, -.4 + i * .27); K(t, .18 + i * .05); });
sweep(6.15, 6.85, 4200, 300, .09, 'fall', .6, .8, -.8);
// ===== 6.85 : 青へ =====
boom(6.85, .5, .5); crash(6.85, .12, 3.2); K(6.85, .7);
sweep(6.85, 7.45, 5000, 500, .08, 'fall', .5, .6, -.6);

// ===== グルーヴ (96BPM) : 7.475 → 27.35 =====
function groove(t0, t1) {
  const lv = t => t < 15.0 ? 1 : t < 19.5 ? .78 : t < 24.0 ? .9 : .8, full = t => t < 15.0;
  for (let t = t0, i = 0; t < t1 - .001; t += b2, i++) {
    const l = lv(t);
    K(t, .5 * l);
    if (i % 2 === 1) clap(t, (full(t) ? .16 : .1) * l, .25);
    hat(t + b2 / 2, (full(t) ? .07 : .05) * l, false, .25);
    if (full(t)) { hat(t + b2 / 4, .03 * l, false, -.3); hat(t + b2 * .75, .03 * l, false, -.3); }
  }
  for (let t = t0; t < t1 - .001; t += b2 / 2) {
    const c = chordAt(t), sub = Math.round((t - t0) / (b2 / 2)) % 4 === 3;
    bass(t, ROOT[c] + (sub ? 12 : 0), b2 / 2 * .8, .2 * lv(t));
  }
  for (let t = t0, k = 0; t < t1 - .001; t += b2 / 2, k++) {
    const notes = CH[chordAt(t)], arp = [0, 2, 3, 4, 3, 2, 3, 4];
    pluck(t, notes[arp[k % 8]] + 12, .04 * lv(t), (k % 2) ? .35 : -.35);
  }
}
groove(7.475, 27.35);

// Mac: 選択 → コピー (行が入る)
sweep(TL(3.4), TL(3.8), 700, 2600, .05, 'rise', .6, -.3, .3);
ping(TL(4.06), 1760, .09, 0, 7); ping(TL(4.06) + .06, 2637, .05, 0, 9); tick(TL(4.06), 1100, .08, 0);
// 引き → 3 台
sweep(TL(4.5), TL(5.8), 500, 2800, .12, 'bell', .6, -.8, .8);
for (let i = 0; i < 17; i++) tick(TL(5.1) + i * .0375, 1800 + i * 90, .025, -.5 + i * .06);
// 配信カード
sweep(TL(5.42), TL(6.32), 900, 3400, .08, 'bell', .6, -.9, .9);
[[TL(6.24), 1568], [TL(6.36), 1975]].forEach(([t, f], i) => { ping(t, f, .08, i ? .5 : -.5, 8); ping(t + .05, f * 1.5, .04, i ? .5 : -.5, 10); tick(t, 1200, .08, i ? .5 : -.5); });
[TL(6.3), TL(6.38), TL(6.46)].forEach((t, i) => tick(t, 1400 + i * 260, .05, -.4 + i * .4));
// 会社用PC: シェルフをクリック → コピー → 貼り付け
sweep(TL(6.95), TL(7.85), 500, 2200, .11, 'bell', .6, -.8, .8);
tick(TL(8.28), 1700, .13, .3); tick(TL(8.28) + .01, 4800, .05, .3); ping(TL(8.32), 2093, .05, .3, 8);
ping(TL(8.42), 1568, .05, .3, 8);
sweep(TL(8.66), TL(9.0), 3200, 900, .05, 'fall', .6, .6, .2);
ping(TL(8.98), 1318.5, .06, 0, 6); ping(TL(8.98) + .04, 1760, .05, 0, 8); ping(TL(8.98) + .12, 2637, .04, 0, 9);
// 自宅iMac: その場でペースト
sweep(15.05, 16.1, 500, 2600, .11, 'bell', .6, .8, -.8);
ping(16.55, 1568, .07, 0, 7); tick(16.55, 1300, .06, 0); sweep(16.5, 16.75, 900, 2400, .04, 'rise', .6, -.3, .3);
tick(17.35, 1500, .09, -.2); ping(17.36, 1976, .05, -.2, 9);
tick(18.05, 1200, .1, 0);
ping(18.12, 1318.5, .06, 0, 6); ping(18.16, 1760, .05, 0, 8); ping(18.24, 2637, .04, 0, 9);
// 3 台 → パネル
sweep(19.05, 19.5, 4200, 500, .1, 'fall', .6, .8, -.8); ping(19.51, 1174.7, .07, 0, 6);
for (let i = 0; i < 14; i++) tick(TH(9.72) + i * .035, 1900 + i * 110, .02, -.4 + i * .06);
// 絞り込み
tick(TH(10.55), 1500, .12, .3); ping(TH(10.55) + .03, 1976, .06, .3, 8);
sweep(TH(10.6), TH(11.1), 1600, 3200, .06, 'bell', .6, -.5, .5);
sweep(TH(11.6), TH(12.0), 3000, 1500, .05, 'bell', .6, .4, -.4);
for (let i = 0; i < 12; i++) tick(TH(11.75) + i * .035, 1900 + i * 100, .018, .3 - i * .05);
// 同期の進捗
ping(TH(12.05), 1568, .07, 0, 7);
for (let i = 0; i <= 10; i++) tick(TH(12.3) + i * .0875, 1000 + i * 170, .04 + i * .002, (i % 2) ? .3 : -.3);
ping(TH(13.0), 2637, .07, 0, 6); ping(TH(13.0) + .02, 2093, .06, 0, 7);

// ===== 南京錠 =====
sweep(23.75, 24.35, 600, 2400, .09, 'rise', .6, -.6, .6);
tick(24.05, 600, .1, 0); ping(24.08, 1174.7, .05, 0, 8);
[74, 76, 78, 81, 83, 86].forEach((m, i) => pluck(24.65 + i * .13, m, .06, (i % 2) ? .4 : -.4));
{ // ペン先に合わせたピッチグライド
  const s0 = Math.round(24.65 * SR), n = Math.round(.8 * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const x = k / n, f = 300 * Math.pow(6, x * x); ph += TAU * f / SR; const env = Math.sin(Math.PI * x) ** 1.2 * .045; add(s0 + k, Math.sin(ph) * env, Math.sin(ph) * env, .4); }
}
boom(25.55, .5, .5); K(25.55, .75); clap(25.55, .18, .3); tick(25.55, 2600, .2, 0); tick(25.56, 900, .14, 0);
ping(25.55, 2349, .07, 0, 4); ping(25.56, 1174.7, .07, 0, 4); bass(25.55, 38, 1.6, .2);
for (let i = 0; i < 10; i++) tick(25.72 + i * .04, 1800 + i * 180, .035, -.5 + i * .1);
ping(25.95, 1760, .04, 0, 7);

// ===== 橋 (film4 の 10.0 以降を +F2) =====
sweep(10.0 + F2, 10.48 + F2, 6000, 260, .13, 'fall', .5, .8, -.4);
ping(10.48 + F2, 2637, .05, 0, 10); tick(10.48 + F2, 5200, .05, 0);
for (let t = 10.5 + F2; t < 12.3 + F2 - .01; t += B) K(t, .3 + .25 * ((t - 10.5 - F2) / 1.8));
for (let t = 10.75 + F2; t < 12.3 + F2 - .01; t += B) hat(t, .045, false, .2);
for (let t = 11.0 + F2; t < 12.3 + F2 - .01; t += B / 4) hat(t, .022, false, -.3);
for (let t = 10.5 + F2; t < 12.3 + F2 - .01; t += B / 2) bass(t, ROOT[chordAt(t)], B / 2 * .8, .16);
[74, 76, 78, 79, 81, 83, 85, 86, 88, 90].forEach((m, i) => pluck(10.9 + F2 + i * .093, m, .06, (i % 2) ? .45 : -.45));
{
  const s0 = Math.round((10.88 + F2) * SR), n = Math.round(.9 * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const x = k / n, f = 300 * Math.pow(6, x * x); ph += TAU * f / SR; const env = Math.sin(Math.PI * x) ** 1.2 * .05; add(s0 + k, Math.sin(ph) * env, Math.sin(ph) * env, .4); }
}
[11.5, 11.7, 11.77, 11.84, 11.95, 12.05].forEach((t, i) => tick(t + F2, 700 + i * 260, .07, -.4 + i * .16));
revSwell(11.55 + F2, 12.3 + F2, [62, 66, 69, 74, 78], .09);
sweep(11.6 + F2, 12.3 + F2, 500, 9500, .2, 'rise', .5, -.9, .9);
for (let i = 0; i < 14; i++) tick(11.9 + F2 + i * .03, 2400 + i * 160, .028, (i % 2) ? .5 : -.5);
boom(12.3 + F2, .62, .6); crash(12.3 + F2, .2, 3.8); K(12.3 + F2, .8); clap(12.3 + F2, .2, .4);
sweep(12.3 + F2, 12.9 + F2, 8000, 500, .1, 'fall', .5, .7, -.7);
[[12.36, 74], [12.44, 78], [12.52, 81], [12.6, 86], [12.72, 90], [12.9, 93]].forEach(([t, m], i) => pluck(t + F2, m, .07, (i % 2) ? .4 : -.4));
ping(12.3 + F2, 2349, .07, 0, 4); ping(12.3 + F2, 1174.7, .06, 0, 4);
bass(12.3 + F2, 38, 2.6, .22);
for (let i = 0; i < 6; i++) tick(12.78 + F2 + i * .045, 1800 + i * 200, .04, -.5 + i * .2);
ping(12.95 + F2, 1760, .04, 0, 7);
for (let i = 0; i < 20; i++) tick(13.3 + F2 + i * .03, 3000 + (i % 4) * 300, .012, (i % 2) ? .5 : -.5);
[[13.1, 74], [13.5, 78], [13.9, 81]].forEach(([t, m], i) => pluck(t + F2, m, .04, (i % 2) ? .4 : -.4));
[12.8, 13.3, 13.8].forEach(t => K(t + F2, .18));

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
  const fade = t > 33.2 ? Math.max(0, 1 - (t - 33.2) / .9) ** 1.5 : 1;
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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio6.wav');
writeFileSync(out, buf);
console.log('audio6.wav written, peak', peak.toFixed(3));
