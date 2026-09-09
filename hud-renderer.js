// デバイス切り替え HUD の表示ロジック。
// キーボード: Tab で選択移動 → Enter で確定 → Esc でキャンセル。
// マウス: ホバーで選択移動、クリックで確定、カード外のクリックでキャンセル。
// ネットワーク処理は一切持たず、選択結果を IPC で Main へ渡すだけ。

const listEl = document.getElementById('hud-device-list');
const statusTabEl = document.getElementById('hud-status-tab');

// 未設定・未知の iconType のときにフォールバックさせる画像ファイル名 (存在しなくてもプレースホルダー枠が残る)
const DEFAULT_ICON = 'default';

let devices = []; // [{ id, device, iconType, isSelf, isOnline }]
let selectedIndex = 0;

// 現在のマウス共有セッション状態。Main から hud-set-devices (初期値) /
// hud-session-status (リアルタイム差分) の両方で更新される
let sessionStatus = { status: 'idle', targetDevice: null };

// 一度でも実際に切り替えに成功したユーザーには、以後この案内を出さない
const ONBOARD_SEEN_KEY = 'bridge-hud-onboarded';

// HUD 最上部のステータスタブ。Idle は非表示、Host/Client はバッジで表示する。
// ただし初回だけは Idle 中に「操作方法」の案内をここに出す (高さは常に確保済みなので跳ねない)
function renderStatusTab() {
  statusTabEl.innerHTML = '';
  statusTabEl.classList.remove('is-host', 'is-client');
  if (!sessionStatus || sessionStatus.status === 'idle') {
    if (!localStorage.getItem(ONBOARD_SEEN_KEY) && devices.length > 1) {
      const hint = document.createElement('div');
      hint.className = 'hud-onboard-hint';
      hint.textContent = 'Tab で選択 → Enter で切り替え';
      statusTabEl.appendChild(hint);
    }
    return;
  }

  statusTabEl.classList.add(sessionStatus.status === 'host' ? 'is-host' : 'is-client');

  const badge = document.createElement('div');
  badge.className = 'hud-status-badge';

  const label = document.createElement('span');
  label.className = 'hud-status-badge-label';
  label.textContent = sessionStatus.status === 'host' ? 'Host' : 'Client';
  badge.appendChild(label);

  if (sessionStatus.targetDevice) {
    const target = document.createElement('span');
    target.className = 'hud-status-badge-target';
    target.textContent = sessionStatus.targetDevice;
    badge.appendChild(target);
  }

  statusTabEl.appendChild(badge);
}

// オフラインのカードを確定操作 (Enter/クリック) した際に、拒否を視覚的に伝えるための一時クラス
function shakeCard(card) {
  card.classList.remove('shake');
  // 同じカードで連続して弾かれた場合でも再生できるよう、一度リフローを挟んでから付け直す
  void card.offsetWidth;
  card.classList.add('shake');
}

// オフラインのデバイスへは操作を引き継がない。呼び出し元 (Enter/クリック) 共通のガード
function confirmDevice(d, card) {
  if (!d.isSelf && d.isOnline === false) {
    shakeCard(card);
    return;
  }
  // 実際に他デバイスへ切り替えるところまで到達したら、以後の初回案内は不要と判断する
  if (!d.isSelf) localStorage.setItem(ONBOARD_SEEN_KEY, '1');
  window.bridge.hudConfirm(d.id);
}

function render() {
  listEl.innerHTML = '';
  devices.forEach((d, i) => {
    const isOffline = !d.isSelf && d.isOnline === false;
    const card = document.createElement('div');
    card.className = 'hud-device-card'
      + (i === selectedIndex ? ' selected' : '')
      + (d.isSelf ? ' is-me' : '')
      + (isOffline ? ' is-offline' : ' is-online');

    const iconBox = document.createElement('div');
    iconBox.className = 'hud-device-icon';

    const img = document.createElement('img');
    img.src = `./assets/icons/${d.iconType || DEFAULT_ICON}.png`;
    img.alt = '';
    // アイコン画像がまだ用意されていない/未知の iconType でも、枠だけのプレースホルダーとして残す
    img.onerror = () => img.classList.add('hud-icon-missing');
    iconBox.appendChild(img);

    // デバイス名と「Connect」ヒントは、常に独立した別要素として共存させる
    // (ヒントの表示/非表示がどう切り替わっても、デバイス名の DOM 自体には一切触れない)
    const info = document.createElement('div');
    info.className = 'hud-device-info';

    const name = document.createElement('div');
    name.className = 'hud-device-name';
    name.textContent = d.device;
    info.appendChild(name);

    // 自デバイス以外のオンライン端末にフォーカス/ホバーが当たっている間だけ「Connect ➔」を出す
    // (name とは別の要素のまま常に DOM 上に存在させ、CSS の opacity のみで出し入れする)
    if (!d.isSelf && !isOffline) {
      const hint = document.createElement('div');
      hint.className = 'hud-connect-hint';
      hint.textContent = 'Connect ➔';
      info.appendChild(hint);
    }

    card.appendChild(iconBox);
    card.appendChild(info);

    // オンラインのカードは (自分自身も含めて) 右上の角にオンラインバッジを表示する
    if (d.isOnline) {
      const badge = document.createElement('div');
      badge.className = 'hud-online-badge';
      card.appendChild(badge);
    }

    // マウス操作: ホバーで選択を追従させ、クリックで即確定する
    // (再 render で要素が差し替わっても、カーソル直下の新要素に同じ mouseenter が
    // 届き selectedIndex が一致してガードされるため、無限再描画にはならない)
    card.addEventListener('mouseenter', () => {
      if (selectedIndex === i) return;
      selectedIndex = i;
      render();
    });
    card.addEventListener('click', () => {
      confirmDevice(d, card);
    });

    listEl.appendChild(card);
  });
}

// カード以外の場所 (パネルの余白) のクリックはキャンセル扱いにする
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.hud-device-card')) window.bridge.hudCancel();
});

function selectNext() {
  if (devices.length === 0) return;
  selectedIndex = (selectedIndex + 1) % devices.length;
  render();
}

function selectPrev() {
  if (devices.length === 0) return;
  selectedIndex = (selectedIndex - 1 + devices.length) % devices.length;
  render();
}

window.bridge.onHudSetDevices(({ devices: list, session }) => {
  devices = list;
  selectedIndex = 0;
  sessionStatus = session || { status: 'idle', targetDevice: null };
  renderStatusTab();
  render();
});

window.bridge.onHudSessionStatus((session) => {
  sessionStatus = session || { status: 'idle', targetDevice: null };
  renderStatusTab();
});

document.addEventListener('keydown', (e) => {
  // カードは横一列に並んでいるため、Tab に加えて ←→ でも直感的に移動できるようにする。
  // Shift+Tab は Tab の逆順移動という一般的な慣習に合わせる
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    selectPrev();
  } else if (e.key === 'Tab' || e.key === 'ArrowRight') {
    e.preventDefault();
    selectNext();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    selectPrev();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = devices[selectedIndex];
    const card = listEl.children[selectedIndex];
    if (target && card) confirmDevice(target, card);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    window.bridge.hudCancel();
  }
});
