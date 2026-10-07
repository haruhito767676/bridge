const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('../lib/pairing.js');

const SECRET = 'f'.repeat(64);

// 通信を使わずに、J の通信をホストの handle へ直接つなぐ (JSON を通して、本物と同じように、値だけを渡す)
function makePost(host, log = []) {
  return async (path, body) => {
    log.push({ path, body });
    const res = await host.handle(path, JSON.parse(JSON.stringify(body)));
    log.push({ path, response: res.body });
    return JSON.parse(JSON.stringify(res));
  };
}

function newHost(opts = {}) {
  const snapshots = [];
  const host = new P.PairingHost({ secretToken: SECRET, deviceName: 'Mac', onChange: (s) => snapshots.push(s), ...opts });
  return { host, snapshots };
}

// ホストの画面に出た 6 桁を、J の 6 桁と比べて、一致していれば「一致」を押す (人の動き)
function humanComparing(host, joinerSas) {
  return (snap) => {
    if (snap.phase === 'sas' && snap.accepted === null) setImmediate(() => host.decide(snap.sas === joinerSas.value));
  };
}

test('ペアリングの成功: 2 台の 6 桁が一致し、同期キーが、J に渡る', async () => {
  const joinerSas = { value: null };
  const { host } = newHost({ onChange: (s) => humanComparing(host, joinerSas)(s) });
  let hostSas = null;
  const orig = host.onChange;
  host.onChange = (s) => {
    if (s.sas) hostSas = s.sas;
    orig(s);
  };
  const result = await P.runJoin({
    post: makePost(host),
    pairId: host.id,
    deviceName: 'Win',
    onSas: async (sas) => {
      joinerSas.value = sas;
      return true;
    },
  });
  assert.equal(result.secretToken, SECRET);
  assert.equal(result.peerName, 'Mac');
  assert.match(joinerSas.value, /^\d{6}$/);
  assert.equal(hostSas, joinerSas.value, '2 台の 6 桁は、同じになる');
  assert.equal(host.closedReason, 'done', '成功したら、待ち受けは、1 回で閉じる');
  assert.equal(host.snapshot().peerName, null);
});

test('通信に流れるもの (盗聴者が見られるもの) に、同期キーは出てこない', async () => {
  const log = [];
  const joinerSas = { value: null };
  const { host } = newHost({ onChange: (s) => humanComparing(host, joinerSas)(s) });
  await P.runJoin({
    post: makePost(host, log),
    pairId: host.id,
    deviceName: 'Win',
    onSas: async (sas) => ((joinerSas.value = sas), true),
  });
  const wire = JSON.stringify(log);
  assert.ok(!wire.includes(SECRET));
  assert.ok(!wire.includes(Buffer.from(SECRET).toString('base64')));
  assert.ok(!wire.includes(Buffer.from(SECRET).toString('base64url')));
});

test('J が「違う」を押したら、キーは渡らず、失敗が 1 回と数えられる (待ち受けは続く)', async () => {
  const { host } = newHost();
  await assert.rejects(
    P.runJoin({ post: makePost(host), pairId: host.id, deviceName: 'Win', onSas: async () => false }),
    (e) => e.reason === 'rejected'
  );
  assert.equal(host.failures, 1);
  assert.equal(host.closedReason, null);
  assert.equal(host.session, null);
});

test('ホストが「違う」を押したら、J にキーは渡らない', async () => {
  const { host } = newHost({ onChange: (s) => s.phase === 'sas' && s.accepted === null && setImmediate(() => host.decide(false)) });
  await assert.rejects(
    P.runJoin({ post: makePost(host), pairId: host.id, deviceName: 'Win', onSas: async () => true }),
    (e) => e.reason === 'rejected'
  );
  assert.equal(host.failures, 1);
});

test('失敗が 3 回で、待ち受けが閉じる。その後の接続は、受け付けない', async () => {
  const { host } = newHost();
  for (let i = 0; i < 3; i++) {
    await assert.rejects(P.runJoin({ post: makePost(host), pairId: host.id, deviceName: 'Win', onSas: async () => false }));
  }
  assert.equal(host.closedReason, 'locked');
  await assert.rejects(
    P.runJoin({ post: makePost(host), pairId: host.id, deviceName: 'Win', onSas: async () => true }),
    (e) => e.reason === 'closed'
  );
});

