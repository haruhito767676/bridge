// Main とテストの両方から使う純粋関数 (同期・クリップボード検知の補助)
const crypto = require('crypto');
const { fileURLToPath } = require('url');

// secretToken の定数時間比較。長さが違う場合は timingSafeEqual に渡す前に弾く
function tokensMatch(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  return a.length > 0 && b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 同期キーそのものは流さず、ハッシュの先頭 16 文字だけで「同じキーを持つ相手か」を判定する
function tokenIdentifierOf(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
}

// 受信したファイル名からパス区切りや禁止文字を除く (相手が細工した名前でディレクトリを抜けさせない)
function sanitizeSyncFileName(name) {
  const cleaned = String(name || '').replace(/[/\\:*?"<>|]/g, '_').trim();
  return cleaned || `synced-${Date.now()}`;
}

// テキストの中から file:// URL を探して絶対パスへ変換する (Windows/Mac 共通のパーサー)
function extractFileUrlPaths(text) {
  const paths = [];
  if (!text) return paths;
  for (const m of text.matchAll(/file:\/\/\/?[^\s"'<>]+/gi)) {
    try {
      const p = fileURLToPath(m[0]);
      if (p) paths.push(p);
    } catch {
      // URL として不正な断片はスキップ
    }
  }
  return paths;
}

// テキストの中から "C:\..." 形式の Windows 絶対パスを探す
function extractWindowsAbsolutePaths(text) {
  const paths = [];
  if (!text) return paths;
  for (const m of text.matchAll(/[A-Za-z]:\\[^\r\n"<>|?*]+/g)) {
    const p = m[0].trim().replace(/[.,;:]+$/, '');
    if (p) paths.push(p);
  }
  return paths;
}

// テキスト全体が「1 行に 1 つのパス」だけで構成されているときに限り、そのパス群を返す。
// ターミナルのプロンプト行のように文中にパスが混じるだけのコピーは空配列 (ファイル扱いにしない)
function extractWholeTextPaths(text) {
  if (typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0 || lines.length > 200) return [];
  const paths = [];
  for (const line of lines) {
    if (/^file:\/\//i.test(line)) {
      try {
        paths.push(fileURLToPath(line));
        continue;
      } catch {
        return [];
      }
    }
    // "C:\..." または "\\server\share\..." で始まり、行全体がパスであること (空白を含んでもよい)
    if (/^(?:[A-Za-z]:\\|\\\\)[^\r\n"<>|?*]+$/.test(line)) {
      paths.push(line);
      continue;
    }
    return [];
  }
  return paths;
}

// ピアへ送るメタデータ (実体ファイルは含めず、hasFile なら /file?id= で別途転送する)
function syncMetadata(entry) {
  return {
    id: entry.id,
    type: entry.type,
    name: entry.name,
    text: entry.type === 'text' ? entry.text : null,
    timestamp: entry.timestamp,
    fromDevice: entry.fromDevice,
    fromPlatform: entry.fromPlatform,
    hasFile: entry.type !== 'text' && !!entry.path,
    // フォルダを zip 化したものなら 'folder' と元のフォルダ名。受信側はこれを見て展開する
    originKind: entry.originKind === 'folder' ? 'folder' : null,
    folderName: entry.originKind === 'folder' ? entry.folderName || null : null,
  };
}

// "1.2.3" 形式のバージョン比較。a が b より新しければ正、同じなら 0、古ければ負
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Windows の CanIncludeInClipboardHistory は DWORD で、0 のときだけ「履歴に載せないで」の意味。
// Snipping Tool (Win+Shift+S) や Office などの普通のコピーも、値 1 (載せてよい) でこの形式を付けるため、
// 形式が付いているだけでは「隠されたコピー」にしない。値が読めないときは、安全側 (載せない) に倒す
function clipboardHistoryFlagExcludes(buf) {
  if (!buf || buf.length < 4) return true;
  return buf.readUInt32LE(0) === 0;
}

module.exports = {
  clipboardHistoryFlagExcludes,
  tokensMatch,
  tokenIdentifierOf,
  sanitizeSyncFileName,
  extractFileUrlPaths,
  extractWindowsAbsolutePaths,
  extractWholeTextPaths,
  syncMetadata,
  compareVersions,
};
