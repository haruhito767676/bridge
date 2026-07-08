const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  expand: () => ipcRenderer.send('shelf:expand'),
  collapse: () => ipcRenderer.send('shelf:collapse'),

  // File オブジェクトから絶対パスを取得（Electron 32+ では file.path が廃止されたため）
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // ネイティブなドラッグアウト開始
  startDrag: (filePath) => ipcRenderer.send('shelf:drag-out', filePath),

  // リスト表示用のファイルアイコン (Data URL)
  getFileIcon: (filePath) => ipcRenderer.invoke('shelf:file-icon', filePath),

  // main プロセスからの状態通知
  onShelfState: (callback) => ipcRenderer.on('shelf:state', (_e, expanded) => callback(expanded)),
  onBlurred: (callback) => ipcRenderer.on('shelf:blurred', () => callback()),
});
