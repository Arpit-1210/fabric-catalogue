-- FABRIC PRINT CATALOGUE — database, security and image storage setup.
-- Run ONCE in Supabase -> SQL Editor ("Run without RLS" if asked). Safe to run again (it never deletes data).
-- Every table starts with fp_. Other apps in this project (Moulding, Finishing, Unit Transfer) get NO access to these tables.

create extension if not exists pgcrypto;

-- ───────── people ─────────
create table if not exists fp_staff (
  email text primary key,
  name text not null default '',
  role text not null default 'staff' check (role in ('admin', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into fp_staff (email, name, role) values ('admin@gfpl.com', 'Administrator', 'admin') on conflict (email) do nothing;

create or replace function fp_email() returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
create or replace function fp_is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fp_staff where email = fp_email() and active)
$$;
create or replace function fp_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fp_staff where email = fp_email() and active and role = 'admin')
$$;
create or replace function fp_whoami() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('email', email, 'name', name, 'role', role) from fp_staff where email = fp_email() and active), 'null'::jsonb)
$$;

-- ───────── catalogue tables ─────────
create table if not exists fp_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  prefix text not null unique check (prefix ~ '^[A-Z]{1,6}$'),
  next_number int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into fp_categories (name, prefix) values ('Roto Print', 'RP'), ('Velvet Foil', 'VF'), ('Digital Print', 'DP') on conflict do nothing;

create table if not exists fp_units (name text primary key);
insert into fp_units (name) values ('meters'), ('rolls'), ('kg'), ('pieces'), ('yards') on conflict do nothing;

create table if not exists fp_designs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category_id uuid not null references fp_categories(id),
  name text not null,
  colours text not null default '',
  notes text not null default '',
  fabric_width text not null default '',
  image_path text,
  thumb_path text,
  archived boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fp_designs_cat on fp_designs(category_id);

create table if not exists fp_shades (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null references fp_designs(id),
  shade_code text not null,
  colour text not null default '',
  notes text not null default '',
  image_path text,
  thumb_path text,
  unit text not null default 'meters',
  stock numeric not null default 0 check (stock >= 0),
  min_stock numeric not null default 0 check (min_stock >= 0),
  archived boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fp_shades_code_uq on fp_shades(design_id, lower(shade_code));
create index if not exists fp_shades_design on fp_shades(design_id);

create table if not exists fp_stock_moves (
  id uuid primary key default gen_random_uuid(),
  shade_id uuid not null references fp_shades(id),
  delta numeric not null,
  balance numeric not null,
  kind text not null,
  note text not null default '',
  by_email text,
  created_at timestamptz not null default now()
);
create index if not exists fp_moves_shade on fp_stock_moves(shade_id, created_at desc);

create table if not exists fp_audit (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null,
  by_email text,
  at timestamptz not null default now(),
  old_row jsonb,
  new_row jsonb
);

-- ───────── guards and history ─────────
create or replace function fp_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := fp_email(); return new; end $$;

create or replace function fp_designs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.code is distinct from old.code then raise exception 'A print code can never be changed'; end if;
    if new.category_id is distinct from old.category_id then raise exception 'Category cannot be changed after the code is issued'; end if;
  end if;
  if btrim(new.name) = '' then raise exception 'Design name is required'; end if;
  return new;
end $$;

create or replace function fp_shades_guard() returns trigger language plpgsql as $$
begin
  if btrim(new.shade_code) = '' then raise exception 'Shade code is required'; end if;
  if tg_op = 'INSERT' then
    new.stock := 0; new.created_by := fp_email();
  else
    if new.design_id is distinct from old.design_id then raise exception 'A shade cannot move to another design'; end if;
    if new.stock is distinct from old.stock and coalesce(current_setting('fp.allow_stock', true), '') <> '1' then
      raise exception 'Stock can only be changed with a stock movement';
    end if;
  end if;
  return new;
end $$;

create or replace function fp_staff_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Staff records cannot be deleted; deactivate instead'; end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from fp_staff where role = 'admin' and active and email <> old.email) then
    raise exception 'There must always be one active administrator';
  end if;
  return new;
end $$;

create or replace function fp_audit_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into fp_audit (table_name, row_id, action, by_email, old_row, new_row)
  values (tg_table_name, coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(new) ->> 'email')), tg_op, fp_email(),
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;

