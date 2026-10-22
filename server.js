'use strict';
// ShieldPay: private Zcash checkout with unlinkable vouchers. Zero dependencies (Node >= 18).
//
// Privacy rules baked in:
//  - No request logging, no analytics, no cookies, no third-party assets.
//  - Orders hold only: ref, amount, label, status, times. Never payer data.
//  - Shielded/unified addresses only (transparent addresses are rejected).
//  - Viewing keys are never sent to or stored by this server.
//  - Vouchers are blind-signed: the server cannot link a redeemed voucher to the purchase.
//
// Runs two ways: `node server.js` (own computer, data in ./data) or as a Vercel
// function (api/index.js), where data lives in Redis (Upstash).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkShieldedAddress, parseZec, formatZec, buildUri } = require('./lib/zip321');
const { toSvg } = require('./lib/qr');
const { VoucherStore } = require('./lib/vouchers');
const { FileStorage, UpstashStorage, redisFromEnv } = require('./lib/storage');

const WEB_DIR = path.join(__dirname, 'web');
const LIB_DIR = path.join(__dirname, 'lib');
const B64U_BLIND = /^[A-Za-z0-9_-]{342}$/;
const MAX_VOUCHERS_PER_ORDER = 20;
const MAX_DEMO_QTY = 5;
const DEMO_ORDERS_PER_DAY = 300;
const ORDER_TTL_SEC = 14 * 86400;
const HTML = 'text/html; charset=utf-8', JS = 'text/javascript; charset=utf-8';

const STATIC = {
  '/': [WEB_DIR, 'index.html', HTML],
  '/wallet': [WEB_DIR, 'wallet.html', HTML],
  '/app.js': [WEB_DIR, 'app.js', JS],
  '/pay.js': [WEB_DIR, 'pay.js', JS],
  '/wallet.js': [WEB_DIR, 'wallet.js', JS],
  '/store.js': [WEB_DIR, 'store.js', JS],
  '/style.css': [WEB_DIR, 'style.css', 'text/css; charset=utf-8'],
  '/blind.js': [LIB_DIR, 'blind.js', JS],
  '/qr.js': [LIB_DIR, 'qr.js', JS],
};
const DEMO_STATIC = {
  '/demo': [WEB_DIR, 'demo.html', HTML],
  '/demo.js': [WEB_DIR, 'demo.js', JS],
};
const fileCache = new Map();
const readStatic = (dir, file) => {
  const k = path.join(dir, file);
  if (!fileCache.has(k)) fileCache.set(k, fs.readFileSync(k));
  return fileCache.get(k);
};

