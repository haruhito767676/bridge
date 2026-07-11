const { app, BrowserWindow, ipcMain, net, screen, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

let win = null;
let rendererReady = false;
// Renderer の準備が整う前に URL スキーム経由で届いたファイルを溜めるキュー
const pendingFiles = [];

// ---- 右端への常駐 & スライド隠れ ----

const SHELTER_WIDTH = 320; // シェルターウインドウの幅（開いたとき）
const TAB_WIDTH = 15; // 隠れているときに画面端へ残す「つまみ」の幅
const SHELTER_HEIGHT = 600;

let expanded = false;
let collapseTimer = null;

// 指定ディスプレイの右端中央を基準にドック位置を計算する
function dockedBoundsForDisplay(display, shown) {
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  const height = Math.min(SHELTER_HEIGHT, dh);
  const y = Math.round(dy + (dh - height) / 2);
  const rightEdge = dx + dw;
  const x = Math.round(shown ? rightEdge - SHELTER_WIDTH : rightEdge - TAB_WIDTH);

  return { x, y, width: shown ? SHELTER_WIDTH : TAB_WIDTH, height };
}

// 現在マウスがあるディスプレイを特定する
function currentDisplay() {
  const cursor = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(cursor);
}

function applyDock(shown, display) {
  if (!win) return;
  // 第2引数 true で macOS ネイティブのスライドアニメーションがかかる
  win.setBounds(dockedBoundsForDisplay(display, shown), true);
}

function expandShelter() {
  if (!win) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  if (expanded) return;
  expanded = true;

  // マウスカーソルの座標から「今いるディスプレイ」を再取得する。
  // 起動時に表示されていたディスプレイと異なる場合は、まずアニメーションなしで
  // そのディスプレイの右端（隠れ位置）へ即座にワープしてから展開する。
  const display = currentDisplay();
  const winDisplay = screen.getDisplayMatching(win.getBounds());
  if (display.id !== winDisplay.id) {
    win.setBounds(dockedBoundsForDisplay(display, false), false);
  }
  applyDock(true, display);
}

function collapseShelter() {
  if (!win) return;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    if (!expanded) return;
    expanded = false;
    applyDock(false, currentDisplay());
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
  // 起動時は「つまみ」だけ見えている隠れ状態から始める。初期位置はメインディスプレイの右端中央に厳密固定する
  const bounds = dockedBoundsForDisplay(screen.getPrimaryDisplay(), false);

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
    // Mac 純正の信号機ボタン（赤・黄・緑）を含むタイトルバーを完全に消し、フレームレスにする
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 別の操作スペース（仮想デスクトップ）やフルスクリーンアプリに切り替えても常に最前面に追従させる
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

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

// ---- クリップボード履歴（バックグラウンド監視）----

const CLIPBOARD_POLL_MS = 500;
// 直近の履歴のみ保持する上限。超えた分は古いものから捨て、裏で作った一時ファイルも掃除する
const MAX_CLIP_HISTORY = 20;
let lastClipText = '';
let lastClipImageKey = '';
let lastClipFileKey = ''; // Finder でコピーされたファイル群の同一判定キー (パスを \n 連結)
let clipboardPolling = false;

// Main 側で保持する履歴 (最新順)。テキストは「生データ + 裏で生成した .txt パス」の二刀流で持つ
// { type: 'clipboard-text' | 'clipboard-image', text, path, timestamp }
const clipHistory = [];

function pushClipHistory(entry) {
  clipHistory.unshift(entry);
  while (clipHistory.length > MAX_CLIP_HISTORY) {
    const old = clipHistory.pop();
    // 上限あふれで履歴から消えたアイテムの一時ファイルは残しても使い道がないので削除
    if (old.path) fsp.unlink(old.path).catch(() => {});
  }
}

// 画像の同一判定キー (サイズ + ピクセルの MD5)。Bridge 自身の書き戻し検知スルーにも使う
function imageKey(image) {
  const { width, height } = image.getSize();
  return `${width}x${height}:${crypto.createHash('md5').update(image.toBitmap()).digest('hex')}`;
}

// コピーされた画像は即ファイル化しておく (サムネイル表示とドラッグアウトを既存フローに乗せるため)
async function saveClipboardImage(image) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, `clipboard_${Date.now()}.png`);
  await fsp.writeFile(dest, image.toPNG());
  return dest;
}

function sendClipboardItem(item) {
  if (win !== null && rendererReady) win.webContents.send('clipboard-item', item);
}

// Finder のファイルコピーで検知したパスを、ウインドウを奪わずに通常ドロップと同じ扱いでリストへ追加する
function addFileQuietly(filePath) {
  if (win !== null && rendererReady) {
    win.webContents.send('add-file', filePath);
  } else {
    pendingFiles.push(filePath);
  }
}

// Finder で「ファイル自体」がコピーされているか調べ、絶対パスの配列を返す (macOS)
function readCopiedFilePaths() {
  const paths = [];

  // 複数ファイル対応: NSFilenamesPboardType は XML plist で全ファイルのパスを持つ
  try {
    const buf = clipboard.readBuffer('NSFilenamesPboardType');
    if (buf && buf.length > 0) {
      const xml = buf.toString('utf8');
      for (const m of xml.matchAll(/<string>([^<]+)<\/string>/g)) {
        const p = m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
        if (p.startsWith('/')) paths.push(p);
      }
    }
  } catch {
    // フォーマットが無い環境では読み出し自体が失敗するので無視
  }

  // 単一ファイルのフォールバック: public.file-url は file:// URL が入る
  if (paths.length === 0) {
    try {
      const fileUrl = clipboard.read('public.file-url');
      if (fileUrl && fileUrl.startsWith('file://')) {
        paths.push(fileURLToPath(fileUrl.trim()));
      }
    } catch {
      // 同上
    }
  }

  return paths;
}

