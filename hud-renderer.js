// デバイス切り替え HUD の表示ロジック。Tab で選択移動、Enter で確定、Esc でキャンセル。
// ネットワーク処理は一切持たず、選択結果を IPC で Main へ渡すだけ。

const listEl = document.getElementById('hud-device-list');

let devices = []; // [{ id, device, isSelf }]
let selectedIndex = 0;

function render() {
  listEl.innerHTML = '';
  devices.forEach((d, i) => {
    const li = document.createElement('li');
    li.className = 'hud-device-row' + (i === selectedIndex ? ' selected' : '') + (d.isSelf ? ' self' : '');
    li.textContent = d.device;
    listEl.appendChild(li);
  });
}

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
