import writeXlsxFile from 'write-excel-file';
import { jsPDF } from 'jspdf';
import { store, shadesOf, stockText } from './data.js';
import { fetchBlob } from './images.js';
import { download, stamp, fmtDate } from './ui.js';

const HEAD = ['Print Code', 'Category', 'Design Name', 'Colours', 'Fabric Width', 'Design Notes', 'Status', 'Shade Code', 'Shade Colour', 'Shade Notes', 'Unit', 'Stock', 'Low-stock Level', 'Added', 'Updated'];

export function toRows(designs, { withArchivedShades = false } = {}) {
  const rows = [];
  for (const d of designs) {
    const base = [d.code, d._cat, d.name, d.colours, d.fabric_width, d.notes, d.archived ? 'Archived' : 'Active'];
    const tail = [fmtDate(d.created_at), fmtDate(d.updated_at)];
    const sh = shadesOf(d.id, { archived: withArchivedShades });
    if (!sh.length) rows.push([...base, '', '', '', '', '', '', ...tail]);
    for (const s of sh) rows.push([...base, s.shade_code, s.colour, s.notes, s.unit, Number(s.stock), Number(s.min_stock), ...tail]);
  }
  return rows;
}

export async function exportXlsx(designs, name = 'fabric-catalogue') {
  const data = [HEAD.map((v) => ({ value: v, fontWeight: 'bold', backgroundColor: '#e9e6f7' })),
    ...toRows(designs).map((r) => r.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: v === '' || v == null ? undefined : String(v), type: String })))];
  const blob = await writeXlsxFile(data, { sheet: 'Catalogue', stickyRowsCount: 1, columns: HEAD.map((h, i) => ({ width: [12, 14, 24, 22, 14, 34, 10, 12, 18, 24, 9, 9, 10, 20, 20][i] })) });
  download(blob, `${name}-${stamp()}.xlsx`);
}

