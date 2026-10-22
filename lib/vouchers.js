'use strict';
// Voucher issuer: per-day (epoch) RSA keys, blind signing, redemption with
// double-spend protection, cooldown and expiry, and anonymity-set counting.
//
// What this store knows: day-level counts and a set of spent-secret hashes.
// What it never records: who bought, when (finer than a day), or which blinded
// request produced which token (it cannot know: the tokens are blinded).
//
// Everything goes through an async `storage` (see storage.js). The two operations
// that must never race use atomic "create if absent" (setnx):
//   - creating the day's signing key (two servers must not each make their own)
//   - marking a voucher spent (two simultaneous redemptions: exactly one wins)

const crypto = require('crypto');
const Blind = require('./blind');

const DAY_MS = 86_400_000;

// The signing key is encrypted before it is stored, so a leaked database alone
// cannot be used to forge vouchers. `secret` is SHIELDPAY_KEY_SECRET (or the admin token).
function sealKey(secret, pem) {
  const k = Buffer.from(crypto.hkdfSync('sha256', secret, 'shieldpay-v1', 'signing-key-encryption', 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(pem, 'utf8'), c.final()]);
  return ['enc1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
function openKey(secret, sealed) {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'enc1') throw new Error('Unknown key format');
  const k = Buffer.from(crypto.hkdfSync('sha256', secret, 'shieldpay-v1', 'signing-key-encryption', 32));
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

class VoucherStore {
  constructor({ storage, secret, now = Date.now, cooldownDays = 1, validDays = 30, minAnonymity = 5 }) {
    if (validDays <= cooldownDays) throw new Error('validDays must exceed cooldownDays');
    if (!secret || secret.length < 12) throw new Error('A key secret of at least 12 characters is required');
    this.s = storage; this.secret = secret; this.now = now;
    this.cooldownDays = cooldownDays; this.validDays = validDays; this.minAnonymity = minAnonymity;
    this.ttlSec = (validDays + 3) * 86400;     // keep records a little past the last day a voucher can be used
    this.cache = new Map();                     // epoch -> { pem, n, e }  (this process only)
  }

  today() { return Math.floor(this.now() / DAY_MS); }

  async loadKey(epoch) {
    if (this.cache.has(epoch)) return this.cache.get(epoch);
    const raw = await this.s.get(`key:${epoch}`);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const k = { pem: openKey(this.secret, d.sealed), n: d.n, e: d.e };
    this.cache.set(epoch, k);
    return k;
  }

  async ensureKey(epoch) {
    const have = await this.loadKey(epoch);
    if (have) return have;
    if (epoch !== this.today()) throw new Error('No key for that epoch');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
    const jwk = publicKey.export({ format: 'jwk' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const rec = JSON.stringify({ n: jwk.n, e: jwk.e, sealed: sealKey(this.secret, pem) });
    await this.s.setnx(`key:${epoch}`, rec, { ttlSec: this.ttlSec });   // if another server won the race, use theirs
    return this.loadKey(epoch);
  }

  async info() {
    const epoch = this.today();
    const k = await this.ensureKey(epoch);
    const purchases = parseInt(await this.s.get(`purchases:${epoch}`), 10) || 0;
    return {
      epoch, n: k.n, e: k.e,
      fingerprint: crypto.createHash('sha256').update(Buffer.from(k.n, 'base64url')).digest('hex').slice(0, 16).replace(/(.{4})/g, '$1 ').trim(),
      cooldownDays: this.cooldownDays, validDays: this.validDays,
      firstUsableEpoch: epoch + this.cooldownDays, lastUsableEpoch: epoch + this.validDays,
      purchasesToday: purchases, minAnonymity: this.minAnonymity,
    };
  }

  // Sign a blinded value. The merchant learns nothing about the secret inside it.
  async blindSign(epoch, blindedB64u) {
    const k = await this.ensureKey(epoch);
    const buf = Buffer.from(blindedB64u, 'base64url');
    const n = BigInt('0x' + Buffer.from(k.n, 'base64url').toString('hex'));
    const x = BigInt('0x' + buf.toString('hex'));
    if (buf.length !== 256 || x <= 1n || x >= n) throw new Error('Bad blinded value');
    return crypto.privateDecrypt({ key: k.pem, padding: crypto.constants.RSA_NO_PADDING }, buf).toString('base64url');
  }

  async recordIssuance(epoch, tokenCount) {
    await this.s.incr(`purchases:${epoch}`, 1);
    await this.s.incr(`tokens:${epoch}`, tokenCount);
  }

  async redeem(tokenStr) {
    const t = Blind.parseToken(tokenStr);
    if (!t) return { ok: false, reason: 'invalid', message: 'Not a valid voucher code' };
    const k = await this.loadKey(t.epoch);
    if (!k) return { ok: false, reason: 'invalid', message: 'Unknown or expired voucher' };
    if (!(await Blind.verify({ n: k.n, e: k.e, epoch: t.epoch, secret: t.secret, sig: t.sig }))) {
      return { ok: false, reason: 'invalid', message: 'Signature check failed: not issued by this merchant' };
    }
    const today = this.today();
    const usableFrom = t.epoch + this.cooldownDays;
    if (today < usableFrom) return { ok: false, reason: 'cooldown', message: `Not usable yet; valid from ${dateOf(usableFrom)} (UTC)` };
    if (today > t.epoch + this.validDays) return { ok: false, reason: 'expired', message: 'Voucher expired' };
    const h = await Blind.secretHash(t.secret);
    // Atomic: of any number of simultaneous redemptions of the same voucher, exactly one gets `true`.
    if (!(await this.s.setnx(`spent:${h}`, String(t.epoch), { ttlSec: this.ttlSec }))) {
      return { ok: false, reason: 'spent', message: 'Voucher already used' };
    }
    const set = parseInt(await this.s.get(`purchases:${t.epoch}`), 10) || 0;
    return {
      ok: true, message: 'Voucher accepted', anonymitySet: set,
      warning: set < this.minAnonymity ? `Only ${set} purchase(s) were made that day, so this voucher is weakly anonymous.` : undefined,
    };
  }
}

function dateOf(epoch) { return new Date(epoch * DAY_MS).toISOString().slice(0, 10); }

module.exports = { VoucherStore, DAY_MS, sealKey, openKey };
