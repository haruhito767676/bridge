// VSCode 統合ターミナルなど、Electron ホスト由来の ELECTRON_RUN_AS_NODE を
// 引き継いだシェルから `npm start` すると、electron が Node モードで起動し
// `require('electron').app` が undefined になってクラッシュする。
// ここで明示的に環境変数を除去してから electron を起動することでそれを防ぐ。
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
