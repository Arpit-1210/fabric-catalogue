import readXlsxFile from 'read-excel-file';
import writeXlsxFile from 'write-excel-file';
import { supabase } from '../lib/supabase.js';
import { store, shadesOf, loadAll } from '../lib/data.js';
import { esc, $, fmtNum, toast, errMsg, download, stamp, confirmBox } from '../lib/ui.js';

let parsed = [];   // preview rows
let lastFile = null;

export function renderStock(root) {
  parsed = []; lastFile = null;
  root.innerHTML = `
    <h1 style="font-size:22px;margin-bottom:6px">Stock by Excel</h1>
    <p class="mute" style="margin-top:0">Update many shades at once. For one shade, open its design and use the + / − buttons.</p>
    <div class="card"><h2 style="font-size:16px;margin-bottom:8px">1 · Get the template</h2>
      <p class="small mute" style="margin-top:0">Contains every active shade with its current stock. Fill the <b>New Stock</b> column (and change the Unit if needed), leave other rows blank.</p>
      <button class="btn" id="tpl">⬇️ Download Excel template</button></div>
    <div class="card"><h2 style="font-size:16px;margin-bottom:8px">2 · Upload your filled sheet</h2>
      <div class="field"><label>How should the numbers be used?</label><select id="mode" class="sel"><option value="set">Set stock to this number (recount)</option><option value="add">Add to current stock (use − to reduce)</option></select></div>
      <input type="file" id="xf" accept=".xlsx" />
      <div class="small mute" style="margin-top:6px">Needs columns: <b>Print Code</b>, <b>Shade Code</b> and <b>New Stock</b> (or Quantity). <b>Unit</b> is optional.</div></div>
    <div id="pv"></div>`;
  $('#tpl', root).onclick = template;
  $('#xf', root).onchange = (e) => { lastFile = e.target.files[0]; preview(root, lastFile); };
  $('#mode', root).onchange = () => { if (lastFile) preview(root, lastFile); };
}

async function template() {
  const head = ['Print Code', 'Shade Code', 'Design Name', 'Colour', 'Unit', 'Current Stock', 'New Stock'];
  const rows = [];
  for (const d of [...store.designs].filter((x) => !x.archived).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))) {
    for (const s of shadesOf(d.id)) rows.push([d.code, s.shade_code, d.name, s.colour, s.unit, Number(s.stock), null]);
  }
  const data = [head.map((v) => ({ value: v, fontWeight: 'bold', backgroundColor: '#e9e6f7' })),
    ...rows.map((r) => r.map((v, i) => (v === null ? null : i === 5 ? { value: v, type: Number } : { value: String(v ?? '') || undefined, type: String })))];
  try {
    const blob = await writeXlsxFile(data, { sheet: 'Stock', stickyRowsCount: 1, columns: [12, 12, 26, 18, 10, 14, 14].map((width) => ({ width })) });
    download(blob, `stock-template-${stamp()}.xlsx`);
    if (!rows.length) toast('No shades yet — the template is empty', 'error');
  } catch (e) { toast(errMsg(e), 'error'); }
}

const clean = (s) => String(s ?? '').trim();
const key = (c, s) => `${clean(c).toUpperCase()}|${clean(s).toLowerCase()}`;