drop trigger if exists fp_designs_touch on fp_designs;   create trigger fp_designs_touch before update on fp_designs for each row execute function fp_touch();
drop trigger if exists fp_shades_touch on fp_shades;     create trigger fp_shades_touch before update on fp_shades for each row execute function fp_touch();
drop trigger if exists fp_designs_g on fp_designs;       create trigger fp_designs_g before insert or update on fp_designs for each row execute function fp_designs_guard();
drop trigger if exists fp_shades_g on fp_shades;         create trigger fp_shades_g before insert or update on fp_shades for each row execute function fp_shades_guard();
drop trigger if exists fp_staff_g on fp_staff;           create trigger fp_staff_g before update or delete on fp_staff for each row execute function fp_staff_guard();
drop trigger if exists fp_designs_a on fp_designs;       create trigger fp_designs_a after insert or update on fp_designs for each row execute function fp_audit_trg();
drop trigger if exists fp_shades_a on fp_shades;         create trigger fp_shades_a after insert or update on fp_shades for each row execute function fp_audit_trg();
drop trigger if exists fp_staff_a on fp_staff;           create trigger fp_staff_a after insert or update on fp_staff for each row execute function fp_audit_trg();
drop trigger if exists fp_cat_a on fp_categories;
drop trigger if exists fp_cat_i on fp_categories;
drop trigger if exists fp_cat_u on fp_categories;
create trigger fp_cat_i after insert on fp_categories for each row execute function fp_audit_trg();
create trigger fp_cat_u after update on fp_categories for each row
  when (old.name is distinct from new.name or old.prefix is distinct from new.prefix or old.active is distinct from new.active)
  execute function fp_audit_trg();

-- ───────── security (row level) ─────────
alter table fp_staff enable row level security;
alter table fp_categories enable row level security;
alter table fp_units enable row level security;
alter table fp_designs enable row level security;
alter table fp_shades enable row level security;
alter table fp_stock_moves enable row level security;
alter table fp_audit enable row level security;

