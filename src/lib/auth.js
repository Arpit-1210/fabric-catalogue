import { supabase, HAS_KEYS } from './supabase.js';
import { loadMe } from './data.js';
import { esc } from './ui.js';

const app = () => document.getElementById('app');

export function showLogin(message = '') {
  return new Promise((resolve) => {
    app().innerHTML = `
      <div class="login"><form class="box" id="lf" autocomplete="on">
        <h1>🧵 Fabric Print Catalogue</h1>
        <p class="mute" style="margin:0 0 18px">Sign in with the login given to you.</p>
        <div class="field"><label>Email</label><input id="le" type="email" name="username" autocomplete="username" inputmode="email" required /></div>
        <div class="field"><label>Password</label><div class="pw"><input id="lp" type="password" name="password" autocomplete="current-password" required /><button type="button" id="ls">Show</button></div></div>
        <div class="err" id="lerr">${esc(message || (HAS_KEYS ? '' : 'Setup incomplete: the site is missing its database keys.'))}</div>
        <button class="btn primary" id="lg" style="width:100%" type="submit">Sign in</button>
      </form></div>`;
    document.getElementById('ls').onclick = () => { const i = document.getElementById('lp'); const s = i.type === 'password'; i.type = s ? 'text' : 'password'; document.getElementById('ls').textContent = s ? 'Hide' : 'Show'; };
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      const b = document.getElementById('lg'); b.disabled = true; b.textContent = 'Signing in…'; document.getElementById('lerr').textContent = '';
      const { error } = await supabase.auth.signInWithPassword({ email: document.getElementById('le').value.trim(), password: document.getElementById('lp').value });
      if (error) {
        b.disabled = false; b.textContent = 'Sign in';
        document.getElementById('lerr').textContent = /invalid login credentials/i.test(error.message) ? 'Wrong email or password.' : /api key/i.test(error.message) ? 'Setup problem: the site has a wrong database key.' : error.message;
        return;
      }
      resolve();
    };
  });
}

/** Signs in if needed, then checks this person is allowed in this app. Returns { email, name, role }. */
export async function requireAccess() {
  let msg = '';
  for (;;) {
    const { data } = await supabase.auth.getSession();
    if (!data?.session) await showLogin(msg);
    let me = null;
    try { me = await loadMe(); }
    catch (e) { msg = 'Could not check your access: ' + (e.message || e); await supabase.auth.signOut({ scope: 'local' }); continue; }
    if (me) return me;
    await supabase.auth.signOut({ scope: 'local' });
    msg = 'This login does not have access to the Fabric Catalogue. Ask the administrator.';
  }
}

export async function logout() { await supabase.auth.signOut({ scope: 'local' }); location.hash = ''; location.reload(); }
