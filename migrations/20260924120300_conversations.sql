-- ============================================================
-- Conversaciones con residentes (Telegram, WhatsApp, web/preview),
-- mensajes, acciones pendientes de confirmación, trazas del agente y cola
-- de trabajos en segundo plano del compute service.
-- ============================================================

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  -- chat_id (Telegram), teléfono E.164 (WhatsApp) o id interno (web).
  external_conversation_id text not null,
  -- Identidad de contacto: 'telegram:<chat_id>' o teléfono E.164.
  external_identity text,
  contact_name text,
  -- Residente verificado. Solo lo fija el servidor tras verificar por el
  -- canal (número de WhatsApp o contacto compartido en Telegram).
  person_id uuid references public.persons(id) on delete set null,
  identity_status text not null default 'unverified',
  verified_at timestamptz,
  verified_via text,
  status text not null default 'active',
  handoff_reason text,
  handoff_at timestamptz,
  notifications_opt_out boolean not null default false,
  is_preview boolean not null default false,
  privacy_notice_sent_at timestamptz,
  contact_requested_at timestamptz,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_channel_check check (channel in ('telegram', 'whatsapp', 'web')),
  constraint conversations_identity_check check (identity_status in ('unverified', 'verified', 'not_registered')),
  constraint conversations_verified_via_check
    check (verified_via is null or verified_via in ('whatsapp_phone', 'telegram_contact', 'preview')),
  constraint conversations_status_check check (status in ('active', 'handoff', 'closed')),
  constraint conversations_verified_person check (identity_status <> 'verified' or person_id is not null),
  constraint conversations_org_channel_external_unique unique (organization_id, channel, external_conversation_id)
);

create index if not exists idx_conversations_org_status on public.conversations (organization_id, status, last_message_at desc);
create index if not exists idx_conversations_person on public.conversations (person_id);

alter table public.conversations enable row level security;

create trigger trg_conversations_updated_at before update on public.conversations
  for each row execute function system.update_updated_at();
create trigger trg_conversations_immutable_org before update on public.conversations
  for each row execute function public.prevent_organization_change();
create trigger trg_conversations_tenant_refs before insert or update on public.conversations
  for each row execute function public.enforce_tenant_refs('person_id:persons');

-- Si se elimina la persona verificada (FK on delete set null) la
-- conversación vuelve a "no verificada" en vez de violar el CHECK.
create or replace function public.reset_identity_when_person_removed()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.person_id is null and new.identity_status = 'verified' then
    new.identity_status := 'unverified';
    new.verified_at := null;
    new.verified_via := null;
  end if;
  return new;
end;
$$;

create trigger trg_conversations_reset_identity before update on public.conversations
  for each row execute function public.reset_identity_when_person_removed();

create policy "conversations_select_inbox" on public.conversations for select to authenticated
  using (public.has_org_permission(organization_id, 'inbox.read'));

revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;

-- ------------------------------------------------------------
-- messages (inmutables)
-- ------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null,
  content text not null,
  message_type text not null default 'text',
  external_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  author_user_id uuid,
  created_at timestamptz not null default now(),
  constraint messages_role_check check (role in ('user', 'assistant', 'system', 'tool', 'staff')),
  constraint messages_type_check check (message_type in ('text', 'image', 'contact', 'document'))
);

create index if not exists idx_messages_conversation on public.messages (conversation_id, created_at);
create index if not exists idx_messages_org_created on public.messages (organization_id, created_at);

alter table public.messages enable row level security;

create policy "messages_select_inbox" on public.messages for select to authenticated
  using (public.has_org_permission(organization_id, 'inbox.read'));

revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

-- Marca de actividad de la conversación (para ordenar el Inbox y para la
-- ventana de 24h de WhatsApp: solo cuenta lo que escribió el residente).
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.conversations
  set last_message_at = new.created_at,
      last_inbound_at = case when new.role = 'user' then new.created_at else last_inbound_at end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger trg_messages_touch_conversation after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ------------------------------------------------------------
-- pending_actions: toda acción del agente que cambia estado se propone
-- primero (validación determinista + resumen generado por el servidor) y
-- solo se ejecuta con confirmar_accion si el residente escribió DESPUÉS de
-- la propuesta. Solo el compute service accede.
-- ------------------------------------------------------------
create table if not exists public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  action_type text not null,
  payload jsonb not null,
  summary text not null,
  status text not null default 'pending',
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  resolved_at timestamptz,
  constraint pending_actions_type_check
    check (action_type in ('create_pqrs', 'book_area', 'cancel_area_reservation', 'report_payment')),
  constraint pending_actions_status_check check (status in ('pending', 'executed', 'discarded', 'expired', 'failed'))
);

create index if not exists idx_pending_actions_conversation on public.pending_actions (conversation_id, status);

alter table public.pending_actions enable row level security;
revoke all on public.pending_actions from anon, authenticated;

-- ------------------------------------------------------------
-- ai_traces: observabilidad del asistente (sin contenido de mensajes).
-- ------------------------------------------------------------
create table if not exists public.ai_traces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  channel text,
  is_preview boolean not null default false,
  identity_status text,
  rounds integer not null default 0,
  tools_used text[] not null default '{}',
  tool_errors integer not null default 0,
  outcome text not null,
  latency_ms integer,
  prompt_tokens integer,
  completion_tokens integer,
  model text,
  created_at timestamptz not null default now(),
  constraint ai_traces_outcome_check check (outcome in ('reply', 'fallback', 'skipped', 'handoff', 'error'))
);

