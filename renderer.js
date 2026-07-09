// シェルフに置かれたファイル: { path, name, icon, isImage, downloading, removing }
const items = [];
const selectedItems = new Set();
let lastSelectedIndex = null;

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

// ---- つまみホバー / ドラッグ進入でシェルターを開き、外れたら閉じる ----

document.addEventListener('mouseenter', () => window.bridge.expandShelter());
document.addEventListener('mouseleave', () => window.bridge.collapseShelter());
document.addEventListener('dragenter', () => window.bridge.expandShelter());
document.addEventListener('dragleave', (e) => {
  // ウインドウの外へ本当に抜けたときだけ閉じる（子要素間の移動では relatedTarget が null にならない）
  if (e.relatedTarget === null) window.bridge.collapseShelter();
});

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

// ドラッグされた選択テキストを Main プロセスで snippet_[タイムスタンプ].txt として保存し追加する
function addTextSnippet(text) {
  const item = {
    path: null,
    name: 'テキストを保存中…',
    icon: null,
    isImage: false,
    downloading: true,
    removing: false,
  };
  items.push(item);
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
      item.name = path.split('/').pop();
      item.downloading = false;
      window.bridge.getFileIcon(path).then((dataUrl) => {
        if (dataUrl) {
          item.icon = dataUrl;
          render();
        }
      });
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

// bridge:// URL スキーム経由 (Mac クイックアクション等) で届いたファイル
window.bridge.onAddFile((filePath) => addLocalFile(filePath));

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
  if (item.downloading || !item.path) return;

  // 選択されていないアイテムをドラッグし始めたら、そのアイテム単体の選択に切り替える (Finder と同じ挙動)
  if (!selectedItems.has(item)) {
    selectedItems.clear();
    selectedItems.add(item);
    render();
  }

  const draggedItems = [...selectedItems].filter((it) => it.path && !it.downloading);
  if (draggedItems.length === 0) return;
  window.bridge.startDrag(draggedItems.map((it) => it.path));

  // ドラッグ開始と同時にフェードアウトしてリストから削除
  for (const it of draggedItems) {
    setTimeout(() => fadeOutAndRemove(it), 0);
  }
}

// ---- 4. 選択（複数選択対応）+ スペースキーでクイックルック ----

function onItemClick(e, item) {
  const index = items.indexOf(item);
  if (e.metaKey || e.ctrlKey) {
    // ⌘/Ctrl+クリックで個別にトグル
    if (selectedItems.has(item)) selectedItems.delete(item);
    else selectedItems.add(item);
  } else if (e.shiftKey && lastSelectedIndex !== null) {
    // Shift+クリックで範囲選択
    const [start, end] = [lastSelectedIndex, index].sort((a, b) => a - b);
    selectedItems.clear();
    for (let i = start; i <= end; i++) selectedItems.add(items[i]);
  } else {
    selectedItems.clear();
    selectedItems.add(item);
  }
  lastSelectedIndex = index;
  render();
}

document.addEventListener('keydown', (e) => {
  // ⌘+A (Mac) / Ctrl+A (Win) でリスト内の全アイテムを選択
  if ((e.metaKey || e.ctrlKey) && e.code === 'KeyA') {
    if (items.length === 0) return;
    e.preventDefault();
    selectedItems.clear();
    for (const item of items) selectedItems.add(item);
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

document.addEventListener('mousemove', (e) => {
  if (!dragStart) return;
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
  items.forEach((item, i) => {
    const li = listEl.children[i];
    if (li && rectsIntersect(pointerRect, li.getBoundingClientRect())) {
      selectedItems.add(item);
    }
  });

  render();
});

document.addEventListener('mouseup', () => {
  if (!dragStart) return;
  dragStart = null;
  dragBaseSelection = null;
  if (selectionBox) selectionBox.hidden = true;
  // ドラッグして選択した直後に発火する click イベントで選択が消えないようにする
  if (dragMoved) suppressEmptyClick = true;
});

// ---- 画面描画 ----

function render() {
  listEl.textContent = '';

  for (const item of items) {
    const li = document.createElement('li');
    li.className =
      'file-item' +
      (selectedItems.has(item) ? ' selected' : '') +
      (item.removing ? ' removing' : '') +
      (item.downloading ? ' downloading' : '');
    li.draggable = !item.removing && !item.downloading;
    li.title = item.path || item.name;
    li.addEventListener('click', (e) => onItemClick(e, item));
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
  selectedItems.clear();
  render();
});

render();
