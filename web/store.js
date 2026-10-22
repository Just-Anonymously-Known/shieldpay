'use strict';
// Voucher wallet storage. Lives only in this browser; nothing here is ever sent to the server
// until the customer chooses to redeem a voucher.
window.SPStore = (function () {
  const KEY = 'sp_wallet_v1';
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } }
  function write(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (_) { return false; } }
  return {
    list() { return read(KEY) || []; },
    add(tokens) {          // tokens: [{ token, epoch }]
      const have = new Set(this.list().map((t) => t.token));
      const merged = this.list().concat(tokens.filter((t) => !have.has(t.token)));
      return write(KEY, merged);
    },
    replace(list) { return write(KEY, list); },
    getPending(id) { return read('sp_pending_' + id); },
    setPending(id, v) { return write('sp_pending_' + id, v); },
    markDone(id) { write('sp_done_' + id, 1); },
    isDone(id) { return read('sp_done_' + id) === 1; },
    clearPending(id) { try { localStorage.removeItem('sp_pending_' + id); } catch (_) {} },
  };
})();
