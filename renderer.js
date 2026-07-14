// シェルフのアイテム (最新順)。kind: 'file' | 'clip-text' | 'clip-image'
// { kind, path, name, text, icon, isImage, downloading, removing, timestamp, fileKind, fromDevice, fromPlatform }
// fileKind: kind === 'file' のアイテムに非同期で付与される Finder 純正の種類名 (例:「PDF書類」「フォルダ」)
// fromDevice: 出身デバイス名。null / 自分のデバイス名なら「ローカル」、他拠点から同期されたものはその拠点名
// fromPlatform: 出身デバイスの OS ('darwin' | 'win32' 等)。バッジの色分けに使う
const items = [];
const selectedItems = new Set();
let lastSelectedIndex = null;

const dropZone = document.getElementById('drop-zone');
const listEl = document.getElementById('file-list');
const emptyEl = document.getElementById('empty-state');
const emptyLabel = emptyEl.querySelector('.empty-label');
const countEl = document.getElementById('item-count');
const clearBtn = document.getElementById('clear-button');
const searchBar = document.getElementById('search-bar');
const suggestEl = document.getElementById('search-suggest');
const badgeEl = document.getElementById('filter-badge');
const badgeLabel = document.getElementById('filter-badge-label');
const badgeRemove = document.getElementById('filter-badge-remove');

// ---- 自分のデバイス情報 (出身デバイスバッジの「ローカル / 拠点名」判定に使う) ----

let localDeviceName = '';
window.bridge
  .getDeviceInfo()
  .then((info) => {
    if (info && info.device) {
      localDeviceName = info.device;
      render(); // 取得前に描画済みのバッジを正しい判定で描き直す
    }
  })
  .catch(() => {}); // 取得に失敗してもバッジ判定が「すべて外部扱い」になるだけで動作は続く

// ---- スマート検索 (フィルターバッジ + サジェスト + インクリメンタル絞り込み) ----

// 現在表示中のアイテム (検索フィルター適用後、items と同じく最新順)。
// render() が更新し、矩形選択・Shift 範囲選択・⌘A の添字は常にこの配列を基準にする
let visibleItems = [];
let searchQuery = '';

// 種別フィルターは「Tab / Enter でバッジ化が確定したときだけ」有効になるモードフラグで持つ。
// 生の入力文字列に ":file" 等がたまたま含まれていてもフィルターとは解釈しない (誤検知の完全回避)
let filterMode = null; // 'file' | 'clip' | null

function filterItems() {
  const keyword = searchQuery.trim().toLowerCase();
  // バッジ未確定の ":xxx" 入力中はコマンド候補の打鍵途中なので、キーワードとして絞り込まない
  const pendingCommand = !filterMode && keyword.startsWith(':');
  if (!filterMode && (!keyword || pendingCommand)) return items.slice();

  return items.filter((item) => {
    if (filterMode === 'file' && item.kind !== 'file') return false;
    if (filterMode === 'clip' && item.kind === 'file') return false;
    if (!keyword || pendingCommand) return true;
    // ファイル名・パス・テキストの中身への部分一致
    const haystack = [item.name, item.path, item.text]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

// ---- サジェスト (「:」入力で file / clip を検索窓直下に浮き出させる) ----

const FILTER_SUGGESTIONS = [
  { mode: 'file', label: 'file' }, // 一時保存ファイル (.user-dropped) のみ
  { mode: 'clip', label: 'clip' }, // クリップボード履歴 (.clipboard-history) のみ
];
// バッジ内表示名: コマンド文字列ではなく名詞に変換 (内部の filterMode フラグはコマンド名のまま保持)
const FILTER_BADGE_LABELS = {
  file: 'ファイル',
  clip: 'クリップボード',
};
let suggestIndex = -1; // Tab / ↑↓ キーで動くハイライト位置。-1 は「未選択」(Enter は通常の文字検索として扱う)

// 現在の入力に対して表示すべき候補。バッジ確定済み、または「:」始まりでなければ空
function currentSuggestions() {
  if (filterMode) return [];
  const value = searchBar.value;
  if (!value.startsWith(':')) return [];
  const typed = value.slice(1).split(/\s/)[0].toLowerCase();
  return FILTER_SUGGESTIONS.filter((s) => s.label.startsWith(typed));
}

function renderSuggest() {
  const matches = currentSuggestions();
  suggestEl.textContent = '';
  if (matches.length === 0 || document.activeElement !== searchBar) {
    suggestEl.hidden = true;
    return;
  }
  if (suggestIndex >= matches.length) suggestIndex = 0;
  matches.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = s.label; // 絵文字などの装飾なし、テキストのみ
    if (i === suggestIndex) li.classList.add('active');
    // click だと先に blur が走ってサジェストが消えるため mousedown で確定する
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      commitFilter(s.mode);
    });
    suggestEl.appendChild(li);
  });
  suggestEl.hidden = false;
}

// サジェストの確定: 入力中の ":xxx" を検索窓左端のテキストバッジへ吸着させる。
// ":file foo" のように後続キーワードが打たれていればそれは入力欄に残し、続けて絞り込める
function commitFilter(mode) {
  filterMode = mode;
  badgeLabel.textContent = FILTER_BADGE_LABELS[mode];
  badgeEl.classList.add('search-badge');
  badgeEl.classList.toggle('badge-file', mode === 'file');
  badgeEl.classList.toggle('badge-clip', mode === 'clip');
  badgeEl.hidden = false;
  const v = searchBar.value;
  searchBar.value = v.startsWith(':') ? v.replace(/^:\S*\s*/, '') : v;
  searchQuery = searchBar.value;
  suggestIndex = -1;
  selectedItems.clear();
  lastSelectedIndex = null;
  renderSuggest(); // filterMode が立ったので必ず隠れる
  searchBar.focus();
  render();
}

