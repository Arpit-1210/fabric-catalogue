import { store, shadesOf, stockText, stockState, shadeState, updateDesign, addShade, updateShade, stockApply, addUnit, loadMoves } from '../lib/data.js';
import { signedUrls, prepareImage, uploadPrepared } from '../lib/images.js';
import { esc, $, $$, fmtNum, fmtDate, toast, errMsg, modal, confirmBox } from '../lib/ui.js';

async function lightbox(path) {
  try {
    const u = (await signedUrls([path]))[path];
    const el = document.createElement('div'); el.className = 'lightbox'; el.innerHTML = `<img alt="" src="${u}"/><button aria-label="Close">✕</button>`;
    el.onclick = () => el.remove(); document.body.appendChild(el);
  } catch (e) { toast(errMsg(e), 'error'); }
}

export async function renderDesign(root, id) {
  const d = store.designs.find((x) => x.id === id);
  if (!d) { root.innerHTML = '<div class="card">This design was not found. <a href="#/">Back</a></div>'; return; }
  let showArchived = false;
  const canSee = (s) => showArchived || !s.archived;

  async function draw() {
    const shades = shadesOf(id, { archived: showArchived }).filter(canSee);
    const archivedCount = (store.byDesign.get(id) || []).filter((s) => s.archived).length;
    const paths = [d.image_path, ...shades.flatMap((s) => [s.thumb_path || s.image_path])].filter(Boolean);
    let urls = {}; try { urls = await signedUrls(paths); } catch { /* shown without photos */ }
    const bg = (p) => (p && urls[p] ? `style="background-image:url('${urls[p]}')"` : '');
    root.innerHTML = `
      <a href="#/" class="small">← Catalogue</a>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin:8px 0 10px">
        <div><div class="mute small">${esc(d._cat)}</div><h1 style="font-size:26px;color:var(--brand)">${esc(d.code)}</h1><div style="font-weight:700;font-size:17px">${esc(d.name)}</div></div>
        <div style="text-align:right">${d.archived ? '<span class="chip low">Archived</span>' : ''}<div class="stk" style="justify-content:flex-end;margin-top:6px"><span class="dot ${stockState(id)}"></span>${esc(stockText(id))}</div></div>
      </div>
      ${d.image_path ? `<div class="hero" id="hero" ${d.image_path && urls[d.image_path] ? `style="background-image:url('${urls[d.image_path]}')"` : ''}></div>` : '<div class="card mute" style="text-align:center">No main photo yet</div>'}
      <div class="card" style="margin-top:12px"><dl class="kv">
        <dt>Colours</dt><dd>${esc(d.colours) || '—'}</dd><dt>Fabric width</dt><dd>${esc(d.fabric_width) || '—'}</dd><dt>Notes</dt><dd>${esc(d.notes) || '—'}</dd>
        <dt>Added</dt><dd>${fmtDate(d.created_at)}${d.created_by ? ' · ' + esc(d.created_by) : ''}</dd><dt>Updated</dt><dd>${fmtDate(d.updated_at)}${d.updated_by ? ' · ' + esc(d.updated_by) : ''}</dd></dl>
        <div class="row-btns" style="margin-top:12px"><a class="btn" href="#/edit/${id}">✏️ Edit design</a><button class="btn ${d.archived ? '' : 'danger'}" id="arch">${d.archived ? '♻️ Restore' : '🗄 Archive'}</button></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px"><h2 style="font-size:18px">Shades (${shades.length})</h2><button class="btn primary sm" id="addshade">➕ Add shade</button></div>
      ${shades.map((s) => `<div class="card shade" data-s="${s.id}">
        <div class="ph" ${bg(s.thumb_path || s.image_path)} data-zoom="${esc(s.image_path || '')}"></div>
        <div class="body"><div style="display:flex;justify-content:space-between;gap:8px"><span class="sc">${esc(s.shade_code)}${s.archived ? ' <span class="chip low">archived</span>' : ''}</span><span class="chip ${shadeState(s)}">${shadeState(s) === 'out' ? 'Out' : shadeState(s) === 'low' ? 'Low' : 'In stock'}</span></div>
          <div class="mute small">${esc(s.colour)}${s.notes ? ' · ' + esc(s.notes) : ''}</div>
          <div class="qty">${fmtNum(s.stock)} <span style="font-size:14px;font-weight:600">${esc(s.unit)}</span></div>
          <div class="acts"><button class="btn sm" data-act="in">＋ Received</button><button class="btn sm" data-act="out">－ Sold</button><button class="btn sm" data-act="set">Set</button><button class="btn sm" data-act="hist">History</button><button class="btn sm" data-act="edit">Edit</button><button class="btn sm" data-act="arch">${s.archived ? 'Restore' : 'Archive'}</button></div></div></div>`).join('') || '<div class="card mute" style="text-align:center">No shades yet. Add the first shade to track stock.</div>'}
      ${archivedCount ? `<button class="btn sm" id="togarch">${showArchived ? 'Hide' : 'Show'} ${archivedCount} archived shade${archivedCount > 1 ? 's' : ''}</button>` : ''}`;

    const hero = $('#hero', root); if (hero && d.image_path) hero.onclick = () => lightbox(d.image_path);
    $$('[data-zoom]', root).forEach((el) => { if (el.dataset.zoom) el.onclick = () => lightbox(el.dataset.zoom); });
    $('#arch', root).onclick = async () => {
      if (!d.archived && !(await confirmBox(`Archive ${d.code}? It will be hidden from the catalogue but nothing is deleted. You can restore it any time.`, 'Archive'))) return;
      try { await updateDesign(id, { archived: !d.archived }); toast(d.archived ? 'Archived' : 'Restored', 'success'); draw(); } catch (e) { toast(errMsg(e), 'error'); }
    };
    $('#addshade', root).onclick = () => shadeForm(null, draw, id);
    const tg = $('#togarch', root); if (tg) tg.onclick = () => { showArchived = !showArchived; draw(); };
    $$('[data-s]', root).forEach((card) => {
      const s = store.shades.find((x) => x.id === card.dataset.s);
      $$('[data-act]', card).forEach((b) => b.onclick = async () => {
        const a = b.dataset.act;
        if (a === 'edit') return shadeForm(s, draw);
        if (a === 'hist') return history(s);
        if (a === 'arch') {
          if (!s.archived && !(await confirmBox(`Archive shade ${s.shade_code}?`, 'Archive'))) return;
          try { await updateShade(s.id, { archived: !s.archived }); draw(); } catch (e) { toast(errMsg(e), 'error'); }
          return;
        }
        stockForm(s, a, draw);
      });
    });
  }
  await draw();
}

