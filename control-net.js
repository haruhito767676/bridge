// マウス共有のための TCP コントロールチャネル。
//
// WebSocket ではなく Node 標準の net モジュールによる生 TCP を採用する。通信相手は
// 常に信頼済みの Bridge プロセス同士 (ブラウザから接続されることはない) なので、
// WebSocket のハンドシェイク / フレーミングのオーバーヘッドは不要と判断した。
//
// フレーミングは改行区切り JSON (NDJSON)。ペイロードは常に小さく (ファイル転送は
// 既存の同期 HTTP 経路のまま)、length-prefix より単純なこの方式で十分。
//
// 200Hz 級の高リフレッシュレート環境でも遅延を出さないため、接続確立直後に必ず
// socket.setNoDelay(true) を呼び Nagle アルゴリズムを無効化する。

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const CONTROL_PORT = 9096;
const HELLO_TIMEOUT_MS = 3000;
const HEARTBEAT_MS = 2000;
const SESSION_TIMEOUT_MS = 6000;

// secretToken の照合。既存の同期 HTTP サーバー (main.js の isAuthorizedRequest) と
// 同じ timingSafeEqual による定数時間比較をここに集約し、両者から再利用する
function tokensMatch(provided, expected) {
  const a = Buffer.from(String(provided || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  return a.length > 0 && b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ソケットに1行 (NDJSON) を書き込む
function writeMessage(socket, msg) {
  socket.write(JSON.stringify(msg) + '\n');
}

// 受信バッファを改行で分割し、完成した行だけを JSON.parse して逐次コールバックする。
// 壊れた行 (JSON.parse 失敗) は前方互換の精神で黙って読み飛ばす
function makeLineReader(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      onMessage(msg);
    }
  };
}

// ---- サーバー側 (target: 操作を受け取る側) ----
//
// 'session' イベントで ControlSession を1つずつ発行する。実際の入力注入は
// control-input.js 側の責務であり、このモジュールはプロトコル層のみを扱う。
class ControlSession extends EventEmitter {
  constructor(socket, hello) {
    super();
    this.socket = socket;
    this.fromDevice = hello.device;
    this.fromPlatform = hello.platform;
    this.id = null; // control-start 受信時に確定
    this._lastMessageAt = Date.now();
    this._closed = false;

    this._timeoutTimer = setInterval(() => {
      if (Date.now() - this._lastMessageAt > SESSION_TIMEOUT_MS) {
        this._teardown('timeout');
      }
    }, 1000);

    socket.on('data', makeLineReader((msg) => this._handleMessage(msg)));
    socket.on('close', () => this._teardown('peer-disconnected'));
    socket.on('error', () => this._teardown('error'));
  }

  _handleMessage(msg) {
    this._lastMessageAt = Date.now();
    if (!msg || typeof msg.type !== 'string') return; // 前方互換: 不正な形は無視
    switch (msg.type) {
      case 'control-start':
        this.id = msg.id;
        this.emit('control-start', msg);
        break;
      case 'control-end':
        this.emit('control-end', msg);
        this._teardown(msg.reason || 'user-confirmed');
        break;
      case 'heartbeat':
        break; // _lastMessageAt の更新だけで十分
      case 'mouse-move':
      case 'mouse-button':
      case 'wheel':
        this.emit('input', msg);
        break;
      default:
        break; // 未知の type は黙って無視 (既存の同期プロトコルと同じ前方互換方針)
    }
  }

  _teardown(reason) {
    if (this._closed) return; // 複数経路からの二重呼び出しに備えて冪等にする
    this._closed = true;
    clearInterval(this._timeoutTimer);
    this.emit('close', reason);
    if (!this.socket.destroyed) this.socket.destroy();
  }

  close(reason) {
    this._teardown(reason || 'user-confirmed');
  }

  // controller へメッセージを送り返す (例: control-start-reject)
  send(msg) {
    if (!this.socket.destroyed) writeMessage(this.socket, msg);
  }
}

function startControlServer({ getToken, getDeviceName }) {
  const emitter = new EventEmitter();

  const server = net.createServer((socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 1000);

    let helloHandled = false;
    const helloTimer = setTimeout(() => {
      if (!helloHandled) socket.destroy();
    }, HELLO_TIMEOUT_MS);

    const onHelloData = makeLineReader((msg) => {
      if (helloHandled) return;
      if (!msg || msg.type !== 'hello' || typeof msg.token !== 'string') {
        helloHandled = true;
        clearTimeout(helloTimer);
        writeMessage(socket, { type: 'hello-reject', reason: 'malformed-hello' });
        socket.destroy();
        return;
      }
      if (!tokensMatch(msg.token, getToken())) {
        helloHandled = true;
        clearTimeout(helloTimer);
        writeMessage(socket, { type: 'hello-reject', reason: 'bad-token' });
        socket.destroy();
        return;
      }
      helloHandled = true;
      clearTimeout(helloTimer);
      writeMessage(socket, {
        type: 'hello-ack',
        device: getDeviceName(),
        platform: process.platform,
      });
      socket.removeListener('data', onHelloData);
      const session = new ControlSession(socket, msg);
      emitter.emit('session', session);
    });

    socket.on('data', onHelloData);
    socket.on('error', () => {
      // hello 前のソケットエラーはここで握りつぶす (ControlSession 生成前はハンドラなし)
    });
  });

  server.listen(CONTROL_PORT, '0.0.0.0');
  emitter.server = server;
  emitter.close = () => server.close();
  return emitter;
}

