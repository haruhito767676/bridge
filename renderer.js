// シェルフのアイテム (最新順)。kind: 'file' | 'clip-text' | 'clip-image'
// { kind, path, name, text, icon, isImage, downloading, removing, timestamp, fileKind, fromDevice, fromPlatform, sourceApp }
// fileKind: kind === 'file' のアイテムに非同期で付与される Finder 純正の種類名 (例:「PDF書類」「フォルダ」)
// fromDevice: 出身デバイス名。null / 自分のデバイス名なら「ローカル」、他拠点から同期されたものはその拠点名
// fromPlatform: 出身デバイスの OS ('darwin' | 'win32' 等)
// sourceApp: コピー時にフロントにあったアプリの { name, icon(data URL) }。ローカルのクリップボード
//            履歴 (clip-text/clip-image) にのみ付与され、他拠点から同期されたものには乗らない
const items = [];
const selectedItems = new Set();
let lastSelectedIndex = null;

const PLATFORM = window.bridge.platform || 'darwin';
const IS_MAC = PLATFORM === 'darwin';
const IS_WIN = PLATFORM === 'win32';
document.body.classList.add(`platform-${PLATFORM}`);
if (window.bridge.isWindows11) document.body.classList.add('win11');

const dropZone = document.getElementById('drop-zone');
const listEl = document.getElementById('file-list');
const emptyEl = document.getElementById('empty-state');
const emptyLabel = emptyEl.querySelector('.empty-label');
const emptySub = emptyEl.querySelector('.empty-sub');
const countEl = document.getElementById('item-count');
const syncDot = document.getElementById('sync-dot');
const deviceFilterChip = document.getElementById('device-filter-chip');
const deviceFilterText = document.getElementById('device-filter-text');
const deviceFilterClearBtn = document.getElementById('device-filter-clear');
const clearBtn = document.getElementById('clear-button');
const settingsBtn = document.getElementById('settings-button');
const searchBar = document.getElementById('search-bar');
const segmentEl = document.getElementById('filter-segment');
const segmentButtons = [...segmentEl.querySelectorAll('.segment-item')];
const segmentThumb = document.getElementById('filter-segment-thumb');
const contextMenuEl = document.getElementById('context-menu');

// アイテム → 描画中の <li>。矩形選択・キーボード移動・コピー確認の表示に使う
const itemElements = new Map();

// ---- SVG グリフ (SF Symbols 相当の線画。絵文字は使わない) ----

const GLYPHS = {
  clipboard:
    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="12" height="14" rx="2.5"/><path d="M7.5 4V3.5A1.5 1.5 0 0 1 9 2h2a1.5 1.5 0 0 1 1.5 1.5V4M7.5 9.5h5M7.5 13h3.5"/></svg>',
  xmark:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm-2.2 3.9a.65.65 0 0 0-.9.9L7.1 8l-2.2 2.2a.65.65 0 1 0 .9.9L8 8.9l2.2 2.2a.65.65 0 1 0 .9-.9L8.9 8l2.2-2.2a.65.65 0 1 0-.9-.9L8 7.1 5.8 4.9z"/></svg>',
  check:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3.2L13 5"/></svg>',
  trash:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.8A.8.8 0 0 1 6.8 2h2.4a.8.8 0 0 1 .8.8V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.6 7v4.2M9.4 7v4.2"/></svg>',
  warning:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2 14.3 13H1.7L8 2.2zM8 6.5v3M8 11.6v.1"/></svg>',
  info:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.3"/><path d="M8 7.2v4M8 5v.1"/></svg>',
  retry:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 1 1.6 3.7M3 8V4M3 8h4"/></svg>',
  pin:
    '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1.5 14.5 6.5l-1.2 1.2-.9-.3-2.6 2.6.3 2.6-1.2 1.2L6 11 2.5 14.5l-1-1L5 10 2.2 7.1l1.2-1.2 2.6.3 2.6-2.6-.3-.9z"/></svg>',
  laptop:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3.5" width="10" height="7" rx="1"/><path d="M1.5 12.5h13"/></svg>',
  desktop:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 13.5h4M8 11v2.5"/></svg>',
};

function glyph(name) {
  const span = document.createElement('span');
  span.innerHTML = GLYPHS[name] || '';
  return span.firstElementChild;
}

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

// ---- スマート検索 (フィルタートークン + サジェスト + インクリメンタル絞り込み) ----

// 現在表示中のアイテム (検索フィルター適用後、items と同じく最新順)。
// render() が更新し、矩形選択・Shift 範囲選択・⌘A・キーボード移動の添字は常にこの配列を基準にする
let visibleItems = [];
let searchQuery = '';

// 種別フィルターはセグメントボタン (すべて / ファイル / クリップ) のクリックだけで切り替える。
// Mail.app のメールボックスフィルタと同じ、見えるボタンで選ばせる方式 (コマンド入力は不要)
let filterMode = null; // 'file' | 'clip' | null

// デバイス絞り込みは、常設のUIではなく右クリックメニュー「◯◯のアイテムだけ表示」から入る。
// 台数分の選択肢を常設ボタンで持つと環境依存でUIが膨らむため、必要なときだけ効く一時的な状態として持つ
// (種別セグメントの下に「◯◯ のみ ✕」のチップが出ている間だけ有効。他は変わらず全デバイス混在で表示)
const LOCAL_DEVICE_FILTER = Symbol('local-device-filter'); // 文字列のデバイス名と衝突しない専用の値
let deviceFilter = null; // null | LOCAL_DEVICE_FILTER | <他デバイスの fromDevice 名>

// 表示名: ローカルは常に「このデバイス」、他拠点はそのデバイス名をそのまま使う
function deviceFilterLabelText() {
  if (!deviceFilter) return '';
  return deviceFilter === LOCAL_DEVICE_FILTER ? 'このデバイスのみ' : `"${deviceFilter}" のみ`;
}

// 表示はピン留めを先頭に、その後は時刻の新しい順。
// 他拠点から古いアイテムが後から届いても、日付セクションの並びが崩れない
function sortedByTime(list) {
  return list.slice().sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return (b.timestamp || 0) - (a.timestamp || 0);
  });
}

function filterItems() {
  const keyword = searchQuery.trim().toLowerCase();
  if (!filterMode && !deviceFilter && !keyword) return sortedByTime(items);

  return sortedByTime(items).filter((item) => {
    if (filterMode === 'file' && item.kind !== 'file') return false;
    if (filterMode === 'clip' && item.kind === 'file') return false;
    const isLocalItem = !item.fromDevice || item.fromDevice === localDeviceName;
    if (deviceFilter === LOCAL_DEVICE_FILTER && !isLocalItem) return false;
    if (deviceFilter && deviceFilter !== LOCAL_DEVICE_FILTER && item.fromDevice !== deviceFilter) return false;
    if (!keyword) return true;
    // ファイル名・パス・テキストの中身への部分一致
    const haystack = [item.name, item.path, item.text]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    return haystack.includes(keyword);
  });
}

// 右クリックメニューの「◯◯のアイテムだけ表示」から呼ばれる
function setDeviceFilter(target) {
  if (deviceFilter === target) return;
  deviceFilter = target;
  selectedItems.clear();
  lastSelectedIndex = null;
  render();
}

function clearDeviceFilter() {
  if (!deviceFilter) return;
  setDeviceFilter(null);
}

deviceFilterClearBtn.addEventListener('click', clearDeviceFilter);

