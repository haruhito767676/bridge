const { app, BrowserWindow, ipcMain, net, screen, clipboard, nativeImage, Tray, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const controlWindows = require('./control-windows');
const controlNet = require('./control-net');
const controlInput = require('./control-input');

let win = null;
let rendererReady = false;
// Renderer の準備が整う前に URL スキーム経由で届いたファイルを溜めるキュー
const pendingFiles = [];

// win が生きているか (destroy 直後〜 'closed' 発火までの隙間も含めて安全に判定する)
function winAlive() {
  return win !== null && !win.isDestroyed();
}

// Renderer へ IPC を送ってよい状態か (ウインドウ破棄・Renderer クラッシュ中は送らない)
function canSendToRenderer() {
  return winAlive() && rendererReady && !win.webContents.isDestroyed();
}

// Renderer 準備前のキューの上限。ウインドウが無い状態が長引いても無制限には溜め込まない
const MAX_PENDING_ITEMS = 200;
function pushPending(queue, item) {
  queue.push(item);
  if (queue.length > MAX_PENDING_ITEMS) queue.shift(); // 最古から追い出す
}

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

// ウインドウを表示 (show/focus) する直前に、カーソルのあるディスプレイの
// workArea 基準で計算した右端座標へ setBounds で強制配置する。
// OS の自動配置に任せると復元時にモニターを跨ぐことがあるため、
// 表示前に必ずこの関数で座標を確定させること
function placeOnCursorDisplay(shown) {
  if (!winAlive()) return;
  win.setBounds(dockedBoundsForDisplay(currentDisplay(), shown), false);
}

function applyDock(shown, display) {
  if (!winAlive()) return;
  // 第2引数 true で macOS ネイティブのスライドアニメーションがかかる
  win.setBounds(dockedBoundsForDisplay(display, shown), true);
}

function expandShelter() {
  if (!winAlive()) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  // マウスカーソルの座標から「今いるディスプレイ」を再取得する。
  // ウインドウが別のディスプレイに居る場合は、まずアニメーションなしで
  // カーソルのあるディスプレイの右端（隠れ位置）へ即座にワープしてから展開する。
  // 既に展開済みでも、カーソルが別ディスプレイの右端に来たときは開き直す
  const display = currentDisplay();
  const winDisplay = screen.getDisplayMatching(win.getBounds());
  const sameDisplay = display.id === winDisplay.id;
  if (expanded && sameDisplay) return;
  expanded = true;
  lastExpandedAt = Date.now();

  if (!sameDisplay) {
    win.setBounds(dockedBoundsForDisplay(display, false), false);
  }
  applyDock(true, display);

  // screen-saver レベルだと OS 側のドラッグ中アイコン/カーソル描画より Bridge が
  // 手前に出てしまうため、通常の floating レベルに留めて OS 描画を Bridge より前面に保つ
  win.setAlwaysOnTop(true, 'floating');
  win.moveTop();

  // 展開のたびに Renderer へ通知し、検索状態の完全リセットと検索バーへの自動フォーカスを行わせる
  if (canSendToRenderer()) win.webContents.send('shelter-expanded');
}

// 格納時に最前面レベルを通常の floating へ戻す (念のための明示的リセット)
function resetAlwaysOnTopLevel() {
  if (winAlive()) win.setAlwaysOnTop(true, 'floating');
}

function collapseShelter() {
  if (!winAlive()) return;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    if (!expanded) return;
    expanded = false;
    applyDock(false, currentDisplay());
    resetAlwaysOnTopLevel();
  }, 220);
}

// ---- どのモニターでも右端ホバーで出現させるグローバル監視 ----
// つまみ (BrowserWindow) は常に 1 枚しか存在せず、renderer の mouseenter は
// ウインドウが居るディスプレイでしか発火しない。そのため Main 側でカーソル座標を
// ポーリングし、「任意のディスプレイの右端つまみ相当ゾーン」への進入を検知して
// そのディスプレイへワープ & 展開する

const EDGE_POLL_MS = 100;
let cursorWasInTabZone = false;

// ---- 展開中の「カーソル離脱」強制格納 (Windows のマウス高速移動対策) ----
// renderer の mouseleave はマウスの高速移動時に発火しないことがあり (特に Windows)、
// ウインドウが引っ込まずに残り続ける。Main 側の同じポーリングでカーソルが
// ウインドウ領域 (+判定マージン) から完全に外れたことを検知し、collapseShelterNow() で回収する

// ウインドウ領域の「内側」判定に足す許容マージン (px)。エッジゾーンぶんの遊びを兼ねる
const EXPANDED_EXIT_MARGIN = 48;
// 展開直後の猶予 (ms)。bridge:// 受信などカーソルがウインドウの外にある状態での
// プログラム的な展開を、ユーザーが気づく前に閉じてしまわないためのガード
const EXPAND_GRACE_MS = 1000;
let lastExpandedAt = 0;

// カーソルが展開中ウインドウの領域 (+マージン) から完全に外れているか
function cursorOutsideExpandedWindow(cursor) {
  const b = win.getBounds();
  return (
    cursor.x < b.x - EXPANDED_EXIT_MARGIN ||
    cursor.x > b.x + b.width + EXPANDED_EXIT_MARGIN ||
    cursor.y < b.y - EXPANDED_EXIT_MARGIN ||
    cursor.y > b.y + b.height + EXPANDED_EXIT_MARGIN
  );
}

// カーソルが指定ディスプレイの「つまみ相当ゾーン」(右端 TAB_WIDTH 幅 × つまみの縦帯) に居るか
function cursorInTabZone(cursor, display) {
  const tab = dockedBoundsForDisplay(display, false);
  return cursor.x >= tab.x && cursor.y >= tab.y && cursor.y <= tab.y + tab.height;
}

function pollCursorForEdgeReveal() {
  if (!winAlive()) return;
  const cursor = screen.getCursorScreenPoint();
  const inZone = cursorInTabZone(cursor, screen.getDisplayNearestPoint(cursor));
  // 「ゾーン外 → ゾーン内」の進入エッジでのみ展開する。居続けで再展開しないため、
  // クリップボード再利用直後の即時収納 (collapseShelterNow) と喧嘩しない
  if (inZone && !cursorWasInTabZone) expandShelter();
  cursorWasInTabZone = inZone;

  // 展開中にカーソルがウインドウ領域から完全に外れたら強制格納する。
  // mouseleave の取りこぼし (マウスの高速移動) をここで完全に回収する
  if (
    expanded &&
    !inZone &&
    Date.now() - lastExpandedAt > EXPAND_GRACE_MS &&
    cursorOutsideExpandedWindow(cursor)
  ) {
    collapseShelterNow();
  }
}

function startEdgeRevealWatcher() {
  // 起動時点で既にゾーン内に居た場合は「進入済み」として扱い、勝手に開かないようにする
  const cursor = screen.getCursorScreenPoint();
  cursorWasInTabZone = cursorInTabZone(cursor, screen.getDisplayNearestPoint(cursor));
  setInterval(pollCursorForEdgeReveal, EDGE_POLL_MS);
}

// ---- 多重起動防止 ----
// Windows/Linux では bridge:// が第2インスタンスの argv に届くため必須。
// app.quit() は非同期のため、ロックが取れなかった場合はフラグで起動処理全体を止め、
// 第2インスタンスがウインドウ生成・各種ウォッチャー・同期サーバー (ポート 9095) を
// 一瞬でも動かさないようにする
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
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

// ---- メニューバー (StatusItem) アイコン ----
// アセットは assets/tray/ 配下に事前生成済みの Template Image
// (iconTemplate.png = 16x16 @1x, iconTemplate@2x.png = 32x32 @2x) を置いている。
// ・線画のみを黒 + アルファで抽出済み (背景は完全透明) なので isTemplate 指定だけで
//   ライト/ダーク/ハイライト時の配色を OS 側の自動着色に委ねられる
// ・ファイル名を “Template” サフィックスにし、かつ setTemplateImage(true) も明示することで
//   macOS の自動判定に依存し過ぎず確実にテンプレート扱いさせる
let tray = null;