function clearFilterBadge() {
  if (!filterMode) return;
  filterMode = null;
  badgeEl.hidden = true;
  badgeLabel.textContent = '';
  badgeEl.classList.remove('search-badge', 'badge-file', 'badge-clip');
  suggestIndex = -1;
  selectedItems.clear();
  lastSelectedIndex = null;
  renderSuggest();
  render();
}

// 検索窓・バッジ・サジェスト・選択状態をまとめて初期状態へ戻す (全リスト表示に復帰)
function resetSearchState() {
  searchBar.value = '';
  searchQuery = '';
  filterMode = null;
  badgeEl.hidden = true;
  badgeLabel.textContent = '';
  badgeEl.classList.remove('search-badge', 'badge-file', 'badge-clip');
  suggestIndex = -1;
  suggestEl.hidden = true;
  suggestEl.textContent = '';
  selectedItems.clear();
  lastSelectedIndex = null;
  render();
}

badgeRemove.addEventListener('click', () => {
  clearFilterBadge();
  searchBar.focus();
});

searchBar.addEventListener('input', () => {
  searchQuery = searchBar.value;
  suggestIndex = -1;
  // 絞り込みで見えなくなったアイテムが選択されたまま残らないようにする
  selectedItems.clear();
  lastSelectedIndex = null;
  renderSuggest();
  render();
});

searchBar.addEventListener('focus', () => {
  suggestIndex = -1;
  renderSuggest();
});
searchBar.addEventListener('blur', () => {
  suggestEl.hidden = true;
});

searchBar.addEventListener('keydown', (e) => {
  const matches = currentSuggestions();

  // サジェスト表示中: Tab / ↑↓ でハイライトを順番に移動。Enter はハイライト済みの項目がある時だけ確定する
  // (何も選択されていない状態の Enter はここでは何もせず、通常の文字検索として扱われる)
  if (matches.length > 0 && !suggestEl.hidden) {
    if (e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const forward = e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey);
      if (suggestIndex === -1) {
        suggestIndex = forward ? 0 : matches.length - 1;
      } else {
        suggestIndex = (suggestIndex + (forward ? 1 : matches.length - 1)) % matches.length;
      }
      renderSuggest();
      return;
    }
    if (e.key === 'Enter' && suggestIndex !== -1) {
      e.preventDefault();
      commitFilter(matches[Math.min(suggestIndex, matches.length - 1)].mode);
      return;
    }
  }

  // 入力欄が空の状態での Backspace はバッジの消去
  if (e.key === 'Backspace' && filterMode && searchBar.value === '') {
    e.preventDefault();
    clearFilterBadge();
    return;
  }

  // Esc で検索・バッジを完全クリアしてリスト全体へ戻る
  if (e.key === 'Escape') {
    resetSearchState();
    searchBar.blur();
  }
});

// ---- 画像判定とサムネイル用ヘルパー ----

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];

function isImagePath(filePath) {
  const match = /\.([^./\\]+)$/.exec(filePath);
  return match !== null && IMAGE_EXTS.includes(match[1].toLowerCase());
}

// 絶対パスを <img> の src に使える file:// URL に変換 (空白や日本語もエスケープ)。
// Windows のドライブレター (C:) と \ 区切りにも対応し、同期されてきたファイルも正しく表示する
function toFileUrl(filePath) {
  const encoded = filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return (encoded.startsWith('/') ? 'file://' : 'file:///') + encoded;
}

// ---- 1. ファイルを受け取る（Finder → Bridge / Web → Bridge / bridge:// → Bridge）----

// ウインドウ全体でブラウザ既定のファイルオープン動作を止める
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// ---- つまみホバー / ドラッグ進入でシェルターを開き、外れたら閉じる ----
// 通常ホバー時はタイムラインリスト、外部ドラッグ進入時は「ドロップモード」
// (履歴を薄くしてドロップエリアを最前面に強調) へ自動で切り替える

let draggingOut = false; // 自リストからのネイティブドラッグアウト中はドロップモードにしない
let dragDepth = 0; // dragenter/dragleave は子要素でも発火するため深さを数える

function setDragMode(on) {
  document.body.classList.toggle('drag-mode', on);
}

document.addEventListener('mouseenter', () => window.bridge.expandShelter());
document.addEventListener('mouseleave', () => window.bridge.collapseShelter());

document.addEventListener('dragenter', () => {
  if (draggingOut) return;
  dragDepth++;
  setDragMode(true);
  window.bridge.expandShelter();
});

document.addEventListener('dragleave', (e) => {
  if (draggingOut) return;
  dragDepth = Math.max(0, dragDepth - 1);
  // ウインドウの外へ本当に抜けたときだけ閉じる（子要素間の移動では relatedTarget が null にならない）
  if (e.relatedTarget === null || dragDepth === 0) {
    dragDepth = 0;
    setDragMode(false);
    window.bridge.collapseShelter();
  }
});

