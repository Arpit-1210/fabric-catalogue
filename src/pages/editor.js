import { store, createDesign, updateDesign } from '../lib/data.js';
import { prepareImage, uploadPrepared, signedUrls } from '../lib/images.js';
import { esc, $, toast, errMsg } from '../lib/ui.js';

export async function renderEditor(root, id) {
  const d = id ? store.designs.find((x) => x.id === id) : null;
  if (id && !d) { root.innerHTML = '<div class="card">Design not found. <a href="#/">Back</a></div>'; return; }
  const cats = store.categories.filter((c) => c.active);
  let prepared = null; let existing = '';
  if (d?.thumb_path || d?.image_path) { try { const p = d.thumb_path || d.image_path; existing = (await signedUrls([p]))[p] || ''; } catch { /* no preview */ } }
  root.innerHTML = `
    <a href="${d ? '#/design/' + d.id : '#/'}" class="small">← Back</a>
    <h1 style="font-size:22px;margin:8px 0 12px">${d ? `Edit ${esc(d.code)}` : 'Add a new design'}</h1>
    <form class="card" id="ef" autocomplete="off">
      ${d ? `<div class="field"><label>Print code</label><input value="${esc(d.code)}" disabled /></div>` : `<div class="field"><label>Category *</label><select id="e-cat">${cats.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.prefix)}-…)</option>`).join('')}</select><div class="small mute">The print code is issued automatically when you save.</div></div>`}
      <div class="field"><label>Design name *</label><input id="e-name" value="${esc(d?.name || '')}" placeholder="e.g. Rose Garden" /></div>
      <div class="field"><label>Colours</label><input id="e-col" value="${esc(d?.colours || '')}" placeholder="e.g. pink, red, green" /></div>
      <div class="field"><label>Fabric width</label><input id="e-w" value="${esc(d?.fabric_width || '')}" placeholder='e.g. 58"  or 150 cm' /></div>
      <div class="field"><label>Notes / description</label><textarea id="e-no">${esc(d?.notes || '')}</textarea></div>
      <div class="field"><label>Main photo ${d?.image_path ? '(choose to replace)' : ''}</label><div class="drop"><div id="pv">${existing ? `<img alt="" src="${existing}">` : ''}</div><input id="e-im" type="file" accept="image/*" /><div class="small mute" style="margin-top:6px">Take a photo or pick one from your library.</div></div></div>
      <div class="err" id="ee"></div>
      <div class="row-btns"><a class="btn" href="${d ? '#/design/' + d.id : '#/'}">Cancel</a><button class="btn primary" id="sv" type="submit">${d ? 'Save changes' : 'Create design'}</button></div>
    </form>`;
  $('#e-im', root).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { prepared = await prepareImage(f); $('#pv', root).innerHTML = `<img alt="" src="${URL.createObjectURL(prepared.thumb)}">`; $('#ee', root).textContent = ''; }
    catch (er) { prepared = null; $('#ee', root).textContent = er.message; e.target.value = ''; }
  };
  $('#ef', root).onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $('#e-name', root).value.trim();
    if (!name) { $('#ee', root).textContent = 'Design name is required.'; return; }
    const b = $('#sv', root); b.disabled = true; b.textContent = 'Saving…'; $('#ee', root).textContent = '';
    try {
      const fields = { name, colours: $('#e-col', root).value.trim(), fabric_width: $('#e-w', root).value.trim(), notes: $('#e-no', root).value.trim() };
      if (prepared) Object.assign(fields, await uploadPrepared(prepared, 'designs'));
      let out;
      if (d) out = await updateDesign(d.id, fields);
      else out = await createDesign({ ...fields, category_id: $('#e-cat', root).value });
      toast(d ? 'Saved' : `Created ${out.code}`, 'success');
      location.hash = `#/design/${out.id}`;
    } catch (e) { b.disabled = false; b.textContent = d ? 'Save changes' : 'Create design'; $('#ee', root).textContent = errMsg(e); }
  };
}
