const {
  app,
  BrowserWindow,
  ipcMain,
  net,
  screen,
  clipboard,
  nativeImage,
  nativeTheme,
  globalShortcut,
  Menu,
  shell,
  systemPreferences,
  Tray,
} = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');
const { execFile } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const {
  tokensMatch,
  tokenIdentifierOf,
  sanitizeSyncFileName,
  extractFileUrlPaths,
  extractWindowsAbsolutePaths,
  extractWholeTextPaths,
  syncMetadata,
  compareVersions,
} = require('./lib/sync-utils');
const {
  deriveSyncKey,
  encryptJson,
  decryptJson,
  createEncryptStream,
  createDecryptStream,
  encryptedFileLength,
} = require('./lib/sync-crypto');

// 開発時 (`npm start` / `electron .`) はインストール済みの本番 Bridge と userData
// (設定・sync-config.json 等) を共有すると requestSingleInstanceLock が競合し、
// 本番アプリが常駐しているだけで開発版が起動直後に app.quit() されてしまう。
// パッケージ版とは別ディレクトリに退避して分離する。
if (!app.isPackaged) {
  app.setPath('userData', path.join(app.getPath('appData'), 'bridge-dev'));
}

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

// ---- 一時停止 (メニューバーから切り替える。セッション限りで、再起動すると解除される) ----
let clipboardPaused = false; // クリップボードの監視を止める (履歴に載らず、同期もされない)
let syncPaused = false; // ほかのデバイスとの送受信を止める (監視と履歴はそのまま)

function setClipboardPaused(paused) {
  clipboardPaused = Boolean(paused);
  lastSyncStatusKey = ''; // フッターの表示を即時更新させる
  broadcastSyncStatus();
  updateTrayActivity(); // メニューバーアイコンにも反映する
}

function setSyncPaused(paused) {
  syncPaused = Boolean(paused);
  lastSyncStatusKey = '';
  broadcastSyncStatus();
  updateTrayActivity();
}

