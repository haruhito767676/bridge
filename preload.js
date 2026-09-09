const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
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

  // ローカル生まれのファイルをマルチデバイス同期の台帳へ登録する (他拠点由来は登録しない)
  registerSyncFile: (filePath, name) =>
    ipcRenderer.send('sync-register-file', { path: filePath, name }),

  // Mac 純正クイックルックでプレビュー
  previewFile: (filePath, fileName) =>
    ipcRenderer.send('preview-file', filePath, fileName),

  // シェルターウインドウの開閉（つまみホバー / ドラッグ進入 / マウスアウト）
  expandShelter: () => ipcRenderer.send('shelter-expand'),
  collapseShelter: () => ipcRenderer.send('shelter-collapse'),

  // ウインドウが展開された瞬間の通知 (検索状態のリセット & 検索バーへの自動フォーカス用)
  onShelterExpanded: (callback) => ipcRenderer.on('shelter-expanded', () => callback()),

  // クリップボード監視で検知された新規コピーを受け取る
  onClipboardItem: (callback) =>
    ipcRenderer.on('clipboard-item', (_event, item) => callback(item)),

  // 履歴アイテムのクリックで OS クリップボードへ再セット (Main 側で自動格納も行う)
  writeClipboardText: (text) => ipcRenderer.send('clipboard-write-text', text),
  writeClipboardImage: (filePath) => ipcRenderer.send('clipboard-write-image', filePath),
  // ファイルアイテムのクリックで「OS のファイル形式」としてセット (Finder で ⌘V → 本物のファイルを複製)
  writeClipboardFile: (filePath) => ipcRenderer.send('clipboard-write-file', filePath),

  // テキスト履歴を生成済みの .txt (無ければその場で生成) で OS ネイティブドラッグアウトする
  dragClipboardText: (payload) => ipcRenderer.send('drag-clipboard-text', payload),

  // 履歴の上限あふれでリストから消えた裏生成ファイル (clipboard_*.png) をディスクから削除する
  deleteTempFile: (filePath) => ipcRenderer.send('delete-temp-file', filePath),

  // 終了時クリーンアップの判定用に、現在リストに保持しているパス一覧を Main へ共有する
  reportRetainedPaths: (paths) => ipcRenderer.send('report-retained-paths', paths),

  // ---- マウス共有 HUD ----

  // HUD が開くたびに最新のデバイス一覧 + 現在のセッション状態を受け取る:
  // { devices: { id, device, iconType, isSelf, isOnline }[],
  //   session: { status: 'idle'|'host'|'client', targetDevice: string|null } }
  onHudSetDevices: (callback) =>
    ipcRenderer.on('hud-set-devices', (_event, payload) => callback(payload)),

  // HUD が開いている間にセッション状態だけがリアルタイムに変わった際の差分通知
  // ({ status: 'idle'|'host'|'client', targetDevice: string|null })
  onHudSessionStatus: (callback) =>
    ipcRenderer.on('hud-session-status', (_event, session) => callback(session)),

  // Enter で選択デバイスへの操作引き継ぎを確定 / Esc でキャンセル
  hudConfirm: (deviceId) => ipcRenderer.send('hud-confirm', deviceId),
  hudCancel: () => ipcRenderer.send('hud-cancel'),

  // target 側で Accessibility 権限が未許可のまま control-start を受けた際の通知
  // (システム設定への誘導バナーをシェルフ UI に表示するために使う)
  onAccessibilityPermissionNeeded: (callback) =>
    ipcRenderer.on('accessibility-permission-needed', () => callback()),

  // 通知トーストの「設定を開く」から呼ばれる。既に許可済みなら何も起きず、
  // 未許可なら macOS 標準の「システム設定へ促す」ダイアログが Main 側の処理で開く
  requestAccessibilityPermission: () => ipcRenderer.send('request-accessibility-permission'),

  // controller 側 (host) で macOS の Input Monitoring 権限が未許可のままネイティブ
  // マウス捕捉を試みた際の通知。target 側の Accessibility 未許可とは異なりセッション
  // は拒否されず Pointer Lock 方式へフォールバックして継続する
  onInputMonitoringPermissionNeeded: (callback) =>
    ipcRenderer.on('input-monitoring-permission-needed', () => callback()),

  // controller 側で接続確立・ハンドシェイクに失敗した際の通知
  onControlConnectFailed: (callback) =>
    ipcRenderer.on('control-connect-failed', (_event, payload) => callback(payload)),

  // ---- マウス共有 全画面キャプチャオーバーレイ ----

  // Main → Overlay: アクティブ化 (Pointer Lock 要求・バナー表示) / 非アクティブ化 (ロック解除)
  onOverlayActivate: (callback) =>
    ipcRenderer.on('overlay-activate', (_event, payload) => callback(payload)),
  onOverlayDeactivate: (callback) =>
    ipcRenderer.on('overlay-deactivate', () => callback()),

  // Overlay → Main: 捕捉したマウス入力イベントをそのまま転送する (間引きなし)。
  // Bridge はマウス共有のみを扱い、キーボードの転送・注入は行わない
  overlaySendMouseMove: (dx, dy) => ipcRenderer.send('overlay-mouse-move', { dx, dy }),
  overlaySendMouseButton: (button, action) => ipcRenderer.send('overlay-mouse-button', { button, action }),
  overlaySendWheel: (dx, dy) => ipcRenderer.send('overlay-wheel', { dx, dy }),
});
