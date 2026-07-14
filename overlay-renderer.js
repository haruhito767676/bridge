// 全画面キャプチャオーバーレイの入力捕捉ロジック (マウス系のみ)。
//
// ネイティブなグローバル入力フックは使わず、Pointer Lock API + 通常の DOM イベントだけで
// host 側のマウスを「奪う」。このウインドウが画面全体を覆い・最前面・フォーカス保持で
// あること自体が、下のアプリへ入力が漏れないことを保証する。
//
// キーボードは Renderer では扱わない: Main プロセスが overlay webContents の
// before-input-event で横取りする (メニューアクセラレータの無効化と、フォーカス/
// Pointer Lock の状態に依存しない確実な捕捉のため。main.js 参照)。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、mousemove は間引かずに
// 生イベントをそのまま即座に IPC 送信する。

const root = document.getElementById('overlay-root');
const bannerDevice = document.getElementById('overlay-banner-device');

let active = false; // overlay-activate 〜 overlay-deactivate の間だけ true
let intentionalUnlock = false; // exitPointerLock を自分で呼んだ直後かどうか
let lockRetryTimer = null;

// Pointer Lock の要求はウインドウの表示/フォーカス遷移中だと失敗しうる
// (pointerlockerror)。失敗しても諦めず、アクティブな間は短い間隔で再試行し続ける。
// なおロックが取れていない間も mousemove の movementX/Y は届くため、マウス転送
// 自体は動き続ける (ロックの目的はカーソルを画面端で止めないことと誤操作防止)
function scheduleLockRetry() {
  if (!active || lockRetryTimer !== null) return;
  lockRetryTimer = setTimeout(() => {
    lockRetryTimer = null;
    requestLock();
  }, 250);
}

function cancelLockRetry() {
  if (lockRetryTimer !== null) {
    clearTimeout(lockRetryTimer);
    lockRetryTimer = null;
  }
}

function requestLock() {
  if (!active || document.pointerLockElement === root) return;
  try {
    // Chromium の requestPointerLock は Promise を返す (拒否は pointerlockerror と等価)
    const result = root.requestPointerLock();
    if (result && typeof result.catch === 'function') {
      result.catch(() => scheduleLockRetry());
    }
  } catch {
    scheduleLockRetry();
  }
}

document.addEventListener('pointerlockerror', () => scheduleLockRetry());

// フォーカスを取り戻した瞬間はロック再取得の好機 (フォーカスなしでは必ず失敗する)
window.addEventListener('focus', () => {
  if (active) requestLock();
});

window.bridge.onOverlayActivate(({ device }) => {
  active = true;
  bannerDevice.textContent = device || '';
  root.focus();
  requestLock();
});

window.bridge.onOverlayDeactivate(() => {
  active = false;
  intentionalUnlock = true;
  cancelLockRetry();
  if (document.pointerLockElement === root) document.exitPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === root) return; // ロック取得は何もしなくてよい
  if (!active) return; // 非アクティブ時の解除は正常系 (deactivate 経由)
  if (intentionalUnlock) {
    intentionalUnlock = false;
    return;
  }
  // Pointer Lock はユーザーの Escape 押下以外の理由 (フォーカス喪失など) でも
  // ブラウザによって解除されうる仕様のため、解除理由を Escape と決め打ちして
  // 実キーを合成送信することはしない (target への誤ったキー注入を避ける)。
  // ロックだけは即座に再要求して操作の継続性を保つ
  requestLock();
});

// ロックが未確立でも movementX/Y は通常の mousemove に載って届くため転送する。
// (未確立の間はカーソルが画面端に達すると movement が 0 になるという劣化はあるが、
// 「まったく動かない」よりはるかによい。ロック自体は上のリトライで回復を図る)
document.addEventListener('mousemove', (e) => {
  if (!active) return;
  if (e.movementX === 0 && e.movementY === 0) return;
  window.bridge.overlaySendMouseMove(e.movementX, e.movementY);
});

const BUTTON_NAMES = { 0: 'left', 1: 'middle', 2: 'right' };

document.addEventListener('mousedown', (e) => {
  if (!active) return;
  e.preventDefault();
  requestLock(); // クリックはユーザージェスチャなのでロック再取得の確実な好機
  const button = BUTTON_NAMES[e.button];
  if (button) window.bridge.overlaySendMouseButton(button, 'down');
});

document.addEventListener('mouseup', (e) => {
  if (!active) return;
  e.preventDefault();
  const button = BUTTON_NAMES[e.button];
  if (button) window.bridge.overlaySendMouseButton(button, 'up');
});

document.addEventListener('contextmenu', (e) => {
  if (active) e.preventDefault();
});

document.addEventListener('wheel', (e) => {
  if (!active) return;
  e.preventDefault();
  window.bridge.overlaySendWheel(e.deltaX, e.deltaY);
}, { passive: false });