// Apple HIG 上のメニューバーアイコン許容サイズ (16px 〜 22px)。
// アセットが将来差し替わっても、ここで強制的にクランプしてから nativeImage に渡すことで
// 「巨大化して隣のアイコンを圧迫する」「潰れて縦横比が崩れる」事故を防ぐ安全弁とする。
const TRAY_ICON_MIN_SIZE = 16;
const TRAY_ICON_MAX_SIZE = 22;

// 縦横比を維持したまま [MIN, MAX] の正方形内に収まるようクランプする
function clampTrayImage(image) {
  if (image.isEmpty()) return image;
  const { width, height } = image.getSize();
  const longSide = Math.max(width, height);
  if (longSide >= TRAY_ICON_MIN_SIZE && longSide <= TRAY_ICON_MAX_SIZE) return image;

  const target = longSide < TRAY_ICON_MIN_SIZE ? TRAY_ICON_MIN_SIZE : TRAY_ICON_MAX_SIZE;
  const scale = target / longSide;
  return image.resize({
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    quality: 'best',
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray', 'iconTemplate.png');
  let image = nativeImage.createFromPath(iconPath);
  image = clampTrayImage(image);
  if (process.platform === 'darwin') image.setTemplateImage(true);

  tray = new Tray(image);
  tray.setToolTip('Bridge');
  tray.on('click', () => {
    if (!winAlive()) return;
    if (expanded) {
      collapseShelterNow();
    } else {
      win.setBounds(dockedBoundsForDisplay(currentDisplay(), false), false);
      expandShelter();
    }
  });
}

function createWindow() {
  // 起動時は「つまみ」だけ見えている隠れ状態から始める。
  // 初期位置は「現在マウスカーソルがあるディスプレイ」の右端中央に厳密固定する
  // (プライマリ固定にすると、別モニターで作業中の起動時に意図しない画面へ出るため)
  const bounds = dockedBoundsForDisplay(currentDisplay(), false);

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
    // Renderer の準備前に他拠点から同期されてきたクリップボード履歴も流し込む
    while (pendingClipItems.length > 0) {
      win.webContents.send('clipboard-item', pendingClipItems.shift());
    }
  });

  // Renderer プロセスがクラッシュ・強制終了された場合は自動リロードで復帰させる。
  // rendererReady を先に落とし、復帰完了 (did-finish-load) までの IPC はキューへ退避させる。
  // これを怠るとクラッシュ後の webContents.send が例外を吐き続け、常駐アプリが死んだままになる
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    if (details.reason === 'clean-exit') return;
    console.error('Renderer プロセスが停止 (自動リロードで復帰):', details.reason);
    if (winAlive()) win.webContents.reload();
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

// ---- セッション一時ファイルの追跡 (自動クリーンアップの対象管理) ----

// このセッションで裏生成した一時ファイル (clipboard_*.png / snippet_*.txt) の絶対パス。
// 終了時にリストへ残っていない「残骸」だけを削除する判定に使う
const sessionTempFiles = new Set();

// Renderer が現在リストに保持しているパス一覧 (render のたびに報告が届く)。
// ここに含まれるファイルはユーザーがまだ使う可能性があるため終了時も消さない
let retainedPaths = new Set();

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

// add-file の送信ペイロード。origin が無ければ自分のデバイスで生まれたファイル (fromDevice: null)、
// あれば他拠点から同期されてきたファイルとして出身デバイス名とプラットフォームを添える
function addFilePayload(filePath, origin) {
  return {
    path: filePath,
    name: path.basename(filePath),
    fromDevice: origin ? origin.fromDevice : null,
    fromPlatform: origin ? origin.fromPlatform : null,
  };
}

function sendFileToRenderer(filePath, origin) {
  const payload = addFilePayload(filePath, origin);
  if (canSendToRenderer()) {
    if (win.isMinimized()) win.restore();
    // show の前にカーソルのあるモニターへ強制配置し、OS の自動復元でモニターを跨ぐのを防ぐ
    placeOnCursorDisplay(expanded);
    win.show();
    win.focus();
    expandShelter();
    win.webContents.send('add-file', payload);
  } else {
    pushPending(pendingFiles, payload);
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
  sessionTempFiles.add(dest); // 終了時の残骸掃除の対象として追跡
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
  handleBridgeUrl(url).catch((err) => console.error('bridge:// の処理に失敗:', url, err));
});

// Windows/Linux: 2つ目のインスタンスの argv に bridge:// が入って届く
app.on('second-instance', (_event, argv) => {
  if (winAlive()) {
    if (win.isMinimized()) win.restore();
    // show の前にカーソルのあるモニターへ強制配置し、OS の自動復元でモニターを跨ぐのを防ぐ
    placeOnCursorDisplay(expanded);
    win.show();
    win.focus();
  }
  const url = argv.find((arg) => arg.startsWith('bridge://'));
  if (url) handleBridgeUrl(url).catch((err) => console.error('bridge:// の処理に失敗:', url, err));
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

// ---- Finder 純正の「種類」ラベル (kMDItemKind) ----

// mdls / 拡張子どちらからも種類名を決められないときの最終フォールバック
function extensionFallbackKind(filePath) {
  const ext = path.extname(filePath).replace(/^\./, '');
  return ext ? `${ext.toUpperCase()}ファイル` : 'ファイル';
}

// フォルダは即断、通常ファイルは macOS の mdls から Finder と同じ正式名称を取得する。
// mdls が使えない環境 (他OS・実行失敗) では拡張子から整形した名前にフォールバックする
async function getFileKindLabel(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return 'フォルダ';
  } catch {
    // stat に失敗した場合もフォールバックへ進む (mdls 側の失敗判定に委ねる)
  }

  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('mdls', ['-name', 'kMDItemKind', '-raw', filePath]);
      const kind = stdout.trim();
      if (kind && kind !== '(null)') return kind;
    } catch (err) {
      console.error('mdls の実行に失敗:', filePath, err);
    }
  }

  return extensionFallbackKind(filePath);
}

ipcMain.handle('get-file-kind', (_event, filePath) => getFileKindLabel(filePath));

// ---- スペースキーで Mac 純正クイックルック ----
ipcMain.on('preview-file', (event, filePath, fileName) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender) sender.previewFile(filePath, fileName);
});

// ---- クリップボード履歴（バックグラウンド監視）----

const CLIPBOARD_POLL_MS = 500;
// ハイブリッド上限: テキスト履歴は資産として多めに残し、
// 裏生成 PNG を伴う画像履歴はディスク保護のため少なめに抑える
const MAX_TEXT_HISTORY = 100;
const MAX_IMAGE_HISTORY = 30;
let lastClipText = '';
let lastClipImageKey = '';
let lastClipFileKey = ''; // Finder でコピーされたファイル群の同一判定キー (パスを \n 連結)
let clipboardPolling = false;

// Main 側で保持する履歴 (最新順)。テキストは「生データ + 裏で生成した .txt パス」の二刀流で持つ
// { type: 'clipboard-text' | 'clipboard-image', text, path, timestamp }
const clipHistory = [];

