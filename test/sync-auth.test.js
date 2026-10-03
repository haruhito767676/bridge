const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const A = require('../lib/sync-auth.js');
const { deriveSyncKey } = require('../lib/sync-crypto.js');

const TOKEN = 'a'.repeat(64);
const KEY = A.deriveAuthKey(TOKEN);
const NOW = 1_790_000_000_000;

test('deriveAuthKey: 暗号化の鍵とは別の鍵になる / 同じキーなら同じ鍵', () => {
  assert.equal(KEY.length, 32);
  assert.deepEqual(A.deriveAuthKey(TOKEN), KEY);
  assert.notDeepEqual(A.deriveAuthKey('b'.repeat(64)), KEY);
  assert.notDeepEqual(deriveSyncKey(TOKEN), KEY, '認証の鍵と暗号化の鍵は、同じキーから作っても、別の鍵');
});

test('ヘッダーに、同期キーそのものは含まれない', () => {
  const header = A.createAuthHeader(KEY, 'GET', '/items?since=0', undefined, NOW);
  assert.ok(!header.includes(TOKEN));
  assert.ok(!header.includes(Buffer.from(TOKEN).toString('base64url')));
  assert.match(header, /^2\.\d+\.[\w-]+\.-\.[\w-]+$/);
});

test('verifyAuthHeader: 正しいヘッダーは通る', () => {
  const h = A.createAuthHeader(KEY, 'GET', '/ping', undefined, NOW);
  assert.deepEqual(A.verifyAuthHeader(KEY, h, 'GET', '/ping', { now: NOW + 1000 }), { ok: true, digest: '-' });
});

test('verifyAuthHeader: ヘッダー無し (古い版) / 形式の誤り / キー違い / 改ざん / 時刻ずれ', () => {
  const h = A.createAuthHeader(KEY, 'GET', '/ping', undefined, NOW);
  assert.equal(A.verifyAuthHeader(KEY, undefined, 'GET', '/ping', { now: NOW }).reason, 'missing');
  assert.equal(A.verifyAuthHeader(KEY, 'garbage', 'GET', '/ping', { now: NOW }).reason, 'format');
  assert.equal(A.verifyAuthHeader(A.deriveAuthKey('x'), h, 'GET', '/ping', { now: NOW }).reason, 'mac');
  assert.equal(A.verifyAuthHeader(KEY, h, 'GET', '/items', { now: NOW }).reason, 'mac', '別のパスには使えない');
  assert.equal(A.verifyAuthHeader(KEY, h, 'POST', '/ping', { now: NOW }).reason, 'mac', '別のメソッドには使えない');
  assert.equal(A.verifyAuthHeader(KEY, h, 'GET', '/ping', { now: NOW + A.AUTH_WINDOW_MS + 1 }).reason, 'skew');
  assert.equal(A.verifyAuthHeader(KEY, h, 'GET', '/ping', { now: NOW - A.AUTH_WINDOW_MS - 1 }).reason, 'skew');
  assert.equal(A.verifyAuthHeader(KEY, h, 'GET', '/ping', { now: NOW + A.AUTH_WINDOW_MS }).ok, true, '境界ちょうどは通る');
});

test('verifyAuthHeader: 同じヘッダーの再送は 2 回目から拒否する', () => {
  const cache = new A.NonceCache();
  const h = A.createAuthHeader(KEY, 'GET', '/ping', undefined, NOW);
  assert.equal(A.verifyAuthHeader(KEY, h, 'GET', '/ping', { now: NOW, nonceCache: cache }).ok, true);
  assert.equal(A.verifyAuthHeader(KEY, h, 'GET', '/ping', { now: NOW + 10, nonceCache: cache }).reason, 'replay');
});

test('NonceCache: 署名が誤りのリクエストは、記録の枠を使わない / 件数に上限がある / 期限が切れたら再び使える', () => {
  const cache = new A.NonceCache(1000, 10);
  const bad = A.createAuthHeader(A.deriveAuthKey('wrong'), 'GET', '/ping', undefined, NOW);
  for (let i = 0; i < 50; i++) A.verifyAuthHeader(KEY, bad, 'GET', '/ping', { now: NOW, nonceCache: cache });
  assert.equal(cache.seen.size, 0);
  for (let i = 0; i < 100; i++) cache.use('n' + i, NOW);
  assert.ok(cache.seen.size <= 10);
  assert.equal(cache.use('fresh', NOW), true);
  assert.equal(cache.use('fresh', NOW + 500), false);
  assert.equal(cache.use('fresh', NOW + 1001), true, '期限が切れたあとは、再び使える');
});

