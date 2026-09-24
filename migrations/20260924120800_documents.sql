-- ============================================================
-- Documentos y memoria institucional (reglamento, manual de convivencia,
-- actas, pólizas, circulares...) con búsqueda de texto completo en
-- español para el asistente (RAG estricto: recuperar, rankear, citar).
--
-- Visibilidad:
--   public    -> cualquier persona que escribe al asistente
--   residents -> solo residentes verificados
--   staff     -> solo el equipo; nunca llega al asistente
-- ============================================================

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  doc_type text not null default 'other',
  visibility text not null default 'residents',
  version text,
  effective_date date,
  storage_key text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  -- Texto pegado directamente (preguntas frecuentes, circulares cortas).
  source_text text,
  status text not null default 'pending',
  error text,
  ai_enabled boolean not null default true,
  chunk_count integer not null default 0,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_title_check check (length(btrim(title)) between 2 and 200),
  constraint documents_type_check check (doc_type in (
    'bylaws', 'coexistence_manual', 'assembly_minutes', 'council_minutes', 'contract', 'insurance_policy',
    'circular', 'procedure', 'faq', 'report', 'other')),
  constraint documents_visibility_check check (visibility in ('public', 'residents', 'staff')),
  constraint documents_status_check check (status in ('pending', 'processing', 'ready', 'failed')),
  constraint documents_source_check check (storage_key is not null or source_text is not null),
  constraint documents_source_text_length check (source_text is null or length(source_text) <= 200000)
);

create index if not exists idx_documents_org on public.documents (organization_id, created_at desc);

alter table public.documents enable row level security;

create trigger trg_documents_updated_at before update on public.documents
  for each row execute function system.update_updated_at();
create trigger trg_documents_immutable_org before update on public.documents
  for each row execute function public.prevent_organization_change();

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  heading text,
  content text not null,
  tsv tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(heading, '')), 'A') || setweight(to_tsvector('spanish', content), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  constraint document_chunks_unique unique (document_id, chunk_index)
);

create index if not exists idx_document_chunks_tsv on public.document_chunks using gin (tsv);
create index if not exists idx_document_chunks_org on public.document_chunks (organization_id);

alter table public.document_chunks enable row level security;

create policy "documents_select_reader" on public.documents for select to authenticated
  using (public.has_org_permission(organization_id, 'documents.read'));
create policy "documents_insert_writer" on public.documents for insert to authenticated
  with check (public.has_org_permission(organization_id, 'documents.write')
              and status = 'pending' and uploaded_by = (select auth.uid()));
create policy "documents_update_writer" on public.documents for update to authenticated
  using (public.has_org_permission(organization_id, 'documents.write'))
  with check (public.has_org_permission(organization_id, 'documents.write'));
create policy "documents_delete_writer" on public.documents for delete to authenticated
  using (public.has_org_permission(organization_id, 'documents.write'));

create policy "document_chunks_select_reader" on public.document_chunks for select to authenticated
  using (public.has_org_permission(organization_id, 'documents.read'));

revoke all on public.documents, public.document_chunks from anon, authenticated;
grant select, insert, delete on public.documents to authenticated;
grant update (title, doc_type, visibility, version, effective_date, ai_enabled) on public.documents to authenticated;
grant select on public.document_chunks to authenticated;

-- Cada documento nuevo encola su ingesta (extracción + fragmentación).
create or replace function public.enqueue_document_ingest()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.background_jobs (organization_id, job_type, payload, created_by)
  values (new.organization_id, 'document_ingest', jsonb_build_object('document_id', new.id), new.uploaded_by);
  return new;
end;
$$;

create trigger trg_documents_enqueue_ingest after insert on public.documents
  for each row execute function public.enqueue_document_ingest();

create or replace function public.reprocess_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents where id = p_document_id;
  if not found then
    raise exception 'DOCUMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_doc.organization_id, 'documents.write');
  update public.documents set status = 'pending', error = null where id = p_document_id;
  insert into public.background_jobs (organization_id, job_type, payload, created_by)
  values (v_doc.organization_id, 'document_ingest', jsonb_build_object('document_id', v_doc.id), (select auth.uid()));
end;
$$;

-- ------------------------------------------------------------
-- Búsqueda: OR de los lexemas de la consulta (una pregunta natural rara
-- vez contiene TODOS los términos del artículo), ranking ts_rank_cd y
-- solo documentos listos, habilitados para IA y con la visibilidad
-- permitida para quien pregunta.
-- ------------------------------------------------------------
create or replace function public.search_document_chunks(
  p_organization_id uuid,
  p_query text,
  p_visibilities text[],
  p_limit integer default 5
)
returns table (
  document_id uuid, title text, doc_type text, version text, effective_date date,
  heading text, content text, rank real
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_query tsquery;
  v_terms text;
begin
  if (select auth.uid()) is not null and not public.has_org_permission(p_organization_id, 'documents.read') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select string_agg(quote_literal(lexeme), ' | ') into v_terms
  from unnest(to_tsvector('spanish', left(coalesce(p_query, ''), 500)));
  if v_terms is null then
    return;
  end if;
  v_query := to_tsquery('simple', v_terms);

  return query
  select d.id, d.title, d.doc_type, d.version, d.effective_date, c.heading, c.content,
         ts_rank_cd(c.tsv, v_query) as rank
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.organization_id = p_organization_id
    and d.status = 'ready' and d.ai_enabled
    and d.visibility = any (p_visibilities)
    and c.tsv @@ v_query
  order by rank desc, d.effective_date desc nulls last
  limit greatest(1, least(coalesce(p_limit, 5), 10));
end;
$$;

revoke execute on function
  public.enqueue_document_ingest(), public.reprocess_document(uuid),
  public.search_document_chunks(uuid, text, text[], integer)
from public, anon, authenticated;

grant execute on function public.reprocess_document(uuid), public.search_document_chunks(uuid, text, text[], integer)
to authenticated;
