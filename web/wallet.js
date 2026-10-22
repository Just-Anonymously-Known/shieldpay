'use strict';
const $ = (id) => document.getElementById(id);
const DAY = 86400000;
const dateOf = (epoch) => new Date(epoch * DAY).toISOString().slice(0, 10);
let info = null, used = new Set();
try { used = new Set(JSON.parse(localStorage.getItem('sp_used_v1') || '[]')); } catch (_) {}
const saveUsed = () => { try { localStorage.setItem('sp_used_v1', JSON.stringify([...used])); } catch (_) {} };
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function statusOf(v) {
  if (used.has(v.token)) return { label: 'used', cls: '', ok: false };
  if (!info) return { label: 'unknown', cls: '', ok: true };
  if (info.epoch > v.epoch + info.validDays) return { label: 'expired', cls: '', ok: false };
  if (info.epoch < v.epoch + info.cooldownDays) return { label: 'from ' + dateOf(v.epoch + info.cooldownDays), cls: 'pending', ok: false };
  return { label: 'usable now', cls: 'paid', ok: true };
}

function render() {
  const list = SPStore.list().slice().sort((a, b) => a.epoch - b.epoch);
  const ul = $('list'); ul.replaceChildren();
  $('empty').classList.toggle('hidden', list.length > 0);
  list.forEach((v, i) => {
    const st = statusOf(v);
    const li = el('li');
    const top = el('div', 'o-top'); top.append(el('span', '', `Voucher ${i + 1}`), el('span', 'badge ' + st.cls, st.label));
    li.append(top, el('div', 'o-sub', 'Bought on ' + dateOf(v.epoch) + ' (UTC)'));
    const act = el('div', 'o-actions');
    const showBtn = el('button', st.ok ? 'primary' : '', 'Show code'); showBtn.onclick = () => showToken(v.token);
    const usedBtn = el('button', '', used.has(v.token) ? 'Undo used' : 'Mark used');
    usedBtn.onclick = () => { used.has(v.token) ? used.delete(v.token) : used.add(v.token); saveUsed(); render(); };
    act.append(showBtn, usedBtn); li.append(act); ul.append(li);
  });
}

function showToken(token) {
  $('qr').innerHTML = QR.toSvg(token);   // rendered locally; the code never leaves this device
  $('tokenText').value = token;
  $('shown').classList.remove('hidden'); window.scrollTo(0, 0);
}
$('hide').onclick = () => { $('shown').classList.add('hidden'); $('tokenText').value = ''; $('qr').innerHTML = ''; };
$('copyTok').onclick = async () => { try { await navigator.clipboard.writeText($('tokenText').value); $('copyTok').textContent = 'Copied'; } catch (_) { $('tokenText').select(); } setTimeout(() => { $('copyTok').textContent = 'Copy code'; }, 1500); };

$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ v: 1, vouchers: SPStore.list(), used: [...used] })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'shieldpay-vouchers-backup.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('backupMsg').textContent = 'Backup saved. Keep it private: anyone with it can spend your vouchers.';
};
$('import').onclick = () => {
  try {
    const d = JSON.parse($('importBox').value);
    const good = (d.vouchers || []).filter((v) => typeof v.token === 'string' && /^SPV1\./.test(v.token) && Number.isInteger(v.epoch));
    SPStore.add(good); (d.used || []).forEach((t) => used.add(t)); saveUsed();
    $('importBox').value = ''; $('backupMsg').textContent = `Restored ${good.length} voucher(s).`; render();
  } catch (_) { $('backupMsg').textContent = 'That does not look like a backup file.'; }
};

(async () => {
  render();
  try {
    info = await (await fetch('/api/vouchers/info')).json();
    $('merchant').textContent = info.merchant;
    $('anon').textContent = `Today ${info.purchasesToday} purchase(s) were made, so vouchers bought today are hidden among that many. Vouchers become usable ${info.cooldownDays} day(s) after purchase. Today's shop key fingerprint: ${info.fingerprint}. Every customer should see the same one; if yours differs from a friend's, do not buy here.`;
    render();
  } catch (_) {}
})();
