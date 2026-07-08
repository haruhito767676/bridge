const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  // Electron 32+ では File.path が廃止されたため、公式後継 API で絶対パスを取得する
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // OS標準のドラッグアウトを Main プロセスに依頼する
  startDrag: (filePath) => ipcRenderer.send('ondragstart', filePath),

  // リスト表示用のファイルアイコン (Data URL)
  getFileIcon: (filePath) => ipcRenderer.invoke('get-file-icon', filePath),

  // Mac 純正クイックルックでプレビュー
  previewFile: (filePath, fileName) =>
    ipcRenderer.send('preview-file', filePath, fileName),
});
