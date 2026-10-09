-- minimal stand-in for Supabase's auth + storage so the setup SQL can be tested in plain Postgres
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema storage; create schema extensions;
create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz, confirmation_token text, email_change text, email_change_token_new text, recovery_token text);
create table auth.identities (id uuid primary key, user_id uuid, provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema auth, storage to authenticated, anon;
grant select, insert on storage.objects to authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
