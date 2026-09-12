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
  syncMetadata,
  compareVersions,
} = require('./lib/sync-utils');

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
}

function setSyncPaused(paused) {
  syncPaused = Boolean(paused);
  lastSyncStatusKey = '';
  broadcastSyncStatus();
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
  win.setBounds(dockedBoundsForDisplay(display, shown), false);
}

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
  // blur() (orderBack) ではキーウインドウを手放さないため、一度隠して非アクティブで出し直す。
  // 常に表示されているつまみが 1 フレーム消えるだけで、次のキー入力は元のアプリへ戻る
  win.hide();
  win.showInactive();
}

// focus: true は明示的な呼び出し (ホットキー等)。展開後に検索バーへフォーカスする
function expandShelter({ focus = false } = {}) {
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
  const display = currentDisplay();
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

function startEdgeRevealWatcher() {
  // Windows ではカーソル座標を使った開閉判定を一切行わない (DPI の異なるモニター間で座標系が
  // 食い違うと、展開 → 強制格納 → 再展開の無限ループになる)。開閉は Renderer 自身の
  // ホバーイベント (つまみへの滞留 / ウインドウからの離脱) だけで決める
  if (IS_WINDOWS) return;
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
      accelerator: TOGGLE_SHORTCUT,
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
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
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
    sourceApp: sourceApp || null,
  };
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
  'Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint procId);\' -Name Win32 -Namespace Native | Out-Null',
  '$hwnd = [Native.Win32]::GetForegroundWindow()',
  '$procId = 0',
  '[Native.Win32]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null',
  '(Get-Process -Id $procId).Path',
].join('; ');

async function getFrontmostAppWindows() {
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', WIN_FRONT_APP_PS],
    { timeout: 2000, windowsHide: true }, // コンソール窓を一瞬でも出さない
  );
  const exePath = stdout.trim();
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
let lastImageSignature = '';