test('120 秒の時間切れで、待ち受けが閉じる', async () => {
  let t = 1_000_000;
  const { host } = newHost({ now: () => t });
  assert.equal(host.isOpen(), true);
  t += P.PAIR_WINDOW_MS - 1;
  assert.equal(host.isOpen(), true);
  t += 1;
  assert.equal(host.isOpen(), false);
  assert.equal(host.closedReason, 'expired');
  await assert.rejects(
    P.runJoin({ post: makePost(host), pairId: host.id, deviceName: 'Win', onSas: async () => true }),
    (e) => e.reason === 'closed'
  );
});

test('途中で止まった接続は、時間が過ぎたら外れて、次の人が使える。止まっている間は、割り込めない', async () => {
  let t = 1_000_000;
  const { host } = newHost({ now: () => t });
  const first = await host.handle('/pair/start', { id: host.id, jPub: crypto.randomBytes(32).toString('base64url'), name: 'A' });
  assert.equal(first.status, 200);
  const second = await host.handle('/pair/start', { id: host.id, jPub: crypto.randomBytes(32).toString('base64url'), name: 'B' });
  assert.equal(second.status, 409);
  t += P.PAIR_SESSION_MS;
  const third = await host.handle('/pair/start', { id: host.id, jPub: P.generateKeyPair().publicRaw.toString('base64url'), name: 'C' });
  assert.equal(third.status, 200);
});

test('別のペアリング ID には、応答しない', async () => {
  const { host } = newHost();
  const res = await host.handle('/pair/start', { id: 'someone-else', jPub: P.generateKeyPair().publicRaw.toString('base64url') });
  assert.equal(res.status, 404);
});

test('接続の合言葉 (sid) を知らない相手は、本物の接続を壊せない / 数えもされない', async () => {
  const { host } = newHost();
  const jk = P.generateKeyPair();
  const start = await host.handle('/pair/start', { id: host.id, jPub: jk.publicRaw.toString('base64url'), name: 'J' });
  const bad = await host.handle('/pair/reveal', { sid: 'wrong', nJ: crypto.randomBytes(16).toString('base64url') });
  assert.equal(bad.status, 400);
  assert.equal(host.failures, 0);
  const good = await host.handle('/pair/reveal', { sid: start.body.sid, nJ: crypto.randomBytes(16).toString('base64url') });
  assert.equal(good.status, 200, '本物の接続は、続けられる');
});

test('確認 (mac) が誤りなら、拒否して、失敗と数える。キーは渡さない', async () => {
  const { host } = newHost();
  const jk = P.generateKeyPair();
  const start = await host.handle('/pair/start', { id: host.id, jPub: jk.publicRaw.toString('base64url'), name: 'J' });
  await host.handle('/pair/reveal', { sid: start.body.sid, nJ: crypto.randomBytes(16).toString('base64url') });
  host.decide(true);
  const res = await host.handle('/pair/confirm', { sid: start.body.sid, mac: 'forged' });
  assert.equal(res.status, 400);
  assert.ok(!JSON.stringify(res).includes(SECRET));
  assert.equal(host.failures, 1);
});

test('順序が違うリクエスト (reveal の前の confirm など) は、拒否する', async () => {
  const { host } = newHost();
  const jk = P.generateKeyPair();
  const start = await host.handle('/pair/start', { id: host.id, jPub: jk.publicRaw.toString('base64url'), name: 'J' });
  const res = await host.handle('/pair/confirm', { sid: start.body.sid, mac: 'x' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'order');
});

test('危険な公開鍵 (全部ゼロ) は、受け付けない', async () => {
  const { host } = newHost();
  const start = await host.handle('/pair/start', { id: host.id, jPub: Buffer.alloc(32).toString('base64url'), name: 'J' });
  const res = await host.handle('/pair/reveal', { sid: start.body.sid, nJ: crypto.randomBytes(16).toString('base64url') });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'weak-key');
});

test('攻撃: ホストの約束と違う値を、あとから出されたら、J は中止する', async () => {
  const { host } = newHost();
  const base = makePost(host);
  const evil = async (path, body) => {
    const res = await base(path, body);
    if (path === '/pair/reveal') res.body.nH = crypto.randomBytes(16).toString('base64url'); // 数字が合うよう、あとから乱数を選ぼうとする
    return res;
  };
  await assert.rejects(
    P.runJoin({ post: evil, pairId: host.id, deviceName: 'Win', onSas: async () => true }),
    (e) => e.reason === 'commit-mismatch'
  );
});