document.addEventListener('drop', () => {
  dragDepth = 0;
  setDragMode(false);
});

// ドラッグアウト終了後 (ボタンが離れた状態での最初のマウス移動) にフラグを解除する
document.addEventListener('mousemove', (e) => {
  if (draggingOut && e.buttons === 0) draggingOut = false;
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

// ---- ハブ (ファイルアイテム) の最大保持数と自動お掃除 (ガベージコレクション) ----

// 上限からあふれた最古のファイルアイテムはリストから外す。あわせて Main へ実体削除を依頼するが、
// Main 側は sessionTempFiles (裏生成 snippet/クリップ PNG と他拠点から同期された一時ファイル) に
// 含まれるものだけを削除するため、ユーザー自身がドロップした本物のファイルには絶対に触れない
const MAX_FILE_ITEMS = 100;

function trimFileHistory() {
  const files = items.filter((it) => it.kind === 'file');
  for (const extra of files.slice(MAX_FILE_ITEMS)) {
    items.splice(items.indexOf(extra), 1);
    selectedItems.delete(extra);
    if (extra.path) window.bridge.deleteTempFile(extra.path);
  }
}

// ---- 重複コピーのスタック化 (同一内容の再コピーはカードを増やさず最上位へ引き上げる) ----

// match に一致する既存カードがあれば、新規追加せずリスト最上位へ移動して時刻だけを更新する。
// 引き上げが起きたら true を返す (呼び出し側は新規カードの追加をスキップする)
function bumpExistingItem(match, timestamp) {
  const index = items.findIndex(match);
  if (index === -1) return false;
  const [existing] = items.splice(index, 1);
  existing.timestamp = timestamp || Date.now();
  items.unshift(existing);
  render();
  return true;
}

// Finder 純正の「種類」ラベル (例: 「PDF書類」「フォルダ」) を非同期取得してアイテムへ反映する
function attachFileKind(item, filePath) {
  window.bridge
    .getFileKind(filePath)
    .then((kindLabel) => {
      if (!kindLabel) return;
      item.fileKind = kindLabel;
      render();
    })
    .catch(() => {}); // 取得失敗時は「ファイル」の暫定表示のまま
}

// ローカルファイルをリストへ追加する共通処理。
// origin が渡された場合は他拠点から同期されてきたファイル ({ fromDevice, fromPlatform })
function addLocalFile(filePath, fileName, origin) {
  if (!filePath) return;
  const name = fileName || filePath.split(/[\\/]/).pop(); // Windows のパス区切り (\) にも対応
  // 全く同じファイル (同一パス、または同一ファイル名) が既にあればカードを増やさず、
  // 既存カードを最上位へ引き上げて時刻だけを最新に更新する (重複排除・スタック)
  if (bumpExistingItem((it) => it.kind === 'file' && (it.path === filePath || it.name === name))) {
    return;
  }

  const item = {
    kind: 'file',
    path: filePath,
    name,
    text: null,
    icon: null,
    isImage: isImagePath(filePath),
    downloading: false,
    removing: false,
    timestamp: Date.now(),
    fromDevice: origin ? origin.fromDevice : null,
    fromPlatform: origin ? origin.fromPlatform : null,
  };
  items.unshift(item); // タイムライン表示のため最新を先頭へ
  trimFileHistory(); // 上限あふれの最古アイテムを外し、同期由来の一時ファイル実体もお掃除する

  // 自分のデバイスで生まれたファイルだけを同期台帳へ登録する (他拠点由来の再登録ループを防ぐ)
  // (フォルダは Main 側の登録処理で除外されるため、ここでは判定しない)
  if (!item.fromDevice) window.bridge.registerSyncFile(filePath, item.name);

  // 画像はファイル自体をサムネイル表示するのでアイコン取得は不要
  if (!item.isImage) {
    window.bridge
      .getFileIcon(filePath)
      .then((dataUrl) => {
        if (dataUrl) {
          item.icon = dataUrl;
          render();
        }
      })
      .catch(() => {}); // アイコン取得失敗はアイコンなし表示のまま続行
  }
  attachFileKind(item, filePath);
  render();
}

// dataTransfer から Web 画像/リンクの http(s) URL を抽出する
function extractWebUrl(dataTransfer) {
  // Web 画像のドラッグでは text/html に <img src="..."> が入ることが多く、
  // ここから取るのが最も確実 (uri-list はページ URL の場合がある)
  const html = dataTransfer.getData('text/html');
  if (html) {
    const m = /<img[^>]+src\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(html);
    if (m) return m[1].replace(/&amp;/g, '&');
  }

  // text/uri-list: 1行1URL。# で始まる行はコメント
  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const line = uriList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'));
    if (line && /^https?:\/\//i.test(line)) return line;
  }

  // text/plain: テキスト中の最初の http(s) URL を拾う
  const plain = dataTransfer.getData('text/plain');
  const m = /https?:\/\/\S+/i.exec(plain || '');
  return m ? m[0] : null;
}

// Web からドロップされた URL を Main プロセスでダウンロードして追加する
function addWebUrl(url) {
  // ダウンロード中のプレースホルダを先に表示する
  const item = {
    kind: 'file',
    path: null,
    name: url,
    text: null,
    icon: null,
    isImage: false,
    downloading: true,
    removing: false,
    timestamp: Date.now(),
    fromDevice: null, // Web からのダウンロードは自分のデバイス生まれとして扱う
    fromPlatform: null,
  };
  items.unshift(item);
  trimFileHistory();
  render();

  window.bridge
    .downloadUrl(url)
    .then(({ path, name }) => {
      if (item.removing) return; // ダウンロード中に × で消された
      if (items.some((other) => other !== item && other.path === path)) {
        removeItem(item); // 既に同じファイルがある
        return;
      }
      item.path = path;
      item.name = name;
      item.downloading = false;
      item.isImage = isImagePath(path);
      window.bridge.registerSyncFile(path, name); // 実体が確定した時点で同期台帳へ登録
      if (!item.isImage) {
        window.bridge
          .getFileIcon(path)
          .then((dataUrl) => {
            if (dataUrl) {
              item.icon = dataUrl;
              render();
            }
          })
          .catch(() => {}); // アイコン取得失敗はアイコンなし表示のまま続行
      }
      attachFileKind(item, path);
      render();
    })
    .catch((err) => {
      console.error('ダウンロード失敗:', url, err);
      item.name = 'ダウンロード失敗';
      render();
      setTimeout(() => fadeOutAndRemove(item), 1500);
    });
}

// ドラッグされた選択テキストを Main プロセスで snippet_[タイムスタンプ].txt として保存し追加する
function addTextSnippet(text) {
  const item = {
    kind: 'file',
    path: null,
    name: 'テキストを保存中…',
    text: null,
    icon: null,
    isImage: false,
    downloading: true,
    removing: false,
    timestamp: Date.now(),
    fromDevice: null, // ドラッグされた選択テキストは自分のデバイス生まれとして扱う
    fromPlatform: null,
  };
  items.unshift(item);
  trimFileHistory();
  render();

  window.bridge
    .saveTextSnippet(text)
    .then((path) => {
      if (item.removing) return; // 保存中に × で消された
      if (items.some((other) => other !== item && other.path === path)) {
        removeItem(item); // 既に同じファイルがある
        return;
      }
      item.path = path;
      item.name = path.split(/[\\/]/).pop();
      item.downloading = false;
      window.bridge.registerSyncFile(path, item.name); // 実体が確定した時点で同期台帳へ登録
      window.bridge
        .getFileIcon(path)
        .then((dataUrl) => {
          if (dataUrl) {
            item.icon = dataUrl;
            render();
          }
        })
        .catch(() => {}); // アイコン取得失敗はアイコンなし表示のまま続行
      attachFileKind(item, path);
      render();
    })
    .catch((err) => {
      console.error('テキストの保存に失敗:', err);
      item.name = '保存に失敗';
      render();
      setTimeout(() => fadeOutAndRemove(item), 1500);
    });
}

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  // まずローカルファイル (Finder からのドロップ)
  let addedFile = false;
  for (const file of e.dataTransfer.files) {
    // Electron 32+ では file.path が廃止されたため webUtils 経由で絶対パスを取得
    const filePath = window.bridge.getPathForFile(file);
    if (!filePath) continue;
    addLocalFile(filePath, file.name);
    addedFile = true;
  }

  if (!addedFile) {
    // ファイルでなければ Web 画像/リンクの URL とみなして抽出
    const url = extractWebUrl(e.dataTransfer);
    if (url) {
      addWebUrl(url);
    } else {
      // URL でもなければ選択されたテキストとみなし .txt として保存する
      const text = e.dataTransfer.getData('text/plain');
      if (text && text.trim()) addTextSnippet(text);
    }
  }
});

