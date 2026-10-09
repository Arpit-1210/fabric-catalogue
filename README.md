# Fabric Print Catalogue

Mobile-first catalogue for printed fabrics: auto print codes (RP-001, VF-001, DP-001), shades with photos, stock per shade, search, archive, Excel/CSV/PDF export. Vite + Supabase + Render.

## 1. Set up the database (once)
Supabase → SQL Editor → paste `sql/fabric_setup.sql` → Run (choose "Run without RLS" if asked; the script enables RLS itself). Safe to re-run.

## 2. Deploy (Render static site)
- Build: `npm install; npm run build`   Publish dir: `dist`
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (then redeploy; they are baked at build time).

## 3. First login
`admin@gfpl.com` is the admin. Log in with its existing password.

## 4. Add staff
Admin → Staff → enter email, name, password, role. Staff can add/edit designs and change stock; only admin manages categories, units, staff and backups. Existing logins from other apps cannot be hijacked.

## 5. Daily use
Search a print code (rp1, RP 12, RP-012 all work) → open design → see stock per shade. Use +Received / −Sold / Set, or Stock tab → Excel upload (download the template first).

## 6. Backup
Admin → Backup: download everything weekly. Designs are never deleted, only archived.

## 7. Install on iPhone
Open the site in Safari → Share → Add to Home Screen.

## Tests
`test/rls_test.sql` (real Postgres) and `test/ui_test.py` (Playwright, mocked backend).