// ---- クライアント側 (controller: 操作を送る側) ----
//
// ready になった後は .send(msg) で任意のセッションメッセージを送出できる。
// ハートビートは接続中ずっと自動送信し、呼び出し側で意識する必要はない
class ControlClient extends EventEmitter {
  constructor(host, port, { getToken, getDeviceName }) {
    super();
    this._heartbeatTimer = null;
    this._ready = false;

    const socket = net.connect(port, host);
    this.socket = socket;

    socket.on('connect', () => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 1000);
      writeMessage(socket, {
        type: 'hello',
        protocolVersion: 1,
        token: getToken(),
        device: getDeviceName(),
        platform: process.platform,
      });
    });

    const helloTimer = setTimeout(() => {
      if (!this._ready) {
        this.emit('error', new Error('hello timeout'));
        socket.destroy();
      }
    }, HELLO_TIMEOUT_MS);

    const onHelloData = makeLineReader((msg) => {
      if (this._ready) return;
      if (msg && msg.type === 'hello-ack') {
        clearTimeout(helloTimer);
        this._ready = true;
        socket.removeListener('data', onHelloData);
        socket.on('data', makeLineReader((m) => this.emit('message', m)));
        this._heartbeatTimer = setInterval(() => {
          this.send({ type: 'heartbeat', ts: Date.now() });
        }, HEARTBEAT_MS);
        this.emit('ready', { device: msg.device, platform: msg.platform });
      } else if (msg && msg.type === 'hello-reject') {
        clearTimeout(helloTimer);
        this.emit('reject', msg.reason || 'unknown');
        socket.destroy();
      }
    });
    socket.on('data', onHelloData);

    socket.on('close', () => {
      clearTimeout(helloTimer);
      clearInterval(this._heartbeatTimer);
      this.emit('close');
    });
    socket.on('error', (err) => {
      this.emit('error', err);
    });
  }

  send(msg) {
    if (this.socket.destroyed) return;
    writeMessage(this.socket, msg);
  }

  close() {
    clearInterval(this._heartbeatTimer);
    if (!this.socket.destroyed) this.socket.destroy();
  }
}

function connectToPeer(host, port, options) {
  return new ControlClient(host, port, options);
}

module.exports = {
  CONTROL_PORT,
  HELLO_TIMEOUT_MS,
  HEARTBEAT_MS,
  SESSION_TIMEOUT_MS,
  tokensMatch,
  startControlServer,
  connectToPeer,
};
