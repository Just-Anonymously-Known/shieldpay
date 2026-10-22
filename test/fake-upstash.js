'use strict';
// A tiny stand-in for Upstash's REST API (POST a JSON command array, get {result}).
// Supports only the commands ShieldPay uses. Lets us test the Redis code path offline.
const http = require('http');

function start() {
  const kv = new Map(), z = new Map();
  const log = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-redis-token') { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
      const a = JSON.parse(Buffer.concat(chunks).toString());
      const [cmd, k, ...rest] = a; log.push(cmd);
      let result = null;
      switch (cmd.toUpperCase()) {
        case 'GET': result = kv.has(k) ? kv.get(k) : null; break;
        case 'SET': {
          const nx = rest.includes('NX');
          if (nx && kv.has(k)) result = null; else { kv.set(k, rest[0]); result = 'OK'; }
          break;
        }
        case 'INCRBY': kv.set(k, String((parseInt(kv.get(k) || '0', 10)) + parseInt(rest[0], 10))); result = parseInt(kv.get(k), 10); break;
        case 'DEL': result = kv.delete(k) ? 1 : 0; break;
        case 'ZADD': { const arr = (z.get(k) || []).filter((x) => x[1] !== rest[1]); arr.push([Number(rest[0]), rest[1]]); arr.sort((x, y) => x[0] - y[0]); z.set(k, arr); result = 1; break; }
        case 'ZREVRANGE': result = (z.get(k) || []).slice().reverse().slice(0, Number(rest[1]) + 1).map((x) => x[1]); break;
        default: res.writeHead(400); return res.end(JSON.stringify({ error: 'unsupported ' + cmd }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
  return new Promise((resolve) => srv.listen(0, () => resolve({ url: 'http://127.0.0.1:' + srv.address().port, kv, z, log, close: () => srv.close() })));
}
module.exports = { start };
