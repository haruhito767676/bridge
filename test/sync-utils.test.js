const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/sync-utils.js');

test('tokensMatch: 一致 / 不一致 / 空', () => {
  assert.equal(S.tokensMatch('abc', 'abc'), true);
  assert.equal(S.tokensMatch('abc', 'abd'), false);
  assert.equal(S.tokensMatch('abc', 'abcd'), false);
  assert.equal(S.tokensMatch('', ''), false);
  assert.equal(S.tokensMatch(undefined, 'abc'), false);
});

test('tokenIdentifierOf: 同じキーなら同じ ID、長さ 16', () => {
  assert.equal(S.tokenIdentifierOf('k'), S.tokenIdentifierOf('k'));
  assert.notEqual(S.tokenIdentifierOf('k'), S.tokenIdentifierOf('j'));
  assert.equal(S.tokenIdentifierOf('k').length, 16);
});

test('sanitizeSyncFileName: パス区切りと禁止文字を潰す', () => {
  assert.equal(S.sanitizeSyncFileName('../../etc/passwd'), '.._.._etc_passwd');
  assert.equal(S.sanitizeSyncFileName('a:b*c?.txt'), 'a_b_c_.txt');
  assert.match(S.sanitizeSyncFileName(''), /^synced-\d+$/);
});

test('extractFileUrlPaths: file:// URL を絶対パスへ', () => {
  const paths = S.extractFileUrlPaths('x file:///Users/me/a%20b.txt y');
  assert.deepEqual(paths, ['/Users/me/a b.txt']);
  assert.deepEqual(S.extractFileUrlPaths(''), []);
});

test('extractWindowsAbsolutePaths: C:\\ 形式を拾い、末尾の句読点を落とす', () => {
  const paths = S.extractWindowsAbsolutePaths('copied C:\\Users\\me\\doc.txt.');
  assert.deepEqual(paths, ['C:\\Users\\me\\doc.txt']);
});

test('syncMetadata: テキストは本文を含み、ファイルは hasFile', () => {
  const t = S.syncMetadata({ id: '1', type: 'text', text: 'hi', timestamp: 1 });
  assert.equal(t.text, 'hi');
  assert.equal(t.hasFile, false);
  const f = S.syncMetadata({ id: '2', type: 'file', name: 'a.zip', path: '/tmp/a.zip', timestamp: 2 });
  assert.equal(f.text, null);
  assert.equal(f.hasFile, true);
  const gone = S.syncMetadata({ id: '3', type: 'image', name: 'a.png', path: null, timestamp: 3 });
  assert.equal(gone.hasFile, false);
});

test('compareVersions', () => {
  assert.ok(S.compareVersions('0.2.0', '0.1.0') > 0);
  assert.ok(S.compareVersions('v0.1.0', '0.1.0') === 0);
  assert.ok(S.compareVersions('0.1.0', '0.1.1') < 0);
  assert.ok(S.compareVersions('1.0', '0.9.9') > 0);
});
