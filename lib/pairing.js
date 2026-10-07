// ペアリング: 手で打たずに、同期キーを、2 台の間で渡す。Main とテストの両方から使う。
// 設計は docs/design/pairing.md (§7)。
//
// 「数字の比較」(Bluetooth と同じ考え方): 2 台の画面に出る 6 桁が、一致するかを、人が見比べる。
//   追加される側 = ホスト H (すでにキーを持っている)、参加する側 = J (これからキーをもらう)
//
//   1. J → H : jPub                        (J の X25519 公開鍵)
//   2. H → J : commit = SHA256(hPub ‖ jPub ‖ nH)   (H の「約束」。hPub と nH は、まだ明かさない)
//   3. J → H : nJ                          (J の乱数)
//   4. H → J : hPub, nH                    (J は、約束と一致するか検証する)
//   5. 両方 : SAS = 6 桁 (jPub, hPub, nJ, nH から) を、画面に出す。人が見比べて、「一致」を押す
//   6. J → H : mac = HMAC(K, "confirm-J" ‖ transcript)
//   7. H → J : AES-256-GCM(K, { secretToken, deviceName })    ← 同期キーは、ここで初めて渡す
//
// 途中に割り込む人は、J と H の両方と、別々に鍵交換するしかなく、2 台の 6 桁が、食い違う。
// H が先に約束するので、6 桁が一致するような値を、あとから選べない (一致する確率は、100 万分の 1)。
const crypto = require('crypto');
const { encryptJson, decryptJson } = require('./sync-crypto');

const PAIR_WINDOW_MS = 120 * 1000; // 待ち受けの有効時間
const PAIR_SESSION_MS = 60 * 1000; // 1 回の接続が、途中で止まっていてよい時間 (止まったら、次の人が使える)
const PAIR_MAX_FAILURES = 3;
const PAIR_SECRET_MIN = 16;
const PAIR_SECRET_MAX = 256;

const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

class PairError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.reason = reason;
  }
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

function fromB64u(value, length) {
  if (typeof value !== 'string') throw new PairError('format');
  const buf = Buffer.from(value, 'base64url');
  if (buf.length !== length) throw new PairError('format');
  return buf;
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  return { privateKey, publicRaw: Buffer.from(raw) };
}

function sharedSecret(privateKey, peerPublicRaw) {
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519_PREFIX, peerPublicRaw]), format: 'der', type: 'spki' });
  let secret;
  try {
    secret = crypto.diffieHellman({ privateKey, publicKey });
  } catch {
    throw new PairError('weak-key'); // 危険な公開鍵 (結果が全部ゼロになるもの) は、OpenSSL が拒否する
  }
  if (secret.every((b) => b === 0)) throw new PairError('weak-key');
  return secret;
}

function commitment(hPub, jPub, nH) {
  return b64u(crypto.createHash('sha256').update('bridge-pair-commit-v1\0').update(hPub).update(jPub).update(nH).digest());
}

function transcriptOf(jPub, hPub, nJ, nH) {
  return Buffer.concat([Buffer.from('bridge-pair-transcript-v1\0'), jPub, hPub, nJ, nH]);
}

// 画面に出す 6 桁。2 台で同じになるはずの値
function sasOf(transcript) {
  const n = crypto.createHash('sha256').update(transcript).digest().readUInt32BE(0) % 1000000;
  return String(n).padStart(6, '0');
}

// 「483291」→「483 291」
function formatSas(sas) {
  return String(sas).replace(/^(\d{3})(\d{3})$/, '$1 $2');
}

function sessionKeyOf(shared, transcript) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.concat([Buffer.from('bridge-pair-v1\0'), transcript]), 32));
}

function confirmMac(key, transcript) {
  return b64u(crypto.createHmac('sha256', key).update('confirm-J\0').update(transcript).digest());
}

