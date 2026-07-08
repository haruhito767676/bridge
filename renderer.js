// シェルフに置かれたファイル: { path, name, icon, isImage, downloading, removing }
const items = [];
let selectedItem = null;

const dropZone = document.getElementById('drop-zone');
const listEl = document.getElementById('file-list');
const emptyEl = document.getElementById('empty-state');
const countEl = document.getElementById('item-count');
const clearBtn = document.getElementById('clear-button');

// ---- 画像判定とサムネイル用ヘルパー ----

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];

function isImagePath(filePath) {
  const match = /\.([^./\\]+)$/.exec(filePath);
  return match !== null && IMAGE_EXTS.includes(match[1].toLowerCase());
}

// 絶対パスを <img> の src に使える file:// URL に変換 (空白や日本語もエスケープ)
function toFileUrl(filePath) {
  return 'file://' + filePath.split('/').map(encodeURIComponent).join('/');
}

// ---- 1. ファイルを受け取る（Finder → Bridge / Web → Bridge / bridge:// → Bridge）----

// ウインドウ全体でブラウザ既定のファイルオープン動作を止める
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

// ローカルファイルをリストへ追加する共通処理
function addLocalFile(filePath, fileName) {
  if (!filePath) return;
  if (items.some((item) => item.path === filePath)) return; // 重複は追加しない

  const item = {
    path: filePath,
    name: fileName || filePath.split('/').pop(),
    icon: null,
    isImage: isImagePath(filePath),
    downloading: false,
    removing: false,
  };
  items.push(item);

  // 画像はファイル自体をサムネイル表示するのでアイコン取得は不要
  if (!item.isImage) {
    window.bridge.getFileIcon(filePath).then((dataUrl) => {
      if (dataUrl) {
        item.icon = dataUrl;
        render();
      }
    });
  }
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
    path: null,
    name: url,
    icon: null,
    isImage: false,
    downloading: true,
    removing: false,
  };
  items.push(item);
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
      if (!item.isImage) {
        window.bridge.getFileIcon(path).then((dataUrl) => {
          if (dataUrl) {
            item.icon = dataUrl;
            render();
          }
        });
      }
      render();
    })
    .catch((err) => {
      console.error('ダウンロード失敗:', url, err);
      item.name = 'ダウンロード失敗';
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

  // ファイルがなければ Web 画像/リンクのドロップとみなし URL を抽出
  if (!addedFile) {
    const url = extractWebUrl(e.dataTransfer);
    if (url) addWebUrl(url);
  }
});

// bridge:// URL スキーム経由 (Mac クイックアクション等) で届いたファイル
window.bridge.onAddFile((filePath) => addLocalFile(filePath));

// ---- 2. 個別削除（リストから外すだけ。元のファイルには触れない）----

function removeItem(item) {
  const index = items.indexOf(item);
  if (index === -1) return;
  items.splice(index, 1);
  if (selectedItem === item) selectedItem = null;
  render();
}

// フェードアウトしてから削除する
function fadeOutAndRemove(item) {
  if (item.removing) return;
  item.removing = true;
  render();
  setTimeout(() => removeItem(item), 200);
}

// ---- 3. ファイルを外へ引き出す（Bridge → Finder 等）----

function onItemDragStart(e, item) {
  // HTML5 のドラッグを止め、OS標準のネイティブドラッグに置き換える
  e.preventDefault();
  if (item.downloading || !item.path) return;
  window.bridge.startDrag(item.path);

  // ドラッグ開始と同時にフェードアウトしてリストから削除
  setTimeout(() => fadeOutAndRemove(item), 0);
}

// ---- 4. 選択 + スペースキーでクイックルック ----

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !selectedItem || !selectedItem.path) return;
  e.preventDefault();
  window.bridge.previewFile(selectedItem.path, selectedItem.name);
});

// 何もない場所をクリックしたら選択解除
dropZone.addEventListener('click', (e) => {
  if (e.target === dropZone || e.target === listEl) {
    selectedItem = null;
    render();
  }
});

// ---- 画面描画 ----

function render() {
  listEl.textContent = '';

  for (const item of items) {
    const li = document.createElement('li');
    li.className =
      'file-item' +
      (item === selectedItem ? ' selected' : '') +
      (item.removing ? ' removing' : '') +
      (item.downloading ? ' downloading' : '');
    li.draggable = !item.removing && !item.downloading;
    li.title = item.path || item.name;
    li.addEventListener('click', () => {
      selectedItem = item;
      render();
    });
    li.addEventListener('dragstart', (e) => onItemDragStart(e, item));

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

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.downloading ? `ダウンロード中… ${item.name}` : item.name;

    // ホバー時に現れる「×」ボタン
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-button';
    removeBtn.title = 'リストから外す';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // アイテムの選択を発火させない
      fadeOutAndRemove(item);
    });

    li.append(img, name, removeBtn);
    listEl.appendChild(li);
  }

  const isEmpty = items.length === 0;
  emptyEl.hidden = !isEmpty;
  listEl.hidden = isEmpty;
  countEl.textContent = isEmpty ? '' : `${items.length} 個`;
  clearBtn.hidden = isEmpty;
}

clearBtn.addEventListener('click', () => {
  items.length = 0;
  selectedItem = null;
  render();
});

render();