// セグメントボタンのクリックで種別を切り替える
function setFilterMode(mode) {
  if (filterMode === mode) return;
  filterMode = mode;
  let activeIndex = -1;
  segmentButtons.forEach((btn, i) => {
    const active = (btn.dataset.mode || null) === mode;
    if (active) activeIndex = i;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  // 選択中インジケーターをボタン幅ぶんスライドさせる (3 等分なので 100% 刻み)。
  // Windows は #filter-segment-thumb 自体を display:none にしているので実質何もしない
  if (activeIndex !== -1) segmentThumb.style.transform = `translateX(${activeIndex * 100}%)`;
  selectedItems.clear();
  lastSelectedIndex = null;
  render();
}

segmentButtons.forEach((btn) => {
  btn.addEventListener('click', () => setFilterMode(btn.dataset.mode || null));
});

// 検索窓・種別セグメント・デバイス絞り込み・選択状態をまとめて初期状態へ戻す (全リスト表示に復帰)
function resetSearchState() {
  searchBar.value = '';
  searchQuery = '';
  setFilterMode(null);
  deviceFilter = null;
  selectedItems.clear();
  lastSelectedIndex = null;
  render();
}

searchBar.addEventListener('input', () => {
  searchQuery = searchBar.value;
  // 絞り込みで見えなくなったアイテムが選択されたまま残らないようにする
  selectedItems.clear();
  lastSelectedIndex = null;
  render();
});

searchBar.addEventListener('keydown', (e) => {
  // Spotlight と同じく、検索欄にいたまま ↑↓ で結果を選び、Enter で先頭 (または選択中) をコピーする
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moveSelection(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const target = selectedItems.size > 0 ? [...selectedItems][0] : visibleItems[0];
    if (!target) return;
    if (e.metaKey || e.ctrlKey) revealItem(target);
    else copyItemToClipboard(target);
    return;
  }

  // Esc: 検索中なら検索をクリア、何も入力していなければパネルを閉じる
  if (e.key === 'Escape') {
    e.preventDefault();
    if (searchBar.value || filterMode || deviceFilter) {
      resetSearchState();
    } else {
      searchBar.blur();
      window.bridge.collapseShelterNow();
    }
  }
});

// 実体がフォルダになっているか (Finder 純正の種類名で判定。取得前は false)
function isFolderPath(item) {
  return item.fileKind === 'フォルダ' || item.fileKind === 'Folder' || item.fileKind === 'ファイル フォルダー';
}

// テキスト履歴が「1 本の URL」かどうか (リンクとして開けるもの)
function urlOfItem(item) {
  if (!item || item.kind !== 'clip-text') return null;
  return window.BridgeFormat.urlOfText(item.text);
}

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

// ---- 開閉のトリガー ----
// ホバーによる展開は Main 側のカーソル監視 (右端への滞留判定) が担う。
// Renderer 側は「明確に意図のある操作」(つまみのクリック・ファイルのドラッグ進入) だけ即時に開く

let draggingOut = false; // 自リストからのネイティブドラッグアウト中はドロップモードにしない
let dragDepth = 0; // dragenter/dragleave は子要素でも発火するため深さを数える

function setDragMode(on) {
  document.body.classList.toggle('drag-mode', on);
  // 空のときは見出しを「ここにドロップ」に変える (リストがあるときは枠の光だけで示す)
  if (items.length === 0) emptyLabel.textContent = on ? 'ここにドロップ' : 'ここにファイルをドロップ';
}

let shelfExpanded = false; // Main からの通知で追従する開閉状態
let hoverDwellTimer = null;
const HOVER_DWELL_MS = 250;

document.addEventListener('mouseleave', () => {
  clearTimeout(hoverDwellTimer);
  hoverDwellTimer = null;
  window.bridge.collapseShelter();
});

// 再進入で保留中の格納を取り消す。Windows は展開のきっかけ自体もここ
// (つまみに 250ms 留まったら開く) で決める。macOS は Main のカーソル監視が担う
document.addEventListener('mouseenter', () => {
  if (shelfExpanded) {
    window.bridge.expandShelter(); // 既に開いていれば格納タイマーの取り消しだけになる
    return;
  }
  if (!IS_WIN) return;
  clearTimeout(hoverDwellTimer);
  hoverDwellTimer = setTimeout(() => {
    hoverDwellTimer = null;
    window.bridge.expandShelter();
  }, HOVER_DWELL_MS);
});

const handleEl = document.getElementById('handle');
handleEl.addEventListener('click', () => {
  clearTimeout(hoverDwellTimer);
  window.bridge.expandShelter();
});

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

dropZone.addEventListener('dragover', (e) => e.preventDefault());

// ---- ハブ (ファイルアイテム) の最大保持数と自動お掃除 (ガベージコレクション) ----

// 上限からあふれた最古のファイルアイテムはリストから外す。あわせて Main へ実体削除を依頼するが、
// Main 側は sessionTempFiles (裏生成 snippet/クリップ PNG と他拠点から同期された一時ファイル) に
// 含まれるものだけを削除するため、ユーザー自身がドロップした本物のファイルには絶対に触れない
const MAX_FILE_ITEMS = 100;

function trimFileHistory() {
  const files = items.filter((it) => it.kind === 'file' && !it.pinned); // ピン留めは上限の対象外
  for (const extra of files.slice(MAX_FILE_ITEMS)) {
    items.splice(items.indexOf(extra), 1);
    selectedItems.delete(extra);
    if (extra.path) window.bridge.deleteTempFile(extra.path);
  }
}

// ---- 重複コピーのスタック化 (同一内容の再コピーはカードを増やさず最上位へ引き上げる) ----

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

function attachFileIcon(item, filePath) {
  if (item.isImage) return; // 画像はファイル自体をサムネイル表示するのでアイコン取得は不要
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

// ローカルファイルをリストへ追加する共通処理。
// origin が渡された場合は他拠点から同期されてきたファイル ({ fromDevice, fromPlatform })
function addLocalFile(filePath, fileName, origin, sourceApp) {
  if (!filePath) return;
  const name = fileName || filePath.split(/[\\/]/).pop(); // Windows のパス区切り (\) にも対応

  // 「同期中」のプレースホルダがあれば、新しい行を作らずそこへ実体を流し込む
  const placeholder = origin && origin.syncId ? items.find((it) => it.syncId === origin.syncId) : null;
  if (placeholder) {
    placeholder.path = filePath;
    placeholder.name = name;
    placeholder.isImage = isImagePath(filePath);
    placeholder.syncing = false;
    placeholder.originKind = origin.originKind || null;
    attachFileIcon(placeholder, filePath);
    attachFileKind(placeholder, filePath);
    render();
    return;
  }

  // 全く同じファイル (同一パス) が既にあればカードを増やさず、既存カードを最上位へ引き上げて
  // 時刻だけを最新に更新する (重複排除・スタック)。名前が同じだけの別ファイルは別カードにする
  if (bumpExistingItem((it) => it.kind === 'file' && it.path === filePath, origin && origin.timestamp)) {
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
    // 他拠点由来は「送信元でシェルフに置かれた時刻」で並べる。ローカル生まれは今
    timestamp: (origin && origin.timestamp) || Date.now(),
    fromDevice: origin ? origin.fromDevice : null,
    fromPlatform: origin ? origin.fromPlatform : null,
    originKind: origin && origin.originKind ? origin.originKind : null,
    sourceApp: sourceApp || null,
  };
  item.entering = true; // 追加直後だけ「上から滑り込む」アニメーションを付ける
  items.unshift(item); // タイムライン表示のため最新を先頭へ
  trimFileHistory(); // 上限あふれの最古アイテムを外し、同期由来の一時ファイル実体もお掃除する

  // 自分のデバイスで生まれたファイルだけを同期台帳へ登録する (他拠点由来の再登録ループを防ぐ)
  if (!item.fromDevice) window.bridge.registerSyncFile(filePath, item.name, item.timestamp);

  attachFileIcon(item, filePath);
  attachFileKind(item, filePath);
  render();
}

// dataTransfer から Web 画像/リンクの http(s) URL を抽出する
function extractWebUrl(dataTransfer) {
  return window.BridgeFormat.extractWebUrlFromData({
    html: dataTransfer.getData('text/html'),
    uriList: dataTransfer.getData('text/uri-list'),
    plain: dataTransfer.getData('text/plain'),
  });
}

// 「保存中」のプレースホルダを先頭に置き、実体が確定したらファイルアイテムへ昇格させる共通処理
function addPendingItem(name, work) {
  const item = {
    kind: 'file',
    path: null,
    name,
    text: null,
    icon: null,
    isImage: false,
    downloading: true,
    removing: false,
    timestamp: Date.now(),
    fromDevice: null, // 自分のデバイス生まれとして扱う
    fromPlatform: null,
    entering: true,
  };
  items.unshift(item);
  trimFileHistory();
  render();

  work()
    .then(({ path, name: resolvedName }) => {
      if (item.removing) return; // 処理中に × で消された
      if (items.some((other) => other !== item && other.path === path)) {
        removeItem(item); // 既に同じファイルがある
        return;
      }
      item.path = path;
      item.name = resolvedName || path.split(/[\\/]/).pop();
      item.downloading = false;
      item.isImage = isImagePath(path);
      window.bridge.registerSyncFile(path, item.name); // 実体が確定した時点で同期台帳へ登録
      attachFileIcon(item, path);
      attachFileKind(item, path);
      render();
    })
    .catch((err) => {
      console.error('アイテムの追加に失敗:', name, err);
      removeItem(item);
      showToast({ icon: 'warning', title: '追加できませんでした', sub: name, accent: 'red' });
    });
}

// Web からドロップされた URL を Main プロセスでダウンロードして追加する
function addWebUrl(url) {
  addPendingItem(url, () => window.bridge.downloadUrl(url));
}

// ドラッグされた選択テキストを Main プロセスで snippet_[タイムスタンプ].txt として保存し追加する
function addTextSnippet(text) {
  addPendingItem('テキストを保存中', () =>
    window.bridge.saveTextSnippet(text).then((path) => ({ path, name: null }))
  );
}

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();

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
    addLocalFile(payload.path, payload.name, payload.fromDevice ? payload : null, payload.sourceApp);
  } else {
    addLocalFile(payload);
  }
});

// 他拠点からの実体が届く前に、名前・時刻・出身だけで「同期中」の行を先に出す。
// 実体が届いたら addLocalFile / onClipboardItem が syncId で見つけて同じ行を差し替える
window.bridge.onSyncPending((info) => {
  if (!info || !info.syncId) return;
  if (items.some((it) => it.syncId === info.syncId)) return;
  const item = {
    kind: info.kind === 'clip-image' ? 'clip-image' : 'file',
    path: null,
    name: info.name || '',
    text: null,
    icon: null,
    isImage: info.kind === 'clip-image',
    downloading: false,
    syncing: true,
    syncId: info.syncId,
    removing: false,
    timestamp: Number(info.timestamp) || Date.now(),
    fromDevice: info.fromDevice || null,
    fromPlatform: info.fromPlatform || null,
    originKind: info.originKind || null,
    sourceApp: null,
    entering: true,
    // 受信の進捗。total は届いた瞬間 (ヘッダー到着時) に分かる。stalled は Renderer 側で
    // 「しばらく進捗が無い」ことを検知したときだけ立てる (Main 側の状態ではない)
    received: 0,
    total: 0,
    speedMBps: 0,
    stalled: false,
    lastProgressAt: Date.now(),
  };
  items.unshift(item);
  render();
});

// 相手側で実体が消えていた場合など、届かないと分かったプレースホルダを取り下げる
window.bridge.onSyncPendingRemove(({ syncId }) => {
  const item = items.find((it) => it.syncId === syncId && it.syncing);
  if (item) removeItem(item);
});

// ---- 「同期中」の進捗 ----
// 大きなファイルは何十分もかかることがあり、何も表示が変わらないと「本当に動いているのか」
// 判断できない。届いた分・全体量・速度を表示し、しばらく動きが無ければ「止まっているかも」に
// 切り替えて、いつでも中止・再試行できるようにする
const STALL_AFTER_MS = 8000;

