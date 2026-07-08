const { app, BrowserWindow, ipcMain, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

let win = null;
let rendererReady = false;
// Renderer の準備が整う前に URL スキーム経由で届いたファイルを溜めるキュー
const pendingFiles = [];

// ---- 右端への常駐 & スライド隠れ ----

const SHELTER_WIDTH = 130; // シェルターウインドウの幅（開いたとき）
const TAB_WIDTH = 10; // 隠れているときに画面端へ残す「つまみ」の幅
const SHELTER_HEIGHT = 400;

let expanded = false;
let collapseTimer = null;

// 現在マウスがあるディスプレイの右端中央を基準にドック位置を計算する
function dockedBounds(shown) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  const height = Math.min(SHELTER_HEIGHT, dh);
  const y = Math.round(dy + (dh - height) / 2);
  const rightEdge = dx + dw;
  const x = Math.round(shown ? rightEdge - SHELTER_WIDTH : rightEdge - TAB_WIDTH);

  return { x, y, width: SHELTER_WIDTH, height };
}

function applyDock(shown) {
  if (!win) return;
  // 第2引数 true で macOS ネイティブのスライドアニメーションがかかる
  win.setBounds(dockedBounds(shown), true);
}

function expandShelter() {
  if (!win) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  if (expanded) return;
  expanded = true;
  applyDock(true);
}

function collapseShelter() {
  if (!win) return;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    if (!expanded) return;
    expanded = false;
    applyDock(false);
  }, 220);
}

// ---- 多重起動防止 ----
// Windows/Linux では bridge:// が第2インスタンスの argv に届くため必須。
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ---- 3. カスタム URL スキーム bridge:// の登録 ----
// Mac のクイックアクション等から bridge://add?path=... / bridge://add?text=... で起動できる。
if (process.defaultApp && process.argv.length >= 2) {
  // 開発時 (`electron .`) は Electron 本体に起動引数を添えて登録する
  app.setAsDefaultProtocolClient('bridge', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('bridge');
}

function createWindow() {
  const bounds = dockedBounds(false); // 起動時は「つまみ」だけ見えている隠れ状態から始める

  win = new BrowserWindow({
    ...bounds,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    title: 'Bridge',
    // Apple ライクなすりガラス背景 (macOS の vibrancy)
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');

  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    // 起動前に URL スキームで届いていた分をまとめて流し込む
    while (pendingFiles.length > 0) {
      win.webContents.send('add-file', pendingFiles.shift());
    }
  });

  win.on('closed', () => {
    win = null;
    rendererReady = false;
    expanded = false;
    if (collapseTimer) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }
  });
}

// ---- 1. Web 画像の自動ダウンロード ----

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
};

function downloadDir() {
  return path.join(app.getPath('userData'), 'downloads');
}

// 同名ファイルがあれば "name-1.ext" のように連番を振る
function reserveDest(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let dest = path.join(dir, name);
  for (let i = 1; fs.existsSync(dest); i++) {
    dest = path.join(dir, `${base}-${i}${ext}`);
  }
  return dest;
}

// http/https の URL を userData/downloads/ にダウンロードしてローカルパスを返す
async function downloadToLocal(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('http/https の URL のみダウンロードできます');
  }

  const res = await net.fetch(url);
  if (!res.ok) {
    throw new Error(`ダウンロード失敗: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // ファイル名は URL のパス末尾から決め、使えない文字は除去する
  let name = '';
  try {
    name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
  } catch {
    // URL として解釈できない部分は無視してフォールバック名を使う
  }
  name = name.replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!name) name = `download-${Date.now()}`;

  // 拡張子がなければ Content-Type から補完する (例: image/jpeg → .jpg)
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!path.extname(name) && EXT_BY_MIME[mime]) name += EXT_BY_MIME[mime];

  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, name);
  await fsp.writeFile(dest, buf);

  return { path: dest, name: path.basename(dest) };
}

ipcMain.handle('download-url', (_event, url) => downloadToLocal(url));

// ---- 3. bridge:// URL のパースとリストへの格納 ----

function sendFileToRenderer(filePath) {
  if (win !== null && rendererReady) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    expandShelter();
    win.webContents.send('add-file', filePath);
  } else {
    pendingFiles.push(filePath);
  }
}

// URL でないテキストは .txt として保存してから追加する
async function saveTextAsFile(text) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, `text-${Date.now()}.txt`);
  await fsp.writeFile(dest, text, 'utf8');
  return dest;
}

// Renderer でドラッグ選択されたテキストを snippet_[タイムスタンプ].txt として保存する
async function saveSnippetAsFile(text) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, `snippet_${Date.now()}.txt`);
  await fsp.writeFile(dest, text, 'utf8');
  return dest;
}

ipcMain.handle('save-text-snippet', (_event, text) => saveSnippetAsFile(text));

// bridge://add?path=/絶対パス または bridge://add?text=https://... / 任意テキスト
async function handleBridgeUrl(rawUrl) {
  await app.whenReady();

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== 'bridge:') return;

  // bridge://add?... はホスト名が "add" になる (bridge:/add 形式にも保険で対応)
  const action = parsed.hostname || parsed.pathname.replace(/^\/+/, '');
  if (action !== 'add') return;

  const filePath = parsed.searchParams.get('path');
  const text = parsed.searchParams.get('text');

  try {
    if (filePath) {
      sendFileToRenderer(filePath);
    } else if (text && /^https?:\/\//i.test(text.trim())) {
      const saved = await downloadToLocal(text.trim());
      sendFileToRenderer(saved.path);
    } else if (text) {
      sendFileToRenderer(await saveTextAsFile(text));
    }
  } catch (err) {
    console.error('bridge:// の処理に失敗:', rawUrl, err);
  }
}

// macOS: 起動中・起動時どちらも open-url で届く (ready 前に登録が必要)
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleBridgeUrl(url);
});

// Windows/Linux: 2つ目のインスタンスの argv に bridge:// が入って届く
app.on('second-instance', (_event, argv) => {
  if (win !== null) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  const url = argv.find((arg) => arg.startsWith('bridge://'));
  if (url) handleBridgeUrl(url);
});

// ---- ファイルを外へ引き出す（OS標準のネイティブドラッグアウト、複数選択対応）----
ipcMain.on('ondragstart', async (event, payload) => {
  const files = Array.isArray(payload) ? payload : payload && payload.files;
  if (!files || files.length === 0) return;
  try {
    const icon = await app.getFileIcon(files[0]);
    event.sender.startDrag({
      files,
      icon,
    });
  } catch (err) {
    console.error('drag-out failed:', files, err);
  }
});

// ---- シェルターウインドウの開閉（つまみホバー / ドラッグ進入 / マウスアウト）----
ipcMain.on('shelter-expand', () => expandShelter());
ipcMain.on('shelter-collapse', () => collapseShelter());

// ---- リスト表示用のファイルアイコン (Finder と同じ OS 標準アイコン) ----
ipcMain.handle('get-file-icon', async (_event, filePath) => {
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    return icon.toDataURL();
  } catch {
    return null;
  }
});

// ---- スペースキーで Mac 純正クイックルック ----
ipcMain.on('preview-file', (event, filePath, fileName) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender) sender.previewFile(filePath, fileName);
});

app.whenReady().then(() => {
  createWindow();

  // Windows/Linux で bridge:// から直接起動された場合は argv に URL が入っている
  const initialUrl = process.argv.find((arg) => arg.startsWith('bridge://'));
  if (initialUrl) handleBridgeUrl(initialUrl);
});

app.on('activate', () => {
  if (win === null) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
