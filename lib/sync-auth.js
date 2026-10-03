// 同期通信 (HTTP) の認証。Main とテストの両方から使う。
//
// 以前 (1.x) は、同期キーそのものを `x-bridge-token` ヘッダーに載せて、平文の HTTP で送っていた。
// 内容の暗号化の鍵も同じキーから作っていたため、同じネットワークで通信を観察できる人が、
// キーを読み取って、すべての内容を復号できた。
// 2.0 から、キーはネットワークに流さず、「キーを知っている証明」(HMAC) だけを送る。
//
//   x-bridge-auth: 2.<timestamp>.<nonce>.<bodyDigest>.<mac>
//   mac = base64url( HMAC-SHA256(authKey, METHOD \n path \n timestamp \n nonce \n bodyDigest) )
//
// - authKey は、同期キーから、暗号化の鍵とは別の用途 (info) で導出する (用途ごとに鍵を分ける)
// - timestamp: 送信時刻 (ms)。±AUTH_WINDOW_MS を超えて離れたものは受け付けない
// - nonce: 使い捨ての乱数。同じものを 2 度受け付けない (再送の対策)
// - bodyDigest: リクエスト本文の SHA-256。本文が無いときは "-"。本文のすり替えを防ぐ
const crypto = require('crypto');

const AUTH_VERSION = '2';
const AUTH_WINDOW_MS = 60 * 1000;
const NONCE_CACHE_MAX = 10000;

function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

// 同期キー → 認証用の鍵。暗号化の鍵 (info=bridge-sync-v1、sync-crypto.js) とは別の鍵になる
function deriveAuthKey(token) {
  return Buffer.from(crypto.hkdfSync('sha256', String(token || ''), Buffer.alloc(0), 'bridge-auth-v1', 32));
}

function bodyDigest(body) {
  if (body === undefined || body === null || body.length === 0) return '-';
  return b64u(crypto.createHash('sha256').update(body).digest());
}

function computeMac(authKey, method, pathAndQuery, timestamp, nonce, digest) {
  const input = [String(method).toUpperCase(), pathAndQuery, timestamp, nonce, digest].join('\n');
  return b64u(crypto.createHmac('sha256', authKey).update(input).digest());
}

// クライアント側: ヘッダーの値を作る
function createAuthHeader(authKey, method, pathAndQuery, body, now = Date.now(), nonceBytes = crypto.randomBytes(16)) {
  const timestamp = String(Math.floor(now));
  const nonce = b64u(nonceBytes);
  const digest = bodyDigest(body);
  const mac = computeMac(authKey, method, pathAndQuery, timestamp, nonce, digest);
  return `${AUTH_VERSION}.${timestamp}.${nonce}.${digest}.${mac}`;
}

function parseAuthHeader(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 5 || parts[0] !== AUTH_VERSION) return null;
  const [, timestamp, nonce, digest, mac] = parts;
  if (!/^\d{10,16}$/.test(timestamp) || !nonce || !digest || !mac) return null;
  return { timestamp, nonce, digest, mac };
}

// 使った nonce を覚えておく入れ物。メモリを使い切らないよう、件数に上限を付ける
class NonceCache {
  constructor(ttlMs = AUTH_WINDOW_MS * 2, max = NONCE_CACHE_MAX) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.seen = new Map(); // nonce → 期限
  }

  // 初めて見た nonce なら記録して true。すでに見ていれば false
  use(nonce, now = Date.now()) {
    if (this.seen.size >= this.max / 2) this.prune(now);
    const expiry = this.seen.get(nonce);
    if (expiry !== undefined && expiry > now) return false;
    this.seen.set(nonce, now + this.ttlMs);
    while (this.seen.size > this.max) this.seen.delete(this.seen.keys().next().value); // 古いものから捨てる
    return true;
  }

  prune(now = Date.now()) {
    for (const [nonce, expiry] of this.seen) if (expiry <= now) this.seen.delete(nonce);
  }
}

// サーバー側: ヘッダーを検証する。
// reason: 'missing' (ヘッダー無し = 古い版) / 'format' / 'skew' (時計のずれ) / 'mac' (キー違い・改ざん) / 'replay'
function verifyAuthHeader(authKey, header, method, pathAndQuery, { now = Date.now(), nonceCache, windowMs = AUTH_WINDOW_MS } = {}) {
  if (header === undefined || header === null || header === '') return { ok: false, reason: 'missing' };
  const parsed = parseAuthHeader(header);
  if (!parsed) return { ok: false, reason: 'format' };
  if (Math.abs(now - Number(parsed.timestamp)) > windowMs) return { ok: false, reason: 'skew' };
  const expected = computeMac(authKey, method, pathAndQuery, parsed.timestamp, parsed.nonce, parsed.digest);
  const a = Buffer.from(expected);
  const b = Buffer.from(parsed.mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'mac' };
  // 署名が正しいものだけ nonce を記録する (でたらめなリクエストで、記録の枠を埋められないように)
  if (nonceCache && !nonceCache.use(parsed.nonce, now)) return { ok: false, reason: 'replay' };
  return { ok: true, digest: parsed.digest };
}

module.exports = {
  AUTH_WINDOW_MS,
  deriveAuthKey,
  bodyDigest,
  createAuthHeader,
  parseAuthHeader,
  verifyAuthHeader,
  NonceCache,
};
