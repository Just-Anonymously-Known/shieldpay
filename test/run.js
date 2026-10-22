'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const z = require('../lib/zip321');
const Blind = require('../lib/blind');
const { createServer } = require('../server');

const ADDR = 'u1' + 'q'.repeat(140);
const TOKEN = 'test-token-123456';
const DAY = 86_400_000;
let clock = Date.UTC(2026, 9, 20, 12, 0, 0);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
const mk = (extra = {}) => createServer({ address: ADDR, adminToken: TOKEN, dataDir, now: () => clock, voucherPrice: '0.01', voucherName: 'meal', cooldownDays: 1, validDays: 30, minAnonymity: 5, ...extra });
const auth = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed++; };

// ---- big-number helpers for the unlinkability check ----
const big = (b64) => Blind.bytesToBig(Blind.fromB64u(b64));
const mpow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; e >>= 1n; b = b * b % m; } return r; };
const minv = (a, m) => { let [o, r, os_, s] = [a % m, m, 1n, 0n]; while (r) { const q = o / r; [o, r] = [r, o - q * r]; [os_, s] = [s, os_ - q * s]; } return ((os_ % m) + m) % m; };

async function main() {
  // ---------- ZIP-321 ----------
  eq(z.parseZec('1.5'), 150000000n); eq(z.parseZec('0'), null); eq(z.parseZec('1.123456789'), null);
  eq(z.formatZec(150000000n), '1.5');
  ok(z.checkShieldedAddress('t1abc'), 'transparent rejected');
  eq(z.checkShieldedAddress(ADDR), null);
  eq(z.checkShieldedAddress('utest1' + 'q'.repeat(140)), null, 'testnet unified address accepted');
  ok(z.buildUri({ address: ADDR, zat: 150000000n, memo: 'SP-ABC', message: 'Shop: 2 rice' }).includes('memo=U1AtQUJD'));

  // ---------- config validation ----------
  assert.throws(() => mk({ address: 't1abcdefghijklmnopqrstuvwxyz1234' }), /Transparent/); passed++;
  assert.throws(() => mk({ adminToken: 'short' }), /ADMIN_TOKEN/); passed++;
  assert.throws(() => mk({ voucherPrice: '-1' }), /VOUCHER_PRICE/); passed++;

  // ---------- server ----------
  let srv = mk().listen(0);
  await new Promise((r) => srv.once('listening', r));
  let base = 'http://127.0.0.1:' + srv.address().port;
  const j = async (p, o) => { const r = await fetch(base + p, o); return [r.status, await r.json().catch(() => null), r]; };
  const post = (p, body, headers = auth) => j(p, { method: 'POST', headers, body: JSON.stringify(body || {}) });

  // auth
  eq((await j('/api/orders'))[0], 401);
  eq((await j('/api/orders', { headers: { Authorization: 'Bearer wrong' } }))[0], 401);
  eq((await post('/api/vouchers/redeem', { token: 'x' }, { 'Content-Type': 'application/json' }))[0], 401);

  // plain payment order
  eq((await post('/api/orders', { amount: 'x' }))[0], 400);
  let [s, o] = await post('/api/orders', { amount: '0.25', label: 'test' });
  eq(s, 201); ok(/^SP-[A-Z2-9]{6}$/.test(o.ref));
  let [, pub, resp] = await j('/api/public/' + o.id);
  ok(pub.uri.includes('amount=0.25') && pub.qrSvg.startsWith('<svg'));
  ok(resp.headers.get('content-security-policy').includes("default-src 'none'"));
  eq(resp.headers.get('set-cookie'), null);
  eq((await j('/api/vouchers/' + o.id + '/issue', { method: 'POST', body: '{}' }))[0], 404); // not a voucher order
  eq((await post(`/api/orders/${o.id}/paid`, {}))[0], 200);
  eq((await post(`/api/orders/${o.id}/paid`, {}))[0], 409);

  // ---------- vouchers ----------
  eq((await post('/api/orders', { kind: 'vouchers', quantity: 0 }))[0], 400);
  eq((await post('/api/orders', { kind: 'vouchers', quantity: 21 }))[0], 400);
  [s, o] = await post('/api/orders', { kind: 'vouchers', quantity: 3 });
  eq(s, 201); eq(o.amount, '0.03'); eq(o.label, '3 × meal');
  const info = (await j('/api/vouchers/info'))[1];
  eq(info.epoch, Math.floor(clock / DAY)); eq(info.cooldownDays, 1); eq(info.purchasesToday, 0);
  ok(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/.test(info.fingerprint), 'key fingerprint shown');
  eq((await j('/api/vouchers/info'))[1].fingerprint, info.fingerprint, 'same key for every customer');

  const items = await Blind.prepare({ n: info.n, e: info.e, epoch: info.epoch, count: 3 });
  const blinded = items.map((i) => i.blinded);
  eq((await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch, blinded }, {}))[0], 409, 'issue before payment');
  await post(`/api/orders/${o.id}/paid`, {});
  eq((await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch, blinded: blinded.slice(0, 2) }, {}))[0], 400, 'wrong count');
  eq((await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch, blinded: ['A', 'B', 'C'] }, {}))[0], 400, 'malformed');
  eq((await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch - 1, blinded }, {}))[0], 409, 'epoch mismatch');
  let [is, issued] = await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch, blinded }, {});
  eq(is, 200); eq(issued.sigs.length, 3);
  // idempotent re-fetch, but not for different values
  eq((await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch, blinded }, {}))[1].sigs, issued.sigs);
  const other = (await Blind.prepare({ n: info.n, e: info.e, epoch: info.epoch, count: 3 })).map((i) => i.blinded);
  eq((await post(`/api/vouchers/${o.id}/issue`, { epoch: info.epoch, blinded: other }, {}))[0], 409, 'second issuance refused');
  eq((await j('/api/vouchers/info'))[1].purchasesToday, 1);

  const tokens = [];
  for (let i = 0; i < 3; i++) {
    const sig = await Blind.finalize({ n: info.n, e: info.e, epoch: info.epoch, secret: items[i].secret, r: items[i].r, blindSig: issued.sigs[i] });
    tokens.push(Blind.encodeToken(info.epoch, items[i].secret, sig));
  }
  ok(tokens.every((t) => Blind.parseToken(t)));

  const redeem = (t) => post('/api/vouchers/redeem', { token: t });
  let r = await redeem(tokens[0]);
  eq([r[0], r[1].reason], [422, 'cooldown'], 'same-day redemption blocked by cooldown');
  clock += DAY;                                    // next day
  r = await redeem(tokens[0]);
  eq([r[0], r[1].ok, r[1].anonymitySet], [200, true, 1]);
  ok(r[1].warning && /weakly anonymous/.test(r[1].warning), 'low anonymity warned');
  eq((await redeem(tokens[0]))[1].reason, 'spent', 'double spend');
  eq((await redeem(tokens[1]))[1].ok, true);
  // forgery attempts
  const parts = tokens[2].split('.');
  const flip = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  eq((await redeem([parts[0], parts[1], parts[2], flip].join('.')))[1].reason, 'invalid', 'tampered signature');
  eq((await redeem([parts[0], parts[1] - 0, Blind.toB64u(new Uint8Array(32).fill(7)), parts[3]].join('.')))[1].reason, 'invalid', 'wrong secret');
  eq((await redeem(['SPV1', info.epoch + 1, parts[2], parts[3]].join('.')))[1].reason, 'invalid', 'epoch swap');
  eq((await redeem('garbage'))[1].reason, 'invalid');
  eq((await redeem(tokens[2]))[1].ok, true);

  // ---------- unlinkability: every purchase/redemption pairing is equally consistent ----------
  // The merchant saw (blinded_i, blindSig_i) at purchase and (secret_j, sig_j) at redemption.
  // For ANY pair (i, j) there is a blinding factor r with blinded_i = FDH_j * r^e, so the merchant
  // cannot tell which redemption belongs to which purchase. We verify that for all 9 pairings.
  const n = big(info.n), e = big(info.e);
  let consistent = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) {
    const sigK = big(tokens[k].split('.')[3]);
    const rik = big(issued.sigs[i]) * minv(sigK, n) % n;          // candidate blinding factor
    const mK = mpow(sigK, e, n);                                   // = FDH(secret_k)
    if (mpow(rik, e, n) * mK % n === big(blinded[i])) consistent++;
  }
  eq(consistent, 9, 'all pairings consistent');

  // ---------- expiry ----------
  const ex = (await post('/api/orders', { kind: 'vouchers', quantity: 1 }))[1];
  await post(`/api/orders/${ex.id}/paid`, {});
  const info2 = (await j('/api/vouchers/info'))[1];
  const it2 = await Blind.prepare({ n: info2.n, e: info2.e, epoch: info2.epoch, count: 1 });
  const iss2 = (await post(`/api/vouchers/${ex.id}/issue`, { epoch: info2.epoch, blinded: [it2[0].blinded] }, {}))[1];
  const sig2 = await Blind.finalize({ n: info2.n, e: info2.e, epoch: info2.epoch, secret: it2[0].secret, r: it2[0].r, blindSig: iss2.sigs[0] });
  const tok2 = Blind.encodeToken(info2.epoch, it2[0].secret, sig2);

  // ---------- persistence across restart ----------
  srv.close(); srv = mk().listen(0); await new Promise((r2) => srv.once('listening', r2));
  base = 'http://127.0.0.1:' + srv.address().port;
  eq((await redeem(tokens[0]))[1].reason, 'spent', 'spent set survives restart');
  eq((await j('/api/orders', { headers: auth }))[1].orders.length >= 3, true, 'orders survive restart');
  if (process.platform !== 'win32') eq(fs.statSync(path.join(dataDir, 'shieldpay.json')).mode & 0o077, 0, 'key file is private (0600)');

  clock += 31 * DAY;
  eq((await redeem(tok2))[1].reason, 'expired', 'expired voucher');
  srv.close();

  // ---------- cooldown 0 mode (demo) ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test2-'));
  const srv2 = createServer({ address: ADDR, adminToken: TOKEN, dataDir: dir2, now: () => clock, cooldownDays: 0, validDays: 30 }).listen(0);
  await new Promise((r2) => srv2.once('listening', r2));
  base = 'http://127.0.0.1:' + srv2.address().port;
  const o3 = (await post('/api/orders', { kind: 'vouchers', quantity: 1 }))[1];
  await post(`/api/orders/${o3.id}/paid`, {});
  const info3 = (await j('/api/vouchers/info'))[1];
  const it3 = await Blind.prepare({ n: info3.n, e: info3.e, epoch: info3.epoch, count: 1 });
  const iss3 = (await post(`/api/vouchers/${o3.id}/issue`, { epoch: info3.epoch, blinded: [it3[0].blinded] }, {}))[1];
  const sig3 = await Blind.finalize({ n: info3.n, e: info3.e, epoch: info3.epoch, secret: it3[0].secret, r: it3[0].r, blindSig: iss3.sigs[0] });
  eq((await redeem(Blind.encodeToken(info3.epoch, it3[0].secret, sig3)))[1].ok, true, 'cooldown 0 allows same-day redemption');
  srv2.close();

  console.log(`all ${passed} checks passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