// bridge:// URL スキーム経由 (Mac クイックアクション等)・クリップボード監視・
// 他拠点からの同期で届いたファイル。payload は { path, name, fromDevice, fromPlatform }
// (旧形式のパス文字列が届いた場合もローカルファイルとして扱う)
window.bridge.onAddFile((payload) => {
  if (payload && typeof payload === 'object') {
    addLocalFile(payload.path, payload.name, payload.fromDevice ? payload : null);
  } else {
    addLocalFile(payload);
  }
});

// ウインドウが展開されるたびに検索状態 (文字列・バッジ・サジェスト・選択) を完全リセットして
// 最新の全リスト表示へ戻し、そのまま打ち始められるよう検索バーへ自動フォーカスする
window.bridge.onShelterExpanded(() => {
  resetSearchState();
  searchBar.focus();
});

// ---- マウス共有の短命な通知 (接続失敗 / Accessibility 権限案内) ----

const controlToast = document.getElementById('control-toast');
let controlToastTimer = null;

function showControlToast(message, durationMs = 4000) {
  controlToast.textContent = message;
  controlToast.hidden = false;
  controlToast.classList.add('visible');
  if (controlToastTimer) clearTimeout(controlToastTimer);
  controlToastTimer = setTimeout(() => {
    controlToast.classList.remove('visible');
    controlToastTimer = null;
  }, durationMs);
}

window.bridge.onControlConnectFailed(({ device, reason }) => {
  showControlToast(`${device || '相手デバイス'} への接続に失敗しました`);
});

window.bridge.onAccessibilityPermissionNeeded(() => {
  showControlToast('マウス共有には Accessibility 権限が必要です。システム設定で許可してください', 8000);
});

window.bridge.onInputMonitoringPermissionNeeded(() => {
  showControlToast('この端末でのマウス操作には「入力監視」権限が必要です。システム設定で許可してください（今回はフォールバック方式で操作を継続します）', 8000);
});