function stockForm(s, mode, done) {
  const t = { in: 'Stock received', out: 'Stock sold / used', set: 'Set exact stock' }[mode];
  const m = modal(`${t} — ${s.shade_code}`, `
    <p class="mute" style="margin-top:0">Now: <b>${fmtNum(s.stock)} ${esc(s.unit)}</b></p>
    <div class="field"><label>${mode === 'set' ? 'New stock' : 'Quantity'} (${esc(s.unit)})</label><input id="sq" type="number" inputmode="decimal" min="0" step="any" autofocus /></div>
    <div class="field"><label>Note (optional)</label><input id="sn" placeholder="e.g. invoice no, customer, recount" /></div>
    <div class="err" id="se"></div><div class="row-btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Save</button></div>`);
  $('#ok', m.el).onclick = async () => {
    const q = parseFloat($('#sq', m.el).value);
    if (!(q >= 0) || Number.isNaN(q) || (mode !== 'set' && q === 0)) { $('#se', m.el).textContent = 'Enter a quantity.'; return; }
    const b = $('#ok', m.el); b.disabled = true;
    try { await stockApply(s.id, mode === 'set' ? 'set' : 'add', mode === 'out' ? -q : q, $('#sn', m.el).value.trim()); m.close(); toast('Stock updated', 'success'); done(); }
    catch (e) { b.disabled = false; $('#se', m.el).textContent = errMsg(e); }
  };
}