test('bodyDigest: 本文のすり替えを検出できる', () => {
  const body = 'encrypted-body-1';
  const h = A.createAuthHeader(KEY, 'POST', '/push', body, NOW);
  const r = A.verifyAuthHeader(KEY, h, 'POST', '/push', { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.digest, A.bodyDigest(body));
  assert.notEqual(r.digest, A.bodyDigest('encrypted-body-2'), '別の本文のダイジェストは、一致しない');
  assert.equal(A.bodyDigest(''), '-');
});

// 実際に HTTP のサーバーを立てて、main.js と同じ手順 (ヘッダー検証 → 本文のダイジェスト検証) で確かめる
function startServer(key) {
  const cache = new A.NonceCache();
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: { ...req.headers } });
    const v = A.verifyAuthHeader(key, req.headers['x-bridge-auth'], req.method, req.url, { nonceCache: cache });
    if (!v.ok) {
      res.writeHead(401, { 'x-bridge-auth-error': v.reason });
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (A.bodyDigest(body) !== v.digest) {
        res.writeHead(401, { 'x-bridge-auth-error': 'body' });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('ok');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port })));
}

function request({ port, method = 'GET', path = '/ping', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, reason: res.headers['x-bridge-auth-error'] }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('HTTP の結合: 正しいクライアントは通り、盗聴した通信にも、同期キーは出てこない', async () => {
  const { server, seen, port } = await startServer(KEY);
  try {
    const body = 'cipher-text-payload';
    const h = A.createAuthHeader(KEY, 'POST', '/push', body);
    const ok = await request({ port, method: 'POST', path: '/push', headers: { 'x-bridge-auth': h }, body });
    assert.equal(ok.status, 200);
    const wire = JSON.stringify(seen);   // 盗聴者が見られるもの: URL とヘッダー
    assert.ok(!wire.includes(TOKEN), '同期キーが、通信に出てしまっている');
  } finally {
    server.close();
  }
});

test('HTTP の結合: 攻撃のシナリオ (再送 / すり替え / キー違い / 古い版のヘッダー) をすべて拒否する', async () => {
  const { server, port } = await startServer(KEY);
  try {
    const body = 'payload-A';
    const h = A.createAuthHeader(KEY, 'POST', '/push', body);
    assert.equal((await request({ port, method: 'POST', path: '/push', headers: { 'x-bridge-auth': h }, body })).status, 200);
    // 1. 盗聴したヘッダーと本文を、そのまま再送
    const replay = await request({ port, method: 'POST', path: '/push', headers: { 'x-bridge-auth': h }, body });
    assert.deepEqual([replay.status, replay.reason], [401, 'replay']);
    // 2. 盗聴した (未使用の) ヘッダーに、別の本文を付けて送る
    const h2 = A.createAuthHeader(KEY, 'POST', '/push', 'payload-B');
    const swapped = await request({ port, method: 'POST', path: '/push', headers: { 'x-bridge-auth': h2 }, body: 'old-payload' });
    assert.deepEqual([swapped.status, swapped.reason], [401, 'body']);
    // 3. 違うキーのクライアント
    const wrong = await request({ port, headers: { 'x-bridge-auth': A.createAuthHeader(A.deriveAuthKey('wrong'), 'GET', '/ping') } });
    assert.deepEqual([wrong.status, wrong.reason], [401, 'mac']);
    // 4. 1.x の古い版: 平文のキーを載せたヘッダー
    const legacy = await request({ port, headers: { 'x-bridge-token': TOKEN } });
    assert.deepEqual([legacy.status, legacy.reason], [401, 'missing']);
    // 5. 認証なし
    const none = await request({ port });
    assert.deepEqual([none.status, none.reason], [401, 'missing']);
  } finally {
    server.close();
  }
});
