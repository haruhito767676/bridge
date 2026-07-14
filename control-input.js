// target 側 (操作を受け取る側) の入力注入レイヤー。@nut-tree-fork/nut-js の薄いラッパー。
// OS への疑似入力注入 (macOS: CGEventPost / Windows: SendInput) はネイティブコードなしには
// 実現できないため、この機能に限り「外部依存パッケージはゼロ」の原則の例外として導入した。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、autoDelayMs = 0 でライブラリ
// 内部の操作間ディレイを排除する。

const { mouse, keyboard, Key, Button } = require('@nut-tree-fork/nut-js');
const { screen: electronScreen, systemPreferences } = require('electron');

mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

// DOM KeyboardEvent.code (レイアウト非依存) → nut-js Key の静的テーブル。
// nut-js の Key enum 自体がクロスプラットフォーム抽象化されているため OS 分岐は不要
const KEY_MAP = {
  // 文字
  KeyA: Key.A, KeyB: Key.B, KeyC: Key.C, KeyD: Key.D, KeyE: Key.E, KeyF: Key.F,
  KeyG: Key.G, KeyH: Key.H, KeyI: Key.I, KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L,
  KeyM: Key.M, KeyN: Key.N, KeyO: Key.O, KeyP: Key.P, KeyQ: Key.Q, KeyR: Key.R,
  KeyS: Key.S, KeyT: Key.T, KeyU: Key.U, KeyV: Key.V, KeyW: Key.W, KeyX: Key.X,
  KeyY: Key.Y, KeyZ: Key.Z,

  // 数字 (最上段)
  Digit0: Key.Num0, Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3,
  Digit4: Key.Num4, Digit5: Key.Num5, Digit6: Key.Num6, Digit7: Key.Num7,
  Digit8: Key.Num8, Digit9: Key.Num9,

  // テンキー
  Numpad0: Key.NumPad0, Numpad1: Key.NumPad1, Numpad2: Key.NumPad2, Numpad3: Key.NumPad3,
  Numpad4: Key.NumPad4, Numpad5: Key.NumPad5, Numpad6: Key.NumPad6, Numpad7: Key.NumPad7,
  Numpad8: Key.NumPad8, Numpad9: Key.NumPad9,
  NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract, NumpadMultiply: Key.Multiply,
  NumpadDivide: Key.Divide, NumpadDecimal: Key.Decimal, NumpadEqual: Key.NumPadEqual,
  NumpadEnter: Key.Enter, // nut-js に専用キーがないため主 Enter にフォールバック

  // モディファイア (左右別)
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftMeta, MetaRight: Key.RightMeta,

  // ファンクションキー
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  F13: Key.F13, F14: Key.F14, F15: Key.F15, F16: Key.F16, F17: Key.F17, F18: Key.F18,
  F19: Key.F19, F20: Key.F20, F21: Key.F21, F22: Key.F22, F23: Key.F23, F24: Key.F24,

  // 矢印
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,

  // ナビゲーション / 空白系
  Space: Key.Space, Enter: Key.Enter, Tab: Key.Tab, Escape: Key.Escape,
  Backspace: Key.Backspace, Delete: Key.Delete, Home: Key.Home, End: Key.End,
  PageUp: Key.PageUp, PageDown: Key.PageDown, Insert: Key.Insert,

  // 記号
  Backquote: Key.Grave, Minus: Key.Minus, Equal: Key.Equal,
  BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket, Backslash: Key.Backslash,
  Semicolon: Key.Semicolon, Quote: Key.Quote, Comma: Key.Comma, Period: Key.Period,
  Slash: Key.Slash,

  // ロックキー・その他
  CapsLock: Key.CapsLock, NumLock: Key.NumLock, ScrollLock: Key.ScrollLock,
  PrintScreen: Key.Print, Pause: Key.Pause, ContextMenu: Key.Menu,
};

const BUTTON_MAP = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };

