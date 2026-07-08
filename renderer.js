// Bridge — シェルフの Renderer プロセス側ロジック

const dropZone = document.getElementById('drop-zone');
const fileList = document.getElementById('file-list');
const clearButton = document.getElementById('clear-button');

/** シェルフに置かれたファイル (絶対パスの配列、重複なし) */
const items = new Map(); // path -> <li> element

let dragDepth = 0; // dragenter/dragleave は子要素間でも発火するため深さで管理

// ---- 展開 / 収納 ----

function requestExpand() {
  window.bridge.expand();
}

function requestCollapseIfIdle() {
  // アイテムを保持している間は Yoink と同様に出しっぱなしにする
  if (items.size === 0 && dragDepth === 0) {
    window.bridge.collapse();
  }
}

window.bridge.onShelfState((expanded) => {
  document.body.classList.toggle('collapsed', !expanded);
});

window.bridge.onBlurred(requestCollapseIfIdle);

// 初期状態は収納
document.body.classList.add('collapsed');

// つまみ (=ウィンドウの見えている端) にマウスが乗ったら展開
document.body.addEventListener('mouseenter', requestExpand);
document.body.addEventListener('mouseleave', () => {
  // ドロップ操作の途中 (ファイルドラッグ中) は閉じない
  requestCollapseIfIdle();
});

// ---- ドラッグ & ドロップ ----

document.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dragDepth += 1;
  requestExpand();
  dropZone.classList.add('dragover');
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

document.addEventListener('dragleave', (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropZone.classList.remove('dragover');
    requestCollapseIfIdle();
  }
});

document.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('dragover');

  for (const file of event.dataTransfer.files) {
    const filePath = window.bridge.getPathForFile(file);
    if (filePath && !items.has(filePath)) {
      await addItem(filePath, file.name);
    }
  }
  updateHasItems();
});

// ---- シェルフアイテム ----

async function addItem(filePath, fileName) {
  const li = document.createElement('li');
  li.className = 'file-item';
  li.draggable = true;

  const icon = document.createElement('img');
  icon.className = 'file-icon';
  icon.draggable = false;
  const iconDataUrl = await window.bridge.getFileIcon(filePath);
  if (iconDataUrl) icon.src = iconDataUrl;

  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = fileName;
  name.title = filePath;

  const remove = document.createElement('button');
  remove.className = 'remove-button';
  remove.textContent = '✕';
  remove.addEventListener('click', () => {
    items.delete(filePath);
    li.remove();
    updateHasItems();
  });

  // HTML5 のドラッグを止めて、main プロセス経由のネイティブドラッグに切り替える
  li.addEventListener('dragstart', (event) => {
    event.preventDefault();
    window.bridge.startDrag(filePath);
  });

  li.append(icon, name, remove);
  fileList.appendChild(li);
  items.set(filePath, li);
}

function updateHasItems() {
  document.body.classList.toggle('has-items', items.size > 0);
}

clearButton.addEventListener('click', () => {
  items.clear();
  fileList.replaceChildren();
  updateHasItems();
  requestCollapseIfIdle();
});
