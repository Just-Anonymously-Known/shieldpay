'use strict';
const $ = (id) => document.getElementById(id);
let key = '', mode = 'pay', vinfo = null, camStream = null;
try { key = sessionStorage.getItem('sp_key') || ''; } catch (_) {}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.message || 'Request failed'), { status: res.status, data });
  return data;
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function link(text, href, cls) { const a = el('a', cls, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }

async function loadOrders() {
  const { orders } = await api('/api/orders');
  const ul = $('orders');
  ul.replaceChildren();
  $('empty').classList.toggle('hidden', orders.length > 0);
  for (const o of orders) {
    const li = el('li');
    const top = el('div', 'o-top');
    top.append(el('span', '', `${o.amount} ZEC`), el('span', 'badge ' + o.status, o.status));
    const kind = o.kind === 'vouchers' ? `${o.quantity} voucher(s)` : 'payment';
    li.append(top, el('div', 'o-sub', `${o.ref} · ${kind}${o.kind === 'payment' && o.label ? ' · ' + o.label : ''} · ${new Date(o.createdAt).toLocaleString()}`));
    const act = el('div', 'o-actions');
    if (o.status === 'pending') {
      const paid = el('button', 'primary', 'Mark paid');
      paid.onclick = async () => { await api(`/api/orders/${o.id}/paid`, { method: 'POST' }); loadOrders(); };
      const cancel = el('button', '', 'Cancel');
      cancel.onclick = async () => { await api(`/api/orders/${o.id}/cancel`, { method: 'POST' }); loadOrders(); };
      act.append(link('Show QR', o.payUrl, 'btn'), paid, cancel);
    } else {
      act.append(link('View', o.payUrl, 'btn'));
    }
    li.append(act);
    ul.append(li);
  }
}

async function unlock() {
  $('loginErr').textContent = '';
  try {
    await loadOrders();
    try { sessionStorage.setItem('sp_key', key); } catch (_) {}
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    vinfo = await (await fetch('/api/vouchers/info')).json();
    $('vname').textContent = vinfo.name + '(s)';
    updateTotal();
  } catch (e) {
    $('loginErr').textContent = e.status === 401 ? 'Wrong key' : e.message;
  }
}

function setMode(m) {
  mode = m;
  $('tabPay').classList.toggle('on', m === 'pay'); $('tabVou').classList.toggle('on', m === 'vou');
  $('payForm').classList.toggle('hidden', m !== 'pay'); $('vouForm').classList.toggle('hidden', m !== 'vou');
}
function updateTotal() {
  if (!vinfo) return;
  const q = Number($('qty').value);
  $('vtotal').textContent = Number.isInteger(q) && q > 0 ? `Total: ${(Number(vinfo.price) * q).toFixed(8).replace(/\.?0+$/, '')} ZEC (${vinfo.price} each)` : '';
}

$('tabPay').onclick = () => setMode('pay'); $('tabVou').onclick = () => setMode('vou');
$('qty').oninput = updateTotal;
$('loginBtn').onclick = () => { key = $('key').value; unlock(); };
$('key').onkeydown = (e) => { if (e.key === 'Enter') $('loginBtn').click(); };
$('refresh').onclick = () => loadOrders().catch(() => {});
$('create').onclick = async () => {
  $('createErr').textContent = '';
  try {
    const body = mode === 'pay' ? { amount: $('amount').value, label: $('label').value } : { kind: 'vouchers', quantity: Number($('qty').value) };
    const o = await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    $('amount').value = ''; $('label').value = '';
    window.open(o.payUrl, '_blank', 'noopener,noreferrer');
    loadOrders();
  } catch (e) { $('createErr').textContent = e.message; }
};

// ---- redeem ----
async function redeem() {
  const msg = $('redeemMsg'); msg.className = 'msg'; msg.textContent = '';
  const token = $('token').value.trim();
  if (!token) return;
  try {
    const r = await api('/api/vouchers/redeem', { method: 'POST', body: JSON.stringify({ token }) });
    msg.className = 'msg good';
    msg.textContent = `✓ ${r.message}. Hidden among ${r.anonymitySet} purchase(s) that day.` + (r.warning ? ` ⚠ ${r.warning}` : '');
    $('token').value = '';
  } catch (e) { msg.className = 'msg bad'; msg.textContent = '✕ ' + (e.data && e.data.message ? e.data.message : e.message); }
}
$('redeem').onclick = redeem;

if ('BarcodeDetector' in window && navigator.mediaDevices) {
  $('scan').classList.remove('hidden');
  $('scan').onclick = async () => {
    const cam = $('cam');
    if (camStream) { stopCam(); return; }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      cam.srcObject = camStream; cam.classList.remove('hidden'); await cam.play();
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!camStream) return;
        try {
          const codes = await det.detect(cam);
          const hit = codes.find((c) => c.rawValue && c.rawValue.startsWith('SPV1.'));
          if (hit) { $('token').value = hit.rawValue; stopCam(); redeem(); return; }
        } catch (_) {}
        setTimeout(loop, 300);
      };
      loop();
    } catch (_) { $('redeemMsg').className = 'msg bad'; $('redeemMsg').textContent = 'Camera unavailable; paste the code instead.'; }
  };
}
function stopCam() { if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; $('cam').classList.add('hidden'); }

if (key) unlock();
