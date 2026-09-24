-- ============================================================
-- Comunicaciones: outbox de mensajes salientes y comunicados
-- segmentados.
--
-- Todo mensaje que sale hacia un residente (respuesta del equipo,
-- comunicado, recordatorio de cobro, avisos de PQRS o reservas) se
-- encola en outbound_messages. El compute service lo entrega por el canal
-- correcto (texto libre o plantilla según la ventana de 24h de WhatsApp),
-- con máximo 3 intentos e idempotencia por dedupe_key. El canal no
-- contiene lógica de negocio.
-- ============================================================

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  person_id uuid references public.persons(id) on delete set null,
  destination text not null,
  kind text not null,
  body text not null,
  template_key text,
  template_vars jsonb not null default '{}'::jsonb,
  source_type text,
  source_id uuid,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  dedupe_key text,
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outbound_channel_check check (channel in ('telegram', 'whatsapp')),
  constraint outbound_kind_check
    check (kind in ('staff_reply', 'announcement', 'payment_reminder', 'pqrs_update', 'reservation_update', 'system')),
  constraint outbound_template_check
    check (template_key is null or template_key in ('announcement', 'payment_reminder', 'pqrs_update', 'reservation_update')),
  constraint outbound_status_check check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  constraint outbound_dedupe_unique unique (organization_id, dedupe_key)
);

create index if not exists idx_outbound_pending on public.outbound_messages (scheduled_at)
  where status in ('queued', 'sending');
create index if not exists idx_outbound_source on public.outbound_messages (source_type, source_id);
create index if not exists idx_outbound_conversation on public.outbound_messages (conversation_id, created_at);

alter table public.outbound_messages enable row level security;

create trigger trg_outbound_updated_at before update on public.outbound_messages
  for each row execute function system.update_updated_at();

create policy "outbound_select_reader" on public.outbound_messages for select to authenticated
  using (public.has_org_permission(organization_id, 'inbox.read')
         or public.has_org_permission(organization_id, 'communications.read'));

revoke all on public.outbound_messages from anon, authenticated;
grant select on public.outbound_messages to authenticated;

-- ------------------------------------------------------------
-- Conversación principal de un residente: la verificada, real (no
-- preview) y con actividad más reciente. Un solo canal por persona evita
-- duplicar avisos a quien usa Telegram y WhatsApp a la vez.
-- ------------------------------------------------------------
create or replace function public.person_primary_conversation(p_organization_id uuid, p_person_id uuid)
returns public.conversations
language sql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
  select c.*
  from public.conversations c
  where c.organization_id = p_organization_id
    and c.person_id = p_person_id
    and c.identity_status = 'verified'
    and not c.is_preview
    and c.channel in ('telegram', 'whatsapp')
  order by c.last_inbound_at desc nulls last, c.created_at desc
  limit 1;
$$;

create or replace function public.conversation_destination(p_conversation public.conversations)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select case p_conversation.channel
    when 'telegram' then p_conversation.external_conversation_id
    else coalesce(p_conversation.external_identity, p_conversation.external_conversation_id)
  end;
$$;

