'use strict';
// ZIP-321 payment request builder (https://zips.z.cash/zip-0321).
// Builds zcash:<address>?amount=<zec>&memo=<base64url>&message=<text> URIs.

const MAX_MEMO_BYTES = 512;
const ZAT_PER_ZEC = 100000000n;
const MAX_ZEC = 21000000n;

// Basic shape check only. Real validation happens in the customer's wallet.
// Unified addresses start with "u1", Sapling "zs1", transparent "t1"/"t3".
// ShieldPay refuses transparent addresses: they would leak who paid whom.
function checkShieldedAddress(addr) {
  if (typeof addr !== 'string') return 'Address is required';
  const a = addr.trim();
  if (/^(t1|t3|tm)/.test(a)) return 'Transparent addresses are not allowed; use a shielded or unified address';
  if (!/^(u1|zs1|utest1|ztestsapling1)[a-z0-9]{20,}$/.test(a)) return 'Not a valid shielded/unified Zcash address';
  return null;
}

// "1.5" -> 150000000n. Returns null if invalid. Up to 8 decimals, > 0.
function parseZec(input) {
  const s = String(input).trim();
  if (!/^\d{1,8}(\.\d{1,8})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const zat = BigInt(whole) * ZAT_PER_ZEC + BigInt(frac.padEnd(8, '0'));
  if (zat <= 0n || zat > MAX_ZEC * ZAT_PER_ZEC) return null;
  return zat;
}

function formatZec(zat) {
  const whole = zat / ZAT_PER_ZEC;
  const frac = (zat % ZAT_PER_ZEC).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Percent-encode everything except unreserved characters (RFC 3986).
function pct(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildUri({ address, zat, memo, message }) {
  const params = [`amount=${formatZec(zat)}`];
  if (memo) {
    const bytes = Buffer.from(memo, 'utf8');
    if (bytes.length > MAX_MEMO_BYTES) throw new Error('Memo too long');
    params.push(`memo=${base64url(bytes)}`);
  }
  if (message) params.push(`message=${pct(message)}`);
  return `zcash:${address.trim()}?${params.join('&')}`;
}

module.exports = { checkShieldedAddress, parseZec, formatZec, buildUri, base64url, MAX_MEMO_BYTES };