do $$
declare t text; p record;
begin
  foreach t in array array['fp_staff','fp_categories','fp_units','fp_designs','fp_shades','fp_stock_moves','fp_audit'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy "staff list: admin" on fp_staff for select to authenticated using (fp_is_admin());
create policy "categories read" on fp_categories for select to authenticated using (fp_is_staff());
create policy "categories add" on fp_categories for insert to authenticated with check (fp_is_admin());
create policy "categories edit" on fp_categories for update to authenticated using (fp_is_admin()) with check (fp_is_admin());
create policy "units read" on fp_units for select to authenticated using (fp_is_staff());
create policy "units add" on fp_units for insert to authenticated with check (fp_is_staff());
create policy "designs read" on fp_designs for select to authenticated using (fp_is_staff());
create policy "designs edit" on fp_designs for update to authenticated using (fp_is_staff()) with check (fp_is_staff());
create policy "shades read" on fp_shades for select to authenticated using (fp_is_staff());
create policy "shades add" on fp_shades for insert to authenticated with check (fp_is_staff());
create policy "shades edit" on fp_shades for update to authenticated using (fp_is_staff()) with check (fp_is_staff());
create policy "moves read" on fp_stock_moves for select to authenticated using (fp_is_staff());
create policy "audit read" on fp_audit for select to authenticated using (fp_is_admin());
-- nobody can DELETE anything in these tables: designs and shades are archived, never removed.

revoke all on fp_staff, fp_categories, fp_units, fp_designs, fp_shades, fp_stock_moves, fp_audit from anon, authenticated, public;
grant select on fp_staff, fp_categories, fp_units, fp_designs, fp_shades, fp_stock_moves, fp_audit to authenticated;
grant insert, update on fp_categories to authenticated;
grant insert on fp_units to authenticated;
grant update on fp_designs to authenticated;
grant insert, update on fp_shades to authenticated;

-- ───────── print codes (sequential, unique, issued by the database) ─────────
create or replace function fp_create_design(p jsonb) returns fp_designs
language plpgsql security definer set search_path = public as $$
declare c fp_categories; n int; v_code text; d fp_designs;
begin
  if not fp_is_staff() then raise exception 'not allowed'; end if;
  select * into c from fp_categories where id = (p ->> 'category_id')::uuid and active for update;
  if c.id is null then raise exception 'Unknown or inactive category'; end if;
  n := c.next_number;
  loop
    v_code := c.prefix || '-' || lpad(n::text, 3, '0');
    exit when not exists (select 1 from fp_designs where code = v_code);
    n := n + 1;
  end loop;
  update fp_categories set next_number = n + 1 where id = c.id;
  insert into fp_designs (code, category_id, name, colours, notes, fabric_width, image_path, thumb_path, created_by, updated_by)
  values (v_code, c.id, coalesce(p ->> 'name', ''), coalesce(p ->> 'colours', ''), coalesce(p ->> 'notes', ''), coalesce(p ->> 'fabric_width', ''),
          nullif(p ->> 'image_path', ''), nullif(p ->> 'thumb_path', ''), fp_email(), fp_email())
  returning * into d;
  return d;
end $$;

-- ───────── stock movements (the only way stock changes) ─────────
create or replace function fp_stock_apply(p_shade uuid, p_mode text, p_qty numeric, p_note text default '')
returns fp_shades language plpgsql security definer set search_path = public as $$
declare s fp_shades; v_new numeric; v_delta numeric; v_kind text;
begin
  if not fp_is_staff() then raise exception 'not allowed'; end if;
  if p_qty is null then raise exception 'Enter a quantity'; end if;
  select * into s from fp_shades where id = p_shade for update;
  if s.id is null then raise exception 'Shade not found'; end if;
  if p_mode = 'set' then
    if p_qty < 0 then raise exception 'Stock cannot be negative'; end if;
    v_new := p_qty; v_kind := 'set';
  elsif p_mode = 'add' then
    v_new := s.stock + p_qty; v_kind := case when p_qty >= 0 then 'in' else 'out' end;
  else
    raise exception 'Unknown mode %', p_mode;
  end if;
  if v_new < 0 then raise exception 'Not enough stock: % has % %', s.shade_code, s.stock, s.unit; end if;
  v_delta := v_new - s.stock;
  perform set_config('fp.allow_stock', '1', true);
  update fp_shades set stock = v_new where id = s.id returning * into s;
  perform set_config('fp.allow_stock', '', true);
  insert into fp_stock_moves (shade_id, delta, balance, kind, note, by_email) values (s.id, v_delta, v_new, v_kind, coalesce(p_note, ''), fp_email());
  return s;
end $$;

-- bulk (Excel import): all rows succeed or none do. items = [{shade_id, qty, unit?}]
create or replace function fp_stock_bulk(p_items jsonb, p_mode text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0; v_unit text;
begin
  if not fp_is_staff() then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Nothing to import'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    v_unit := nullif(btrim(coalesce(e ->> 'unit', '')), '');
    if v_unit is not null then
      insert into fp_units (name) values (v_unit) on conflict do nothing;
      update fp_shades set unit = v_unit where id = (e ->> 'shade_id')::uuid and unit is distinct from v_unit;
    end if;
    perform fp_stock_apply((e ->> 'shade_id')::uuid, p_mode, (e ->> 'qty')::numeric, coalesce(p_note, 'Excel import'));
    n := n + 1;
  end loop;
  return jsonb_build_object('updated', n);
end $$;

-- ───────── staff management (administrator only) ─────────
create or replace function fp_add_staff(p_email text, p_name text, p_password text, p_role text default 'staff') returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare uid uuid;
begin
  if not fp_is_admin() then raise exception 'Administrator only'; end if;
  p_email := lower(btrim(p_email));
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email'; end if;
  if p_role not in ('admin', 'staff') then raise exception 'Role must be admin or staff'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  select id into uid from auth.users where email = p_email;
  if uid is not null and not exists (select 1 from fp_staff where email = p_email) then
    raise exception 'This login already exists in another app. Use a different email for this person.';
  end if;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', p_email,
      crypt(p_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', p_email), 'email', now(), now(), now());
  else
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = uid;
  end if;
  insert into fp_staff (email, name, role, active) values (p_email, coalesce(p_name, ''), p_role, true)
  on conflict (email) do update set name = excluded.name, role = excluded.role, active = true;
  return p_email;
end $$;

create or replace function fp_reset_staff_password(p_email text, p_password text) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not fp_is_admin() then raise exception 'Administrator only'; end if;
  p_email := lower(btrim(p_email));
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  if not exists (select 1 from fp_staff where email = p_email) then raise exception 'Not a staff member'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where email = p_email;
  return p_email;
end $$;

create or replace function fp_set_staff(p_email text, p_active boolean, p_role text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not fp_is_admin() then raise exception 'Administrator only'; end if;
  update fp_staff set active = p_active, role = coalesce(p_role, role) where email = lower(btrim(p_email));
  if not found then raise exception 'Not a staff member'; end if;
end $$;

revoke execute on function fp_whoami(), fp_is_staff(), fp_is_admin(), fp_create_design(jsonb), fp_stock_apply(uuid, text, numeric, text),
  fp_stock_bulk(jsonb, text, text), fp_add_staff(text, text, text, text), fp_reset_staff_password(text, text), fp_set_staff(text, boolean, text) from public, anon;
grant execute on function fp_whoami(), fp_is_staff(), fp_is_admin(), fp_create_design(jsonb), fp_stock_apply(uuid, text, numeric, text),
  fp_stock_bulk(jsonb, text, text), fp_add_staff(text, text, text, text), fp_reset_staff_password(text, text), fp_set_staff(text, boolean, text) to authenticated;

-- ───────── private image storage ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fabrics', 'fabrics', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "fp images read" on storage.objects;
drop policy if exists "fp images add" on storage.objects;
create policy "fp images read" on storage.objects for select to authenticated using (bucket_id = 'fabrics' and fp_is_staff());
create policy "fp images add" on storage.objects for insert to authenticated with check (bucket_id = 'fabrics' and fp_is_staff());
-- no update / delete policy on images: files are never overwritten or removed from the app.

select (select count(*) from fp_categories) as categories, (select count(*) from fp_units) as units, (select count(*) from fp_staff) as staff;
