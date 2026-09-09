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
});
