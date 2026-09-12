// ペースト用ポップアップ (popup.html)。Main から届いた履歴を表示し、選んだものを popup-choose で返す
const PLATFORM = window.bridge.platform || 'darwin';
document.body.classList.add(`platform-${PLATFORM}`);
if (window.bridge.isWindows11) document.body.classList.add('win11');
if (PLATFORM !== 'darwin') {
  document.querySelector('#popup-footer span').textContent = '↑↓ 選択 · Enter 貼り付け · Esc 閉じる';
}

const searchEl = document.getElementById('popup-search');
const listEl = document.getElementById('popup-list');
const emptyEl = document.getElementById('popup-empty');
const { formatTime, urlOfText } = window.BridgeFormat;

const CLIPBOARD_GLYPH =
  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="12" height="14" rx="2.5"/><path d="M7.5 4V3.5A1.5 1.5 0 0 1 9 2h2a1.5 1.5 0 0 1 1.5 1.5V4M7.5 9.5h5M7.5 13h3.5"/></svg>';
const PIN_GLYPH =
  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.5 1.5 14.5 6.5l-1.2 1.2-.9-.3-2.6 2.6.3 2.6-1.2 1.2L6 11 2.5 14.5l-1-1L5 10 2.2 7.1l1.2-1.2 2.6.3 2.6-2.6-.3-.9z"/></svg>';

let allItems = [];
let visible = [];
let activeIndex = 0;
const iconCache = new Map(); // path → data URL

function toFileUrl(filePath) {
  const encoded = filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)))
    .join('/');
  return (encoded.startsWith('/') ? 'file://' : 'file:///') + encoded;
}

function labelOf(item) {
  if (item.kind === 'clip-text') return (item.text || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  return item.name || (item.path || '').split(/[\\/]/).pop();
}

function filterItems() {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) return allItems.slice();
  return allItems.filter((it) => {
    const hay = [it.name, it.path, it.text].filter(Boolean).join('\n').toLowerCase();
    return hay.includes(q);
  });
}

function createLeading(item) {
  const leading = document.createElement('div');
  leading.className = 'item-leading';
  if (item.kind === 'clip-text') {
    const g = document.createElement('div');
    g.className = 'clip-glyph';
    g.innerHTML = CLIPBOARD_GLYPH;
    leading.appendChild(g);
    return leading;
  }
  const img = document.createElement('img');
  img.draggable = false;
  img.alt = '';
  if (item.isImage || item.kind === 'clip-image') {
    img.className = 'file-icon thumbnail';
    img.src = toFileUrl(item.path);
  } else {
    img.className = 'file-icon';
    const cached = iconCache.get(item.path);
    if (cached) {
      img.src = cached;
    } else {
      window.bridge
        .getFileIcon(item.path)
        .then((dataUrl) => {
          if (!dataUrl) return;
          iconCache.set(item.path, dataUrl);
          img.src = dataUrl;
        })
        .catch(() => {});
    }
  }
  leading.appendChild(img);
  return leading;
}

function render() {
  listEl.textContent = '';
  visible = filterItems();
  if (activeIndex >= visible.length) activeIndex = Math.max(0, visible.length - 1);
  emptyEl.hidden = visible.length > 0;
  emptyEl.textContent = allItems.length === 0 ? '履歴はまだありません' : '一致するものがありません';
  listEl.hidden = visible.length === 0;

  visible.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'popup-item' + (i === activeIndex ? ' active' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    li.appendChild(createLeading(item));
    if (item.pinned) {
      const holder = document.createElement('span');
      holder.innerHTML = PIN_GLYPH;
      const svg = holder.firstElementChild;
      svg.classList.add('meta-pin');
      li.appendChild(svg);
    }
    const text = document.createElement('span');
    text.className = 'popup-text';
    text.textContent = labelOf(item);
    const time = document.createElement('span');
    time.className = 'popup-time';
    time.textContent = item.timestamp ? formatTime(item.timestamp) : '';
    li.append(text, time);
    li.addEventListener('mouseenter', () => {
      activeIndex = i;
      for (const el of listEl.children) el.classList.remove('active');
      li.classList.add('active');
    });
    li.addEventListener('click', () => choose(item));
    listEl.appendChild(li);
  });
  const activeEl = listEl.children[activeIndex];
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

function choose(item) {
  if (!item) return;
  window.bridge.popupChoose({ kind: item.kind, text: item.text, path: item.path });
}

window.bridge.onPopupItems(({ items }) => {
  allItems = Array.isArray(items) ? items : [];
  searchEl.value = '';
  activeIndex = 0;
  render();
  searchEl.focus();
});

searchEl.addEventListener('input', () => {
  activeIndex = 0;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (visible.length === 0) return;
    activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : visible.length - 1)) % visible.length;
    render();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const target = visible[activeIndex];
    if (target && urlOfText(target.text) && (e.metaKey || e.ctrlKey)) {
      window.bridge.openExternal(urlOfText(target.text));
      window.bridge.popupClose();
      return;
    }
    choose(target);
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    window.bridge.popupClose();
  }
});

// 数字キー 1-9 で上から n 番目を即選択 (検索欄が空のときだけ)
document.addEventListener('keydown', (e) => {
  if (searchEl.value) return;
  if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
    const target = visible[Number(e.key) - 1];
    if (target) {
      e.preventDefault();
      choose(target);
    }
  }
});
