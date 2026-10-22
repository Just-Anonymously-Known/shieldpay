'use strict';
// Storage backends for ShieldPay. Both expose the same small async API, so the
// rest of the code does not care where data lives:
//
//   get(k)  set(k, v, {ttlSec})  setnx(k, v, {ttlSec}) -> bool   (atomic "create if absent")
//   incr(k, by)  del(k)  zadd(k, score, member)  zrevrange(k, count)
//
// FileStorage  : one JSON file, for running on your own computer (tests, local demo).
// UpstashStorage: Redis over HTTPS (REST), for Vercel and other serverless hosts,
//                 where the disk is read-only or wiped between requests.
//                 Uses plain fetch(): no dependencies.

const fs = require('fs');
const path = require('path');

class FileStorage {
  constructor({ file, now = Date.now }) {
    this.file = file; this.now = now;
    this.kv = new Map();   // key -> { v, exp }
    this.z = new Map();    // key -> [[score, member], ...]
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [k, r] of Object.entries(d.kv || {})) this.kv.set(k, r);
      for (const [k, a] of Object.entries(d.z || {})) this.z.set(k, a);
    } catch (_) { /* first run */ }
  }
  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ kv: Object.fromEntries(this.kv), z: Object.fromEntries(this.z) }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  _live(k) {
    const r = this.kv.get(k);
    if (!r) return null;
    if (r.exp && r.exp <= this.now()) { this.kv.delete(k); return null; }
    return r;
  }
  _exp(ttlSec) { return ttlSec ? this.now() + ttlSec * 1000 : 0; }
  async get(k) { const r = this._live(k); return r ? r.v : null; }
  async set(k, v, { ttlSec } = {}) { this.kv.set(k, { v: String(v), exp: this._exp(ttlSec) }); this._save(); }
  async setnx(k, v, { ttlSec } = {}) {
    if (this._live(k)) return false;
    this.kv.set(k, { v: String(v), exp: this._exp(ttlSec) }); this._save();
    return true;
  }
  async incr(k, by = 1) {
    const r = this._live(k);
    const n = (r ? parseInt(r.v, 10) : 0) + by;
    this.kv.set(k, { v: String(n), exp: r ? r.exp : 0 }); this._save();
    return n;
  }
  async del(k) { this.kv.delete(k); this._save(); }
  async zadd(k, score, member) {
    const a = (this.z.get(k) || []).filter((x) => x[1] !== member);
    a.push([score, member]); a.sort((x, y) => x[0] - y[0]);
    this.z.set(k, a); this._save();
  }
  async zrevrange(k, count) { return (this.z.get(k) || []).slice(-count).reverse().map((x) => x[1]); }
}

class UpstashStorage {
  constructor({ url, token, timeoutMs = 8000 }) {
    this.url = url.replace(/\/+$/, ''); this.token = token; this.timeoutMs = timeoutMs;
  }
  async _cmd(args) {
    const r = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(args.map(String)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error('Storage error: ' + (j.error || r.status));
    return j.result;
  }
  async get(k) { return this._cmd(['GET', k]); }
  async set(k, v, { ttlSec } = {}) { await this._cmd(ttlSec ? ['SET', k, v, 'EX', ttlSec] : ['SET', k, v]); }
  async setnx(k, v, { ttlSec } = {}) {
    const r = await this._cmd(ttlSec ? ['SET', k, v, 'NX', 'EX', ttlSec] : ['SET', k, v, 'NX']);
    return r === 'OK';
  }
  async incr(k, by = 1) { return Number(await this._cmd(['INCRBY', k, by])); }
  async del(k) { await this._cmd(['DEL', k]); }
  async zadd(k, score, member) { await this._cmd(['ZADD', k, score, member]); }
  async zrevrange(k, count) { return (await this._cmd(['ZREVRANGE', k, 0, count - 1])) || []; }
}

// Redis connection details. The Vercel/Upstash integration injects KV_REST_API_URL and
// KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* pair), possibly with a custom prefix
// such as STORAGE_KV_REST_API_URL, so any prefix is accepted.
function redisFromEnv(env) {
  for (const [urlSuffix, tokenSuffix] of [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']]) {
    for (const name of Object.keys(env)) {
      if (!name.endsWith(urlSuffix) || !env[name]) continue;
      const prefix = name.slice(0, name.length - urlSuffix.length);
      const token = env[prefix + tokenSuffix];
      if (token) return { url: env[name], token };
    }
  }
  return null;
}

module.exports = { FileStorage, UpstashStorage, redisFromEnv };