// ---- クリップボード履歴（Main の監視から届いた新規コピーをタイムライン先頭へ）----

// ハイブリッド上限: テキスト履歴は検索資産として 100 件まで保持し、
// 裏生成 PNG を伴う画像履歴はディスク保護のため 30 件で打ち切る
const MAX_TEXT_CLIP_ITEMS = 100;
const MAX_IMAGE_CLIP_ITEMS = 30;

function trimClipHistory() {
  const texts = items.filter((it) => it.kind === 'clip-text');
  const images = items.filter((it) => it.kind === 'clip-image');
  const overflow = [...texts.slice(MAX_TEXT_CLIP_ITEMS), ...images.slice(MAX_IMAGE_CLIP_ITEMS)];
  for (const extra of overflow) {
    items.splice(items.indexOf(extra), 1);
    selectedItems.delete(extra);
    // 上限あふれで履歴から消える裏生成ファイル (clipboard_*.png / snippet_*.txt) や
    // 他拠点から同期された一時ファイルは、Main 側に依頼して fs.unlinkSync で
    // ディスクからも完全削除し、ストレージを圧迫しない
    if (extra.path) window.bridge.deleteTempFile(extra.path);
  }
}

window.bridge.onClipboardItem((data) => {
  if (!data) return;
  const isImage = data.type === 'clipboard-image';
  // 想定外のペイロード (画像なのに path が無い / テキストなのに本文が無い) は、
  // サムネイル表示もドラッグアウトもできず後続処理で例外になるため読み飛ばす
  if (isImage ? !data.path : typeof data.text !== 'string') return;

  // 重複コピー: 同じ内容 (テキストは全文一致、画像は同一ファイル名) の履歴が既にあれば
  // カードを増やさず、既存カードを最上位へ引き上げて時刻だけを最新に更新する
  if (isImage) {
    const fileName = data.path ? data.path.split(/[\\/]/).pop() : null;
    if (
      fileName &&
      bumpExistingItem((it) => it.kind === 'clip-image' && it.name === fileName, data.timestamp)
    ) {
      return;
    }
  } else if (
    bumpExistingItem((it) => it.kind === 'clip-text' && it.text === data.text, data.timestamp)
  ) {
    // 捨てる新規カードのために裏生成された snippet_*.txt はディスクに残さない
    if (data.path) window.bridge.deleteTempFile(data.path);
    return;
  }

  const item = {
    kind: isImage ? 'clip-image' : 'clip-text',
    // テキスト履歴も Main 側で裏生成された snippet_*.txt のパスを持つ (ドラッグアウト用の二刀流)
    path: data.path || null,
    text: isImage ? null : data.text,
    // テキストは冒頭プレビュー (改行や連続空白は 1 つに畳む)
    name: isImage
      ? data.path.split(/[\\/]/).pop()
      : data.text.trim().replace(/\s+/g, ' ').slice(0, 200),
    icon: null,
    isImage,
    downloading: false,
    removing: false,
    timestamp: data.timestamp,
    fromDevice: data.fromDevice || null,
    fromPlatform: data.fromPlatform || null,
  };
  items.unshift(item);
  trimClipHistory();
  render();
});

// ---- 2. 個別削除（リストから外すだけ。元のファイルには触れない）----

function removeItem(item) {
  const index = items.indexOf(item);
  if (index === -1) return;
  items.splice(index, 1);
  selectedItems.delete(item);
  render();
}

// フェードアウトしてから削除する
function fadeOutAndRemove(item) {
  if (item.removing) return;
  item.removing = true;
  render();
  setTimeout(() => removeItem(item), 200);
}

// ---- 3. ファイルを外へ引き出す（Bridge → Finder 等、複数選択の一括ドラッグアウトに対応）----

function onItemDragStart(e, item) {
  // HTML5 のドラッグを止め、OS標準のネイティブドラッグに置き換える
  e.preventDefault();
  if (item.downloading) return;

  // クリップボード履歴はファイルとしてドラッグアウト (履歴なのでリストには残す)
  if (item.kind === 'clip-text') {
    draggingOut = true;
    // 検知時に裏で生成済みの snippet_*.txt のパスで startDrag (無ければ Main 側で生成)
    window.bridge.dragClipboardText({ text: item.text, path: item.path });
    return;
  }
  if (item.kind === 'clip-image') {
    if (!item.path) return;
    draggingOut = true;
    window.bridge.startDrag([item.path]); // 検知時に保存済みの .png をそのままドラッグ
    return;
  }

  if (!item.path) return;

  // 選択されていないアイテムをドラッグし始めたら、そのアイテム単体の選択に切り替える (Finder と同じ挙動)
  if (!selectedItems.has(item)) {
    selectedItems.clear();
    selectedItems.add(item);
    render();
  }

  const draggedItems = [...selectedItems].filter(
    (it) => it.kind === 'file' && it.path && !it.downloading
  );
  if (draggedItems.length === 0) return;
  draggingOut = true;
  window.bridge.startDrag(draggedItems.map((it) => it.path));

  // ドラッグ開始と同時にフェードアウトしてリストから削除
  for (const it of draggedItems) {
    setTimeout(() => fadeOutAndRemove(it), 0);
  }
}

// ---- 4. 選択（複数選択対応）+ スペースキーでクイックルック ----

