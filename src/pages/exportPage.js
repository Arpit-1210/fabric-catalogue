import { store, searchDesigns } from '../lib/data.js';
import { exportXlsx, exportCsv, exportPdf } from '../lib/export.js';
import { currentFilter } from './catalogue.js';
import { esc, $, $$, toast, errMsg } from '../lib/ui.js';

const st = { scope: 'filter', category: '', archived: false, picked: new Set(), pq: '', stock: true };

export function renderExport(root) {
  const f = currentFilter();
  const cats = store.categories;
  root.innerHTML = `
    <h1 style="font-size:22px;margin-bottom:12px">Export</h1>
    <div class="card">
      <div class="field"><label>What to export</label>
        <select id="x-scope" class="sel">
          <option value="filter">Current catalogue search${f.q || f.category ? ' (' + [f.q && '“' + esc(f.q) + '”', f.category && esc(cats.find((c) => c.id === f.category)?.name)].filter(Boolean).join(', ') + ')' : ''}</option>
          <option value="category">A category (or everything)</option>
          <option value="pick">Pick designs one by one</option>
        </select></div>
      <div id="x-cat" class="field" hidden><label>Category</label><select id="x-c" class="sel"><option value="">All categories</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
      <div id="x-pick" hidden>
        <input id="x-pq" class="search" style="font-size:15px;padding:10px 12px;margin-bottom:8px" type="search" placeholder="Search to find designs…" />
        <div class="row-btns" style="margin-bottom:8px"><button class="btn sm" id="x-all">Select all shown</button><button class="btn sm" id="x-none">Clear selection</button></div>
        <div class="pick" id="x-list"></div></div>
      <label style="display:flex;gap:8px;align-items:center;margin:12px 0 4px"><input type="checkbox" id="x-arch" style="width:20px;height:20px" /> Include archived designs</label>
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0 8px"><input type="checkbox" id="x-stock" checked style="width:20px;height:20px" /> Show stock in the PDF</label>
      <div id="x-count" class="count"></div>
    </div>
    <div class="card"><h2 style="font-size:16px;margin-bottom:10px">Download</h2>
      <div class="row-btns" style="margin-bottom:8px"><button class="btn primary" id="b-xlsx">📊 Excel (.xlsx)</button><button class="btn" id="b-csv">📄 CSV</button></div>
      <div class="row-btns"><button class="btn primary" id="b-pdf">🖼 PDF catalogue (6 per page)</button><button class="btn" id="b-pdfd">🖼 PDF detailed (1 per page + shades)</button></div>
      <div id="x-prog" hidden><div class="prog"><i id="x-bar"></i></div><div class="small mute" id="x-msg"></div></div>
      <div class="small mute" style="margin-top:10px">The PDF shows photos, print codes, shade codes and descriptions. Large catalogues take a little while because every photo is fetched.</div>
    </div>`;
  const sel = () => {
    let list;
    if (st.scope === 'filter') list = searchDesigns({ ...f, archived: false });
    else if (st.scope === 'category') list = searchDesigns({ category: st.category, archived: false, sort: 'code' });
    else list = store.designs.filter((d) => st.picked.has(d.id)).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    if (st.archived && st.scope !== 'pick') {
      const extra = searchDesigns({ ...(st.scope === 'filter' ? f : { category: st.category }), archived: true, sort: 'code' });
      list = [...list, ...extra];
    }
    return list;
  };
  const drawPick = () => {
    const q = st.pq.toLowerCase().split(/\s+/).filter(Boolean);
    const list = store.designs.filter((d) => (st.archived || !d.archived) && q.every((t) => d._blob.includes(t))).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).slice(0, 300);
    $('#x-list', root).innerHTML = list.map((d) => `<label><input type="checkbox" data-id="${d.id}" ${st.picked.has(d.id) ? 'checked' : ''}/><span><b>${esc(d.code)}</b> ${esc(d.name)}</span></label>`).join('') || '<div class="pick"><div style="padding:12px" class="mute">No designs found</div></div>';
    $$('#x-list input', root).forEach((c) => c.onchange = () => { c.checked ? st.picked.add(c.dataset.id) : st.picked.delete(c.dataset.id); upd(); });
    return list;
  };
  const upd = () => {
    $('#x-cat', root).hidden = st.scope !== 'category'; $('#x-pick', root).hidden = st.scope !== 'pick';
    const n = sel().length; $('#x-count', root).textContent = `${n} design${n === 1 ? '' : 's'} will be exported`;
    ['b-xlsx', 'b-csv', 'b-pdf', 'b-pdfd'].forEach((i) => ($('#' + i, root).disabled = n === 0));
  };
  $('#x-scope', root).value = st.scope; $('#x-c', root).value = st.category; $('#x-arch', root).checked = st.archived; $('#x-stock', root).checked = st.stock;
  $('#x-scope', root).onchange = (e) => { st.scope = e.target.value; if (st.scope === 'pick') drawPick(); upd(); };
  $('#x-c', root).onchange = (e) => { st.category = e.target.value; upd(); };
  $('#x-arch', root).onchange = (e) => { st.archived = e.target.checked; if (st.scope === 'pick') drawPick(); upd(); };
  $('#x-stock', root).onchange = (e) => { st.stock = e.target.checked; };
  $('#x-pq', root).oninput = (e) => { st.pq = e.target.value; drawPick(); };
  $('#x-all', root).onclick = () => { drawPick().forEach((d) => st.picked.add(d.id)); drawPick(); upd(); };
  $('#x-none', root).onclick = () => { st.picked.clear(); drawPick(); upd(); };
  if (st.scope === 'pick') drawPick();
  upd();

  const run = (label, fn) => async () => {
    const list = sel(); if (!list.length) return;
    $$('button', root).forEach((b) => (b.disabled = true));
    $('#x-prog', root).hidden = false; $('#x-bar', root).style.width = '0'; $('#x-msg', root).textContent = label + '…';
    try { await fn(list); toast('Download ready', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
    finally { $('#x-prog', root).hidden = true; $$('button', root).forEach((b) => (b.disabled = false)); upd(); }
  };
  const prog = (a, b, m) => { $('#x-bar', root).style.width = Math.round((a / Math.max(b, 1)) * 100) + '%'; $('#x-msg', root).textContent = `${m} ${a}/${b}`; };
  $('#b-xlsx', root).onclick = run('Building Excel', (l) => exportXlsx(l));
  $('#b-csv', root).onclick = run('Building CSV', async (l) => exportCsv(l));
  $('#b-pdf', root).onclick = run('Building PDF', (l) => exportPdf(l, { layout: 'grid', withStock: st.stock, onProgress: prog }));
  $('#b-pdfd', root).onclick = run('Building PDF', (l) => exportPdf(l, { layout: 'detail', withStock: st.stock, onProgress: prog }));
}
