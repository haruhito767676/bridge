// target 側 (操作を受け取る側) の入力注入レイヤー。@nut-tree-fork/nut-js の薄いラッパー。
// OS への疑似マウス入力注入 (macOS: CGEventPost / Windows: SendInput) はネイティブコードなしには
// 実現できないため、この機能に限り「外部依存パッケージはゼロ」の原則の例外として導入した。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、autoDelayMs = 0 でライブラリ
// 内部の操作間ディレイを排除する。

const { mouse, Button } = require('@nut-tree-fork/nut-js');
const { systemPreferences } = require('electron');

mouse.config.autoDelayMs = 0;

const BUTTON_MAP = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };

// 押しっぱなし状態の追跡。異常切断時にここに残っているものを releaseAllHeld() で必ず解放する
const heldButtons = new Set();

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

// セッションの異常終了時に必ず呼ぶ。押しっぱなしのボタンをすべて解放し、
// target 側の OS にスタックしたボタンを残さない (最重要の安全設計)。
// 1 つの解放が失敗しても後続の解放が止まらないよう、個別に握りつぶして必ず完走させる
async function releaseAllHeld() {
  for (const button of [...heldButtons]) {
    try {
      await injectMouseButton(button, 'up');
    } catch {}
  }
  heldButtons.clear();
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
  releaseAllHeld,
  hasAccessibilityPermission,
  requestAccessibilityPermission,
};