// OS へデータを書き戻してウインドウが閉じる直前に、選択状態とフォーカスを完全にリセットする。
// これをしないと次にウインドウが開いたとき古いハイライトが残ってしまう
function resetSelectionAndFocus() {
  selectedItems.clear();
  lastSelectedIndex = null;
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  render();
}

function onItemClick(e, item) {
  // 通常クリック (⌘/Shift なし) は「OS クリップボードへコピー & 自動格納」
  if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (item.kind === 'clip-text') {
      window.bridge.writeClipboardText(item.text); // 生テキストを書き戻し → 即ペースト可能
    } else if (item.kind === 'clip-image' && item.path) {
      window.bridge.writeClipboardImage(item.path);
    } else if (item.kind === 'file' && item.path && !item.downloading) {
      // ファイルは「OS のファイル形式」でセットし、Finder で ⌘V → 本物のファイルとして複製
      window.bridge.writeClipboardFile(item.path);
    } else {
      return; // ダウンロード中などコピーできないアイテムは何もしない
    }
    resetSelectionAndFocus();
    return;
  }

  // 添字は検索フィルター適用後の表示中リストを基準にする
  const index = visibleItems.indexOf(item);
  if (e.metaKey || e.ctrlKey) {
    // ⌘/Ctrl+クリックで個別にトグル
    if (selectedItems.has(item)) selectedItems.delete(item);
    else selectedItems.add(item);
  } else if (e.shiftKey && lastSelectedIndex !== null) {
    // Shift+クリックで範囲選択。アイテム削除で lastSelectedIndex が現在のリスト長を
    // 超えている場合があるため、範囲外の添字 (undefined) は選択に混ぜない
    const [start, end] = [lastSelectedIndex, index].sort((a, b) => a - b);
    selectedItems.clear();
    for (let i = start; i <= end; i++) {
      if (visibleItems[i]) selectedItems.add(visibleItems[i]);
    }
  } else {
    selectedItems.clear();
    selectedItems.add(item);
  }
  lastSelectedIndex = index;
  render();
}

document.addEventListener('keydown', (e) => {
  // 検索バーへの入力中はリスト操作のショートカット (⌘A / Space) を奪わない
  if (e.target === searchBar) return;

  // ⌘+A (Mac) / Ctrl+A (Win) で表示中の全アイテムを選択 (検索中は絞り込み結果のみ)
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
    if (visibleItems.length === 0) return;
    e.preventDefault();
    selectedItems.clear();
    for (const item of visibleItems) selectedItems.add(item);
    render();
    return;
  }

  if (e.code !== 'Space' || selectedItems.size === 0) return;
  const item = [...selectedItems][0];
  if (!item.path) return;
  e.preventDefault();
  window.bridge.previewFile(item.path, item.name);
});

// 何もない場所をクリックしたら選択解除（矩形選択直後のクリックでは解除しない）
let suppressEmptyClick = false;
dropZone.addEventListener('click', (e) => {
  if (suppressEmptyClick) {
    suppressEmptyClick = false;
    return;
  }
  if (e.target === dropZone || e.target === listEl) {
    selectedItems.clear();
    render();
  }
});

// ---- 5. マウスドラッグによる矩形選択（Finder ライクなラバーバンド選択）----

let dragStart = null;
let dragBaseSelection = null;
let dragMoved = false;
let selectionBox = null;

function rectFromPoints(x1, y1, x2, y2) {
  return {
    left: Math.min(x1, x2),
    right: Math.max(x1, x2),
    top: Math.min(y1, y2),
    bottom: Math.max(y1, y2),
  };
}

function rectsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

dropZone.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  // ファイルアイテムや操作ボタン上でのドラッグは対象外（ドラッグ移動/選択と衝突するため）
  if (e.target.closest('.file-item') || e.target.closest('#clear-button')) return;

  dragStart = { x: e.clientX, y: e.clientY };
  dragMoved = false;
  // Shift/⌘/Ctrl を押しながらのドラッグは既存の選択に追加する
  dragBaseSelection = (e.shiftKey || e.metaKey || e.ctrlKey) ? new Set(selectedItems) : new Set();

  if (!selectionBox) {
    selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    dropZone.appendChild(selectionBox);
  }
  selectionBox.style.left = '0px';
  selectionBox.style.top = '0px';
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  selectionBox.hidden = false;

  e.preventDefault();
});

// 矩形選択の終了処理。mouseup と「ウインドウ外でボタンが離された」検知の両方から呼ぶ
function endRectangleSelection() {
  if (!dragStart) return;
  dragStart = null;
  dragBaseSelection = null;
  if (selectionBox) selectionBox.hidden = true;
  // ドラッグして選択した直後に発火する click イベントで選択が消えないようにする
  if (dragMoved) suppressEmptyClick = true;
}