// ---- Windows: 常駐 PowerShell ヘルパー ----
// 前面ウインドウの取得と復帰・複数ファイルのコピー検知・クリップボード連番など、Electron からは
// 触れない Win32 API を 1 つの PowerShell プロセスに任せる。毎回起動すると数百 ms かかるため
// 起動しっぱなしにして標準入出力で命令する (命令は Base64 の 1 行、応答は <<END>> 番兵まで)
const WIN_HELPER_LOOP = [
  '[Console]::InputEncoding = [System.Text.Encoding]::UTF8',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  try {',
  '    $script = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))',
  '    Invoke-Expression $script',
  '  } catch {',
  "    Write-Output ('<<ERR>>' + $_.Exception.Message)",
  '  }',
  "  Write-Output '<<END>>'",
  '}',
].join('; ');

const WIN_HELPER_INIT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace Native -Name Win32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint procId);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
Add-Type @'
using System;
using System.Runtime.InteropServices;
public struct RECT { public int Left, Top, Right, Bottom; }
public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
public static class NativeMon {
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);
}
'@
`;

const winShell = {
  proc: null,
  queue: [], // { script, resolve, reject, timer }
  current: null,
  buffer: '',
  initialized: false,
};

function winShellSpawn() {
  if (winShell.proc) return;
  const { spawn } = require('child_process');
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', WIN_HELPER_LOOP],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  winShell.proc = proc;
  winShell.buffer = '';
  winShell.initialized = false;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    winShell.buffer += chunk;
    let idx;
    while ((idx = winShell.buffer.indexOf('<<END>>')) !== -1) {
      const raw = winShell.buffer.slice(0, idx);
      winShell.buffer = winShell.buffer.slice(idx + '<<END>>'.length).replace(/^\r?\n/, '');
      const job = winShell.current;
      winShell.current = null;
      if (!job) continue;
      clearTimeout(job.timer);
      const errIdx = raw.indexOf('<<ERR>>');
      if (errIdx !== -1) job.reject(new Error(raw.slice(errIdx + 7).trim()));
      else job.resolve(raw.replace(/\r/g, '').trim());
      winShellNext();
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('exit', () => {
    winShell.proc = null;
    const job = winShell.current;
    winShell.current = null;
    if (job) {
      clearTimeout(job.timer);
      job.reject(new Error('PowerShell ヘルパーが終了しました'));
    }
    // 残っている命令は次の spawn で処理する
    if (winShell.queue.length > 0) setTimeout(winShellNext, 200);
  });
  // 最初の命令として Win32 API の定義を流す
  winShell.queue.unshift({
    script: WIN_HELPER_INIT,
    resolve: () => {
      winShell.initialized = true;
    },
    reject: (err) => logEvent('winshell', `初期化に失敗: ${err.message}`),
    timer: null,
  });
}

function winShellNext() {
  if (winShell.current || winShell.queue.length === 0) return;
  if (!winShell.proc) {
    winShellSpawn();
  }
  const job = winShell.queue.shift();
  winShell.current = job;
  job.timer = setTimeout(() => {
    // 応答が無い (ハング) ときはプロセスごと捨てて作り直す
    if (winShell.current === job) {
      winShell.current = null;
      job.reject(new Error('PowerShell ヘルパーがタイムアウトしました'));
      if (winShell.proc) winShell.proc.kill();
    }
  }, 8000);
  try {
    winShell.proc.stdin.write(Buffer.from(job.script, 'utf8').toString('base64') + '\n');
  } catch (err) {
    winShell.current = null;
    clearTimeout(job.timer);
    job.reject(err);
  }
}

// PowerShell の式を実行して標準出力 (トリム済み) を返す。Windows 以外では常に失敗する
function winShellRun(script) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows 専用'));
  return new Promise((resolve, reject) => {
    winShell.queue.push({ script, resolve, reject, timer: null });
    winShellNext();
  });
}

// ---- 診断ログ (userData/bridge.log) ----
// 「同期がつながらない」ときに見る場所。同期・発見・ダウンロード・監視の出来事だけを 1 行ずつ追記する。
// 1MB を超えたら .1 に退避して書き直す (2 世代まで)
const LOG_MAX_BYTES = 1024 * 1024;

function logPath() {
  return path.join(app.getPath('userData'), 'bridge.log');
}

function logEvent(category, message) {
  const line = `${new Date().toISOString()}\t[${category}]\t${message}\n`;
  try {
    const dest = logPath();
    let size = 0;
    try {
      size = fs.statSync(dest).size;
    } catch {
      size = 0;
    }
    if (size > LOG_MAX_BYTES) fs.renameSync(dest, `${dest}.1`);
    fs.appendFileSync(dest, line);
  } catch {
    // ログが書けなくても本体の動作には影響させない
  }
}

// ---- 右端への常駐 & スプリングによるスライド開閉 ----

const SHELTER_WIDTH = 320; // シェルターウインドウの幅（開いたとき）
const TAB_WIDTH = 15; // 隠れているときに画面端へ残す「つまみ」の幅
const SHELTER_HEIGHT = 600;

let expanded = false;
let collapseTimer = null;
// Renderer が矩形選択などでマウスボタンを押し続けている間は、カーソルがウインドウの外へ
// 出ても強制格納しない (選択操作の途中でパネルが消える事故を防ぐ)
let rendererHoldsPointer = false;
// 開発用 (BRIDGE_DEV_SEED): カーソル離脱による強制格納を止めて見た目を確認しやすくする
let devHoldOpen = false;

// 指定ディスプレイの右端中央を基準にドック位置を計算する
function dockedBoundsForDisplay(display, shown) {
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;

  const height = Math.min(SHELTER_HEIGHT, dh);
  const y = Math.round(dy + (dh - height) / 2);
  const rightEdge = dx + dw;
  const x = Math.round(shown ? rightEdge - SHELTER_WIDTH : rightEdge - TAB_WIDTH);

  return { x, y, width: shown ? SHELTER_WIDTH : TAB_WIDTH, height };
}

// ---- 開閉アニメーションの方式 ----
//   move:   幅 320px を保ったまま画面外へスライドする。ウインドウの「移動」だけなので
//           Chromium の再レイアウト・再描画が発生せず軽い (通常はこちら)
//   resize: 右端を固定して幅を変える。右隣にディスプレイがある構成では move だと
//           はみ出した部分が隣のディスプレイに見えてしまうため、そのときだけ使う
// 「画面外へ滑り出す矩形」(右端から SHELTER_WIDTH ぶん右) が他のディスプレイと重なるか。
// Windows の DPI 違いのモニターは DIP 座標で数 px の隙間や重なりが出るため、辺の一致ではなく
// 矩形の交差で判定し、さらに余裕 (32px) を持たせる
function hasDisplayToTheRight(display) {
  const { x, y, width, height } = display.bounds;
  const slideOut = { left: x + width - 32, right: x + width + SHELTER_WIDTH + 32, top: y, bottom: y + height };
  return screen.getAllDisplays().some((d) => {
    if (d.id === display.id) return false;
    const b = d.bounds;
    return b.x < slideOut.right && b.x + b.width > slideOut.left && b.y < slideOut.bottom && b.y + b.height > slideOut.top;
  });
}

function dockModeFor(display) {
  return hasDisplayToTheRight(display) ? 'resize' : 'move';
}

// 展開量 t (0 = つまみだけ, 1 = 全開) に対応するウインドウ矩形。
// Renderer 側は #root を右寄せ固定幅にしているため、どちらの方式でも中身は再レイアウトされない
function boundsForProgress(display, t, mode) {
  const closed = dockedBoundsForDisplay(display, false);
  const rightEdge = closed.x + closed.width;
  if (mode === 'resize') {
    const width = Math.round(TAB_WIDTH + (SHELTER_WIDTH - TAB_WIDTH) * t);
    return { x: rightEdge - width, y: closed.y, width, height: closed.height };
  }
  const x = Math.round(rightEdge - TAB_WIDTH - (SHELTER_WIDTH - TAB_WIDTH) * t);
  return { x, y: closed.y, width: SHELTER_WIDTH, height: closed.height };
}

// 現在マウスがあるディスプレイを特定する
function currentDisplay() {
  const cursor = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(cursor);
}

// ---- スプリングアニメーション (Apple の「減衰比 / 応答」パラメータ) ----
// 毎フレーム「現在値と現在速度」から次の値を計算するため、途中で目標が変わっても
// その場から滑らかに反転する (中断可能・速度連続)。macOS の setBounds(animate: true) は
// 固定時間のイージングで中断できず、Windows では一切アニメーションしないため使わない
const SPRING_RESPONSE_S = 0.32; // 目標に到達するおおよその時間 (秒)
const SPRING_DAMPING_RATIO = 1.0; // 1.0 = 臨界減衰 (行き過ぎない)。ホバー起点の開閉なので弾ませない
const SPRING_FRAME_MS = 1000 / 60;

const dockSpring = {
  value: 0, // 展開量 0..1
  velocity: 0,
  target: 0,
  display: null,
  mode: 'move',
  timer: null,
  lastTs: 0,
};

function prefersReducedMotion() {
  try {
    return nativeTheme.getAnimationSettings
      ? nativeTheme.getAnimationSettings().prefersReducedMotion
      : false;
  } catch {
    return false;
  }
}

function stopDockSpring() {
  if (dockSpring.timer) {
    clearInterval(dockSpring.timer);
    dockSpring.timer = null;
  }
}

function stepDockSpring() {
  if (!winAlive()) {
    stopDockSpring();
    return;
  }
  const now = Date.now();
  const dt = Math.min((now - dockSpring.lastTs) / 1000, 0.05); // タブ切替等で止まっていた分は跳ばさない
  dockSpring.lastTs = now;

  const omega = (2 * Math.PI) / SPRING_RESPONSE_S;
  const stiffness = omega * omega;
  const damping = 2 * SPRING_DAMPING_RATIO * omega;
  const displacement = dockSpring.value - dockSpring.target;
  const accel = -stiffness * displacement - damping * dockSpring.velocity;
  dockSpring.velocity += accel * dt;
  dockSpring.value += dockSpring.velocity * dt;

  const settled =
    Math.abs(dockSpring.value - dockSpring.target) < 0.002 && Math.abs(dockSpring.velocity) < 0.02;
  if (settled) {
    dockSpring.value = dockSpring.target;
    dockSpring.velocity = 0;
    stopDockSpring();
    // 格納が終わったら幅をつまみだけに縮める (画面外にはみ出したままにしない)
    if (dockSpring.target === 0) {
      win.setBounds(dockedBoundsForDisplay(dockSpring.display, false), false);
      return;
    }
  }
  const t = Math.max(0, Math.min(1, dockSpring.value));
  win.setBounds(boundsForProgress(dockSpring.display, t, dockSpring.mode), false);
}

// 展開量を目標へ向けてスプリングで動かす。既に動いている途中なら目標だけ差し替える
// Windows: フライアウト方式。ウインドウは 2 状態を即時に切り替え、滑る動きは Renderer の CSS が担う
// (毎フレームの setBounds は DPI の異なるマルチモニターで Windows 側の再配置と衝突して暴れるため使わない)
const IS_WINDOWS = process.platform === 'win32';
const WIN_COLLAPSE_ANIM_MS = 170; // Renderer のスライドアウト (150ms) を待ってからつまみ幅へ縮める
let winCollapseTimer = null;

function animateDock(display, shown) {
  if (!winAlive()) return;
  dockSpring.display = display;
  dockSpring.target = shown ? 1 : 0;
  if (IS_WINDOWS) {
    if (winCollapseTimer) {
      clearTimeout(winCollapseTimer);
      winCollapseTimer = null;
    }
    if (shown) {
      placeDockInstantly(display, true);
    } else {
      winCollapseTimer = setTimeout(() => {
        winCollapseTimer = null;
        if (!expanded) placeDockInstantly(display, false);
      }, WIN_COLLAPSE_ANIM_MS);
    }
    return;
  }
  if (prefersReducedMotion()) {
    placeDockInstantly(display, shown);
    return;
  }
  if (!dockSpring.timer) {
    dockSpring.mode = dockModeFor(display);
    // 静止状態 (つまみ幅) から動き出すときは、先に一度だけ全幅へ広げてから移動を始める
    if (dockSpring.mode === 'move' && win.getBounds().width !== SHELTER_WIDTH) {
      win.setBounds(boundsForProgress(display, dockSpring.value, 'move'), false);
    }
    dockSpring.lastTs = Date.now();
    dockSpring.timer = setInterval(stepDockSpring, SPRING_FRAME_MS);
  }
}

// アニメーションなしで即座に指定状態へ配置する (ディスプレイ間のワープ・起動時)
function placeDockInstantly(display, shown) {
  if (!winAlive()) return;
  stopDockSpring();
  dockSpring.display = display;
  dockSpring.value = shown ? 1 : 0;
  dockSpring.target = dockSpring.value;
  dockSpring.velocity = 0;
  if (IS_WINDOWS) {
    // Windows ではつまみは別ウインドウ (各モニターに 1 つ) なので、シェルフは格納 = 非表示
    if (shown) {
      win.setBounds(dockedBoundsForDisplay(display, true), false);
      if (!win.isVisible()) win.showInactive();
    } else {
      win.hide();
    }
    return;
  }
  win.setBounds(dockedBoundsForDisplay(display, shown), false);
}

// ---- Windows: モニターごとの「つまみ」ウインドウ ----
// シェルフ本体は 1 枚だが、つまみは全モニターの右端に 1 つずつ置く。どのつまみに触れても
// そのモニターにシェルフを出す。カーソル座標は使わず、つまみウインドウ自身のホバーで判定する
const tabWindows = new Map(); // displayId → BrowserWindow

function createTabWindow(display) {
  const bounds = dockedBoundsForDisplay(display, false);
  const tab = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false, // ホバーやクリックで作業中のアプリからフォーカスを奪わない
    skipTaskbar: true,
    alwaysOnTop: true,
    type: 'toolbar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  tab.loadFile('tab.html', { query: { display: String(display.id) } });
  tab.once('ready-to-show', () => {
    if (!tab.isDestroyed()) tab.showInactive();
  });
  tabWindows.set(display.id, tab);
}

function refreshTabWindows() {
  if (!IS_WINDOWS) return;
  for (const tab of tabWindows.values()) {
    if (!tab.isDestroyed()) tab.destroy();
  }
  tabWindows.clear();
  for (const display of screen.getAllDisplays()) createTabWindow(display);
}

ipcMain.on('tab-activate', (_event, displayId) => {
  const display = screen.getAllDisplays().find((d) => String(d.id) === String(displayId));
  if (!display) return;
  expandShelter({ display });
});

// ウインドウを表示 (show/focus) する直前に、カーソルのあるディスプレイの
// workArea 基準で計算した右端座標へ強制配置する。
// OS の自動配置に任せると復元時にモニターを跨ぐことがあるため、
// 表示前に必ずこの関数で座標を確定させること
function placeOnCursorDisplay(shown) {
  placeDockInstantly(currentDisplay(), shown);
}

// ---- フォーカス方針 ----
// ホバーで開いたときはキーボードフォーカスを奪わない (作業中のアプリへの入力を乗っ取らない)。
// ホットキー・メニューバー・bridge:// のような「明示的な呼び出し」のときだけフォーカスし、
// 格納時には必ず元のアプリへ返す (クリックでコピー → そのまま ⌘V できる状態にする)
function releaseFocus() {
  if (!winAlive() || !win.isFocused()) return;
  if (IS_WINDOWS) return; // 格納時にウインドウごと隠すので、Windows が前面を次のウインドウへ返す
  // blur() (orderBack) ではキーウインドウを手放さないため、一度隠して非アクティブで出し直す。
  // 常に表示されているつまみが 1 フレーム消えるだけで、次のキー入力は元のアプリへ戻る
  win.hide();
  win.showInactive();
}

// focus: true は明示的な呼び出し (ホットキー等)。展開後に検索バーへフォーカスする
function expandShelter({ focus = false, display: targetDisplay = null } = {}) {
  if (!winAlive()) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }

  // マウスカーソルの座標から「今いるディスプレイ」を再取得する。
  // ウインドウが別のディスプレイに居る場合は、まずアニメーションなしで
  // カーソルのあるディスプレイの右端（隠れ位置）へ即座にワープしてから展開する。
  // 既に展開済みでも、カーソルが別ディスプレイの右端に来たときは開き直す
  // 比較相手は「いまドックしているディスプレイ」。アニメーション中のウインドウ矩形から
  // getDisplayMatching で求めると、画面外へ滑り出した瞬間に隣のディスプレイと判定されて
  // 閉じる → 開き直すを繰り返す (マルチモニターでの暴れの原因)
  const display = targetDisplay || currentDisplay();
  const sameDisplay = dockSpring.display ? display.id === dockSpring.display.id : false;
  if (expanded && sameDisplay) {
    if (focus) {
      win.focus();
      if (canSendToRenderer()) win.webContents.send('shelter-expanded', { focus: true });
    }
    return;
  }
  expanded = true;
  lastExpandedAt = Date.now();

  if (!sameDisplay) placeDockInstantly(display, false);
  animateDock(display, true);

  // screen-saver レベルだと OS 側のドラッグ中アイコン/カーソル描画より Bridge が
  // 手前に出てしまうため、通常の floating レベルに留めて OS 描画を Bridge より前面に保つ
  win.setAlwaysOnTop(true, 'floating');
  win.moveTop();
  if (focus) win.focus();

  // 展開のたびに Renderer へ通知し、検索状態のリセット (明示的な呼び出しなら検索バーへのフォーカスも) を行わせる
  if (canSendToRenderer()) win.webContents.send('shelter-expanded', { focus });
}

// 格納時に最前面レベルを通常の floating へ戻す (念のための明示的リセット)
function resetAlwaysOnTopLevel() {
  if (winAlive()) win.setAlwaysOnTop(true, 'floating');
}

// カーソルが展開中のウインドウ矩形の内側にあるか (マージンなし)
function cursorInsideExpandedWindow(cursor) {
  const b = dockedBoundsForDisplay(dockSpring.display || currentDisplay(), true);
  return cursor.x >= b.x && cursor.x <= b.x + b.width && cursor.y >= b.y && cursor.y <= b.y + b.height;
}

function collapseShelter() {
  if (!winAlive()) return;
  if (collapseTimer) clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => {
    collapseTimer = null;
    if (!expanded || devHoldOpen) return;
    // Renderer の mouseleave はレイアウト変更などで空振りすることがあるため、
    // 本当にカーソルがウインドウの外にあるときだけ格納する (Windows は座標を信用せず、
    // Renderer 側の「離脱後に再進入が無かった」判定に任せる)
    if (!IS_WINDOWS && cursorInsideExpandedWindow(screen.getCursorScreenPoint())) return;
    collapseShelterNow();
  }, 220);
}

// 待たずに即座に格納する (履歴クリック後・カーソル離脱の強制回収・ホットキーのトグル)
function collapseShelterNow() {
  if (!winAlive() || devHoldOpen) return;
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = null;
  }
  expanded = false;
  releaseFocus();
  animateDock(dockSpring.display || currentDisplay(), false);
  if (canSendToRenderer()) win.webContents.send('shelter-collapsed');
}

function toggleShelter() {
  if (expanded) collapseShelterNow();
  else expandShelter({ focus: true });
}

// ---- どのモニターでも右端ホバーで出現させるグローバル監視 ----
// つまみ (BrowserWindow) は常に 1 枚しか存在せず、renderer の mouseenter は
// ウインドウが居るディスプレイでしか発火しない。そのため Main 側でカーソル座標を
// ポーリングし、「任意のディスプレイの右端つまみ相当ゾーン」への進入を検知して
// そのディスプレイへワープ & 展開する

const EDGE_POLL_MS = 50;
// つまみゾーンに「居続けた」時間がこの値を超えて初めて展開する。
// 右端はウインドウの閉じるボタン・スクロールバー・通知センターのスワイプ起点と重なるため、
// 通り過ぎただけ・一瞬触れただけでは開かない (Dock の自動表示と同じ考え方)
const EDGE_DWELL_MS = 250;
let tabZoneEnteredAt = null;

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
  const b = dockedBoundsForDisplay(dockSpring.display || currentDisplay(), true);
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

  if (inZone) {
    if (tabZoneEnteredAt === null) tabZoneEnteredAt = Date.now();
    // 滞留時間を満たしたときだけ展開する。展開後は居続けても再展開しないため、
    // クリップボード再利用直後の即時収納 (collapseShelterNow) と喧嘩しない
    if (!expanded && Date.now() - tabZoneEnteredAt >= EDGE_DWELL_MS) {
      expandShelter();
      tabZoneEnteredAt = Infinity; // このゾーン滞在中は二度と展開しない
    }
  } else {
    tabZoneEnteredAt = null;
  }

  // 展開中にカーソルがウインドウ領域から完全に外れたら強制格納する。
  // mouseleave の取りこぼし (マウスの高速移動) をここで完全に回収する。
  // ウインドウにフォーカスがある (ホットキーで呼び出して操作中) 間と、
  // Renderer がマウスボタンを押し続けている (矩形選択中) 間は格納しない
  if (
    expanded &&
    !inZone &&
    !rendererHoldsPointer &&
    !devHoldOpen &&
    !win.isFocused() &&
    Date.now() - lastExpandedAt > EXPAND_GRACE_MS &&
    cursorOutsideExpandedWindow(cursor)
  ) {
    collapseShelterNow();
  }
}

// Windows 専用の強制格納だけの軽量版。ドッキング中のディスプレイ (dockSpring.display) の
// 座標だけを見るため、pollCursorForEdgeReveal の展開判定 (getDisplayNearestPoint を毎回
// 引き直す) と違ってモニター間の DPI 差でズレることがなく、無限ループの原因にならない
function pollForcedCollapseWindows() {
  if (!winAlive() || !expanded || rendererHoldsPointer || devHoldOpen || win.isFocused()) return;
  if (Date.now() - lastExpandedAt <= EXPAND_GRACE_MS) return;
  if (cursorOutsideExpandedWindow(screen.getCursorScreenPoint())) collapseShelterNow();
}

function startEdgeRevealWatcher() {
  // Windows では「つまみゾーンへの進入で展開する」判定は行わない (DPI の異なるモニター間で
  // 座標系が食い違うと、展開 → 強制格納 → 再展開の無限ループになるため。展開はモニターごとの
  // タブウインドウ (tab.js) のホバーが担う)。ただし展開中に Renderer の mouseleave を
  // 取りこぼす (マウスの高速移動) と閉じなくなるため、強制格納の安全網だけは別途動かす
  if (IS_WINDOWS) {
    setInterval(pollForcedCollapseWindows, EDGE_POLL_MS);
    return;
  }
  // 起動時点で既にゾーン内に居た場合は「進入済み」として扱い、勝手に開かないようにする
  const cursor = screen.getCursorScreenPoint();
  if (cursorInTabZone(cursor, screen.getDisplayNearestPoint(cursor))) tabZoneEnteredAt = Infinity;
  setInterval(pollCursorForEdgeReveal, EDGE_POLL_MS);
}

// ---- 多重起動防止 ----
// Windows/Linux では bridge:// が第2インスタンスの argv に届くため必須。
// app.quit() は非同期のため、ロックが取れなかった場合はフラグで起動処理全体を止め、
// 第2インスタンスがウインドウ生成・各種ウォッチャー・同期サーバー (ポート 9095) を
// 一瞬でも動かさないようにする
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.log('Bridge は既に起動しています (このインスタンスは終了します)');
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
      placeOnCursorDisplay(false);
      expandShelter({ focus: true });
    }
  });
  // 右クリック (Windows は左クリックでも) でメニュー。常駐アプリなので終了手段は必ずここに置く
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: expanded ? 'Bridge を隠す' : 'Bridge を表示',
      accelerator: toggleShortcut,
      click: () => {
        if (!winAlive()) return;
        if (!expanded) placeOnCursorDisplay(false);
        toggleShelter();
      },
    },
    { type: 'separator' },
    {
      label: 'クリップボードの監視を一時停止',
      type: 'checkbox',
      checked: clipboardPaused,
      click: (item) => setClipboardPaused(item.checked),
    },
    {
      label: 'ほかのデバイスとの同期を一時停止',
      type: 'checkbox',
      checked: syncPaused,
      click: (item) => setSyncPaused(item.checked),
    },
    { type: 'separator' },
    {
      label: 'ログイン時に起動',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: '設定…',
      click: () => {
        if (!winAlive()) return;
        placeOnCursorDisplay(expanded);
        expandShelter({ focus: true });
        if (canSendToRenderer()) win.webContents.send('open-settings');
      },
    },
    { label: 'アップデートを確認…', click: () => checkForUpdates({ manual: true }) },
    { type: 'separator' },
    { label: 'Bridge を終了', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
  ]);
}

function createWindow() {
  // 起動時は「つまみ」だけ見えている隠れ状態から始める。
  // 初期位置は「現在マウスカーソルがあるディスプレイ」の右端中央に厳密固定する
  // (プライマリ固定にすると、別モニターで作業中の起動時に意図しない画面へ出るため)
  const initialDisplay = currentDisplay();
  const bounds = dockedBoundsForDisplay(initialDisplay, false);
  dockSpring.display = initialDisplay;

  win = new BrowserWindow({
    ...bounds,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    // macOS: NSPanel として生成する。パネルは「アプリを前面化せずにキー入力を受け取る」
    // 補助ウインドウで、Spotlight や絵文字ピッカーと同じ振る舞いになる
    // (クリックしても作業中のアプリが背面に下がらない)
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    // Windows: ツールウインドウにしてタスクバーと Alt+Tab に出さない (常駐パネルとして振る舞う)
    ...(process.platform === 'win32' ? { type: 'toolbar', show: false } : {}),
    skipTaskbar: true,
    title: 'Bridge',
    // Apple ライクなすりガラス背景 (macOS の vibrancy)。
    // sidebar はサイドバー用の明度が高めのマテリアルで、上に半透明のカードを重ねても濁りにくい
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    // Windows 11: Acrylic (すりガラス)。非対応環境では Renderer 側の不透明フォールバックが効く
    backgroundMaterial: 'acrylic',
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
    // まず前回の履歴を復元し、その上に起動中に届いた分を重ねる
    restoreHistoryToRenderer();
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

// ファイル名向けの読みやすい日時 (例: 2026-09-15_14-30-05)。
// コロンは Windows のファイル名で使えないためハイフンで区切る
function readableTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
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

// ダウンロードの上限。これを超える Content-Length / 実転送量は中断する (ディスク保護)
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024;

// http/https の URL を userData/downloads/ にダウンロードしてローカルパスを返す。
// 本文はメモリに載せず createWriteStream へ流す (大きなファイルでも同期の /file と同じ挙動)
async function downloadToLocal(url) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('http/https の URL のみダウンロードできます');
  }

  const res = await net.fetch(url);
  if (!res.ok) {
    throw new Error(`ダウンロード失敗: HTTP ${res.status}`);
  }
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  // Web ページそのもの (HTML) を「ファイル」として保存しても使い道がない。
  // リンクのドロップ先が画像やファイルでなくページだった場合はここで止める
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    throw new Error('Web ページはダウンロードできません (画像やファイルへの直リンクのみ)');
  }
  const declared = Number(res.headers.get('content-length')) || 0;
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error('ファイルが大きすぎます');
  }

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
  if (!path.extname(name) && EXT_BY_MIME[mime]) name += EXT_BY_MIME[mime];

  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, name);

  if (!res.body) {
    await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return { path: dest, name: path.basename(dest) };
  }

  let received = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) cb(new Error('ファイルが大きすぎます'));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(dest));
  } catch (err) {
    await fsp.unlink(dest).catch(() => {}); // 途中まで書いた欠損ファイルは残さない
    throw err;
  }

  return { path: dest, name: path.basename(dest) };
}

ipcMain.handle('download-url', (_event, url) =>
  downloadToLocal(url).catch((err) => {
    logEvent('download', `失敗: ${url} (${err.message})`);
    throw err;
  })
);

// ---- 3. bridge:// URL のパースとリストへの格納 ----

// add-file の送信ペイロード。origin が無ければ自分のデバイスで生まれたファイル (fromDevice: null)、
// あれば他拠点から同期されてきたファイルとして出身デバイス名とプラットフォームを添える
function addFilePayload(filePath, origin, sourceApp) {
  return {
    path: filePath,
    name: path.basename(filePath),
    fromDevice: origin ? origin.fromDevice : null,
    fromPlatform: origin ? origin.fromPlatform : null,
    // 他拠点から届いたものは「送信元でシェルフに置かれた時刻」をそのまま使う (受信時刻にしない)。
    // ローカル生まれ (null) は Renderer 側で Date.now() になる
    timestamp: origin && origin.timestamp ? origin.timestamp : null,
    // 同期中プレースホルダの差し替え用 ID と、フォルダ由来かどうか
    syncId: origin && origin.id ? origin.id : null,
    originKind: origin && origin.originKind ? origin.originKind : null,
    sourceApp: sourceApp || null,
  };
}

// 実体のダウンロードが終わる前に、メタデータだけで「同期中」の行を Renderer に出しておく
const announcedSyncPlaceholders = new Set();

function sendSyncPlaceholder(entry) {
  if (announcedSyncPlaceholders.has(entry.id)) return;
  announcedSyncPlaceholders.add(entry.id);
  const payload = {
    syncId: entry.id,
    kind: entry.type === 'image' ? 'clip-image' : 'file',
    name: entry.originKind === 'folder' && entry.folderName ? entry.folderName : entry.name,
    timestamp: entry.timestamp,
    fromDevice: entry.fromDevice,
    fromPlatform: entry.fromPlatform,
    originKind: entry.originKind || null,
  };
  if (canSendToRenderer()) win.webContents.send('sync-pending', payload);
}

function removeSyncPlaceholder(id) {
  announcedSyncPlaceholders.delete(id);
  if (canSendToRenderer()) win.webContents.send('sync-pending-remove', { syncId: id });
}

function sendFileToRenderer(filePath, origin) {
  const payload = addFilePayload(filePath, origin);
  if (canSendToRenderer()) {
    if (win.isMinimized()) win.restore();
    // show の前にカーソルのあるモニターへ強制配置し、OS の自動復元でモニターを跨ぐのを防ぐ
    placeOnCursorDisplay(expanded);
    win.show();
    expandShelter({ focus: true });
    win.webContents.send('add-file', payload);
  } else {
    pushPending(pendingFiles, payload);
  }
}

// bridge://add?path= で要求されたローカルファイルの追加を、Renderer のトーストで確認してから行う。
// 確認待ちのパスだけを受け付ける (Renderer からの任意パス追加は許さない)
const pendingAddConfirmations = new Set();
const ADD_CONFIRM_TIMEOUT_MS = 15000;

function requestAddConfirmation(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  pendingAddConfirmations.add(filePath);
  setTimeout(() => pendingAddConfirmations.delete(filePath), ADD_CONFIRM_TIMEOUT_MS);
  if (!canSendToRenderer()) return;
  if (win.isMinimized()) win.restore();
  placeOnCursorDisplay(expanded);
  win.show();
  expandShelter({ focus: true });
  win.webContents.send('confirm-add-file', { path: filePath, name: path.basename(filePath) });
}

ipcMain.on('confirm-add-file', (_event, filePath) => {
  if (typeof filePath !== 'string' || !pendingAddConfirmations.has(filePath)) return;
  pendingAddConfirmations.delete(filePath);
  sendFileToRenderer(filePath);
});

// URL でないテキストは .txt として保存してから追加する
async function saveTextAsFile(text) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, `text_${readableTimestamp()}.txt`);
  await fsp.writeFile(dest, text, 'utf8');
  sessionTempFiles.add(dest); // 終了時の残骸掃除の対象として追跡 (snippet/clipboard と同じ扱い)
  return dest;
}

// Renderer でドラッグ選択されたテキストを snippet_[タイムスタンプ].txt として保存する
async function saveSnippetAsFile(text) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, `snippet_${readableTimestamp()}.txt`);
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
      // ローカルパスの取り込みは、Web ページのリンクなどからも発火しうる。
      // 黙って載せる (= 同期で全デバイスへ配る) のではなく、ユーザーに一度確認する
      requestAddConfirmation(filePath);
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
    expandShelter({ focus: true });
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
// 履歴クリックでコピー → Renderer がチェックマークを見せ終えてから即時格納を依頼する
ipcMain.on('shelter-collapse-now', () => collapseShelterNow());
// 矩形選択などでマウスボタンを押し続けている間は、カーソル離脱による強制格納を保留する
ipcMain.on('shelter-hold-pointer', (_event, holding) => {
  rendererHoldsPointer = Boolean(holding);
});

// ---- リスト表示用のファイルアイコン (Finder / Explorer と同じ OS 標準アイコン) ----
// size: 'normal' (32px) だと、Windows は SHGetFileInfo が返す小サイズ側の簡略化された
// アイコン (フォルダなど特に、実際の Explorer が使う大きいサイズの絵と質感が違って見える)
// になりがちなので、'large' (Windows 48px) を要求して高解像度側の絵を取る
//
// Windows のフォルダに限っては、Electron の app.getFileIcon がなぜか本来のフォルダアイコン
// ではなく汎用の「PC」アイコンを返してしまう (実機検証で確認済み。ファイルは正しく取れる)。
// そのため Explorer 自身と同じ SHGetFileInfo を PowerShell 経由で直接呼び、実際にその
// パスが Explorer 上でどう見えるか (既定の黄色いフォルダ、カスタムアイコン設定済みの
// フォルダも含めて) をそのまま取得する
async function getWindowsDirectoryIconDataUrl(dirPath) {
  const tmpPng = path.join(os.tmpdir(), `bridge-dir-icon-${crypto.randomUUID()}.png`);
  try {
    const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace BridgeShell -Name Icons -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct SHFILEINFO {
  public IntPtr hIcon;
  public int iIcon;
  public uint dwAttributes;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
  public string szDisplayName;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
  public string szTypeName;
}
[DllImport("shell32.dll", CharSet = CharSet.Unicode)]
public static extern IntPtr SHGetFileInfo(string pszPath, uint dwFileAttributes, ref SHFILEINFO psfi, uint cbFileInfo, uint uFlags);
[DllImport("user32.dll")]
public static extern bool DestroyIcon(IntPtr hIcon);
'@
$SHGFI_ICON = 0x100
$SHGFI_LARGEICON = 0x0
$fi = New-Object BridgeShell.Icons+SHFILEINFO
$size = [System.Runtime.InteropServices.Marshal]::SizeOf($fi)
[BridgeShell.Icons]::SHGetFileInfo('${dirPath}', 0, [ref]$fi, $size, ($SHGFI_ICON -bor $SHGFI_LARGEICON)) | Out-Null
if ($fi.hIcon -eq [IntPtr]::Zero) { exit 1 }
try {
  $icon = [System.Drawing.Icon]::FromHandle($fi.hIcon)
  $bmp = $icon.ToBitmap()
  $bmp.Save('${tmpPng}', [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
} finally {
  [BridgeShell.Icons]::DestroyIcon($fi.hIcon) | Out-Null
}
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 5000,
      windowsHide: true,
    });
    const buf = await fsp.readFile(tmpPng);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } finally {
    fsp.unlink(tmpPng).catch(() => {});
  }
}

ipcMain.handle('get-file-icon', async (_event, filePath) => {
  if (process.platform === 'win32') {
    try {
      if ((await fsp.stat(filePath)).isDirectory()) {
        return await getWindowsDirectoryIconDataUrl(filePath);
      }
    } catch {
      // ディレクトリ判定・専用取得に失敗した場合は通常のアイコン取得へフォールバック
    }
  }
  // macOS: app.getFileIcon の size:'large' はこの環境で確実に SIGTRAP を起こす
  // (アプリのコードを介さない最小再現スクリプトでも発生。size:'normal' なら問題なし)。
  // Windows 表示品質向上のために 'large' へ変更した経緯があるが、'large' 自体が
  // 危険なので size は常に 'normal' を使う
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
    // Windows Explorer の「種類」列は長音付きの「フォルダー」。macOS Finder は長音なしの「フォルダ」
    if (stat.isDirectory()) return process.platform === 'win32' ? 'フォルダー' : 'フォルダ';
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

// ---- 元ファイルの存在確認 (移動・削除されたファイルの検知) ----
ipcMain.handle('stat-paths', async (_event, paths) => {
  const missing = [];
  if (!Array.isArray(paths)) return missing;
  await Promise.all(
    paths
      .filter((p) => typeof p === 'string')
      .map(async (p) => {
        try {
          await fsp.access(p);
        } catch {
          missing.push(p);
        }
      })
  );
  return missing;
});

// ---- コンテキストメニューのアクション ----
ipcMain.on('reveal-in-finder', (_event, filePath) => {
  if (typeof filePath === 'string' && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});
ipcMain.on('open-file', (_event, filePath) => {
  if (typeof filePath === 'string' && fs.existsSync(filePath)) {
    shell.openPath(filePath).catch((err) => console.error('ファイルを開けません:', filePath, err));
  }
});
// macOS の「アクセシビリティ」設定ペインを開く (自動ペーストの許可用)
ipcMain.on('open-accessibility-settings', () => {
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch(() => {});
  }
});
ipcMain.on('open-external', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  shell.openExternal(url).catch((err) => console.error('リンクを開けません:', url, err));
});
ipcMain.on('clipboard-copy-plain', (_event, text) => {
  if (typeof text !== 'string') return;
  clipboard.writeText(text);
  lastClipText = text; // 自分で書いた分は履歴に載せない
  lastClipFileKey = '';
});

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
// ---- コピー元アプリの取得 (アプリ名 + アイコン。ウインドウタイトルまでは取らない) ----

// アプリバンドル/exe パス → アイコンの data URL のキャッシュ (同じアプリからの連続コピーで
// 毎回ネイティブアイコン抽出をやり直さないため)
const appIconCache = new Map();

// Windows の .exe はレギュラーファイルなので Electron 標準の app.getFileIcon で実アイコンが取れる
async function getExeIconDataUrl(filePath) {
  if (appIconCache.has(filePath)) return appIconCache.get(filePath);
  let dataUrl = null;
  try {
    const img = await app.getFileIcon(filePath, { size: 'normal' });
    if (!img.isEmpty()) dataUrl = img.toDataURL();
  } catch {
    // アイコン抽出失敗時は名前だけのバッジにフォールバック
  }
  appIconCache.set(filePath, dataUrl);
  return dataUrl;
}

// macOS の .app はディレクトリ (バンドル) なため、Electron の app.getFileIcon では
// カスタムアイコンが解決されず汎用の書類アイコンしか返らない。Info.plist の
// CFBundleIconFile が指す .icns を直接 sips で PNG 化して読む (いずれも macOS 標準コマンド)
async function getMacAppIconDataUrl(bundlePath) {
  if (appIconCache.has(bundlePath)) return appIconCache.get(bundlePath);
  let dataUrl = null;
  try {
    const infoPlistBase = path.join(bundlePath, 'Contents', 'Info');
    const { stdout } = await execFileAsync('defaults', ['read', infoPlistBase, 'CFBundleIconFile'], {
      timeout: 2000,
    });
    let iconName = stdout.trim();
    if (!/\.icns$/i.test(iconName)) iconName += '.icns';
    const icnsPath = path.join(bundlePath, 'Contents', 'Resources', iconName);
    const tmpPng = path.join(os.tmpdir(), `bridge-appicon-${crypto.randomUUID()}.png`);
    try {
      await execFileAsync(
        'sips',
        ['-s', 'format', 'png', icnsPath, '--out', tmpPng, '--resampleHeightWidthMax', '64'],
        { timeout: 2000 },
      );
      const buf = await fsp.readFile(tmpPng);
      dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
    } finally {
      fsp.unlink(tmpPng).catch(() => {});
    }
  } catch {
    // Info.plist にアイコン指定が無い/変換失敗時は名前だけのバッジにフォールバック
  }
  appIconCache.set(bundlePath, dataUrl);
  return dataUrl;
}

async function getFrontmostAppMac() {
  const { stdout } = await execFileAsync(
    'osascript',
    ['-e', 'POSIX path of (path to frontmost application)'],
    { timeout: 2000 },
  );
  const bundlePath = stdout.trim().replace(/\/$/, '');
  if (!bundlePath) return null;
  const name = path.basename(bundlePath).replace(/\.app$/i, '');
  const icon = await getMacAppIconDataUrl(bundlePath);
  return { name, icon };
}

// GetForegroundWindow → そのプロセスの exe パスを取得する。ウインドウタイトルは取得しない
const WIN_FRONT_APP_PS = [
  '$hwnd = [Native.Win32]::GetForegroundWindow()',
  '$procId = 0',
  '[Native.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null',
  '(Get-Process -Id $procId).Path',
].join('; ');

async function getFrontmostAppWindows() {
  const exePath = await winShellRun(WIN_FRONT_APP_PS);
  if (!exePath) return null;
  const name = path.basename(exePath).replace(/\.exe$/i, '');
  const icon = await getExeIconDataUrl(exePath);
  return { name, icon };
}

// 直前のクリップボード変更検知からアプリ切り替えが起きていることは稀ではないため、
// あくまでベストエフォート (取得失敗時は null を返し、バッジ無しにフォールバック)
async function getFrontmostApp() {
  if (!showSourceApp) return null;
  try {
    if (process.platform === 'darwin') return await getFrontmostAppMac();
    if (process.platform === 'win32') return await getFrontmostAppWindows();
  } catch (err) {
    console.error('コピー元アプリの取得に失敗:', err);
  }
  return null;
}

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
// 大きな画像でも一定コストで済むよう、ビットマップ全体ではなく等間隔サンプル (最大 256KB) をハッシュする
const IMAGE_HASH_SAMPLE_BYTES = 256 * 1024;
function imageKey(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const hash = crypto.createHash('md5');
  if (bitmap.length <= IMAGE_HASH_SAMPLE_BYTES) {
    hash.update(bitmap);
  } else {
    const stride = Math.ceil(bitmap.length / IMAGE_HASH_SAMPLE_BYTES);
    const sample = Buffer.alloc(Math.ceil(bitmap.length / stride));
    for (let i = 0, j = 0; i < bitmap.length; i += stride, j++) sample[j] = bitmap[i];
    hash.update(sample);
  }
  return `${width}x${height}:${bitmap.length}:${hash.digest('hex')}`;
}

// コピーされた画像は即ファイル化しておく (サムネイル表示とドラッグアウトを既存フローに乗せるため)
async function saveClipboardImage(image) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const dest = reserveDest(dir, `clipboard_${readableTimestamp()}.png`);
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
function addFileQuietly(filePath, origin, sourceApp) {
  const payload = addFilePayload(filePath, origin, sourceApp);
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

// Windows のエクスプローラーで「ファイル自体」がコピーされているか調べ、絶対パスの配列を返す。
// 実機検証の結果、エクスプローラーの Ctrl+C は availableFormats() に text/uri-list を含めるものの
// read/readBuffer で読むと空文字になり (Electron/Chromium 側の Windows 実装の制約)、
// Chromium Web Custom MIME Data・readText・readHTML もすべて空になることを確認した。
// 実体のパスはレガシーな CF_FILENAMEW registered format ("FileNameW") にしか乗らないため、
// これを最優先で読む。ただし CF_FILENAMEW は仕様上 1 ファイル分しか保持できず、Electron から
// CF_HDROP (複数ファイルの本来のフォーマット) を読む手段が無いため、複数選択時も先頭の 1 件だけが
// 取れる制約が残る (ベストエフォート)
let lastFileNameWKey = '';
let lastFileDropList = [];

async function readCopiedFilePathsWindows() {
  let paths = [];
  let fileNameW = '';

  try {
    const buf = clipboard.readBuffer('FileNameW');
    if (buf && buf.length > 0) fileNameW = buf.toString('utf16le').replace(/\u0000+$/, '').trim();
  } catch {
    // フォーマットが無い環境では読み出し自体が失敗するので無視
  }

  if (fileNameW) {
    // CF_FILENAMEW は 1 件しか持てないため、常駐ヘルパーの Get-Clipboard -Format FileDropList で
    // 選択された全ファイルを取る。同じコピーが載り続けている間は前回の結果を使い回す
    if (fileNameW === lastFileNameWKey && lastFileDropList.length > 0) {
      paths = lastFileDropList.slice();
    } else {
      try {
        const out = await winShellRun(
          '$f = Get-Clipboard -Format FileDropList; if ($f) { $f | ForEach-Object { $_.FullName } }'
        );
        paths = out ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
      } catch {
        paths = [];
      }
      if (paths.length === 0) paths = [fileNameW];
      lastFileNameWKey = fileNameW;
      lastFileDropList = paths.slice();
    }
  } else {
    lastFileNameWKey = '';
    lastFileDropList = [];
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

  // プレーンテキストは「テキスト全体がパスだけで構成されている」ときに限ってファイル扱いにする。
  // ターミナルのプロンプト行のように、文中に "C:\..." が含まれるだけのコピーをファイルと誤認しない
  if (paths.length === 0) {
    paths = extractWholeTextPaths(clipboard.readText());
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

async function readCopiedFilePaths() {
  return process.platform === 'win32' ? readCopiedFilePathsWindows() : readCopiedFilePathsMac();
}

// パスワードマネージャー等が「履歴ツールは無視して」と宣言するときに付けるフォーマット。
// macOS: nspasteboard.org の慣習 (1Password / Bitwarden / KeePassXC 等が採用)
// Windows: Windows 10 のクリップボード履歴を除外するための登録フォーマット
const CONCEALED_FORMATS = [
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.TransientType',
  'org.nspasteboard.AutoGeneratedType',
  'ExcludeClipboardContentFromMonitorProcessing',
  'CanIncludeInClipboardHistory', // Windows: 値 0 なら除外だが、付いている時点で「履歴に載せないで」の意図とみなす
];

function clipboardIsConcealed() {
  for (const format of CONCEALED_FORMATS) {
    try {
      if (clipboard.has(format)) return true;
    } catch {
      // 未知のフォーマット名で例外になる環境では「隠されていない」扱い
    }
  }
  return false;
}

// 画像の「変わったかどうか」を、デコードもハッシュもせずに判定するための安価な署名。
// フォーマット一覧 + テキスト + 画像データの長さ (macOS: TIFF / Windows: PNG 形式があればそれ) で、
// 何も変わっていなければ readImage() すら呼ばない (スクリーンショットが載ったまま放置されても CPU を使わない)
function clipboardImageSignature(formats) {
  let length = 0;
  try {
    const buf = clipboard.readBuffer(process.platform === 'darwin' ? 'public.tiff' : 'PNG');
    length = buf ? buf.length : 0;
  } catch {
    length = 0;
  }
  return `${formats.join(',')}|${length}`;
}

// Windows: Snipping Tool (Win+Shift+S) などは PNG 形式を載せないため長さで区別できない。
// その場合は OS のクリップボード連番 (GetClipboardSequenceNumber、変更のたびに増える) を署名にする
async function clipboardImageSignatureAsync(formats) {
  const base = clipboardImageSignature(formats);
  if (process.platform !== 'win32' || !base.endsWith('|0')) return base;
  try {
    const seq = await winShellRun('[Native.Win32]::GetClipboardSequenceNumber()');
    return `${base}|seq:${seq}`;
  } catch {
    return base;
  }
}
let lastImageSignature = '';

// Windows: OS のクリップボード連番 (変更のたびに増える) で「何か変わったか」をまず判定する。
// 変わっていなければその tick は何も読まない。変わっていたら形式一覧に頼らず画像の読み取りも試す
// (Snipping Tool など WinRT 経由のコピーは遅延レンダリングのため形式一覧に image/* が出ないことがある)
let lastClipSequence = null;
let clipRetryTicks = 0; // 連番は変わったのに何も読めなかったとき、数 tick だけ読み直す
let clipSequenceFailureLogged = false; // 「連番が一度も取れない」を毎 tick 書かないための一度きりフラグ

async function readClipboardSequence() {
  if (process.platform !== 'win32') return null;
  try {
    const out = await winShellRun('[Native.Win32]::GetClipboardSequenceNumber()');
    const n = Number(out);
    if (!Number.isFinite(n)) throw new Error(`数値ではない応答: ${JSON.stringify(out)}`);
    clipSequenceFailureLogged = false;
    return n;
  } catch (err) {
    if (!clipSequenceFailureLogged) {
      clipSequenceFailureLogged = true;
      logEvent('winshell', `クリップボード連番の取得に失敗 (以後は従来方式にフォールバック): ${err.message}`);
    }
    return null;
  }
}

async function pollClipboard() {
  if (clipboardPolling) return; // 画像保存中に次のポーリングが重ならないようにする
  clipboardPolling = true;
  try {
    // 「監視を一時停止」中は履歴に載せない。基準値だけ追従させ、再開した瞬間に
    // 停止中にコピーした内容がまとめて載ることを防ぐ
    if (clipboardPaused) {
      lastClipText = clipboard.readText();
      lastClipFileKey = (await readCopiedFilePaths()).join('\n');
      const formats = clipboard.availableFormats();
      lastImageSignature = formats.some((f) => f.startsWith('image/')) ? clipboardImageSignature(formats) : '';
      return;
    }
    // パスワードマネージャー等からの「隠された」コピーは履歴に残さず、同期もしない。
    // 基準値だけ更新して、次に普通のコピーが来たときに正しく差分検知できるようにする
    if (clipboardIsConcealed()) {
      lastClipText = clipboard.readText();
      lastClipFileKey = '';
      lastImageSignature = '';
      return;
    }

    // Windows: 連番が前回と同じで再読み込みの予定も無ければ、この tick は何もしない
    let sequenceChanged = true;
    const seq = await readClipboardSequence();
    if (seq !== null) {
      sequenceChanged = seq !== lastClipSequence;
      if (!sequenceChanged && clipRetryTicks <= 0) return;
      if (sequenceChanged) clipRetryTicks = 0;
      lastClipSequence = seq;
    }

    // ファイル: Finder で ⌘C されたファイルを最優先で検知し、リストへ自動追加する。
    // ファイルコピー時はパス文字列などの付随テキストも載るため、その tick の
    // テキスト/画像判定はスキップして誤検知 (偽のテキスト履歴) を防ぐ。
    // ただし「連番は変わったのに既知のファイルキーと同じ」ときは、そのファイルキー自体が
    // 誤検知 (例: 別アプリのコピーに古い FileNameW が残っている) の可能性があるとみなし、
    // ここで return せず画像判定へ進む (Win+Shift+S 等の取りこぼしを防ぐ保険)
    const copiedFiles = await readCopiedFilePaths();
    if (copiedFiles.length > 0) {
      const key = copiedFiles.join('\n');
      if (key !== lastClipFileKey) {
        lastClipFileKey = key;
        lastClipText = clipboard.readText(); // 付随テキストを履歴に入れない
        const sourceApp = await getFrontmostApp();
        for (const p of copiedFiles) {
          if (fs.existsSync(p)) addFileQuietly(p, null, sourceApp);
        }
        return;
      }
      if (!sequenceChanged) return; // 連番も変わっていないなら本当に何も起きていない
      // 連番だけ変わっている場合は、既知のファイルキーを無視して下へ読み進める
    } else {
      lastClipFileKey = '';
    }

    // テキスト: 前回と異なる非空テキストなら履歴へ。
    // ドラッグアウト用の .txt はここでは作らず、実際にドラッグ / プレビューされたときに
    // 初めて生成する (コピーのたびにディスクへ書かない)
    const text = clipboard.readText();
    if (text !== lastClipText) {
      lastClipText = text;
      if (text && text.trim()) {
        const ts = Date.now();
        // 同期台帳へ登録し、オンラインの他拠点へ即時プッシュする (一時停止中は台帳に載せず、後から手動で送れるだけにする)
        const syncResult = registerLocalSyncEntry({ type: 'text', text, timestamp: ts });
        const entry = {
          type: 'clipboard-text',
          text,
          path: null,
          timestamp: ts,
          fromDevice: deviceName,
          fromPlatform: process.platform,
          sourceApp: await getFrontmostApp(),
          syncEntryId: syncResult ? syncResult.id : null,
          unsynced: Boolean(syncResult && syncResult.unsynced),
        };
        pushClipHistory(entry);
        sendClipboardItem(entry);
      }
    }

    // 画像: 形式チェックを先に行い、画像が無いときの readImage デコードを避ける。
    // Windows で連番が変わった (または読み直し中の) tick は、形式一覧に image/* が無くても
    // readImage を試す (Snipping Tool など遅延レンダリングのコピーは一覧に出ないことがある)
    const formats = clipboard.availableFormats();
    const hasImage = formats.some((f) => f.startsWith('image/'));
    const tryImageAnyway = seq !== null && (sequenceChanged || clipRetryTicks > 0);
    if (hasImage || tryImageAnyway) {
      // 安価な署名が前回と同じなら、デコードもハッシュもせずに終える
      // (連番駆動の Windows では連番そのものが署名になる)
      const signature = seq !== null ? `seq:${seq}` : await clipboardImageSignatureAsync(formats);
      if (signature === lastImageSignature && clipRetryTicks <= 0) return;
      lastImageSignature = signature;

      const image = clipboard.readImage();
      if (image.isEmpty()) {
        if (tryImageAnyway) {
          // 連番は変わったのに何も読めない: 遅延レンダリングが間に合っていない可能性があるので
          // 数 tick だけ読み直す。診断のため、その瞬間に見えていたものを必ずログへ残す
          // (テキストの有無に関わらず出す。ここが原因の切り分けに直結するため)
          if (sequenceChanged && clipRetryTicks <= 0) {
            clipRetryTicks = 4;
            logEvent(
              'clip',
              `連番 ${seq} (変化検知) だが画像を読めず。形式=[${formats.join(', ')}] text="${(text || '').slice(0, 40)}" files=${copiedFiles.length} (4 tick 再試行)`
            );
          } else {
            clipRetryTicks -= 1;
          }
        }
      } else {
        clipRetryTicks = 0;
        const key = imageKey(image);
        if (key !== lastClipImageKey) {
          lastClipImageKey = key;
          const savedPath = await saveClipboardImage(image);
          const ts = Date.now();
          // 同期台帳へ登録し、オンラインの他拠点へ即時プッシュする (実体 PNG は /file で配信。
          // 一時停止中は台帳に載せず、後から手動で送れるだけにする)
          const syncResult = registerLocalSyncEntry({
            type: 'image',
            name: path.basename(savedPath),
            path: savedPath,
            timestamp: ts,
          });
          const entry = {
            type: 'clipboard-image',
            text: null,
            path: savedPath,
            timestamp: ts,
            fromDevice: deviceName,
            fromPlatform: process.platform,
            sourceApp: await getFrontmostApp(),
            syncEntryId: syncResult ? syncResult.id : null,
            unsynced: Boolean(syncResult && syncResult.unsynced),
          };
          pushClipHistory(entry);
          sendClipboardItem(entry);
        }
      }
    } else {
      lastClipImageKey = '';
      lastImageSignature = '';
    }
  } catch (err) {
    // console.error はパッケージ版だとどこにも表示されず消えてしまうため、必ず bridge.log にも残す
    console.error('クリップボード監視に失敗:', err);
    logEvent('clip', `監視 tick が例外で失敗: ${err && err.message}`);
  } finally {
    clipboardPolling = false;
  }
}

async function startClipboardWatcher() {
  // 起動時点でクリップボードに入っている内容は履歴に入れない (基準値として記録するだけ)。
  // 初期読み取りが環境依存で失敗しても、監視の定期実行そのものは必ず開始する
  try {
    lastClipText = clipboard.readText();
    const formats = clipboard.availableFormats();
    if (formats.some((f) => f.startsWith('image/'))) {
      lastImageSignature = clipboardImageSignature(formats);
      const image = clipboard.readImage();
      lastClipImageKey = image.isEmpty() ? '' : imageKey(image);
    }
    lastClipFileKey = (await readCopiedFilePaths()).join('\n');
  } catch (err) {
    console.error('クリップボードの初期読み取りに失敗:', err);
  }
  setInterval(pollClipboard, CLIPBOARD_POLL_MS);
}

// ---- クリップボード履歴の再利用 (クリックでコピー & 自動格納) ----

function writeTextToClipboard(text) {
  clipboard.writeText(text); // 生のテキストデータを OS に書き戻す → 即ペースト可能
  lastClipText = text; // 自分で書き戻した分は監視でスルーする
  lastClipFileKey = '';
  lastImageSignature = '';
}

ipcMain.on('clipboard-write-text', (_event, text) => {
  if (typeof text === 'string') writeTextToClipboard(text);
});

// Windows のクリップボードへ「本物のファイル」として書き込む (CF_HDROP)。
// Electron の clipboard.writeBuffer は RegisterClipboardFormat 経由の独自フォーマット専用で、
// CF_HDROP のような定義済み ID には効かないため直接は書けない。.NET の
// Clipboard.SetFileDropList が正しく CF_HDROP を組み立ててくれる PowerShell の
// Set-Clipboard -LiteralPath を経由することで、チャットアプリ等での Ctrl+V に
// 実ファイル添付として乗るようにする
function writeFilesToWindowsClipboard(paths) {
  const psLiteral = (s) => `'${s.replace(/'/g, "''")}'`;
  return winShellRun(`Set-Clipboard -LiteralPath @(${paths.map(psLiteral).join(',')})`);
}

