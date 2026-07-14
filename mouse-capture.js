// host 側 (操作する側) のマウス捕捉レイヤー。control-input.js (target 側の注入) と対になる。
//
// uiohook-napi はネイティブなグローバルマウスフックだが、listen-only であり、かつ
// 届く mousemove イベントは movementX/Y のような相対デルタではなく OS が既に
// クランプ済みの絶対スクリーン座標 (x, y) である (Windows WH_MOUSE_LL / macOS
// CGEventTap のどちらも同じ制約)。そのため素朴に前回座標との差分を取るだけでは、
// Pointer Lock 方式が抱えていた「カーソルが画面端に達すると差分が出なくなる」劣化を
// 再現するだけで解決にならない。
//
// 対策として、セッション開始位置を anchor として記録し、そこからの移動量が
// 閾値を超えるたびに nut-js の mouse.setPosition() で anchor へ再センタリング
// (warp) する。warp 発行と同時に lastKnown を anchor へ楽観的に更新しておくことで、
// warp 自体が発生させる合成 mousemove イベントの delta が自然に 0 になり、
// 特別なフィルタリングなしに無視される。target 側の injectMouseMove (get→set
// 加算) と対になる、host 側の「set→get 差分」ループとして理解するとよい。
//
// @nut-tree-fork/nut-js の require と異なり、この機能は失敗時に Pointer Lock
// フォールバックへ切り替える経路を main.js 側が持つため、require は必ず
// try/catch で囲み、モジュール自体が無い/ロードに失敗した環境でもアプリ全体を
// クラッシュさせない。

let uIOhook = null;
try {
  ({ uIOhook } = require('uiohook-napi'));
} catch {
  uIOhook = null;
}

const { mouse } = require('@nut-tree-fork/nut-js');

// この距離 (物理ピクセル) を超えて anchor から離れたら再センタリングする。
// 小さいほど host 実カーソルの視認可能な移動範囲が狭まる (視覚的ジッター低減) が、
// 再センタリングの頻度が上がる。40px は「体感できるほど動き回らない」かつ
// 「毎フレーム再センタリングして無駄な OS 呼び出しをしない」の妥協点
const RECENTER_THRESHOLD_PX = 40;

// macOS の Input Monitoring 権限には Accessibility と違い公式の同期チェック API が
// 存在しないため、実際にカーソルを動かしてみて uiohook が拾えるかどうかを見る
// 経験的プローブでしか判定できない。このタイムアウト内に mousemove が一度も
// 届かなければ「権限なし」とみなす
const PROBE_TIMEOUT_MS = 400;

function isModuleAvailable() {
  return uIOhook !== null;
}

let capturing = false;
let anchor = null; // { x, y } 物理ピクセル、セッション開始位置
let lastKnown = null;
let onDeltaCb = null;
let recentering = false;

function handleMouseMove(e) {
  if (!capturing || !lastKnown) return;
  const dx = e.x - lastKnown.x;
  const dy = e.y - lastKnown.y;
  lastKnown = { x: e.x, y: e.y };
  if (dx !== 0 || dy !== 0) onDeltaCb(dx, dy);

  if (
    Math.abs(lastKnown.x - anchor.x) > RECENTER_THRESHOLD_PX ||
    Math.abs(lastKnown.y - anchor.y) > RECENTER_THRESHOLD_PX
  ) {
    recenter();
  }
}

// 200Hz 級の流入下でも warp 発行が重複しないよう、進行中は新規 warp を起こさない。
// warp 発行と同時に lastKnown を anchor へ先出しで更新するため、warp 完了を待たずに
// 次の実イベントの delta 計算は既に正しい基準へ切り替わっている
async function recenter() {
  if (recentering) return;
  recentering = true;
  lastKnown = { ...anchor };
  try {
    await mouse.setPosition(anchor);
  } catch {
    // 失敗しても lastKnown は既に anchor 基準に切り替え済みなので座標系は破綻しない
  } finally {
    recentering = false;
  }
}

// darwin のみ: セッション開始時に一度呼び、Input Monitoring 権限の有無を経験的に
// 判定する。自分でカーソルを 1px 動かし、それを uiohook 経由で検知できるかを見る。
// win32 では低レベルフックに OS の許可要求が存在しないため即座に true を返す
async function probeNativeCapture() {
  if (process.platform !== 'darwin') return true;
  if (!uIOhook) return false;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      uIOhook.off('mousemove', onMove);
      try {
        uIOhook.stop();
      } catch {}
      resolve(ok);
    };

    const onMove = () => finish(true);

    (async () => {
      try {
        uIOhook.on('mousemove', onMove);
        uIOhook.start();
        timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
        const pos = await mouse.getPosition();
        await mouse.setPosition({ x: Math.round(pos.x) + 1, y: Math.round(pos.y) });
        await mouse.setPosition(pos);
      } catch {
        finish(false);
      }
    })();
  });
}

async function startCapture({ onDelta }) {
  if (!uIOhook || capturing) return false;
  try {
    const pos = await mouse.getPosition();
    anchor = { x: Math.round(pos.x), y: Math.round(pos.y) };
    lastKnown = { ...anchor };
    onDeltaCb = onDelta;
    uIOhook.on('mousemove', handleMouseMove);
    uIOhook.start();
    capturing = true;
    return true;
  } catch {
    capturing = false;
    anchor = null;
    lastKnown = null;
    onDeltaCb = null;
    return false;
  }
}

function stopCapture() {
  if (!capturing) return;
  capturing = false;
  try {
    uIOhook.off('mousemove', handleMouseMove);
    uIOhook.stop();
  } catch {}
  anchor = null;
  lastKnown = null;
  onDeltaCb = null;
}

module.exports = {
  isModuleAvailable,
  probeNativeCapture,
  startCapture,
  stopCapture,
};
