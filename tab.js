// Windows のつまみウインドウ。カーソル座標は使わず、この窓自身へのホバー滞留 / クリック / ドラッグ進入で
// 「このモニターにシェルフを出して」と Main へ伝える
const displayId = new URLSearchParams(location.search).get('display');
const HOVER_DWELL_MS = 250;
let dwellTimer = null;

document.body.classList.add(`platform-${window.bridge.platform || 'win32'}`);

function activate() {
  clearTimeout(dwellTimer);
  dwellTimer = null;
  window.bridge.tabActivate(displayId);
}

document.addEventListener('mouseenter', () => {
  clearTimeout(dwellTimer);
  dwellTimer = setTimeout(activate, HOVER_DWELL_MS);
});
document.addEventListener('mouseleave', () => {
  clearTimeout(dwellTimer);
  dwellTimer = null;
});
document.addEventListener('click', activate);
document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  activate();
});
document.addEventListener('dragover', (e) => e.preventDefault());
