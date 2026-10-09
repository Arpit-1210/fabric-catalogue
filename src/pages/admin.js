import JSZip from 'jszip';
import { supabase } from '../lib/supabase.js';
import { store, loadAll } from '../lib/data.js';
import { exportXlsx } from '../lib/export.js';
import { fetchBlob } from '../lib/images.js';
import { esc, $, $$, fmtDate, toast, errMsg, modal, confirmBox, download, stamp } from '../lib/ui.js';

let tab = 'staff';
const genPw = () => { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(10); crypto.getRandomValues(a); return [...a].map((n) => c[n % c.length]).join(''); };

export function renderAdmin(root) {
  root.innerHTML = `<h1 style="font-size:22px;margin-bottom:10px">Administration</h1>
    <div class="tabs">${[['staff', 'Staff'], ['cats', 'Categories & codes'], ['units', 'Units'], ['backup', 'Backup'], ['log', 'Activity']].map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tabbody"></div>`;
  $$('.tabs button', root).forEach((b) => b.onclick = () => { tab = b.dataset.t; renderAdmin(root); });
  const body = $('#tabbody', root);
  ({ staff, cats, units, backup, log })[tab](body).catch((e) => { body.innerHTML = `<div class="card err">${esc(errMsg(e))}</div>`; });
}

async function staff(body) {
  const { data, error } = await supabase.from('fp_staff').select('*').order('created_at');
  if (error) throw error;
  body.innerHTML = `<div class="card"><h2 style="font-size:16px;margin-bottom:8px">Add a staff login</h2>
    <div class="grid2"><div class="field"><label>Name</label><input id="s-n" /></div><div class="field"><label>Role</label><select id="s-r"><option value="staff">Staff (add / edit / search)</option><option value="admin">Administrator</option></select></div></div>
    <div class="field"><label>Email (their login)</label><input id="s-e" type="email" inputmode="email" placeholder="name@example.com" /></div>
    <div class="field"><label>Temporary password (min 8)</label><div style="display:flex;gap:8px"><input id="s-p" value="${genPw()}" /><button class="btn sm" id="s-g" type="button">New</button></div></div>
    <div class="err" id="s-err"></div><button class="btn primary" id="s-add" style="width:100%">Create login</button></div>
    ${data.map((p) => `<div class="card" style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><div><b>${esc(p.name || p.email)}</b> <span class="chip ${p.active ? 'ok' : 'out'}">${p.active ? p.role : 'inactive'}</span><div class="small mute">${esc(p.email)}</div></div>
      <div class="row-btns" style="flex:0 0 auto"><button class="btn sm" data-pw="${esc(p.email)}">Reset password</button><button class="btn sm" data-rl="${esc(p.email)}" data-role="${p.role}">Make ${p.role === 'admin' ? 'staff' : 'admin'}</button><button class="btn sm ${p.active ? 'danger' : ''}" data-ac="${esc(p.email)}" data-on="${p.active}">${p.active ? 'Deactivate' : 'Activate'}</button></div></div>`).join('')}`;
  $('#s-g', body).onclick = () => { $('#s-p', body).value = genPw(); };
  $('#s-add', body).onclick = async () => {
    const email = $('#s-e', body).value.trim(), pw = $('#s-p', body).value;
    const b = $('#s-add', body); b.disabled = true; $('#s-err', body).textContent = '';
    const { error: er } = await supabase.rpc('fp_add_staff', { p_email: email, p_name: $('#s-n', body).value.trim(), p_password: pw, p_role: $('#s-r', body).value });
    b.disabled = false;
    if (er) { $('#s-err', body).textContent = errMsg(er); return; }
    modal('Login created', `<p>Send these to the person (use WhatsApp). Ask them to keep it private.</p><div class="card" style="user-select:all"><b>Email:</b> ${esc(email.toLowerCase())}<br><b>Password:</b> ${esc(pw)}<br><b>Website:</b> ${esc(location.origin)}</div><button class="btn primary" data-close style="width:100%">Done</button>`);
    staff(body);
  };
  $$('[data-pw]', body).forEach((b) => b.onclick = async () => {
    const pw = prompt(`New password for ${b.dataset.pw} (min 8 characters)`, genPw()); if (!pw) return;
    const { error: er } = await supabase.rpc('fp_reset_staff_password', { p_email: b.dataset.pw, p_password: pw });
    if (er) return toast(errMsg(er), 'error');
    modal('Password reset', `<div class="card" style="user-select:all"><b>${esc(b.dataset.pw)}</b><br>New password: ${esc(pw)}</div><button class="btn primary" data-close style="width:100%">Done</button>`);
  });
  $$('[data-ac]', body).forEach((b) => b.onclick = async () => {
    const on = b.dataset.on === 'true';
    if (on && !(await confirmBox(`Deactivate ${b.dataset.ac}? They will lose access immediately.`, 'Deactivate'))) return;
    const { error: er } = await supabase.rpc('fp_set_staff', { p_email: b.dataset.ac, p_active: !on }); if (er) return toast(errMsg(er), 'error'); staff(body);
  });
  $$('[data-rl]', body).forEach((b) => b.onclick = async () => {
    const role = b.dataset.role === 'admin' ? 'staff' : 'admin';
    if (!(await confirmBox(`Change ${b.dataset.rl} to ${role}?`, 'Change'))) return;
    const { error: er } = await supabase.rpc('fp_set_staff', { p_email: b.dataset.rl, p_active: true, p_role: role }); if (er) return toast(errMsg(er), 'error'); staff(body);
  });
}

