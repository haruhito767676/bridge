// 依存なしのレンダラー: Chrome DevTools Protocol で film.html を 1 フレームずつシークして撮影する
//   node render.mjs stills 0.5 2.1 ...      → stills/*.png
//   node render.mjs video [samples]          → frames を ffmpeg へパイプ (samples 枚のサブフレームを平均 = モーションブラー)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9337;
const FPS = 60, DUR = +(process.env.DUR || 15), FILM = process.env.FILM || 'film.html';
const mode = process.argv[2] || 'stills';

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(DIR, '.chrome')}`,
  '--window-size=1920,1080', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--force-color-profile=srgb', 'about:blank',
], { stdio: 'ignore' });
process.on('exit', () => chrome.kill('SIGKILL'));

const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 100; i++) {
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = list.find(x => x.type === 'page'); if (target) break; } catch { }
  await sleep(100);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'file://' + path.join(DIR, FILM) + '?capture=1' });
for (let i = 0; i < 200; i++) { try { if (await evalJS('!!window.__ready')) break; } catch { } await sleep(100); }
await evalJS('window.__ready');
await sleep(300);

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('capture timeout')), ms))]);
const shot = async (t) => withTimeout(shot0(t), 30000);
const shot0 = async (t) => {
  await evalJS(`renderAt(${t})`);
  const r = await send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  return Buffer.from(r.data, 'base64');
};

if (mode === 'stills') {
  mkdirSync(path.join(DIR, 'stills'), { recursive: true });
  const times = process.argv.slice(3).map(Number);
  for (const t of times) writeFileSync(path.join(DIR, 'stills', `t${t.toFixed(2)}.png`), await shot(t));
  console.log('stills done', times.length);
} else {
  // 180° シャッター: 1 フレーム (1/60s) の前半に samples 枚を等間隔に置いて平均する
  const samples = +(process.argv[3] || 4);
  const out = process.argv[4] || path.join(DIR, 'video_noaudio.mov');
  const total = FPS * DUR;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * samples), '-i', '-',
    '-vf', samples > 1 ? `tmix=frames=${samples},select='eq(mod(n\\,${samples})\\,${samples - 1})',setpts=N/(${FPS}*TB)` : 'null',
    '-r', String(FPS), '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  const START = +(process.env.START || 0);
  for (let f = START; f < total; f++) {
    for (let s = 0; s < samples; s++) {
      const t = f / FPS + (s / samples) * (0.5 / FPS);
      const buf = await shot(t);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    if (f % 60 === 0) console.log(`frame ${f}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  console.log('video done', out, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