export function exportCsv(designs, name = 'fabric-catalogue') {
  const q = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [HEAD, ...toRows(designs)].map((r) => r.map(q).join(',')).join('\r\n');
  download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${name}-${stamp()}.csv`);
}

// ── PDF ──
const latin = (s) => String(s ?? '').replace(/[^\x20-\x7E -ÿ]/g, '?');
const toDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(new Blob([blob], { type: 'image/jpeg' })); });

async function loadImages(paths, onStep) {
  const out = new Map(); const list = [...new Set(paths.filter(Boolean))]; let i = 0, done = 0;
  const worker = async () => {
    while (i < list.length) {
      const p = list[i++];
      try { out.set(p, await toDataUrl(await fetchBlob(p))); } catch { /* missing photo → placeholder */ }
      onStep?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return out;
}

function put(doc, data, x, y, w, h) {
  try { doc.addImage(data, 'JPEG', x, y, w, h); } catch { /* unreadable photo: leave blank */ }
}
function fit(doc, data, boxW, boxH) {
  const p = doc.getImageProperties(data); const k = Math.min(boxW / p.width, boxH / p.height);
  return { w: p.width * k, h: p.height * k };
}

/** layout: 'grid' (6 per page) or 'detail' (one design per page with shade photos). */
export async function exportPdf(designs, { layout = 'grid', withStock = true, title = 'Fabric Print Catalogue', onProgress } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 10;
  const detail = layout === 'detail';
  const paths = designs.flatMap((d) => [detail ? d.image_path : (d.thumb_path || d.image_path), ...(detail ? shadesOf(d.id).map((s) => s.thumb_path || s.image_path) : [])]);
  onProgress?.(0, 1, 'Loading photos…');
  const imgs = await loadImages(paths, (a, b) => onProgress?.(a, b, 'Loading photos…'));
  const sub = `${designs.length} design${designs.length === 1 ? '' : 's'} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const header = (n) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(42, 47, 107); doc.text(latin(title), M, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text(sub, W - M, 14, { align: 'right' });
    doc.setDrawColor(220); doc.line(M, 17, W - M, 17);
    doc.setFontSize(8); doc.text(`Page ${n}`, W / 2, H - 6, { align: 'center' });
  };
  const wrap = (txt, w, size, max) => { doc.setFontSize(size); const l = doc.splitTextToSize(latin(txt), w); return l.slice(0, max); };

  if (!detail) {
    const cols = 2, rows = 3, gx = 6, gy = 5, top = 22, cw = (W - 2 * M - gx) / cols, ch = (H - top - 14 - gy * (rows - 1)) / rows;
    designs.forEach((d, i) => {
      const per = cols * rows, k = i % per;
      if (k === 0) { if (i > 0) doc.addPage(); header(Math.floor(i / per) + 1); }
      const x = M + (k % cols) * (cw + gx), y = top + Math.floor(k / cols) * (ch + gy);
      doc.setDrawColor(215); doc.setFillColor(252, 251, 248); doc.roundedRect(x, y, cw, ch, 2, 2, 'FD');
      const imgH = ch * 0.62, data = imgs.get(d.thumb_path || d.image_path);
      if (data) { const f = fit(doc, data, cw - 6, imgH - 4); put(doc, data, x + (cw - f.w) / 2, y + 3 + (imgH - 4 - f.h) / 2, f.w, f.h); }
      else { doc.setFontSize(9); doc.setTextColor(150); doc.text('No photo', x + cw / 2, y + imgH / 2, { align: 'center' }); }
      let ty = y + imgH + 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(42, 47, 107); doc.text(latin(d.code), x + 3, ty);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30); doc.text(latin(d.name).slice(0, 38), x + 24, ty);
      doc.setFont('helvetica', 'normal'); ty += 4;
      const meta = [d._cat, d.colours].filter(Boolean).join(' · '); doc.setTextColor(100);
      wrap(meta, cw - 6, 7.5, 1).forEach((l) => { doc.text(l, x + 3, ty); ty += 3.4; });
      const sc = shadesOf(d.id).map((s) => s.shade_code).join(', ');
      if (sc) wrap('Shades: ' + sc, cw - 6, 7.5, 2).forEach((l) => { doc.setTextColor(60); doc.text(l, x + 3, ty); ty += 3.4; });
      if (withStock) { doc.setTextColor(30, 110, 70); doc.setFont('helvetica', 'bold'); wrap('Stock: ' + stockText(d.id), cw - 6, 7.5, 1).forEach((l) => { doc.text(l, x + 3, ty); ty += 3.4; }); doc.setFont('helvetica', 'normal'); }
      if (d.notes) wrap(d.notes, cw - 6, 7, 2).forEach((l) => { doc.setTextColor(120); if (ty < y + ch - 1) doc.text(l, x + 3, ty); ty += 3.1; });
    });
  } else {
    designs.forEach((d, i) => {
      if (i > 0) doc.addPage(); let pg = 1; header(`${i + 1}`);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(42, 47, 107); doc.text(latin(d.code), M, 28);
      doc.setFontSize(13); doc.setTextColor(30); doc.text(latin(d.name), M + 36, 28);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100);
      doc.text(latin([d._cat, d.colours && 'Colours: ' + d.colours, d.fabric_width && 'Width: ' + d.fabric_width].filter(Boolean).join('   ')), M, 34);
      let y = 38; const data = imgs.get(d.image_path);
      if (data) { const f = fit(doc, data, W - 2 * M, 110); put(doc, data, M + (W - 2 * M - f.w) / 2, y, f.w, f.h); y += f.h + 4; } else y += 4;
      if (d.notes) { doc.setTextColor(60); doc.setFontSize(9); const l = wrap(d.notes, W - 2 * M, 9, 4); doc.text(l, M, y + 3); y += l.length * 4 + 3; }
      if (withStock) { doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 110, 70); doc.setFontSize(10); doc.text('Total stock: ' + latin(stockText(d.id)), M, y + 3); y += 7; doc.setFont('helvetica', 'normal'); }
      const sh = shadesOf(d.id);
      if (sh.length) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(42, 47, 107); doc.text('Shades', M, y + 3); y += 6; doc.setFont('helvetica', 'normal'); }
      for (const s of sh) {
        if (y + 24 > H - 12) { doc.addPage(); pg++; header(`${i + 1}.${pg}`); y = 24; }
        const sd = imgs.get(s.thumb_path || s.image_path);
        doc.setDrawColor(225); doc.rect(M, y, 22, 22);
        if (sd) { const f = fit(doc, sd, 21, 21); put(doc, sd, M + (22 - f.w) / 2, y + (22 - f.h) / 2, f.w, f.h); }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(30); doc.text(latin(s.shade_code), M + 26, y + 6);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90); doc.text(latin([s.colour, s.notes].filter(Boolean).join(' · ')).slice(0, 80), M + 26, y + 12);
        if (withStock) { doc.setTextColor(30, 110, 70); doc.text(`${Number(s.stock).toLocaleString('en-IN')} ${latin(s.unit)}`, M + 26, y + 18); }
        y += 25;
      }
    });
  }
  if (!designs.length) { header(1); doc.setFontSize(11); doc.text('No designs selected.', M, 30); }
  doc.save(`${detail ? 'fabric-catalogue-detailed' : 'fabric-catalogue'}-${stamp()}.pdf`);
}