function formatBytes(n) {
  if (!n) return '0MB';
  if (n >= 1024 * 1024 * 1024) return `${(n / 1073741824).toFixed(2)}GB`;
  return `${Math.max(0.1, n / 1048576).toFixed(1)}MB`;
}

function syncMetaText(item) {
  if (item.stalled) return '止まっている可能性があります';
  if (!item.total) return item.received ? `同期中 · ${formatBytes(item.received)}` : '同期中';
  const pct = Math.min(99, Math.floor((item.received / item.total) * 100));
  const speed = item.speedMBps > 0.05 ? ` · ${item.speedMBps.toFixed(1)}MB/s` : '';
  return `${pct}% · ${formatBytes(item.received)} / ${formatBytes(item.total)}${speed}`;
}

// 行を作り直さず、進捗テキストとボタンの見た目だけをその場で書き換える (スクロール位置や
// ホバー状態を壊さないよう、進捗の更新だけは render() を呼ばない)
function updateSyncRowDom(item) {
  const li = itemElements.get(item);
  if (!li) return;
  const meta = li.querySelector('.item-meta-line');
  if (meta) meta.textContent = syncMetaText(item);
  li.classList.toggle('stalled', Boolean(item.stalled));
  const retryBtn = li.querySelector('.sync-retry-button');
  if (retryBtn) retryBtn.hidden = !item.stalled;
}

window.bridge.onSyncProgress(({ syncId, received, total }) => {
  const item = items.find((it) => it.syncId === syncId && it.syncing);
  if (!item) return;
  const now = Date.now();
  const elapsedS = (now - item.lastProgressAt) / 1000;
  if (elapsedS > 0 && received > item.received) {
    item.speedMBps = (received - item.received) / 1048576 / elapsedS;
  }
  item.received = received;
  item.total = total;
  item.lastProgressAt = now;
  item.stalled = false;
  updateSyncRowDom(item);
});

// 進捗の更新が一定時間止まっていたら「止まっているかも」に切り替える。動いているものが
// 本当に動いているかを外から確認する手段が今まで無かったための救済表示
setInterval(() => {
  const now = Date.now();
  for (const item of items) {
    if (!item.syncing) continue;
    const stalled = now - item.lastProgressAt > STALL_AFTER_MS;
    if (stalled !== item.stalled) {
      item.stalled = stalled;
      updateSyncRowDom(item);
    }
  }
}, 2000);

// 「同期中」の行の × (中止)。押した瞬間にリストからも消し、Main 側にも中断を伝える
function cancelSyncItem(item) {
  window.bridge.cancelSyncDownload(item.syncId);
  removeItem(item);
}

// 「止まっているかも」のときだけ出る、その場でもう一度取りに行くボタン
function retrySyncItem(item) {
  item.stalled = false;
  item.received = 0;
  item.speedMBps = 0;
  item.lastProgressAt = Date.now();
  updateSyncRowDom(item);
  window.bridge.retrySyncDownload(item.syncId).catch(() => {});
}

// ウインドウが展開されるたびに検索状態 (文字列・トークン・サジェスト・選択) をリセットして
// 最新の全リスト表示へ戻す。ホットキー等の明示的な呼び出しのときだけ検索バーへフォーカスする
// (ホバー展開でフォーカスを奪うと、作業中のアプリへのキー入力が乗っ取られてしまう)
// ファイル項目の実体が移動・削除されていないか確かめ、無くなっていれば行を「見つかりません」表示にする
async function refreshMissingFiles() {
  const targets = items.filter((it) => it.kind === 'file' && it.path && !it.downloading);
  if (targets.length === 0) return;
  let missing;
  try {
    missing = new Set(await window.bridge.statPaths(targets.map((it) => it.path)));
  } catch {
    return;
  }
  let changed = false;
  for (const it of targets) {
    const nowMissing = missing.has(it.path);
    if (Boolean(it.missing) !== nowMissing) {
      it.missing = nowMissing;
      changed = true;
    }
  }
  if (changed) render();
}

window.bridge.onShelterExpanded(({ focus }) => {
  shelfExpanded = true;
  // Windows: ウインドウは即時に広がり、中身だけがフライアウトのように滑り込む
  document.body.classList.remove('collapsing');
  document.body.classList.add('expanded');
  refreshMissingFiles();
  // アニメーション開始と同時にリストを組み直すとコマ落ちするため、状態が残っているときだけリセットする
  if (searchBar.value || filterMode || deviceFilter || selectedItems.size > 0) resetSearchState();
  closeContextMenu();
  dropZone.scrollTop = 0; // 開いたときは常に最新 (先頭) から
  if (focus) searchBar.focus();
});

// 格納時は選択・フォーカス・ツールチップを片付け、次に開いたとき古い状態が残らないようにする
window.bridge.onShelterCollapsed(() => {
  shelfExpanded = false;
  document.body.classList.remove('expanded');
  document.body.classList.add('collapsing');
  setTimeout(() => document.body.classList.remove('collapsing'), 200);
  hideTooltip();
  closeContextMenu();
  closeSettings();
  if (selectedItems.size > 0) {
    resetSelectionAndFocus();
  } else if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
});

// ---- 短命な通知 (クリアの取り消しなど) ----
// アイコン・タイトル・補足・任意のアクションボタンを持つ汎用トースト。
// 用途ごとに showToast() へ渡す中身だけを変え、見た目とタイマー管理は 1 箇所に集約する

const controlToast = document.getElementById('control-toast');
const controlToastIcon = document.getElementById('control-toast-icon');
const controlToastTitle = document.getElementById('control-toast-title');
const controlToastSub = document.getElementById('control-toast-sub');
const controlToastAction = document.getElementById('control-toast-action');
let controlToastTimer = null;
let controlToastActionHandler = null;

function hideControlToast() {
  controlToast.classList.remove('visible');
  if (controlToastTimer) {
    clearTimeout(controlToastTimer);
    controlToastTimer = null;
  }
  controlToastActionHandler = null;
}

// icon: GLYPHS のキー ('trash' | 'check' | 'warning' | 'info')
// accent: 'neutral' (情報) | 'amber' (システム設定での許可が要る) | 'red' (失敗・削除など後戻りが要る操作)
function showToast({ icon = '', title, sub = '', actionLabel = null, onAction = null, accent = 'neutral', durationMs = 4000 }) {
  controlToastIcon.textContent = '';
  if (icon && GLYPHS[icon]) controlToastIcon.appendChild(glyph(icon));
  controlToastTitle.textContent = title;
  controlToastSub.textContent = sub;
  if (actionLabel) {
    controlToastAction.textContent = actionLabel;
    controlToastAction.hidden = false;
    controlToastActionHandler = onAction || null;
  } else {
    controlToastAction.hidden = true;
    controlToastActionHandler = null;
  }
  controlToast.classList.toggle('toast-accent-amber', accent === 'amber');
  controlToast.classList.toggle('toast-accent-red', accent === 'red');
  controlToast.hidden = false;
  controlToast.classList.add('visible');
  if (controlToastTimer) clearTimeout(controlToastTimer);
  controlToastTimer = setTimeout(hideControlToast, durationMs);
}

controlToastAction.addEventListener('click', (e) => {
  e.stopPropagation(); // 親の #control-toast click (即時クローズ) に伝播させない
  const handler = controlToastActionHandler;
  hideControlToast();
  if (handler) handler();
});
controlToast.addEventListener('click', hideControlToast);

// bridge://add?path= で外部から要求されたローカルファイルの追加は、確認してから載せる
window.bridge.onConfirmAddFile(({ path: filePath, name }) => {
  showToast({
    icon: 'info',
    title: `「${name}」を追加しますか？`,
    sub: '外部のリンクから要求されました。追加するとほかのデバイスにも同期されます',
    actionLabel: '追加',
    onAction: () => window.bridge.confirmAddFile(filePath),
    durationMs: 12000,
  });
});

// ---- クリップボード履歴（Main の監視から届いた新規コピーをタイムライン先頭へ）----

// ハイブリッド上限: テキスト履歴は検索資産として 100 件まで保持し、
// 裏生成 PNG を伴う画像履歴はディスク保護のため 30 件で打ち切る
const MAX_TEXT_CLIP_ITEMS = 100;
const MAX_IMAGE_CLIP_ITEMS = 30;

function trimClipHistory() {
  const texts = items.filter((it) => it.kind === 'clip-text' && !it.pinned); // ピン留めは上限の対象外
  const images = items.filter((it) => it.kind === 'clip-image' && !it.pinned);
  const overflow = [...texts.slice(MAX_TEXT_CLIP_ITEMS), ...images.slice(MAX_IMAGE_CLIP_ITEMS)];
  for (const extra of overflow) {
    items.splice(items.indexOf(extra), 1);
    selectedItems.delete(extra);
    // 上限あふれで履歴から消える裏生成ファイル (clipboard_*.png / snippet_*.txt) や
    // 他拠点から同期された一時ファイルは、Main 側に依頼してディスクからも完全削除する
    if (extra.path) window.bridge.deleteTempFile(extra.path);
  }
}