function macEquals(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function validSecretToken(value) {
  return typeof value === 'string' && value.length >= PAIR_SECRET_MIN && value.length <= PAIR_SECRET_MAX;
}

// ---- ホスト (追加される側) ----
// 待ち受けは、時間 (PAIR_WINDOW_MS)・回数 (1 回成功したら終わり)・失敗 (PAIR_MAX_FAILURES 回) で閉じる。
// handle(path, body) が、HTTP のエンドポイント (/pair/start・/pair/reveal・/pair/confirm・/pair/cancel) の中身
class PairingHost {
  // onChange(snapshot): 画面に出す状態が変わるたびに呼ばれる
  constructor({ secretToken, deviceName, now = Date.now, windowMs = PAIR_WINDOW_MS, sessionMs = PAIR_SESSION_MS, maxFailures = PAIR_MAX_FAILURES, onChange } = {}) {
    this.secretToken = secretToken;
    this.deviceName = deviceName;
    this.now = now;
    this.windowMs = windowMs;
    this.sessionMs = sessionMs;
    this.maxFailures = maxFailures;
    this.onChange = onChange || (() => {});
    this.id = b64u(crypto.randomBytes(16));
    this.openedAt = now();
    this.closedReason = null; // 'done' | 'expired' | 'locked' | 'cancelled'
    this.failures = 0;
    this.session = null;
  }

  get expiresAt() {
    return this.openedAt + this.windowMs;
  }

  isOpen() {
    this.tick();
    return this.closedReason === null;
  }

  // 時間切れの確認。定期的に呼ぶ
  tick() {
    const t = this.now();
    if (this.closedReason === null && t >= this.expiresAt) this.close('expired');
    if (this.closedReason === null && this.session && t - this.session.startedAt >= this.sessionMs) {
      this.endSession({ error: 'timeout' });
    }
  }

  snapshot() {
    const s = this.session;
    let phase = 'waiting';
    if (this.closedReason) phase = 'closed';
    else if (s) phase = s.stage === 'committed' ? 'connecting' : 'sas';
    return {
      role: 'host',
      phase,
      closedReason: this.closedReason,
      sas: s && s.stage !== 'committed' ? s.sas : null,
      peerName: s ? s.peerName : null,
      expiresAt: this.expiresAt,
      failures: this.failures,
      accepted: s ? s.accepted : null,
    };
  }

  notify() {
    this.onChange(this.snapshot());
  }

  close(reason) {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    this.endSession({ error: reason === 'done' ? 'done' : 'closed' }, true);
    this.notify();
  }

  cancel() {
    this.close('cancelled');
  }

  // いまの接続を終える。待たされている /pair/confirm があれば、結果を返して解放する
  endSession(result, silent = false) {
    const s = this.session;
    if (!s) return;
    this.session = null;
    if (s.waiter) s.waiter(result);
    if (!silent) this.notify();
  }

  // 失敗を 1 回と数える。上限に達したら、待ち受けを閉じる
  fail(reason) {
    this.failures++;
    this.endSession({ error: reason });
    if (this.failures >= this.maxFailures) this.close('locked');
    else this.notify();
  }

  // ホストの人が、数字を見比べた結果 (一致 = true)
  decide(accept) {
    const s = this.session;
    if (!s || s.stage === 'committed' || s.accepted !== null) return false;
    if (!accept) {
      this.fail('rejected');
      return true;
    }
    s.accepted = true;
    this.releaseIfReady();
    this.notify();
    return true;
  }

  // 人の「一致」と、J の確認 (mac) の、両方がそろったときだけ、同期キーを渡す
  releaseIfReady() {
    const s = this.session;
    if (!s || !s.jConfirmed || s.accepted !== true || !s.waiter) return;
    const sealed = encryptJson(s.sessionKey, { secretToken: this.secretToken, deviceName: this.deviceName });
    const waiter = s.waiter;
    s.waiter = null;
    waiter({ sealed });
    this.close('done');
  }

  // HTTP のエンドポイント。戻り値は { status, body }
  async handle(path, body) {
    this.tick();
    if (this.closedReason !== null) return { status: 410, body: { error: 'closed' } };
    try {
      switch (path) {
        case '/pair/start':
          return this.handleStart(body || {});
        case '/pair/reveal':
          return this.handleReveal(body || {});
        case '/pair/confirm':
          return await this.handleConfirm(body || {});
        case '/pair/cancel':
          return this.handleCancel(body || {});
        case '/pair/leave':
          return this.handleLeave(body || {});
        default:
          return { status: 404, body: { error: 'not-found' } };
      }
    } catch (err) {
      if (err instanceof PairError) {
        // 接続の合言葉 (sid) を知らない相手のでたらめなリクエストは、本物の接続の邪魔をしないよう、数えない
        if (err.reason !== 'session' && this.session) this.fail(err.reason);
        return { status: 400, body: { error: err.reason } };
      }
      throw err;
    }
  }

  matchSession(body) {
    const s = this.session;
    if (!s || typeof body.sid !== 'string' || !macEquals(body.sid, s.sid)) throw new PairError('session');
    return s;
  }

  handleStart(body) {
    if (body.id !== this.id) return { status: 404, body: { error: 'not-found' } };
    if (this.session) return { status: 409, body: { error: 'busy' } };
    const jPub = fromB64u(body.jPub, 32);
    const keys = generateKeyPair();
    const nH = crypto.randomBytes(16);
    this.session = {
      sid: b64u(crypto.randomBytes(16)),
      stage: 'committed',
      startedAt: this.now(),
      jPub,
      hPub: keys.publicRaw,
      privateKey: keys.privateKey,
      nH,
      peerName: typeof body.name === 'string' ? body.name.slice(0, 64) : '',
      accepted: null,
      jConfirmed: false,
      waiter: null,
    };
    this.notify();
    return { status: 200, body: { sid: this.session.sid, commit: commitment(keys.publicRaw, jPub, nH) } };
  }

  handleReveal(body) {
    const s = this.matchSession(body);
    if (s.stage !== 'committed') throw new PairError('order');
    const nJ = fromB64u(body.nJ, 16);
    const shared = sharedSecret(s.privateKey, s.jPub);
    s.transcript = transcriptOf(s.jPub, s.hPub, nJ, s.nH);
    s.sas = sasOf(s.transcript);
    s.sessionKey = sessionKeyOf(shared, s.transcript);
    s.stage = 'revealed';
    this.notify();
    return { status: 200, body: { hPub: b64u(s.hPub), nH: b64u(s.nH) } };
  }

  // 数字の確認がそろうまで、応答を待たせる (長めに待つ)。結果は、同期キーを暗号化したもの
  handleConfirm(body) {
    const s = this.matchSession(body);
    if (s.stage !== 'revealed' || s.jConfirmed) throw new PairError('order');
    if (!macEquals(body.mac, confirmMac(s.sessionKey, s.transcript))) throw new PairError('mac');
    s.jConfirmed = true;
    return new Promise((resolve) => {
      s.waiter = (result) => {
        if (result.sealed) resolve({ status: 200, body: { sealed: result.sealed } });
        else resolve({ status: 403, body: { error: result.error || 'failed' } });
      };
      this.releaseIfReady();
    });
  }

  // J が、数字を見比べる前にやめるとき (画面を閉じた、通信が切れた)。失敗とは数えない
  handleLeave(body) {
    this.matchSession(body);
    this.endSession({ error: 'left' });
    return { status: 200, body: { ok: true } };
  }

  // 通信が切れたなどで、その接続だけを終える。別の (新しい) 接続は、巻き込まない
  dropSession(sid) {
    if (this.session && typeof sid === 'string' && macEquals(sid, this.session.sid)) this.endSession({ error: 'left' });
  }

  // J が、数字が合わないと判断して、やめるとき。攻撃の可能性があるので、失敗として数える
  handleCancel(body) {
    this.matchSession(body);
    this.fail('rejected-by-peer');
    return { status: 200, body: { ok: true } };
  }
}

// ---- 参加する側 (J) ----
// post(path, body) → Promise<{ status, body }>。通信は、呼び出し側が用意する (テストでは、通信を使わずにつなぐ)
// onSas(sas) → Promise<boolean>: 6 桁を人に見せて、「一致」か「違う」かを待つ
async function runJoin({ post, pairId, deviceName, onSas, onStage = () => {} }) {
  const keys = generateKeyPair();
  const call = async (path, body) => {
    let res;
    try {
      res = await post(path, body);
    } catch (err) {
      throw new PairError(err && err.reason ? err.reason : 'network', err && err.message);
    }
    return res;
  };
  const check = (res) => {
    if (res.status === 409) throw new PairError('busy');
    if (res.status === 410 || res.status === 404) throw new PairError('closed');
    if (res.status !== 200) throw new PairError((res.body && res.body.error) || 'failed');
    return res.body || {};
  };

  let sid = null;
  let notified = false; // ホストへ、やめることを伝え済みか
  try {
    onStage('connecting');
    const started = check(await call('/pair/start', { id: pairId, jPub: b64u(keys.publicRaw), name: deviceName }));
    sid = started.sid;
    const commit = started.commit;
    if (typeof sid !== 'string' || typeof commit !== 'string') throw new PairError('format');

    const nJ = crypto.randomBytes(16);
    const revealed = check(await call('/pair/reveal', { sid, nJ: b64u(nJ) }));
    const hPub = fromB64u(revealed.hPub, 32);
    const nH = fromB64u(revealed.nH, 16);
    // H の約束と合わなければ、中止する (攻撃の可能性)
    if (!macEquals(commit, commitment(hPub, keys.publicRaw, nH))) {
      notified = true;
      await call('/pair/cancel', { sid }).catch(() => {});
      throw new PairError('commit-mismatch');
    }
    const transcript = transcriptOf(keys.publicRaw, hPub, nJ, nH);
    const sas = sasOf(transcript);
    const key = sessionKeyOf(sharedSecret(keys.privateKey, hPub), transcript);

    onStage('sas');
    const accepted = await onSas(sas);
    if (!accepted) {
      notified = true;
      await call('/pair/cancel', { sid }).catch(() => {});
      throw new PairError('rejected');
    }

    onStage('waiting-host');
    const confirmed = check(await call('/pair/confirm', { sid, mac: confirmMac(key, transcript) }));
    let payload;
    try {
      payload = decryptJson(key, confirmed.sealed);
    } catch {
      throw new PairError('decrypt');
    }
    if (!payload || !validSecretToken(payload.secretToken)) throw new PairError('format');
    return { secretToken: payload.secretToken, peerName: typeof payload.deviceName === 'string' ? payload.deviceName.slice(0, 64) : '' };
  } catch (err) {
    // 途中でやめたとき (画面を閉じた・通信が切れた) は、ホストの待ち受けを、早く空けるために知らせる
    if (sid && !notified) await call('/pair/leave', { sid }).catch(() => {});
    throw err;
  }
}

module.exports = {
  PAIR_WINDOW_MS,
  PAIR_SESSION_MS,
  PAIR_MAX_FAILURES,
  PairError,
  PairingHost,
  runJoin,
  formatSas,
  // テスト用に公開する部品
  generateKeyPair,
  sharedSecret,
  commitment,
  transcriptOf,
  sasOf,
  sessionKeyOf,
  confirmMac,
};