async function history(s) {
  const m = modal(`History — ${s.shade_code}`, '<div class="boot">Loading…</div>', { wide: true });
  try {
    const rows = await loadMoves(s.id);
    $('.modal-b', m.el).innerHTML = rows.length ? `<div class="tw"><table><thead><tr><th>When</th><th class="n">Change</th><th class="n">Balance</th><th>By</th><th>Note</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td class="n" style="color:${r.delta >= 0 ? 'var(--ok)' : 'var(--out)'}">${r.delta > 0 ? '+' : ''}${fmtNum(r.delta)}</td><td class="n">${fmtNum(r.balance)}</td><td>${esc(r.by_email || '')}</td><td>${esc(r.note)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mute">No stock movements yet.</p>';
  } catch (e) { $('.modal-b', m.el).innerHTML = `<p class="err">${esc(errMsg(e))}</p>`; }
}

export function shadeForm(s, done, designId = null) {
  const isNew = !s; const did = s?.design_id || designId || location.hash.split('/').pop();
  let prepared = null;
  const unitOpts = (sel) => store.units.map((u) => `<option ${u === sel ? 'selected' : ''}>${esc(u)}</option>`).join('') + '<option value="__new">＋ New unit…</option>';
  const m = modal(isNew ? 'Add shade' : `Edit shade ${s.shade_code}`, `
    <div class="field"><label>Shade code *</label><input id="f-sc" value="${esc(s?.shade_code || '')}" placeholder="e.g. S-04" autocapitalize="characters" /></div>
    <div class="field"><label>Colour name</label><input id="f-co" value="${esc(s?.colour || '')}" placeholder="e.g. Rose pink" /></div>
    <div class="grid2"><div class="field"><label>Unit</label><select id="f-un">${unitOpts(s?.unit || 'meters')}</select></div>
      <div class="field"><label>Low-stock level</label><input id="f-mn" type="number" inputmode="decimal" min="0" step="any" value="${s?.min_stock ?? 0}" /></div></div>
    ${isNew ? '<div class="field"><label>Opening stock</label><input id="f-st" type="number" inputmode="decimal" min="0" step="any" value="0" /></div>' : ''}
    <div class="field"><label>Notes</label><input id="f-no" value="${esc(s?.notes || '')}" /></div>
    <div class="field"><label>Photo ${s?.image_path ? '(choose to replace)' : ''}</label><div class="drop"><div id="pv"></div><input id="f-im" type="file" accept="image/*" /></div></div>
    <div class="err" id="fe"></div><div class="row-btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="ok">Save</button></div>`);
  const E = (id) => $(id, m.el);
  E('#f-un').onchange = async (e) => {
    if (e.target.value !== '__new') return;
    const n = prompt('New unit name (e.g. thaan, bundle)'); 
    try { const u = await addUnit(n || ''); e.target.innerHTML = unitOpts(u); e.target.value = u; } catch (er) { toast(errMsg(er), 'error'); e.target.value = s?.unit || 'meters'; }
  };
  E('#f-im').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { prepared = await prepareImage(f); E('#pv').innerHTML = `<img alt="" src="${URL.createObjectURL(prepared.thumb)}">`; E('#fe').textContent = ''; }
    catch (er) { prepared = null; E('#fe').textContent = er.message; e.target.value = ''; }
  };
  E('#ok').onclick = async () => {
    const code = E('#f-sc').value.trim();
    if (!code) { E('#fe').textContent = 'Shade code is required.'; return; }
    const b = E('#ok'); b.disabled = true; b.textContent = 'Saving…';
    try {
      const fields = { shade_code: code, colour: E('#f-co').value.trim(), notes: E('#f-no').value.trim(), unit: E('#f-un').value, min_stock: Number(E('#f-mn').value) || 0 };
      if (prepared) Object.assign(fields, await uploadPrepared(prepared, `designs/${did}/shades`));
      if (isNew) {
        const row = await addShade({ ...fields, design_id: did });
        const open = Number(E('#f-st').value) || 0;
        if (open > 0) await stockApply(row.id, 'set', open, 'Opening stock');
      } else await updateShade(s.id, fields);
      m.close(); toast('Saved', 'success'); done();
    } catch (e) { b.disabled = false; b.textContent = 'Save'; E('#fe').textContent = errMsg(e); }
  };
}