window.bridge.onClipboardItem((data) => {
  if (!data) return;
  const isImage = data.type === 'clipboard-image';
  // 想定外のペイロード (画像なのに path が無い / テキストなのに本文が無い) は読み飛ばす
  if (isImage ? !data.path : typeof data.text !== 'string') return;

  // 「同期中」のプレースホルダがあれば、そこへ実体を流し込む
  if (data.syncId) {
    const placeholder = items.find((it) => it.syncId === data.syncId);
    if (placeholder) {
      placeholder.path = data.path || null;
      placeholder.text = isImage ? null : data.text;
      placeholder.name = isImage ? data.path.split(/[\\/]/).pop() : placeholder.name;
      placeholder.isImage = isImage;
      placeholder.syncing = false;
      render();
      return;
    }
  }

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
    sourceApp: data.sourceApp || null,
    entering: true,
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

function removeSelectedItems() {
  const targets = [...selectedItems];
  if (targets.length === 0) return;
  // 削除後は次の行 (無ければ手前の行) を選択して、⌫ の連打で順に消していけるようにする
  const firstIndex = Math.min(...targets.map((it) => visibleItems.indexOf(it)).filter((i) => i >= 0));
  for (const it of targets) fadeOutAndRemove(it);
  setTimeout(() => {
    const next = visibleItems[Math.min(firstIndex, visibleItems.length - 1)];
    selectedItems.clear();
    if (next) {
      selectedItems.add(next);
      lastSelectedIndex = visibleItems.indexOf(next);
    }
    render();
  }, 210);
}

// ---- 3. ファイルを外へ引き出す（Bridge → Finder 等、複数選択の一括ドラッグアウトに対応）----

function onItemDragStart(e, item) {
  // HTML5 のドラッグを止め、OS標準のネイティブドラッグに置き換える
  e.preventDefault();
  if (item.downloading || item.syncing) return;

  // クリップボード履歴はファイルとしてドラッグアウト (履歴なのでリストには残す)
  if (item.kind === 'clip-text') {
    draggingOut = true;
    window.bridge
      .dragClipboardText({ text: item.text, path: item.path })
      .then((generated) => {
        if (generated && !item.path) item.path = generated; // 次回以降は同じファイルを使い回す
      })
      .catch(() => {});
    return;
  }
  if (item.kind === 'clip-image') {
    if (!item.path) return;
    draggingOut = true;
    window.bridge.startDrag([item.path]);
    return;
  }

  if (!item.path || item.missing) return;

  // 選択されていないアイテムをドラッグし始めたら、そのアイテム単体の選択に切り替える (Finder と同じ挙動)
  if (!selectedItems.has(item)) {
    selectedItems.clear();
    selectedItems.add(item);
    render();
  }

  const draggedItems = [...selectedItems].filter(
    (it) => it.kind === 'file' && it.path && !it.downloading && !it.missing
  );
  if (draggedItems.length === 0) return;
  draggingOut = true;
  window.bridge.startDrag(draggedItems.map((it) => it.path));

  // ドラッグ開始と同時にフェードアウトしてリストから削除。誤ドラッグ用に「元に戻す」を出す
  for (const it of draggedItems) {
    setTimeout(() => fadeOutAndRemove(it), 0);
  }
  setTimeout(() => {
    showToast({
      icon: 'info',
      title: draggedItems.length > 1 ? `${draggedItems.length} 個を取り出しました` : '取り出しました',
      actionLabel: '元に戻す',
      onAction: () => {
        for (const it of draggedItems) {
          it.removing = false;
          if (!items.includes(it)) items.unshift(it);
        }
        render();
        refreshMissingFiles(); // 移動されていれば「見つかりません」になる
      },
      durationMs: 5000,
    });
  }, 250);
}

// ---- 4. 選択（複数選択対応）・コピー・クイックルック ----

// OS へデータを書き戻してウインドウが閉じる直前に、選択状態とフォーカスを完全にリセットする
function resetSelectionAndFocus() {
  selectedItems.clear();
  lastSelectedIndex = null;
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  render();
}

// アイテムを OS クリップボードへコピーできれば true。コピー自体は即座に行い (すぐ ⌘V できる)、
// 行にチェックマークを一瞬見せてからパネルを格納する
const COPIED_FEEDBACK_MS = 320;

function copyItemToClipboard(item) {
  if (item.syncing) {
    showToast({ icon: 'info', title: '同期中です', sub: '実体が届いてからコピーできます', durationMs: 2000 });
    return false;
  }
  if (item.missing) {
    showToast({
      icon: 'warning',
      title: 'ファイルが見つかりません',
      sub: '移動または削除されています',
      accent: 'amber',
      actionLabel: 'リストから外す',
      onAction: () => fadeOutAndRemove(item),
    });
    return false;
  }
  if (item.kind === 'clip-text') {
    window.bridge.writeClipboardText(item.text); // 生テキストを書き戻し → 即ペースト可能
  } else if (item.kind === 'clip-image' && item.path) {
    window.bridge.writeClipboardImage(item.path);
  } else if (item.kind === 'file' && item.path && !item.downloading) {
    // ファイルは「OS のファイル形式」でセットし、Finder で ⌘V → 本物のファイルとして複製
    window.bridge.writeClipboardFile(item.path);
  } else {
    return false; // ダウンロード中などコピーできないアイテムは何もしない
  }
  // クリックコピーも「再コピー」と同じ扱いにする: 履歴内の位置を最上位へ、時刻も更新する。
  // ここでは render() を呼ばない (パネルが COPIED_FEEDBACK_MS 後に閉じる際の
  // resetSelectionAndFocus() が描き直すので、並び替わる瞬間はユーザーに見えない)
  const index = items.indexOf(item);
  if (index > 0) {
    items.splice(index, 1);
    items.unshift(item);
  }
  if (index !== -1) item.timestamp = Date.now();
  showCopiedFeedback(item);
  return true;
}

function showCopiedFeedback(item) {
  const li = itemElements.get(item);
  if (li) {
    li.classList.add('copied');
    const mark = document.createElement('div');
    mark.className = 'copied-mark';
    mark.appendChild(glyph('check'));
    li.appendChild(mark);
  }
  hideTooltip();
  closeContextMenu();
  setTimeout(() => {
    resetSelectionAndFocus();
    window.bridge.collapseShelterNow();
  }, COPIED_FEEDBACK_MS);
}

function previewItem(item) {
  if (!item) return;
  if (item.path) {
    window.bridge.previewFile(item.path, item.name);
    return;
  }
  // テキスト履歴は実体ファイルを遅延生成してからクイックルックに渡す
  if (item.kind === 'clip-text' && item.text) {
    window.bridge
      .ensureClipboardTextFile({ text: item.text, path: null })
      .then((generated) => {
        if (!generated) return;
        item.path = generated;
        window.bridge.previewFile(generated, item.name);
      })
      .catch(() => {});
  }
}

function revealItem(item) {
  const url = urlOfItem(item);
  if (url) {
    window.bridge.openExternal(url); // リンクは Finder ではなくブラウザで開く
    return;
  }
  if (item && item.path) window.bridge.revealInFinder(item.path);
}

function onItemClick(e, item) {
  closeContextMenu();
  // 通常クリック (⌘/Shift なし) は「OS クリップボードへコピー & 自動格納」
  if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
    copyItemToClipboard(item);
    return;
  }

  // 添字は検索フィルター適用後の表示中リストを基準にする
  const index = visibleItems.indexOf(item);
  if (e.metaKey || e.ctrlKey) {
    // ⌘/Ctrl+クリックで個別にトグル
    if (selectedItems.has(item)) selectedItems.delete(item);
    else selectedItems.add(item);
  } else if (e.shiftKey && lastSelectedIndex !== null) {
    // Shift+クリックで範囲選択
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

// ピン留め: 上限の対象外になり、リスト先頭の「ピン留め」セクションに固定される (再起動後も残る)
function togglePinned(item) {
  item.pinned = !item.pinned;
  render();
  showToast({
    icon: 'pin',
    title: item.pinned ? 'ピン留めしました' : 'ピン留めを解除しました',
    durationMs: 1500,
  });
}

// ピン留めの名前を変更: Finder のアイコン名編集と同じ作法 (選択 → 明示操作 → その場でテキスト編集)。
// コンテキストメニューの「名前を変更」からのみ入る (空にすると本文プレビューのタイトルへ戻る)
function startRenamingItem(item) {
  const li = itemElements.get(item);
  const titleEl = li && li.querySelector('.item-title');
  if (!titleEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'item-title-edit';
  input.value = item.customTitle || titleEl.textContent;
  input.maxLength = 200;
  input.spellcheck = false;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const finish = (commit) => {
    if (settled) return;
    settled = true;
    if (commit) {
      const value = input.value.trim();
      item.customTitle = value || null; // 空欄なら自動タイトルに戻す
      schedulePersist();
    }
    render();
  };

  // リスト操作のショートカット (↑↓・⌫ など) にキー入力を奪わせない
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // IME 変換確定の Enter (isComposing / keyCode 229) はここでは拾わない。
    // これを拾うと日本語入力の変換確定だけで編集自体が終わってしまう
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ↑↓ でカーソル行を動かす (Shift で範囲を伸ばす)。選択が無ければ先頭 / 末尾から始める
function moveSelection(delta, extend) {
  if (visibleItems.length === 0) return;
  let index;
  if (lastSelectedIndex === null || selectedItems.size === 0) {
    index = delta > 0 ? 0 : visibleItems.length - 1;
  } else {
    index = Math.max(0, Math.min(visibleItems.length - 1, lastSelectedIndex + delta));
  }
  const anchor = extend && selectedItems.size > 0 ? [...selectedItems].map((it) => visibleItems.indexOf(it)) : null;
  selectedItems.clear();
  if (anchor) {
    const [start, end] = [Math.min(...anchor, index), Math.max(...anchor, index)];
    for (let i = start; i <= end; i++) selectedItems.add(visibleItems[i]);
  } else {
    selectedItems.add(visibleItems[index]);
  }
  lastSelectedIndex = index;
  render();
  const li = itemElements.get(visibleItems[index]);
  if (li) li.scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  // ショートカットキーの録音中は、リスト操作のショートカットや ⌘A などに奪わせない
  if (capturingHotkey) return;
  // 設定シートやテキスト入力中はリスト操作のショートカットを奪わない
  if (e.target === searchBar) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    if (e.key === 'Escape') closeSettings();
    return;
  }

  if (!contextMenuEl.hidden && e.key === 'Escape') {
    e.preventDefault();
    closeContextMenu();
    return;
  }

  if (!settingsSheet.hidden) {
    if (e.key === 'Escape') closeSettings();
    return;
  }

  const cmd = e.metaKey || e.ctrlKey;

  // ⌘+A (Mac) / Ctrl+A (Win) で表示中の全アイテムを選択 (検索中は絞り込み結果のみ)
  if (cmd && e.code === 'KeyA') {
    if (visibleItems.length === 0) return;
    e.preventDefault();
    selectedItems.clear();
    for (const item of visibleItems) selectedItems.add(item);
    render();
    return;
  }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moveSelection(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    if (selectedItems.size > 0) {
      selectedItems.clear();
      render();
    } else {
      window.bridge.collapseShelterNow();
    }
    return;
  }

  const first = selectedItems.size > 0 ? [...selectedItems][0] : null;

  if (e.key === 'Enter') {
    const target = first || visibleItems[0];
    if (!target) return;
    e.preventDefault();
    if (cmd) revealItem(target);
    else copyItemToClipboard(target);
    return;
  }

  if ((e.key === 'Backspace' || e.key === 'Delete') && selectedItems.size > 0) {
    e.preventDefault();
    removeSelectedItems();
    return;
  }

  if (cmd && e.code === 'KeyP' && first) {
    e.preventDefault();
    togglePinned(first);
    return;
  }

  // 「/」または ⌘F で検索へ
  if ((cmd && e.code === 'KeyF') || e.key === '/') {
    e.preventDefault();
    searchBar.focus();
    return;
  }

  if (IS_MAC && e.code === 'Space' && first && (first.path || first.kind === 'clip-text')) {
    e.preventDefault();
    previewItem(first);
  }
});

// 何もない場所をクリックしたら選択解除（矩形選択直後のクリックでは解除しない）
let suppressEmptyClick = false;
dropZone.addEventListener('click', (e) => {
  closeContextMenu();
  if (suppressEmptyClick) {
    suppressEmptyClick = false;
    return;
  }
  if (e.target === dropZone || e.target === listEl || e.target.classList.contains('section-header')) {
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
  // アイテム上でのドラッグは対象外（ドラッグ移動/選択と衝突するため）
  if (e.target.closest('.file-item')) return;

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
  window.bridge.holdPointer(true); // 枠を引いている最中はカーソルが外へ出ても格納しない

  e.preventDefault();
});

// 矩形選択の終了処理。mouseup と「ウインドウ外でボタンが離された」検知の両方から呼ぶ
function endRectangleSelection() {
  if (!dragStart) return;
  dragStart = null;
  dragBaseSelection = null;
  window.bridge.holdPointer(false);
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

  // 枠に触れたアイテムを選択に加える（ベース選択とマージ）
  selectedItems.clear();
  for (const item of dragBaseSelection) selectedItems.add(item);
  for (const item of visibleItems) {
    const li = itemElements.get(item);
    if (li && rectsIntersect(pointerRect, li.getBoundingClientRect())) {
      selectedItems.add(item);
    }
  }

  render();
});

document.addEventListener('mouseup', endRectangleSelection);

// ---- 6. コンテキストメニュー (右クリック) ----

function closeContextMenu() {
  contextMenuEl.hidden = true;
  contextMenuEl.textContent = '';
}

function openContextMenu(e, item) {
  e.preventDefault();
  closeContextMenu();
  if (!selectedItems.has(item)) {
    selectedItems.clear();
    selectedItems.add(item);
    lastSelectedIndex = visibleItems.indexOf(item);
    render();
  }
  const mod = IS_MAC ? '⌘' : 'Ctrl+';
  const enterKey = IS_MAC ? '⏎' : 'Enter';
  const entries = [
    { label: 'コピー', shortcut: enterKey, run: () => copyItemToClipboard(item), enabled: !item.downloading },
  ];
  const url = urlOfItem(item);
  if (url) {
    entries.push({ label: 'リンクを開く', shortcut: `${mod}${enterKey}`, run: () => window.bridge.openExternal(url) });
  }
  // クイックルックは macOS 専用
  if (IS_MAC && (item.path || item.kind === 'clip-text')) {
    entries.push({ label: 'クイックルック', shortcut: 'Space', run: () => previewItem(item) });
  }
  if (item.path && item.originKind === 'folder' && !isFolderPath(item) && /\.zip$/i.test(item.path)) {
    entries.push({
      label: 'フォルダとして展開',
      run: async () => {
        const dest = await window.bridge.extractFolderZip(item.path, item.name.replace(/\.zip$/i, ''));
        if (!dest) {
          showToast({ icon: 'warning', title: '展開できませんでした', accent: 'red' });
          return;
        }
        item.path = dest;
        item.name = dest.split(/[\\/]/).pop();
        item.isImage = false;
        item.icon = null;
        item.fileKind = undefined;
        attachFileIcon(item, dest);
        attachFileKind(item, dest);
        render();
        showToast({ icon: 'check', title: 'フォルダに展開しました', durationMs: 2000 });
      },
    });
  }
  if (item.path) {
    entries.push({ type: 'separator' });
    entries.push({
      label: IS_MAC ? 'Finder で表示' : 'エクスプローラーで表示',
      shortcut: `${mod}${enterKey}`,
      run: () => revealItem(item),
    });
    entries.push({ label: '開く', run: () => window.bridge.openFile(item.path) });
    entries.push({
      label: 'パスをコピー',
      run: () => {
        window.bridge.copyPlainText(item.path);
        showToast({ icon: 'check', title: 'パスをコピーしました', durationMs: 1800 });
      },
    });
  }
  // デバイス絞り込みは、複数デバイスのアイテムが実際に混ざっているときだけ意味があるので出す。
  // ローカルアイテムには出身チップを表示しない設計 (§ origin-chip) との非対称を、
  // 常設チップではなく右クリックの入り口で吸収する
  const isLocalItem = !item.fromDevice || item.fromDevice === localDeviceName;
  const hasOtherDeviceItems = items.some((it) => it.fromDevice && it.fromDevice !== localDeviceName);
  if (hasOtherDeviceItems) {
    entries.push({ type: 'separator' });
    entries.push({
      label: isLocalItem ? 'このデバイスのアイテムだけ表示' : `"${item.fromDevice}" のアイテムだけ表示`,
      run: () => setDeviceFilter(isLocalItem ? LOCAL_DEVICE_FILTER : item.fromDevice),
    });
  }
  entries.push({ type: 'separator' });
  entries.push({
    label: item.pinned ? 'ピン留めを解除' : 'ピン留め',
    shortcut: IS_MAC ? '⌘P' : 'Ctrl+P',
    run: () => togglePinned(item),
  });
  if (item.pinned) {
    entries.push({ label: '名前を変更', run: () => startRenamingItem(item) });
  }
  entries.push({
    label: selectedItems.size > 1 ? `${selectedItems.size} 個をリストから外す` : 'リストから外す',
    shortcut: IS_MAC ? '⌫' : 'Del',
    destructive: true,
    run: () => removeSelectedItems(),
  });

  for (const entry of entries) {
    const li = document.createElement('li');
    if (entry.type === 'separator') {
      li.className = 'separator';
      contextMenuEl.appendChild(li);
      continue;
    }
    li.setAttribute('role', 'menuitem');
    li.textContent = entry.label;
    if (entry.destructive) li.classList.add('destructive');
    if (entry.shortcut) {
      const s = document.createElement('span');
      s.className = 'menu-shortcut';
      s.textContent = entry.shortcut;
      li.appendChild(s);
    }
    if (entry.enabled === false) {
      li.style.opacity = '0.4';
      li.style.pointerEvents = 'none';
    }
    li.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeContextMenu();
      entry.run();
    });
    contextMenuEl.appendChild(li);
  }

  // 一度描画して実寸を測り、パネルからはみ出さない位置に置く
  contextMenuEl.hidden = false;
  const shellRect = document.getElementById('shell').getBoundingClientRect();
  const menuRect = contextMenuEl.getBoundingClientRect();
  let left = e.clientX - shellRect.left;
  let top = e.clientY - shellRect.top;
  if (left + menuRect.width > shellRect.width - 8) left = Math.max(8, shellRect.width - 8 - menuRect.width);
  if (top + menuRect.height > shellRect.height - 8) top = Math.max(8, shellRect.height - 8 - menuRect.height);
  contextMenuEl.style.left = `${left}px`;
  contextMenuEl.style.top = `${top}px`;
}

document.addEventListener('mousedown', (e) => {
  if (!contextMenuEl.hidden && !contextMenuEl.contains(e.target)) closeContextMenu();
});
dropZone.addEventListener('scroll', closeContextMenu);
window.addEventListener('blur', closeContextMenu);

// ---- 画面描画 ----

// 日付セクションの見出し。「今日」「昨日」、それ以前は日付 (年が違えば年も付ける)
const { formatFileName, dayKey, sectionLabel, formatTime, formatMetaLine } = window.BridgeFormat;

// ---- カスタムツールチップ (Electron では OS 標準の title 属性が機能しないため自作) ----

let tooltipEl = null;
let tooltipTimer = null;

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
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

  const rect = target.getBoundingClientRect();
  const tipRect = tooltipEl.getBoundingClientRect();
  // 行のすぐ下に出し、実寸を測ってから画面端からのはみ出しを補正する
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

// OS のツールチップと同じく、少し留まってから出す
function scheduleTooltip(target, text) {
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => showTooltip(target, text), 700);
}

