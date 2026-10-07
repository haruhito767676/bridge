// window.bridge のモック (preload.js の代わり)。renderer.js はこれ越しにだけ外界と話す。
(() => {
  const cbs = {};
  const on = (n) => (cb) => { (cbs[n] ||= []).push(cb); };
  const platform = window.__PLATFORM || 'darwin';
  const ME = { device: window.__ME || (platform === 'win32' ? '会社用PC' : '自分のMac'), platform };
  const ext = (p) => (String(p).split('.').pop() || '').toLowerCase();
  const COL = { pdf: ['#ff453a', 'PDF'], docx: ['#2b7cff', 'DOC'], xlsx: ['#30b45a', 'XLS'], pptx: ['#ff8a2a', 'PPT'], txt: ['#8e8e93', 'TXT'], csv: ['#30b45a', 'CSV'], md: ['#8e8e93', 'MD'], zip: ['#a66cff', 'ZIP'] };
  const icon = (p) => {
    const [c, t] = COL[ext(p)] || ['#8e8e93', (ext(p) || '').toUpperCase().slice(0, 4)];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dcdce2"/></linearGradient></defs><path d="M12 4h28l14 14v38a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="url(#g)"/><path d="M40 4l14 14H44a4 4 0 0 1-4-4z" fill="#b9b9c2"/><rect x="8" y="34" width="34" height="16" rx="3" fill="${c}"/><text x="25" y="46.2" font-family="-apple-system,Helvetica,sans-serif" font-size="11" font-weight="800" fill="#fff" text-anchor="middle">${t}</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  const KIND = { pdf: 'PDF書類', docx: 'Word 文書', xlsx: 'Excel ワークブック', pptx: 'PowerPoint プレゼンテーション', txt: 'テキスト書類', csv: 'CSV 書類', png: 'PNG 画像', md: 'Markdown' };
  const status = { peers: [{ device: '会社用PC', host: '192.168.1.21', online: true }, { device: '自宅iMac', host: '192.168.1.34', online: true }], onlineCount: 2 };
  const settings = { deviceName: ME.device, syncKey: '', autoScan: true, peers: [], launchAtLogin: false, ...(window.__SETTINGS || {}) };
  window.bridge = {
    platform, isWindows11: platform === 'win32',
    getPathForFile: (f) => (f && f.path) || '', startDrag() { },
    getFileIcon: async (p) => icon(p), getFileKind: async (p) => KIND[ext(p)] || '書類',
    downloadUrl: async () => null, saveTextSnippet: async () => null,
    onAddFile: on('add-file'), getDeviceInfo: async () => ME, registerSyncFile: async () => ({ id: 'mock', unsynced: false }),
    onSyncPending: on('sync-pending'), onSyncPendingRemove: on('sync-pending-remove'), onSyncProgress: on('sync-progress'),
    cancelSyncDownload() { }, retrySyncDownload: async () => { }, extractFolderZip: async () => null,
    previewFile() { }, expandShelter() { }, collapseShelter() { }, collapseShelterNow() { }, holdPointer() { },
    onShelterExpanded: on('shelter-expanded'), onShelterCollapsed: on('shelter-collapsed'),
    onClipboardItem: on('clipboard-item'),
    writeClipboardText() { }, writeClipboardImage() { }, writeClipboardFile() { },
    dragClipboardText: async () => null, ensureClipboardTextFile: async () => null, deleteTempFile() { }, reportRetainedPaths() { },
    persistItems() { }, onRestoreItems: on('restore-items'), statPaths: async () => [],
    onConfirmAddFile: on('confirm-add-file'), confirmAddFile() { },
    revealInFinder() { }, openFile() { }, openExternal() { }, openAccessibilitySettings() { }, onPastePermissionNeeded: on('paste-permission-needed'), copyPlainText() { },
    getSyncStatus: async () => status, onSyncStatus: on('sync-status'), setSyncPaused: async () => { }, syncEntryNow: async () => { }, setPeerEnabled: async () => { },
    scanPeersNow: async () => { }, revealLog() { },
    getSettings: async () => settings, saveSettings: async (s) => s, onOpenSettings: on('open-settings'),
    pairHostStart: async () => ({ role: 'host', phase: 'waiting', closedReason: null, sas: null, peerName: null, expiresAt: Date.now() + 112000, failures: 0, accepted: null }),
    pairHostCancel() { }, pairHostDecide() { }, pairJoinScan: async () => true,
    pairCandidates: async () => window.__PAIR_CANDIDATES || [], pairJoinConnect: async () => ({ ok: true }), pairJoinDecide() { }, pairJoinCancel() { },
    onPairState: on('pair-state'),
    checkForUpdates() { }, onUpdateAvailable: on('update-available'), onUpdateNone: on('update-none'),
    tabActivate() { }, onPopupItems: on('popup-items'), popupChoose() { }, popupClose() { },
  };
  window.__emit = (n, p) => (cbs[n] || []).forEach((cb) => cb(p));
  window.__status = status;
  window.addEventListener('load', () => setTimeout(() => { window.__emit('sync-status', status); window.__mockReady = true; }, 300));
})();
