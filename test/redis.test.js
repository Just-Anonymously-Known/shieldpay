'use strict';
// Runs ShieldPay against a fake Upstash Redis (same code path as Vercel), including
// demo mode and races: simultaneous redemptions and simultaneous issuing.
const assert = require('assert');
const Blind = require('../lib/blind');
const { UpstashStorage } = require('../lib/storage');
const { createHandler } = require('../server');
const { start } = require('./fake-upstash');
const http = require('http');

const ADDR = 'utest1' + 'q'.repeat(140);
const TOKEN = 'test-token-123456';
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); passed++; };

async function main() {
  const fake = await start();
  let clock = Date.UTC(2026, 9, 22, 12, 0, 0);
  const mk = (extra = {}) => createHandler({
    address: ADDR, adminToken: TOKEN, now: () => clock, cooldownDays: 0, validDays: 30,
    storage: new UpstashStorage({ url: fake.url, token: 'test-redis-token' }), ...extra,
  });
  // two "serverless instances" sharing one database
  const srvA = http.createServer(mk({ demo: true })).listen(0), srvB = http.createServer(mk({ demo: true })).listen(0);
  await Promise.all([srvA, srvB].map((s) => new Promise((r) => s.once('listening', r))));
  const A = 'http://127.0.0.1:' + srvA.address().port, B = 'http://127.0.0.1:' + srvB.address().port;
  const j = async (base, p, o) => { const r = await fetch(base + p, o); return [r.status, await r.json().catch(() => null)]; };
  const post = (base, p, body, h = { 'Content-Type': 'application/json' }) => j(base, p, { method: 'POST', headers: h, body: JSON.stringify(body || {}) });

  // demo pages only when demo is on
  eq((await fetch(A + '/demo')).status, 200);
  const off = http.createServer(mk({ demo: false })).listen(0); await new Promise((r) => off.once('listening', r));
  eq((await fetch('http://127.0.0.1:' + off.address().port + '/demo')).status, 404, 'demo page hidden when demo is off');
  eq((await post('http://127.0.0.1:' + off.address().port, '/api/demo/order', { quantity: 1 }))[0], 404, 'demo API hidden when demo is off');
  off.close();

  // both instances agree on the same day key (no split-brain key creation)
  const [infoA, infoB] = await Promise.all([j(A, '/api/vouchers/info'), j(B, '/api/vouchers/info')]);
  eq(infoA[1].n, infoB[1].n, 'one signing key shared by all instances');
  const stored = [...fake.kv.entries()].filter(([k]) => k.startsWith('key:')).map(([, v]) => v).join('');
  ok(stored.length > 0 && !stored.includes('PRIVATE KEY'), 'private key is encrypted in the database');

  // demo flow: order -> simulate pay -> issue (from the OTHER instance) -> redeem
  eq((await post(A, '/api/demo/order', { quantity: 9 }))[0], 400);
  const [s1, ord] = await post(A, '/api/demo/order', { quantity: 2 });
  eq(s1, 201);
  const pub = (await j(B, '/api/public/' + ord.id))[1];
  ok(pub.demo === true && pub.uri.startsWith('zcash:utest1'), 'demo flag and testnet payment link');
  const info = infoA[1];
  const items = await Blind.prepare({ n: info.n, e: info.e, epoch: info.epoch, count: 2 });
  const blinded = items.map((i) => i.blinded);
  eq((await post(B, `/api/vouchers/${ord.id}/issue`, { epoch: info.epoch, blinded }))[0], 409, 'not paid yet');
  eq((await post(B, `/api/demo/paid/${ord.id}`))[0], 200);
  eq((await post(A, `/api/demo/paid/${ord.id}`))[0], 409, 'cannot pay twice');

  // two simultaneous issue requests for one order, with DIFFERENT blinded values: only one may win
  const other = (await Blind.prepare({ n: info.n, e: info.e, epoch: info.epoch, count: 2 })).map((i) => i.blinded);
  const race = await Promise.all([
    post(A, `/api/vouchers/${ord.id}/issue`, { epoch: info.epoch, blinded }),
    post(B, `/api/vouchers/${ord.id}/issue`, { epoch: info.epoch, blinded: other }),
  ]);
  eq(race.filter((r) => r[0] === 200).length, 1, 'exactly one issuance wins the race');
  eq((await j(A, '/api/vouchers/info'))[1].purchasesToday, 1, 'purchase counted once');

  // use a clean order to get real tokens
  const [, o2] = await post(B, '/api/demo/order', { quantity: 1 });
  await post(A, `/api/demo/paid/${o2.id}`);
  const it = await Blind.prepare({ n: info.n, e: info.e, epoch: info.epoch, count: 1 });
  const iss = (await post(A, `/api/vouchers/${o2.id}/issue`, { epoch: info.epoch, blinded: [it[0].blinded] }))[1];
  const sig = await Blind.finalize({ n: info.n, e: info.e, epoch: info.epoch, secret: it[0].secret, r: it[0].r, blindSig: iss.sigs[0] });
  const tok = Blind.encodeToken(info.epoch, it[0].secret, sig);

  // ten simultaneous redemptions of ONE voucher across two instances: exactly one accepted
  const reds = await Promise.all(Array.from({ length: 10 }, (_, i) => post(i % 2 ? A : B, '/api/demo/redeem', { token: tok })));
  eq(reds.filter((r) => r[0] === 200).length, 1, 'double-spend race: exactly one accepted');
  eq(reds.filter((r) => r[1].reason === 'spent').length, 9);

  // admin routes on Redis: list, auth, rewrite path (/api/index?__p=...)
  eq((await j(A, '/api/orders'))[0], 401);
  const list = (await j(A, '/api/orders', { headers: { Authorization: 'Bearer ' + TOKEN } }))[1].orders;
  ok(list.length >= 2 && list[0].createdAt >= list[list.length - 1].createdAt, 'orders list from Redis');
  eq((await j(A, '/api/index?__p=/api/vouchers/info'))[1].epoch, info.epoch, 'Vercel rewrite path is routed');
  const html = await fetch(A + '/api/index?__p=/wallet'); ok((await html.text()).includes('<html'), 'Vercel rewrite serves pages');

  // storage outage does not leak details
  fake.close();
  const down = await j(A, '/api/vouchers/info');
  eq([down[0], down[1].error], [500, 'Server error'], 'storage failure -> generic 500');

  [srvA, srvB].forEach((s) => s.close());
  console.log(`redis path: all ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