// ---- 出身チップ (アプリ / デバイス) ----

function createChip(label, iconEl) {
  const chip = document.createElement('div');
  chip.className = 'origin-chip';
  if (iconEl) chip.appendChild(iconEl);
  const span = document.createElement('span');
  span.textContent = label;
  chip.appendChild(span);
  return chip;
}

// fromDevice が空 (ローカル生成) または自分のデバイス名ならチップは出さず null を返す
function createDeviceChip(item) {
  if (!item.fromDevice || item.fromDevice === localDeviceName) return null;
  const icon = glyph(item.fromPlatform === 'win32' ? 'desktop' : 'laptop');
  return createChip(item.fromDevice, icon);
}

// コピー元アプリ: 名前は出さず、先頭スロットの右下に小さなアイコンだけを重ねる
// (通知センターのアプリバッジと同じ見せ方。名前はツールチップに)。
// アイコンが取れていないときは何も出さない。ファイル行には出さない (常に Finder なので意味がない)
function createSourceAppBadge(item) {
  if (item.kind === 'file' || !item.sourceApp || !item.sourceApp.icon) return null;
  const badge = document.createElement('img');
  badge.className = 'source-app-badge';
  badge.src = item.sourceApp.icon;
  badge.draggable = false;
  badge.alt = item.sourceApp.name || '';
  if (item.sourceApp.name) {
    badge.addEventListener('mouseenter', () => scheduleTooltip(badge, item.sourceApp.name));
    badge.addEventListener('mouseleave', hideTooltip);
  }
  return badge;
}

