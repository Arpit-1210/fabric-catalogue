import { supabase } from './supabase.js';

const BUCKET = 'fabrics';
const MAX_INPUT = 30 * 1024 * 1024;   // 30 MB original
const OK_TYPES = /^image\/(jpeg|jpg|png|webp|heic|heif|gif|bmp)$/i;

function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => viaImg(file));
  }
  return viaImg(file);
}
function viaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
function toBlob(canvas, quality) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', quality));
}
async function scaled(bmp, maxSide, quality) {
  const w = bmp.width, h = bmp.height, k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return toBlob(c, quality);
}

/** Validates a picked file and makes a large (1600px) and a small (480px) JPEG copy. */
export async function prepareImage(file) {
  if (!file) throw new Error('No file chosen');
  if (file.size > MAX_INPUT) throw new Error('That photo is too large (max 30 MB).');
  if (file.type && !OK_TYPES.test(file.type)) throw new Error('Please choose a photo (JPG, PNG, WebP or HEIC).');
  let bmp;
  try { bmp = await loadBitmap(file); }
  catch { throw new Error('This photo could not be read. If it is a HEIC photo on a computer, convert it to JPG first.'); }
  const [full, thumb] = [await scaled(bmp, 1600, 0.86), await scaled(bmp, 480, 0.8)];
  if (bmp.close) bmp.close();
  return { full, thumb };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/** Uploads both copies and returns the stored paths. Files are never overwritten (always a new name). */
export async function uploadPrepared(prepared, folder) {
  const id = uid();
  const image_path = `${folder}/${id}.jpg`, thumb_path = `${folder}/${id}_t.jpg`;
  const a = await supabase.storage.from(BUCKET).upload(image_path, prepared.full, { contentType: 'image/jpeg', upsert: false });
  if (a.error) throw a.error;
  const b = await supabase.storage.from(BUCKET).upload(thumb_path, prepared.thumb, { contentType: 'image/jpeg', upsert: false });
  if (b.error) throw b.error;
  return { image_path, thumb_path };
}

// ── private images are shown through short-lived signed links ──
const cache = new Map();   // path -> { url, exp }
const TTL = 3600;

export async function signedUrls(paths) {
  const now = Date.now(); const out = {};
  const need = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const c = cache.get(p);
    if (c && c.exp > now + 60000) out[p] = c.url; else need.push(p);
  }
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, TTL);
    if (error) throw error;
    for (const r of data || []) if (r.signedUrl) { cache.set(r.path, { url: r.signedUrl, exp: now + TTL * 1000 }); out[r.path] = r.signedUrl; }
  }
  return out;
}

export async function fetchBlob(path) {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error; return data;
}
