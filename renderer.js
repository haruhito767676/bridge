// シェルフに置かれたファイル: { path, name, icon, removing }
const items = [];
let selectedItem = null;

const dropZone = document.getElementById('drop-zone');
const listEl = document.getElementById('file-list');
const emptyEl = document.getElementById('empty-state');
const countEl = document.getElementById('item-count');
const clearBtn = document.getElementById('clear-button');

// ---- 1. ファイルを受け取る（Finder → Bridge）----

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

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  for (const file of e.dataTransfer.files) {
    // Electron 32+ では file.path が廃止されたため webUtils 経由で絶対パスを取得
    const filePath = window.bridge.getPathForFile(file);
    if (!filePath) continue;
    if (items.some((item) => item.path === filePath)) continue; // 重複は追加しない

    const item = { path: filePath, name: file.name, icon: null, removing: false };
    items.push(item);

    // OS標準アイコンは Main プロセスから非同期で取得し、届いたら再描画
    window.bridge.getFileIcon(filePath).then((dataUrl) => {
      if (dataUrl) {
        item.icon = dataUrl;
        render();
      }
    });
  }
  render();
});

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
  window.bridge.startDrag(item.path);

  // ドラッグ開始と同時にフェードアウトしてリストから削除
  setTimeout(() => fadeOutAndRemove(item), 0);
}

// ---- 4. 選択 + スペースキーでクイックルック ----

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !selectedItem) return;
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
      (item.removing ? ' removing' : '');
    li.draggable = !item.removing;
    li.title = item.path;
    li.addEventListener('click', () => {
      selectedItem = item;
      render();
    });
    li.addEventListener('dragstart', (e) => onItemDragStart(e, item));

    const img = document.createElement('img');
    img.className = 'file-icon';
    img.draggable = false;
    if (item.icon) img.src = item.icon;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = item.name;

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
