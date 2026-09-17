// 同期通信 (HTTP) のペイロード暗号化。secretToken (デバイス間で手動で揃える共有シークレット) から
// 導出した鍵で AES-256-GCM 暗号化する。secretToken 自体は既に isAuthorizedRequest で「誰が
// 話しかけてよいか」の認証に使われているが、通信路自体は平文 HTTP のため、同一 LAN 上の
// 第三者 (フリー Wi-Fi の相席客など) からの盗聴・改ざんに対しては無防備だった。
// ここではその通信内容 (JSON メタデータ・ファイル実体) を暗号化し、盗聴対策を追加する。
const crypto = require('crypto');
const { Transform } = require('stream');

const ALGO = 'aes-256-gcm';
const NONCE_LEN = 12; // AES-GCM の推奨ノンス長
const TAG_LEN = 16;
const SALT_LEN = 8; // ストリーム毎のランダム値。残り4バイトはチャンク連番でノンスを組み立てる
const CHUNK_SIZE = 64 * 1024; // ファイル暗号化の論理チャンクサイズ (平文ベース)
const LEN_PREFIX = 4;

// secretToken (人間が手入力する短い文字列のこともある) をそのまま鍵にせず、HKDF で
// 用途固定 (info) の 32byte 鍵へ引き伸ばす。token が変わるたびに main.js 側でキャッシュし直す想定
function deriveSyncKey(token) {
  const out = crypto.hkdfSync('sha256', String(token || ''), Buffer.alloc(0), 'bridge-sync-v1', 32);
  return Buffer.from(out);
}

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

// 小さな JSON メッセージ (/ping, /items, /push) 用。iv(12) + tag(16) + 暗号文を base64 にまとめて返す
function encryptJson(key, obj) {
  const iv = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptJson(key, envelopeBase64) {
  const buf = Buffer.from(String(envelopeBase64 || ''), 'base64');
  if (buf.length < NONCE_LEN + TAG_LEN) throw new Error('暗号ペイロードが不正です');
  const iv = buf.subarray(0, NONCE_LEN);
  const tag = buf.subarray(NONCE_LEN, NONCE_LEN + TAG_LEN);
  const ciphertext = buf.subarray(NONCE_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

// ファイル実体 (数GBもありうる) 用。一括読み込みせず、64KiB 単位で
// [4byte 長さ][暗号文+tag] というフレームへ区切りながらパイプで流す。
// ノンスはストリーム毎のランダム salt(8byte) + チャンク連番(4byte) で組み立て、
// 同一ストリーム内での再利用を防ぐ (salt は呼び出し側が x-bridge-salt ヘッダーで相手に伝える)
function createEncryptStream(key) {
  const salt = crypto.randomBytes(SALT_LEN);
  let counter = 0;
  let buffered = Buffer.alloc(0);

  function encryptChunk(plain) {
    const nonce = Buffer.concat([salt, u32be(counter++)]);
    const cipher = crypto.createCipheriv(ALGO, key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const frame = Buffer.concat([ciphertext, tag]);
    return Buffer.concat([u32be(frame.length), frame]);
  }

  const stream = new Transform({
    transform(chunk, _enc, cb) {
      buffered = Buffer.concat([buffered, chunk]);
      const frames = [];
      while (buffered.length >= CHUNK_SIZE) {
        frames.push(encryptChunk(buffered.subarray(0, CHUNK_SIZE)));
        buffered = buffered.subarray(CHUNK_SIZE);
      }
      cb(null, frames.length ? Buffer.concat(frames) : undefined);
    },
    flush(cb) {
      if (buffered.length > 0) return cb(null, encryptChunk(buffered));
      cb();
    },
  });
  stream.salt = salt;
  return stream;
}

// 平文サイズから、上の framing を通した後の正確なバイト数を計算する (Content-Length 用)
function encryptedFileLength(plainSize) {
  if (!plainSize || plainSize <= 0) return 0;
  const numChunks = Math.ceil(plainSize / CHUNK_SIZE);
  return plainSize + numChunks * (LEN_PREFIX + TAG_LEN);
}

// createEncryptStream の逆変換。フレーム境界を跨ぐ TCP パケット分割があっても、
// 長さプレフィックスで正しくチャンクを再構成してから復号する
function createDecryptStream(key, saltBase64) {
  const salt = Buffer.from(String(saltBase64 || ''), 'base64');
  let counter = 0;
  let buffered = Buffer.alloc(0);

  return new Transform({
    transform(chunk, _enc, cb) {
      buffered = Buffer.concat([buffered, chunk]);
      const plains = [];
      try {
        for (;;) {
          if (buffered.length < LEN_PREFIX) break;
          const frameLen = buffered.readUInt32BE(0);
          if (buffered.length < LEN_PREFIX + frameLen) break;
          const frame = buffered.subarray(LEN_PREFIX, LEN_PREFIX + frameLen);
          buffered = buffered.subarray(LEN_PREFIX + frameLen);
          const tag = frame.subarray(frame.length - TAG_LEN);
          const ciphertext = frame.subarray(0, frame.length - TAG_LEN);
          const nonce = Buffer.concat([salt, u32be(counter++)]);
          const decipher = crypto.createDecipheriv(ALGO, key, nonce);
          decipher.setAuthTag(tag);
          plains.push(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
        }
      } catch (err) {
        cb(err);
        return;
      }
      cb(null, plains.length ? Buffer.concat(plains) : undefined);
    },
    flush(cb) {
      if (buffered.length > 0) return cb(new Error('暗号ストリームが途中で切れています'));
      cb();
    },
  });
}

module.exports = {
  deriveSyncKey,
  encryptJson,
  decryptJson,
  createEncryptStream,
  createDecryptStream,
  encryptedFileLength,
};
