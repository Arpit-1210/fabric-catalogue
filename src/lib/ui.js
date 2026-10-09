export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const fmtDate = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

let toastTimer;
export function toast(msg, type = '') {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.className = `toast show ${type}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = 'toast'), type === 'error' ? 5000 : 2600);
}

/** Friendly message for any error thrown by the database / storage. */
export function errMsg(e) {
  const m = String(e?.message || e || 'Something went wrong');
  if (/row-level security|permission denied|not allowed/i.test(m)) return 'You do not have permission to do that.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No internet connection. Please try again.';
  if (/duplicate key|already exists/i.test(m) && /shade/i.test(m)) return 'This design already has a shade with that code.';
  if (/duplicate key/i.test(m)) return 'That already exists.';
  if (/JWT|expired/i.test(m)) return 'Your session expired. Please log in again.';
  return m.replace(/^.*?ERROR:\s*/, '');
}

/** Modal dialog. `body` is HTML; returns { el, close }. */
export function modal(title, body, { wide = false } = {}) {
  const ov = document.createElement('div'); ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-h"><b>${esc(title)}</b><button class="x" data-close aria-label="Close">✕</button></div><div class="modal-b">${body}</div></div>`;
  document.body.appendChild(ov); document.body.classList.add('noscroll');
  const close = () => { ov.remove(); if (!$('.modal-ov')) document.body.classList.remove('noscroll'); };
  ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  return { el: ov, close };
}

export function confirmBox(message, okText = 'Yes') {
  return new Promise((resolve) => {
    const m = modal('Please confirm', `<p style="margin:0 0 16px">${esc(message)}</p><div class="row-btns"><button class="btn" data-close id="c-no">Cancel</button><button class="btn primary" id="c-yes">${esc(okText)}</button></div>`);
    $('#c-yes', m.el).onclick = () => { m.close(); resolve(true); };
    m.el.addEventListener('click', (e) => { if (e.target === m.el || e.target.closest('#c-no') || e.target.closest('.x')) resolve(false); });
  });
}

export function download(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export const stamp = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
