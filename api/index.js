'use strict';
// Vercel entry point. vercel.json rewrites every path to /api/index?__p=<path>.
const { createHandler } = require('../server');

let handler = null;
module.exports = (req, res) => {
  try { handler = handler || createHandler(); }
  catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('ShieldPay is not configured: ' + e.message);   // names missing settings only, never secrets
  }
  return handler(req, res);
};