async function preview(root, file) {
  const box = $('#pv', root); if (!file) return;
  box.innerHTML = '<div class="boot">Reading file…</div>';
  let rows;
  try { rows = await readXlsxFile(file); } catch (err) { console.error('Excel read failed', err); box.innerHTML = '<div class="card err">This file could not be read. Please upload an .xlsx Excel file.</div>'; return; }
  if (rows.length < 2) { box.innerHTML = '<div class="card err">The sheet has no data rows.</div>'; return; }
  const head = rows[0].map((h) => clean(h).toLowerCase());
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const ci = col('print code', 'code'), si = col('shade code', 'shade'), qi = col('new stock', 'quantity', 'qty', 'stock'), ui = col('unit');
  if (ci < 0 || si < 0 || qi < 0) { box.innerHTML = '<div class="card err">Could not find the columns “Print Code”, “Shade Code” and “New Stock” in the first row.</div>'; return; }
  const idx = new Map();
  for (const d of store.designs) for (const s of shadesOf(d.id, { archived: true })) idx.set(key(d.code, s.shade_code), { d, s });
  const mode = $('#mode', root).value; const seen = new Set();
  parsed = [];
  rows.slice(1).forEach((r, n) => {
    const raw = r[qi]; if (raw === null || raw === undefined || clean(raw) === '') return;      // blank = skip
    const code = clean(r[ci]), shade = clean(r[si]); if (!code && !shade) return;
    const qty = Number(String(raw).replace(/,/g, '')); const unit = ui >= 0 ? clean(r[ui]).toLowerCase() : '';
    const hit = idx.get(key(code, shade)); const k = key(code, shade);
    let status = 'ok', msg = '';
    if (!hit) { status = 'bad'; msg = 'Print code / shade not found'; }
    else if (Number.isNaN(qty)) { status = 'bad'; msg = 'Not a number'; }
    else if (mode === 'set' && qty < 0) { status = 'bad'; msg = 'Stock cannot be negative'; }
    else if (seen.has(k)) { status = 'bad'; msg = 'Listed twice'; }
    else if (mode === 'add' && Number(hit.s.stock) + qty < 0) { status = 'bad'; msg = 'Would go below zero'; }
    seen.add(k);
    const after = hit && !Number.isNaN(qty) ? (mode === 'set' ? qty : Number(hit.s.stock) + qty) : null;
    parsed.push({ line: n + 2, code, shade, qty, unit, hit, status, msg, after });
  });
  draw(root, mode);
}

function draw(root, mode) {
  const box = $('#pv', root); const ok = parsed.filter((p) => p.status === 'ok'); const bad = parsed.length - ok.length;
  if (!parsed.length) { box.innerHTML = '<div class="card">No rows with a “New Stock” value were found.</div>'; return; }
  box.innerHTML = `<div class="card"><h2 style="font-size:16px;margin-bottom:8px">3 · Check, then apply</h2>
    <div class="count" style="margin-top:0"><b style="color:var(--ok)">${ok.length}</b> ready${bad ? ` · <b style="color:var(--out)">${bad}</b> will be skipped` : ''}</div>
    <div class="tw" style="max-height:340px;overflow:auto"><table><thead><tr><th>Row</th><th>Print</th><th>Shade</th><th class="n">Now</th><th class="n">After</th><th>Unit</th><th></th></tr></thead><tbody>${parsed.map((p) => `<tr style="${p.status === 'bad' ? 'background:rgba(192,57,43,.08)' : ''}"><td>${p.line}</td><td>${esc(p.code)}</td><td>${esc(p.shade)}</td><td class="n">${p.hit ? fmtNum(p.hit.s.stock) : '—'}</td><td class="n"><b>${p.after === null ? '—' : fmtNum(p.after)}</b></td><td>${esc(p.unit || p.hit?.s.unit || '')}</td><td>${p.status === 'ok' ? '✅' : `<span class="err">${esc(p.msg)}</span>`}</td></tr>`).join('')}</tbody></table></div>
    <div class="err" id="ie" style="margin-top:8px"></div>
    <button class="btn primary" id="apply" style="margin-top:10px;width:100%" ${ok.length ? '' : 'disabled'}>Apply ${ok.length} update${ok.length === 1 ? '' : 's'}</button></div>`;
  $('#apply', root).onclick = async () => {
    if (bad && !(await confirmBox(`${bad} row${bad > 1 ? 's' : ''} will be skipped. Apply the ${ok.length} good ones?`, 'Apply'))) return;
    const b = $('#apply', root); b.disabled = true; b.textContent = 'Applying…';
    try {
      const items = ok.map((p) => ({ shade_id: p.hit.s.id, qty: p.qty, unit: p.unit || null }));
      const { error } = await supabase.rpc('fp_stock_bulk', { p_items: items, p_mode: mode, p_note: 'Excel import ' + stamp() });
      if (error) throw error;
      await loadAll(); parsed = [];
      $('#pv', root).innerHTML = `<div class="card" style="text-align:center"><div style="font-size:34px">✅</div><b>${ok.length} stock update${ok.length === 1 ? '' : 's'} applied</b><p><a class="btn" href="#/">Back to catalogue</a></p></div>`;
      toast('Stock updated', 'success');
    } catch (e) { b.disabled = false; b.textContent = `Apply ${ok.length} updates`; $('#ie', root).textContent = errMsg(e) + ' Nothing was changed.'; }
  };
}
