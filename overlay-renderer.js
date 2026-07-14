// 全画面キャプチャオーバーレイの入力捕捉ロジック。
//
// ネイティブなグローバル入力フックは使わず、Pointer Lock API + 通常の DOM イベントだけで
// host 側のマウス/キーボードを「奪う」。このウインドウが全画面・最前面・フォーカス保持で
// あること自体が、下のアプリへ入力が漏れないことを保証する。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、mousemove は間引かずに
// 生イベントをそのまま即座に IPC 送信する。

const root = document.getElementById('overlay-root');
const bannerDevice = document.getElementById('overlay-banner-device');

let active = false; // overlay-activate 〜 overlay-deactivate の間だけ true
let intentionalUnlock = false; // exitPointerLock を自分で呼んだ直後かどうか

// 予約コンボ (Shift+Alt+Space) の同時押下検知用
const heldModifierCodes = new Set();
const SHIFT_CODES = new Set(['ShiftLeft', 'ShiftRight']);
const ALT_CODES = new Set(['AltLeft', 'AltRight']);

function isReleaseCombo(code) {
  if (code !== 'Space') return false;
  const hasShift = [...heldModifierCodes].some((c) => SHIFT_CODES.has(c));
  const hasAlt = [...heldModifierCodes].some((c) => ALT_CODES.has(c));
  return hasShift && hasAlt;
}

function requestLock() {
  if (document.pointerLockElement !== root) root.requestPointerLock();
}

window.bridge.onOverlayActivate(({ device }) => {
  active = true;
  bannerDevice.textContent = device || '';
  root.focus();
  requestLock();
});

window.bridge.onOverlayDeactivate(() => {
  active = false;
  intentionalUnlock = true;
  if (document.pointerLockElement === root) document.exitPointerLock();
  heldModifierCodes.clear();
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
  // 実際に Escape が押された場合、その押下イベント自体は仕様上 JS に配送されない
  // ため実キーとしての転送はできない (既知の制約として SPEC.md に記載する) が、
  // ロックだけは即座に再要求して操作の継続性を保つ
  requestLock();
});

document.addEventListener('mousemove', (e) => {
  if (!active || document.pointerLockElement !== root) return;
  if (e.movementX === 0 && e.movementY === 0) return;
  window.bridge.overlaySendMouseMove(e.movementX, e.movementY);
});

const BUTTON_NAMES = { 0: 'left', 1: 'middle', 2: 'right' };

document.addEventListener('mousedown', (e) => {
  if (!active) return;
  e.preventDefault();
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

document.addEventListener('keydown', (e) => {
  if (!active) return;
  e.preventDefault();
  const code = e.code;
  if (SHIFT_CODES.has(code) || ALT_CODES.has(code)) heldModifierCodes.add(code);
  if (isReleaseCombo(code)) {
    window.bridge.overlayReopenHud();
    return;
  }
  window.bridge.overlaySendKey(code, 'down');
});

document.addEventListener('keyup', (e) => {
  if (!active) return;
  e.preventDefault();
  const code = e.code;
  heldModifierCodes.delete(code);
  window.bridge.overlaySendKey(code, 'up');
});