// 押しっぱなし状態の追跡。異常切断時にここに残っているものを releaseAllHeld() で必ず解放する
const heldButtons = new Set();
const heldKeys = new Set();

let cursorX = 0;
let cursorY = 0;

// セッション開始時に呼ぶ。実際のカーソル位置を起点にシードすることで、
// セッション開始時にカーソルが飛んでジャンプするような不自然な挙動を防ぐ
function seedCursorFromCurrentPosition() {
  const p = electronScreen.getCursorScreenPoint();
  cursorX = p.x;
  cursorY = p.y;
}

// 全ディスプレイを合成した仮想デスクトップ全体の矩形 (マルチモニタ環境でのクランプ用)
function virtualDesktopBounds() {
  const displays = electronScreen.getAllDisplays();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return { minX, minY, maxX, maxY };
}

// 相対デルタを累積し、仮想デスクトップ全体の矩形にクランプしてから注入する。
// 相対デルタ方式のため host/target の解像度差はスケーリング計算なしで吸収できる
async function injectMouseMove(dx, dy) {
  const b = virtualDesktopBounds();
  cursorX = Math.min(Math.max(cursorX + dx, b.minX), b.maxX - 1);
  cursorY = Math.min(Math.max(cursorY + dy, b.minY), b.maxY - 1);
  await mouse.setPosition({ x: Math.round(cursorX), y: Math.round(cursorY) });
}

async function injectMouseButton(button, action) {
  const btn = BUTTON_MAP[button];
  if (btn === undefined) return; // 未知のボタン名は前方互換の精神で無視
  if (action === 'down') {
    heldButtons.add(button);
    await mouse.pressButton(btn);
  } else {
    heldButtons.delete(button);
    await mouse.releaseButton(btn);
  }
}

// トラックパッド/物理ホイールでデルタの粒度が大きく異なるため、スケール係数は
// 実運用で調整が必要になる想定 (現状は 1 ステップ = 1 delta の単純換算)
async function injectWheel(dx, dy) {
  if (dy > 0) await mouse.scrollDown(Math.round(dy));
  else if (dy < 0) await mouse.scrollUp(Math.round(-dy));
  if (dx > 0) await mouse.scrollRight(Math.round(dx));
  else if (dx < 0) await mouse.scrollLeft(Math.round(-dx));
}

const loggedUnknownCodes = new Set();

async function injectKey(code, action) {
  const key = KEY_MAP[code];
  if (key === undefined) {
    if (!loggedUnknownCodes.has(code)) {
      loggedUnknownCodes.add(code);
      console.warn('[control-input] 未対応の KeyboardEvent.code (無視):', code);
    }
    return;
  }
  if (action === 'down') {
    heldKeys.add(code);
    await keyboard.pressKey(key);
  } else {
    heldKeys.delete(code);
    await keyboard.releaseKey(key);
  }
}

// セッションの異常終了時に必ず呼ぶ。押しっぱなしのボタン/キーをすべて解放し、
// target 側の OS にスタックしたキー/ボタンを残さない (最重要の安全設計)
async function releaseAllHeld() {
  for (const button of [...heldButtons]) {
    await injectMouseButton(button, 'up');
  }
  for (const code of [...heldKeys]) {
    await injectKey(code, 'up');
  }
}

// macOS のみ必要。CGEventPost による注入には Accessibility 権限が要る。
// prompt=true で未許可時に OS 標準の許可ダイアログ (システム設定への誘導) を表示する
function hasAccessibilityPermission() {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function requestAccessibilityPermission() {
  if (process.platform !== 'darwin') return;
  systemPreferences.isTrustedAccessibilityClient(true);
}

module.exports = {
  seedCursorFromCurrentPosition,
  injectMouseMove,
  injectMouseButton,
  injectWheel,
  injectKey,
  releaseAllHeld,
  hasAccessibilityPermission,
  requestAccessibilityPermission,
};
