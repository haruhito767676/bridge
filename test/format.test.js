const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/format.js');

test('formatFileName: 短い名前はそのまま', () => {
  assert.equal(F.formatFileName('report.pdf', true), 'report.pdf');
  assert.equal(F.formatFileName('写真.jpg', true), '写真.jpg');
});

test('formatFileName: 長い名前は拡張子を守って中央省略する', () => {
  const name = 'a-very-long-file-name-that-keeps-going-forever.pdf';
  const out = F.formatFileName(name, true);
  assert.ok(out.endsWith('.pdf'));
  assert.ok(out.includes('…'));
  assert.ok(F.countUnits(out) <= F.NAME_MAX_UNITS + 2);
});

test('formatFileName: 拡張子なし (フォルダ) は末尾省略', () => {
  const out = F.formatFileName('とても長いフォルダ名がここにあります本当に長い', false);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('.'));
});

test('formatFileName: 絵文字 (サロゲートペア) を分断しない', () => {
  const out = F.formatFileName('😀'.repeat(40) + '.png', true);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out.replace('.png', '').split('…')[0]));
});

test('splitNameExt: 隠しファイルは拡張子扱いしない', () => {
  assert.deepEqual(F.splitNameExt('.gitignore'), { base: '.gitignore', ext: '' });
  assert.deepEqual(F.splitNameExt('archive.tar.gz'), { base: 'archive.tar', ext: '.gz' });
});

test('charUnits: 半角 1 / 全角・英大文字 2', () => {
  assert.equal(F.charUnits('a'), 1);
  assert.equal(F.charUnits('A'), 2);
  assert.equal(F.charUnits('あ'), 2);
});

test('urlOfText: 1 本の URL だけをリンク扱いにする', () => {
  assert.equal(F.urlOfText('  https://example.com/x?y=1 '), 'https://example.com/x?y=1');
  assert.equal(F.urlOfText('see https://example.com'), null);
  assert.equal(F.urlOfText('ftp://example.com'), null);
  assert.equal(F.urlOfText(null), null);
});

test('extractWebUrlFromData: img の src を最優先で取る', () => {
  const url = F.extractWebUrlFromData({
    html: '<img src="https://img.example.com/a.png?x=1&amp;y=2">',
    uriList: 'https://page.example.com/',
    plain: 'https://page.example.com/',
  });
  assert.equal(url, 'https://img.example.com/a.png?x=1&y=2');
});

test('extractWebUrlFromData: uri-list のコメント行を飛ばす', () => {
  const url = F.extractWebUrlFromData({ html: '', uriList: '# comment\nhttps://a.example.com/f.zip', plain: '' });
  assert.equal(url, 'https://a.example.com/f.zip');
});

test('extractWebUrlFromData: 何も無ければ null', () => {
  assert.equal(F.extractWebUrlFromData({ html: '', uriList: '', plain: 'just text' }), null);
});

test('sectionLabel: 今日 / 昨日 / 日付 / 年またぎ', () => {
  const now = new Date(2026, 8, 11, 15, 0, 0);
  const day = 86400000;
  assert.equal(F.sectionLabel(now.getTime() - 1000, now), '今日');
  assert.equal(F.sectionLabel(now.getTime() - day, now), '昨日');
  assert.equal(F.sectionLabel(new Date(2026, 8, 6).getTime(), now), '9月6日 (日)');
  assert.equal(F.sectionLabel(new Date(2025, 11, 31).getTime(), now), '2025年12月31日 (水)');
});

test('formatMetaLine: 短い種別名はそのまま時刻と結合する', () => {
  const ts = new Date(2026, 0, 1, 9, 5).getTime();
  assert.equal(F.formatMetaLine('画像', ts), '画像 · 9:05');
});

test('formatMetaLine: 拡張子由来の長い種別名は時刻が見切れないよう省略する', () => {
  const ts = new Date(2026, 0, 1, 9, 5).getTime();
  const out = F.formatMetaLine('APPLESCRIPTスクリプトファイルフォーマットファイル', ts);
  assert.ok(out.endsWith(' · 9:05'));
  assert.ok(out.includes('…'));
  assert.ok(F.countUnits(out) <= F.META_MAX_UNITS + 1);
});

test('formatTime: 分を 2 桁にする', () => {
  assert.equal(F.formatTime(new Date(2026, 0, 1, 9, 5).getTime()), '9:05');
});