async function pollClipboard() {
  if (clipboardPolling) return; // 画像保存中に次のポーリングが重ならないようにする
  clipboardPolling = true;
  try {
    // ファイル: Finder で ⌘C されたファイルを最優先で検知し、リストへ自動追加する。
    // ファイルコピー時はパス文字列などの付随テキストも載るため、その tick の
    // テキスト/画像判定はスキップして誤検知 (偽のテキスト履歴) を防ぐ
    const copiedFiles = readCopiedFilePaths();
    if (copiedFiles.length > 0) {
      const key = copiedFiles.join('\n');
      if (key !== lastClipFileKey) {
        lastClipFileKey = key;
        lastClipText = clipboard.readText(); // 付随テキストを履歴に入れない
        for (const p of copiedFiles) {
          if (fs.existsSync(p)) addFileQuietly(p);
        }
      }
      return;
    }
    lastClipFileKey = '';

    // テキスト: 前回と異なる非空テキストなら履歴へ。
    // 生テキスト (クリックで即ペースト用) を保持しつつ、裏で snippet_[タイムスタンプ].txt も
    // 同時生成してドラッグアウト用のファイルパスを持たせる (データの二刀流)
    const text = clipboard.readText();
    if (text !== lastClipText) {
      lastClipText = text;
      if (text && text.trim()) {
        let snippetPath = null;
        try {
          snippetPath = await saveSnippetAsFile(text);
        } catch (err) {
          console.error('スニペットファイルの生成に失敗 (生テキストのみで履歴に残す):', err);
        }
        const entry = { type: 'clipboard-text', text, path: snippetPath, timestamp: Date.now() };
        pushClipHistory(entry);
        sendClipboardItem(entry);
      }
    }

    // 画像: 形式チェックを先に行い、画像が無いときの readImage デコードを避ける
    const hasImage = clipboard.availableFormats().some((f) => f.startsWith('image/'));
    if (hasImage) {
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const key = imageKey(image);
        if (key !== lastClipImageKey) {
          lastClipImageKey = key;
          const savedPath = await saveClipboardImage(image);
          const entry = { type: 'clipboard-image', text: null, path: savedPath, timestamp: Date.now() };
          pushClipHistory(entry);
          sendClipboardItem(entry);
        }
      }
    } else {
      lastClipImageKey = '';
    }
  } catch (err) {
    console.error('クリップボード監視に失敗:', err);
  } finally {
    clipboardPolling = false;
  }
}

function startClipboardWatcher() {
  // 起動時点でクリップボードに入っている内容は履歴に入れない (基準値として記録するだけ)
  lastClipText = clipboard.readText();
  const image = clipboard.readImage();
  lastClipImageKey = image.isEmpty() ? '' : imageKey(image);
  lastClipFileKey = readCopiedFilePaths().join('\n');
  setInterval(pollClipboard, CLIPBOARD_POLL_MS);
}

// ---- クリップボード履歴の再利用 (クリックでコピー & 自動格納) ----

// クリック直後は待たずにウインドウを隠し、ユーザーがすぐ ⌘V でペーストできる状態にする
function collapseShelterNow() {
  if (!win) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  expanded = false;
  applyDock(false, currentDisplay());
}

ipcMain.on('clipboard-write-text', (_event, text) => {
  clipboard.writeText(text); // 生のテキストデータを OS に書き戻す → 即ペースト可能
  lastClipText = text; // 自分で書き戻した分は監視でスルーする
  lastClipFileKey = '';
  collapseShelterNow(); // コピー完了 → 即座にウインドウを閉じてペーストへ移れるようにする
});

// ファイルアイテムのクリック: パスを OS の「ファイル形式」(public.file-url) でクリップボードへ。
// Finder で ⌘V すると本物のファイルとして複製・ペーストされる
ipcMain.on('clipboard-write-file', (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return;
  clipboard.writeBuffer('public.file-url', Buffer.from(pathToFileURL(filePath).toString(), 'utf8'));
  // 自分で書き戻した分は監視でスルーする (基準値を書き戻し後の状態に合わせる)
  lastClipFileKey = filePath;
  lastClipText = clipboard.readText();
  lastClipImageKey = '';
  collapseShelterNow();
});

ipcMain.on('clipboard-write-image', (_event, filePath) => {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return;
  clipboard.writeImage(image);
  // 書き戻し後のクリップボードを読み直して基準値にする (エンコード差分による再検知を防ぐ)
  const readBack = clipboard.readImage();
  lastClipImageKey = readBack.isEmpty() ? '' : imageKey(readBack);
  lastClipText = clipboard.readText();
  lastClipFileKey = '';
  collapseShelterNow();
});

// テキスト履歴のドラッグアウト: 検知時に裏で生成済みの snippet_*.txt をそのまま OS ネイティブドラッグに乗せる。
// (生成に失敗していた等でパスが無い場合のみ、その場で .txt に書き出すフォールバック)
ipcMain.on('drag-clipboard-text', async (event, payload) => {
  try {
    let dest = payload && payload.path;
    if (!dest || !fs.existsSync(dest)) {
      const text = payload && payload.text;
      if (!text) return;
      dest = await saveSnippetAsFile(text);
    }
    const icon = await app.getFileIcon(dest);
    event.sender.startDrag({ files: [dest], icon });
  } catch (err) {
    console.error('クリップボードテキストのドラッグアウトに失敗:', err);
  }
});

app.whenReady().then(() => {
  createWindow();
  startClipboardWatcher();

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
