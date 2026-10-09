import { store, searchDesigns, shadesOf, stockText, stockState } from '../lib/data.js';
import { signedUrls } from '../lib/images.js';
import { esc, $, fmtNum } from '../lib/ui.js';

const filt = { q: '', category: '', stock: '', sort: 'newest', archived: false };
const PAGE = 40;
let shown = PAGE;

export function renderCatalogue(root) {
  shown = PAGE;
  root.innerHTML = `
    <div class="searchbar">
      <input id="q" class="search" type="search" placeholder="Search code, colour, shade, category…" value="${esc(filt.q)}" autocomplete="off" autocapitalize="off" enterkeyhint="search" />
      <div class="filters">
        <select id="fc" class="sel"><option value="">All categories</option>${store.categories.map((c) => `<option value="${c.id}" ${c.id === filt.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <select id="fs" class="sel">${[['', 'Any stock'], ['ok', 'In stock'], ['low', 'Low / out'], ['out', 'Out of stock']].map(([v, l]) => `<option value="${v}" ${v === filt.stock ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="fo" class="sel">${[['newest', 'Newest'], ['oldest', 'Oldest'], ['code', 'Code'], ['name', 'Name A–Z'], ['stock_high', 'Most stock'], ['stock_low', 'Least stock']].map(([v, l]) => `<option value="${v}" ${v === filt.sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="fa" class="sel"><option value="0" ${!filt.archived ? 'selected' : ''}>Active</option><option value="1" ${filt.archived ? 'selected' : ''}>Archived</option></select>
      </div>
    </div>
    <div id="count" class="count"></div>
    <div id="res"></div>`;
  const redraw = () => { shown = PAGE; draw(root); };
  $('#q', root).oninput = (e) => { filt.q = e.target.value; redraw(); };
  $('#fc', root).onchange = (e) => { filt.category = e.target.value; redraw(); };
  $('#fs', root).onchange = (e) => { filt.stock = e.target.value; redraw(); };
  $('#fo', root).onchange = (e) => { filt.sort = e.target.value; redraw(); };
  $('#fa', root).onchange = (e) => { filt.archived = e.target.value === '1'; redraw(); };
  draw(root);
}

export const currentFilter = () => ({ ...filt });

async function paint(root, designs) {
  const paths = designs.map((d) => d.thumb_path || d.image_path);
  try {
    const urls = await signedUrls(paths);
    designs.forEach((d) => { const p = d.thumb_path || d.image_path; const el = root.querySelector(`[data-ph="${d.id}"]`); if (el && urls[p]) { el.style.backgroundImage = `url("${urls[p]}")`; el.classList.remove('empty'); } });
  } catch { /* images are optional to the layout */ }
}

function draw(root) {
  const list = searchDesigns(filt);
  $('#count', root).textContent = `${list.length} design${list.length === 1 ? '' : 's'}${filt.q ? ` matching “${filt.q}”` : ''}`;
  const res = $('#res', root);
  if (!list.length) {
    res.innerHTML = `<div class="card" style="text-align:center"><p style="margin:0 0 10px">${store.designs.length ? 'No designs match.' : 'No designs yet.'}</p><a class="btn primary" href="#/new">➕ Add a design</a></div>`;
    return;
  }
  // few matches → show full stock lines straight away (the "type a code, see the stock" case)
  if (list.length <= 3 && filt.q.trim()) {
    res.innerHTML = list.map((d) => {
      const sh = shadesOf(d.id);
      return `<a class="card hit" href="#/design/${d.id}">
        <div class="ph empty" data-ph="${d.id}"></div>
        <div class="info"><div class="big">${esc(d.code)}</div><div style="font-weight:700">${esc(d.name)}</div><div class="mute small">${esc(d._cat)}${d.colours ? ' · ' + esc(d.colours) : ''}</div>
        <div class="stk" style="margin:6px 0"><span class="dot ${stockState(d.id)}"></span>Total: ${esc(stockText(d.id))}</div>
        ${sh.slice(0, 8).map((s) => `<div class="shrow"><span><b>${esc(s.shade_code)}</b> ${esc(s.colour)}</span><b>${fmtNum(s.stock)} ${esc(s.unit)}</b></div>`).join('')}
        ${sh.length > 8 ? `<div class="small mute">+ ${sh.length - 8} more shades</div>` : ''}</div></a>`;
    }).join('');
    paint(root, list);
    return;
  }
  const part = list.slice(0, shown);
  res.innerHTML = `<div class="grid">${part.map((d) => `
    <a class="tile" href="#/design/${d.id}">
      <div class="ph empty" data-ph="${d.id}"><span class="code">${esc(d.code)}</span>${d.archived ? '<span class="arch">Archived</span>' : ''}</div>
      <div class="meta"><div class="nm">${esc(d.name)}</div><div class="stk"><span class="dot ${stockState(d.id)}"></span>${esc(stockText(d.id))}</div></div>
    </a>`).join('')}</div>
    ${list.length > shown ? `<button class="btn more" id="more">Show more (${list.length - shown} left)</button>` : ''}`;
  paint(root, part);
  const more = $('#more', root); if (more) more.onclick = () => { shown += PAGE; draw(root); };
}