function pushClipHistory(entry) {
  clipHistory.unshift(entry);
  // 上限あふれ時のディスク削除は、表示リストの真実を持つ Renderer 側のトリミング
  // (delete-temp-file IPC → fs.unlinkSync) が担う。Main 単独で消すと、ユーザーが
  // × で別の履歴を消したときに両者の並びがズレて「まだ表示中のファイル」を誤削除
  // しうるため、ここでは種別ごとの配列の長さだけを抑える
  // (消し損ねは終了時クリーンアップが回収する)
  let textCount = 0;
  let imageCount = 0;
  for (let i = 0; i < clipHistory.length; ) {
    const isImage = clipHistory[i].type === 'clipboard-image';
    const over = isImage ? ++imageCount > MAX_IMAGE_HISTORY : ++textCount > MAX_TEXT_HISTORY;
    if (over) clipHistory.splice(i, 1);
    else i++;
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
  sessionTempFiles.add(dest); // 終了時の残骸掃除の対象として追跡
  return dest;
}

// Renderer の準備前に届いた同期クリップボード履歴を溜めるキュー (pendingFiles と同じ役割)
const pendingClipItems = [];

function sendClipboardItem(item) {
  if (canSendToRenderer()) win.webContents.send('clipboard-item', item);
  else pushPending(pendingClipItems, item);
}

// Finder のファイルコピーで検知したパスや他拠点から同期されたファイルを、
// ウインドウを奪わずに通常ドロップと同じ扱いでリストへ追加する
function addFileQuietly(filePath, origin) {
  const payload = addFilePayload(filePath, origin);
  if (canSendToRenderer()) {
    win.webContents.send('add-file', payload);
  } else {
    pushPending(pendingFiles, payload);
  }
}

// Finder で「ファイル自体」がコピーされているか調べ、絶対パスの配列を返す (macOS)
function readCopiedFilePathsMac() {
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

// テキストの中から "C:\..." 形式の Windows 絶対パスを探す (エクスプローラーが
// CF_HDROP のみを載せて file:// 表現を持たない場合の最終フォールバック用)
function extractWindowsAbsolutePaths(text) {
  const paths = [];
  if (!text) return paths;
  for (const m of text.matchAll(/[A-Za-z]:\\[^\r\n"<>|?*]+/g)) {
    const p = m[0].trim().replace(/[.,;:]+$/, '');
    if (p) paths.push(p);
  }
  return paths;
}

// Windows のエクスプローラーで「ファイル自体」がコピーされているか調べ、絶対パスの配列を返す。
// 実機検証の結果、エクスプローラーの Ctrl+C は availableFormats() に text/uri-list を含めるものの
// read/readBuffer で読むと空文字になり (Electron/Chromium 側の Windows 実装の制約)、
// Chromium Web Custom MIME Data・readText・readHTML もすべて空になることを確認した。
// 実体のパスはレガシーな CF_FILENAMEW registered format ("FileNameW") にしか乗らないため、
// これを最優先で読む。ただし CF_FILENAMEW は仕様上 1 ファイル分しか保持できず、Electron から
// CF_HDROP (複数ファイルの本来のフォーマット) を読む手段が無いため、複数選択時も先頭の 1 件だけが
// 取れる制約が残る (ベストエフォート)
function readCopiedFilePathsWindows() {
  let paths = [];

  try {
    const buf = clipboard.readBuffer('FileNameW');
    if (buf && buf.length > 0) {
      const p = buf.toString('utf16le').replace(/\u0000+$/, '').trim();
      if (p) paths.push(p);
    }
  } catch {
    // フォーマットが無い環境では読み出し自体が失敗するので無視
  }

  // 保険: 将来の Electron/Chromium の挙動変更や、text/uri-list・独自 MIME データに
  // file:// を載せてくる他アプリからのコピーにも対応できるようにしておく
  if (paths.length === 0) {
    try {
      const buf = clipboard.readBuffer('Chromium Web Custom MIME Data');
      if (buf && buf.length > 0) paths = extractFileUrlPaths(buf.toString('utf8'));
    } catch {
      // 同上
    }
  }

  if (paths.length === 0) {
    try {
      paths = extractFileUrlPaths(clipboard.read('text/uri-list'));
    } catch {
      // 同上
    }
  }

  if (paths.length === 0) {
    const plain = clipboard.readText();
    paths = extractFileUrlPaths(plain);
    if (paths.length === 0) paths = extractWindowsAbsolutePaths(plain);
  }

  // 誤検知したただの文字列を弾くため、実在するパスだけを残す
  return [...new Set(paths)].filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function readCopiedFilePaths() {
  return process.platform === 'win32' ? readCopiedFilePathsWindows() : readCopiedFilePathsMac();
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
        const entry = {
          type: 'clipboard-text',
          text,
          path: snippetPath,
          timestamp: Date.now(),
          fromDevice: deviceName,
          fromPlatform: process.platform,
        };
        pushClipHistory(entry);
        sendClipboardItem(entry);
        // 同期台帳へ登録し、オンラインの他拠点へ即時プッシュする
        registerLocalSyncEntry({ type: 'text', text, path: snippetPath, timestamp: entry.timestamp });
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
          const entry = {
            type: 'clipboard-image',
            text: null,
            path: savedPath,
            timestamp: Date.now(),
            fromDevice: deviceName,
            fromPlatform: process.platform,
          };
          pushClipHistory(entry);
          sendClipboardItem(entry);
          // 同期台帳へ登録し、オンラインの他拠点へ即時プッシュする (実体 PNG は /file で配信)
          registerLocalSyncEntry({
            type: 'image',
            name: path.basename(savedPath),
            path: savedPath,
            timestamp: entry.timestamp,
          });
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
  // 起動時点でクリップボードに入っている内容は履歴に入れない (基準値として記録するだけ)。
  // 初期読み取りが環境依存で失敗しても、監視の定期実行そのものは必ず開始する
  try {
    lastClipText = clipboard.readText();
    const image = clipboard.readImage();
    lastClipImageKey = image.isEmpty() ? '' : imageKey(image);
    lastClipFileKey = readCopiedFilePaths().join('\n');
  } catch (err) {
    console.error('クリップボードの初期読み取りに失敗:', err);
  }
  setInterval(pollClipboard, CLIPBOARD_POLL_MS);
}

// ---- クリップボード履歴の再利用 (クリックでコピー & 自動格納) ----

// クリック直後は待たずにウインドウを隠し、ユーザーがすぐ ⌘V でペーストできる状態にする
function collapseShelterNow() {
  if (!winAlive()) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  expanded = false;
  applyDock(false, currentDisplay());
  resetAlwaysOnTopLevel();
}

ipcMain.on('clipboard-write-text', (_event, text) => {
  clipboard.writeText(text); // 生のテキストデータを OS に書き戻す → 即ペースト可能
  lastClipText = text; // 自分で書き戻した分は監視でスルーする
  lastClipFileKey = '';
  collapseShelterNow(); // コピー完了 → 即座にウインドウを閉じてペーストへ移れるようにする
});

// Windows のクリップボードへ「本物のファイル」として書き込む (CF_HDROP)。
// Electron の clipboard.writeBuffer は RegisterClipboardFormat 経由の独自フォーマット専用で、
// CF_HDROP のような定義済み ID には効かないため直接は書けない。.NET の
// Clipboard.SetFileDropList が正しく CF_HDROP を組み立ててくれる PowerShell の
// Set-Clipboard -LiteralPath を経由することで、チャットアプリ等での Ctrl+V に
// 実ファイル添付として乗るようにする
function writeFilesToWindowsClipboard(paths) {
  const psLiteral = (s) => `'${s.replace(/'/g, "''")}'`;
  const script = `Set-Clipboard -LiteralPath @(${paths.map(psLiteral).join(',')})`;
  return execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

// ファイルアイテムのクリック: パスを OS の「ファイル形式」でクリップボードへ。
// mac: public.file-url / Windows: CF_HDROP。それぞれ ⌘V・Ctrl+V で本物のファイルとして複製・ペーストされる
ipcMain.on('clipboard-write-file', async (_event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return;
  if (process.platform === 'win32') {
    try {
      await writeFilesToWindowsClipboard([filePath]);
    } catch (err) {
      console.error('Windows クリップボードへのファイル書き込みに失敗:', err);
      return;
    }
  } else {
    clipboard.writeBuffer('public.file-url', Buffer.from(pathToFileURL(filePath).toString(), 'utf8'));
  }
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

// ---- 一時ファイルの自動クリーンアップ (ディスク保護) ----

// Renderer から届く「現在リストに保持しているパス一覧」を常に最新へ更新する
ipcMain.on('report-retained-paths', (_event, paths) => {
  retainedPaths = new Set(
    Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []
  );
});

// 履歴の上限あふれで Renderer のリストから消えた一時ファイルを完全削除する (自動お掃除)。
// このセッションで自分が裏生成・同期受信したファイル以外は絶対に消さない (ユーザーの実ファイル保護)
ipcMain.on('delete-temp-file', (_event, filePath) => {
  if (typeof filePath !== 'string' || !sessionTempFiles.has(filePath)) return;
  sessionTempFiles.delete(filePath);
  try {
    fs.unlinkSync(filePath); // 用済みの実体を即時に完全削除し、ストレージの圧迫を防ぐ
  } catch {
    // 既に無い場合などは無視 (掃除が目的なので失敗しても続行)
  }
  // 同期台帳からも実体への参照を外す。以後ピアには hasFile: false で通知され、
  // 消えたファイルを /file へ取りに来て 404 → 永久再試行になるのを防ぐ
  for (const entry of syncStore) {
    if (entry.path === filePath) entry.path = null;
  }
  registeredSyncPaths.delete(filePath);
});

// アプリ終了時: 今セッションで自動生成した clipboard_*.png / snippet_*.txt のうち、
// 現在もリストに保持されていない (= 明示的に残す意思のない) 残骸をまとめて削除する。
// will-quit 内は非同期処理を待たずにプロセスが落ちうるため同期 API で確実に消す
app.on('will-quit', () => {
  for (const p of sessionTempFiles) {
    if (retainedPaths.has(p)) continue;
    try {
      fs.unlinkSync(p);
    } catch {
      // 既に削除済み・アクセス不可などは無視 (掃除が目的なので失敗しても続行)
    }
  }
  sessionTempFiles.clear();
  globalShortcut.unregisterAll();
});

// ---- マルチデバイス全自動同期 (軽量 HTTP サーバー + ピア発見 + 差分同期) ----
//
// 各デバイスは OS のコンピュータ名 (os.hostname()) を deviceName とし、
// node:http の軽量サーバーをポート 9095 で常時起動する。
//   GET  /ping            … Bridge であることの自己紹介 (スキャンによるピア発見用)
//   GET  /items?since=T   … タイムスタンプ T より新しいアイテムのメタデータ一覧 (差分同期用)
//   GET  /file?id=…       … アイテムの実体ファイル (画像・ファイルのバックグラウンド転送用)
//   POST /push            … 新着アイテムのメタデータを受け取る (発生した瞬間の即時通知)
//
// ピアは userData/sync-config.json の静的リスト + 同一 /24 セグメントの簡易スキャンで発見し、
// 新着は即時プッシュ、取りこぼしは定期ポーリングのタイムスタンプ比較で回収する。
// 外出先から帰宅した場合など、ピアが再び到達可能になった時点で lastSyncedTs 以降の
// 差分だけが自動でローカルの Bridge へ取り込まれる。

let deviceName = os.hostname();

// HUD に表示するデバイスアイコンの許容バリエーション (未設定・未知の値はフォールバック枠を表示させる)
const ALLOWED_ICON_TYPES = ['win_laptop', 'macbook', 'win_desktop'];
let myIconType = null;

const DEFAULT_SYNC_PORT = 9095;
const SYNC_POLL_MS = 20 * 1000; // 既知ピアへの差分ポーリング間隔 (再接続の自動検知を兼ねる)
const SUBNET_SCAN_MS = 5 * 60 * 1000; // 同一セグメントの再スキャン間隔 (Wi-Fi 切り替え等に追従)
const PROBE_TIMEOUT_MS = 800;
const SYNC_BODY_LIMIT = 10 * 1024 * 1024;
const MAX_SYNC_STORE = 500;

// 同期通信の認証トークンを載せる HTTP ヘッダー名 (サーバー・クライアント共通)
const SYNC_TOKEN_HEADER = 'x-bridge-token';

let syncConfig = { port: DEFAULT_SYNC_PORT, peers: [], autoScan: true, secretToken: null };

// 同期台帳: 自分が生成したアイテムと他拠点から受信したアイテムの両方を持ち、
// 3 台以上のメッシュ構成でも任意の 2 台が到達可能でさえあれば全体が収束するよう中継役も担う。
// { id, type: 'text' | 'image' | 'file', name, text, path, timestamp, fromDevice, fromPlatform }
const syncStore = [];
const seenSyncIds = new Set(); // id による重複同期・循環中継の防止
const registeredSyncPaths = new Set(); // 同じローカルファイルの二重登録防止

// seenSyncIds は常駐運用でコピーのたびに増え続けるため、古い id から追い出して上限を保つ (FIFO)。
// 追い出された古いアイテムはピア側の syncStore からも溢れており (MAX_SYNC_STORE)、
// 差分ポーリングも lastSyncedTs 比較で防いでいるため、再取り込みの実害はない
const MAX_SEEN_SYNC_IDS = 5000;
const seenSyncIdOrder = [];
function rememberSyncId(id) {
  if (seenSyncIds.has(id)) return;
  seenSyncIds.add(id);
  seenSyncIdOrder.push(id);
  while (seenSyncIdOrder.length > MAX_SEEN_SYNC_IDS) {
    seenSyncIds.delete(seenSyncIdOrder.shift());
  }
}

function syncConfigPath() {
  return path.join(app.getPath('userData'), 'sync-config.json');
}

// 静的ピア指定用の設定ファイル。無ければデフォルトを書き出してユーザーが追記できるようにする
// 例: { "port": 9095, "peers": ["192.168.1.23", "192.168.1.40:9095"], "autoScan": true,
//       "myDeviceName": "Win-Desk", "secretToken": "全デバイスで揃える共有キー" }
function loadSyncConfig() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(syncConfigPath(), 'utf8'));
  } catch {
    parsed = null; // 未作成・壊れている場合はデフォルト設定から作り直す
  }

  if (parsed && typeof parsed === 'object') {
    syncConfig = {
      port: Number(parsed.port) || DEFAULT_SYNC_PORT,
      peers: Array.isArray(parsed.peers) ? parsed.peers.filter((p) => typeof p === 'string') : [],
      autoScan: parsed.autoScan !== false,
      secretToken:
        typeof parsed.secretToken === 'string' && parsed.secretToken.trim()
          ? parsed.secretToken.trim()
          : null,
    };
    // myDeviceName が指定されていれば、設定画面なしに JSON 編集だけで表示名を短縮できるようにする
    if (typeof parsed.myDeviceName === 'string' && parsed.myDeviceName.trim()) {
      deviceName = parsed.myDeviceName.trim();
    }
    // iconType: HUD に表示する自端末のハードウェアアイコン種別。未知の値は無視してフォールバックに委ねる
    if (typeof parsed.iconType === 'string' && ALLOWED_ICON_TYPES.includes(parsed.iconType)) {
      myIconType = parsed.iconType;
    }
  }

  // secretToken が未設定なら暗号学的に安全なランダムキーを自動生成して設定ファイルへ書き戻す。
  // 同期させたいデバイス同士では sync-config.json の secretToken を同じ値に手動で揃えること
  // (一致しない相手からのアクセスは全エンドポイントで 401 遮断される)
  if (!syncConfig.secretToken) {
    syncConfig.secretToken = crypto.randomBytes(32).toString('hex');
    const out =
      parsed && typeof parsed === 'object'
        ? parsed
        : { port: DEFAULT_SYNC_PORT, peers: [], autoScan: true };
    out.secretToken = syncConfig.secretToken;
    try {
      fs.writeFileSync(syncConfigPath(), JSON.stringify(out, null, 2));
    } catch {
      // 書き出せなくてもメモリ上のトークンで動作を続ける (次回起動では別のトークンが生成される)
    }
  }
}

function pushSyncEntry(entry) {
  syncStore.push(entry);
  if (syncStore.length > MAX_SYNC_STORE) syncStore.splice(0, syncStore.length - MAX_SYNC_STORE);
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
  };
}

// パスがフォルダかどうかの安全判定 (存在しない・stat 失敗は「フォルダではない」扱い)
function isDirectorySafe(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// 自分のデバイスで生まれたアイテムを台帳へ登録し、オンラインのピアへ即時プッシュする
function registerLocalSyncEntry({ type, name, text, path: filePath, timestamp }) {
  // 同期トリガーの最終関門: フォルダは台帳登録もピアへのプッシュも行わず完全スキップする
  if (type !== 'text' && filePath && isDirectorySafe(filePath)) return null;
  const entry = {
    id: crypto.randomUUID(),
    type,
    name: name || null,
    text: text || null,
    path: filePath || null,
    timestamp: timestamp || Date.now(),
    fromDevice: deviceName,
    fromPlatform: process.platform,
  };
  rememberSyncId(entry.id);
  pushSyncEntry(entry);
  pushEntriesToPeers([entry]);
  return entry;
}

// ---- ピア管理 ----

const knownPeers = new Map(); // "host:port" → { host, port, device, online, lastSyncedTs, syncing }

function localAddresses() {
  const addrs = new Set(['127.0.0.1']);
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const a of list || []) {
      if (a.family === 'IPv4') addrs.add(a.address);
    }
  }
  return addrs;
}

function addPeer(host, port, device, iconType) {
  const peerPort = Number(port) || syncConfig.port;
  if (!host) return null;
  if (localAddresses().has(host) && peerPort === syncConfig.port) return null; // 自分自身は除外
  const key = `${host}:${peerPort}`;
  let peer = knownPeers.get(key);
  if (!peer) {
    peer = {
      host,
      port: peerPort,
      device: device || null,
      iconType: iconType || null,
      online: false,
      lastSyncedTs: 0,
      syncing: false,
    };
    knownPeers.set(key, peer);
    // 発見した瞬間に一度差分同期を走らせる (帰宅直後の取り込みを最速化)
    pollPeer(peer);
  } else {
    if (device) peer.device = device;
    if (iconType) peer.iconType = iconType;
  }
  return peer;
}

// ---- HTTP クライアントヘルパー (依存パッケージなし、node:http のみ) ----

function httpGetJson(host, port, pathName, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host,
        port,
        path: pathName,
        timeout: timeoutMs,
        headers: { [SYNC_TOKEN_HEADER]: syncConfig.secretToken || '' },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > SYNC_BODY_LIMIT) req.destroy(new Error('response too large'));
        });
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function httpPostJson(host, port, pathName, payload, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        host,
        port,
        path: pathName,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          [SYNC_TOKEN_HEADER]: syncConfig.secretToken || '',
        },
      },
      (res) => {
        res.resume(); // レスポンス本文は読み捨てる (ステータスだけ見る)
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`))));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

// 他拠点由来のファイル名は OS を跨ぐため、Windows で使えない文字を除去してから保存する
function sanitizeSyncFileName(name) {
  const cleaned = String(name || '').replace(/[/\\:*?"<>|]/g, '_').trim();
  return cleaned || `synced-${Date.now()}`;
}

// ピアの /file?id= から実体ファイルをローカルの一時保存フォルダへバックグラウンド転送する。
// 一括読み込みせず createWriteStream へパイプするため、数 GB のファイルでもメモリを圧迫しない
function downloadEntryFile(peer, entry) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: peer.host,
        port: peer.port,
        path: `/file?id=${encodeURIComponent(entry.id)}`,
        timeout: 15000,
        headers: { [SYNC_TOKEN_HEADER]: syncConfig.secretToken || '' },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        // 保存先の準備に失敗しても (ディスク満杯・権限など)、http コールバック内の
        // 同期例外でプロセスごと落とさず reject して次回ポーリングの再試行へ回す
        let dest;
        let out;
        try {
          const dir = downloadDir();
          fs.mkdirSync(dir, { recursive: true });
          dest = reserveDest(dir, sanitizeSyncFileName(entry.name));
          out = fs.createWriteStream(dest);
        } catch (err) {
          res.resume();
          return reject(err);
        }
        // 転送途中のネットワークエラーやソケットハングアップでは、両側のストリームを
        // 確実に閉じて欠損ファイルを削除する。reject は次回ポーリングでの再試行につながる
        let settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          out.destroy();
          res.destroy();
          fsp.unlink(dest).catch(() => {});
          reject(err);
        };
        res.pipe(out);
        out.on('finish', () => {
          if (settled) return;
          settled = true;
          sessionTempFiles.add(dest); // 同期コピーも終了時クリーンアップの対象として追跡
          resolve(dest);
        });
        out.on('error', fail);
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('socket hang up')));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---- 受信アイテムの取り込み ----

// 成功 (または取り込み不要) なら true。ファイル転送に失敗したときだけ false を返し、
// seenSyncIds に入れずに次回の差分ポーリングで再試行できるようにする
async function importRemoteEntry(meta, peer) {
  if (!meta || typeof meta.id !== 'string') return true;
  if (seenSyncIds.has(meta.id) || meta.fromDevice === deviceName) return true; // 重複・自分発は無視

  const entry = {
    id: meta.id,
    type: meta.type,
    name: meta.name || null,
    text: meta.type === 'text' ? meta.text || '' : null,
    path: null,
    timestamp: Number(meta.timestamp) || Date.now(),
    fromDevice: meta.fromDevice || peer.device || peer.host,
    fromPlatform: meta.fromPlatform || null,
  };

  if (meta.type === 'text') {
    rememberSyncId(entry.id);
    if (!entry.text.trim()) return true;
    // ドラッグアウト用に snippet ファイルも裏生成しておく (失敗しても本文だけで取り込む)
    try {
      entry.path = await saveSnippetAsFile(entry.text);
    } catch {
      entry.path = null;
    }
    pushSyncEntry(entry);
    sendClipboardItem({
      type: 'clipboard-text',
      text: entry.text,
      path: entry.path,
      timestamp: entry.timestamp,
      fromDevice: entry.fromDevice,
      fromPlatform: entry.fromPlatform,
    });
    // 3 台以上の構成で、送信元と直接つながっていないピアにも届くよう中継プッシュする
    // (受信側は id で重複を弾くため循環しない)
    pushEntriesToPeers([entry]);
    return true;
  }

  if (meta.type === 'image' || meta.type === 'file') {
    if (!meta.hasFile) {
      rememberSyncId(entry.id);
      return true;
    }
    try {
      entry.path = await downloadEntryFile(peer, entry);
    } catch (err) {
      console.error('同期ファイルの転送に失敗 (次回ポーリングで再試行):', entry.name, err.message);
      return false;
    }
    rememberSyncId(entry.id);
    pushSyncEntry(entry); // ローカルパス付きで台帳に載せ、さらに別のピアへも中継できるようにする
    if (meta.type === 'image') {
      sendClipboardItem({
        type: 'clipboard-image',
        text: null,
        path: entry.path,
        timestamp: entry.timestamp,
        fromDevice: entry.fromDevice,
        fromPlatform: entry.fromPlatform,
      });
    } else {
      addFileQuietly(entry.path, entry);
    }
    // 3 台以上の構成で、送信元と直接つながっていないピアにも届くよう中継プッシュする
    pushEntriesToPeers([entry]);
    return true;
  }

  rememberSyncId(entry.id); // 未知の type は黙って読み飛ばす (将来の拡張との互換)
  return true;
}

// ---- 差分ポーリング (タイムスタンプ比較) ----

async function pollPeer(peer) {
  if (peer.syncing) return; // 同じピアへのポーリングが重ならないようにする
  peer.syncing = true;
  try {
    const data = await httpGetJson(peer.host, peer.port, `/items?since=${peer.lastSyncedTs}`, 5000);
    if (!data || data.app !== 'bridge' || !Array.isArray(data.items)) return;
    peer.online = true;
    if (data.device) peer.device = data.device;
    if (data.iconType) peer.iconType = data.iconType;
    // lastSyncedTs は「ピア側の時計で付いたタイムスタンプ」の最大値なので、
    // デバイス間の時計ズレがあっても差分の取りこぼしは起きない
    const sorted = data.items.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    for (const meta of sorted) {
      const ok = await importRemoteEntry(meta, peer);
      if (!ok) break; // 転送失敗地点で止め、タイムスタンプを進めず次回に再取得する
      peer.lastSyncedTs = Math.max(peer.lastSyncedTs, Number(meta.timestamp) || 0);
    }
  } catch {
    peer.online = false; // 外出中などで到達不能。lastSyncedTs は保持し、再接続時に差分だけ取り込む
  } finally {
    peer.syncing = false;
  }
}

function pollAllPeers() {
  for (const peer of knownPeers.values()) pollPeer(peer);
}

// 新着アイテムが発生した瞬間、オンラインの全ピアへメタデータを即時プッシュする
function pushEntriesToPeers(entries) {
  if (entries.length === 0 || knownPeers.size === 0) return;
  const payload = {
    app: 'bridge',
    device: deviceName,
    platform: process.platform,
    port: syncConfig.port,
    iconType: myIconType,
    items: entries.map(syncMetadata),
  };
  for (const peer of knownPeers.values()) {
    if (!peer.online) continue; // オフラインのピアへは再接続後の差分ポーリングで届く
    httpPostJson(peer.host, peer.port, '/push', payload).catch(() => {
      peer.online = false;
    });
  }
}

// ---- 同期サーバー (node:http、外部パッケージ不使用) ----

function respondJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// リクエストヘッダーの secretToken を厳格に照合する。
// 定数時間比較 (tokensMatch) はリモート操作の TCP コントロールチャネルとも共有する
function isAuthorizedRequest(req) {
  return controlNet.tokensMatch(req.headers[SYNC_TOKEN_HEADER], syncConfig.secretToken);
}

function startSyncServer() {
  const server = http.createServer((req, res) => {
    // ソケット異常 (切断・ハングアップ) はこの接続だけを res.end() で安全に閉じ、
    // サーバー自体や他ピアとの同期通信を絶対にフリーズさせない
    req.on('error', () => {
      try {
        res.end();
      } catch {
        // 既にソケットが閉じていれば何もしない
      }
    });
    res.on('error', () => {});

    // 秘密鍵認証: secretToken が一致しないリクエストは /ping・/items・/file・/push を含む
    // 全エンドポイントで 401 Unauthorized として即時遮断する。これにより同一 LAN 内に
    // 他人の Bridge が居ても、クリップボード履歴やファイルが混線・漏洩することはない
    if (!isAuthorizedRequest(req)) {
      res.writeHead(401);
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === '/ping') {
        respondJson(res, {
          app: 'bridge',
          device: deviceName,
          platform: process.platform,
          port: syncConfig.port,
          iconType: myIconType,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/items') {
        const since = Number(url.searchParams.get('since')) || 0;
        const items = syncStore.filter((e) => e.timestamp > since).map(syncMetadata);
        respondJson(res, {
          app: 'bridge',
          device: deviceName,
          platform: process.platform,
          iconType: myIconType,
          items,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/file') {
        const id = url.searchParams.get('id');
        const entry = syncStore.find((e) => e.id === id);
        let stat = null;
        try {
          stat = entry && entry.path ? fs.statSync(entry.path) : null;
        } catch {
          stat = null; // GC 済み・アクセス不可のパスは「無い」扱い
        }
        // フォルダは配信対象外として完全スキップ (存在しないのと同じ 404 を返す)
        if (!stat || stat.isDirectory()) {
          res.writeHead(404);
          res.end();
          return;
        }
        // 一括読み込みせずストリームでパイプする。数 GB のファイルでもメモリを圧迫しない
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
        });
        const stream = fs.createReadStream(entry.path);
        stream.pipe(res);
        // 読み取りエラー時も res.end() で接続を確実に閉じ、後続の同期通信を巻き添えにしない
        stream.on('error', (err) => {
          console.error('同期ファイルの配信に失敗:', entry.path, err.message);
          res.end();
        });
        // 受信側の切断 (ソケットハングアップ) では読み取りを即座に止めて fd を解放する
        res.on('close', () => stream.destroy());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/push') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (c) => {
          body += c;
          if (body.length > SYNC_BODY_LIMIT) req.destroy();
        });
        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);
            if (payload.app !== 'bridge' || !Array.isArray(payload.items)) {
              res.writeHead(400);
              res.end();
              return;
            }
            // プッシュしてきた相手をピアとして記憶する (静的設定もスキャンも不要な自動ブートストラップ)
            const host = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
            const peer =
              addPeer(host, payload.port, payload.device, payload.iconType) || {
                host,
                port: Number(payload.port) || syncConfig.port,
                device: payload.device || null,
                iconType: payload.iconType || null,
              };
            peer.online = true;
            const sorted = payload.items.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            for (const meta of sorted) await importRemoteEntry(meta, peer);
            respondJson(res, { ok: true });
          } catch {
            res.writeHead(400);
            res.end();
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (err) {
      console.error('同期サーバーのリクエスト処理に失敗:', err);
      try {
        res.writeHead(500);
        res.end();
      } catch {
        // 応答済みなら無視
      }
    }
  });

  server.on('error', (err) => console.error('同期サーバーの起動に失敗:', err.message));
  // 不正なリクエストや接続途中のソケット異常は該当ソケットだけを破棄し、サーバーを守る
  server.on('clientError', (_err, socket) => socket.destroy());
  server.listen(syncConfig.port, '0.0.0.0');
}

// ---- 同一セグメントの簡易スキャン (静的設定なしでもピアを自動発見する) ----

let subnetScanRunning = false;

async function scanSubnetForPeers() {
  if (!syncConfig.autoScan || subnetScanRunning) return;
  subnetScanRunning = true;
  try {
    const self = localAddresses();
    const targets = new Set();
    for (const list of Object.values(os.networkInterfaces() || {})) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        // 有線 LAN / Wi-Fi の両インターフェースを対象に、一般的な /24 の範囲を走査する
        const base = a.address.split('.').slice(0, 3).join('.');
        for (let i = 1; i <= 254; i++) {
          const host = `${base}.${i}`;
          if (!self.has(host)) targets.add(host);
        }
      }
    }

    const hosts = [...targets];
    const CONCURRENCY = 32;
    for (let i = 0; i < hosts.length; i += CONCURRENCY) {
      await Promise.all(
        hosts.slice(i, i + CONCURRENCY).map(async (host) => {
          try {
            const info = await httpGetJson(host, syncConfig.port, '/ping');
            if (info && info.app === 'bridge') addPeer(host, info.port, info.device, info.iconType);
          } catch {
            // Bridge が居ないホスト・応答なしは無視
          }
        })
      );
    }
  } catch (err) {
    // ネットワークインターフェースの列挙失敗などでスキャンが落ちても、
    // 未処理の Promise 拒否にせず次回の定期スキャンに委ねる
    console.error('サブネットスキャンに失敗:', err);
  } finally {
    subnetScanRunning = false;
  }
}

function startDeviceSync() {
  loadSyncConfig();
  startSyncServer();
  for (const raw of syncConfig.peers) {
    const [host, port] = raw.split(':');
    if (host && host.trim()) addPeer(host.trim(), port);
  }
  scanSubnetForPeers();
  setInterval(pollAllPeers, SYNC_POLL_MS);
  setInterval(scanSubnetForPeers, SUBNET_SCAN_MS);
}

// Renderer が「ローカル / 他拠点」バッジを出し分けるための自分自身の情報
ipcMain.handle('get-device-info', () => ({ device: deviceName, platform: process.platform }));

// ---- フォルダの自動 .zip 化 (フォルダ除外ガードのアップグレード) ----
// /file はフォルダをストリーム配信できないため、フォルダは登録前に OS 標準コマンドで
// 「フォルダ名.zip」へ裏圧縮し、その zip の実体を同期相手へストリーム転送する。
// 受信側は通常のファイル同期と同じ経路で zip のままハブへ保存する (自動展開はしない)

// フォルダを一時保存フォルダ内の「フォルダ名.zip」へ圧縮し、生成した zip の絶対パスを返す
async function zipFolder(folderPath) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(folderPath) || 'folder';
  const dest = reserveDest(dir, `${sanitizeSyncFileName(base)}.zip`);

  if (process.platform === 'win32') {
    // PowerShell の単一引用符リテラル ('' でエスケープ) に包み、空白・日本語パスも安全に渡す
    const q = (p) => `'${p.replace(/'/g, "''")}'`;
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -LiteralPath ${q(folderPath)} -DestinationPath ${q(dest)} -Force`,
      ],
      { windowsHide: true }
    );
  } else if (process.platform === 'darwin') {
    // ditto は Finder の「圧縮」と同じ macOS 標準コマンド (--keepParent でフォルダごと格納)
    await execFileAsync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', folderPath, dest]);
  } else {
    // Linux 等は zip コマンドへフォールバック (親ディレクトリ基準で相対パス格納)
    await execFileAsync('zip', ['-r', dest, base], { cwd: path.dirname(folderPath) });
  }

  sessionTempFiles.add(dest); // 裏生成した zip は終了時クリーンアップの対象として追跡
  return dest;
}

// Renderer で追加されたローカル生まれのファイル (D&D・Web ダウンロード・テキスト保存等) を
// 同期台帳へ登録する。他拠点由来のアイテムは Renderer 側で登録をスキップするため循環しない
ipcMain.on('sync-register-file', (_event, payload) => {
  const filePath = payload && payload.path;
  if (typeof filePath !== 'string' || registeredSyncPaths.has(filePath)) return;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return; // 消えた・読めないパスは登録しない
  }
  registeredSyncPaths.add(filePath);
  // フォルダはそのまま同期できないため、バックグラウンドで .zip 化してから台帳へ登録する。
  // ローカルのリストにはフォルダのカードがそのまま残り、同期相手には zip が届く
  if (stat.isDirectory()) {
    zipFolder(filePath)
      .then((zipPath) => {
        registerLocalSyncEntry({
          type: 'file',
          name: path.basename(zipPath),
          path: zipPath,
          timestamp: Date.now(),
        });
      })
      .catch((err) => {
        registeredSyncPaths.delete(filePath); // 失敗した場合は次回の登録 (再ドロップ) で再挑戦できるようにする
        console.error('フォルダの zip 化に失敗 (同期をスキップ):', filePath, err.message);
      });
    return;
  }
  registerLocalSyncEntry({
    type: 'file',
    name: (payload && payload.name) || path.basename(filePath),
    path: filePath,
    timestamp: Date.now(),
  });
});

// ---- リモート操作 HUD ----
//
// Tab で選択移動 → Enter で確定 → Esc でキャンセル、という一連の UI ロジックは
// hud-renderer.js 側に閉じている。Main は「開く/閉じる/確定結果を受け取る」だけを担う。
// デバイス一覧は既存のマルチデバイス同期の knownPeers Map をそのまま再利用する
// (同期用ピア発見の仕組みに相乗りし、別建ての発見機構は持たない)。

const HUD_SHORTCUT = 'Shift+Alt+Space';

// knownPeers のうちオンライン (直近の /ping 応答・差分同期に成功) なピアだけを対象にする。
// 先頭に自分自身 ("この端末") を常に含め、操作を自分へ戻す選択肢として使えるようにする
function getKnownDevicesForHud() {
  const peers = [...knownPeers.values()]
    .filter((peer) => peer.online)
    .map((peer) => ({
      id: `${peer.host}:${peer.port}`,
      device: peer.device || peer.host,
      iconType: peer.iconType || null,
      isSelf: false,
    }));
  return [{ id: 'self', device: deviceName, iconType: myIconType, isSelf: true }, ...peers];
}

function toggleHud() {
  // 操作セッション中のホットキーは「セッション終了 → HUD 再表示」として扱う。
  // globalShortcut は OS レベルでキーを消費するため、before-input-event 側の
  // 予約コンボ (handleOverlayBeforeInput) には実際にはほぼ届かない。つまり
  // ここがセッションからの脱出経路の本命であり、終了せずに HUD だけ出すと
  // オーバーレイとフォーカスを奪い合って HUD が操作不能になる
  if (controlSession) {
    endControlSession('user-confirmed');
    controlWindows.showHud(getKnownDevicesForHud());
    return;
  }
  if (controlWindows.isHudVisible()) {
    controlWindows.hideHud();
  } else {
    controlWindows.showHud(getKnownDevicesForHud());
  }
}

// ---- controller (操作元) 側のセッション状態機械 ----
//
// null (待機中) | { role: 'controller', state: 'connecting' | 'hosting', targetId,
//                   targetDevice, sessionId, client, display }
// 複数経路 (release コンボ・異常切断・接続エラー) から endControlSession が
// 競合して呼ばれうるため、null 化を先に行うことで冪等性を保証する
let controlSession = null;

function startControlSession(targetId) {
  const peer = knownPeers.get(targetId);
  if (!peer) return;
  const targetDevice = peer.device || peer.host;
  const sessionId = crypto.randomUUID();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const client = controlNet.connectToPeer(peer.host, controlNet.CONTROL_PORT, {
    getToken: () => syncConfig.secretToken,
    getDeviceName: () => deviceName,
  });
  controlSession = { role: 'controller', state: 'connecting', targetId, targetDevice, sessionId, client, display };

  // 差し替え・終了済みの古い接続からの遅延イベントを無視するためのガード
  const isCurrent = () => controlSession && controlSession.sessionId === sessionId;

  client.on('ready', () => {
    if (!isCurrent()) return;
    client.send({ type: 'control-start', id: sessionId, fromDevice: deviceName, timestamp: Date.now() });
    controlSession.state = 'hosting';
    controlWindows.showOverlay(display, targetDevice);
  });

  client.on('message', (msg) => {
    if (!isCurrent() || msg.type !== 'control-start-reject') return;
    if (canSendToRenderer()) win.webContents.send('control-connect-failed', { device: targetDevice, reason: msg.reason });
    endControlSession('reject', true);
  });

  client.on('reject', (reason) => {
    if (!isCurrent()) return;
    if (canSendToRenderer()) win.webContents.send('control-connect-failed', { device: targetDevice, reason });
    controlSession = null;
  });

  client.on('error', () => {
    if (!isCurrent()) return;
    if (canSendToRenderer()) win.webContents.send('control-connect-failed', { device: targetDevice, reason: 'error' });
    endControlSession('error', true);
  });

  client.on('close', () => {
    if (!isCurrent()) return;
    endControlSession('peer-disconnected', true);
  });
}

// セッション終了の唯一の入口。skipSend は「相手が既にいなくなっている」経路
// (異常切断・エラー・拒否) で二重に control-end を送らないためのフラグ
function endControlSession(reason, skipSend) {
  if (!controlSession) return; // 冪等: 複数経路からの二重呼び出しに備える
  const session = controlSession;
  controlSession = null;
  overlayHeldCodes.clear();
  controlWindows.hideOverlay();
  if (!skipSend && session.state === 'hosting') {
    session.client.send({ type: 'control-end', id: session.sessionId, reason });
  }
  session.client.close();
}

// ---- 全画面キャプチャオーバーレイの IPC 配線 ----
//
// 捕捉した入力イベントは間引かずそのまま TCP コントロールチャネルへ送出する

ipcMain.on('overlay-mouse-move', (_event, { dx, dy }) => {
  if (controlSession?.state === 'hosting') controlSession.client.send({ type: 'mouse-move', dx, dy, ts: Date.now() });
});
ipcMain.on('overlay-mouse-button', (_event, { button, action }) => {
  if (controlSession?.state === 'hosting') controlSession.client.send({ type: 'mouse-button', button, action, ts: Date.now() });
});
ipcMain.on('overlay-wheel', (_event, { dx, dy }) => {
  if (controlSession?.state === 'hosting') controlSession.client.send({ type: 'wheel', dx, dy, ts: Date.now() });
});
// ---- ホスト側キー捕捉 (before-input-event) ----
//
// キーボードは Renderer の DOM keydown ではなく、オーバーレイ webContents の
// before-input-event で Main プロセス側から横取りする。理由:
// 1. event.preventDefault() でアプリケーションメニューのアクセラレータを無効化できる。
//    これをしないと macOS ホストでは Cmd+Q が「Bridge 自身の終了」になり、
//    Cmd+C/V/W 等のコンボもメニューに食われて target へ届かない
// 2. フルスクリーン遷移や Pointer Lock の状態に依存せず、ウインドウがフォーカスを
//    持ってさえいれば必ず発火するため、修飾キー単体の押下も確実に捕捉できる
//
// なお OS 自体が先に消費するショートカット (macOS の Cmd+Tab / Spotlight、
// Windows の Win キー等) はアプリからは捕捉できない (既知の制約として SPEC.md に記載)

// down 済みコードの追跡。Chromium は同一押下に対し rawKeyDown / keyDown の両方を
// 発火させることがあるため、二重転送をここで抑止する (autorepeat は通す)
const overlayHeldCodes = new Set();

// KeyboardEvent.code → before-input-event が運ぶ修飾フラグ名の対応表
const MODIFIER_FLAG_BY_CODE = {
  ShiftLeft: 'shift', ShiftRight: 'shift',
  ControlLeft: 'control', ControlRight: 'control',
  AltLeft: 'alt', AltRight: 'alt',
  MetaLeft: 'meta', MetaRight: 'meta',
};

// up の転送と追跡解除をワンセットで行う (合成 up と実 up の両方から使う)
function sendOverlayKeyUp(code) {
  overlayHeldCodes.delete(code);
  controlSession.client.send({ type: 'key', code, action: 'up', ts: Date.now() });
}

// 修飾キーの keyUp はホスト側で取りこぼされることがある (Cmd+Tab / Win キー等の
// OS ショートカットによる横取り、フォーカス喪失、macOS の keyUp 抑止仕様)。
// 取りこぼすと target 側で Ctrl/Cmd が押しっぱなしになる最悪の事故につながるため、
// 毎イベントに載ってくる「現在の修飾フラグ」と転送済みの down を突き合わせ、
// 食い違っている修飾キーの up をここで合成して自己修復する
function reconcileHeldModifiers(input) {
  for (const code of [...overlayHeldCodes]) {
    const flag = MODIFIER_FLAG_BY_CODE[code];
    if (!flag || code === input.code) continue; // 非修飾キーと処理中のイベント自身は対象外
    if (!input[flag]) sendOverlayKeyUp(code);
  }
}

function handleOverlayBeforeInput(event, input) {
  if (controlSession?.state !== 'hosting') return;
  event.preventDefault(); // ページへの配送とメニューアクセラレータの両方を止める
  const code = input.code;
  if (!code) return;

  reconcileHeldModifiers(input);

  if (input.type === 'keyUp') {
    // macOS は Cmd を押している間、他キーの keyUp をアプリへ届けない仕様のため
    // (Cmd+C の C の up が来ない)、Cmd の up を境に「まだ down のままの非修飾キー」の
    // up をまとめて合成し、target 側に文字キーが押しっぱなしで残るのを防ぐ
    if (process.platform === 'darwin' && (code === 'MetaLeft' || code === 'MetaRight')) {
      for (const held of [...overlayHeldCodes]) {
        if (!MODIFIER_FLAG_BY_CODE[held]) sendOverlayKeyUp(held);
      }
    }
    sendOverlayKeyUp(code);
    return;
  }
  if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return; // 'char' は転送しない
  if (overlayHeldCodes.has(code) && !input.isAutoRepeat) return; // rawKeyDown/keyDown の二重発火除去
  overlayHeldCodes.add(code);

  // 予約コンボ (Shift+Alt+Space): ワイヤーへ転送せずセッションを終えて HUD へ戻る
  if (code === 'Space' && input.shift && input.alt) {
    endControlSession('user-confirmed');
    controlWindows.showHud(getKnownDevicesForHud());
    return;
  }
  controlSession.client.send({ type: 'key', code, action: 'down', ts: Date.now() });
}

// 操作元と操作先の OS が異なるセッションでは「主修飾キー」を読み替える。
// mac の Cmd と Windows の Ctrl は役割 (コピー/ペースト等の標準ショートカット) が
// 対応するため、mac→win では Cmd を Ctrl として、win→mac では Ctrl を Cmd として
// 注入する。down/up が同じ規則で読み替わるため押しっぱなし追跡 (heldKeys) は破綻しない。
// トレードオフ: mac target へ素の Ctrl を送る手段は失われる (mac 側の Ctrl 利用は稀と判断)
const PRIMARY_MODIFIER_MAP = {
  'darwin->win32': { MetaLeft: 'ControlLeft', MetaRight: 'ControlRight' },
  'win32->darwin': { ControlLeft: 'MetaLeft', ControlRight: 'MetaRight' },
};

function translateKeyCode(code, fromPlatform) {
  const map = PRIMARY_MODIFIER_MAP[`${fromPlatform}->${process.platform}`];
  return (map && map[code]) || code;
}

// TCP コントロールチャネルのサーバー側 (target) は、同期 HTTP サーバーと同様に
// 全デバイスが起動時から常時listenする (どのデバイスもいつでも target になりうる)。
// 実際の入力注入は nut-js ラッパー (control-input.js) の各 inject*() へ配線する。
function startControlSubsystem() {
  const server = controlNet.startControlServer({
    getToken: () => syncConfig.secretToken,
    getDeviceName: () => deviceName,
  });
  server.on('session', (session) => {
    console.log('[control] session opened from', session.fromDevice, session.fromPlatform);

    // 異常切断・タイムアウト・明示的 control-end のいずれでも必ず一度だけ呼ばれる。
    // 押しっぱなしのキー/ボタンを target 側に残さないための最重要の安全弁
    session.on('close', () => {
      controlInput.releaseAllHeld().catch((err) => console.error('[control] releaseAllHeld 失敗:', err));
    });

    session.on('control-start', (msg) => {
      console.log('[control] control-start id=%s from=%s', msg.id, msg.fromDevice);
      if (!controlInput.hasAccessibilityPermission()) {
        session.send({ type: 'control-start-reject', reason: 'accessibility-permission-required' });
        controlInput.requestAccessibilityPermission();
        if (canSendToRenderer()) win.webContents.send('accessibility-permission-needed');
        session.close('accessibility-permission-required');
        return;
      }
    });

    session.on('input', (msg) => {
      switch (msg.type) {
        case 'mouse-move':
          controlInput.injectMouseMove(msg.dx, msg.dy).catch((err) => console.error('[control] injectMouseMove 失敗:', err));
          break;
        case 'mouse-button':
          controlInput.injectMouseButton(msg.button, msg.action).catch((err) => console.error('[control] injectMouseButton 失敗:', err));
          break;
        case 'wheel':
          controlInput.injectWheel(msg.dx, msg.dy).catch((err) => console.error('[control] injectWheel 失敗:', err));
          break;
        case 'key':
          controlInput
            .injectKey(translateKeyCode(msg.code, session.fromPlatform), msg.action)
            .catch((err) => console.error('[control] injectKey 失敗:', err));
          break;
        default:
          break; // 前方互換: 未知の入力種別は無視
      }
    });

    session.on('control-end', (msg) => {
      console.log('[control] control-end reason=%s', msg.reason);
    });
  });
  return server;
}

ipcMain.on('hud-confirm', (_event, deviceId) => {
  controlWindows.hideHud();
  if (deviceId === 'self') {
    endControlSession('user-confirmed'); // 操作中でなければ何もしない (endControlSession は冪等)
    return;
  }
  if (controlSession) endControlSession('user-confirmed'); // 既存セッションがあれば先に畳んでから乗り換える
  startControlSession(deviceId);
});

ipcMain.on('hud-cancel', () => {
  controlWindows.hideHud();
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // 多重起動の第2インスタンスは何も起動せず quit を待つ
  createWindow();
  createTray();
  controlWindows.createHudWindow();
  controlWindows.createOverlayWindow();
  controlWindows.overlayWebContents()?.on('before-input-event', handleOverlayBeforeInput);
  globalShortcut.register(HUD_SHORTCUT, toggleHud);
  startControlSubsystem();
  startClipboardWatcher();
  startEdgeRevealWatcher();
  startDeviceSync();

  // Windows/Linux で bridge:// から直接起動された場合は argv に URL が入っている
  const initialUrl = process.argv.find((arg) => arg.startsWith('bridge://'));
  if (initialUrl) {
    handleBridgeUrl(initialUrl).catch((err) => console.error('bridge:// の処理に失敗:', initialUrl, err));
  }
});

app.on('activate', () => {
  if (win === null) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
