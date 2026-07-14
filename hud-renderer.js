// デバイス切り替え HUD の表示ロジック。
// キーボード: Tab で選択移動 → Enter で確定 → Esc でキャンセル。
// マウス: ホバーで選択移動、クリックで確定、カード外のクリックでキャンセル。
// ネットワーク処理は一切持たず、選択結果を IPC で Main へ渡すだけ。

const listEl = document.getElementById('hud-device-list');

// 未設定・未知の iconType のときにフォールバックさせる画像ファイル名 (存在しなくてもプレースホルダー枠が残る)
const DEFAULT_ICON = 'default';

let devices = []; // [{ id, device, iconType, isSelf }]
let selectedIndex = 0;

function render() {
  listEl.innerHTML = '';
  devices.forEach((d, i) => {
    const card = document.createElement('div');
    card.className = 'hud-device-card' + (i === selectedIndex ? ' selected' : '') + (d.isSelf ? ' self' : '');

    const iconBox = document.createElement('div');
    iconBox.className = 'hud-device-icon';

    const img = document.createElement('img');
    img.src = `./assets/icons/${d.iconType || DEFAULT_ICON}.png`;
    img.alt = '';
    // アイコン画像がまだ用意されていない/未知の iconType でも、枠だけのプレースホルダーとして残す
    img.onerror = () => img.classList.add('hud-icon-missing');
    iconBox.appendChild(img);

    const name = document.createElement('div');
    name.className = 'hud-device-name';
    name.textContent = d.device;

    card.appendChild(iconBox);
    card.appendChild(name);

    // マウス操作: ホバーで選択を追従させ、クリックで即確定する
    // (再 render で要素が差し替わっても、カーソル直下の新要素に同じ mouseenter が
    // 届き selectedIndex が一致してガードされるため、無限再描画にはならない)
    card.addEventListener('mouseenter', () => {
      if (selectedIndex === i) return;
      selectedIndex = i;
      render();
    });
    card.addEventListener('click', () => {
      window.bridge.hudConfirm(d.id);
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

window.bridge.onHudSetDevices((list) => {
  devices = list;
  selectedIndex = 0;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    selectNext();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = devices[selectedIndex];
    if (target) window.bridge.hudConfirm(target.id);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    window.bridge.hudCancel();
  }
});
