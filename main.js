const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// ---- シェルフのジオメトリ ----
const SHELF_WIDTH = 156;   // 展開時の幅
const SHELF_HEIGHT = 420;  // 高さ（画面右端・垂直センター）
const PEEK_WIDTH = 10;     // 収納時に画面端に見せる「つまみ」の幅

let win = null;
let isExpanded = false;

/**
 * 現在マウスカーソルがあるディスプレイ（＝ユーザーが今操作しているモニター）を返す。
 * getPrimaryDisplay() だと常にプライマリモニター基準になってしまい、
 * マルチモニターでは意図しないモニターに表示されてしまう。
 */
function getActiveDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * 展開/収納それぞれの状態におけるウィンドウ矩形を計算する。
 * 収納時はウィンドウの大部分を画面右外に逃がし、左端 PEEK_WIDTH px だけ残す。
 * workArea は各ディスプレイの scaleFactor に応じた DIP（論理ピクセル）値が
 * 返るため、渡された display の workArea をそのまま使えば拡大率が異なる
 * モニター間でもサイズが崩れない。
 */
function shelfBounds(expanded, display = getActiveDisplay()) {
  const { workArea } = display;
  const y = workArea.y + Math.round((workArea.height - SHELF_HEIGHT) / 2);
  const x = expanded
    ? workArea.x + workArea.width - SHELF_WIDTH
    : workArea.x + workArea.width - PEEK_WIDTH;
  return { x, y, width: SHELF_WIDTH, height: SHELF_HEIGHT };
}

/**
 * win.setBounds() を安全に適用する。
 * Windows では、拡大率(DPI)が異なるモニターへウィンドウを一気に移動させると
 * Electron 側が移動前のモニターの scaleFactor でサイズを計算してしまい、
 * ウィンドウが一瞬（あるいはそのまま）異常なサイズ・位置になるバグがある。
 * 一度 setBounds してから次の tick で同じ値を再適用すると、
 * 新しいモニターの DPI で正しく再計算される。
 */
function applyBounds(bounds, animate = false) {
  if (!win) return;
  win.setBounds(bounds, animate);
  if (process.platform === 'win32') {
    setImmediate(() => {
      if (win) win.setBounds(bounds);
    });
  }
}

function setExpanded(expanded) {
  if (!win || isExpanded === expanded) return;
  isExpanded = expanded;
  // 第2引数 true で macOS ネイティブのスムーズなアニメーションになる
  applyBounds(shelfBounds(expanded), true);
  win.webContents.send('shelf:state', expanded);
}

function createWindow() {
  win = new BrowserWindow({
    ...shelfBounds(false),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    // macOS ネイティブのすりガラス効果。frameless でも角丸は roundedCorners (既定 true) が効く
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 通常ウィンドウより一段上のレベルに固定し、全スペース/フルスクリーン上でも見えるようにする
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile('index.html');

  // フォーカスが外れたら（シェルフが空のときだけ renderer 側の判断で）収納
  win.on('blur', () => win.webContents.send('shelf:blurred'));

  // ディスプレイ構成（解像度・拡大率など）が変わったら位置を取り直す
  screen.on('display-metrics-changed', () => {
    if (win) applyBounds(shelfBounds(isExpanded));
  });
}

// ---- IPC ----
ipcMain.on('shelf:expand', () => setExpanded(true));
ipcMain.on('shelf:collapse', () => setExpanded(false));

// シェルフ内アイテムを Finder 等へネイティブにドラッグアウトする
ipcMain.on('shelf:drag-out', async (event, filePath) => {
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    event.sender.startDrag({ file: filePath, icon });
  } catch (err) {
    console.error('drag-out failed:', err);
  }
});

// ファイルアイコンを Data URL で返す（リスト表示用）
ipcMain.handle('shelf:file-icon', async (_event, filePath) => {
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    return icon.toDataURL();
  } catch {
    return null;
  }
});

app.whenReady().then(() => {
  // Dock に出さない（メニューバー常駐ユーティリティとして振る舞う）
  if (process.platform === 'darwin') app.dock.hide();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
