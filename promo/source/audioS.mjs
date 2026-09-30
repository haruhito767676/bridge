// film_s.html のタイムラインに同期したサウンドトラックを波形から合成する (依存なし)
// 120 BPM (1 拍 = 0.5s)。出力: audioS.wav (48kHz / 24bit / stereo)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SR = 48000, DUR = 15.75, N = Math.round(SR * DUR);
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

// ---------- arrangement (short: 導入 (速く連続) → 3 台 → 南京錠 → 橋 + URL) ----------
const B = .5, b2 = .625;
const DURX = 15.75, FL0 = 4.6, K3 = .65, TA0 = FL0 + .35, TP0 = TA0 + 4.3 * K3, TH0 = TP0 + .7, LK0 = TH0 + .5, LKS = .55, COL = LK0 + 2.9;
const TL = l => TA0 + (l - 3) * K3;
const LX = x => LK0 + x * LKS;
const EB = t => t <= 12.3 ? COL + (t - 10.05) / 1.875 : COL + 1.2 + (t - 12.3) / 1.4;   // 橋 (film4) の時間 → 短縮版の時間
const CH = { D: [50, 57, 62, 66, 69], A: [49, 57, 61, 64, 69], Bm: [47, 54, 59, 62, 66], G: [43, 55, 59, 62, 67] };
const ROOT = { D: 38, A: 33, Bm: 35, G: 31 };
const SECT = [[0, FL0, 'D']];
{ const prog = ['Bm', 'G', 'A'], seg = (COL - FL0) / prog.length; prog.forEach((c, i) => SECT.push([FL0 + i * seg, FL0 + (i + 1) * seg, c])); }
SECT.push([COL, COL + 1.0, 'Bm'], [COL + 1.0, COL + 2.0, 'A']);
const chordAt = t => { for (const [a, b, c] of SECT) if (t >= a && t < b) return c; return 'D'; };
const kicks = [];
const K = (t, a = .5) => { kick(t, a, .03); kicks.push(t); };

SECT.forEach(([a, b, c]) => pad(a, b, CH[c], a < FL0 ? .035 : .05, .3, .25, .03));
pad(COL + 1.2, DURX, [50, 57, 62, 66, 69, 74, 78], .06, .05, .9, .03);

// ===== 0 - 4.6 : 悩みを速く 1 つずつ → 「それ、全部いらなくなります。」 =====
ping(.32, 1568, .03, 0, 8);
[.55, 1.05, 1.5, 1.9].forEach((t, i) => { tick(t, 700 + i * 120, .09, -.3 + i * .2); ping(t + .02, 1174.7 * (1 + i * .12), .03, -.3 + i * .2, 12); });
sweep(.63, .84, 900, 2200, .03, 'rise', .6, -.5, .5);
tick(.95, 1400, .11, -.4); ping(1.0, 1568, .05, -.4, 10);
for (let i = 0; i < 10; i++) tick(1.11 + i * .03, 2200 + (i % 5) * 160, .018, .4);
tick(1.45, 900, .08, .4); ping(1.45, 1318.5, .05, .4, 10);
sweep(1.53, 1.76, 500, 1800, .05, 'rise', .6, -.6, .2); ping(1.78, 1760, .04, 0, 10);
sweep(1.89, 2.1, 1800, 600, .05, 'fall', .6, .2, .6); ping(2.1, 1568, .05, .5, 8); ping(2.16, 2093, .04, .5, 10);
[[.05, .5], [.55, .95], [1.0, 1.35], [1.4, 1.7], [1.75, 2.0], [2.05, 2.25], [2.3, 2.48], [2.5, 2.66]].forEach(([a, b], k) => { tick(1.9 + a / 3, 1100 + (k % 2) * 400, .05 + k * .005, k % 2 ? .6 : -.6); tick(1.9 + b / 3, 1500 + (k % 2) * 300, .035 + k * .004, k % 2 ? -.6 : .6); });
sweep(2.35, 2.85, 300, 3000, .06, 'rise', .6, -.7, .7);
ping(2.87, 1568, .05, 0, 7); ping(2.93, 2093, .05, 0, 8); ping(3.06, 2637, .04, 0, 9);
for (let i = 0; i < 12; i++) tick(3.0 + i * .025, 2000 + i * 90, .016, -.4 + i * .07);
sweep(3.45, 3.9, 300, 5200, .14, 'rise', .6, -.8, .8); ping(3.85, 2349, .05, 0, 6);
[0, 1, 2, 3].forEach(i => { const t = 3.85 + i * .07 + .5; tick(t, 500 + i * 80, .12, -.4 + i * .27); K(t, .18 + i * .05); });
sweep(3.9, 4.6, 4200, 300, .09, 'fall', .6, .8, -.8);
// ===== 4.6 : 青へ =====
boom(FL0, .5, .5); crash(FL0, .12, 3.2); K(FL0, .7);
sweep(FL0, FL0 + .5, 5000, 500, .08, 'fall', .5, .6, -.6);

