-- Emulación mínima de lo que InsForge provee antes de nuestras
-- migraciones: roles de runtime, esquema auth, trigger de updated_at,
-- storage.objects y los privilegios amplios por defecto sobre public
-- (así los tests verifican que nuestros REVOKE explícitos funcionan).
create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text not null,
  profile jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema system;
create function system.update_updated_at() returns trigger
language plpgsql
as $$ begin new.updated_at := now(); return new; end $$;
grant usage on schema system to anon, authenticated;
grant execute on function system.update_updated_at() to anon, authenticated;

create schema storage;
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  key text not null,
  uploaded_by text,
  created_at timestamptz not null default now()
);
grant usage on schema storage to anon, authenticated;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