async function pollClipboard() {
  if (clipboardPolling) return; // 画像保存中に次のポーリングが重ならないようにする
  clipboardPolling = true;
  try {
    // 「監視を一時停止」中は履歴に載せない。基準値だけ追従させ、再開した瞬間に
    // 停止中にコピーした内容がまとめて載ることを防ぐ
    if (clipboardPaused) {
      lastClipText = clipboard.readText();
      lastClipFileKey = readCopiedFilePaths().join('\n');
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

    // ファイル: Finder で ⌘C されたファイルを最優先で検知し、リストへ自動追加する。
    // ファイルコピー時はパス文字列などの付随テキストも載るため、その tick の
    // テキスト/画像判定はスキップして誤検知 (偽のテキスト履歴) を防ぐ
    const copiedFiles = readCopiedFilePaths();
    if (copiedFiles.length > 0) {
      const key = copiedFiles.join('\n');
      if (key !== lastClipFileKey) {
        lastClipFileKey = key;
        lastClipText = clipboard.readText(); // 付随テキストを履歴に入れない
        const sourceApp = await getFrontmostApp();
        for (const p of copiedFiles) {
          if (fs.existsSync(p)) addFileQuietly(p, null, sourceApp);
        }
      }
      return;
    }
    lastClipFileKey = '';

    // テキスト: 前回と異なる非空テキストなら履歴へ。
    // ドラッグアウト用の .txt はここでは作らず、実際にドラッグ / プレビューされたときに
    // 初めて生成する (コピーのたびにディスクへ書かない)
    const text = clipboard.readText();
    if (text !== lastClipText) {
      lastClipText = text;
      if (text && text.trim()) {
        const entry = {
          type: 'clipboard-text',
          text,
          path: null,
          timestamp: Date.now(),
          fromDevice: deviceName,
          fromPlatform: process.platform,
          sourceApp: await getFrontmostApp(),
        };
        pushClipHistory(entry);
        sendClipboardItem(entry);
        // 同期台帳へ登録し、オンラインの他拠点へ即時プッシュする
        registerLocalSyncEntry({ type: 'text', text, timestamp: entry.timestamp });
      }
    }

    // 画像: 形式チェックを先に行い、画像が無いときの readImage デコードを避ける
    const formats = clipboard.availableFormats();
    const hasImage = formats.some((f) => f.startsWith('image/'));
    if (hasImage) {
      // 安価な署名が前回と同じなら、デコードもハッシュもせずに終える
      const signature = clipboardImageSignature(formats);
      if (signature === lastImageSignature) return;
      lastImageSignature = signature;

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
            sourceApp: await getFrontmostApp(),
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
      lastImageSignature = '';
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
    const formats = clipboard.availableFormats();
    if (formats.some((f) => f.startsWith('image/'))) {
      lastImageSignature = clipboardImageSignature(formats);
      const image = clipboard.readImage();
      lastClipImageKey = image.isEmpty() ? '' : imageKey(image);
    }
    lastClipFileKey = readCopiedFilePaths().join('\n');
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
  const script = `Set-Clipboard -LiteralPath @(${paths.map(psLiteral).join(',')})`;
  return execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
  });
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

// 前回クラッシュ等で履歴に残らなかった裏生成ファイル (clipboard_*.png / snippet_*.txt) を起動時に片付ける。
// ユーザーがドロップした実ファイルや Web ダウンロードはこの命名ではないため対象にならない
function sweepOrphanTempFiles(keep) {
  let names;
  try {
    names = fs.readdirSync(downloadDir());
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^(clipboard_\d+|snippet_\d+)(-\d+)?\.(png|txt)$/.test(name)) continue;
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
  globalShortcut.unregisterAll();
  if (popupAlive()) popupWin.destroy();
  // 最後の一覧を必ず書き出してから、リストに残っていない裏生成ファイルを掃除する
  if (historyWriteTimer) clearTimeout(historyWriteTimer);
  for (const p of sessionTempFiles) {
    if (retainedPaths.has(p)) continue;
    try {
      fs.unlinkSync(p);
    } catch {
      // 既に削除済み・アクセス不可などは無視 (掃除が目的なので失敗しても続行)
    }
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
    // iconType: 自端末のハードウェアアイコン種別。未知の値は無視してフォールバックに委ねる
    if (typeof parsed.iconType === 'string' && ALLOWED_ICON_TYPES.includes(parsed.iconType)) {
      myIconType = parsed.iconType;
    }
    if (typeof parsed.autoPaste === 'boolean') autoPasteEnabled = parsed.autoPaste;
    if (typeof parsed.showSourceApp === 'boolean') showSourceApp = parsed.showSourceApp;
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
function registerLocalSyncEntry({ type, name, text, path: filePath, timestamp }) {
  if (syncPaused) return null; // 一時停止中に生まれたアイテムは、再開後も同期しない (意図的)
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
      // 相手側で実体が既に消えている (404) なら、待っても届かない。既読にして先へ進む
      // (ここで false を返し続けると lastSyncedTs が進まず、以後の新着まで全部止まってしまう)
      if (err && err.statusCode === 404) {
        logEvent('sync', `実体なしでスキップ: ${entry.name} from ${peer.device || peer.host}`);
        rememberSyncId(entry.id);
        return true;
      }
      console.error('同期ファイルの転送に失敗 (次回ポーリングで再試行):', entry.name, err.message);
      logEvent('sync', `受信失敗: ${entry.name} from ${peer.device || peer.host} (${err.message})`);
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
  for (const peer of knownPeers.values()) pollPeer(peer);
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
    if (!peer.online) continue; // オフラインのピアへは再接続後の差分ポーリングで届く
    httpPostJson(peer.host, peer.port, '/push', payload).catch((err) => {
      if (peer.online) logEvent('peer', `プッシュ失敗: ${peer.device || peer.host} (${err && err.message})`);
      peer.online = false;
      peer.lastError = err && err.message ? err.message : 'プッシュに失敗';
    });
  }
}

// ---- 同期サーバー (node:http、外部パッケージ不使用) ----

function respondJson(res, obj) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
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

// ---- 設定の読み書き (sync-config.json を GUI から編集する) ----

ipcMain.handle('get-settings', () => ({
  deviceName,
  iconType: myIconType,
  secretToken: syncConfig.secretToken,
  autoScan: syncConfig.autoScan,
  peers: syncConfig.peers.slice(),
  port: syncConfig.port,
  openAtLogin: app.getLoginItemSettings().openAtLogin,
  hotkeyLabel: TOGGLE_SHORTCUT_LABEL,
  pasteHotkeyLabel: PASTE_SHORTCUT_LABEL,
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
  return { ok: true };
});

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
    }));
}

