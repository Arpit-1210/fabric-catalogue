import './styles.css';
import { supabase, HAS_KEYS } from './lib/supabase.js';
import { requireAccess, logout } from './lib/auth.js';
import { store, loadAll } from './lib/data.js';
import { esc, toast, errMsg } from './lib/ui.js';
import { renderCatalogue } from './pages/catalogue.js';
import { renderDesign } from './pages/design.js';
import { renderEditor } from './pages/editor.js';
import { renderExport } from './pages/exportPage.js';
import { renderStock } from './pages/stockImport.js';
import { renderAdmin } from './pages/admin.js';

const routes = [
  { re: /^$/, nav: 'home', fn: renderCatalogue },
  { re: /^design\/([\w-]+)$/, nav: 'home', fn: renderDesign },
  { re: /^new$/, nav: 'new', fn: (r) => renderEditor(r, null) },
  { re: /^edit\/([\w-]+)$/, nav: 'home', fn: renderEditor },
  { re: /^stock$/, nav: 'stock', fn: renderStock },
  { re: /^export$/, nav: 'export', fn: renderExport },
  { re: /^admin$/, nav: 'admin', fn: renderAdmin },
];

function shell() {
  const me = store.me;
  document.getElementById('app').innerHTML = `
    <header class="top"><div class="brand">🧵 Fabric Prints</div><div class="who">${esc(me.name || me.email)}${me.role === 'admin' ? ' · admin' : ''}</div><button id="lo">Logout</button></header>
    <main id="view"></main>
    <nav class="nav">
      <a href="#/" data-n="home"><span class="i">🔍</span>Search</a>
      <a href="#/new" data-n="new"><span class="i">➕</span>Add</a>
      <a href="#/stock" data-n="stock"><span class="i">📦</span>Stock</a>
      <a href="#/export" data-n="export"><span class="i">📤</span>Export</a>
      ${me.role === 'admin' ? '<a href="#/admin" data-n="admin"><span class="i">⚙️</span>Admin</a>' : ''}
    </nav>`;
  document.getElementById('lo').onclick = logout;
}

let seq = 0;
async function route() {
  const view = document.getElementById('view'); if (!view) return;
  const path = location.hash.replace(/^#\/?/, '');
  const my = ++seq;
  for (const r of routes) {
    const m = path.match(r.re); if (!m) continue;
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.n === r.nav));
    if (r.nav === 'admin' && store.me.role !== 'admin') { location.hash = '#/'; return; }
    window.scrollTo(0, 0);
    view.innerHTML = '<div class="boot">Loading…</div>';
    try { await r.fn(view, m[1]); }
    catch (e) { if (my === seq) view.innerHTML = `<div class="card"><b>Something went wrong</b><p class="mute">${esc(errMsg(e))}</p><a class="btn" href="#/">Back to catalogue</a></div>`; }
    return;
  }
  location.hash = '#/';
}

(async function init() {
  try {
    await requireAccess();
    document.getElementById('app').innerHTML = '<div class="boot">Loading catalogue…</div>';
    await loadAll();
    shell();
    window.addEventListener('hashchange', route);
    supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.reload(); });
    route();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="login"><div class="box"><h1>Could not start</h1><p class="mute">${esc(errMsg(e))}</p><p class="small mute">${HAS_KEYS ? 'Has the database setup been run?' : 'The site is missing its database keys.'}</p><button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;
  }
})();
