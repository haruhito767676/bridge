// 区間ごとに render.mjs を回し、完了した区間 (.done) はスキップする。途中で落ちても続きから再開できる。
//   FILM=film6.html DUR=34.1 node render-all.mjs <出力.mov> [区間フレーム数=240]
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const out = path.resolve(process.argv[2]), seg = +(process.argv[3] || 240), FPS = 60, DUR = +(process.env.DUR || 30);
const total = Math.round(FPS * DUR), dir = out.replace(/\.mov$/, '_seg'); mkdirSync(dir, { recursive: true });
const files = [];
for (let s = 0, i = 0; s < total; s += seg, i++) {
  const e = Math.min(total, s + seg), f = path.join(dir, `seg${String(i).padStart(2, '0')}.mov`); files.push(f);
  if (existsSync(f + '.done')) { console.log('skip', i); continue; }
  for (let a = 0; a < 3; a++) {
    const t0 = Date.now();
    const r = spawnSync('node', ['render.mjs', 'video', '4', f], { env: { ...process.env, START: String(s), END: String(e) }, stdio: 'inherit' });
    if (r.status === 0) { writeFileSync(f + '.done', ''); console.log(`seg ${i} [${s},${e}) ok ${((Date.now() - t0) / 1000).toFixed(0)}s`); break; }
    console.log(`seg ${i} failed (attempt ${a + 1})`);
  }
  if (!existsSync(f + '.done')) { console.log('giving up at seg', i); process.exit(1); }
}
writeFileSync(path.join(dir, 'list.txt'), files.map(f => `file '${f}'`).join('\n'));
const c = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-c', 'copy', out], { stdio: 'inherit' });
console.log(c.status === 0 ? 'video done ' + out : 'concat failed');
