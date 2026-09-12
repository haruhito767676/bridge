const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  // 実行中の OS ('darwin' | 'win32' | 'linux')。キー表記やフォールバック背景の出し分けに使う
  platform: process.platform,
  // Windows 11 (ビルド 22000 以降) なら Acrylic が使えるので、地の色を半透明にできる。
  // サンドボックス化された preload では os モジュールが使えないため process.getSystemVersion() で判定する
  isWindows11:
    process.platform === 'win32' &&
    Number(((typeof process.getSystemVersion === 'function' ? process.getSystemVersion() : '').split('.')[2]) || 0) >= 22000,

  // Electron 32+ では File.path が廃止されたため、公式後継 API で絶対パスを取得する
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // OS標準のドラッグアウトを Main プロセスに依頼する（複数選択したファイルをまとめて渡せる）
  startDrag: (filePaths) => ipcRenderer.send('ondragstart', { files: filePaths }),

  // リスト表示用のファイルアイコン (Data URL)
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),

  // Finder 純正の「種類」ラベル (例: 「PDF書類」「フォルダ」)
  getFileKind: (filePath) => ipcRenderer.invoke('get-file-kind', filePath),

  // Web 画像の URL を Main プロセスでダウンロードし { path, name } を受け取る
  downloadUrl: (url) => ipcRenderer.invoke('download-url', url),

  // ドロップされたテキストを snippet_[タイムスタンプ].txt として保存する
  saveTextSnippet: (text) => ipcRenderer.invoke('save-text-snippet', text),

  // bridge:// URL スキーム・クリップボード監視・他拠点からの同期で届いたファイルを受け取る。
  // payload は { path, name, fromDevice, fromPlatform } (旧形式のパス文字列にも Renderer 側で対応)
  onAddFile: (callback) =>
    ipcRenderer.on('add-file', (_event, payload) => callback(payload)),

  // 自分のデバイス名とプラットフォーム ({ device, platform })。出身デバイスバッジの判定に使う
  getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),

  // ローカル生まれのファイルをマルチデバイス同期の台帳へ登録する (他拠点由来は登録しない)。
  // timestamp はシェルフに置いた時刻。同期先でもこの時刻で並ぶ
  registerSyncFile: (filePath, name, timestamp) =>
    ipcRenderer.send('sync-register-file', { path: filePath, name, timestamp }),

  // 他拠点からの実体ダウンロードが終わる前に届く「同期中」のプレースホルダと、その取り下げ
  onSyncPending: (callback) => ipcRenderer.on('sync-pending', (_event, info) => callback(info)),
  onSyncPendingRemove: (callback) =>
    ipcRenderer.on('sync-pending-remove', (_event, info) => callback(info)),
  // 受信中の進捗 { syncId, received, total } (total は不明なら 0)
  onSyncProgress: (callback) => ipcRenderer.on('sync-progress', (_event, info) => callback(info)),
  // 「同期中」の行の × (中止) と再試行ボタン
  cancelSyncDownload: (syncId) => ipcRenderer.send('cancel-sync-download', syncId),
  retrySyncDownload: (syncId) => ipcRenderer.invoke('retry-sync-download', syncId),

  // 上限超えで zip のまま届いたフォルダを手動で展開する。展開後のフォルダのパスを返す
  extractFolderZip: (filePath, folderName) =>
    ipcRenderer.invoke('extract-folder-zip', { path: filePath, folderName }),

  // Mac 純正クイックルックでプレビュー
  previewFile: (filePath, fileName) =>
    ipcRenderer.send('preview-file', filePath, fileName),

  // シェルターウインドウの開閉（つまみクリック / ドラッグ進入 / マウスアウト）
  expandShelter: () => ipcRenderer.send('shelter-expand'),
  collapseShelter: () => ipcRenderer.send('shelter-collapse'),
  // ディレイなしの即時格納 (コピー確認を見せ終えた後など)
  collapseShelterNow: () => ipcRenderer.send('shelter-collapse-now'),
  // 矩形選択などでマウスボタンを押し続けている間、カーソル離脱による強制格納を保留させる
  holdPointer: (holding) => ipcRenderer.send('shelter-hold-pointer', holding),

  // ウインドウが展開された瞬間の通知。{ focus } が true のとき (ホットキー等の明示的な呼び出し) だけ
  // 検索バーへフォーカスする。ホバー展開ではフォーカスを奪わない
  onShelterExpanded: (callback) =>
    ipcRenderer.on('shelter-expanded', (_event, info) => callback(info || {})),
  onShelterCollapsed: (callback) => ipcRenderer.on('shelter-collapsed', () => callback()),

  // クリップボード監視で検知された新規コピーを受け取る
  onClipboardItem: (callback) =>
    ipcRenderer.on('clipboard-item', (_event, item) => callback(item)),

  // 履歴アイテムのクリックで OS クリップボードへ再セット (Main 側で自動格納も行う)
  writeClipboardText: (text) => ipcRenderer.send('clipboard-write-text', text),
  writeClipboardImage: (filePath) => ipcRenderer.send('clipboard-write-image', filePath),
  // ファイルアイテムのクリックで「OS のファイル形式」としてセット (Finder で ⌘V → 本物のファイルを複製)
  writeClipboardFile: (filePath) => ipcRenderer.send('clipboard-write-file', filePath),

  // テキスト履歴を .txt (無ければその場で生成) で OS ネイティブドラッグアウトし、生成したパスを返す
  dragClipboardText: (payload) => ipcRenderer.invoke('drag-clipboard-text', payload),
  // テキスト履歴の実体ファイルを (無ければ生成して) 返す。クイックルック用
  ensureClipboardTextFile: (payload) => ipcRenderer.invoke('ensure-clipboard-text-file', payload),

  // 履歴の上限あふれでリストから消えた裏生成ファイル (clipboard_*.png) をディスクから削除する
  deleteTempFile: (filePath) => ipcRenderer.send('delete-temp-file', filePath),

  // 終了時クリーンアップの判定用に、現在リストに保持しているパス一覧を Main へ共有する
  reportRetainedPaths: (paths) => ipcRenderer.send('report-retained-paths', paths),

  // 履歴の永続化: 保存用の一覧を Main へ渡す / 起動時に前回の一覧を受け取る
  persistItems: (items) => ipcRenderer.send('persist-items', { items }),
  onRestoreItems: (callback) =>
    ipcRenderer.on('restore-items', (_event, items) => callback(Array.isArray(items) ? items : [])),

  // 渡したパスのうち存在しないものを返す (移動・削除されたファイルの検知)
  statPaths: (paths) => ipcRenderer.invoke('stat-paths', paths),

  // bridge://add?path= の確認。Main からの問い合わせと、ユーザーが「追加」を押したときの応答
  onConfirmAddFile: (callback) =>
    ipcRenderer.on('confirm-add-file', (_event, info) => callback(info)),
  confirmAddFile: (filePath) => ipcRenderer.send('confirm-add-file', filePath),

  // コンテキストメニューのアクション
  revealInFinder: (filePath) => ipcRenderer.send('reveal-in-finder', filePath),
  openFile: (filePath) => ipcRenderer.send('open-file', filePath),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  openAccessibilitySettings: () => ipcRenderer.send('open-accessibility-settings'),
  onPastePermissionNeeded: (callback) => ipcRenderer.on('paste-permission-needed', () => callback()),
  // テキストをそのままクリップボードへ (パスのコピーなど。履歴の書き戻しとは区別する)
  copyPlainText: (text) => ipcRenderer.send('clipboard-copy-plain', text),

  // 同期状態 ({ peers: [{ device, host, online }], onlineCount })
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
  onSyncStatus: (callback) => ipcRenderer.on('sync-status', (_event, status) => callback(status)),

  // 設定シートの「いま探す」(マルチキャストで名乗り + サブネットスキャン) と「ログを表示」
  scanPeersNow: () => ipcRenderer.invoke('scan-peers-now'),
  revealLog: () => ipcRenderer.send('reveal-log'),

  // 設定 (デバイス名・同期キー・自動発見・手動ピア・ログイン時起動)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  // メニューバーから「設定…」が選ばれたとき
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),

  // アップデートの確認結果
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_event, info) => callback(info)),
  onUpdateNone: (callback) => ipcRenderer.on('update-none', (_event, info) => callback(info)),

  // Windows のつまみウインドウ (tab.html 専用): ホバー滞留 / クリック / ドラッグ進入でそのモニターにシェルフを出す
  tabActivate: (displayId) => ipcRenderer.send('tab-activate', displayId),

  // ペースト用ポップアップ (popup.html 専用)
  onPopupItems: (callback) => ipcRenderer.on('popup-items', (_event, payload) => callback(payload)),
  popupChoose: (choice) => ipcRenderer.send('popup-choose', choice),
  popupClose: () => ipcRenderer.send('popup-close'),
});