document.addEventListener('mousemove', (e) => {
  if (!dragStart) return;
  // ウインドウの外でマウスボタンが離されると mouseup がこの document に届かないため、
  // ボタンが離れた状態で戻ってきたらその場で終了する (選択枠が張り付いたままになる不具合の防止)
  if (e.buttons === 0) {
    endRectangleSelection();
    return;
  }
  dragMoved = true;

  const pointerRect = rectFromPoints(dragStart.x, dragStart.y, e.clientX, e.clientY);

  // 選択枠を drop-zone のスクロール位置基準の座標系で描画
  const zoneRect = dropZone.getBoundingClientRect();
  selectionBox.style.left = `${pointerRect.left - zoneRect.left + dropZone.scrollLeft}px`;
  selectionBox.style.top = `${pointerRect.top - zoneRect.top + dropZone.scrollTop}px`;
  selectionBox.style.width = `${pointerRect.right - pointerRect.left}px`;
  selectionBox.style.height = `${pointerRect.bottom - pointerRect.top}px`;

  // 枠に触れたアイテムを選択に加える（ベース選択とマージ）。
  // DOM の並びは検索フィルター適用後の表示中リストと 1:1 対応する
  selectedItems.clear();
  for (const item of dragBaseSelection) selectedItems.add(item);
  visibleItems.forEach((item, i) => {
    const li = listEl.children[i];
    if (li && rectsIntersect(pointerRect, li.getBoundingClientRect())) {
      selectedItems.add(item);
    }
  });

  render();
});

document.addEventListener('mouseup', endRectangleSelection);

// ---- 画面描画 ----

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ファイル名を「拡張子を除いた本体」と「拡張子」に分割する。
// フォルダ/クリップボード履歴には使わない (拡張子を保護する意味がないため ext は空にする)
function splitNameExt(name) {
  const dotIndex = name.lastIndexOf('.');
  const hasExt = dotIndex > 0 && dotIndex < name.length - 1; // 先頭ドット(隠しファイル)は拡張子扱いしない
  return hasExt
    ? { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) }
    : { base: name, ext: '' };
}

// ---- 全角・半角の視覚幅を考慮した Finder 流の中央省略 ----

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

// 本体 (拡張子除く) の合計カウントが 14 (全角7文字相当) 以内ならそのまま「名前 + 拡張子」。
// 超える場合のみ:
//   拡張子あり … 「先頭カウント8 + ⋯ + 末尾カウント4 + 拡張子」の 1 つの文字列に整形 (中央省略)
//   拡張子なし (フォルダ等) … 先頭カウント14 で切って末尾に「...」(末尾省略)
// 後から描画結果を測って削り直す補正は行わず、この一発整形だけで
// デフォルトのシェルフ幅に確実に収まるカウント数にしてある
const NAME_MAX_UNITS = 14;
const NAME_HEAD_UNITS = 8;
const NAME_TAIL_UNITS = 4;

function formatFileName(name, hasExt) {
  const { base, ext } = hasExt ? splitNameExt(name) : { base: name, ext: '' };
  
  // ❌ ここを共通の NAME_MAX_UNITS にするのをやめる
  // if (countUnits(base) <= NAME_MAX_UNITS) return base + ext;

  // 🟢 1. 拡張子がない（フォルダやクリップボード）場合：限界の「28」まで目一杯使う！
  if (!ext) {
    if (countUnits(base) <= 28) return base; // 28カウント以内ならそのまま表示
    return sliceUnits(base, 28, false) + '...'; // 超えたら28で切って末尾「...」
  }
  
  // 🟢 2. 拡張子がある（ファイル）場合：安全第一の「14」で中央省略する
  if (countUnits(base) <= 14) return base + ext;
  
  return (
    sliceUnits(base, 8, false) + '⋯' + sliceUnits(base, 4, true) + ext
  );
}

// ---- カスタムツールチップ (Electron では OS 標準の title 属性が機能しないため自作) ----

// 表示中のツールチップは常に 1 つ。mouseleave・再描画で確実に消す
let tooltipEl = null;

function hideTooltip() {
  if (tooltipEl) {
    tooltipEl.remove();
    tooltipEl = null;
  }
}

function showTooltip(target, text) {
  hideTooltip();
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'bridge-tooltip';
  tooltipEl.textContent = text;
  document.body.appendChild(tooltipEl);

  // カード (タイトル要素) のすぐ下に出し、実寸を測ってから画面端からのはみ出しを補正する
  const rect = target.getBoundingClientRect();
  const tipRect = tooltipEl.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + tipRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - 8 - tipRect.width);
  }
  if (top + tipRect.height > window.innerHeight - 8) {
    top = rect.top - tipRect.height - 6; // 下に収まらないときだけ上に反転
  }
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

// ---- 出身デバイスバッジ (アイテムがどのデバイスで生まれたかを一目で示す) ----

// fromDevice が空 (ローカル生成) または自分のデバイス名ならバッジは出さず null を返す。
// 外部デバイスから同期されたものだけ拠点名 (例: "Win-PC", "MacBook") のバッジを作る
function createDeviceBadge(item) {
  if (!item.fromDevice || item.fromDevice === localDeviceName) return null;
  const badge = document.createElement('div');
  badge.className = 'device-badge device-remote';
  badge.textContent = item.fromDevice;
  // 出身デバイスの OS で色味を変える (Windows は青みがかった背景)
  if (item.fromPlatform === 'win32') badge.classList.add('device-win');
  else if (item.fromPlatform === 'darwin') badge.classList.add('device-mac');
  return badge;
}