// パスを OS の「ファイル形式」でクリップボードへ。
// mac: public.file-url / Windows: CF_HDROP。それぞれ ⌘V・Ctrl+V で本物のファイルとして複製・ペーストされる
async function writeFileToClipboard(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  if (process.platform === 'win32') {
    try {
      await writeFilesToWindowsClipboard([filePath]);
    } catch (err) {
      console.error('Windows クリップボードへのファイル書き込みに失敗:', err);
      return false;
    }
  } else {
    clipboard.writeBuffer('public.file-url', Buffer.from(pathToFileURL(filePath).toString(), 'utf8'));
  }
  // 自分で書き戻した分は監視でスルーする (基準値を書き戻し後の状態に合わせる)
  lastClipFileKey = filePath;
  lastClipText = clipboard.readText();
  lastClipImageKey = '';
  lastImageSignature = '';
  return true;
}

ipcMain.on('clipboard-write-file', (_event, filePath) => {
  writeFileToClipboard(filePath);
});

function writeImageToClipboard(filePath) {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return false;
  clipboard.writeImage(image);
  // 書き戻し後のクリップボードを読み直して基準値にする (エンコード差分による再検知を防ぐ)
  const readBack = clipboard.readImage();
  lastClipImageKey = readBack.isEmpty() ? '' : imageKey(readBack);
  const formats = clipboard.availableFormats();
  lastImageSignature = formats.some((f) => f.startsWith('image/')) ? clipboardImageSignature(formats) : '';
  lastClipText = clipboard.readText();
  lastClipFileKey = '';
  return true;
}

ipcMain.on('clipboard-write-image', (_event, filePath) => {
  if (typeof filePath === 'string') writeImageToClipboard(filePath);
});

// テキスト履歴の実体ファイルは遅延生成: 既に作ってあればそれを、無ければその場で snippet_*.txt を書く
async function ensureSnippetFile(payload) {
  let dest = payload && payload.path;
  if (dest && fs.existsSync(dest)) return dest;
  const text = payload && payload.text;
  if (!text) return null;
  return saveSnippetAsFile(text);
}

ipcMain.handle('ensure-clipboard-text-file', (_event, payload) => ensureSnippetFile(payload));

ipcMain.handle('drag-clipboard-text', async (event, payload) => {
  try {
    const dest = await ensureSnippetFile(payload);
    if (!dest) return null;
    const icon = await app.getFileIcon(dest);
    event.sender.startDrag({ files: [dest], icon });
    return dest;
  } catch (err) {
    console.error('クリップボードテキストのドラッグアウトに失敗:', err);
    return null;
  }
});

// 裏生成物 (ファイル、または展開したフォルダ) を消す。sessionTempFiles にあるものにしか使わない
function removeTempPathSync(p) {
  try {
    const stat = fs.lstatSync(p);
    if (stat.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
  } catch {
    // 既に無い・アクセス不可などは無視 (掃除が目的なので失敗しても続行)
  }
}

// ---- 履歴の永続化 (userData/history.json) ----
// 表示リストの真実は Renderer が持つため、Renderer から届いた「保存用の一覧」をそのまま書く。
// 裏生成ファイルの追跡 (sessionTempFiles) も一緒に保存し、再起動後も上限あふれ時の削除対象にする

function historyPath() {
  return path.join(app.getPath('userData'), 'history.json');
}

let latestHistoryPayload = null; // Renderer から最後に届いた一覧 (クラッシュ復帰・終了時の書き出しに使う)
let historyWriteTimer = null;

function historyFileContents() {
  return JSON.stringify({
    version: 1,
    savedAt: Date.now(),
    items: latestHistoryPayload ? latestHistoryPayload.items : [],
    tempFiles: [...sessionTempFiles],
  });
}

// 書き込みは一時ファイル + rename で原子的に行い、途中でプロセスが落ちても壊れた JSON を残さない
function writeHistoryNow() {
  historyWriteTimer = null;
  if (!latestHistoryPayload) return;
  const dest = historyPath();
  const tmp = `${dest}.tmp`;
  try {
    fs.writeFileSync(tmp, historyFileContents());
    fs.renameSync(tmp, dest);
  } catch (err) {
    console.error('履歴の保存に失敗:', err);
  }
}

function scheduleHistoryWrite() {
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  historyWriteTimer = setTimeout(writeHistoryNow, 500);
}

ipcMain.on('persist-items', (_event, payload) => {
  if (!payload || !Array.isArray(payload.items)) return;
  latestHistoryPayload = { items: payload.items };
  scheduleHistoryWrite();
});

function readHistoryFromDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(historyPath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      tempFiles: Array.isArray(parsed.tempFiles) ? parsed.tempFiles.filter((p) => typeof p === 'string') : [],
    };
  } catch {
    return null; // 初回起動・壊れている場合は空から始める
  }
}

// 前回の終了 (またはクラッシュ) 時点の一覧を Renderer へ流し込む。
// 同じセッション内の Renderer 再起動なら、ディスクではなくメモリ上の最新一覧から復元する
function restoreHistoryToRenderer() {
  let items;
  if (latestHistoryPayload) {
    items = latestHistoryPayload.items;
  } else {
    const disk = readHistoryFromDisk();
    if (!disk) return;
    items = disk.items;
    for (const p of disk.tempFiles) {
      if (fs.existsSync(p)) sessionTempFiles.add(p);
    }
    sweepOrphanTempFiles(new Set([...disk.tempFiles, ...items.map((it) => it.path).filter(Boolean)]));
  }
  if (items.length > 0 && canSendToRenderer()) win.webContents.send('restore-items', items);
}

// 前回クラッシュ等で履歴に残らなかった裏生成ファイル (clipboard_*.png / snippet_*.txt / text_*.txt) を起動時に片付ける。
// ユーザーがドロップした実ファイルや Web ダウンロードはこの命名ではないため対象にならない
function sweepOrphanTempFiles(keep) {
  let names;
  try {
    names = fs.readdirSync(downloadDir());
  } catch {
    return;
  }
  // 各プレフィックスとも、新形式 (日時) と旧形式 (epoch ミリ秒 / text- ハイフン区切り、更新前に作られた残骸) の両方を対象にする
  const DATE_PART = '\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}';
  const ORPHAN_RE = new RegExp(
    `^(clipboard_(${DATE_PART}|\\d+)|snippet_(${DATE_PART}|\\d+)|text[_-](${DATE_PART}|\\d+))(-\\d+)?\\.(png|txt)$`
  );
  for (const name of names) {
    if (!ORPHAN_RE.test(name)) continue;
    const full = path.join(downloadDir(), name);
    if (keep.has(full)) continue;
    try {
      fs.unlinkSync(full);
    } catch {
      // 消せなくても続行
    }
  }
}

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
  removeTempPathSync(filePath); // 用済みの実体を即時に完全削除し、ストレージの圧迫を防ぐ
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
  // シングルインスタンスロック失敗時など、app.whenReady() より前に quit() が
  // 呼ばれるケースがある。ready 前は globalShortcut 等の API が使えず例外になるため、
  // その場合はここで早期リターンする (未登録なので unregisterAll 等はそもそも不要)
  if (!app.isReady()) return;
  globalShortcut.unregisterAll();
  if (popupAlive()) popupWin.destroy();
  for (const tab of tabWindows.values()) {
    if (!tab.isDestroyed()) tab.destroy();
  }
  if (winShell.proc) winShell.proc.kill();
  // 最後の一覧を必ず書き出してから、リストに残っていない裏生成ファイルを掃除する
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  for (const p of sessionTempFiles) {
    if (retainedPaths.has(p)) continue;
    removeTempPathSync(p);
  }
  for (const p of [...sessionTempFiles]) {
    if (!retainedPaths.has(p)) sessionTempFiles.delete(p);
  }
  writeHistoryNow();
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