function createLeading(item) {
  const leading = document.createElement('div');
  leading.className = 'item-leading';
  if (item.downloading || item.syncing) {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    spinner.setAttribute('role', 'progressbar');
    leading.appendChild(spinner);
  } else if (item.kind === 'clip-text') {
    const g = document.createElement('div');
    g.className = 'clip-glyph';
    g.appendChild(glyph('clipboard'));
    leading.appendChild(g);
  } else {
    const img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    if (item.isImage && item.path) {
      img.className = 'file-icon thumbnail';
      img.src = toFileUrl(item.path);
    } else {
      img.className = 'file-icon';
      if (item.icon) img.src = item.icon;
    }
    leading.appendChild(img);
  }
  const sourceBadge = createSourceAppBadge(item);
  if (sourceBadge) leading.appendChild(sourceBadge);
  return leading;
}

function render() {
  // リストを作り直すと mouseleave が発火しないままホバー元の要素が消えるため、
  // 残骸ツールチップをここで必ず取り除く
  hideTooltip();
  listEl.textContent = '';
  itemElements.clear();
  visibleItems = filterItems();

  let currentDay = null;
  for (const item of visibleItems) {
    // ピン留めは先頭にひとまとめ、その後は日付が変わるところにセクション見出しを挟む
    const key = item.pinned ? 'pinned' : item.timestamp ? dayKey(item.timestamp) : 'none';
    if (key !== currentDay) {
      currentDay = key;
      const header = document.createElement('li');
      header.className = 'section-header';
      header.setAttribute('role', 'presentation');
      header.textContent = item.pinned ? 'ピン留め' : item.timestamp ? sectionLabel(item.timestamp) : '';
      listEl.appendChild(header);
    }

    const li = document.createElement('li');
    li.className = 'file-item';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', selectedItems.has(item) ? 'true' : 'false');
    if (selectedItems.has(item)) li.classList.add('selected');
    if (item.removing) li.classList.add('removing');
    if (item.downloading) li.classList.add('downloading');
    if (item.syncing) li.classList.add('syncing');
    if (item.missing) li.classList.add('missing');
    if (item.entering) {
      li.classList.add('entering');
      item.entering = false; // 次の再描画からは通常の行として扱う
    }
    li.draggable = !item.removing && !item.downloading && !item.syncing;
    li.addEventListener('click', (e) => onItemClick(e, item));
    li.addEventListener('dragstart', (e) => onItemDragStart(e, item));
    li.addEventListener('contextmenu', (e) => openContextMenu(e, item));

    li.appendChild(createLeading(item));

    // 中央: 名前 (テキスト履歴は冒頭プレビュー) + 「種別 · 時刻」 + 出身チップ
    const lines = document.createElement('div');
    lines.className = 'item-lines';

    const titleEl = document.createElement('div');
    titleEl.className = 'item-title' + (item.kind === 'clip-text' && !item.customTitle ? ' clip-preview' : '');
    if (item.customTitle) {
      // ピン留めに付けた自分用のタイトル (例: 「メール署名」) は本文プレビューより優先する
      titleEl.textContent = item.customTitle;
    } else if (item.kind === 'clip-text') {
      titleEl.textContent = item.name;
    } else if (item.downloading || item.syncing) {
      titleEl.textContent = item.name;
    } else {
      const isRealFile = item.kind === 'file' && item.fileKind !== 'フォルダ';
      titleEl.textContent = formatFileName(item.name, isRealFile);
    }

    // ホバーで全文 (クリップボードは本文全体) をツールチップ表示
    const fullText = item.kind === 'clip-text' ? item.text : item.name;
    titleEl.addEventListener('mouseenter', () => scheduleTooltip(titleEl, fullText));
    titleEl.addEventListener('mouseleave', hideTooltip);
    lines.appendChild(titleEl);

    const kindLabel =
      item.kind === 'clip-text'
        ? urlOfItem(item)
          ? 'リンク'
          : 'テキスト'
        : item.kind === 'clip-image'
          ? '画像'
          : item.downloading
            ? '保存中'
            : item.originKind === 'folder' && !isFolderPath(item)
              ? 'フォルダ (zip)'
              : item.fileKind || 'ファイル'; // Finder 純正の種類名 (取得前は「ファイル」で暫定表示)
    const metaLine = document.createElement('div');
    metaLine.className = 'item-meta-line';
    metaLine.textContent = item.syncing
      ? syncMetaText(item)
      : item.missing
        ? '見つかりません · 移動または削除されました'
        : item.timestamp
          ? formatMetaLine(kindLabel, item.timestamp)
          : kindLabel;
    if (item.pinned) {
      const pinIcon = glyph('pin');
      pinIcon.classList.add('meta-pin');
      metaLine.prepend(pinIcon);
    }
    lines.appendChild(metaLine);

    const deviceChip = createDeviceChip(item);
    if (deviceChip) {
      const badgeLine = document.createElement('div');
      badgeLine.className = 'item-badge-line';
      badgeLine.appendChild(deviceChip);
      lines.appendChild(badgeLine);
    }

    if (item.syncing) {
      // 同期中は「止まっているかも」のときだけ再試行ボタンを出し、× は常に押せるようにする
      // (ホバーでしか出ない通常の削除ボタンだと、止まっているかの確認と中止がすぐにできない)
      const retryBtn = document.createElement('button');
      retryBtn.className = 'remove-button sync-retry-button';
      retryBtn.hidden = !item.stalled;
      retryBtn.setAttribute('aria-label', 'もう一度試す');
      retryBtn.tabIndex = -1;
      retryBtn.appendChild(glyph('retry'));
      retryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        retrySyncItem(item);
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'remove-button sync-cancel-button';
      cancelBtn.setAttribute('aria-label', '同期を中止');
      cancelBtn.tabIndex = -1;
      cancelBtn.appendChild(glyph('xmark'));
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelSyncItem(item);
      });

      li.append(lines, retryBtn, cancelBtn);
    } else {
      // ホバー時に現れる削除ボタン
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-button';
      removeBtn.setAttribute('aria-label', 'リストから外す');
      removeBtn.tabIndex = -1;
      removeBtn.appendChild(glyph('xmark'));
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // アイテムの選択を発火させない
        fadeOutAndRemove(item);
      });

      li.append(lines, removeBtn);
    }
    listEl.appendChild(li);
    itemElements.set(item, li);
  }

  const noItems = items.length === 0;
  const noVisible = visibleItems.length === 0;

  // 検索で 0 件のときはプレースホルダの文言を切り替えて「該当なし」を伝える
  emptyLabel.textContent = noItems ? 'ここにファイルをドロップ' : '一致するアイテムはありません';
  emptySub.hidden = !noItems;
  emptyEl.hidden = !noVisible;
  listEl.hidden = noVisible;
  // キーワード検索中だけヒット数を出す。file/clip や device の絞り込みだけでは出さない —
  // こちらは履歴の上限 (テキスト100 / 画像30 / ファイル100) にすぐ頭打ちになり、
  // 使い込むほど同じ数字が表示され続けるだけで情報にならないため。
  // キーワードは毎回変わるので Finder/Spotlight の検索結果同様、意味のある数字になる
  const hasKeyword = searchQuery.trim().length > 0;
  countEl.textContent = hasKeyword && !noItems ? `${visibleItems.length} 個` : '';
  clearBtn.hidden = noItems;

  // デバイス絞り込み中だけ、種別セグメントの下に「今どのデバイスに絞っているか」を
  // チップとして出す (✕ で解除)。file/clip の絞り込みと同じ並びに置き、footer は状態表示専用に保つ
  deviceFilterText.textContent = deviceFilterLabelText();
  deviceFilterChip.hidden = !deviceFilter;

  // 設定シートを開いたまま新しいコピーが増えることもあるので、開いている間だけ内訳も追従させる
  if (!settingsSheet.hidden) updateHistoryUsage();

  // 終了時クリーンアップ (残骸ファイル削除) の判定用に、
  // 「現在リストに保持しているパス」を Main プロセスへ常時共有する
  window.bridge.reportRetainedPaths(items.map((it) => it.path).filter(Boolean));
  schedulePersist();
}

// ---- 履歴の永続化 ----
// 描画のたびに保存用の一覧を Main へ渡す (Main 側で 0.5 秒デバウンスして history.json に書く)。
// アイコンは起動時に取り直せるので保存しない。処理中 (保存中・フェードアウト中) の行も保存しない
let persistTimer = null;

function serializeItems() {
  return items
    .filter((it) => !it.downloading && !it.removing && !it.syncing)
    .map((it) => ({
      kind: it.kind,
      originKind: it.originKind || null,
      path: it.path,
      name: it.name,
      text: it.text,
      isImage: it.isImage,
      timestamp: it.timestamp,
      fileKind: it.fileKind || null,
      fromDevice: it.fromDevice,
      fromPlatform: it.fromPlatform,
      sourceApp: it.sourceApp ? { name: it.sourceApp.name, icon: it.sourceApp.icon || null } : null,
      pinned: Boolean(it.pinned),
      customTitle: it.customTitle || null,
    }));
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    window.bridge.persistItems(serializeItems());
  }, 300);
}