// ===== グルーヴ (96BPM) =====
function groove(t0, t1) {
  const lv = t => t < TP0 ? 1 : t < TH0 ? .78 : t < LK0 ? .9 : .8, full = t => t < TP0;
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
groove(FL0 + b2, COL - .8);

// Mac: 選択 → コピー
sweep(TL(3.4), TL(3.8), 700, 2600, .05, 'rise', .6, -.3, .3);
ping(TL(4.06), 1760, .09, 0, 7); ping(TL(4.06) + .06, 2637, .05, 0, 9); tick(TL(4.06), 1100, .08, 0);
// 引き → 3 台
sweep(TL(4.5), TL(5.8), 500, 2800, .12, 'bell', .6, -.8, .8);
for (let i = 0; i < 17; i++) tick(TL(5.1) + i * .0244, 1800 + i * 90, .025, -.5 + i * .06);
// 配信カード
sweep(TL(5.42), TL(6.32), 900, 3400, .08, 'bell', .6, -.9, .9);
[[TL(6.24), 1568], [TL(6.36), 1975]].forEach(([t, f], i) => { ping(t, f, .08, i ? .5 : -.5, 8); ping(t + .05, f * 1.5, .04, i ? .5 : -.5, 10); tick(t, 1200, .08, i ? .5 : -.5); });
[TL(6.3), TL(6.38), TL(6.46)].forEach((t, i) => tick(t, 1400 + i * 260, .05, -.4 + i * .4));
// 3 台 → パネル
sweep(TH0 - .45, TH0, 4200, 500, .1, 'fall', .6, .8, -.8); ping(TH0 + .01, 1174.7, .07, 0, 6);

// ===== 南京錠: 閉じて、運ばれ、相手の画面で開く =====
sweep(LK0 - .05, LK0 + .3, 600, 2400, .09, 'rise', .6, -.6, .6);
tick(LX(.38), 600, .1, 0); ping(LX(.38) + .03, 1174.7, .05, 0, 8);
[74, 76, 78, 81, 83, 86].forEach((m, i) => pluck(LX(.85) + i * .07, m, .06, (i % 2) ? .4 : -.4));
{ // ペン先に合わせたピッチグライド
  const s0 = Math.round(LX(.85) * SR), n = Math.round(.8 * LKS * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const x = k / n, f = 300 * Math.pow(6, x * x); ph += TAU * f / SR; const env = Math.sin(Math.PI * x) ** 1.2 * .045; add(s0 + k, Math.sin(ph) * env, Math.sin(ph) * env, .4); }
}
boom(LX(1.75), .5, .5); K(LX(1.75), .75); clap(LX(1.75), .18, .3); tick(LX(1.75), 2600, .2, 0); tick(LX(1.75) + .01, 900, .14, 0);
ping(LX(1.75), 2349, .07, 0, 4); ping(LX(1.75) + .01, 1174.7, .07, 0, 4); bass(LX(1.75), 38, 1.0, .2);
for (let i = 0; i < 7; i++) tick(LX(1.87) + i * .022, 2400 + i * 130, .016, -.3 + i * .1);
sweep(LX(2.1), LX(3.2), 500, 2600, .09, 'bell', .6, -.8, .8);
for (let i = 0; i < 10; i++) tick(LX(2.15) + i * .055, 2400 + i * 180, .02, -.6 + i * .13);
tick(LX(3.2), 3200, .15, .6); ping(LX(3.2), 2637, .07, .6, 5); ping(LX(3.2) + .02, 1975, .06, .6, 6);
for (let i = 0; i < 3; i++) tick(LX(3.22) + i * .035, 3000 + i * 300, .02, .5);
ping(LX(3.62), 1568, .07, .4, 7); pluck(LX(3.65), 86, .06, .4); ping(LX(3.72), 2349, .05, .4, 8);

// ===== 橋 (film4 の時間 → EB で短縮版へ) =====
sweep(EB(10.0), EB(10.48), 6000, 260, .13, 'fall', .5, .8, -.4);
ping(EB(10.48), 2637, .05, 0, 10); tick(EB(10.48), 5200, .05, 0);
[0, 1, 2, 3].forEach(i => K(COL + .2 + i * .3, .3 + .08 * i));
[0, 1, 2, 3].forEach(i => hat(COL + .35 + i * .3, .045, false, .2));
for (let t = COL + .2; t < COL + 1.2 - .01; t += .15) bass(t, ROOT[chordAt(t)], .12, .16);
[74, 76, 78, 79, 81, 83, 85, 86, 88, 90].forEach((m, i) => pluck(EB(10.9) + i * .05, m, .06, (i % 2) ? .45 : -.45));
{
  const s0 = Math.round(EB(10.88) * SR), n = Math.round(.48 * SR); let ph = 0;
  for (let k = 0; k < n; k++) { const x = k / n, f = 300 * Math.pow(6, x * x); ph += TAU * f / SR; const env = Math.sin(Math.PI * x) ** 1.2 * .05; add(s0 + k, Math.sin(ph) * env, Math.sin(ph) * env, .4); }
}
[11.5, 11.7, 11.77, 11.84, 11.95, 12.05].forEach((t, i) => tick(EB(t), 700 + i * 260, .07, -.4 + i * .16));
revSwell(EB(11.55), EB(12.3), [62, 66, 69, 74, 78], .09);
sweep(EB(11.6), EB(12.3), 500, 9500, .2, 'rise', .5, -.9, .9);
for (let i = 0; i < 14; i++) tick(EB(11.9) + i * .016, 2400 + i * 160, .028, (i % 2) ? .5 : -.5);
const FB = COL + 1.2;
boom(FB, .62, .6); crash(FB, .2, 3.8); K(FB, .8); clap(FB, .2, .4);
sweep(FB, FB + .5, 8000, 500, .1, 'fall', .5, .7, -.7);
[[12.36, 74], [12.44, 78], [12.52, 81], [12.6, 86], [12.72, 90], [12.9, 93]].forEach(([t, m], i) => pluck(EB(t), m, .07, (i % 2) ? .4 : -.4));
ping(FB, 2349, .07, 0, 4); ping(FB, 1174.7, .06, 0, 4);
bass(FB, 38, 2.4, .22);
for (let i = 0; i < 6; i++) tick(EB(12.78) + i * .03, 1800 + i * 200, .04, -.5 + i * .2);
ping(EB(12.95), 1760, .04, 0, 7);
for (let i = 0; i < 14; i++) tick(EB(13.3) + i * .02, 3000 + (i % 4) * 300, .012, (i % 2) ? .5 : -.5);
for (let i = 0; i < 16; i++) tick(EB(14.1) + i * .02, 3400 + (i % 4) * 260, .01, (i % 2) ? .5 : -.5);
[[13.1, 74], [13.5, 78], [13.9, 81]].forEach(([t, m], i) => pluck(EB(t), m, .04, (i % 2) ? .4 : -.4));
[12.8, 13.3, 13.8].forEach(t => K(EB(t), .18));
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
  const fade = t > 14.85 ? Math.max(0, 1 - (t - 14.85) / .9) ** 1.5 : 1;
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
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audioS.wav');
writeFileSync(out, buf);
console.log('audioS.wav written, peak', peak.toFixed(3));