create index if not exists idx_ai_traces_org_created on public.ai_traces (organization_id, created_at desc);

alter table public.ai_traces enable row level security;

create policy "ai_traces_select_manager" on public.ai_traces for select to authenticated
  using (public.has_org_permission(organization_id, 'agent.manage'));

revoke all on public.ai_traces from anon, authenticated;
grant select on public.ai_traces to authenticated;

-- ------------------------------------------------------------
-- background_jobs: cola del compute service (vista previa del agente,
-- ingesta de documentos). Se reclama con SKIP LOCKED; un trabajo colgado
-- más de 10 minutos vuelve a la cola hasta 3 intentos (nunca infinito).
-- ------------------------------------------------------------
create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint background_jobs_type_check check (job_type in ('agent_turn', 'document_ingest')),
  constraint background_jobs_status_check check (status in ('queued', 'running', 'done', 'failed'))
);

create index if not exists idx_background_jobs_pending on public.background_jobs (created_at)
  where status in ('queued', 'running');

alter table public.background_jobs enable row level security;

create policy "background_jobs_select_own_or_manager" on public.background_jobs for select to authenticated
  using (created_by = (select auth.uid()) or public.has_org_permission(organization_id, 'agent.manage'));

revoke all on public.background_jobs from anon, authenticated;
grant select on public.background_jobs to authenticated;

create or replace function public.claim_background_jobs(p_limit integer default 5)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.background_jobs
  set status = 'failed', last_error = coalesce(last_error, 'timeout'), finished_at = now()
  where status = 'running' and started_at < now() - interval '10 minutes' and attempts >= 3;

  return query
  with picked as (
    select j.id
    from public.background_jobs j
    where j.status = 'queued'
       or (j.status = 'running' and j.started_at < now() - interval '10 minutes' and j.attempts < 3)
    order by j.created_at
    limit greatest(1, least(p_limit, 20))
    for update skip locked
  )
  update public.background_jobs j
  set status = 'running', attempts = j.attempts + 1, started_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

-- ------------------------------------------------------------
-- Vista previa del asistente desde el panel: crea (o reutiliza) una
-- conversación web marcada como preview, con identidad simulada opcional,
-- y encola un turno del agente real en modo simulación.
-- ------------------------------------------------------------
create or replace function public.enqueue_preview_message(
  p_organization_id uuid,
  p_content text,
  p_conversation_id uuid default null,
  p_person_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conversation public.conversations;
  v_message_id uuid;
  v_job_id uuid;
  v_content text := left(btrim(coalesce(p_content, '')), 2000);
begin
  perform public.assert_org_permission(p_organization_id, 'agent.manage');
  if v_content = '' then
    raise exception 'VALIDATION_ERROR: mensaje vacío' using errcode = '22023';
  end if;

  if p_conversation_id is not null then
    select * into v_conversation from public.conversations
    where id = p_conversation_id and organization_id = p_organization_id and is_preview;
    if not found then
      raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    if p_person_id is not null and not exists (
      select 1 from public.persons where id = p_person_id and organization_id = p_organization_id
    ) then
      raise exception 'PERSON_NOT_FOUND' using errcode = 'P0002';
    end if;
    insert into public.conversations (
      organization_id, channel, external_conversation_id, external_identity, contact_name, person_id,
      identity_status, verified_at, verified_via, is_preview
    ) values (
      p_organization_id, 'web', 'preview:' || gen_random_uuid(), 'preview', 'Vista previa', p_person_id,
      case when p_person_id is null then 'unverified' else 'verified' end,
      case when p_person_id is null then null else now() end,
      case when p_person_id is null then null else 'preview' end,
      true
    )
    returning * into v_conversation;
  end if;

  insert into public.messages (organization_id, conversation_id, role, content, author_user_id)
  values (p_organization_id, v_conversation.id, 'user', v_content, (select auth.uid()))
  returning id into v_message_id;

  insert into public.background_jobs (organization_id, job_type, payload, created_by)
  values (p_organization_id, 'agent_turn', jsonb_build_object('conversation_id', v_conversation.id), (select auth.uid()))
  returning id into v_job_id;

  return jsonb_build_object('conversation_id', v_conversation.id, 'message_id', v_message_id, 'job_id', v_job_id);
end;
$$;

-- ------------------------------------------------------------
-- Traspaso a humano desde el Inbox: 'handoff' pausa al asistente en esa
-- conversación; 'active' se la devuelve; 'closed' la archiva.
-- ------------------------------------------------------------
create or replace function public.set_conversation_status(
  p_conversation_id uuid,
  p_status text,
  p_reason text default null
)
returns public.conversations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conversation public.conversations;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id for update;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_conversation.organization_id, 'inbox.reply');
  if p_status not in ('active', 'handoff', 'closed') then
    raise exception 'VALIDATION_ERROR: estado inválido' using errcode = '22023';
  end if;

  update public.conversations
  set status = p_status,
      handoff_reason = case when p_status = 'handoff' then coalesce(p_reason, 'Tomada por el equipo de administración') else null end,
      handoff_at = case when p_status = 'handoff' then now() else null end
  where id = p_conversation_id
  returning * into v_conversation;
  return v_conversation;
end;
$$;

revoke execute on function
  public.reset_identity_when_person_removed(), public.touch_conversation_on_message(), public.claim_background_jobs(integer),
  public.enqueue_preview_message(uuid, text, uuid, uuid), public.set_conversation_status(uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.enqueue_preview_message(uuid, text, uuid, uuid), public.set_conversation_status(uuid, text, text)
to authenticated;