// 起動時 (と Renderer の再起動時) に前回の一覧を復元する。既にあるものは重複させない
window.bridge.onRestoreItems((saved) => {
  let added = 0;
  for (const s of saved) {
    if (!s || !s.kind) continue;
    const duplicate = items.some((it) =>
      it.kind === s.kind && (s.path ? it.path === s.path : s.kind === 'clip-text' && it.text === s.text)
    );
    if (duplicate) continue;
    const item = {
      kind: s.kind,
      path: s.path || null,
      name: s.name || '',
      text: s.text || null,
      icon: null,
      isImage: Boolean(s.isImage),
      downloading: false,
      removing: false,
      timestamp: Number(s.timestamp) || Date.now(),
      fileKind: s.fileKind || undefined,
      originKind: s.originKind || null,
      fromDevice: s.fromDevice || null,
      fromPlatform: s.fromPlatform || null,
      sourceApp: s.sourceApp || null,
      pinned: Boolean(s.pinned),
      customTitle: s.customTitle || null,
    };
    // 画像の履歴は実体 PNG が無ければ復元できない
    if (item.kind === 'clip-image' && !item.path) continue;
    items.push(item);
    added++;
    if (item.kind === 'file' && item.path) {
      attachFileIcon(item, item.path);
      if (!item.fileKind) attachFileKind(item, item.path);
    }
  }
  if (added > 0) {
    render();
    refreshMissingFiles();
  }
});

// 空状態のヒントはショートカットを OS に合わせて表記する
{
  emptySub.textContent = '';
  const kbd = document.createElement('kbd');
  kbd.textContent = IS_MAC ? '⌘C' : 'Ctrl+C';
  emptySub.append(kbd, ' でコピーした内容も自動で並びます');
}

clearBtn.addEventListener('click', () => {
  // ピン留めは残す。誤操作からの回復手段として、消した内容そのものをクロージャに保持して
  // 「元に戻す」で丸ごと復元できるようにする (ディスク上のファイルには一切触れないため安全)
  const removed = items.filter((it) => !it.pinned);
  if (removed.length === 0) return;
  const kept = items.filter((it) => it.pinned);
  items.length = 0;
  items.push(...kept);
  selectedItems.clear();
  render();
  showToast({
    icon: 'trash',
    title: `${removed.length} 個を消去しました`,
    sub: kept.length > 0 ? 'ピン留めは残しています' : '',
    actionLabel: '元に戻す',
    onAction: () => {
      items.unshift(...removed);
      render();
    },
    durationMs: 5000,
  });
});

// ---- 7. 同期状態 (フッターのインジケーター) ----

let syncStatus = { peers: [], onlineCount: 0 };

const pauseLabel = document.getElementById('pause-label');

function renderSyncStatus() {
  const { peers, onlineCount, clipboardPaused, syncPaused } = syncStatus;
  const paused = clipboardPaused || syncPaused;
  syncDot.hidden = peers.length === 0 && !paused;
  syncDot.classList.toggle('online', onlineCount > 0 && !paused);
  syncDot.classList.toggle('paused', Boolean(paused));
  const names = peers.filter((p) => p.online).map((p) => p.device || p.host);
  syncDot.title = paused
    ? '一時停止中 (メニューバーから再開できます)'
    : onlineCount > 0
      ? `${names.join('、')} と同期中`
      : 'ほかのデバイスが見つかりません';
  pauseLabel.textContent = clipboardPaused && syncPaused
    ? '監視と同期を停止中'
    : clipboardPaused
      ? '監視を停止中'
      : syncPaused
        ? '同期を停止中'
        : '';
  pauseLabel.hidden = !paused;

  // 最終同期時刻のサマリーは footer には出さない (今何を見ているかの状態表示に絞る)。
  // 個別の最終同期時刻はデバイスごとに設定シートのピア一覧で確認できる (renderPeerList 側)
  renderPeerList();
}

window.bridge.onSyncStatus((status) => {
  syncStatus = status || { peers: [], onlineCount: 0 };
  renderSyncStatus();
});
window.bridge
  .getSyncStatus()
  .then((status) => {
    syncStatus = status || { peers: [], onlineCount: 0 };
    renderSyncStatus();
  })
  .catch(() => {});

// ---- ショートカットキーの録音 (「フィールドをクリックして押す」方式) ----
// OS 設定アプリやターミナルの類似 UI と同じ: フィールドをクリックすると次に押した組み合わせを
// そのまま記録する。プリセットからの選択ではなく実際のキー入力を取るので、他アプリとの衝突を
// 各自の環境に合わせて自由に避けられる
let capturingHotkey = false;

const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);

// 電子 (Electron) の accelerator 文字列に使えるキー名。実用上よく使うものだけをサポートする
function acceleratorKeyName(e) {
  if (e.code.startsWith('Key')) return e.code.slice(3); // KeyV → V
  if (e.code.startsWith('Digit')) return e.code.slice(5); // Digit1 → 1
  if (e.code.startsWith('Numpad') && /^Numpad\d$/.test(e.code)) return `num${e.code.slice(6)}`;
  if (/^F\d{1,2}$/.test(e.code)) return e.code; // F1..F24
  if (e.code.startsWith('Arrow')) return e.code.slice(5); // ArrowUp → Up
  const named = {
    Space: 'Space',
    Tab: 'Tab',
    Enter: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  return named[e.code] || null;
}

// キーイベントから { accelerator, label } を作る。修飾キーが 1 つも無い、または
// 対応していないキーのときは null (呼び出し側は録音を続ける)
function eventToAccelerator(e) {
  const keyName = acceleratorKeyName(e);
  if (!keyName) return null;
  const mods = [];
  if (IS_MAC) {
    if (e.metaKey) mods.push('Command');
    if (e.ctrlKey) mods.push('Control');
  } else {
    if (e.ctrlKey) mods.push('Control');
    if (e.metaKey) mods.push('Super'); // Windows キー
  }
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  // グローバルホットキーとして安全な組み合わせにするため、Shift 以外の修飾キーを 1 つ以上要求する
  if (!mods.some((m) => m !== 'Shift')) return null;
  const accelerator = [...mods, keyName].join('+');
  const symbols = IS_MAC
    ? { Command: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Control: 'Ctrl', Super: 'Win', Alt: 'Alt', Shift: 'Shift' };
  const label = IS_MAC
    ? [...mods.map((m) => symbols[m]), keyName].join('')
    : [...mods.map((m) => symbols[m]), keyName].join('+');
  return { accelerator, label };
}

// フィールドを「録音中」にする。次の有効なキー入力で確定し、Esc または他所クリックで取り消す
function startHotkeyCapture(button) {
  if (capturingHotkey) stopHotkeyCapture(false);
  capturingHotkey = true;
  button.classList.add('recording');
  button.classList.remove('conflict');
  const previousLabel = button.textContent;
  button.textContent = '押してください…';

  const onKeydown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      stopHotkeyCapture(false, previousLabel);
      return;
    }
    if (MODIFIER_CODES.has(e.code)) return; // 修飾キー単体では確定しない。押しっぱなしの続きを待つ
    const result = eventToAccelerator(e);
    if (!result) {
      // Ctrl/Alt/Cmd を含まない組み合わせは受け付けない。一瞬赤くして録音は続ける
      button.classList.add('conflict');
      setTimeout(() => button.classList.remove('conflict'), 300);
      return;
    }
    button.dataset.accelerator = result.accelerator;
    stopHotkeyCapture(true, result.label);
  };

  const onBlur = () => stopHotkeyCapture(false, previousLabel);

  button.addEventListener('keydown', onKeydown);
  button.addEventListener('blur', onBlur);
  button._hotkeyCleanup = () => {
    button.removeEventListener('keydown', onKeydown);
    button.removeEventListener('blur', onBlur);
  };
  button.focus();

  function stopHotkeyCapture(committed, label) {
    capturingHotkey = false;
    button.classList.remove('recording');
    if (button._hotkeyCleanup) {
      button._hotkeyCleanup();
      button._hotkeyCleanup = null;
    }
    if (typeof label === 'string') button.textContent = label;
  }
}

function setupHotkeyField(button, resetButton, initialAccelerator, initialLabel) {
  button.dataset.accelerator = initialAccelerator;
  button.textContent = initialLabel;
  button.addEventListener('click', () => startHotkeyCapture(button));
  resetButton.addEventListener('click', () => {
    const def = button.dataset.default;
    const defLabel = button.dataset.defaultLabel;
    if (def) {
      button.dataset.accelerator = def;
      button.textContent = defLabel || def;
    }
  });
}

// ---- 8. 設定シート ----

const settingsSheet = document.getElementById('settings-sheet');
const settingHistoryUsage = document.getElementById('setting-history-usage');
const settingDeviceName = document.getElementById('setting-device-name');
const settingToken = document.getElementById('setting-token');
const settingTokenCopy = document.getElementById('setting-token-copy');
const settingAutoScan = document.getElementById('setting-autoscan');
const settingPeers = document.getElementById('setting-peers');
const settingPeerList = document.getElementById('setting-peer-list');
const settingLogin = document.getElementById('setting-login');
const settingHotkeyHelp = document.getElementById('setting-hotkey-help');
const settingAutoPaste = document.getElementById('setting-autopaste');
const settingSourceApp = document.getElementById('setting-sourceapp');
const settingSourceAppHelp = document.getElementById('setting-sourceapp-help');
const settingPasteHelp = document.getElementById('setting-paste-help');
const settingHotkeyToggle = document.getElementById('setting-hotkey-toggle');
const settingHotkeyToggleReset = document.getElementById('setting-hotkey-toggle-reset');
const settingHotkeyPaste = document.getElementById('setting-hotkey-paste');
const settingHotkeyPasteReset = document.getElementById('setting-hotkey-paste-reset');
const settingVersion = document.getElementById('setting-version');
const settingCheckUpdate = document.getElementById('setting-check-update');
setupHotkeyField(settingHotkeyToggle, settingHotkeyToggleReset, '', '');
setupHotkeyField(settingHotkeyPaste, settingHotkeyPasteReset, '', '');

