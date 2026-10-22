'use strict';
const $ = (id) => document.getElementById(id);
const post = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });

(async () => {
  try {
    const i = await (await fetch('/api/vouchers/info')).json();
    $('merchant').textContent = i.merchant;
    $('view').textContent = `Today the shop has signed ${i.purchasesToday} purchase(s) with signing key ${i.fingerprint}. At redemption it learns only that a voucher is genuine and which day it was made, never which purchase. (Demo setting: cooldown ${i.cooldownDays} day(s); with 0, same-day spending is allowed for demonstration only.)`;
  } catch (_) { $('view').textContent = 'Could not load.'; }
})();

$('buy').onclick = async () => {
  $('err').textContent = ''; $('buy').disabled = true;
  try {
    const r = await post('/api/demo/order', { quantity: Number($('qty').value) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Could not create the order');
    location.href = d.payUrl;
  } catch (e) { $('err').textContent = e.message; $('buy').disabled = false; }
};

$('redeem').onclick = async () => {
  const token = $('token').value.trim();
  $('result').textContent = 'Checking…';
  try {
    const r = await post('/api/demo/redeem', { token });
    const d = await r.json();
    $('result').textContent = (d.ok ? '✓ ' : '✕ ') + d.message + (d.ok ? ` (hidden among ${d.anonymitySet} purchase(s) that day)` : '') + (d.warning ? ' ' + d.warning : '');
  } catch (_) { $('result').textContent = 'Could not reach the server.'; }
};