function showPastePopup() {
  if (!popupAlive()) createPopupWindow();
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
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")'],
      { windowsHide: true },
      () => {}
    );
    return true;
  }
  return false;
}

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
  hidePastePopup();
  if (!ok) return;
  // シェルフがキーウインドウのままだと ⌘V が Bridge 自身に届くので、先に返しておく
  releaseFocus();
  // ポップアップが閉じて前のアプリに入力が戻るのを待ってからキーを送る
  if (autoPasteEnabled) setTimeout(sendPasteKeystroke, 150);
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

// ---- グローバルホットキー (パネルの表示/非表示トグル) ----
// ホバー展開は「マウスが右端に行ったついで」の受動的な導線なので、意図して呼び出す主導線として
// ホットキーを用意する。ホットキーで開いたときだけ検索バーにフォーカスし、そのまま打ち始められる。
// macOS: ⌥Space (既定で未割り当て) / Windows・Linux: Ctrl+Shift+Space
const TOGGLE_SHORTCUT = process.platform === 'darwin' ? 'Alt+Space' : 'Ctrl+Shift+Space';
const TOGGLE_SHORTCUT_LABEL = process.platform === 'darwin' ? '⌥Space' : 'Ctrl+Shift+Space';

function registerToggleShortcut() {
  try {
    const ok = globalShortcut.register(TOGGLE_SHORTCUT, () => {
      if (!winAlive()) return;
      if (!expanded) placeOnCursorDisplay(false);
      toggleShelter();
    });
    if (!ok) console.error('ホットキーの登録に失敗 (他のアプリが使用中):', TOGGLE_SHORTCUT);
    const okPaste = globalShortcut.register(PASTE_SHORTCUT, () => togglePastePopup());
    if (!okPaste) console.error('ホットキーの登録に失敗 (他のアプリが使用中):', PASTE_SHORTCUT);
  } catch (err) {
    console.error('ホットキーの登録に失敗:', err);
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return; // 多重起動の第2インスタンスは何も起動せず quit を待つ
  // メニューバー常駐のユーティリティなので Dock と ⌘Tab には出さない
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  createWindow();
  createTray();
  registerToggleShortcut();
  startClipboardWatcher();
  startEdgeRevealWatcher();
  startDeviceSync();
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
        const seedFile = (name) => win.webContents.send('add-file', addFilePayload(path.join(__dirname, name)));
        if (process.env.BRIDGE_DEV_SEED !== 'restore') {
        seedFile('icon.png');
        seedFile('README.md');
        win.webContents.send('add-file', {
          ...addFilePayload(path.join(__dirname, 'SPEC.md')),
          fromDevice: 'Win-Desk',
          fromPlatform: 'win32',
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: 'Apple らしさは見た目より先に「動き」で決まります。ここが今いちばん純正と差がある部分です。',
          timestamp: Date.now() - 60000,
          sourceApp: { name: 'Notes', icon: null },
        });
        win.webContents.send('clipboard-item', {
          type: 'clipboard-text',
          text: 'https://developer.apple.com/design/human-interface-guidelines/',
          timestamp: Date.now() - 3600000 * 30,
          fromDevice: 'MacBook',
          fromPlatform: 'darwin',
        });
        }
        devHoldOpen = true;
        expandShelter();
        if (process.env.BRIDGE_DEV_SEED === 'settings') win.webContents.send('open-settings');
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