test('攻撃: 中間者が、両側と別々に鍵交換すると、2 台の 6 桁が食い違い、キーは渡らない', async () => {
  const seen = { hostSas: null, jSas: null };
  let jSasKnown;
  const jSasPromise = new Promise((resolve) => (jSasKnown = resolve));
  // 本物のホストの人は、本物の J の画面の数字と、自分の画面の数字を見比べる
  const realHost = new P.PairingHost({
    secretToken: SECRET,
    deviceName: 'Mac',
    onChange: (s) => s.phase === 'sas' && s.accepted === null && jSasPromise.then((j) => realHost.decide(s.sas === j)),
  });
  // 中間者は、本物の J に対しては「ホストのふり」をし、本物のホストに対しては「J のふり」をする
  const fakeHost = new P.PairingHost({
    secretToken: 'x'.repeat(64),
    deviceName: 'Evil',
    onChange: (s) => s.phase === 'sas' && s.accepted === null && setImmediate(() => fakeHost.decide(true)),
  });
  const attackerToHost = P.runJoin({
    post: makePost(realHost),
    pairId: realHost.id,
    deviceName: 'Win',
    onSas: async (sas) => ((seen.hostSas = sas), true),
  }).catch((e) => e);
  const realJ = await P.runJoin({
    post: makePost(fakeHost),
    pairId: fakeHost.id,
    deviceName: 'Win',
    onSas: async (sas) => {
      seen.jSas = sas;
      jSasKnown(sas);
      return true;
    },
  }).catch((e) => e);
  const attackerResult = await attackerToHost;
  assert.notEqual(seen.hostSas, seen.jSas, '2 台の画面の数字が、食い違う (人が気づける)');
  // 本物のホストの人は、食い違う数字を見て「違う」を押すので、本物の同期キーは、どこにも渡らない
  assert.ok(attackerResult instanceof P.PairError && attackerResult.reason === 'rejected');
  assert.ok(!JSON.stringify(attackerResult).includes(SECRET));
  assert.notEqual(realJ.secretToken, SECRET);
  assert.equal(realHost.failures, 1);
});

test('6 桁の表示と、形式', () => {
  assert.equal(P.formatSas('483291'), '483 291');
  const t = P.transcriptOf(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(16, 3), Buffer.alloc(16, 4));
  assert.match(P.sasOf(t), /^\d{6}$/);
  assert.equal(P.sasOf(t), P.sasOf(Buffer.from(t)), '同じ入力なら、同じ数字');
  const t2 = P.transcriptOf(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(16, 3), Buffer.alloc(16, 5));
  assert.notEqual(P.sasOf(t), P.sasOf(t2), '入力が変わると、数字が変わる (100 万分の 1 を除いて)');
});

test('同期キーが短すぎる / 型が違う応答は、J が受け付けない', async () => {
  const { host } = newHost({ secretToken: 'short', onChange: (s) => s.phase === 'sas' && s.accepted === null && setImmediate(() => host.decide(true)) });
  await assert.rejects(
    P.runJoin({ post: makePost(host), pairId: host.id, deviceName: 'Win', onSas: async () => true }),
    (e) => e.reason === 'format'
  );
});

test('J が数字を見る前にやめたら、失敗とは数えず、ホストの待ち受けを、すぐ空ける', async () => {
  const { host } = newHost();
  await assert.rejects(
    P.runJoin({
      post: makePost(host),
      pairId: host.id,
      deviceName: 'Win',
      onSas: async () => {
        throw new P.PairError('cancelled'); // 画面を閉じた
      },
    }),
    (e) => e.reason === 'cancelled'
  );
  assert.equal(host.session, null);
  assert.equal(host.failures, 0);
  assert.equal(host.closedReason, null);
});

test('dropSession: 通信が切れた接続だけを終える (別の接続は、巻き込まない)', async () => {
  const { host } = newHost();
  const started = await host.handle('/pair/start', { id: host.id, jPub: P.generateKeyPair().publicRaw.toString('base64url'), name: 'J' });
  host.dropSession('another');
  assert.ok(host.session, '別の sid では、終わらない');
  host.dropSession(started.body.sid);
  assert.equal(host.session, null);
  assert.equal(host.failures, 0);
});