function createHandler(opts = {}) {
  const env = process.env;
  const cfg = {
    address: String(opts.address ?? env.SHIELDPAY_ADDRESS ?? '').trim(),
    adminToken: String(opts.adminToken ?? env.SHIELDPAY_ADMIN_TOKEN ?? ''),
    keySecret: String(opts.keySecret ?? env.SHIELDPAY_KEY_SECRET ?? opts.adminToken ?? env.SHIELDPAY_ADMIN_TOKEN ?? ''),
    dataDir: opts.dataDir ?? env.SHIELDPAY_DATA_DIR ?? path.join(__dirname, 'data'),
    name: String(opts.name ?? env.SHIELDPAY_NAME ?? 'ShieldPay merchant').slice(0, 60),
    voucherName: String(opts.voucherName ?? env.SHIELDPAY_VOUCHER_NAME ?? 'voucher').slice(0, 30),
    voucherPrice: String(opts.voucherPrice ?? env.SHIELDPAY_VOUCHER_PRICE ?? '0.01'),
    cooldownDays: Number(opts.cooldownDays ?? env.SHIELDPAY_COOLDOWN_DAYS ?? 1),
    validDays: Number(opts.validDays ?? env.SHIELDPAY_VALID_DAYS ?? 30),
    minAnonymity: Number(opts.minAnonymity ?? env.SHIELDPAY_MIN_ANONYMITY ?? 5),
    orderTtlMs: Number(opts.orderTtlMs ?? 60 * 60 * 1000),
    demo: (opts.demo ?? env.SHIELDPAY_DEMO) === true || (opts.demo ?? env.SHIELDPAY_DEMO) === '1',
    now: opts.now ?? Date.now,
  };
  const addrErr = checkShieldedAddress(cfg.address);
  if (addrErr) throw new Error(`SHIELDPAY_ADDRESS: ${addrErr}`);
  if (cfg.adminToken.length < 12) throw new Error('SHIELDPAY_ADMIN_TOKEN must be at least 12 characters');
  const priceZat = parseZec(cfg.voucherPrice);
  if (priceZat === null) throw new Error('SHIELDPAY_VOUCHER_PRICE must be a positive ZEC amount');

  let storage = opts.storage;
  if (!storage) {
    const redis = redisFromEnv(env);
    if (redis) storage = new UpstashStorage(redis);
    else if (env.VERCEL) throw new Error('No Redis database connected (need UPSTASH_REDIS_REST_URL / KV_REST_API_URL and the matching token)');
    else storage = new FileStorage({ file: path.join(cfg.dataDir, 'shieldpay.json'), now: cfg.now });
  }
  const store = new VoucherStore({
    storage, secret: cfg.keySecret, now: cfg.now,
    cooldownDays: cfg.cooldownDays, validDays: cfg.validDays, minAnonymity: cfg.minAnonymity,
  });

  const getOrder = async (id) => { const r = await storage.get(`order:${id}`); return r ? JSON.parse(r) : null; };
  const putOrder = (o) => storage.set(`order:${o.id}`, JSON.stringify(o), { ttlSec: ORDER_TTL_SEC });

  const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newRef = () => 'SP-' + Array.from(crypto.randomBytes(6), (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join('');
  const effectiveStatus = (o) => (o.status === 'pending' && cfg.now() > o.expiresAt ? 'expired' : o.status);

  function send(res, code, body, type = 'application/json; charset=utf-8') {
    res.writeHead(code, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  const json = (res, code, obj) => send(res, code, obj);

  function readBody(req) {
    if (req.body !== undefined && req.body !== null && !req.readable) {   // already parsed by the host (Vercel)
      const b = req.body;
      if (typeof b === 'object' && !Buffer.isBuffer(b)) return Promise.resolve(b);
      try { return Promise.resolve(JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b || '{}'))); } catch (e) { return Promise.reject(e); }
    }
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 32_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  function isAdmin(req) {
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(cfg.adminToken);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }

  const adminView = (o) => ({
    id: o.id, ref: o.ref, kind: o.kind, quantity: o.quantity, amount: formatZec(BigInt(o.amountZat)), label: o.label,
    status: effectiveStatus(o), issued: !!o.issued, createdAt: o.createdAt, expiresAt: o.expiresAt, payUrl: `/pay/${o.id}`,
  });

  async function createOrder({ kind, quantity, zat, label, demo }) {
    const now = cfg.now();
    const o = { id: crypto.randomBytes(16).toString('hex'), ref: newRef(), kind, quantity, amountZat: zat.toString(), label, status: 'pending', createdAt: now, expiresAt: now + cfg.orderTtlMs };
    if (demo) o.demo = true;
    await putOrder(o);
    await storage.zadd('orders', now, o.id);
    return o;
  }

  // The path to route on. On Vercel every request is rewritten to /api/index?__p=<original path>.
  function routePath(req) {
    const u = new URL(req.url, 'http://x');
    if ((u.pathname === '/api/index' || u.pathname === '/api/index.js') && u.searchParams.has('__p')) {
      const p = u.searchParams.get('__p');
      return p.startsWith('/') ? p : '/' + p;
    }
    return u.pathname;
  }

  async function handle(req, res) {
    const p = routePath(req);
    let m;

    if (req.method === 'GET' && STATIC[p]) {
      const [dir, file, type] = STATIC[p];
      return send(res, 200, readStatic(dir, file), type);
    }
    if (req.method === 'GET' && cfg.demo && DEMO_STATIC[p]) {
      const [dir, file, type] = DEMO_STATIC[p];
      return send(res, 200, readStatic(dir, file), type);
    }

    if (req.method === 'GET' && p === '/favicon.ico') { res.writeHead(204); return res.end(); }

    // ---- customer-facing ----
    if (req.method === 'GET' && p.match(/^\/pay\/[a-f0-9]{32}$/)) {
      return send(res, 200, readStatic(WEB_DIR, 'pay.html'), HTML);
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/public\/([a-f0-9]{32})$/))) {
      const o = await getOrder(m[1]);
      if (!o) return json(res, 404, { error: 'Not found' });
      const status = effectiveStatus(o);
      const out = { status, merchant: cfg.name, ref: o.ref, kind: o.kind, quantity: o.quantity, voucherName: cfg.voucherName, amount: formatZec(BigInt(o.amountZat)), label: o.label, expiresAt: o.expiresAt, issued: !!o.issued };
      if (cfg.demo && o.demo) out.demo = true;
      if (status === 'pending') {
        out.uri = buildUri({ address: cfg.address, zat: BigInt(o.amountZat), memo: o.ref, message: o.label ? `${cfg.name}: ${o.label}` : cfg.name });
        out.qrSvg = toSvg(out.uri);
      }
      return json(res, 200, out);
    }
    if (req.method === 'GET' && p === '/api/vouchers/info') {
      return json(res, 200, { ...(await store.info()), name: cfg.voucherName, price: formatZec(priceZat), merchant: cfg.name, demo: cfg.demo });
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/vouchers\/([a-f0-9]{32})\/issue$/))) {
      const id = m[1];
      const o = await getOrder(id);
      if (!o || o.kind !== 'vouchers') return json(res, 404, { error: 'Not found' });
      if (o.status !== 'paid') return json(res, 409, { error: 'Payment not confirmed yet' });
      let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'Bad request' }); }
      const blinded = body.blinded;
      if (!Array.isArray(blinded) || blinded.length !== o.quantity || !blinded.every((b) => typeof b === 'string' && B64U_BLIND.test(b))) {
        return json(res, 400, { error: `Send exactly ${o.quantity} blinded values` });
      }
      const replay = (ord) => {   // idempotent re-fetch if the customer lost the response
        const same = ord.issued.blinded.length === blinded.length && ord.issued.blinded.every((b, i) => b === blinded[i]);
        return same ? json(res, 200, { epoch: ord.issued.epoch, sigs: ord.issued.sigs }) : json(res, 409, { error: 'Vouchers already issued for this order' });
      };
      if (o.issued) return replay(o);
      if (body.epoch !== store.today()) return json(res, 409, { error: 'The day rolled over; please retry', retry: true });
      // Only one request may issue for an order, even if two arrive at the same instant.
      if (!(await storage.setnx(`claim:${id}`, '1', { ttlSec: 120 }))) {
        const again = await getOrder(id);
        if (again && again.issued) return replay(again);
        return json(res, 409, { error: 'Issuing in progress; try again in a moment' });
      }
      let sigs;
      try { sigs = []; for (const b of blinded) sigs.push(await store.blindSign(body.epoch, b)); }
      catch (_) { await storage.del(`claim:${id}`); return json(res, 400, { error: 'Bad blinded value' }); }
      o.issued = { epoch: body.epoch, blinded, sigs };
      await putOrder(o);
      await store.recordIssuance(body.epoch, sigs.length);
      return json(res, 200, { epoch: body.epoch, sigs });
    }

    // ---- public demo mode (off unless SHIELDPAY_DEMO=1): lets anyone try the whole flow ----
    if (cfg.demo && p.startsWith('/api/demo/')) {
      if (req.method === 'POST' && p === '/api/demo/order') {
        let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'Bad request' }); }
        const quantity = Number(body.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_DEMO_QTY) return json(res, 400, { error: `Quantity must be 1 to ${MAX_DEMO_QTY}` });
        if (await storage.incr(`demo:${store.today()}`, 1) > DEMO_ORDERS_PER_DAY) return json(res, 429, { error: 'Demo limit reached for today; try again tomorrow' });
        const o = await createOrder({ kind: 'vouchers', quantity, zat: priceZat * BigInt(quantity), label: `${quantity} × ${cfg.voucherName}`, demo: true });
        return json(res, 201, { id: o.id, ref: o.ref, payUrl: `/pay/${o.id}` });
      }
      if (req.method === 'POST' && (m = p.match(/^\/api\/demo\/paid\/([a-f0-9]{32})$/))) {
        const o = await getOrder(m[1]);
        if (!o || !o.demo) return json(res, 404, { error: 'Not found' });
        if (o.status !== 'pending') return json(res, 409, { error: `Order already ${effectiveStatus(o)}` });
        o.status = 'paid'; await putOrder(o);
        return json(res, 200, { status: 'paid' });
      }
      if (req.method === 'POST' && p === '/api/demo/redeem') {
        let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'Bad request' }); }
        const r = await store.redeem(String(body.token || ''));
        return json(res, r.ok ? 200 : 422, r);
      }
    }

    // ---- merchant (bearer key) ----
    if (p.startsWith('/api/orders') || p === '/api/vouchers/redeem') {
      if (!isAdmin(req)) return json(res, 401, { error: 'Unauthorized' });

      if (req.method === 'POST' && p === '/api/vouchers/redeem') {
        let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'Bad request' }); }
        const r = await store.redeem(String(body.token || ''));
        return json(res, r.ok ? 200 : 422, r);
      }
      if (req.method === 'GET' && p === '/api/orders') {
        const ids = await storage.zrevrange('orders', 100);
        const list = [];
        for (const id of ids) { const o = await getOrder(id); if (o) list.push(adminView(o)); }
        return json(res, 200, { orders: list });
      }
      if (req.method === 'POST' && p === '/api/orders') {
        let body; try { body = await readBody(req); } catch (_) { return json(res, 400, { error: 'Bad request' }); }
        const kind = body.kind === 'vouchers' ? 'vouchers' : 'payment';
        let zat, quantity = 1, label = String(body.label || '').trim().slice(0, 80);
        if (kind === 'vouchers') {
          quantity = Number(body.quantity);
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_VOUCHERS_PER_ORDER) return json(res, 400, { error: `Quantity must be 1 to ${MAX_VOUCHERS_PER_ORDER}` });
          zat = priceZat * BigInt(quantity);
          label = `${quantity} × ${cfg.voucherName}`;
        } else {
          zat = parseZec(body.amount);
          if (zat === null) return json(res, 400, { error: 'Amount must be a positive number of ZEC with up to 8 decimals' });
        }
        const o = await createOrder({ kind, quantity, zat, label });
        return json(res, 201, adminView(o));
      }
      if (req.method === 'POST' && (m = p.match(/^\/api\/orders\/([a-f0-9]{32})\/(paid|cancel)$/))) {
        const o = await getOrder(m[1]);
        if (!o) return json(res, 404, { error: 'Not found' });
        if (o.status !== 'pending') return json(res, 409, { error: `Order already ${o.status}` });
        o.status = m[2] === 'paid' ? 'paid' : 'cancelled';
        await putOrder(o);
        return json(res, 200, adminView(o));
      }
    }
    return json(res, 404, { error: 'Not found' });
  }

  const handler = (req, res) => { handle(req, res).catch(() => { try { json(res, 500, { error: 'Server error' }); } catch (_) { /* response already started */ } }); };
  handler.cfg = cfg;
  return handler;
}

function createServer(opts = {}) { return http.createServer(createHandler(opts)); }

if (require.main === module) {
  try {
    const srv = createServer();
    const port = Number(process.env.PORT) || 3000;
    srv.listen(port, () => console.log(`ShieldPay listening on :${port}`));
    if (Number(process.env.SHIELDPAY_COOLDOWN_DAYS ?? 1) < 1) console.warn('WARNING: cooldown is 0 days; buy-to-redeem timing is linkable. Use only for demos.');
  } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { createServer, createHandler };
