const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 280,
    height: 400,
    minWidth: 220,
    minHeight: 280,
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

  win.on('closed', () => {
    win = null;
  });
}

// ---- 3. ファイルを外へ引き出す（OS標準のネイティブドラッグアウト）----
ipcMain.on('ondragstart', async (event, filePath) => {
  try {
    const icon = await app.getFileIcon(filePath);
    event.sender.startDrag({
      file: filePath,
      icon: icon,
    });
  } catch (err) {
    console.error('drag-out failed:', filePath, err);
  }
});

// ---- 1. リスト表示用のファイルアイコン (Finder と同じ OS 標準アイコン) ----
ipcMain.handle('get-file-icon', async (_event, filePath) => {
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    return icon.toDataURL();
  } catch {
    return null;
  }
});

// ---- 4. スペースキーで Mac 純正クイックルック ----
ipcMain.on('preview-file', (event, filePath, fileName) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender) sender.previewFile(filePath, fileName);
});

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (win === null) createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