async function cats(body) {
  const draw = () => {
    body.innerHTML = `<div class="card"><h2 style="font-size:16px;margin-bottom:6px">Categories & print-code prefixes</h2><p class="small mute" style="margin-top:0">Codes are numbered in order (RP-001, RP-002…). Changing a prefix only affects <b>new</b> designs; existing codes never change and numbering continues.</p>
      ${store.categories.map((c) => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><b>${esc(c.name)}</b> <span class="chip">${esc(c.prefix)}</span> ${c.active ? '' : '<span class="chip out">inactive</span>'}<div class="small mute">Next: ${esc(c.prefix)}-${String(c.next_number).padStart(3, '0')}</div></div><div class="row-btns" style="flex:0 0 auto"><button class="btn sm" data-ed="${c.id}">Edit</button><button class="btn sm" data-tg="${c.id}">${c.active ? 'Deactivate' : 'Activate'}</button></div></div>`).join('')}
      <div class="grid2" style="margin-top:8px"><div class="field"><label>New category</label><input id="c-n" placeholder="e.g. Block Print" /></div><div class="field"><label>Prefix (letters)</label><input id="c-p" maxlength="6" placeholder="BP" autocapitalize="characters" /></div></div><div class="err" id="c-err"></div><button class="btn primary" id="c-add">Add category</button></div>`;
    $('#c-add', body).onclick = async () => {
      const name = $('#c-n', body).value.trim(), prefix = $('#c-p', body).value.trim().toUpperCase();
      if (!name || !/^[A-Z]{1,6}$/.test(prefix)) { $('#c-err', body).textContent = 'Enter a name and a prefix of 1–6 letters.'; return; }
      const { error } = await supabase.from('fp_categories').insert({ name, prefix });
      if (error) { $('#c-err', body).textContent = /duplicate/.test(error.message) ? 'That name or prefix is already used.' : errMsg(error); return; }
      await loadAll(); draw(); toast('Category added', 'success');
    };
    $$('[data-ed]', body).forEach((b) => b.onclick = async () => {
      const c = store.categories.find((x) => x.id === b.dataset.ed);
      const name = prompt('Category name', c.name); if (!name) return;
      const prefix = (prompt('Prefix (1–6 capital letters). Only new designs use it.', c.prefix) || '').toUpperCase(); if (!/^[A-Z]{1,6}$/.test(prefix)) return toast('Prefix must be 1–6 letters', 'error');
      const { error } = await supabase.from('fp_categories').update({ name: name.trim(), prefix }).eq('id', c.id);
      if (error) return toast(/duplicate/.test(error.message) ? 'That name or prefix is already used.' : errMsg(error), 'error');
      await loadAll(); draw(); toast('Saved', 'success');
    });
    $$('[data-tg]', body).forEach((b) => b.onclick = async () => {
      const c = store.categories.find((x) => x.id === b.dataset.tg);
      const { error } = await supabase.from('fp_categories').update({ active: !c.active }).eq('id', c.id); if (error) return toast(errMsg(error), 'error');
      await loadAll(); draw();
    });
  };
  draw();
}

async function units(body) {
  const draw = () => {
    body.innerHTML = `<div class="card"><h2 style="font-size:16px;margin-bottom:6px">Stock units</h2><p class="small mute" style="margin-top:0">Each shade picks its own unit. Staff can also add a unit while adding a shade.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${store.units.map((u) => `<span class="chip" style="font-size:13px;padding:5px 12px">${esc(u)}</span>`).join('')}</div>
      <div style="display:flex;gap:8px"><input id="u-n" class="search" style="font-size:15px;padding:10px 12px" placeholder="New unit, e.g. thaan" /><button class="btn primary" id="u-add">Add</button></div></div>`;
    $('#u-add', body).onclick = async () => {
      const n = $('#u-n', body).value.trim().toLowerCase(); if (!n) return;
      const { error } = await supabase.from('fp_units').insert({ name: n });
      if (error && !/duplicate/.test(error.message)) return toast(errMsg(error), 'error');
      if (!store.units.includes(n)) { store.units.push(n); store.units.sort(); }
      draw();
    };
  };
  draw();
}

async function fetchAllRows(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').order('created_at').order('id').range(from, from + 999);
    if (error) throw error; rows.push(...data); if (data.length < 1000) break;
  }
  return rows;
}

async function backup(body) {
  body.innerHTML = `<div class="card"><h2 style="font-size:16px;margin-bottom:6px">Backup</h2>
    <p class="small mute" style="margin-top:0">Download a copy regularly (for example every Sunday) and keep it in Google Drive or on your computer. Nothing is ever deleted from the app, but a copy is good protection.</p>
    <div class="row-btns" style="margin-bottom:8px"><button class="btn primary" id="bk-x">📊 Catalogue + stock (Excel)</button><button class="btn" id="bk-j">🗂 Full data (JSON)</button></div>
    <button class="btn" id="bk-z" style="width:100%">🖼 Everything incl. all photos (ZIP)</button>
    <div id="bk-p" hidden><div class="prog"><i id="bk-b"></i></div><div class="small mute" id="bk-m"></div></div></div>`;
  const all = async () => {
    const [designs, shades, moves, audit, staffRows] = await Promise.all(['fp_designs', 'fp_shades', 'fp_stock_moves', 'fp_audit', 'fp_staff'].map((t) => (t === 'fp_audit' ? supabase.from(t).select('*').order('id').limit(100000).then((r) => r.data || []) : fetchAllRows(t))));
    return { exported_at: new Date().toISOString(), categories: store.categories, units: store.units, designs, shades, stock_moves: moves, activity_log: audit, staff: staffRows.map((s) => ({ email: s.email, name: s.name, role: s.role, active: s.active })) };
  };
  const busy = (on, msg = '') => { $$('button', body).forEach((b) => (b.disabled = on)); $('#bk-p', body).hidden = !on; $('#bk-m', body).textContent = msg; };
  $('#bk-x', body).onclick = async () => { busy(true, 'Preparing…'); try { await exportXlsx(store.designs, 'backup-catalogue'); } catch (e) { toast(errMsg(e), 'error'); } busy(false); };
  $('#bk-j', body).onclick = async () => { busy(true, 'Preparing…'); try { download(new Blob([JSON.stringify(await all(), null, 1)], { type: 'application/json' }), `fabric-backup-${stamp()}.json`); } catch (e) { toast(errMsg(e), 'error'); } busy(false); };
  $('#bk-z', body).onclick = async () => {
    busy(true, 'Collecting data…');
    try {
      const data = await all(); const zip = new JSZip(); zip.file('data.json', JSON.stringify(data, null, 1));
      const paths = [...new Set([...data.designs, ...data.shades].flatMap((r) => [r.image_path, r.thumb_path]).filter(Boolean))];
      let n = 0, miss = 0;
      for (let i = 0; i < paths.length; i += 5) {
        await Promise.all(paths.slice(i, i + 5).map(async (p) => { try { zip.file('photos/' + p, await fetchBlob(p)); } catch { miss++; } n++; }));
        $('#bk-b', body).style.width = Math.round((n / paths.length) * 100) + '%'; $('#bk-m', body).textContent = `Photos ${n}/${paths.length}`;
      }
      $('#bk-m', body).textContent = 'Zipping…';
      download(await zip.generateAsync({ type: 'blob', compression: 'STORE' }), `fabric-backup-full-${stamp()}.zip`);
      if (miss) toast(`${miss} photo(s) could not be included`, 'error');
    } catch (e) { toast(errMsg(e), 'error'); }
    busy(false);
  };
}

async function log(body) {
  const { data, error } = await supabase.from('fp_audit').select('*').order('id', { ascending: false }).limit(150);
  if (error) throw error;
  const what = (r) => { const n = r.new_row || {}; return esc(n.code || n.shade_code || n.name || n.email || '') + (r.action === 'UPDATE' && r.old_row ? ' <span class="mute">(' + Object.keys(n).filter((k) => !['updated_at', 'updated_by'].includes(k) && JSON.stringify(n[k]) !== JSON.stringify(r.old_row[k])).join(', ') + ')</span>' : ''); };
  body.innerHTML = `<div class="tw"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Item</th></tr></thead><tbody>${data.map((r) => `<tr><td>${fmtDate(r.at)}</td><td>${esc(r.by_email || '')}</td><td>${esc(r.table_name.replace('fp_', ''))} ${r.action.toLowerCase()}</td><td>${what(r)}</td></tr>`).join('') || '<tr><td colspan="4" class="mute">Nothing yet</td></tr>'}</tbody></table></div><p class="small mute">Latest 150 changes. Stock changes are on each shade's History.</p>`;
}
