// 実アプリの Renderer (index.html / styles.css / renderer.js) を素の Chrome で動かし、
// モックした window.bridge にダミーデータを流して「本物の UI」を高解像度で撮る。
//   node shots.mjs   → ui/plates/*.png (透明背景)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(DIR, '../../..');
const OUT = path.join(DIR, 'plates'); mkdirSync(OUT, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9338, DSF = +(process.env.DSF || 3);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(DIR, '.chrome')}`,
  '--hide-scrollbars', '--allow-file-access-from-files', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => chrome.kill('SIGKILL'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 100; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); target = l.find(x => x.type === 'page'); if (target) break; } catch { } await sleep(100); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value; };

const mock = readFileSync(path.join(DIR, 'mock-bridge.js'), 'utf8');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 600, deviceScaleFactor: DSF, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });

let _script = null;
export async function open(platform, me, page = 'index.html', vp = [320, 600]) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp[0], height: vp[1], deviceScaleFactor: DSF, mobile: false });
  if (_script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: _script });
  _script = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__PLATFORM=${JSON.stringify(platform)};window.__ME=${JSON.stringify(me || null)};\n` + mock })).identifier;
  await send('Page.navigate', { url: 'file://' + path.join(APP, page) });
  for (let i = 0; i < 100; i++) { try { if (await ev('!!window.__mockReady')) break; } catch { } await sleep(100); }
  await sleep(500);
}
export const shot = async (name, clip) => {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: clip ? { ...clip, scale: 1 } : { x: 0, y: 0, width: 320, height: 600, scale: 1 } });
  writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64')); console.log('saved', name);
};
export { ev, send, sleep, DIR, APP };
