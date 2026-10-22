(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(globalThis.crypto || require('crypto').webcrypto);
  else root.Blind = factory(root.crypto);
})(typeof self !== 'undefined' ? self : this, function (webcrypto) {
  'use strict';
  // Chaum RSA blind signatures with a full-domain hash (RSA-FDH), 2048-bit keys.
  //
  //   customer: m = FDH(secret); blinded = m * r^e mod n          (sent to merchant)
  //   merchant: blindSig = blinded^d mod n                        (never sees m or secret)
  //   customer: sig = blindSig * r^-1 mod n  ==  m^d mod n        (valid signature on m)
  //   anyone:   sig^e mod n == FDH(secret)
  //
  // The merchant signs without learning `secret`, so a later redemption cannot be
  // linked to the issuance. This is the classic construction, not RFC 9474 (which
  // uses PSS padding). It runs in browsers (WebCrypto) and Node 18+.

  const subtle = webcrypto.subtle;
  const enc = new TextEncoder();
  const SECRET_BYTES = 32;
  const KEY_BYTES = 256;
  const TOKEN_RE = /^SPV1\.(\d{1,6})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{342})$/;

  function toB64u(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64u(str) {
    const b = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  function bytesToBig(bytes) {
    let h = '';
    for (const b of bytes) h += b.toString(16).padStart(2, '0');
    return h ? BigInt('0x' + h) : 0n;
  }
  function bigToBytes(x, len) {
    const h = x.toString(16).padStart(len * 2, '0');
    if (h.length > len * 2) throw new Error('number too large');
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  function modPow(base, exp, mod) {
    let result = 1n;
    base %= mod;
    while (exp > 0n) {
      if (exp & 1n) result = (result * base) % mod;
      exp >>= 1n;
      base = (base * base) % mod;
    }
    return result;
  }
  function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
  function modInv(a, m) {
    let [oldR, r] = [a % m, m];
    let [oldS, s] = [1n, 0n];
    while (r) {
      const q = oldR / r;
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
    }
    if (oldR !== 1n) throw new Error('not invertible');
    return ((oldS % m) + m) % m;
  }
  function concat(...arrs) {
    const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  async function sha256(bytes) { return new Uint8Array(await subtle.digest('SHA-256', bytes)); }

  // Full-domain hash into [0, n): expand SHA-256 in counter mode to |n|+128 bits, reduce mod n.
  async function fdh(n, epoch, secret) {
    const msg = concat(enc.encode('ShieldPay-voucher-v1|' + epoch + '|'), secret);
    const need = KEY_BYTES + 16;
    let out = new Uint8Array(0);
    for (let ctr = 0; out.length < need; ctr++) {
      out = concat(out, await sha256(concat(bigToBytes(BigInt(ctr), 4), msg)));
    }
    return bytesToBig(out.slice(0, need)) % n;
  }

  function parseKey(nB64, eB64) { return { n: bytesToBig(fromB64u(nB64)), e: bytesToBig(fromB64u(eB64)) }; }

  function randomBelow(n) {
    for (;;) {
      const v = bytesToBig(webcrypto.getRandomValues(new Uint8Array(KEY_BYTES))) % n;
      if (v > 1n && gcd(v, n) === 1n) return v;
    }
  }

  // Customer side: create `count` secrets and their blinded forms.
  async function prepare({ n: nB64, e: eB64, epoch, count }) {
    const { n, e } = parseKey(nB64, eB64);
    const items = [];
    for (let i = 0; i < count; i++) {
      const secret = webcrypto.getRandomValues(new Uint8Array(SECRET_BYTES));
      const r = randomBelow(n);
      const m = await fdh(n, epoch, secret);
      const blinded = (m * modPow(r, e, n)) % n;
      items.push({ secret: toB64u(secret), r: toB64u(bigToBytes(r, KEY_BYTES)), blinded: toB64u(bigToBytes(blinded, KEY_BYTES)) });
    }
    return items;
  }

  // Customer side: unblind the merchant's answer and check it is a valid signature.
  async function finalize({ n: nB64, e: eB64, epoch, secret, r, blindSig }) {
    const { n, e } = parseKey(nB64, eB64);
    const sig = (bytesToBig(fromB64u(blindSig)) * modInv(bytesToBig(fromB64u(r)), n)) % n;
    const sigB64 = toB64u(bigToBytes(sig, KEY_BYTES));
    if (!(await verify({ n: nB64, e: eB64, epoch, secret, sig: sigB64 }))) throw new Error('Merchant returned an invalid signature');
    return sigB64;
  }

  async function verify({ n: nB64, e: eB64, epoch, secret, sig }) {
    try {
      const { n, e } = parseKey(nB64, eB64);
      const s = bytesToBig(fromB64u(sig));
      if (s <= 0n || s >= n) return false;
      return modPow(s, e, n) === (await fdh(n, epoch, fromB64u(secret)));
    } catch (_) { return false; }
  }

  const encodeToken = (epoch, secret, sig) => `SPV1.${epoch}.${secret}.${sig}`;
  function parseToken(str) {
    const m = TOKEN_RE.exec(String(str).trim());
    return m ? { epoch: Number(m[1]), secret: m[2], sig: m[3] } : null;
  }
  async function secretHash(secretB64) {
    return Array.from(await sha256(fromB64u(secretB64)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  return { prepare, finalize, verify, encodeToken, parseToken, secretHash, toB64u, fromB64u, bytesToBig };
});
