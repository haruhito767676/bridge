const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../lib/sync-crypto.js');

test('encryptJson / decryptJson: 往復して同じ値に戻る', () => {
  const key = C.deriveSyncKey('shared-secret');
  const obj = { app: 'bridge', items: [{ id: '1', text: 'hello' }] };
  const envelope = C.encryptJson(key, obj);
  assert.deepEqual(C.decryptJson(key, envelope), obj);
});

test('decryptJson: 違う鍵では復号できない', () => {
  const envelope = C.encryptJson(C.deriveSyncKey('a'), { x: 1 });
  assert.throws(() => C.decryptJson(C.deriveSyncKey('b'), envelope));
});

test('deriveSyncKey: 同じトークンなら同じ鍵、違えば別の鍵', () => {
  assert.ok(C.deriveSyncKey('t').equals(C.deriveSyncKey('t')));
  assert.ok(!C.deriveSyncKey('t').equals(C.deriveSyncKey('u')));
});

function collectStream(stream, input) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    stream.end(input);
  });
}

test('createEncryptStream / createDecryptStream: 往復して元のバイト列に戻る (空・端数・複数チャンク境界)', async () => {
  const key = C.deriveSyncKey('file-secret');
  for (const size of [0, 1, 65536, 65537, 300000]) {
    const data = crypto.randomBytes(size);
    const enc = C.createEncryptStream(key);
    const encoded = await collectStream(enc, data);
    assert.equal(encoded.length, C.encryptedFileLength(size));
    const dec = C.createDecryptStream(key, enc.salt.toString('base64'));
    const decoded = await collectStream(dec, encoded);
    assert.ok(decoded.equals(data), `size=${size}`);
  }
});

test('createDecryptStream: 改ざんされたフレームは tag 検証で拒否する', async () => {
  const key = C.deriveSyncKey('file-secret');
  const data = crypto.randomBytes(100000);
  const enc = C.createEncryptStream(key);
  const encoded = await collectStream(enc, data);
  encoded[encoded.length - 3] ^= 0xff; // 末尾フレーム内を破壊
  const dec = C.createDecryptStream(key, enc.salt.toString('base64'));
  await assert.rejects(() => collectStream(dec, encoded));
});
