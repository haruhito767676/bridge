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

test('extractWholeTextPaths: 行全体がパスのときだけ拾う', () => {
  assert.deepEqual(S.extractWholeTextPaths('C:\\Users\\me\\a.txt'), ['C:\\Users\\me\\a.txt']);
  assert.deepEqual(S.extractWholeTextPaths('C:\\a b\\x.pdf\r\nD:\\y.zip\n'), ['C:\\a b\\x.pdf', 'D:\\y.zip']);
  assert.deepEqual(S.extractWholeTextPaths('PS C:\\Users\\me\\GitHub\\bridge> npm start'), []);
  assert.deepEqual(S.extractWholeTextPaths('see C:\\tmp\\x.txt for details'), []);
  assert.deepEqual(S.extractWholeTextPaths(''), []);
  assert.deepEqual(S.extractWholeTextPaths(null), []);
});

test('syncMetadata: フォルダ由来の zip は originKind と folderName を運ぶ', () => {
  const f = S.syncMetadata({ id: '4', type: 'file', name: 'Docs.zip', path: '/tmp/Docs.zip', timestamp: 4, originKind: 'folder', folderName: 'Docs' });
  assert.equal(f.originKind, 'folder');
  assert.equal(f.folderName, 'Docs');
  const plain = S.syncMetadata({ id: '5', type: 'file', name: 'a.zip', path: '/tmp/a.zip', timestamp: 5 });
  assert.equal(plain.originKind, null);
  assert.equal(plain.folderName, null);
});

test('clipboardHistoryFlagExcludes: 値 0 だけが「載せない」、1 は載せてよい、読めなければ安全側', () => {
  assert.equal(S.clipboardHistoryFlagExcludes(Buffer.from([0, 0, 0, 0])), true);
  assert.equal(S.clipboardHistoryFlagExcludes(Buffer.from([1, 0, 0, 0])), false);
  assert.equal(S.clipboardHistoryFlagExcludes(Buffer.from([2, 0, 0, 0])), false);
  assert.equal(S.clipboardHistoryFlagExcludes(Buffer.alloc(0)), true);
  assert.equal(S.clipboardHistoryFlagExcludes(null), true);
  assert.equal(S.clipboardHistoryFlagExcludes(Buffer.from([1])), true);
});

test('shouldReplyToAnnounce: 返信には返さない / 初回は返す / 一定時間は同じ相手に返さない', () => {
  const T = S.DISCOVERY_REPLY_COOLDOWN_MS;
  assert.equal(S.shouldReplyToAnnounce({ app: 'bridge' }, undefined, 1000), true);
  assert.equal(S.shouldReplyToAnnounce({ app: 'bridge', reply: true }, undefined, 1000), false);
  assert.equal(S.shouldReplyToAnnounce({ app: 'bridge' }, 1000, 1000 + T - 1), false);
  assert.equal(S.shouldReplyToAnnounce({ app: 'bridge' }, 1000, 1000 + T), true);
});

// 2 台が「ここにいます」を返し合うシミュレーション。以前は止まらず、毎秒数百個のパケットが飛び続けた
function simulateDiscovery(aIsNew, bIsNew) {
  const nodes = { A: { isNew: aIsNew, last: new Map() }, B: { isNew: bIsNew, last: new Map() } };
  const peerOf = { A: 'B', B: 'A' };
  const queue = [{ to: 'B', from: 'A', info: { app: 'bridge' } }];   // A が起動して、全体へ名乗る
  let now = 0, delivered = 0;
  while (queue.length && delivered < 2000) {
    const m = queue.shift();
    delivered++; now += 1;                                            // 1 通ごとに 1ms 進む
    const node = nodes[m.to];
    const reply = node.isNew
      ? S.shouldReplyToAnnounce(m.info, node.last.get(m.from), now)
      : true;                                                         // 古い版: 印を見ずに、常に返す
    if (reply) {
      if (node.isNew) node.last.set(m.from, now);
      queue.push({ to: m.from, from: m.to, info: node.isNew ? { app: 'bridge', reply: true } : { app: 'bridge' } });
    }
  }
  return delivered;
}

test('デバイス発見: 新しい版どうし・新旧の組み合わせで、返し合いが数通で止まる', () => {
  assert.ok(simulateDiscovery(true, true) <= 4, '新 + 新');
  assert.ok(simulateDiscovery(true, false) <= 6, '新 + 旧');
  assert.ok(simulateDiscovery(false, true) <= 6, '旧 + 新');
  assert.equal(simulateDiscovery(false, false), 2000, '旧 + 旧は、これまで通り止まらない (上限まで続く)');
});