// デバイスアイコンの許容バリエーション。sync-config.json の iconType として受け取り、
// 同期ペイロードでピア間に伝播する (未設定・未知の値はフォールバック枠を表示させる)
const ALLOWED_ICON_TYPES = ['win_laptop', 'macbook', 'win_desktop'];
let myIconType = null;

const DEFAULT_SYNC_PORT = 9095;
const SYNC_POLL_MS = 20 * 1000; // 既知ピアへの差分ポーリング間隔 (再接続の自動検知を兼ねる)
const PROBE_TIMEOUT_MS = 800;
const SYNC_BODY_LIMIT = 10 * 1024 * 1024;
const MAX_SYNC_STORE = 500;

// 同期通信の認証トークンを載せる HTTP ヘッダー名 (サーバー・クライアント共通)
const SYNC_TOKEN_HEADER = 'x-bridge-token';

let syncConfig = { port: DEFAULT_SYNC_PORT, peers: [], autoScan: true, secretToken: null, disabledPeers: [] };

// secretToken から導出した暗号鍵。同期ごとに引き伸ばし直すと重いので、
// トークンが変わったとき (設定画面からの変更を含む) だけ再計算してキャッシュする
let cachedSyncKey = null;
let cachedSyncKeyToken = null;
function syncKey() {
  if (cachedSyncKeyToken !== syncConfig.secretToken) {
    cachedSyncKey = deriveSyncKey(syncConfig.secretToken);
    cachedSyncKeyToken = syncConfig.secretToken;
  }
  return cachedSyncKey;
}

// 同期台帳: 自分が生成したアイテムと他拠点から受信したアイテムの両方を持ち、
// 3 台以上のメッシュ構成でも任意の 2 台が到達可能でさえあれば全体が収束するよう中継役も担う。
// { id, type: 'text' | 'image' | 'file', name, text, path, timestamp, fromDevice, fromPlatform }
const syncStore = [];
const seenSyncIds = new Set(); // id による重複同期・循環中継の防止
const registeredSyncPaths = new Set(); // 同じローカルファイルの二重登録防止

// 同期が一時停止中に生まれたアイテム。台帳には載せず (自動では絶対に同期しない)、
// 右クリックの「同期する」で明示的に選んだときだけここから取り出して送る
const pendingManualSyncEntries = new Map();

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
      // "host:port" 単位でこのデバイスとの同期を止めたいピアの一覧 (送受信とも止める)
      disabledPeers: Array.isArray(parsed.disabledPeers) ? parsed.disabledPeers.filter((p) => typeof p === 'string') : [],
    };
    // myDeviceName が指定されていれば、設定画面なしに JSON 編集だけで表示名を短縮できるようにする
    if (typeof parsed.myDeviceName === 'string' && parsed.myDeviceName.trim()) {
      deviceName = parsed.myDeviceName.trim();
    }
    // iconType: 自端末のハードウェアアイコン種別。未知の値は無視してフォールバックに委ねる
    if (typeof parsed.iconType === 'string' && ALLOWED_ICON_TYPES.includes(parsed.iconType)) {
      myIconType = parsed.iconType;
    }
    if (typeof parsed.autoPaste === 'boolean') autoPasteEnabled = parsed.autoPaste;
    if (typeof parsed.showSourceApp === 'boolean') showSourceApp = parsed.showSourceApp;
    if (typeof parsed.toggleShortcut === 'string' && parsed.toggleShortcut.trim()) toggleShortcut = parsed.toggleShortcut.trim();
    if (typeof parsed.pasteShortcut === 'string' && parsed.pasteShortcut.trim()) pasteShortcut = parsed.pasteShortcut.trim();
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

// パスがフォルダかどうかの安全判定 (存在しない・stat 失敗は「フォルダではない」扱い)
function isDirectorySafe(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// 自分のデバイスで生まれたアイテムを台帳へ登録し、オンラインのピアへ即時プッシュする
function registerLocalSyncEntry({ type, name, text, path: filePath, timestamp, originKind, folderName }) {
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
    originKind: originKind || null, // 'folder' = フォルダを zip 化したもの (受信側で戻す)
    folderName: folderName || null,
  };
  rememberSyncId(entry.id);
  if (syncPaused) {
    // 一時停止中に生まれたアイテムは自動では同期しない (再開しても、である)。
    // ただし後から明示的に選べば送れるよう、台帳には載せずここに退避しておく
    pendingManualSyncEntries.set(entry.id, entry);
    return { ...entry, unsynced: true };
  }
  pushSyncEntry(entry);
  pushEntriesToPeers([entry]);
  return entry;
}

// 「同期する」で 1 件だけ後から手動で送る。呼び直しても安全 (既に送信済み/存在しない id は無視)
function syncPendingEntryNow(id) {
  const entry = pendingManualSyncEntries.get(id);
  if (!entry) return false;
  pendingManualSyncEntries.delete(id);
  pushSyncEntry(entry);
  pushEntriesToPeers([entry]);
  logEvent('sync', `手動同期: ${entry.name || (entry.text || '').slice(0, 30) || entry.id}`);
  return true;
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
      enabled: !syncConfig.disabledPeers.includes(key), // このデバイスとの送受信を止めているか
      lastSyncedTs: 0,
      lastSyncedAt: 0, // 最後にポーリング / 受信が成功した時刻 (ローカル時計)
      lastError: null, // 最後の失敗理由 (設定シートの診断表示用)
      syncing: false,
    };
    knownPeers.set(key, peer);
    logEvent('peer', `発見: ${device || '(名前未取得)'} ${key}`);
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
            resolve(decryptJson(syncKey(), body));
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
    const body = encryptJson(syncKey(), payload);
    const req = http.request(
      {
        host,
        port,
        path: pathName,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/octet-stream',
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
// ピアの /file?id= から実体ファイルをローカルの一時保存フォルダへバックグラウンド転送する。
// 一括読み込みせず createWriteStream へパイプするため、数 GB のファイルでもメモリを圧迫しない
// 進行中のダウンロード (id → { req, out, dest, total, received, startedAt })。
// キャンセルボタンと進捗表示の両方がここを参照する
const activeSyncDownloads = new Map();
// ユーザーが「やめる」を押した id。自動ポーリングはここに載っている間は再試行しない
// (再試行したければ「もう一度試す」で明示的に外す)
const cancelledSyncIds = new Set();
// キャンセル・再試行に使うため、実体をまだ取り込んでいないエントリを id で覚えておく
const pendingSyncEntries = new Map(); // id → { entry, peer }

// activeSyncDownloads の変更は必ずこの2つを通す。パネルを開かなくても
// メニューバーだけで転送中か分かるようにする (updateTrayActivity) のを漏らさないため
function trackDownload(id, record) {
  activeSyncDownloads.set(id, record);
  updateTrayActivity();
}

function untrackDownload(id) {
  activeSyncDownloads.delete(id);
  updateTrayActivity();
}

// ---- メニューバーの「転送中」表示 ----
// AirDrop や OneDrive のトレイアイコンと同じく、パネルを開かなくても大きい転送の
// 進み具合が分かるようにする。Template アイコン自体は色を持てない (§ createTray) ので、
// macOS はアイコン横のタイトル文字 (setTitle) に % を出し、Windows はネイティブの
// OneDrive 等と同じくツールチップに進捗を出す (Windows のトレイに横並びテキストは無いため)
function updateTrayActivity() {
  if (!tray) return;
  const active = [...activeSyncDownloads.values()];
  if (active.length === 0) {
    // 転送中でなければ、一時停止中かどうかをここに出す (開かなくても気づけるように)
    if (clipboardPaused || syncPaused) {
      const label = clipboardPaused && syncPaused ? '監視と同期を停止中' : clipboardPaused ? '監視を停止中' : '同期を停止中';
      if (process.platform === 'darwin') tray.setTitle('⏸');
      tray.setToolTip(`Bridge — ${label}`);
    } else {
      if (process.platform === 'darwin') tray.setTitle('');
      tray.setToolTip('Bridge');
    }
    return;
  }
  // 母数が分かっているものの中で一番進んでいない値を代表にする
  // (「一番待たされているもの」が終われば全部終わる、という体感に合わせる)
  const withTotal = active.filter((r) => r.total > 0);
  const pct = withTotal.length > 0 ? Math.min(...withTotal.map((r) => Math.round((r.received / r.total) * 100))) : null;
  const label = pct === null ? '…' : `${pct}%`;
  const tooltip = active.length > 1 ? `Bridge — ${active.length} 件転送中` : `Bridge — 転送中 ${label}`;
  if (process.platform === 'darwin') tray.setTitle(`↓${label}`);
  tray.setToolTip(tooltip);
}

const PROGRESS_THROTTLE_MS = 300;
// 巨大な転送が遅いとき、最後の平均速度だけでは「途中で遅くなったのか」「最初から
// ずっと遅かったのか」を切り分けられない。10 秒おきに瞬間速度を残すことで、
// 次に遅い転送が起きたときに bridge.log だけで原因の当たりが付けられるようにする
const SYNC_SPEED_SAMPLE_MS = 10 * 1000;

function sendSyncProgress(id, received, total) {
  if (canSendToRenderer()) win.webContents.send('sync-progress', { syncId: id, received, total });
  updateTrayActivity(); // 進捗が動くたびメニューバーの % も追従させる (受信中の record.received 更新分もここで拾う)
}

function downloadEntryFile(peer, entry) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    if (cancelledSyncIds.has(entry.id)) {
      const err = new Error('キャンセルされました');
      err.cancelled = true;
      reject(err);
      return;
    }
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
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          return reject(err);
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
        const total = Number(res.headers['content-length']) || 0;
        const record = { req, out, dest, total, received: 0, startedAt };
        trackDownload(entry.id, record);
        sendSyncProgress(entry.id, 0, total); // ヘッダーが届いた時点でサイズが分かるので、0% でもすぐ知らせる

        // ファイル本体は暗号化されて流れてくる (x-bridge-salt がストリーム毎のノンス起点)。
        // 復号ストリームを res と out の間に挟み、tag 不一致 (改ざん・破損) はエラーとして
        // 既存の fail() 経路 (欠損ファイル削除・次回再試行) にそのまま乗せる
        const decryptStream = createDecryptStream(syncKey(), res.headers['x-bridge-salt']);

        // 転送途中のネットワークエラーやソケットハングアップでは、両側のストリームを
        // 確実に閉じて欠損ファイルを削除する。reject は次回ポーリングでの再試行につながる
        let settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          untrackDownload(entry.id);
          out.destroy();
          res.destroy();
          decryptStream.destroy();
          fsp.unlink(dest).catch(() => {});
          reject(err);
        };
        let lastProgressSentAt = 0;
        let lastSampleAt = startedAt;
        let lastSampleReceived = 0;
        res.on('data', (chunk) => {
          record.received += chunk.length;
          const now = Date.now();
          if (now - lastProgressSentAt >= PROGRESS_THROTTLE_MS) {
            lastProgressSentAt = now;
            sendSyncProgress(entry.id, record.received, total);
          }
          if (now - lastSampleAt >= SYNC_SPEED_SAMPLE_MS) {
            const dt = (now - lastSampleAt) / 1000;
            const instantMbps = (dt > 0 ? (record.received - lastSampleReceived) / 1048576 / dt : 0).toFixed(1);
            const pct = total > 0 ? Math.round((record.received / total) * 100) : '?';
            logEvent(
              'sync',
              `受信中: ${entry.name} ${pct}% (瞬間速度 ${instantMbps}MB/s) from ${peer.device || peer.host}`
            );
            lastSampleAt = now;
            lastSampleReceived = record.received;
          }
        });
        res.pipe(decryptStream).pipe(out);
        out.on('finish', () => {
          if (settled) return;
          settled = true;
          untrackDownload(entry.id);
          sessionTempFiles.add(dest); // 同期コピーも終了時クリーンアップの対象として追跡
          sendSyncProgress(entry.id, record.received, total || record.received);
          const seconds = (Date.now() - startedAt) / 1000;
          const mbps = seconds > 0 ? (record.received / 1048576 / seconds).toFixed(1) : '?';
          logEvent(
            'sync',
            `受信: ${entry.name} (${Math.round(record.received / 1048576)}MB, ${seconds.toFixed(1)}s, ${mbps}MB/s) from ${peer.device || peer.host}`
          );
          resolve(dest);
        });
        out.on('error', fail);
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('socket hang up')));
        decryptStream.on('error', fail);
      }
    );
    // ヘッダー到着前でもキャンセルできるよう、reject 前に record を持たない段階から追跡する
    trackDownload(entry.id, { req, out: null, dest: null, total: 0, received: 0, startedAt });
    req.on('timeout', () => req.destroy(new Error('タイムアウトしました (応答なし)')));
    req.on('error', (err) => {
      untrackDownload(entry.id);
      reject(err);
    });
  });
}

// ダウンロード完了後の共通の取り込み処理 (フォルダ展開・台帳登録・Renderer への通知・中継)。
// importRemoteEntry の通常経路と、ユーザーの「もう一度試す」操作の両方から呼ぶ
async function finalizeIncomingEntry(entry, meta) {
  if (entry.originKind === 'folder') {
    const extracted = await extractFolderZipIfSmall(entry.path, entry.folderName || entry.name);
    if (extracted) entry.path = extracted;
  }
  rememberSyncId(entry.id);
  announcedSyncPlaceholders.delete(entry.id);
  pendingSyncEntries.delete(entry.id);
  pushSyncEntry(entry); // ローカルパス付きで台帳に載せ、さらに別のピアへも中継できるようにする
  if ((meta ? meta.type : entry.type) === 'image') {
    sendClipboardItem({
      type: 'clipboard-image',
      text: null,
      path: entry.path,
      timestamp: entry.timestamp,
      fromDevice: entry.fromDevice,
      fromPlatform: entry.fromPlatform,
      syncId: entry.id,
    });
  } else {
    addFileQuietly(entry.path, entry);
  }
  // 3 台以上の構成で、送信元と直接つながっていないピアにも届くよう中継プッシュする
  pushEntriesToPeers([entry]);
}

// ---- キャンセル・再試行 (「同期中」の行から呼ばれる) ----

// 実行中のダウンロードがあれば止め、欠損ファイルを消す (キャンセル・再試行の両方から使う共通処理)
function abortActiveDownload(id) {
  const rec = activeSyncDownloads.get(id);
  if (!rec) return;
  untrackDownload(id);
  try {
    rec.req.destroy();
  } catch {
    // 既に閉じていれば無視
  }
  if (rec.out) rec.out.destroy();
  if (rec.dest) fsp.unlink(rec.dest).catch(() => {});
}

// ダウンロードを中断し、欠損ファイルを消し、行を取り下げる。以後の自動ポーリングでも
// 「もう一度試す」まではこの id を再試行しない (無限に失敗し続けて帯域を食うのを防ぐ)
ipcMain.on('cancel-sync-download', (_event, id) => {
  if (typeof id !== 'string') return;
  cancelledSyncIds.add(id);
  abortActiveDownload(id);
  removeSyncPlaceholder(id);
  const pending = pendingSyncEntries.get(id);
  logEvent('sync', `ユーザーが同期を中止: ${pending ? pending.entry.name : id}`);
});

// 「もう一度試す」。キャンセル済みフラグを外し、そのピアへ直接もう一度ファイルを取りに行く
// (差分ポーリングの /items からではなく、既知の id で /file を直接叩くので即座に始まる)
ipcMain.handle('retry-sync-download', async (_event, id) => {
  if (typeof id !== 'string') return false;
  cancelledSyncIds.delete(id);
  const pending = pendingSyncEntries.get(id);
  if (!pending) return false;
  const { entry, peer } = pending;
  abortActiveDownload(id); // 「止まっているが実は生きている」古い接続を残さない
  sendSyncPlaceholder(entry); // 既に消えている行を出し直す (キャンセル後の再試行のため)
  try {
    entry.path = await downloadEntryFile(peer, entry);
  } catch (err) {
    if (err && err.statusCode === 404) {
      logEvent('sync', `実体なしでスキップ: ${entry.name} from ${peer.device || peer.host}`);
      rememberSyncId(entry.id);
      pendingSyncEntries.delete(id);
      removeSyncPlaceholder(id);
      return false;
    }
    logEvent('sync', `再試行に失敗: ${entry.name} (${err.message})`);
    return false;
  }
  await finalizeIncomingEntry(entry, entry);
  return true;
});

// ---- 受信アイテムの取り込み ----

// ---- 受信アイテムの取り込み ----

// 成功 (または取り込み不要) なら true。ファイル転送に失敗したときだけ false を返し、
// seenSyncIds に入れずに次回の差分ポーリングで再試行できるようにする
async function importRemoteEntry(meta, peer) {
  if (!meta || typeof meta.id !== 'string') return true;
  if (seenSyncIds.has(meta.id) || meta.fromDevice === deviceName) return true; // 重複・自分発は無視
  // ユーザーが明示的に中止した項目は、「もう一度試す」が押されるまで自動では再試行しない
  if (cancelledSyncIds.has(meta.id)) return true;

  const entry = {
    id: meta.id,
    type: meta.type,
    name: meta.name || null,
    text: meta.type === 'text' ? meta.text || '' : null,
    path: null,
    timestamp: Number(meta.timestamp) || Date.now(),
    fromDevice: meta.fromDevice || peer.device || peer.host,
    fromPlatform: meta.fromPlatform || null,
    originKind: meta.originKind === 'folder' ? 'folder' : null,
    folderName: typeof meta.folderName === 'string' ? meta.folderName : null,
  };

  if (meta.type === 'text') {
    rememberSyncId(entry.id);
    if (!entry.text.trim()) return true;
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
    // メタデータは実体より先に届いているので、まず「同期中」の行を出す (名前・時刻・出身は確定済み)。
    // キャンセル・再試行のために、どのピアからどのエントリを取っているかも覚えておく
    sendSyncPlaceholder(entry);
    pendingSyncEntries.set(entry.id, { entry, peer });
    try {
      entry.path = await downloadEntryFile(peer, entry);
    } catch (err) {
      if (err && err.cancelled) return true; // ユーザーが中止済み。この場でこれ以上は何もしない
      // 相手側で実体が既に消えている (404) なら、待っても届かない。既読にして先へ進む
      // (ここで false を返し続けると lastSyncedTs が進まず、以後の新着まで全部止まってしまう)
      if (err && err.statusCode === 404) {
        logEvent('sync', `実体なしでスキップ: ${entry.name} from ${peer.device || peer.host}`);
        rememberSyncId(entry.id);
        pendingSyncEntries.delete(entry.id);
        removeSyncPlaceholder(entry.id);
        return true;
      }
      console.error('同期ファイルの転送に失敗 (次回ポーリングで再試行):', entry.name, err.message);
      logEvent('sync', `受信失敗: ${entry.name} from ${peer.device || peer.host} (${err.message})`);
      return false; // プレースホルダは残し、次回のポーリングで続きから
    }
    await finalizeIncomingEntry(entry, meta);
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
    if (!peer.online) logEvent('peer', `オンライン: ${peer.device || peer.host}`);
    peer.online = true;
    peer.lastSyncedAt = Date.now();
    peer.lastError = null;
    if (data.device) peer.device = data.device;
    if (data.iconType) peer.iconType = data.iconType;
    // lastSyncedTs は「ピア側の時計で付いたタイムスタンプ」の最大値なので、
    // デバイス間の時計ズレがあっても差分の取りこぼしは起きない
    const sorted = data.items.slice().sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    for (const meta of sorted) {
      const ok = await importRemoteEntry(meta, peer);
      if (!ok) {
        peer.lastError = `ファイル転送に失敗: ${meta.name || meta.id}`;
        break; // 転送失敗地点で止め、タイムスタンプを進めず次回に再取得する
      }
      peer.lastSyncedTs = Math.max(peer.lastSyncedTs, Number(meta.timestamp) || 0);
    }
  } catch (err) {
    if (peer.online) logEvent('peer', `オフライン: ${peer.device || peer.host} (${err && err.message})`);
    peer.online = false; // 外出中などで到達不能。lastSyncedTs は保持し、再接続時に差分だけ取り込む
    peer.lastError = err && err.message === 'HTTP 401' ? '同期キーが一致しません' : err && err.message ? err.message : '到達できません';
  } finally {
    peer.syncing = false;
  }
}

function pollAllPeers() {
  if (syncPaused) return;
  for (const peer of knownPeers.values()) {
    if (!peer.enabled) continue; // このデバイスとの同期を止めている相手はポーリングも行わない
    pollPeer(peer);
  }
}

// 新着アイテムが発生した瞬間、オンラインの全ピアへメタデータを即時プッシュする
function pushEntriesToPeers(entries) {
  if (syncPaused || entries.length === 0 || knownPeers.size === 0) return;
  const payload = {
    app: 'bridge',
    device: deviceName,
    platform: process.platform,
    port: syncConfig.port,
    iconType: myIconType,
    items: entries.map(syncMetadata),
  };
  for (const peer of knownPeers.values()) {
    if (!peer.enabled) continue; // このデバイスとの同期を止めている相手には送らない
    if (!peer.online) continue; // オフラインのピアへは再接続後の差分ポーリングで届く
    httpPostJson(peer.host, peer.port, '/push', payload).catch((err) => {
      if (peer.online) logEvent('peer', `プッシュ失敗: ${peer.device || peer.host} (${err && err.message})`);
      peer.online = false;
      peer.lastError = err && err.message ? err.message : 'プッシュに失敗';
    });
  }
}

// ---- 同期サーバー (node:http、外部パッケージ不使用) ----

