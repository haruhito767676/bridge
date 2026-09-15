// Renderer とテストの両方から使う純粋関数 (表示用の整形)。
// ブラウザでは <script> で読み込んで window.BridgeFormat に、Node では module.exports に載せる
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BridgeFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ファイル名を「拡張子を除いた本体」と「拡張子」に分割する
  function splitNameExt(name) {
    const dotIndex = name.lastIndexOf('.');
    const hasExt = dotIndex > 0 && dotIndex < name.length - 1; // 先頭ドット(隠しファイル)は拡張子扱いしない
    return hasExt ? { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) } : { base: name, ext: '' };
  }

  // 視覚幅カウント: 全角文字・英大文字 = 2、半角英数・記号 (ASCII) = 1
  function charUnits(ch) {
    const cp = ch.codePointAt(0);
    const isHalfAscii = cp >= 0x20 && cp <= 0x7e;
    const isUpper = cp >= 0x41 && cp <= 0x5a;
    return isHalfAscii && !isUpper ? 1 : 2;
  }

  function countUnits(text) {
    let total = 0;
    for (const ch of text) total += charUnits(ch);
    return total;
  }

  // 先頭 (fromEnd=true なら末尾) からカウント maxUnits 分の文字列を切り出す。
  // Array.from でコードポイント単位に扱い、サロゲートペア (絵文字等) を分断しない
  function sliceUnits(text, maxUnits, fromEnd) {
    const chars = Array.from(text);
    if (fromEnd) chars.reverse();
    const out = [];
    let total = 0;
    for (const ch of chars) {
      total += charUnits(ch);
      if (total > maxUnits) break;
      out.push(ch);
    }
    if (fromEnd) out.reverse();
    return out.join('');
  }

  // 行の幅 (先頭スロットと削除ボタンを除いた約 220px) に収まるカウント数。
  // 拡張子ありは「先頭 + … + 末尾 + 拡張子」の中央省略、拡張子なし (フォルダ等) は末尾省略
  const NAME_MAX_UNITS = 30;
  const NAME_TAIL_UNITS = 6;

  function formatFileName(name, hasExt) {
    const { base, ext } = hasExt ? splitNameExt(name) : { base: name, ext: '' };
    if (countUnits(base) + countUnits(ext) <= NAME_MAX_UNITS) return base + ext;
    if (!ext) return sliceUnits(base, NAME_MAX_UNITS - 1, false) + '…';
    const headUnits = Math.max(4, NAME_MAX_UNITS - NAME_TAIL_UNITS - countUnits(ext) - 1);
    return sliceUnits(base, headUnits, false) + '…' + sliceUnits(base, NAME_TAIL_UNITS, true) + ext;
  }

  // テキストが「1 本の URL」か (リンクとして開けるもの)。該当すれば整形済み URL、でなければ null
  function urlOfText(text) {
    if (typeof text !== 'string') return null;
    const t = text.trim();
    return /^https?:\/\/\S+$/i.test(t) ? t : null;
  }

  // ドロップされた dataTransfer の中身 ({ html, uriList, plain }) から Web 画像/リンクの URL を取り出す
  function extractWebUrlFromData({ html, uriList, plain }) {
    // Web 画像のドラッグでは text/html に <img src="..."> が入ることが多く、
    // ここから取るのが最も確実 (uri-list はページ URL の場合がある)
    if (html) {
      const m = /<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(html);
      if (m) return m[1].replace(/&amp;/g, '&');
    }
    // text/uri-list: 1行1URL。# で始まる行はコメント
    if (uriList) {
      const line = uriList
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'));
      if (line && /^https?:\/\//i.test(line)) return line;
    }
    // text/plain: テキスト中の最初の http(s) URL を拾う
    const m = /https?:\/\/\S+/i.exec(plain || '');
    return m ? m[0] : null;
  }

  const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  function dayKey(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  // 日付セクションの見出し。「今日」「昨日」、それ以前は日付 (年が違えば年も付ける)。now はテスト用に差し替え可
  function sectionLabel(timestamp, now = new Date()) {
    const d = new Date(timestamp);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.floor((startOfToday - startOfDay) / 86400000);
    if (diffDays <= 0) return '今日';
    if (diffDays === 1) return '昨日';
    const base = `${d.getMonth() + 1}月${d.getDate()}日 (${WEEKDAYS[d.getDay()]})`;
    return d.getFullYear() === now.getFullYear() ? base : `${d.getFullYear()}年${base}`;
  }

  function formatTime(timestamp) {
    const d = new Date(timestamp);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // meta 行 (「種別 · 時刻」、11px) の目安幅。拡張子由来の種別名 (例: 「APPLESCRIPTファイル」) が
  // 長すぎて時刻 (末尾) が見切れることがあるため、時刻分の幅を確保してから種別名を省略する
  const META_MAX_UNITS = 34;

  // 「kindLabel · HH:MM」を組み立てる。kindLabel が長すぎて時刻が見切れそうなときは
  // 時刻の分だけ幅を確保したうえで kindLabel を末尾 "…" で省略する
  function formatMetaLine(kindLabel, timestamp) {
    if (!timestamp) return kindLabel;
    const suffix = ` · ${formatTime(timestamp)}`;
    const labelBudget = META_MAX_UNITS - countUnits(suffix);
    const label =
      countUnits(kindLabel) <= labelBudget ? kindLabel : sliceUnits(kindLabel, Math.max(1, labelBudget - 1), false) + '…';
    return `${label}${suffix}`;
  }

  return {
    splitNameExt,
    charUnits,
    countUnits,
    sliceUnits,
    formatFileName,
    urlOfText,
    extractWebUrlFromData,
    dayKey,
    sectionLabel,
    formatTime,
    formatMetaLine,
    NAME_MAX_UNITS,
    META_MAX_UNITS,
  };
});
