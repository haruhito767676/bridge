// 全画面キャプチャオーバーレイの入力捕捉ロジック (マウス系のみ)。
//
// マウスの移動量取得元は mouseMode によって切り替わる:
// - 'native' (既定): Main プロセスが mouse-capture.js (uiohook-napi + 再センタリング)
//   で直接捕捉し、TCP へ送出する。Renderer はこの経路には一切関与しない
//   (mousemove リスナーは native モードでは overlaySendMouseMove を呼ばない)。
// - 'pointer-lock' (フォールバック): ネイティブフックが使えない環境
//   (モジュール未ロード / macOS Input Monitoring 権限未許可) 向けの既存方式。
//   Pointer Lock API + 通常の DOM mousemove イベントで取得する
//
// ボタン down/up・ホイールは mouseMode に関係なく常に DOM イベントのまま (Pointer Lock
// 非依存で既に安定動作しており、置き換える理由がない)。
//
// いずれのモードでも、host 自身の他アプリへの入力漏れは「このウインドウが画面全体を
// 覆い・最前面・フォーカス保持である」こと自体で防いでいる (setIgnoreMouseEvents は
// 呼ばない)。mouseMode はあくまで「移動量の取得元」を切り替えるだけで、この遮断の
// 仕組み自体には影響しない。
//
// キーボードは Renderer では扱わない: Main プロセスが overlay webContents の
// before-input-event で横取りする (メニューアクセラレータの無効化と、フォーカス/
// Pointer Lock の状態に依存しない確実な捕捉のため。main.js 参照、mouseMode の
// 導入後も変更なし)。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、mousemove は間引かずに
// 生イベントをそのまま即座に IPC 送信する (pointer-lock モード時)。

const root = document.getElementById('overlay-root');
const bannerDevice = document.getElementById('overlay-banner-device');

let active = false; // overlay-activate 〜 overlay-deactivate の間だけ true
let mouseMode = 'pointer-lock'; // overlay-activate で毎回上書きされる
let intentionalUnlock = false; // exitPointerLock を自分で呼んだ直後かどうか
let lockRetryTimer = null;

// Pointer Lock の要求はウインドウの表示/フォーカス遷移中だと失敗しうる
// (pointerlockerror)。さらに Chromium は Esc 押下でロックを強制解除し、直後の
// 再取得には内部クールダウンで失敗し続ける仕様がある (target へ Esc を転送した
// だけでもホスト側のロックが外れる)。失敗しても諦めず、アクティブな間は短い間隔で
// 再試行し続けることで「カーソルが画面端から出ない」時間を最小化する。
// なおロックが取れていない間も mousemove の movementX/Y は届くため、マウス転送
// 自体は動き続ける (ロックの目的はカーソルを画面端で止めないことと誤操作防止)
function scheduleLockRetry() {
  if (!active || lockRetryTimer !== null) return;
  lockRetryTimer = setTimeout(() => {
    lockRetryTimer = null;
    requestLock();
  }, 120);
}

function cancelLockRetry() {
  if (lockRetryTimer !== null) {
    clearTimeout(lockRetryTimer);
    lockRetryTimer = null;
  }
}

function requestLock() {
  if (!active || mouseMode !== 'pointer-lock' || document.pointerLockElement === root) return;
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

window.bridge.onOverlayActivate(({ device, mouseMode: mode }) => {
  active = true;
  mouseMode = mode === 'native' ? 'native' : 'pointer-lock';
  bannerDevice.textContent = device || '';
  root.focus();
  requestLock(); // native モードでは内部ガードにより no-op
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

// native モードでは Main プロセスが mouse-capture.js で直接捕捉して送出するため、
// ここでの DOM mousemove は無視する (二重送信防止)。pointer-lock モード (フォールバック)
// でのみ、ロックが未確立でも movementX/Y は通常の mousemove に載って届くため転送する
// (未確立の間はカーソルが画面端に達すると movement が 0 になるという劣化はあるが、
// 「まったく動かない」よりはるかによい。ロック自体は上のリトライで回復を図る)
document.addEventListener('mousemove', (e) => {
  if (!active || mouseMode !== 'pointer-lock') return;
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
