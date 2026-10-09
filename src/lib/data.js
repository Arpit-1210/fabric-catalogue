import { supabase } from './supabase.js';

export const store = { me: null, categories: [], units: [], designs: [], shades: [], byDesign: new Map(), loaded: false };

async function fetchAll(table, order = 'created_at') {
  const rows = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase.from(table).select('*').order(order, { ascending: true }).order('id').range(from, from + size - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < size) break;
  }
  return rows;
}

export async function loadMe() {
  const { data, error } = await supabase.rpc('fp_whoami');
  if (error) throw error;
  store.me = data;       // null when this login is not allowed in this app
  return data;
}

export async function loadAll() {
  const [c, u, d, s] = await Promise.all([
    supabase.from('fp_categories').select('*').order('name'),
    supabase.from('fp_units').select('name').order('name'),
    fetchAll('fp_designs'), fetchAll('fp_shades'),
  ]);
  if (c.error) throw c.error; if (u.error) throw u.error;
  store.categories = c.data; store.units = u.data.map((x) => x.name);
  store.designs = d; store.shades = s;
  reindex(); store.loaded = true;
}

const norm = (s) => String(s || '').toLowerCase();
const catName = (id) => store.categories.find((c) => c.id === id)?.name || '';

export function reindex() {
  store.byDesign = new Map();
  for (const s of store.shades) { if (!store.byDesign.has(s.design_id)) store.byDesign.set(s.design_id, []); store.byDesign.get(s.design_id).push(s); }
  for (const d of store.designs) {
    const sh = store.byDesign.get(d.id) || [];
    d._cat = catName(d.category_id);
    d._blob = norm([d.code, d.code.replace(/-/g, ''), d.name, d.colours, d.notes, d.fabric_width, d._cat,
      ...sh.flatMap((x) => [x.shade_code, x.colour, x.notes])].join(' | '));
  }
}

export const shadesOf = (designId, { archived = false } = {}) =>
  (store.byDesign.get(designId) || []).filter((s) => archived || !s.archived).sort((a, b) => a.shade_code.localeCompare(b.shade_code, undefined, { numeric: true }));

/** Stock totals per unit for one design, active shades only. */
export function stockTotals(designId) {
  const t = new Map();
  for (const s of shadesOf(designId)) t.set(s.unit, (t.get(s.unit) || 0) + Number(s.stock));
  return t;
}
export function stockText(designId) {
  const t = stockTotals(designId);
  if (!t.size) return 'No shades yet';
  return [...t].map(([u, q]) => `${q.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${u}`).join(' + ');
}
/** 'out' | 'low' | 'ok' | 'none' */
export function stockState(designId) {
  const sh = shadesOf(designId);
  if (!sh.length) return 'none';
  if (sh.every((s) => Number(s.stock) <= 0)) return 'out';
  if (sh.some((s) => Number(s.stock) <= Number(s.min_stock))) return 'low';
  return 'ok';
}
export const shadeState = (s) => (Number(s.stock) <= 0 ? 'out' : Number(s.stock) <= Number(s.min_stock) ? 'low' : 'ok');

// "rp1", "RP 12", "rp-012" all find RP-012
function codeMatch(token, code) {
  const m = token.match(/^([a-z]+)[\s-]*0*(\d+)$/); if (!m) return false;
  const c = code.toLowerCase().match(/^([a-z]+)-0*(\d+)$/); if (!c) return false;
  return m[1] === c[1] && m[2] === c[2];
}

export function searchDesigns({ q = '', category = '', stock = '', archived = false, sort = 'newest' } = {}) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  let list = store.designs.filter((d) => d.archived === archived);
  if (category) list = list.filter((d) => d.category_id === category);
  if (stock) list = list.filter((d) => { const s = stockState(d.id); return stock === 'low' ? s === 'low' || s === 'out' : s === stock; });
  if (tokens.length) list = list.filter((d) => tokens.every((t) => d._blob.includes(t) || codeMatch(t, d.code)));
  const total = (d) => [...stockTotals(d.id).values()].reduce((a, b) => a + b, 0);
  const sorts = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    oldest: (a, b) => a.created_at.localeCompare(b.created_at),
    code: (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }),
    name: (a, b) => a.name.localeCompare(b.name),
    stock_high: (a, b) => total(b) - total(a),
    stock_low: (a, b) => total(a) - total(b),
  };
  return list.sort(sorts[sort] || sorts.newest);
}

// ── changes ──
export async function createDesign(fields) {
  const { data, error } = await supabase.rpc('fp_create_design', { p: fields });
  if (error) throw error;
  store.designs.push(data); reindex(); return data;
}
export async function updateDesign(id, patch) {
  const { data, error } = await supabase.from('fp_designs').update(patch).eq('id', id).select().single();
  if (error) throw error;
  Object.assign(store.designs.find((d) => d.id === id), data); reindex(); return data;
}
export async function addShade(fields) {
  const { data, error } = await supabase.from('fp_shades').insert(fields).select().single();
  if (error) throw error;
  store.shades.push(data); reindex(); return data;
}
export async function updateShade(id, patch) {
  const { data, error } = await supabase.from('fp_shades').update(patch).eq('id', id).select().single();
  if (error) throw error;
  Object.assign(store.shades.find((s) => s.id === id), data); reindex(); return data;
}
export async function stockApply(shadeId, mode, qty, note = '') {
  const { data, error } = await supabase.rpc('fp_stock_apply', { p_shade: shadeId, p_mode: mode, p_qty: qty, p_note: note });
  if (error) throw error;
  Object.assign(store.shades.find((s) => s.id === shadeId), data); reindex(); return data;
}
export async function addUnit(name) {
  const n = String(name).trim().toLowerCase(); if (!n) throw new Error('Enter a unit name');
  if (!store.units.includes(n)) {
    const { error } = await supabase.from('fp_units').insert({ name: n }); if (error) throw error;
    store.units.push(n); store.units.sort();
  }
  return n;
}
export async function loadMoves(shadeId) {
  const { data, error } = await supabase.from('fp_stock_moves').select('*').eq('shade_id', shadeId).order('created_at', { ascending: false }).limit(100);
  if (error) throw error; return data;
}
