// target 側 (操作を受け取る側) の入力注入レイヤー。@nut-tree-fork/nut-js の薄いラッパー。
// OS への疑似入力注入 (macOS: CGEventPost / Windows: SendInput) はネイティブコードなしには
// 実現できないため、この機能に限り「外部依存パッケージはゼロ」の原則の例外として導入した。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、autoDelayMs = 0 でライブラリ
// 内部の操作間ディレイを排除する。

const { mouse, keyboard, Key, Button } = require('@nut-tree-fork/nut-js');
const { systemPreferences } = require('electron');

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

// 相対デルタを nut-js が返す「実際の現在位置」(物理ピクセル) に加算して注入する。
//
// Electron の screen API を座標の起点に使ってはいけない: Electron は DIP 座標、
// nut-js (SendInput/GetCursorPos) は物理ピクセル座標で動くため、Windows の表示
// スケーリングが 100% 以外だと両者が食い違い、カーソルが意図しない位置へ飛ぶ。
// 毎回 OS から現在位置を読み直す方式なら座標系は常に一貫し、画面外への移動も
// OS 側が自動でクランプしてくれるので手製の境界計算は不要になる。
//
// 200Hz 級で届くデルタを get→set の非同期ペアで並行処理すると加算が失われるため、
// ペンディングデルタに累積し、単一のフラッシュループで直列に注入する
let pendingDx = 0;
let pendingDy = 0;
let flushingMouse = false;

async function injectMouseMove(dx, dy) {
  pendingDx += dx;
  pendingDy += dy;
  if (flushingMouse) return; // 既存のフラッシュループが拾う
  flushingMouse = true;
  try {
    while (pendingDx !== 0 || pendingDy !== 0) {
      const mx = pendingDx;
      const my = pendingDy;
      pendingDx = 0;
      pendingDy = 0;
      const pos = await mouse.getPosition();
      await mouse.setPosition({ x: Math.round(pos.x + mx), y: Math.round(pos.y + my) });
    }
  } finally {
    flushingMouse = false;
  }
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

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
]);

// 現在押しっぱなしの修飾キーを nut-js の Key 配列として返す
function heldModifierNutKeys() {
  const keys = [];
  for (const code of heldKeys) {
    if (MODIFIER_CODES.has(code)) keys.push(KEY_MAP[code]);
  }
  return keys;
}

async function injectKey(code, action) {
  const key = KEY_MAP[code];
  if (key === undefined) {
    if (!loggedUnknownCodes.has(code)) {
      loggedUnknownCodes.add(code);
      console.warn('[control-input] 未対応の KeyboardEvent.code (無視):', code);
    }
    return;
  }

  // macOS の CGEvent は「イベントごとに修飾フラグを持つ」モデルのため、修飾キーを
  // 別イベントとして press しただけでは後続キーに Cmd/Ctrl/Opt が乗らない
  // (Ctrl+C を送っても target には素の C が届く)。nut-js の可変長引数
  // (先頭に修飾キー、末尾に主キー) で渡すと libnut が主キーのイベントに修飾フラグを
  // 焼き込んでくれるので、darwin では押下中の修飾キーを毎回添える。
  // Windows は SendInput が OS 側でグローバルなキー押下状態を保持するモデルなので
  // 単独注入のままでよい (添えると libnut が修飾キーを勝手に上げ下げして状態が壊れる)
  const attachModifiers =
    process.platform === 'darwin' && !MODIFIER_CODES.has(code) ? heldModifierNutKeys() : [];

  if (action === 'down') {
    heldKeys.add(code);
    await keyboard.pressKey(...attachModifiers, key);
  } else {
    heldKeys.delete(code);
    await keyboard.releaseKey(...attachModifiers, key);
  }
}

// セッションの異常終了時に必ず呼ぶ。押しっぱなしのボタン/キーをすべて解放し、
// target 側の OS にスタックしたキー/ボタンを残さない (最重要の安全設計)。
// 1 つの解放が失敗しても後続の解放が止まらないよう、個別に握りつぶして必ず完走させる
async function releaseAllHeld() {
  for (const button of [...heldButtons]) {
    try {
      await injectMouseButton(button, 'up');
    } catch {}
  }
  // 非修飾キーを先に解放する: darwin では非修飾キーの up イベントに押下中の
  // 修飾フラグを添えるため、修飾キーを先に消すと実際の押下状態と食い違う
  const codes = [...heldKeys];
  for (const code of codes.filter((c) => !MODIFIER_CODES.has(c))) {
    try {
      await injectKey(code, 'up');
    } catch {}
  }
  for (const code of codes.filter((c) => MODIFIER_CODES.has(c))) {
    try {
      await injectKey(code, 'up');
    } catch {}
  }
  // 追跡に残っていない修飾キーも無条件で解放する。ホスト側の up 取りこぼし等で
  // 追跡が実際の OS 状態とズレていても、セッション終了後に Ctrl/Cmd が
  // 押しっぱなしのまま残る事故だけはここで確実に断ち切る (未押下キーへの up は無害)
  for (const code of MODIFIER_CODES) {
    try {
      await keyboard.releaseKey(KEY_MAP[code]);
    } catch {}
  }
  heldButtons.clear();
  heldKeys.clear();
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
  injectMouseMove,
  injectMouseButton,
  injectWheel,
  injectKey,
  releaseAllHeld,
  hasAccessibilityPermission,
  requestAccessibilityPermission,
};