function render() {
  // リストを作り直すと mouseleave が発火しないままホバー元の要素が消えるため、
  // 残骸ツールチップをここで必ず取り除く
  hideTooltip();
  listEl.textContent = '';
  visibleItems = filterItems();

  for (const item of visibleItems) {
    const li = document.createElement('li');
    // 色分けクラスは必ずどちらか一方を付与する:
    //   user-dropped (ゴールド)    … kind === 'file' = ユーザーが明示的に置いた本物のファイル
    //                               (D&D・bridge://・Web ダウンロード・テキスト保存の完了後を含む)
    //   clipboard-history (グリーン) … kind === 'clip-text' | 'clip-image' = コピー監視の自動ログ
    //                               (裏で snippet_*.txt / .png のパスを持っていても履歴として扱う)
    const isUserFile = item.kind === 'file';
    li.classList.add('file-item', isUserFile ? 'user-dropped' : 'clipboard-history');
    if (selectedItems.has(item)) li.classList.add('selected');
    if (item.removing) li.classList.add('removing');
    if (item.downloading) li.classList.add('downloading');
    li.draggable = !item.removing && !item.downloading;
    li.addEventListener('click', (e) => onItemClick(e, item));
    li.addEventListener('dragstart', (e) => onItemDragStart(e, item));

    // 左側: 種別バッジ or ファイルアイコン/サムネイル
    if (item.kind === 'clip-text') {
      const badge = document.createElement('div');
      badge.className = 'clip-badge';
      badge.textContent = '📋';
      li.appendChild(badge);
    } else {
      const img = document.createElement('img');
      img.draggable = false;
      if (item.isImage && item.path) {
        // 画像ファイルは OS アイコンではなく実物のサムネイルを表示
        img.className = 'file-icon thumbnail';
        img.src = toFileUrl(item.path);
      } else {
        img.className = 'file-icon';
        if (item.icon) img.src = item.icon;
      }
      li.appendChild(img);
    }

    // 中央: 名前 (テキスト履歴は冒頭プレビュー) + [バッジ+時刻] + 種別 の 3 段
    const lines = document.createElement('div');
    lines.className = 'item-lines';

    // タイトルは JS で整形済みの「1 つの文字列」を左詰めで表示する。
    // 全角=2 / 半角=1 (英大文字は 2) の視覚幅カウントで 28 を超えるときだけ
    // 「前半(14) ⋯ 後半(6) + 拡張子」の中央省略 (フォルダ等の拡張子なしは末尾を ... で省略)
    const titleEl = document.createElement('div');
    titleEl.className = 'item-title' + (item.kind === 'clip-text' ? ' clip-preview' : '');

    if (item.kind === 'clip-text') {
      titleEl.textContent = item.name; // 冒頭プレビューは 2 行折り返し (CSS クランプ) のまま
    } else {
      const isRealFile = isUserFile && item.fileKind !== 'フォルダ';
      const prefix = item.downloading ? 'ダウンロード中… ' : '';
      titleEl.textContent = prefix + formatFileName(item.name, isRealFile);
    }

    // ホバーで全文 (クリップボードは本文全体) を自作ツールチップ表示。
    // OS 標準の title 属性は Electron のウインドウ制約で機能しないため使わない
    const fullText = item.kind === 'clip-text' ? item.text : item.name;
    titleEl.addEventListener('mouseenter', () => showTooltip(titleEl, fullText));
    titleEl.addEventListener('mouseleave', hideTooltip);

    lines.appendChild(titleEl);

    // 1段目: 「種別名 · 時刻」 (例: "PNGファイル · 15:13")
    const kindLabel =
      item.kind === 'clip-text'
        ? 'コピー'
        : item.kind === 'clip-image'
          ? '画像コピー'
          : item.fileKind || 'ファイル'; // Finder 純正の種類名 (取得前は「ファイル」で暫定表示)
    const metaLine = document.createElement('div');
    metaLine.className = 'item-meta-line';
    metaLine.textContent = item.timestamp
      ? `${kindLabel} · ${formatTime(item.timestamp)}`
      : kindLabel;
    lines.appendChild(metaLine);

    // 2段目: 出身地バッジ (例: [Mac])。外部デバイス由来のアイテムだけ改行して表示し、
    // ローカル生まれのものは行ごと DOM 生成をスキップしてカードの縦幅を詰める
    const deviceBadge = createDeviceBadge(item);
    if (deviceBadge) {
      const badgeLine = document.createElement('div');
      badgeLine.className = 'item-badge-line';
      badgeLine.appendChild(deviceBadge);
      lines.appendChild(badgeLine);
    }

    // ホバー時に現れる「×」ボタン
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-button';
    removeBtn.title = 'リストから外す';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // アイテムの選択を発火させない
      fadeOutAndRemove(item);
    });

    li.append(lines, removeBtn);
    listEl.appendChild(li);
  }

  const noItems = items.length === 0;
  const noVisible = visibleItems.length === 0;

  // 検索で 0 件のときはプレースホルダの文言を切り替えて「該当なし」を伝える
  emptyLabel.textContent = noItems ? 'ここにファイルをドロップ' : '一致するアイテムがありません';
  emptyEl.hidden = !noVisible;
  listEl.hidden = noVisible;
  countEl.textContent = noItems
    ? ''
    : visibleItems.length === items.length
      ? `${items.length} 個`
      : `${visibleItems.length} / ${items.length} 個`;
  clearBtn.hidden = noItems;

  // 終了時クリーンアップ (残骸ファイル削除) の判定用に、
  // 「現在リストに保持しているパス」を Main プロセスへ常時共有する
  window.bridge.reportRetainedPaths(items.map((it) => it.path).filter(Boolean));
}

clearBtn.addEventListener('click', () => {
  items.length = 0;
  selectedItems.clear();
  render();
});

render();