// メタデータ (JSON) は secretToken 由来の鍵で暗号化してから返す。平文 HTTP でも
// 通信内容が同一 LAN 上の第三者に読めないようにするため
function respondJson(res, obj) {
  const body = encryptJson(syncKey(), obj);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  res.end(body);
}

// リクエストヘッダーの secretToken を厳格に照合する。
function isAuthorizedRequest(req) {
  return tokensMatch(req.headers[SYNC_TOKEN_HEADER], syncConfig.secretToken);
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
    // 同期の一時停止中は /ping 以外を受け付けない (相手は次回のポーリングで取りに来る)
    if (syncPaused && !(req.method === 'GET' && String(req.url).startsWith('/ping'))) {
      res.writeHead(503);
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

    // このデバイス側でピアを無効化している場合、データ系エンドポイント (/items・/file・/push) は
    // 拒否する。/ping だけは相手の発見・オンライン表示に使うだけなので通す
    if (url.pathname !== '/ping') {
      const remoteHost = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const disabledPeer = [...knownPeers.values()].find((p) => p.host === remoteHost && !p.enabled);
      if (disabledPeer) {
        res.writeHead(403);
        res.end();
        return;
      }
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
        // 一括読み込みせずストリームでパイプする。数 GB のファイルでもメモリを圧迫しない。
        // 暗号化ストリームを間に挟むため、Content-Length は暗号化後の正確なサイズに置き換える
        const encryptStream = createEncryptStream(syncKey());
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': encryptedFileLength(stat.size),
          'x-bridge-salt': encryptStream.salt.toString('base64'),
        });
        const stream = fs.createReadStream(entry.path);
        stream.pipe(encryptStream).pipe(res);
        // 読み取り・暗号化エラー時も res.end() で接続を確実に閉じ、後続の同期通信を巻き添えにしない
        const failFileResponse = (err) => {
          console.error('同期ファイルの配信に失敗:', entry.path, err.message);
          stream.destroy();
          encryptStream.destroy();
          res.end();
        };
        stream.on('error', failFileResponse);
        encryptStream.on('error', failFileResponse);
        // 受信側の切断 (ソケットハングアップ) では読み取りを即座に止めて fd を解放する
        res.on('close', () => {
          stream.destroy();
          encryptStream.destroy();
        });
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
            const payload = decryptJson(syncKey(), body);
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
            peer.lastSyncedAt = Date.now();
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

  server.on('error', (err) => {
    console.error('同期サーバーの起動に失敗:', err.message);
    logEvent('server', `起動失敗 (ポート ${syncConfig.port}): ${err.message}`);
  });
  // 不正なリクエストや接続途中のソケット異常は該当ソケットだけを破棄し、サーバーを守る
  server.on('clientError', (_err, socket) => socket.destroy());
  server.listen(syncConfig.port, '0.0.0.0', () => logEvent('server', `待ち受け開始: ポート ${syncConfig.port}`));
}

// ---- ピア発見: UDP マルチキャストの自己紹介 (依存パッケージなし、node:dgram) ----
// 各デバイスは定期的に「Bridge がここにいます」をマルチキャストで流し、受け取った側が
// HTTP で握手する。/24 全ホストへの HTTP スキャンと違い、ネットワークに静かで、
// 同期キーの一致 (ハッシュの先頭だけ) を先に確かめてから接続する
const DISCOVERY_GROUP = '239.255.77.77';
const DISCOVERY_PORT = 9096;
const DISCOVERY_ANNOUNCE_MS = 30 * 1000;
let discoverySocket = null;

function tokenIdentifier() {
  return tokenIdentifierOf(syncConfig.secretToken);
}

function discoveryPayload() {
  return Buffer.from(
    JSON.stringify({
      app: 'bridge',
      v: 1,
      port: syncConfig.port,
      device: deviceName,
      platform: process.platform,
      iconType: myIconType,
      tokenId: tokenIdentifier(),
    })
  );
}

function announcePresence(targetHost, targetPort) {
  if (!discoverySocket || !syncConfig.autoScan || syncPaused) return;
  const payload = discoveryPayload();
  discoverySocket.send(payload, targetPort || DISCOVERY_PORT, targetHost || DISCOVERY_GROUP, () => {});
}

function startDiscovery() {
  if (discoverySocket) return;
  try {
    discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  } catch (err) {
    logEvent('discovery', `ソケット作成に失敗: ${err.message}`);
    return;
  }
  discoverySocket.on('error', (err) => {
    logEvent('discovery', `エラー: ${err.message}`);
  });
  discoverySocket.on('message', (msg, rinfo) => {
    if (!syncConfig.autoScan || syncPaused) return;
    let info;
    try {
      info = JSON.parse(msg.toString('utf8'));
    } catch {
      return;
    }
    if (!info || info.app !== 'bridge' || info.tokenId !== tokenIdentifier()) return;
    const host = rinfo.address;
    if (localAddresses().has(host) && Number(info.port) === syncConfig.port) return; // 自分の自己紹介
    const peer = addPeer(host, info.port, info.device, info.iconType);
    if (!peer) return;
    // 相手が起動直後なら、こちらの存在も直接返してすぐに双方向にする
    announcePresence(host, rinfo.port);
  });
  discoverySocket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    try {
      discoverySocket.setMulticastTTL(1); // 同一セグメントの外へは出さない
      discoverySocket.setMulticastLoopback(true);
      for (const list of Object.values(os.networkInterfaces() || {})) {
        for (const a of list || []) {
          if (a.family !== 'IPv4' || a.internal) continue;
          try {
            discoverySocket.addMembership(DISCOVERY_GROUP, a.address);
          } catch {
            // 参加できないインターフェース (VPN 等) は無視
          }
        }
      }
      logEvent('discovery', `マルチキャスト待ち受け開始: ${DISCOVERY_GROUP}:${DISCOVERY_PORT}`);
    } catch (err) {
      logEvent('discovery', `マルチキャスト設定に失敗: ${err.message}`);
    }
    // 起動直後は短い間隔で数回名乗り、その後は定期的に
    announcePresence();
    setTimeout(announcePresence, 2000);
    setTimeout(announcePresence, 6000);
    setInterval(announcePresence, DISCOVERY_ANNOUNCE_MS);
  });
}

// ---- 同一セグメントの HTTP スキャン (マルチキャストが通らないネットワーク向けの手動フォールバック) ----
// 起動時に 1 度だけ (誰も見つかっていなければ) と、設定シートの「いま探す」で実行する
let subnetScanRunning = false;

async function scanSubnetForPeers() {
  if (subnetScanRunning) return;
  subnetScanRunning = true;
  logEvent('discovery', 'サブネットスキャン開始');
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
    let found = 0;
    for (let i = 0; i < hosts.length; i += CONCURRENCY) {
      await Promise.all(
        hosts.slice(i, i + CONCURRENCY).map(async (host) => {
          try {
            const info = await httpGetJson(host, syncConfig.port, '/ping');
            if (info && info.app === 'bridge') {
              addPeer(host, info.port, info.device, info.iconType);
              found++;
            }
          } catch {
            // Bridge が居ないホスト・応答なしは無視
          }
        })
      );
    }
    logEvent('discovery', `サブネットスキャン完了: ${found} 台`);
  } catch (err) {
    console.error('サブネットスキャンに失敗:', err);
    logEvent('discovery', `サブネットスキャン失敗: ${err.message}`);
  } finally {
    subnetScanRunning = false;
  }
}

ipcMain.handle('scan-peers-now', async () => {
  announcePresence();
  await scanSubnetForPeers();
  pollAllPeers();
  lastSyncStatusKey = '';
  return syncStatusSnapshot();
});

ipcMain.on('reveal-log', () => {
  const dest = logPath();
  if (!fs.existsSync(dest)) logEvent('app', 'ログを表示');
  shell.showItemInFolder(dest);
});

function startDeviceSync() {
  loadSyncConfig();
  logEvent('app', `起動: ${deviceName} (${process.platform}) v${app.getVersion()}`);
  startSyncServer();
  for (const raw of syncConfig.peers) {
    const [host, port] = raw.split(':');
    if (host && host.trim()) addPeer(host.trim(), port);
  }
  if (syncConfig.autoScan) startDiscovery();
  // マルチキャストが届かないネットワーク (ゲスト Wi-Fi 等) のため、起動後しばらく誰も見つからなければ 1 度だけスキャンする
  setTimeout(() => {
    if (syncConfig.autoScan && knownPeers.size === 0) scanSubnetForPeers();
  }, 15000);
  setInterval(pollAllPeers, SYNC_POLL_MS);
}

// Renderer が「ローカル / 他拠点」バッジを出し分けるための自分自身の情報
ipcMain.handle('get-device-info', () => ({ device: deviceName, platform: process.platform }));

// ---- 同期状態の通知 (フッターのインジケーターと設定シートのピア一覧) ----

function syncStatusSnapshot() {
  const peers = [...knownPeers.values()].map((p) => ({
    device: p.device || null,
    host: p.host,
    port: p.port,
    online: Boolean(p.online),
    enabled: p.enabled !== false,
    iconType: p.iconType || null,
    lastSyncedAt: p.lastSyncedAt || 0,
    lastError: p.lastError || null,
  }));
  return {
    peers,
    onlineCount: peers.filter((p) => p.online).length,
    clipboardPaused,
    syncPaused,
  };
}

let lastSyncStatusKey = '';
// ピアのオンライン/オフラインが変わったときだけ Renderer へ送る (ポーリングのたびには送らない)
function broadcastSyncStatus() {
  const snapshot = syncStatusSnapshot();
  const key = JSON.stringify(snapshot);
  if (key === lastSyncStatusKey) return;
  lastSyncStatusKey = key;
  if (canSendToRenderer()) win.webContents.send('sync-status', snapshot);
}
setInterval(broadcastSyncStatus, 2000);

ipcMain.handle('get-sync-status', () => syncStatusSnapshot());
ipcMain.handle('set-sync-paused', (_event, paused) => {
  setSyncPaused(paused);
  return syncStatusSnapshot();
});
// 一時停止中に生まれた 1 件だけを、右クリックの「同期する」から手動で送る
ipcMain.handle('sync-entry-now', (_event, id) => ({ ok: syncPendingEntryNow(id) }));

// 設定シートのピア一覧からの、デバイス単位の同期 ON/OFF。key は "host:port"
ipcMain.handle('set-peer-enabled', (_event, host, port, enabled) => {
  const key = `${host}:${Number(port) || syncConfig.port}`;
  const peer = knownPeers.get(key);
  if (!peer) return syncStatusSnapshot();
  peer.enabled = Boolean(enabled);
  if (!peer.enabled) peer.online = false; // 無効化した瞬間にオンライン表示を消す (再度ポーリングするまで更新されないため)
  syncConfig.disabledPeers = syncConfig.disabledPeers.filter((k) => k !== key);
  if (!peer.enabled) syncConfig.disabledPeers.push(key);
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(syncConfigPath(), 'utf8')) || {};
  } catch {
    existing = {};
  }
  try {
    fs.writeFileSync(syncConfigPath(), JSON.stringify({ ...existing, disabledPeers: syncConfig.disabledPeers }, null, 2));
  } catch (err) {
    console.error('sync-config.json の書き込みに失敗:', err.message);
  }
  lastSyncStatusKey = '';
  broadcastSyncStatus();
  logEvent('peer', `${peer.enabled ? '同期を再開' : '同期を停止'}: ${peer.device || peer.host}`);
  return syncStatusSnapshot();
});

// ---- 設定の読み書き (sync-config.json を GUI から編集する) ----

ipcMain.handle('get-settings', () => ({
  deviceName,
  iconType: myIconType,
  secretToken: syncConfig.secretToken,
  autoScan: syncConfig.autoScan,
  peers: syncConfig.peers.slice(),
  port: syncConfig.port,
  openAtLogin: app.getLoginItemSettings().openAtLogin,
  toggleShortcut,
  pasteShortcut,
  hotkeyLabel: acceleratorLabel(toggleShortcut),
  pasteHotkeyLabel: acceleratorLabel(pasteShortcut),
  defaultToggleShortcut: DEFAULT_TOGGLE_SHORTCUT,
  defaultToggleShortcutLabel: acceleratorLabel(DEFAULT_TOGGLE_SHORTCUT),
  defaultPasteShortcut: DEFAULT_PASTE_SHORTCUT,
  defaultPasteShortcutLabel: acceleratorLabel(DEFAULT_PASTE_SHORTCUT),
  autoPaste: autoPasteEnabled,
  showSourceApp,
  version: app.getVersion(),
}));

ipcMain.handle('save-settings', (_event, incoming) => {
  if (!incoming || typeof incoming !== 'object') return { ok: false };
  const next = {};
  if (typeof incoming.deviceName === 'string' && incoming.deviceName.trim()) {
    deviceName = incoming.deviceName.trim();
    next.myDeviceName = deviceName;
  }
  if (typeof incoming.iconType === 'string' && ALLOWED_ICON_TYPES.includes(incoming.iconType)) {
    myIconType = incoming.iconType;
    next.iconType = myIconType;
  }
  if (typeof incoming.secretToken === 'string' && incoming.secretToken.trim()) {
    syncConfig.secretToken = incoming.secretToken.trim();
    // キーが変わったのでピアの到達状態をリセットし、次のポーリングで再判定させる
    for (const peer of knownPeers.values()) peer.online = false;
  }
  if (typeof incoming.autoScan === 'boolean') syncConfig.autoScan = incoming.autoScan;
  if (Array.isArray(incoming.peers)) {
    syncConfig.peers = incoming.peers
      .filter((p) => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean);
    for (const raw of syncConfig.peers) {
      const [host, port] = raw.split(':');
      if (host) addPeer(host, port);
    }
  }
  if (typeof incoming.openAtLogin === 'boolean') {
    app.setLoginItemSettings({ openAtLogin: incoming.openAtLogin });
  }
  if (typeof incoming.autoPaste === 'boolean') {
    autoPasteEnabled = incoming.autoPaste;
    next.autoPaste = autoPasteEnabled;
  }
  if (typeof incoming.showSourceApp === 'boolean') {
    showSourceApp = incoming.showSourceApp;
    next.showSourceApp = showSourceApp;
  }
  let hotkeyResult = { toggleOk: true, pasteOk: true };
  if (typeof incoming.toggleShortcut === 'string' || typeof incoming.pasteShortcut === 'string') {
    hotkeyResult = applyHotkeys({ toggle: incoming.toggleShortcut, paste: incoming.pasteShortcut });
    next.toggleShortcut = toggleShortcut;
    next.pasteShortcut = pasteShortcut;
  }

  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(syncConfigPath(), 'utf8')) || {};
  } catch {
    existing = {};
  }
  const out = {
    ...existing,
    ...next,
    port: syncConfig.port,
    peers: syncConfig.peers,
    autoScan: syncConfig.autoScan,
    secretToken: syncConfig.secretToken,
  };
  try {
    fs.writeFileSync(syncConfigPath(), JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('設定の保存に失敗:', err);
    return { ok: false };
  }
  logEvent('app', '設定を保存');
  if (syncConfig.autoScan) {
    startDiscovery();
    announcePresence();
  }
  pollAllPeers();
  lastSyncStatusKey = '';
  return {
    ok: true,
    toggleShortcut,
    pasteShortcut,
    hotkeyLabel: acceleratorLabel(toggleShortcut),
    pasteHotkeyLabel: acceleratorLabel(pasteShortcut),
    hotkeyError: !hotkeyResult.toggleOk ? 'toggle' : !hotkeyResult.pasteOk ? 'paste' : null,
  };
});

// ---- フォルダの自動 .zip 化 (フォルダ除外ガードのアップグレード) ----
// /file はフォルダをストリーム配信できないため、フォルダは登録前に OS 標準コマンドで
// 「フォルダ名.zip」へ裏圧縮し、その zip の実体を同期相手へストリーム転送する。
// 受信側は通常のファイル同期と同じ経路で zip のままハブへ保存する (自動展開はしない)

