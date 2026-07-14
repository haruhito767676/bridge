// リモート操作機能で使う補助ウインドウの生成・表示・破棄を担当する。
// main.js の win (シェルフ) と同じ「xAlive() / canSendToX()」パターンに揃え、
// 破棄中の取りこぼしを防ぐ。

const { BrowserWindow, screen } = require('electron');
const path = require('path');

let hudWin = null;
let hudReady = false;

function hudAlive() {
  return hudWin !== null && !hudWin.isDestroyed();
}

function canSendToHud() {
  return hudAlive() && hudReady && !hudWin.webContents.isDestroyed();
}

// カーソルがあるディスプレイの workArea 中央に、デバイス数に応じた高さの小型ボックスを配置する
const HUD_WIDTH = 280;
const HUD_ROW_HEIGHT = 40;
const HUD_PADDING = 24;
const HUD_MAX_HEIGHT = 420;

function hudBoundsForDisplay(display, deviceCount) {
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const height = Math.min(HUD_PADDING + Math.max(deviceCount, 1) * HUD_ROW_HEIGHT, HUD_MAX_HEIGHT);
  const x = Math.round(dx + (dw - HUD_WIDTH) / 2);
  const y = Math.round(dy + (dh - height) / 2);
  return { x, y, width: HUD_WIDTH, height };
}

function createHudWindow() {
  hudWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    vibrancy: process.platform === 'darwin' ? 'hud' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  hudWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWin.setAlwaysOnTop(true, 'floating');

  hudWin.webContents.on('did-finish-load', () => {
    hudReady = true;
  });
  hudWin.on('closed', () => {
    hudReady = false;
    hudWin = null;
  });

  hudWin.loadFile('hud.html');
}

// 現在マウスがあるディスプレイを基準に HUD を表示し、デバイス一覧を送る
function showHud(devices) {
  if (!hudAlive()) return;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  hudWin.setBounds(hudBoundsForDisplay(display, devices.length), false);
  if (canSendToHud()) hudWin.webContents.send('hud-set-devices', devices);
  hudWin.show();
  hudWin.focus();
}

function hideHud() {
  if (!hudAlive()) return;
  hudWin.hide();
}

function isHudVisible() {
  return hudAlive() && hudWin.isVisible();
}

// ---- 全画面キャプチャオーバーレイ ----
//
// HUD で確定した瞬間から、host 側のマウス/キーボード入力を「奪う」ための透過・
// 最前面ウインドウ。v1 スコープはセッション開始時にカーソルがあったディスプレイの
// みをカバーする (全ディスプレイ同時カバーは後続フェーズの改善項目)。
//
// alwaysOnTop を 'screen-saver' レベルにするのはシェルフの流儀とは逆だが、
// このウインドウは「常に唯一の最前面レイヤーである」こと自体が目的なので、
// シェルフが screen-saver を避ける理由 (OS のドラッグ中アイコン描画と競合する) は
// ここでは問題にならない。
//
// setIgnoreMouseEvents は絶対に呼ばない: 呼ぶとクリックスルーしてしまい、
// 「入力を奪う」というこのウインドウの目的そのものが破綻する

let overlayWin = null;
let overlayReady = false;

function overlayAlive() {
  return overlayWin !== null && !overlayWin.isDestroyed();
}

function canSendToOverlay() {
  return overlayAlive() && overlayReady && !overlayWin.webContents.isDestroyed();
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');

  overlayWin.webContents.on('did-finish-load', () => {
    overlayReady = true;
  });
  overlayWin.on('closed', () => {
    overlayReady = false;
    overlayWin = null;
  });
  overlayWin.on('leave-full-screen', () => {
    if (overlayAlive()) overlayWin.hide();
  });

  overlayWin.loadFile('overlay.html');
}

// セッション開始時にカーソルがあったディスプレイの全体 (workArea ではなく bounds:
// メニューバー/Dock も含めて画面全体を覆う) をカバーして全画面化する
function showOverlay(display, deviceLabel) {
  if (!overlayAlive()) return;
  overlayWin.setBounds(display.bounds, false);
  overlayWin.show();
  overlayWin.setFullScreen(true);
  overlayWin.focus();
  if (canSendToOverlay()) overlayWin.webContents.send('overlay-activate', { device: deviceLabel });
}

function hideOverlay() {
  if (!overlayAlive()) return;
  if (canSendToOverlay()) overlayWin.webContents.send('overlay-deactivate');
  if (overlayWin.isFullScreen()) {
    overlayWin.setFullScreen(false); // 'leave-full-screen' ハンドラが実際の hide() を行う
  } else {
    overlayWin.hide();
  }
}

module.exports = {
  createHudWindow,
  showHud,
  hideHud,
  isHudVisible,
  hudAlive,
  canSendToHud,
  createOverlayWindow,
  showOverlay,
  hideOverlay,
  overlayAlive,
  canSendToOverlay,
};