function renderPeerList() {
  settingPeerList.textContent = '';
  const peers = syncStatus.peers || [];
  if (peers.length === 0) {
    const li = document.createElement('li');
    li.className = 'peer-empty';
    li.textContent = '同じネットワークに Bridge が見つかると、ここに表示されます。';
    settingPeerList.appendChild(li);
    return;
  }
  for (const peer of peers) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'sync-dot' + (peer.online ? ' online' : '');
    const name = document.createElement('span');
    name.className = 'peer-name';
    name.textContent = peer.device || peer.host;
    const addr = document.createElement('span');
    addr.className = 'peer-addr';
    // 診断用: オンラインなら「アドレス · 最終同期 時刻」、オフラインなら最後の失敗理由
    if (peer.online) {
      addr.textContent = peer.lastSyncedAt ? `${peer.host} · ${formatTime(peer.lastSyncedAt)} 同期` : peer.host;
    } else {
      addr.textContent = peer.lastError || 'オフライン';
      addr.title = peer.host;
    }
    li.append(dot, name, addr);
    settingPeerList.appendChild(li);
  }
}

// クリップ履歴 (テキスト/画像) とファイルはそれぞれ上限に達すると古いものから自動で消える
// (§ trimClipHistory / trimFileHistory)。ピン留めは上限の対象外なので、内訳からも除いて数える。
// 気づかないうちに上限に張り付いていることがあるので、設定シートで内訳を出して
// 「そろそろピン留めしないと消える」がユーザー自身に見えるようにする
function updateHistoryUsage() {
  const nonPinned = items.filter((it) => !it.pinned);
  const textCount = nonPinned.filter((it) => it.kind === 'clip-text').length;
  const imageCount = nonPinned.filter((it) => it.kind === 'clip-image').length;
  const fileCount = nonPinned.filter((it) => it.kind === 'file').length;
  const pinnedCount = items.length - nonPinned.length;
  let text = `テキスト ${textCount}/${MAX_TEXT_CLIP_ITEMS} · 画像 ${imageCount}/${MAX_IMAGE_CLIP_ITEMS} · ファイル ${fileCount}/${MAX_FILE_ITEMS}`;
  if (pinnedCount > 0) text += `（ピン留め ${pinnedCount} 件は上限の対象外）`;
  settingHistoryUsage.textContent = text;
}

async function openSettings() {
  closeContextMenu();
  hideTooltip();
  updateHistoryUsage();
  try {
    const s = await window.bridge.getSettings();
    settingDeviceName.value = s.deviceName || '';
    settingToken.value = s.secretToken || '';
    settingAutoScan.checked = Boolean(s.autoScan);
    settingPeers.value = (s.peers || []).join('\n');
    settingLogin.checked = Boolean(s.openAtLogin);
    settingAutoPaste.checked = Boolean(s.autoPaste);
    settingSourceApp.checked = Boolean(s.showSourceApp);
    settingSourceAppHelp.textContent = IS_MAC
      ? 'テキストや画像の行に、コピーしたときに使っていたアプリのアイコンを小さく重ねます。'
      : 'コピーのたびに PowerShell を起動するため、Windows では少し重くなります。';
    settingHotkeyToggle.dataset.accelerator = s.toggleShortcut || '';
    settingHotkeyToggle.dataset.default = s.defaultToggleShortcut || '';
    settingHotkeyToggle.dataset.defaultLabel = s.defaultToggleShortcutLabel || '';
    settingHotkeyToggle.textContent = s.hotkeyLabel || '';
    settingHotkeyPaste.dataset.accelerator = s.pasteShortcut || '';
    settingHotkeyPaste.dataset.default = s.defaultPasteShortcut || '';
    settingHotkeyPaste.dataset.defaultLabel = s.defaultPasteShortcutLabel || '';
    settingHotkeyPaste.textContent = s.pasteHotkeyLabel || '';
    settingHotkeyHelp.textContent = 'フィールドをクリックして押したいキーの組み合わせを押してください。Ctrl / Alt / ⌘ のいずれかを含める必要があります。';
    settingVersion.textContent = s.version ? `Bridge ${s.version}` : '';
    settingPasteHelp.textContent = IS_MAC
      ? '自動ペーストには「システム設定 > プライバシーとセキュリティ > アクセシビリティ」で Bridge の許可が必要です。'
      : '';
  } catch (err) {
    console.error('設定の読み込みに失敗:', err);
  }
  renderPeerList();
  settingsSheet.hidden = false;
  document.body.classList.add('settings-open');
  settingDeviceName.focus();
}

function closeSettings() {
  if (settingsSheet.hidden) return;
  settingsSheet.hidden = true;
  document.body.classList.remove('settings-open');
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

async function saveSettings() {
  const payload = {
    deviceName: settingDeviceName.value,
    secretToken: settingToken.value,
    autoScan: settingAutoScan.checked,
    peers: settingPeers.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    openAtLogin: settingLogin.checked,
    autoPaste: settingAutoPaste.checked,
    showSourceApp: settingSourceApp.checked,
    toggleShortcut: settingHotkeyToggle.dataset.accelerator || undefined,
    pasteShortcut: settingHotkeyPaste.dataset.accelerator || undefined,
  };
  try {
    const result = await window.bridge.saveSettings(payload);
    if (result && result.ok) {
      // 実際に登録できたキーへ表示を合わせる (競合で失敗していれば元のキーに戻っている)
      if (result.toggleShortcut) {
        settingHotkeyToggle.dataset.accelerator = result.toggleShortcut;
        settingHotkeyToggle.textContent = result.hotkeyLabel || settingHotkeyToggle.textContent;
      }
      if (result.pasteShortcut) {
        settingHotkeyPaste.dataset.accelerator = result.pasteShortcut;
        settingHotkeyPaste.textContent = result.pasteHotkeyLabel || settingHotkeyPaste.textContent;
      }
      if (result.hotkeyError) {
        const field = result.hotkeyError === 'toggle' ? settingHotkeyToggle : settingHotkeyPaste;
        field.classList.add('conflict');
        setTimeout(() => field.classList.remove('conflict'), 1500);
        showToast({
          icon: 'warning',
          title: 'そのキーの組み合わせは使用中です',
          sub: '他の設定は保存し、このショートカットだけ元のキーに戻しました',
          accent: 'amber',
          durationMs: 5000,
        });
        return; // シートは開いたまま、もう一度試せるようにする
      }
      closeSettings();
      showToast({ icon: 'check', title: '設定を保存しました', durationMs: 2000 });
      window.bridge.getDeviceInfo().then((info) => {
        if (info && info.device) {
          localDeviceName = info.device;
          render();
        }
      });
    } else {
      showToast({ icon: 'warning', title: '設定を保存できませんでした', accent: 'red' });
    }
  } catch (err) {
    console.error('設定の保存に失敗:', err);
    showToast({ icon: 'warning', title: '設定を保存できませんでした', accent: 'red' });
  }
}

settingsBtn.addEventListener('click', openSettings);
const settingScan = document.getElementById('setting-scan');
settingScan.addEventListener('click', async () => {
  settingScan.disabled = true;
  settingScan.textContent = '探しています…';
  try {
    const status = await window.bridge.scanPeersNow();
    if (status) {
      syncStatus = status;
      renderSyncStatus();
    }
  } catch {
    // 失敗しても一覧はそのまま
  } finally {
    settingScan.disabled = false;
    settingScan.textContent = 'いま探す';
  }
});
document.getElementById('setting-log').addEventListener('click', () => window.bridge.revealLog());
document.getElementById('settings-back').addEventListener('click', closeSettings);
document.getElementById('settings-save').addEventListener('click', saveSettings);
settingTokenCopy.addEventListener('click', () => {
  window.bridge.copyPlainText(settingToken.value);
  showToast({ icon: 'check', title: '同期キーをコピーしました', durationMs: 1800 });
});
settingCheckUpdate.addEventListener('click', () => window.bridge.checkForUpdates());
window.bridge.onOpenSettings(() => openSettings());

// 自動ペーストにアクセシビリティの許可が無いとき (macOS)
window.bridge.onPastePermissionNeeded(() => {
  showToast({
    icon: 'warning',
    title: '自動ペーストには許可が必要です',
    sub: 'システム設定 > プライバシーとセキュリティ > アクセシビリティ で Bridge をオンにしてください',
    accent: 'amber',
    actionLabel: '設定を開く',
    onAction: () => window.bridge.openAccessibilitySettings(),
    durationMs: 12000,
  });
});

// ---- アップデートの通知 ----
window.bridge.onUpdateAvailable(({ version, url }) => {
  showToast({
    icon: 'info',
    title: `Bridge ${version} が利用できます`,
    sub: 'ダウンロードページを開いて入れ替えてください',
    actionLabel: 'ダウンロード',
    onAction: () => window.bridge.openExternal(url),
    durationMs: 15000,
  });
});
window.bridge.onUpdateNone(({ version, error }) => {
  showToast({
    icon: error ? 'warning' : 'check',
    title: error ? '確認できませんでした' : `最新版です (${version})`,
    sub: error ? 'ネットワークまたは GitHub に接続できません' : '',
    accent: error ? 'amber' : 'neutral',
    durationMs: 3000,
  });
});

render();
