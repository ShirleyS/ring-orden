-- Ring Orden normalized Supabase deployment schema.
-- Run in a NEW Supabase project. Existing deployments append migrations.
-- MojoAuth identities must be exchanged for Supabase-compatible signed JWTs
-- server-side (sub = trusted provider subject). Never trust user_metadata roles.
create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;
create schema if not exists ring_private;
revoke all on schema ring_private from public, anon;
grant usage on schema ring_private to authenticated;

create table public.merchants (
 id text primary key, owner_user_id text not null,
 name text not null check(length(name) between 1 and 120),
 currency char(3) not null default 'MXN', timezone text not null default 'America/Mexico_City',
 created_at timestamptz not null default now()
);
create table public.merchant_users (
 id uuid primary key default gen_random_uuid(), merchant_id text not null references public.merchants(id) on delete cascade,
 user_id text not null, role text not null check(role in ('OWNER','MANAGER','STAFF')),
 created_at timestamptz not null default now(), unique(merchant_id,user_id)
);
-- Narrow internal membership lookup; explicit subject check, fixed empty search path,
-- private schema, authenticated-only EXECUTE. This avoids recursive membership RLS.
create function ring_private.has_role(target_merchant text, allowed_roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
 select nullif(auth.jwt()->>'sub','') is not null and (
   ('OWNER' = any(allowed_roles) and exists(select 1 from public.merchants m where m.id=target_merchant and m.owner_user_id=auth.jwt()->>'sub'))
   or exists(select 1 from public.merchant_users u where u.merchant_id=target_merchant and u.user_id=auth.jwt()->>'sub' and u.role=any(allowed_roles))
 );
$$;
revoke all on function ring_private.has_role(text,text[]) from public, anon;
grant execute on function ring_private.has_role(text,text[]) to authenticated;

alter table public.merchants enable row level security;
alter table public.merchant_users enable row level security;
create policy merchants_read on public.merchants for select to authenticated using(ring_private.has_role(id,array['OWNER','MANAGER','STAFF']));
create policy merchants_create on public.merchants for insert to authenticated with check(owner_user_id=auth.jwt()->>'sub' and nullif(auth.jwt()->>'sub','') is not null);
create policy merchants_update on public.merchants for update to authenticated using(owner_user_id=auth.jwt()->>'sub') with check(owner_user_id=auth.jwt()->>'sub');
create policy users_read on public.merchant_users for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER'] ) or user_id=auth.jwt()->>'sub');
create policy users_insert on public.merchant_users for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']) and role in ('MANAGER','STAFF'));
create policy users_update on public.merchant_users for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']) and role in ('MANAGER','STAFF'));
create policy users_delete on public.merchant_users for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']) and role<>'OWNER');

create table public.menu_items (
 id text not null, merchant_id text not null references public.merchants(id),
 name text not null, description text, category text not null,
 unit_amount integer not null check(unit_amount>=0), available boolean not null default true,
 created_at timestamptz not null default now(), primary key(merchant_id,id)
);
create table public.modifier_groups (
 id text not null,merchant_id text not null references public.merchants(id),name text not null,
 min_selected integer not null default 0, max_selected integer not null default 1,
 primary key(merchant_id,id),check(min_selected>=0 and max_selected>=min_selected)
);
create table public.modifiers (
 id text not null,merchant_id text not null references public.merchants(id),group_id text,
 name text not null,price_delta integer not null default 0 check(price_delta>=0),available boolean not null default true,
 primary key(merchant_id,id),foreign key(merchant_id,group_id) references public.modifier_groups(merchant_id,id)
);
create table public.orders (
 id text not null,merchant_id text not null references public.merchants(id),external_reference text not null,
 source text not null check(source in ('voice','dashboard','demo')),currency char(3) not null default 'MXN',
 customer_name text,customer_phone text,fulfillment jsonb not null default '{"type":"pickup"}'::jsonb,
 subtotal integer not null default 0 check(subtotal>=0),tax integer not null default 0 check(tax>=0),fees integer not null default 0 check(fees>=0),total integer not null default 0 check(total>=0),
 status text not null default 'DRAFT' check(status in ('DRAFT','AWAITING_CLARIFICATION','AWAITING_CONFIRMATION','CONFIRMED','PAYMENT_PENDING','PAID','POS_SYNC_PENDING','POS_SYNCED','POS_SYNC_FAILED','PREPARING','READY','COMPLETED','CANCELLED','REFUND_PENDING','REFUNDED','ESCALATED')),
 payment_status text not null default 'PENDING' check(payment_status in ('PENDING','PAID','PAYMENT_ERROR','REFUND_PENDING','REFUNDED')),
 revision integer not null default 0,canonical jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(merchant_id,id),unique(merchant_id,external_reference),check(total=subtotal+tax+fees)
);
create table public.order_items (
 id text not null,merchant_id text not null,order_id text not null,catalog_item_id text not null,
 name text not null,quantity integer not null check(quantity between 1 and 20),unit_amount integer not null check(unit_amount>=0),
 primary key(merchant_id,id),foreign key(merchant_id,order_id) references public.orders(merchant_id,id),
 foreign key(merchant_id,catalog_item_id) references public.menu_items(merchant_id,id)
);
create table public.order_item_modifiers (
 id uuid primary key default gen_random_uuid(),merchant_id text not null,item_id text not null,modifier_id text not null,
 name text not null,price_delta integer not null check(price_delta>=0),
 foreign key(merchant_id,item_id) references public.order_items(merchant_id,id),foreign key(merchant_id,modifier_id) references public.modifiers(merchant_id,id)
);
create table public.call_sessions (
 id text not null,merchant_id text not null references public.merchants(id),order_id text,conversation_id text,
 status text not null default 'ACTIVE',last_operation jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(merchant_id,id),foreign key(merchant_id,order_id) references public.orders(merchant_id,id),unique(merchant_id,conversation_id)
);
create table public.conversation_turns (
 id uuid primary key default gen_random_uuid(),merchant_id text not null,session_id text not null,
 role text not null check(role in ('user','assistant')),transcript text not null,operations jsonb,model text,latency_ms integer,
 created_at timestamptz not null default now(),foreign key(merchant_id,session_id) references public.call_sessions(merchant_id,id)
);
create table public.correction_memories (
 id text not null,merchant_id text not null references public.merchants(id),language text not null,
 observed_text text not null,previous_interpretation jsonb not null,corrected_interpretation jsonb not null,
 confirmed_by_customer boolean not null default false,merchant_approved boolean not null default false,active boolean not null default true,
 times_observed integer not null default 1 check(times_observed>0),successful_retrieval_count integer not null default 0,failed_retrieval_count integer not null default 0,
 embedding extensions.vector(384),created_at timestamptz not null default now(),last_used_at timestamptz,last_confirmed_at timestamptz,
 primary key(merchant_id,id)
);
create index correction_memories_tenant on public.correction_memories(merchant_id,active,language);
create table public.escalations (
 id text not null,merchant_id text not null references public.merchants(id),order_id text,
 reason text not null,status text not null default 'OPEN' check(status in ('OPEN','RESOLVED')),priority text not null default 'Medium',
 created_at timestamptz not null default now(),primary key(merchant_id,id),foreign key(merchant_id,order_id) references public.orders(merchant_id,id)
);

create table public.merchant_settings (id uuid primary key default gen_random_uuid(),merchant_id text not null references public.merchants(id),configuration jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());

create table public.merchant_phone_numbers (id uuid primary key default gen_random_uuid(),merchant_id text not null references public.merchants(id),configuration jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());

create table public.notification_destinations (id uuid primary key default gen_random_uuid(),merchant_id text not null references public.merchants(id),configuration jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());

create table public.model_connections (id uuid primary key default gen_random_uuid(),merchant_id text not null references public.merchants(id),configuration jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());

create table public.pos_connections (id uuid primary key default gen_random_uuid(),merchant_id text not null references public.merchants(id),configuration jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());

create table public.pos_catalog_mappings (id uuid primary key default gen_random_uuid(),merchant_id text not null references public.merchants(id),configuration jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());

create table public.model_health_checks (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.interpretation_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.correction_memory_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.memory_usage_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.payment_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.pos_sync_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.audit_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.integration_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

create table public.analytics_events (id text not null,merchant_id text not null references public.merchants(id),event_type text not null,payload jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),primary key(merchant_id,id));

-- Provider credentials never enter the exposed public schema.
create table ring_private.provider_credentials (
 merchant_id text not null references public.merchants(id),provider text not null,
 encrypted_secret bytea not null,key_version integer not null default 1,updated_at timestamptz not null default now(),
 primary key(merchant_id,provider)
);
alter table ring_private.provider_credentials enable row level security;
revoke all on ring_private.provider_credentials from public,anon,authenticated;
-- Only the deployment's restricted server database role may access this table.
-- Encrypt using an external server key before insert; never put it in configuration JSON.

alter table public.merchant_settings enable row level security;
create policy merchant_settings_read on public.merchant_settings for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
create policy merchant_settings_insert on public.merchant_settings for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy merchant_settings_update on public.merchant_settings for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy merchant_settings_delete on public.merchant_settings for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
grant select,insert,update,delete on public.merchant_settings to authenticated;
create index merchant_settings_merchant on public.merchant_settings(merchant_id);

alter table public.merchant_phone_numbers enable row level security;
create policy merchant_phone_numbers_read on public.merchant_phone_numbers for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
create policy merchant_phone_numbers_insert on public.merchant_phone_numbers for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy merchant_phone_numbers_update on public.merchant_phone_numbers for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy merchant_phone_numbers_delete on public.merchant_phone_numbers for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
grant select,insert,update,delete on public.merchant_phone_numbers to authenticated;
create index merchant_phone_numbers_merchant on public.merchant_phone_numbers(merchant_id);

alter table public.notification_destinations enable row level security;
create policy notification_destinations_read on public.notification_destinations for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
create policy notification_destinations_insert on public.notification_destinations for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy notification_destinations_update on public.notification_destinations for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy notification_destinations_delete on public.notification_destinations for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
grant select,insert,update,delete on public.notification_destinations to authenticated;
create index notification_destinations_merchant on public.notification_destinations(merchant_id);

alter table public.model_connections enable row level security;
create policy model_connections_read on public.model_connections for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
create policy model_connections_insert on public.model_connections for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy model_connections_update on public.model_connections for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy model_connections_delete on public.model_connections for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
grant select,insert,update,delete on public.model_connections to authenticated;
create index model_connections_merchant on public.model_connections(merchant_id);

alter table public.pos_connections enable row level security;
create policy pos_connections_read on public.pos_connections for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
create policy pos_connections_insert on public.pos_connections for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy pos_connections_update on public.pos_connections for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy pos_connections_delete on public.pos_connections for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
grant select,insert,update,delete on public.pos_connections to authenticated;
create index pos_connections_merchant on public.pos_connections(merchant_id);

alter table public.pos_catalog_mappings enable row level security;
create policy pos_catalog_mappings_read on public.pos_catalog_mappings for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
create policy pos_catalog_mappings_insert on public.pos_catalog_mappings for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy pos_catalog_mappings_update on public.pos_catalog_mappings for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER'])) with check(ring_private.has_role(merchant_id,array['OWNER']));
create policy pos_catalog_mappings_delete on public.pos_catalog_mappings for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER']));
grant select,insert,update,delete on public.pos_catalog_mappings to authenticated;
create index pos_catalog_mappings_merchant on public.pos_catalog_mappings(merchant_id);

alter table public.orders enable row level security;
create policy orders_read on public.orders for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER','STAFF']));
grant select on public.orders to authenticated;
create index orders_merchant on public.orders(merchant_id);

alter table public.order_items enable row level security;
create policy order_items_read on public.order_items for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER','STAFF']));
grant select on public.order_items to authenticated;
create index order_items_merchant on public.order_items(merchant_id);

alter table public.order_item_modifiers enable row level security;
create policy order_item_modifiers_read on public.order_item_modifiers for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER','STAFF']));
grant select on public.order_item_modifiers to authenticated;
create index order_item_modifiers_merchant on public.order_item_modifiers(merchant_id);

alter table public.call_sessions enable row level security;
create policy call_sessions_read on public.call_sessions for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER','STAFF']));
grant select on public.call_sessions to authenticated;
create index call_sessions_merchant on public.call_sessions(merchant_id);

alter table public.menu_items enable row level security;
create policy menu_items_read on public.menu_items for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy menu_items_insert on public.menu_items for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy menu_items_update on public.menu_items for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER'])) with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy menu_items_delete on public.menu_items for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select,insert,update,delete on public.menu_items to authenticated;
create index menu_items_merchant on public.menu_items(merchant_id);

alter table public.modifier_groups enable row level security;
create policy modifier_groups_read on public.modifier_groups for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy modifier_groups_insert on public.modifier_groups for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy modifier_groups_update on public.modifier_groups for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER'])) with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy modifier_groups_delete on public.modifier_groups for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select,insert,update,delete on public.modifier_groups to authenticated;
create index modifier_groups_merchant on public.modifier_groups(merchant_id);

alter table public.modifiers enable row level security;
create policy modifiers_read on public.modifiers for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy modifiers_insert on public.modifiers for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy modifiers_update on public.modifiers for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER'])) with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy modifiers_delete on public.modifiers for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select,insert,update,delete on public.modifiers to authenticated;
create index modifiers_merchant on public.modifiers(merchant_id);

alter table public.correction_memories enable row level security;
create policy correction_memories_read on public.correction_memories for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy correction_memories_insert on public.correction_memories for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy correction_memories_update on public.correction_memories for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER'])) with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy correction_memories_delete on public.correction_memories for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select,insert,update,delete on public.correction_memories to authenticated;
create index correction_memories_merchant on public.correction_memories(merchant_id);

alter table public.escalations enable row level security;
create policy escalations_read on public.escalations for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy escalations_insert on public.escalations for insert to authenticated with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy escalations_update on public.escalations for update to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER'])) with check(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
create policy escalations_delete on public.escalations for delete to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select,insert,update,delete on public.escalations to authenticated;
create index escalations_merchant on public.escalations(merchant_id);

alter table public.conversation_turns enable row level security;
create policy conversation_turns_read on public.conversation_turns for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.conversation_turns to authenticated;
create index conversation_turns_merchant on public.conversation_turns(merchant_id);

alter table public.model_health_checks enable row level security;
create policy model_health_checks_read on public.model_health_checks for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.model_health_checks to authenticated;
create index model_health_checks_merchant on public.model_health_checks(merchant_id);

alter table public.interpretation_events enable row level security;
create policy interpretation_events_read on public.interpretation_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.interpretation_events to authenticated;
create index interpretation_events_merchant on public.interpretation_events(merchant_id);

alter table public.correction_memory_events enable row level security;
create policy correction_memory_events_read on public.correction_memory_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.correction_memory_events to authenticated;
create index correction_memory_events_merchant on public.correction_memory_events(merchant_id);

alter table public.memory_usage_events enable row level security;
create policy memory_usage_events_read on public.memory_usage_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.memory_usage_events to authenticated;
create index memory_usage_events_merchant on public.memory_usage_events(merchant_id);

alter table public.payment_events enable row level security;
create policy payment_events_read on public.payment_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.payment_events to authenticated;
create index payment_events_merchant on public.payment_events(merchant_id);

alter table public.pos_sync_events enable row level security;
create policy pos_sync_events_read on public.pos_sync_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.pos_sync_events to authenticated;
create index pos_sync_events_merchant on public.pos_sync_events(merchant_id);

alter table public.audit_events enable row level security;
create policy audit_events_read on public.audit_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.audit_events to authenticated;
create index audit_events_merchant on public.audit_events(merchant_id);

alter table public.integration_events enable row level security;
create policy integration_events_read on public.integration_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.integration_events to authenticated;
create index integration_events_merchant on public.integration_events(merchant_id);

alter table public.analytics_events enable row level security;
create policy analytics_events_read on public.analytics_events for select to authenticated using(ring_private.has_role(merchant_id,array['OWNER','MANAGER']));
grant select on public.analytics_events to authenticated;
create index analytics_events_merchant on public.analytics_events(merchant_id);

grant select,insert,update on public.merchants to authenticated;
grant select,insert,update,delete on public.merchant_users to authenticated;
revoke all on all tables in schema public from anon;
-- Retrieval is SECURITY INVOKER: the caller's membership RLS still applies.
create function public.match_correction_memories(p_merchant_id text,query_embedding extensions.vector(384),match_count integer default 4)
returns table(id text,merchant_id text,observed_text text,corrected_interpretation jsonb,similarity double precision)
language sql stable security invoker set search_path='' as $$
 select m.id,m.merchant_id,m.observed_text,m.corrected_interpretation,
  1-(m.embedding operator(extensions.<=>) query_embedding) as similarity
 from public.correction_memories m
 where m.merchant_id=p_merchant_id and m.active and m.confirmed_by_customer and m.embedding is not null
 order by (1-(m.embedding operator(extensions.<=>) query_embedding))+case when m.merchant_approved then 0.15 else 0 end desc
 limit greatest(0,least(match_count,8));
$$;
revoke all on function public.match_correction_memories(text,extensions.vector,integer) from public,anon;
grant execute on function public.match_correction_memories(text,extensions.vector,integer) to authenticated;
-- Realtime authorization reuses each row's RLS policy.
alter publication supabase_realtime add table public.orders,public.escalations,public.correction_memories;