// フォルダを一時保存フォルダ内の「フォルダ名.zip」へ圧縮し、生成した zip の絶対パスを返す
// 診断用: フォルダ内のファイル数をざっくり数える (上限 20000 で打ち切り、巨大ツリーでも一瞬で終える)。
// 「遅いのはファイルサイズかファイル数か」を bridge.log から判断できるようにするためだけの値
async function countEntriesRough(folderPath, limit = 20000) {
  let count = 0;
  const stack = [folderPath];
  while (stack.length > 0 && count < limit) {
    const dir = stack.pop();
    let names;
    try {
      names = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of names) {
      count++;
      if (count >= limit) break;
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return count >= limit ? `${limit}+` : String(count);
}

async function zipFolder(folderPath) {
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(folderPath) || 'folder';
  const dest = reserveDest(dir, `${sanitizeSyncFileName(base)}.zip`);
  const startedAt = Date.now();
  const fileCount = await countEntriesRough(folderPath);

  if (process.platform === 'win32') {
    // bsdtar (Windows 10 1803 以降に tar.exe として同梱) はフォルダ 1 個を丸ごと zip 化できて、
    // .NET の Compress-Archive よりファイル数が多いフォルダでかなり速い。無い環境だけ従来方式へ
    try {
      await execFileAsync('tar', ['-a', '-cf', dest, '-C', path.dirname(folderPath), base], {
        windowsHide: true,
      });
    } catch (err) {
      logEvent('sync', `tar での zip 化に失敗、Compress-Archive にフォールバック: ${err.message}`);
      const q = (p) => `'${p.replace(/'/g, "''")}'`;
      await winShellRun(`Compress-Archive -LiteralPath ${q(folderPath)} -DestinationPath ${q(dest)} -Force`);
    }
  } else if (process.platform === 'darwin') {
    // ditto は Finder の「圧縮」と同じ macOS 標準コマンド (--keepParent でフォルダごと格納)
    await execFileAsync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', folderPath, dest]);
  } else {
    // Linux 等は zip コマンドへフォールバック (親ディレクトリ基準で相対パス格納)
    await execFileAsync('zip', ['-r', dest, base], { cwd: path.dirname(folderPath) });
  }

  sessionTempFiles.add(dest); // 裏生成した zip は終了時クリーンアップの対象として追跡
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  let zipSize = 0;
  try {
    zipSize = (await fsp.stat(dest)).size;
  } catch {
    zipSize = 0;
  }
  logEvent('sync', `フォルダを圧縮: ${base} (${fileCount} 項目, zip ${Math.round(zipSize / 1048576)}MB, ${seconds}s)`);
  return dest;
}

// Renderer で追加されたローカル生まれのファイル (D&D・Web ダウンロード・テキスト保存等) を
// 同期台帳へ登録する。他拠点由来のアイテムは Renderer 側で登録をスキップするため循環しない。
// 戻り値は Renderer 側でバッジ表示・右クリックの「同期する」に使う { id, unsynced } (登録なしなら null)
ipcMain.handle('sync-register-file', async (_event, payload) => {
  const filePath = payload && payload.path;
  if (typeof filePath !== 'string' || registeredSyncPaths.has(filePath)) return null;
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null; // 消えた・読めないパスは登録しない
  }
  registeredSyncPaths.add(filePath);
  // フォルダはそのまま同期できないため、バックグラウンドで .zip 化してから台帳へ登録する。
  // ローカルのリストにはフォルダのカードがそのまま残り、同期相手には zip が届く
  if (stat.isDirectory()) {
    const registeredAt = Date.now(); // 時刻は zip 化の完了時ではなく「置いた時」に揃える
    try {
      const zipPath = await zipFolder(filePath);
      const entry = registerLocalSyncEntry({
        type: 'file',
        name: path.basename(zipPath),
        path: zipPath,
        timestamp: registeredAt,
        originKind: 'folder',
        folderName: path.basename(filePath),
      });
      return entry ? { id: entry.id, unsynced: Boolean(entry.unsynced) } : null;
    } catch (err) {
      registeredSyncPaths.delete(filePath); // 失敗した場合は次回の登録 (再ドロップ) で再挑戦できるようにする
      console.error('フォルダの zip 化に失敗 (同期をスキップ):', filePath, err.message);
      return null;
    }
  }
  const entry = registerLocalSyncEntry({
    type: 'file',
    name: (payload && payload.name) || path.basename(filePath),
    path: filePath,
    timestamp: (payload && Number(payload.timestamp)) || Date.now(),
  });
  return entry ? { id: entry.id, unsynced: Boolean(entry.unsynced) } : null;
});

// ---- フォルダ由来 zip の展開 (受信側) ----
// 上限以内なら自動で展開し、zip は消してフォルダの行にする。上限を超えるものは zip のまま残し、
// 右クリックの「フォルダとして展開」で手動展開できるようにする (ディスクの二重消費を避ける)
const FOLDER_AUTO_EXTRACT_MAX_BYTES = 1024 * 1024 * 1024; // 1GB

async function extractFolderZip(zipPath, folderName) {
  const startedAt = Date.now();
  const dir = downloadDir();
  await fsp.mkdir(dir, { recursive: true });
  // いったん専用の作業ディレクトリへ展開し、中の最上位フォルダを衝突しない名前で移動する
  const work = path.join(dir, `.extract-${crypto.randomUUID()}`);
  await fsp.mkdir(work, { recursive: true });
  try {
    if (process.platform === 'win32') {
      // Windows 10 1803 以降に同梱の bsdtar は .zip も展開できる。無ければ PowerShell にフォールバック
      try {
        await execFileAsync('tar', ['-xf', zipPath, '-C', work], { windowsHide: true });
      } catch {
        const q = (p) => `'${p.replace(/'/g, "''")}'`;
        await winShellRun(`Expand-Archive -LiteralPath ${q(zipPath)} -DestinationPath ${q(work)} -Force`);
      }
    } else if (process.platform === 'darwin') {
      await execFileAsync('ditto', ['-x', '-k', zipPath, work]);
    } else {
      await execFileAsync('unzip', ['-q', zipPath, '-d', work]);
    }
    const entries = (await fsp.readdir(work)).filter((n) => n !== '__MACOSX' && !n.startsWith('.'));
    // --keepParent で圧縮された zip は最上位に元のフォルダが 1 つある。それ以外はフォルダ名で包む
    let source;
    if (entries.length === 1 && (await fsp.stat(path.join(work, entries[0]))).isDirectory()) {
      source = path.join(work, entries[0]);
    } else {
      source = work;
    }
    const dest = reserveDest(dir, sanitizeSyncFileName(folderName || path.basename(zipPath, '.zip')));
    await fsp.rename(source, dest);
    logEvent('sync', `フォルダを展開: ${folderName || path.basename(zipPath)} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
    return dest;
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// 上限以内なら展開してフォルダのパスを返し、zip は削除する。上限超え・失敗時は null (zip のまま)
async function extractFolderZipIfSmall(zipPath, folderName) {
  let size = 0;
  try {
    size = (await fsp.stat(zipPath)).size;
  } catch {
    return null;
  }
  if (size > FOLDER_AUTO_EXTRACT_MAX_BYTES) {
    logEvent('sync', `フォルダ zip が大きいため展開せず保持: ${folderName} (${Math.round(size / 1048576)}MB)`);
    return null;
  }
  try {
    const dest = await extractFolderZip(zipPath, folderName);
    sessionTempFiles.delete(zipPath);
    await fsp.unlink(zipPath).catch(() => {});
    sessionTempFiles.add(dest); // 展開したフォルダも自動生成物として後始末の対象にする
    logEvent('sync', `フォルダを展開: ${folderName}`);
    return dest;
  } catch (err) {
    logEvent('sync', `フォルダの展開に失敗 (zip のまま保持): ${folderName} (${err.message})`);
    return null;
  }
}

// 右クリック「フォルダとして展開」(上限超えで zip のまま残ったもの)
ipcMain.handle('extract-folder-zip', async (_event, payload) => {
  const zipPath = payload && payload.path;
  if (typeof zipPath !== 'string' || !fs.existsSync(zipPath)) return null;
  try {
    const dest = await extractFolderZip(zipPath, payload.folderName || null);
    if (sessionTempFiles.has(zipPath)) {
      sessionTempFiles.delete(zipPath);
      await fsp.unlink(zipPath).catch(() => {});
      sessionTempFiles.add(dest);
    }
    for (const entry of syncStore) {
      if (entry.path === zipPath) entry.path = null; // zip は無くなったので配信対象から外す
    }
    return dest;
  } catch (err) {
    logEvent('sync', `フォルダの手動展開に失敗: ${zipPath} (${err.message})`);
    return null;
  }
});

// ---- ペースト用ポップアップ (⌘⇧V でカーソルの近くに履歴を出し、選ぶと即ペースト) ----
// シェルフを開いてクリックするより 1 手少ない「その場でペースト」の導線。
// 一覧のデータは Renderer から永続化のために届いている latestHistoryPayload を使う
const POPUP_WIDTH = 300;
const POPUP_HEIGHT = 380;
const PASTE_SHORTCUT = 'CommandOrControl+Shift+V';
const PASTE_SHORTCUT_LABEL = process.platform === 'darwin' ? '⌘⇧V' : 'Ctrl+Shift+V';
let popupWin = null;
let autoPasteEnabled = true; // 設定 (sync-config.json の autoPaste)
// コピー元アプリのアイコン取得。Windows はコピーのたびに PowerShell を起動する重さがあるため既定オフ
let showSourceApp = process.platform === 'darwin';

function popupAlive() {
  return popupWin !== null && !popupWin.isDestroyed();
}

function createPopupWindow() {
  popupWin = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    ...(process.platform === 'darwin' ? { type: 'panel', vibrancy: 'popover', visualEffectState: 'active' } : {}),
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    backgroundMaterial: 'acrylic',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popupWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  popupWin.loadFile('popup.html');
  popupWin.on('blur', () => hidePastePopup());
  popupWin.on('closed', () => {
    popupWin = null;
  });
}

// ポップアップに出す一覧。テキスト / 画像 / (実体のある) ファイルを新しい順に、ピン留めを先頭に
function popupItems() {
  const items = latestHistoryPayload ? latestHistoryPayload.items : [];
  return items
    .filter((it) => it && (it.kind === 'clip-text' ? typeof it.text === 'string' : Boolean(it.path)))
    .slice()
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return (b.timestamp || 0) - (a.timestamp || 0);
    })
    .slice(0, 60)
    .map((it) => ({
      kind: it.kind,
      text: it.text || null,
      path: it.path || null,
      name: it.name || '',
      isImage: Boolean(it.isImage),
      timestamp: it.timestamp,
      pinned: Boolean(it.pinned),
      customTitle: it.customTitle || null,
      sourceApp: it.sourceApp || null,
    }));
}

function showPastePopup() {
  if (!popupAlive()) createPopupWindow();
  if (process.platform === 'win32') {
    // ペースト先をポップアップが前面になる前に控える (ヘルパーは常駐なので数十 ms)
    pasteTargetHwnd = null;
    winShellRun('[Native.Win32]::GetForegroundWindow().ToInt64()')
      .then((out) => {
        const n = Number(out);
        if (Number.isFinite(n) && n > 0) pasteTargetHwnd = n;
      })
      .catch(() => {});
  }
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  // カーソルのすぐ右下。画面からはみ出すなら内側へ寄せる
  const x = Math.max(area.x, Math.min(cursor.x + 8, area.x + area.width - POPUP_WIDTH));
  const y = Math.max(area.y, Math.min(cursor.y + 8, area.y + area.height - POPUP_HEIGHT));
  popupWin.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT }, false);
  const send = () => {
    if (!popupAlive()) return;
    popupWin.webContents.send('popup-items', { items: popupItems(), autoPaste: autoPasteEnabled });
    popupWin.show();
    popupWin.focus();
  };
  if (popupWin.webContents.isLoading()) popupWin.webContents.once('did-finish-load', send);
  else send();
}

function hidePastePopup() {
  if (popupAlive() && popupWin.isVisible()) popupWin.hide();
}

function togglePastePopup() {
  if (popupAlive() && popupWin.isVisible()) hidePastePopup();
  else showPastePopup();
}

// 選択後に前面アプリへ ⌘V / Ctrl+V を送る。macOS はアクセシビリティの許可が必要で、
// 無ければ初回だけ OS の許可ダイアログを出し、その回はコピーだけで終える
function sendPasteKeystroke() {
  if (process.platform === 'darwin') {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      logEvent('paste', 'アクセシビリティ未許可のため ⌘V を送れません');
      systemPreferences.isTrustedAccessibilityClient(true); // 許可ダイアログを出す
      if (canSendToRenderer()) win.webContents.send('paste-permission-needed');
      return false;
    }
    // 診断用に「どのアプリのどのウインドウへ送ったか」を残す (つながらない報告の切り分けに使う)
    execFile(
      'osascript',
      [
        '-e',
        'tell application "System Events"',
        '-e',
        'set frontApp to name of first application process whose frontmost is true',
        '-e',
        'keystroke "v" using command down',
        '-e',
        'return frontApp',
        '-e',
        'end tell',
      ],
      (err, stdout, stderr) => {
        if (err) logEvent('paste', `⌘V の送信に失敗: ${(stderr || err.message || '').trim()}`);
        else logEvent('paste', `⌘V を送信: 前面アプリ=${String(stdout).trim()} (Bridge がキー=${winAlive() && win.isFocused()})`);
      }
    );
    return true;
  }
  if (process.platform === 'win32') {
    // ポップアップを隠しただけでは前面が元のアプリに戻る保証がないため、
    // ポップアップを出す前に控えておいた前面ウインドウを明示的に前面へ戻してから Ctrl+V を送る。
    // SetForegroundWindow が拒否されたときは AttachThreadInput で入力キューを結合して再試行する
    const hwnd = pasteTargetHwnd;
    const script = [
      hwnd
        ? [
            `$h = [IntPtr]${hwnd}`,
            'if (-not [Native.Win32]::SetForegroundWindow($h)) {',
            '  $fg = [Native.Win32]::GetForegroundWindow(); $pid2 = 0',
            '  $fgThread = [Native.Win32]::GetWindowThreadProcessId($fg, [ref]$pid2)',
            '  $me = [Native.Win32]::GetCurrentThreadId()',
            '  [Native.Win32]::AttachThreadInput($me, $fgThread, $true) | Out-Null',
            '  [Native.Win32]::SetForegroundWindow($h) | Out-Null',
            '  [Native.Win32]::AttachThreadInput($me, $fgThread, $false) | Out-Null',
            '}',
            'Start-Sleep -Milliseconds 80',
          ].join('\n')
        : '',
      "[System.Windows.Forms.SendKeys]::SendWait('^v')",
      '$fg2 = [Native.Win32]::GetForegroundWindow(); $p3 = 0; [Native.Win32]::GetWindowThreadProcessId($fg2, [ref]$p3) | Out-Null; (Get-Process -Id $p3).ProcessName',
    ].join('\n');
    winShellRun(script)
      .then((front) => logEvent('paste', `Ctrl+V を送信: 前面=${front} (hwnd=${hwnd || 'なし'})`))
      .catch((err) => logEvent('paste', `Ctrl+V の送信に失敗: ${err.message}`))
      .finally(() => hidePastePopup());
    return true;
  }
  return false;
}

// Windows: ポップアップを出す直前の前面ウインドウ (= ペースト先)。ヘルパーが非同期に埋める
let pasteTargetHwnd = null;

ipcMain.on('popup-choose', async (_event, choice) => {
  if (!choice || typeof choice !== 'object') return;
  let ok = false;
  if (choice.kind === 'clip-text' && typeof choice.text === 'string') {
    writeTextToClipboard(choice.text);
    ok = true;
  } else if (choice.kind === 'clip-image' && typeof choice.path === 'string') {
    ok = writeImageToClipboard(choice.path);
  } else if (choice.kind === 'file' && typeof choice.path === 'string') {
    ok = await writeFileToClipboard(choice.path);
  }
  if (!ok || !autoPasteEnabled) {
    hidePastePopup();
    return;
  }
  if (process.platform === 'win32') {
    // Windows はヘルパーが前面を元のアプリへ戻して Ctrl+V を送り、終わってからポップアップを隠す
    // (先に隠すと Electron が前面プロセスでなくなり、SetForegroundWindow が拒否される)
    sendPasteKeystroke();
    return;
  }
  hidePastePopup();
  // シェルフがキーウインドウのままだと ⌘V が Bridge 自身に届くので、先に返しておく
  releaseFocus();
  // ポップアップが閉じて前のアプリに入力が戻るのを待ってからキーを送る
  setTimeout(sendPasteKeystroke, 150);
});

ipcMain.on('popup-close', () => hidePastePopup());

// ---- アップデートの確認 (GitHub Releases の最新タグとバージョンを比べるだけ。自動更新はしない) ----
const UPDATE_CHECK_URL = 'https://api.github.com/repos/haruhito767676/bridge/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
let notifiedUpdateVersion = null;

async function checkForUpdates({ manual = false } = {}) {
  try {
    const res = await net.fetch(UPDATE_CHECK_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `bridge/${app.getVersion()}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    if (latest && compareVersions(latest, app.getVersion()) > 0) {
      if (!manual && notifiedUpdateVersion === latest) return;
      notifiedUpdateVersion = latest;
      logEvent('update', `新しいバージョン: ${latest}`);
      if (canSendToRenderer()) {
        placeOnCursorDisplay(expanded);
        expandShelter({ focus: true });
        win.webContents.send('update-available', { version: latest, url: release.html_url });
      }
    } else if (manual && canSendToRenderer()) {
      win.webContents.send('update-none', { version: app.getVersion() });
    }
  } catch (err) {
    logEvent('update', `確認に失敗: ${err.message}`);
    if (manual && canSendToRenderer()) win.webContents.send('update-none', { version: app.getVersion(), error: true });
  }
}

// 設定画面の「アップデートを確認」ボタンから手動チェックを叩けるようにする
// (これまではトレイメニューの「アップデートを確認…」からのみ呼べた)
ipcMain.on('check-for-updates', () => checkForUpdates({ manual: true }));

// ---- グローバルホットキー (設定で変更可能) ----
// ホバー展開は「マウスが右端に行ったついで」の受動的な導線なので、意図して呼び出す主導線として
// ホットキーを用意する。ホットキーで開いたときだけ検索バーにフォーカスし、そのまま打ち始められる。
// キー自体は設定シートで「フィールドをクリックして押す」形式で変更でき、Set-Clipboard 系との
// 衝突 (Ctrl+Shift+V は多くのアプリで「書式なしで貼り付け」) を各自の環境に合わせて避けられる
const DEFAULT_TOGGLE_SHORTCUT = process.platform === 'darwin' ? 'Alt+Space' : 'Ctrl+Shift+Space';
// ⌘⇧V / Ctrl+Shift+V は「書式なしで貼り付け」として多くのアプリ (ブラウザ、Slack、Office、
// エディタ等) が内部的に使う定番の組み合わせで、既に別の常駐ユーティリティに global hotkey として
// 押さえられていることも多い。特に Windows の Ctrl+Alt+V は AltGr (多くの非 US 配列で
// Ctrl+Alt と等価) と衝突し、意図せず暴発するため避ける。
// Windows は以前 Ctrl+Win+V を既定にしていたが、クリップボード履歴 (Win+V) を有効にしている
// 環境ではエクスプローラーがシェルレベルで Win+V 系のフックを握ってしまい、Win キーを含む組み合わせの
// globalShortcut.register が常に失敗する (実機で bridge.log の [hotkey] 登録に失敗 を確認済み)。
// そのため Windows では Win キーを含まない組み合わせを既定にする
const DEFAULT_PASTE_SHORTCUT = process.platform === 'darwin' ? 'Alt+CommandOrControl+V' : 'Control+Alt+Shift+V';

let toggleShortcut = DEFAULT_TOGGLE_SHORTCUT;
let pasteShortcut = DEFAULT_PASTE_SHORTCUT;

// Electron の accelerator 文字列 → 表示用ラベル (⌘⌥⇧⌃ / Ctrl+Alt+Shift+Win)
function acceleratorLabel(accelerator) {
  const parts = String(accelerator || '').split('+');
  const key = parts.pop();
  const mac = process.platform === 'darwin';
  const symbols = mac
    ? { CommandOrControl: '⌘', Command: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘' }
    : { CommandOrControl: 'Ctrl', Command: 'Win', Cmd: 'Win', Control: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Option: 'Alt', Shift: 'Shift', Super: 'Win' };
  const mods = parts.map((p) => symbols[p] || p);
  const keyLabel = key === 'Space' ? 'Space' : key;
  return mac ? [...mods, keyLabel].join('') : [...mods, keyLabel].join('+');
}

function unregisterHotkeys() {
  try {
    globalShortcut.unregister(toggleShortcut);
  } catch {
    // 未登録なら何もしない
  }
  try {
    globalShortcut.unregister(pasteShortcut);
  } catch {
    // 同上
  }
}

// 1 つだけ登録し直す。成功したら true。失敗時 (他アプリ・OS 予約済み) は登録を戻さず false を返す
function registerOneHotkey(accelerator, handler) {
  try {
    const ok = globalShortcut.register(accelerator, handler);
    if (!ok) logEvent('hotkey', `登録に失敗 (使用中): ${accelerator}`);
    return ok;
  } catch (err) {
    logEvent('hotkey', `登録エラー: ${accelerator} (${err.message})`);
    return false;
  }
}

function registerToggleShortcut() {
  registerOneHotkey(toggleShortcut, () => {
    if (!winAlive()) return;
    if (!expanded) placeOnCursorDisplay(false);
    toggleShelter();
  });
  registerOneHotkey(pasteShortcut, () => togglePastePopup());
}

// 設定シートからの変更を反映する。それぞれ独立に検証し、どちらかが失敗しても他方は適用する。
// 戻り値: { toggleOk, pasteOk } (失敗した方は元の値のまま据え置き、呼び出し側が保存有無を決める)
function applyHotkeys({ toggle, paste }) {
  const result = { toggleOk: true, pasteOk: true };
  if (typeof toggle === 'string' && toggle !== toggleShortcut) {
    globalShortcut.unregister(toggleShortcut);
    const ok = registerOneHotkey(toggle, () => {
      if (!winAlive()) return;
      if (!expanded) placeOnCursorDisplay(false);
      toggleShelter();
    });
    if (ok) toggleShortcut = toggle;
    else {
      registerOneHotkey(toggleShortcut, () => {
        if (!winAlive()) return;
        if (!expanded) placeOnCursorDisplay(false);
        toggleShelter();
      }); // 失敗したので元のキーへ登録し直す
      result.toggleOk = false;
    }
  }
  if (typeof paste === 'string' && paste !== pasteShortcut) {
    globalShortcut.unregister(pasteShortcut);
    const ok = registerOneHotkey(paste, () => togglePastePopup());
    if (ok) pasteShortcut = paste;
    else {
      registerOneHotkey(pasteShortcut, () => togglePastePopup());
      result.pasteOk = false;
    }
  }
  return result;
}

// ---- 全画面アプリの上では自動で隠す (設定なしの既定動作) ----
// Windows のタスクバー通知や macOS のメニューバー / Dock と同じく、動画・ゲームなどの
// 全画面表示を邪魔しないことを OS 標準の振る舞いとして扱う (オンオフの設定は設けない)
let hiddenForFullscreen = false;


function checkFullscreenAndHide() {
  if (process.platform !== 'win32') return;
  // 前面ウインドウの矩形が、そのモニターの矩形とちょうど一致するか (= 排他的フルスクリーン)。
  // Win32 の型は WIN_HELPER_INIT で一度だけ定義済みの NativeMon を使う
  const script = [
    '$h = [Native.Win32]::GetForegroundWindow()',
    'if ($h -eq [IntPtr]::Zero) { "0" } else {',
    '  $mon = [NativeMon]::MonitorFromWindow($h, 2)',
    '  $mi = New-Object MONITORINFO; $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)',
    '  [NativeMon]::GetMonitorInfo($mon, [ref]$mi) | Out-Null',
    '  $wr = New-Object RECT',
    '  [NativeMon]::GetWindowRect($h, [ref]$wr) | Out-Null',
    '  if ($wr.Left -le $mi.rcMonitor.Left -and $wr.Top -le $mi.rcMonitor.Top -and $wr.Right -ge $mi.rcMonitor.Right -and $wr.Bottom -ge $mi.rcMonitor.Bottom) { "1" } else { "0" }',
    '}',
  ].join('; ');
  winShellRun(script)
    .then((out) => {
      const fullscreen = out.trim() === '1';
      if (fullscreen === hiddenForFullscreen) return;
      hiddenForFullscreen = fullscreen;
      for (const tab of tabWindows.values()) {
        if (tab.isDestroyed()) continue;
        if (fullscreen) tab.hide();
        else if (!tab.isVisible()) tab.showInactive();
      }
      if (fullscreen && expanded) collapseShelterNow();
    })
    .catch(() => {}); // 判定できなくても実害はない (単に隠れないだけ)
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // 多重起動の第2インスタンスは何も起動せず quit を待つ
  // メニューバー常駐のユーティリティなので Dock と ⌘Tab には出さない
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  createTray();
  if (IS_WINDOWS) {
    winShellSpawn(); // 常駐ヘルパーを先に温めておく
    // 起動直後に 1 回だけ疎通確認する。ここで失敗するなら、クリップボードの連番駆動の
    // 検知 (Win+Shift+S 等) はこの環境では機能せず、常に旧来の内容比較方式にフォールバックする
    setTimeout(() => {
      readClipboardSequence()
        .then((seq) => logEvent('winshell', `疎通確認: クリップボード連番 = ${seq === null ? '取得失敗' : seq}`))
        .catch((err) => logEvent('winshell', `疎通確認に失敗: ${err.message}`));
    }, 1500);
    refreshTabWindows();
    for (const evt of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(evt, () => setTimeout(refreshTabWindows, 500));
    }
  }
  // startDeviceSync() (loadSyncConfig() 経由) が toggleShortcut/pasteShortcut を
  // sync-config.json から読み込むため、ホットキー登録より必ず先に呼ぶこと。
  // 逆順だとユーザーが設定シートで変更したショートカットが読み込まれる前に
  // ハードコードの既定値で登録されてしまい、設定を変えても効かないように見える
  startDeviceSync();
  registerToggleShortcut();
  if (IS_WINDOWS) setInterval(checkFullscreenAndHide, 1500);
  startClipboardWatcher();
  startEdgeRevealWatcher();
  createPopupWindow(); // 初回の ⌘⇧V で待たせないよう先に読み込んでおく
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(), 6 * 60 * 60 * 1000);
    setInterval(() => checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
  }

  // 開発用: BRIDGE_DEV_SEED=1 で起動すると、ダミーのアイテムを流し込んで展開し、
  // ウインドウ座標を標準出力へ出す (見た目の確認・スクリーンショット用。パッケージ版では無効)
  if (!app.isPackaged && process.env.BRIDGE_DEV_SEED) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (!winAlive()) return;
        // スクリーンショット用のダミーデータは、プロジェクト自身のファイル (README/SPEC) ではなく、
        // 「ECサイト改修案件を進める受託チーム」という架空の実務シチュエーションで統一する
        // (紹介ページに載せたときの実用性が伝わるように。日時・出身デバイス・保存元アプリまで作り込む)
        const MIN = 60000;
        const HOUR = 3600000;
        const DAY = 24 * HOUR;
        const seedFile = (name, origin, sourceApp) =>
          win.webContents.send('add-file', addFilePayload(path.join(__dirname, name), origin, sourceApp));
        (async () => {
        if (process.env.BRIDGE_DEV_SEED !== 'restore') {
        // 撮影用には「アプリ名だけ」ではなくバッジとして見えるアイコンも欲しいので、実際に
        // インストール済みのアプリの本物のアイコンを流用する (パッケージ版のロジックとは無関係)
        const iconFor = async (bundlePath) => {
          try {
            return await getMacAppIconDataUrl(bundlePath);
          } catch {
            return null;
          }
        };
        const appExcel = { name: 'Excel', icon: await iconFor('/Applications/Microsoft Excel.app') };
        // Win/Mac 両対応を謳っている都合上、片方の OS にしかないアプリ (メモ/Safari/LINE) は避け、
        // 両OSで実際によく使われるクロスプラットフォームなアプリで揃える
        const appNotion = { name: 'Notion', icon: await iconFor('/Applications/Notion.app') };
        const appFigma = { name: 'Figma', icon: await iconFor('/Applications/Figma.app') };
        const appPages = { name: 'Pages', icon: await iconFor('/Applications/Pages.app') };
        const appNumbers = { name: 'Numbers', icon: await iconFor('/Applications/Numbers.app') };
        const appChrome = { name: 'Chrome', icon: await iconFor('/Applications/Google Chrome.app') };
        const appSlack = { name: 'Slack', icon: await iconFor('/Applications/Slack.app') };
        const appTerminal = { name: 'ターミナル', icon: await iconFor('/System/Applications/Utilities/Terminal.app') };
        const appWord = { name: 'Word', icon: await iconFor('/Applications/Microsoft Word.app') };
        const appOutlook = { name: 'Outlook', icon: await iconFor('/Applications/Microsoft Outlook.app') };
        const appTeams = { name: 'Teams', icon: await iconFor('/Applications/Microsoft Teams.app') };
        const appPowerPoint = { name: 'PowerPoint', icon: await iconFor('/Applications/Microsoft PowerPoint.app') };
        // フル稼働ユーザー想定でボリュームを積む際、EC改修の実務でよく使う開発/AIツールも追加
        // (Photoshop/Illustrator はこのマシンに未インストールで本物のアイコンが取得できないため見送る)
        const appVSCode = { name: 'VSCode', icon: await iconFor('/Applications/Visual Studio Code.app') };
        const appClaude = { name: 'Claude', icon: await iconFor('/Applications/Claude.app') };
        const appChatGPT = { name: 'ChatGPT', icon: await iconFor('/Applications/ChatGPT Classic.app') };

        seedFile(
          'assets/demo/見積書_ECサイト改修_v2.pdf',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 40 * MIN },
          appExcel,
        );
        seedFile(
          'assets/demo/議事録_1010_定例MTG.txt',
          { timestamp: Date.now() - 4 * HOUR },
          appNotion,
        );
        seedFile(
          'assets/demo/ロゴ差分_v3.png',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - DAY - 5 * HOUR },
          appFigma,
        );
        seedFile(
          'assets/demo/検収書_9月分.pdf',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 3 * DAY - 4 * HOUR },
          appPages,
        );
        seedFile(
          'assets/demo/進行スケジュール.csv',
          { timestamp: Date.now() - 2 * DAY },
          appNumbers,
        );
        seedFile(
          'assets/demo/リリースノート_v1.2.txt',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 5 * DAY },
          appNotion,
        );
        // 3台のファイル数が偏らないよう (自分のMac / 会社用PC / 自宅iMac が 4件ずつになるよう) 追加
        seedFile(
          'assets/demo/契約書_業務委託.docx',
          { timestamp: Date.now() - DAY - 2 * HOUR },
          appWord,
        );
        seedFile(
          'assets/demo/提案資料_リニューアル方針.pptx',
          { timestamp: Date.now() - 5 * DAY - 2 * HOUR },
          appPowerPoint,
        );
        seedFile(
          'assets/demo/経費精算_9月.xlsx',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 2 * DAY - 3 * HOUR },
          appExcel,
        );
        seedFile(
          'assets/demo/納品リスト_10月.xlsx',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - DAY - 8 * HOUR },
          appExcel,
        );
        seedFile(
          'assets/demo/バナー案_A案.png',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 3 * DAY - HOUR },
          appPages,
        );
        seedFile(
          'assets/demo/議事録_商店会訪問.txt',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 4 * DAY - 5 * HOUR },
          appNotion,
        );
        // 設定シートの「履歴の使用状況」がスカスカに見えないよう、2週間分くらい使い込んだ
        // ボリュームまで増量する (会社用PC / 自宅iMac / 自分のMac のファイル数はほぼ揃える)
        seedFile('assets/demo/サーバー移行手順.txt', { timestamp: Date.now() - 7 * HOUR }, appNotion);
        seedFile(
          'assets/demo/サイトマップ.pdf',
          { timestamp: Date.now() - 3 * DAY - 6 * HOUR },
          appPowerPoint,
        );
        seedFile('assets/demo/デプロイスクリプト.txt', { timestamp: Date.now() - 9 * HOUR }, appTerminal);
        seedFile(
          'assets/demo/顧客対応マニュアル.docx',
          { timestamp: Date.now() - 6 * DAY - 3 * HOUR },
          appWord,
        );
        seedFile('assets/demo/KPIダッシュボード.png', { timestamp: Date.now() - 8 * DAY - HOUR }, appNumbers);
        seedFile('assets/demo/アクセス権限一覧.xlsx', { timestamp: Date.now() - 10 * DAY }, appExcel);
        seedFile(
          'assets/demo/週次レポート_W37.pptx',
          { timestamp: Date.now() - 13 * DAY - 4 * HOUR },
          appPowerPoint,
        );
        seedFile(
          'assets/demo/請求書_10月.pdf',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - DAY - 12 * HOUR },
          appExcel,
        );
        seedFile(
          'assets/demo/NDA_秘密保持契約.pdf',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 5 * DAY - 5 * HOUR },
          appWord,
        );
        seedFile(
          'assets/demo/見積比較_他社.xlsx',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 7 * DAY - 2 * HOUR },
          appExcel,
        );
        seedFile(
          'assets/demo/障害報告書_0912.docx',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 9 * DAY - 6 * HOUR },
          appWord,
        );
        seedFile(
          'assets/demo/ロゴ_v4.png',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 11 * DAY - 3 * HOUR },
          appFigma,
        );
        seedFile(
          'assets/demo/名刺デザイン案.png',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 12 * DAY - HOUR },
          appFigma,
        );
        seedFile(
          'assets/demo/請求書送付リスト.xlsx',
          { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 14 * DAY },
          appExcel,
        );
        seedFile(
          'assets/demo/デザインガイドライン_v2.pdf',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 4 * DAY - 2 * HOUR },
          appFigma,
        );
        seedFile(
          'assets/demo/テスト仕様書_決済フロー.xlsx',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 6 * DAY - 8 * HOUR },
          appExcel,
        );
        seedFile(
          'assets/demo/契約更新のご案内.docx',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 8 * DAY - 4 * HOUR },
          appWord,
        );
        seedFile(
          'assets/demo/プロジェクト計画書.pptx',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 10 * DAY - 5 * HOUR },
          appPowerPoint,
        );
        seedFile(
          'assets/demo/アイコンセット.png',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 12 * DAY - 6 * HOUR },
          appFigma,
        );
        seedFile(
          'assets/demo/顧客リスト_9月版.xlsx',
          { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 13 * DAY - HOUR },
          appExcel,
        );

        // クリップボードは普段づかいの道具なので、1〜数十分おきに次々コピーしている
        // ような密度で並べる (数時間おきにしか使っていないような不自然な間隔にしない)
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '会議室Bを10:00〜11:00で予約しました。プロジェクターの予約も忘れずに。',
          timestamp: Date.now() - MIN,
          sourceApp: appNotion,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: 'https://github.com/example-team/ec-renewal/pull/42',
          timestamp: Date.now() - 8 * MIN,
          sourceApp: appChrome,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '本日17時までにデザイン差し戻しをお願いします🙏',
          timestamp: Date.now() - 35 * MIN,
          fromDevice: '自宅iMac',
          fromPlatform: 'darwin',
          sourceApp: appSlack,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: 'https://api.example.com/v2/orders?status=pending',
          timestamp: Date.now() - 55 * MIN,
          sourceApp: appChrome,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '在庫アラートのしきい値を10→15に変更してもらえますか？',
          timestamp: Date.now() - 80 * MIN,
          fromDevice: '会社用PC',
          fromPlatform: 'win32',
          sourceApp: appSlack,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '03-1234-5678（サポート窓口）',
          timestamp: Date.now() - 130 * MIN,
          sourceApp: appNotion,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-image',
          // コピー画像の裏生成ファイルは実際は `clipboard_<日時>.png` という名前になる
          // (README/SPEC 記載の命名規則) ので、シェルフに追加したファイルとは別に用意する
          path: path.join(__dirname, 'assets/demo/clipboard_2026-09-14_20-10-00.png'),
          timestamp: Date.now() - DAY + 5 * HOUR,
          fromDevice: '会社用PC',
          fromPlatform: 'win32',
          sourceApp: appFigma,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: 'ssh deploy@192.168.1.42 -p 2222',
          timestamp: Date.now() - DAY - 4 * HOUR,
          fromDevice: '会社用PC',
          fromPlatform: 'win32',
          sourceApp: appTerminal,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '第3四半期の売上比較表を送ります。セルB2:D10を参照してください。',
          timestamp: Date.now() - 95 * MIN,
          fromDevice: '会社用PC',
          fromPlatform: 'win32',
          sourceApp: appExcel,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '契約書の第3条、支払い条件の文言を統一してください。',
          timestamp: Date.now() - 150 * MIN,
          sourceApp: appWord,
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '本日15:00〜Teams会議です。 https://teams.microsoft.com/l/meetup-join/xxxx',
          timestamp: Date.now() - 3 * HOUR,
          fromDevice: '自宅iMac',
          fromPlatform: 'darwin',
          sourceApp: appTeams,
        });
        // ピン留めのメール署名 (社内向け)。会議室予約などと違い「ずっと使い回す定型文」なので
        // ピン留めの実例として分かりやすい
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: '-------------------\n山田 太郎\nECサイト改修プロジェクト担当 / example-team\nTel: 03-1234-5678\n-------------------',
          timestamp: Date.now() - 6 * HOUR,
          sourceApp: appOutlook,
        });
        // ここから増量分。直近数時間はまだ密に、それより前は日を追うごとに間隔を空けて
        // 「2週間くらい使い込んでいる」ボリュームにする (設定シートの内訳がスカスカに見えないように)
        const clip = (text, hoursAgo, device, platform, app) =>
          win.webContents.send('clipboard-item', {
            type: 'clipboard-text',
            text,
            timestamp: Date.now() - hoursAgo * HOUR,
            fromDevice: device || undefined,
            fromPlatform: platform || undefined,
            sourceApp: app,
          });
        clip('先方より本日中に色校正の返信をいただけるとのことです', 2.2, '自宅iMac', 'darwin', appTeams);
        clip('https://www.figma.com/file/abcd1234/EC-Renewal', 3, null, null, appChrome);
        clip('納品物一覧: index.html, styles.css, main.js', 5, null, null, appNotion);
        clip('住所: 東京都渋谷区渋谷1-2-3 渋谷ビル5F', 9, null, null, appNotion);
        clip('経費精算の締め切りは毎月25日です', 25, '会社用PC', 'win32', appOutlook);
        clip('https://docs.google.com/spreadsheets/d/xxxx/edit', 27, '会社用PC', 'win32', appChrome);
        clip('パスワードリセットのご案内メールを送信しました', 30, null, null, appOutlook);
        clip('本件、了解しました。明日中に対応します。', 33, '自宅iMac', 'darwin', appTeams);
        clip('print("Hello, world")', 49, null, null, appTerminal);
        clip('npm run build && npm run deploy', 50, null, null, appTerminal);
        clip("SELECT * FROM orders WHERE status = 'pending';", 53, '会社用PC', 'win32', appTerminal);
        clip('https://www.notion.so/example-team/EC-Renewal-Wiki', 56, null, null, appChrome);
        clip('会員登録数: 1,204件（9月時点）', 73, '会社用PC', 'win32', appExcel);
        clip('郵便番号: 150-0002', 76, null, null, appNotion);
        clip('次回定例は10/15(水) 14:00〜', 79, '自宅iMac', 'darwin', appTeams);
        clip('https://calendar.google.com/calendar/u/0/r/eventedit', 97, null, null, appChrome);
        clip('サーバーのIPアドレス: 192.168.1.50', 99, '会社用PC', 'win32', appTerminal);
        clip('本番反映は日曜の深夜に実施予定です', 102, null, null, appSlack);
        clip('デザインの微調整、ありがとうございました！', 121, '自宅iMac', 'darwin', appSlack);
        clip('テストユーザー: test@example.com / パスワード: Test1234!', 124, null, null, appNotion);
        clip('見積の有効期限は発行日から30日間です', 146, '会社用PC', 'win32', appWord);
        clip('https://github.com/example-team/ec-renewal/issues/58', 149, null, null, appChrome);
        clip('レスポンシブ対応、スマホ表示崩れの修正完了しました', 152, null, null, appSlack);
        clip('領収書の宛名は「株式会社サンプル」でお願いします', 169, '会社用PC', 'win32', appOutlook);
        clip('本日の作業時間: 6.5h', 171, null, null, appNotion);
        clip('Wi-Fiパスワード: sample-wifi-pass-2026', 174, '自宅iMac', 'darwin', appNotion);
        clip('打ち合わせ議事録のリンクを共有します: https://notion.so/xxxx', 194, '自宅iMac', 'darwin', appTeams);
        clip('来週の月曜は祝日のため定例をお休みします', 197, null, null, appTeams);
        clip('決済APIのサンドボックスキー: sk_test_xxxxxxxx', 217, null, null, appTerminal);
        clip('10月からインボイス対応の請求書フォーマットに変更します', 220, '会社用PC', 'win32', appExcel);
        clip('https://www.google.com/maps/place/渋谷ビル', 240, null, null, appChrome);
        // クリップ画像も同じ期間に合わせて増量 (棒グラフ・地図・エラー画面など、
        // 実際にコピーしそうな種類をひととおり用意する)
        const clipImage = (name, hoursAgo, device, platform, app) =>
          win.webContents.send('clipboard-item', {
            type: 'clipboard-image',
            path: path.join(__dirname, 'assets/demo/' + name),
            timestamp: Date.now() - hoursAgo * HOUR,
            fromDevice: device || undefined,
            fromPlatform: platform || undefined,
            sourceApp: app,
          });
        clipImage('clipboard_2026-09-14_15-40-00.png', 6, '会社用PC', 'win32', appExcel);
        clipImage('clipboard_2026-09-13_11-05-00.png', 28, null, null, appChrome);
        clipImage('clipboard_2026-09-12_09-20-00.png', 51, '自宅iMac', 'darwin', appChrome);
        clipImage('clipboard_2026-09-11_16-50-00.png', 74, null, null, appChrome);
        clipImage('clipboard_2026-09-10_13-10-00.png', 100, '会社用PC', 'win32', appExcel);
        clipImage('clipboard_2026-09-09_18-25-00.png', 122, '自宅iMac', 'darwin', appSlack);
        clipImage('clipboard_2026-09-08_10-15-00.png', 150, null, null, appFigma);
        clipImage('clipboard_2026-09-06_14-05-00.png', 195, '会社用PC', 'win32', appFigma);
        clipImage('clipboard_2026-09-05_09-45-00.png', 221, null, null, appWord);
        // ピン留め・タイトル編集も紹介用スクショに含めたいので、シード直後に1件ずつ適用する。
        // アイコン取得 (sips 起動) がアプリの数だけ増えた分、固定の待ち時間だと間に合わないことが
        // あるため、setTimeout を待ってから実行する形にして「全部 send し終わった後」を保証する
        // さらに増量 (フル稼働ユーザー想定: テキスト/画像/ファイルとも上限いっぱいまで積み上げ、
        // 古いものほど上限に近づいて押し出される直前、というリアルな状態にする)
        seedFile("assets/demo/障害報告書_0820.docx", { timestamp: Date.now() - 360 * HOUR }, appWord);
        seedFile("assets/demo/週次レポート_W36.pptx", { timestamp: Date.now() - 366 * HOUR }, appPowerPoint);
        seedFile("assets/demo/APIキー管理表.xlsx", { timestamp: Date.now() - 384 * HOUR }, appExcel);
        seedFile("assets/demo/リリースノート_v1.1.txt", { timestamp: Date.now() - 392 * HOUR }, appNotion);
        seedFile("assets/demo/バックアップ手順.txt", { timestamp: Date.now() - 408 * HOUR }, appTerminal);
        seedFile("assets/demo/要件定義書_v3.docx", { timestamp: Date.now() - 417 * HOUR }, appWord);
        seedFile("assets/demo/画面遷移図.png", { timestamp: Date.now() - 432 * HOUR }, appFigma);
        seedFile("assets/demo/週次レポート_W35.pptx", { timestamp: Date.now() - 437 * HOUR }, appPowerPoint);
        seedFile("assets/demo/commit-log_export.txt", { timestamp: Date.now() - 456 * HOUR }, appVSCode);
        seedFile("assets/demo/環境変数一覧_本番.xlsx", { timestamp: Date.now() - 463 * HOUR }, appExcel);
        seedFile("assets/demo/AIレビュー_コード規約案.txt", { timestamp: Date.now() - 480 * HOUR }, appClaude);
        seedFile("assets/demo/障害報告書_0806.docx", { timestamp: Date.now() - 486 * HOUR }, appWord);
        seedFile("assets/demo/見積書_ECサイト改修_v1.pdf", { timestamp: Date.now() - 504 * HOUR }, appExcel);
        seedFile("assets/demo/負荷試験結果.xlsx", { timestamp: Date.now() - 512 * HOUR }, appExcel);
        seedFile("assets/demo/週次レポート_W34.pptx", { timestamp: Date.now() - 528 * HOUR }, appPowerPoint);
        seedFile("assets/demo/ChatGPT_文言案_エラーメッセージ.txt", { timestamp: Date.now() - 533 * HOUR }, appChatGPT);
        seedFile("assets/demo/バナー案_B案.png", { timestamp: Date.now() - 552 * HOUR }, appFigma);
        seedFile("assets/demo/DB設計書_v2.docx", { timestamp: Date.now() - 559 * HOUR }, appWord);
        seedFile("assets/demo/リファクタリング計画.txt", { timestamp: Date.now() - 576 * HOUR }, appVSCode);
        seedFile("assets/demo/納品リスト_9月.xlsx", { timestamp: Date.now() - 585 * HOUR }, appExcel);
        seedFile("assets/demo/週次レポート_W33.pptx", { timestamp: Date.now() - 600 * HOUR }, appPowerPoint);
        seedFile("assets/demo/旧ロゴ_v2.png", { timestamp: Date.now() - 624 * HOUR }, appFigma);
        seedFile("assets/demo/引継ぎメモ_初期構築.txt", { timestamp: Date.now() - 648 * HOUR }, appNotion);
        seedFile("assets/demo/請求書_9月.pdf", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 362 * HOUR }, appExcel);
        seedFile("assets/demo/見積比較_他社_初回版.xlsx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 370 * HOUR }, appExcel);
        seedFile("assets/demo/障害報告書_0828.docx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 387 * HOUR }, appWord);
        seedFile("assets/demo/請求書送付リスト_9月.xlsx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 395 * HOUR }, appExcel);
        seedFile("assets/demo/契約書_業務委託_旧版.docx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 412 * HOUR }, appWord);
        seedFile("assets/demo/NDA_秘密保持契約_控え.pdf", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 420 * HOUR }, appWord);
        seedFile("assets/demo/経費精算_8月.xlsx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 434 * HOUR }, appExcel);
        seedFile("assets/demo/ロゴ_v3.png", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 441 * HOUR }, appFigma);
        seedFile("assets/demo/名刺デザイン案_旧.png", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 459 * HOUR }, appFigma);
        seedFile("assets/demo/請求書_8月.pdf", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 467 * HOUR }, appExcel);
        seedFile("assets/demo/見積比較_他社_最終版.xlsx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 484 * HOUR }, appExcel);
        seedFile("assets/demo/障害報告書_0815.docx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 490 * HOUR }, appWord);
        seedFile("assets/demo/VSCode拡張機能_推奨リスト.txt", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 506 * HOUR }, appVSCode);
        seedFile("assets/demo/Claude_議事録要約_0810.txt", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 513 * HOUR }, appClaude);
        seedFile("assets/demo/請求書送付リスト_8月.xlsx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 531 * HOUR }, appExcel);
        seedFile("assets/demo/デザインガイドライン_v1.pdf", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 539 * HOUR }, appFigma);
        seedFile("assets/demo/見積書_ECサイト改修_初版.pdf", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 556 * HOUR }, appExcel);
        seedFile("assets/demo/NDA_秘密保持契約_下書き.docx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 562 * HOUR }, appWord);
        seedFile("assets/demo/経費精算_7月.xlsx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 578 * HOUR }, appExcel);
        seedFile("assets/demo/バナー案_C案.png", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 585 * HOUR }, appFigma);
        seedFile("assets/demo/障害報告書_0801.docx", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 603 * HOUR }, appWord);
        seedFile("assets/demo/請求書_7月.pdf", { fromDevice: '会社用PC', fromPlatform: 'win32', timestamp: Date.now() - 624 * HOUR }, appExcel);
        seedFile("assets/demo/デザインガイドライン_v1.5.pdf", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 365 * HOUR }, appFigma);
        seedFile("assets/demo/テスト仕様書_カート機能.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 373 * HOUR }, appExcel);
        seedFile("assets/demo/契約更新のご案内_下書き.docx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 390 * HOUR }, appWord);
        seedFile("assets/demo/プロジェクト計画書_v1.pptx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 398 * HOUR }, appPowerPoint);
        seedFile("assets/demo/顧客リスト_8月版.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 415 * HOUR }, appExcel);
        seedFile("assets/demo/アイコンセット_v1.png", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 423 * HOUR }, appFigma);
        seedFile("assets/demo/テスト仕様書_検索機能.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 438 * HOUR }, appExcel);
        seedFile("assets/demo/契約更新のご案内_最終.docx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 446 * HOUR }, appWord);
        seedFile("assets/demo/プロジェクト計画書_v2.pptx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 464 * HOUR }, appPowerPoint);
        seedFile("assets/demo/顧客リスト_7月版.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 472 * HOUR }, appExcel);
        seedFile("assets/demo/Claude_提案文章_ドラフト.txt", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 487 * HOUR }, appClaude);
        seedFile("assets/demo/デザインガイドライン_初版.pdf", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 495 * HOUR }, appFigma);
        seedFile("assets/demo/テスト仕様書_ログイン機能.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 510 * HOUR }, appExcel);
        seedFile("assets/demo/VSCode_settings_export.txt", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 518 * HOUR }, appVSCode);
        seedFile("assets/demo/プロジェクト計画書_初版.pptx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 536 * HOUR }, appPowerPoint);
        seedFile("assets/demo/顧客リスト_6月版.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 544 * HOUR }, appExcel);
        seedFile("assets/demo/アイコンセット_v2.png", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 559 * HOUR }, appFigma);
        seedFile("assets/demo/ChatGPT_要件整理メモ.txt", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 567 * HOUR }, appChatGPT);
        seedFile("assets/demo/テスト仕様書_会員登録.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 582 * HOUR }, appExcel);
        seedFile("assets/demo/契約書_業務委託_ドラフト.docx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 590 * HOUR }, appWord);
        seedFile("assets/demo/プロジェクト計画書_議事録反映版.pptx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 608 * HOUR }, appPowerPoint);
        seedFile("assets/demo/顧客リスト_5月版.xlsx", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 616 * HOUR }, appExcel);
        seedFile("assets/demo/バナー案_初期検討.png", { fromDevice: '自宅iMac', fromPlatform: 'darwin', timestamp: Date.now() - 631 * HOUR }, appFigma);

        // クリップ (テキスト) もさらに増量: 直近の増量分より前 (10日〜17日前) まで密度を保って積む
        clip("npm install --save-dev @types/node", 244, null, null, appVSCode);
        clip("この関数、早期returnにリファクタリングして", 247, null, null, appClaude);
        clip("在庫連携バッチは毎日AM3:00に実行されます", 250, '会社用PC', 'win32', appNotion);
        clip("https://github.com/example-team/ec-renewal/pull/38", 253, null, null, appChrome);
        clip("クーポンコード: WELCOME10 (10%オフ)", 256, null, null, appNotion);
        clip("エラーメッセージをもっと丁寧な言い回しにできますか", 259, null, null, appChatGPT);
        clip("git rebase -i HEAD~3", 262, null, null, appTerminal);
        clip("決済代行会社のサポート窓口: 0120-xxx-xxx", 265, '会社用PC', 'win32', appOutlook);
        clip("次スプリントのゴール: カート離脱率を5%改善", 268, '自宅iMac', 'darwin', appTeams);
        clip("SELECT COUNT(*) FROM users WHERE created_at > '2026-09-01';", 271, null, null, appTerminal);
        clip("ロゴのカラーコード: #2E2E30 / #FF7A3E", 274, null, null, appFigma);
        clip("https://www.notion.so/example-team/QA-Checklist", 277, null, null, appChrome);
        clip("この見積の内訳、妥当かチェックしてもらえますか", 280, '会社用PC', 'win32', appChatGPT);
        clip("配送料の無料ラインを¥5,000→¥3,000に変更予定", 283, null, null, appNotion);
        clip("docker compose up -d --build", 286, null, null, appTerminal);
        clip("会員登録フォームのバリデーションエラー文言一覧", 289, '自宅iMac', 'darwin', appWord);
        clip("次回定例は9/29(火) 15:00〜", 292, null, null, appTeams);
        clip("https://api.example.com/v2/products?category=new", 295, null, null, appChrome);
        clip("このSQLのインデックス、貼るべき箇所ある？", 298, null, null, appClaude);
        clip("領収書番号: INV-2026-0912", 301, '会社用PC', 'win32', appExcel);
        clip("画像の書き出しは@2xでお願いします", 304, null, null, appFigma);
        clip("テストアカウント: qa-user01@example.com / Passw0rd!", 307, null, null, appNotion);
        clip("本番反映のロールバック手順を確認しておいてください", 310, '会社用PC', 'win32', appSlack);
        clip("npm run lint -- --fix", 313, null, null, appVSCode);
        clip("配送業者の変更、来月から適用予定です", 316, '自宅iMac', 'darwin', appTeams);
        clip("https://calendar.google.com/calendar/u/0/r", 319, null, null, appChrome);
        clip("郵便番号検索APIのレスポンス例を貼っておきます", 322, null, null, appNotion);
        clip("このエラーログの原因、推測できますか", 325, null, null, appClaude);
        clip("在庫アラートのメール送信先を追加してください", 328, '会社用PC', 'win32', appOutlook);
        clip("git stash && git pull --rebase && git stash pop", 331, null, null, appTerminal);
        clip("バナー差し替えのご確認、よろしくお願いします", 334, '自宅iMac', 'darwin', appOutlook);
        clip("https://www.figma.com/file/xyz789/Banner-v2", 337, null, null, appChrome);
        clip("会員ランク制度の割引率一覧表を作成しました", 340, null, null, appExcel);
        clip("この文章、もう少しカジュアルなトーンにできますか", 343, null, null, appChatGPT);
        clip("次のリリースはv1.3を予定しています", 346, '会社用PC', 'win32', appNotion);
        clip("npm run build -- --mode=production", 349, null, null, appVSCode);
        clip("決済APIのタイムアウト設定を10秒に延長しました", 352, null, null, appTerminal);
        clip("お問い合わせフォームの必須項目を見直したいです", 355, '自宅iMac', 'darwin', appSlack);
        clip("https://github.com/example-team/ec-renewal/issues/61", 358, null, null, appChrome);
        clip("週次定例の議題: リリース日、残タスク、リスク", 361, null, null, appNotion);
        clip("このコンポーネント、props設計を見直すべきか相談したい", 364, null, null, appClaude);
        clip("請求書のフォーマットをインボイス対応に更新済み", 367, '会社用PC', 'win32', appExcel);
        clip("画面収録のリンクを共有します", 370, null, null, appTeams);
        clip("パスワードポリシー: 英数記号混在12文字以上", 373, null, null, appNotion);
        clip("git checkout -b feature/coupon-v2", 376, null, null, appTerminal);
        clip("Figmaのコンポーネント名、命名規則に揃えてください", 379, '自宅iMac', 'darwin', appFigma);
        clip("https://docs.google.com/document/d/xxxx/edit", 382, null, null, appChrome);
        clip("この関数のテストケース、網羅できてますか", 385, null, null, appChatGPT);
        clip("配送状況APIのモックデータを用意しました", 388, null, null, appVSCode);
        clip("来月のキャンペーン企画案を送ります", 391, '会社用PC', 'win32', appOutlook);
        clip("SELECT * FROM orders WHERE total > 10000 ORDER BY created_at DESC;", 394, null, null, appTerminal);
        clip("デザインカンプの差分、確認しました", 397, '自宅iMac', 'darwin', appSlack);
        clip("https://www.notion.so/example-team/Release-Note-v1.3", 400, null, null, appChrome);
        clip("この設計の懸念点、洗い出してもらえますか", 403, null, null, appClaude);
        clip("経費精算のフォーマット変更、周知済みです", 406, null, null, appNotion);
        clip("npm test -- --coverage", 409, null, null, appVSCode);
        clip("会員データのCSVエクスポート、明日中に対応します", 412, '会社用PC', 'win32', appExcel);
        clip("この関数名、もっと意図が伝わる名前にリネームして", 415, null, null, appVSCode);

        // クリップ画像もさらに増量: コードスニペット・AIとのやり取り・カンバン・カレンダーなど
        clipImage("clipboard_2026-09-04_10-20-00.png", 245, '会社用PC', 'win32', appExcel);
        clipImage("clipboard_2026-09-03_16-40-00.png", 268, null, null, appVSCode);
        clipImage("clipboard_2026-09-02_11-10-00.png", 292, null, null, appChatGPT);
        clipImage("clipboard_2026-09-01_09-30-00.png", 316, '自宅iMac', 'darwin', appNotion);
        clipImage("clipboard_2026-08-31_14-50-00.png", 340, null, null, appVSCode);
        clipImage("clipboard_2026-08-30_10-05-00.png", 364, null, null, appNotion);
        clipImage("clipboard_2026-08-29_17-15-00.png", 388, '会社用PC', 'win32', appTerminal);
        clipImage("clipboard_2026-08-28_13-25-00.png", 412, null, null, appExcel);
        clipImage("clipboard_2026-08-27_09-40-00.png", 436, null, null, appClaude);
        clipImage("clipboard_2026-08-26_15-55-00.png", 460, '自宅iMac', 'darwin', appNotion);
        clipImage("clipboard_2026-08-25_11-05-00.png", 484, null, null, appVSCode);
        clipImage("clipboard_2026-08-24_16-20-00.png", 508, '会社用PC', 'win32', appVSCode);
        clipImage("clipboard_2026-08-23_10-35-00.png", 532, null, null, appTeams);
        clipImage("clipboard_2026-08-22_14-45-00.png", 556, null, null, appTerminal);
        clipImage("clipboard_2026-08-21_09-50-00.png", 580, '自宅iMac', 'darwin', appExcel);
        clipImage("clipboard_2026-08-20_15-05-00.png", 604, null, null, appChatGPT);
        clipImage("clipboard_2026-08-19_11-15-00.png", 628, '会社用PC', 'win32', appNotion);
        clipImage("clipboard_2026-08-18_16-30-00.png", 652, null, null, appVSCode);
        clipImage("clipboard_2026-08-17_10-40-00.png", 676, null, null, appNotion);
        clipImage("clipboard_2026-08-16_14-55-00.png", 700, '自宅iMac', 'darwin', appTerminal);
        await new Promise((r) => setTimeout(r, 300));
        win.webContents.executeJavaScript(`
            (function () {
              // clip-text の name はコピー本文そのものになるため、ファイル名のキーワードが
              // 別のクリップ本文に偶然含まれて誤爆することがある (例:「契約書」を含む Word の
              // クリップ本文と、ファイル名が「契約書...」のファイル)。file だけに絞って探す
              const findFile = (keyword) => items.find((it) => it.kind === 'file' && it.name && it.name.includes(keyword));
              // ボリューム増量で「見積書_...v1/初版」等の類似名を追加したため、括弧なしの
              // 短い部分一致 ('見積書' など) は増量後の同名バリエーションと誤爆する。
              // 常に拡張子まで含めた一意な部分文字列で狙う
              const mtg = findFile('議事録_1010');
              if (mtg) {
                mtg.customTitle = '10/10 定例MTG（要リリース日確認）';
                mtg.timestamp = Date.now() - 4 * 3600000;
              }
              // Main 側は「ローカル生まれ (fromDevice なし) の add-file」には origin.timestamp を
              // 渡さない仕様 (実プロダクトでは常に「今」でよいため)。撮影用にここで直接上書きする
              const schedule = findFile('進行スケジュール.csv');
              if (schedule) schedule.timestamp = Date.now() - 2 * 86400000;
              const contract = findFile('契約書_業務委託.docx');
              if (contract) contract.timestamp = Date.now() - 26 * 3600000;
              const proposal = findFile('提案資料');
              if (proposal) proposal.timestamp = Date.now() - 122 * 3600000;
              // ローカル生まれの file はすべて同じ理由 (origin.timestamp が無視される) で
              // 過去日時の指定が効かない。以前追加した分 (以下7件) にも上書き漏れがあったため
              // まとめてここで補正する
              { const f = findFile('サーバー移行手順.txt'); if (f) f.timestamp = Date.now() - 7 * 3600000; }
              { const f = findFile('サイトマップ.pdf'); if (f) f.timestamp = Date.now() - 78 * 3600000; }
              { const f = findFile('デプロイスクリプト.txt'); if (f) f.timestamp = Date.now() - 9 * 3600000; }
              { const f = findFile('顧客対応マニュアル.docx'); if (f) f.timestamp = Date.now() - 147 * 3600000; }
              { const f = findFile('KPIダッシュボード.png'); if (f) f.timestamp = Date.now() - 193 * 3600000; }
              { const f = findFile('アクセス権限一覧.xlsx'); if (f) f.timestamp = Date.now() - 240 * 3600000; }
              { const f = findFile('週次レポート_W37.pptx'); if (f) f.timestamp = Date.now() - 316 * 3600000; }
              // 増量分のローカル生まれファイルも同様にここでまとめて過去日時に上書きする
              { const f = findFile("障害報告書_0820.docx"); if (f) f.timestamp = Date.now() - 360 * 3600000; }
              { const f = findFile("週次レポート_W36.pptx"); if (f) f.timestamp = Date.now() - 366 * 3600000; }
              { const f = findFile("APIキー管理表.xlsx"); if (f) f.timestamp = Date.now() - 384 * 3600000; }
              { const f = findFile("リリースノート_v1.1.txt"); if (f) f.timestamp = Date.now() - 392 * 3600000; }
              { const f = findFile("バックアップ手順.txt"); if (f) f.timestamp = Date.now() - 408 * 3600000; }
              { const f = findFile("要件定義書_v3.docx"); if (f) f.timestamp = Date.now() - 417 * 3600000; }
              { const f = findFile("画面遷移図.png"); if (f) f.timestamp = Date.now() - 432 * 3600000; }
              { const f = findFile("週次レポート_W35.pptx"); if (f) f.timestamp = Date.now() - 437 * 3600000; }
              { const f = findFile("commit-log_export.txt"); if (f) f.timestamp = Date.now() - 456 * 3600000; }
              { const f = findFile("環境変数一覧_本番.xlsx"); if (f) f.timestamp = Date.now() - 463 * 3600000; }
              { const f = findFile("AIレビュー_コード規約案.txt"); if (f) f.timestamp = Date.now() - 480 * 3600000; }
              { const f = findFile("障害報告書_0806.docx"); if (f) f.timestamp = Date.now() - 486 * 3600000; }
              { const f = findFile("見積書_ECサイト改修_v1.pdf"); if (f) f.timestamp = Date.now() - 504 * 3600000; }
              { const f = findFile("負荷試験結果.xlsx"); if (f) f.timestamp = Date.now() - 512 * 3600000; }
              { const f = findFile("週次レポート_W34.pptx"); if (f) f.timestamp = Date.now() - 528 * 3600000; }
              { const f = findFile("ChatGPT_文言案_エラーメッセージ.txt"); if (f) f.timestamp = Date.now() - 533 * 3600000; }
              { const f = findFile("バナー案_B案.png"); if (f) f.timestamp = Date.now() - 552 * 3600000; }
              { const f = findFile("DB設計書_v2.docx"); if (f) f.timestamp = Date.now() - 559 * 3600000; }
              { const f = findFile("リファクタリング計画.txt"); if (f) f.timestamp = Date.now() - 576 * 3600000; }
              { const f = findFile("納品リスト_9月.xlsx"); if (f) f.timestamp = Date.now() - 585 * 3600000; }
              { const f = findFile("週次レポート_W33.pptx"); if (f) f.timestamp = Date.now() - 600 * 3600000; }
              { const f = findFile("旧ロゴ_v2.png"); if (f) f.timestamp = Date.now() - 624 * 3600000; }
              { const f = findFile("引継ぎメモ_初期構築.txt"); if (f) f.timestamp = Date.now() - 648 * 3600000; }
              // ピン留めするクリップには、社内ルール (タイトル化したものは【】で囲む) に沿って
              // customTitle を付ける。見積書ではなく「頻繁に参照/送信する定型情報」を並べる
              // (出身アプリだけでの判定は同じアプリのクリップが増えると衝突するため、
              // 本文の一意な部分文字列で絞る)
              const signature = items.find((it) => it.kind === 'clip-text' && it.text && it.text.startsWith('-------------------'));
              if (signature) {
                signature.pinned = true;
                signature.customTitle = '【メール署名（社内向け）】';
              }
              const findText = (keyword) => items.find((it) => it.kind === 'clip-text' && it.text && it.text.includes(keyword));
              // テストアカウントは本文が長く、リストで見切れてしまうためピン留めから外した
              const paymentKey = findText('sk_test_xxxxxxxx');
              if (paymentKey) {
                paymentKey.pinned = true;
                paymentKey.customTitle = '【決済API サンドボックスキー】';
              }
              const wifi = findText('Wi-Fiパスワード: sample-wifi');
              if (wifi) {
                wifi.pinned = true;
                wifi.customTitle = '【社内Wi-Fi パスワード】';
              }
              render();
            })();
          `);
        }
        })();
        devHoldOpen = true;
        // focus: true にしておかないとウインドウが「非アクティブ」扱いのままで、
        // macOS の vibrancy (すりガラス) が暗くくすんだ配色になり、スクリーンショット映えが悪い
        expandShelter({ focus: true });
        if (process.env.BRIDGE_DEV_SEED === 'settings') win.webContents.send('open-settings');
        // デバイス絞り込み機能の紹介スクショ用: 「会社用PC」由来だけに絞った状態で開く
        if (process.env.BRIDGE_DEV_SEED === 'devicefilter') {
          setTimeout(() => {
            win.webContents.executeJavaScript(`setDeviceFilter('会社用PC'); render();`);
          }, 400);
        }
        if (process.env.BRIDGE_DEV_SEED === 'keystroke') {
          // ⌘V 送信の自己テスト: 自分の検索欄をキーにして送り、入ったかを読む (他アプリには影響しない)
          setTimeout(() => {
            expandShelter({ focus: true });
            setTimeout(() => {
              writeTextToClipboard('bridge-paste-test');
              console.log('KEYSTROKE_SENT ' + sendPasteKeystroke());
              setTimeout(() => {
                win.webContents.executeJavaScript('document.getElementById("search-bar").value').then((v) => {
                  console.log('KEYSTROKE_RESULT ' + JSON.stringify(v) + ' focused=' + win.isFocused());
                });
              }, 900);
            }, 400);
          }, 1200);
        }
        if (process.env.BRIDGE_DEV_SEED === 'transfer') {
          // 進捗 → 停滞 → stalled 表示の確認用。実際のダウンロードは走らせず IPC だけ模擬する
          const id = 'dev-transfer-1';
          win.webContents.send('sync-pending', {
            syncId: id,
            kind: 'file',
            name: 'huge-archive.zip',
            timestamp: Date.now(),
            fromDevice: 'Win-Desk',
            fromPlatform: 'win32',
            originKind: null,
          });
          const total = 2.5 * 1024 * 1024 * 1024;
          let received = 0;
          const tick = setInterval(() => {
            received += total * 0.03;
            win.webContents.send('sync-progress', { syncId: id, received: Math.min(received, total), total });
            if (received >= total * 0.4) {
              clearInterval(tick); // ここで止める → 8 秒後に stalled 表示になるはず
              console.log('DEV_TRANSFER_STALL_START');
            }
          }, 400);
        }
        if (process.env.BRIDGE_DEV_SEED === 'sync') {
          // 同期中プレースホルダの確認: メタデータだけ先に出し、3 秒後に実体 (このリポジトリのファイル) を流し込む
          const fakeId = 'dev-sync-1';
          sendSyncPlaceholder({
            id: fakeId,
            type: 'file',
            name: 'Quarterly-Report.pdf',
            timestamp: Date.now() - 5 * 60 * 1000,
            fromDevice: 'Win-Desk',
            fromPlatform: 'win32',
            originKind: null,
          });
          sendSyncPlaceholder({
            id: 'dev-sync-2',
            type: 'file',
            name: 'Photos.zip',
            timestamp: Date.now() - 2 * 60 * 1000,
            fromDevice: 'Win-Desk',
            fromPlatform: 'win32',
            originKind: 'folder',
            folderName: 'Photos',
          });
          setTimeout(() => {
            announcedSyncPlaceholders.delete(fakeId);
            addFileQuietly(path.join(__dirname, 'SPEC.md'), {
              id: fakeId,
              fromDevice: 'Win-Desk',
              fromPlatform: 'win32',
              timestamp: Date.now() - 5 * 60 * 1000,
            });
            console.log('DEV_SYNC_RESOLVED');
          }, 3000);
        }
        if (process.env.BRIDGE_DEV_SEED === 'folder') {
          // フォルダ zip の往復: lib/ を zip 化 → 展開 → 結果を出力
          (async () => {
            try {
              const zipPath = await zipFolder(path.join(__dirname, 'lib'));
              const dest = await extractFolderZip(zipPath, 'lib');
              const listing = fs.readdirSync(dest);
              console.log('DEV_FOLDER ' + JSON.stringify({ zipPath, dest, listing }));
              fs.rmSync(dest, { recursive: true, force: true });
              fs.unlinkSync(zipPath);
            } catch (err) {
              console.log('DEV_FOLDER_ERROR ' + err.message);
            }
          })();
        }
        if (process.env.BRIDGE_DEV_SEED === 'popup') {
          // 永続化の一覧が届いてからポップアップを出し、その座標を出力する
          setTimeout(() => {
            showPastePopup();
            setTimeout(() => {
              console.log('POPUP_BOUNDS ' + JSON.stringify(popupWin.getBounds()));
              console.log('AX_TRUSTED ' + systemPreferences.isTrustedAccessibilityClient(false));
            }, 600);
          }, 1200);
        }
        if (process.env.BRIDGE_DEV_SEED === 'collapse') {
          // 格納アニメーションの途中と終了後の矩形を出力する (画面外スライドの検証用)
          setTimeout(() => {
            devHoldOpen = false;
            collapseShelterNow();
            setTimeout(() => console.log('DEV_MID ' + JSON.stringify(win.getBounds())), 120);
            setTimeout(() => console.log('DEV_END ' + JSON.stringify(win.getBounds())), 900);
          }, 1200);
        }
        setTimeout(() => {
          console.log('BRIDGE_BOUNDS ' + JSON.stringify(win.getBounds()) + ' visible=' + win.isVisible());
          if (process.env.BRIDGE_DEV_EVAL) {
            win.webContents.executeJavaScript(process.env.BRIDGE_DEV_EVAL).then((v) => console.log('BRIDGE_EVAL ' + JSON.stringify(v)));
          }
          // BRIDGE_DEV_SHOT=<path> なら Renderer の描画内容 (vibrancy 抜き) を PNG に保存する
          if (process.env.BRIDGE_DEV_SHOT) {
            win.webContents.capturePage().then((img) => {
              fs.writeFileSync(process.env.BRIDGE_DEV_SHOT, img.toPNG());
              console.log('BRIDGE_SHOT_SAVED');
            });
          }
        }, 700);
      }, 800);
    });
    // Renderer 側のエラーを標準出力へ流す
    win.webContents.on('console-message', (details) => {
      const level = details && details.level;
      if (level === 'error' || level === 'warning') console.log('RENDERER ' + details.message);
    });
  }

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