-- Encola un mensaje para una persona. Devuelve el id encolado, o null si
-- la persona no tiene canal vinculado, se dio de baja (cuando aplica) o
-- el mensaje ya existía (dedupe_key).
create or replace function public.enqueue_outbound_to_person(
  p_organization_id uuid,
  p_person_id uuid,
  p_kind text,
  p_body text,
  p_template_key text default null,
  p_template_vars jsonb default '{}'::jsonb,
  p_source_type text default null,
  p_source_id uuid default null,
  p_dedupe_key text default null,
  p_respect_opt_out boolean default true,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conversation public.conversations;
  v_id uuid;
begin
  if p_conversation_id is not null then
    select * into v_conversation from public.conversations
    where id = p_conversation_id and organization_id = p_organization_id
      and not is_preview and channel in ('telegram', 'whatsapp');
  end if;
  if v_conversation.id is null and p_person_id is not null then
    v_conversation := public.person_primary_conversation(p_organization_id, p_person_id);
  end if;
  if v_conversation.id is null then
    return null;
  end if;
  if p_respect_opt_out and v_conversation.notifications_opt_out then
    return null;
  end if;

  insert into public.outbound_messages (
    organization_id, channel, conversation_id, person_id, destination, kind, body,
    template_key, template_vars, source_type, source_id, dedupe_key
  ) values (
    p_organization_id, v_conversation.channel, v_conversation.id, coalesce(p_person_id, v_conversation.person_id),
    public.conversation_destination(v_conversation), p_kind, left(p_body, 4000),
    p_template_key, coalesce(p_template_vars, '{}'::jsonb), p_source_type, p_source_id, p_dedupe_key
  )
  on conflict (organization_id, dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- Reclamo del worker de envío (solo compute service).
create or replace function public.claim_outbound_messages(p_limit integer default 20)
returns setof public.outbound_messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  update public.outbound_messages
  set status = case when attempts < 3 then 'queued' else 'failed' end,
      last_error = case when attempts < 3 then last_error else coalesce(last_error, 'timeout') end
  where status = 'sending' and updated_at < now() - interval '5 minutes';

  return query
  with picked as (
    select o.id
    from public.outbound_messages o
    where o.status = 'queued' and o.scheduled_at <= now()
    order by o.scheduled_at, o.created_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  update public.outbound_messages o
  set status = 'sending', attempts = o.attempts + 1
  from picked
  where o.id = picked.id
  returning o.*;
end;
$$;

-- ------------------------------------------------------------
-- Respuesta manual del equipo desde el Inbox. Toma la conversación
-- (el asistente queda en pausa) y encola el envío por su canal.
-- ------------------------------------------------------------
create or replace function public.send_staff_reply(p_conversation_id uuid, p_content text)
returns public.messages
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conversation public.conversations;
  v_message public.messages;
  v_content text := left(btrim(coalesce(p_content, '')), 4000);
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_conversation.organization_id, 'inbox.reply');
  if v_content = '' then
    raise exception 'VALIDATION_ERROR: mensaje vacío' using errcode = '22023';
  end if;
  if v_conversation.is_preview or v_conversation.channel not in ('telegram', 'whatsapp') then
    raise exception 'VALIDATION_ERROR: la conversación no admite respuestas manuales' using errcode = '22023';
  end if;

  insert into public.messages (organization_id, conversation_id, role, content, author_user_id)
  values (v_conversation.organization_id, v_conversation.id, 'staff', v_content, (select auth.uid()))
  returning * into v_message;

  insert into public.outbound_messages (
    organization_id, channel, conversation_id, person_id, destination, kind, body, source_type, source_id
  ) values (
    v_conversation.organization_id, v_conversation.channel, v_conversation.id, v_conversation.person_id,
    public.conversation_destination(v_conversation), 'staff_reply', v_content, 'message', v_message.id
  );

  if v_conversation.status = 'active' then
    update public.conversations
    set status = 'handoff', handoff_at = now(), handoff_reason = 'Respondida por el equipo de administración'
    where id = v_conversation.id;
  end if;

  return v_message;
end;
$$;

-- ------------------------------------------------------------
-- announcements: comunicados segmentados. La audiencia "debtors" nunca
-- publica una lista: cada unidad en mora recibe un mensaje privado.
-- ------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text not null,
  audience_type text not null default 'all',
  audience_tower_ids uuid[] not null default '{}',
  audience_unit_ids uuid[] not null default '{}',
  status text not null default 'draft',
  recipients_count integer not null default 0,
  without_channel_count integer not null default 0,
  author_user_id uuid default auth.uid(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_check check (length(btrim(title)) between 3 and 160),
  constraint announcements_body_check check (length(btrim(body)) between 3 and 3500),
  constraint announcements_audience_check
    check (audience_type in ('all', 'towers', 'units', 'owners', 'residents', 'debtors')),
  constraint announcements_status_check check (status in ('draft', 'sent', 'cancelled'))
);

create index if not exists idx_announcements_org on public.announcements (organization_id, created_at desc);

alter table public.announcements enable row level security;

create trigger trg_announcements_updated_at before update on public.announcements
  for each row execute function system.update_updated_at();
create trigger trg_announcements_immutable_org before update on public.announcements
  for each row execute function public.prevent_organization_change();

-- Un comunicado enviado es memoria institucional: no se edita ni se borra.
create or replace function public.guard_announcement_changes()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Solo se pueden eliminar borradores' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (select auth.uid()) is not null then
    raise exception 'Un comunicado enviado no se puede modificar' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trg_announcements_guard before update or delete on public.announcements
  for each row execute function public.guard_announcement_changes();

create policy "announcements_select_reader" on public.announcements for select to authenticated
  using (public.has_org_permission(organization_id, 'communications.read'));
create policy "announcements_insert_sender" on public.announcements for insert to authenticated
  with check (public.has_org_permission(organization_id, 'communications.send') and status = 'draft');
create policy "announcements_update_sender" on public.announcements for update to authenticated
  using (public.has_org_permission(organization_id, 'communications.send'))
  with check (public.has_org_permission(organization_id, 'communications.send') and status = 'draft');
create policy "announcements_delete_sender" on public.announcements for delete to authenticated
  using (public.has_org_permission(organization_id, 'communications.send'));

revoke all on public.announcements from anon, authenticated;
grant select, insert, delete on public.announcements to authenticated;
grant update (title, body, audience_type, audience_tower_ids, audience_unit_ids) on public.announcements to authenticated;

-- Resuelve la audiencia y encola un mensaje privado por persona.
create or replace function public.send_announcement(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_announcement public.announcements;
  v_property_name text;
  v_person record;
  v_queued integer := 0;
  v_without_channel integer := 0;
  v_outbound_id uuid;
begin
  select * into v_announcement from public.announcements where id = p_announcement_id for update;
  if not found then
    raise exception 'ANNOUNCEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_announcement.organization_id, 'communications.send');
  if v_announcement.status <> 'draft' then
    raise exception 'ANNOUNCEMENT_ALREADY_SENT' using errcode = 'P0001';
  end if;

  select display_name into v_property_name from public.property_profiles
  where organization_id = v_announcement.organization_id;

  for v_person in
    select distinct p.id as person_id, p.full_name
    from public.unit_persons up
    join public.units u on u.id = up.unit_id and u.is_active
    join public.persons p on p.id = up.person_id
    where up.organization_id = v_announcement.organization_id
      and (up.ends_on is null or up.ends_on >= current_date)
      and case v_announcement.audience_type
        when 'all' then true
        when 'towers' then u.tower_id = any (v_announcement.audience_tower_ids)
        when 'units' then u.id = any (v_announcement.audience_unit_ids)
        when 'owners' then up.relation = 'owner'
        when 'residents' then up.relation in ('tenant', 'resident')
        when 'debtors' then up.relation in ('owner', 'tenant') and exists (
          select 1 from public.ledger_open_items(v_announcement.organization_id, u.id) li
          where li.unpaid > 0 and li.due_date < current_date
        )
        else false
      end
  loop
    v_outbound_id := public.enqueue_outbound_to_person(
      v_announcement.organization_id, v_person.person_id, 'announcement',
      '📢 ' || v_announcement.title || E'\n\n' || v_announcement.body,
      'announcement',
      jsonb_build_object('1', split_part(v_person.full_name, ' ', 1), '2', coalesce(v_property_name, ''), '3', v_announcement.title),
      'announcement', v_announcement.id,
      'announcement:' || v_announcement.id || ':' || v_person.person_id,
      true
    );
    if v_outbound_id is null then
      v_without_channel := v_without_channel + 1;
    else
      v_queued := v_queued + 1;
    end if;
  end loop;

  update public.announcements
  set status = 'sent', sent_at = now(), recipients_count = v_queued, without_channel_count = v_without_channel
  where id = p_announcement_id;

  return jsonb_build_object('queued', v_queued, 'without_channel', v_without_channel);
end;
$$;

-- Métricas de entrega por comunicado.
create or replace function public.get_announcement_delivery(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.announcements where id = p_announcement_id;
  if v_org is null then
    raise exception 'ANNOUNCEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.assert_org_permission(v_org, 'communications.read');
  return (
    select jsonb_build_object(
      'queued', count(*) filter (where status in ('queued', 'sending')),
      'sent', count(*) filter (where status = 'sent'),
      'failed', count(*) filter (where status = 'failed')
    )
    from public.outbound_messages
    where source_type = 'announcement' and source_id = p_announcement_id
  );
end;
$$;

revoke execute on function
  public.person_primary_conversation(uuid, uuid), public.conversation_destination(public.conversations),
  public.enqueue_outbound_to_person(uuid, uuid, text, text, text, jsonb, text, uuid, text, boolean, uuid),
  public.claim_outbound_messages(integer), public.send_staff_reply(uuid, text),
  public.guard_announcement_changes(), public.send_announcement(uuid), public.get_announcement_delivery(uuid)
from public, anon, authenticated;

grant execute on function
  public.send_staff_reply(uuid, text), public.send_announcement(uuid), public.get_announcement_delivery(uuid)
to authenticated;
