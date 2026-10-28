-- One-time, server-only Sites D1 -> Supabase cutover. Source reads remain on D1.
-- Apply as one transaction; a completed marker makes ambiguous network retries safe.
create table ring_private.storage_cutovers (
 id text primary key check(id='sites-d1-v1'),
 counts jsonb not null,
 completed_at timestamptz not null default now()
);
alter table ring_private.storage_cutovers enable row level security;
revoke all on ring_private.storage_cutovers from public,anon,authenticated;

-- Preserve imported membership metadata without replacing Supabase's UUID identity.
alter table public.merchant_users
 add column source_id text,
 add column email text not null default '',
 add column name text not null default '';
create unique index merchant_users_source_id on public.merchant_users(source_id) where source_id is not null;

create or replace function public.ring_memberships(p_subject text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) from (
 select m.id as merchant_id,p_subject as subject,'' as email,m.name,'OWNER' as role
 from public.merchants m where m.owner_user_id=p_subject and nullif(p_subject,'') is not null
 union all
 select u.merchant_id,p_subject as subject,u.email,m.name,u.role
 from public.merchant_users u join public.merchants m on m.id=u.merchant_id
 where u.user_id=p_subject and m.owner_user_id<>p_subject
 )rows;
$$;

create function public.ring_d1_cutover_status() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from ring_private.storage_cutovers where id='sites-d1-v1');
$$;

create function public.ring_import_d1_snapshot(p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 collection text;
 imported_counts jsonb;
begin
 -- Serialize concurrent first requests; transaction rollback also releases this lock.
 perform pg_advisory_xact_lock(726464315731::bigint);
 select counts into imported_counts from ring_private.storage_cutovers where id='sites-d1-v1';
 if found then
   return jsonb_build_object('completed',true,'already_imported',true,'counts',imported_counts);
 end if;
 if jsonb_typeof(p_snapshot) is distinct from 'object'
   or p_snapshot->>'source' is distinct from 'sites-d1-v1' then
   raise exception 'Invalid D1 cutover snapshot';
 end if;
 foreach collection in array array['merchants','tenant_state','merchant_memberships','merchant_invitations','integration_events'] loop
   if jsonb_typeof(p_snapshot->collection) is distinct from 'array' then
     raise exception 'Incomplete D1 cutover snapshot';
   end if;
 end loop;

 -- Existing destination rows are never overwritten, even when the owner matches.
 if exists(
   select 1 from public.merchants m
   join jsonb_array_elements(p_snapshot->'merchants') source on m.id=source->>'id'
 ) then
   raise exception 'D1 cutover destination conflict';
 end if;

 if jsonb_array_length(p_snapshot->'merchants')<>jsonb_array_length(p_snapshot->'tenant_state')
 or exists(
   select 1 from jsonb_array_elements(p_snapshot->'merchants') m
   where not exists(select 1 from jsonb_array_elements(p_snapshot->'tenant_state') s where s->>'merchant_id'=m->>'id')
 )
 or exists(
   select 1 from jsonb_array_elements(p_snapshot->'tenant_state') s
   where jsonb_typeof(s->'payload') is distinct from 'object'
      or s->'payload'->'merchant'->>'id' is distinct from s->>'merchant_id'
      or not exists(select 1 from jsonb_array_elements(p_snapshot->'merchants') m where m->>'id'=s->>'merchant_id')
 ) then
   raise exception 'Inconsistent D1 cutover snapshot';
 end if;

 insert into public.merchants(id,owner_user_id,name,currency,timezone,created_at)
 select m.id,m.owner_user_id,m.name,
   coalesce(nullif(s.payload->'merchant'->>'currency',''),'MXN'),
   coalesce(nullif(s.payload->'merchant'->>'timezone',''),'America/Mexico_City'),
   m.created_at
 from jsonb_to_recordset(p_snapshot->'merchants')
   as m(id text,owner_user_id text,name text,created_at timestamptz)
 join jsonb_to_recordset(p_snapshot->'tenant_state')
   as s(merchant_id text,payload jsonb) on s.merchant_id=m.id;

 insert into ring_private.app_state(merchant_id,revision,payload,updated_at)
 select merchant_id,revision,payload,updated_at
 from jsonb_to_recordset(p_snapshot->'tenant_state')
   as s(merchant_id text,revision bigint,payload jsonb,updated_at timestamptz);
 if exists(select 1 from ring_private.app_state s join jsonb_array_elements(p_snapshot->'tenant_state') i on s.merchant_id=i->>'merchant_id' where s.revision<0) then
   raise exception 'Invalid D1 cutover revision';
 end if;

 insert into public.merchant_users(merchant_id,user_id,role,created_at,source_id,email,name)
 select merchant_id,user_subject,role,created_at,id,email,name
 from jsonb_to_recordset(p_snapshot->'merchant_memberships')
   as u(id text,merchant_id text,user_subject text,email text,name text,role text,created_at timestamptz);

 insert into ring_private.merchant_invitations(id,merchant_id,token_hash,email,name,role,expires_at,created_at,accepted_by,accepted_at)
 select id,merchant_id,token_hash,email,name,role,expires_at,created_at,accepted_by,accepted_at
 from jsonb_to_recordset(p_snapshot->'merchant_invitations')
   as i(id text,merchant_id text,token_hash text,email text,name text,role text,expires_at timestamptz,created_at timestamptz,accepted_by text,accepted_at timestamptz);

 insert into ring_private.processed_events(event_id,merchant_id,provider,event_type,created_at)
 select id,merchant_id,provider,event_type,created_at
 from jsonb_to_recordset(p_snapshot->'integration_events')
   as e(id text,merchant_id text,provider text,event_type text,created_at timestamptz);

 imported_counts=jsonb_build_object(
   'merchants',jsonb_array_length(p_snapshot->'merchants'),
   'tenant_state',jsonb_array_length(p_snapshot->'tenant_state'),
   'merchant_memberships',jsonb_array_length(p_snapshot->'merchant_memberships'),
   'merchant_invitations',jsonb_array_length(p_snapshot->'merchant_invitations'),
   'integration_events',jsonb_array_length(p_snapshot->'integration_events')
 );
 insert into ring_private.storage_cutovers(id,counts) values('sites-d1-v1',imported_counts);
 return jsonb_build_object('completed',true,'already_imported',false,'counts',imported_counts);
end;
$$;
revoke all on function public.ring_d1_cutover_status(),public.ring_import_d1_snapshot(jsonb),public.ring_memberships(text) from public,anon,authenticated;
grant execute on function public.ring_d1_cutover_status(),public.ring_import_d1_snapshot(jsonb),public.ring_memberships(text) to service_role;

-- FK lookups used by normalized storage and the runtime event/invitation tables.
create index modifiers_group_fk on public.modifiers(merchant_id,group_id);
create index order_items_order_fk on public.order_items(merchant_id,order_id);
create index order_items_catalog_fk on public.order_items(merchant_id,catalog_item_id);
create index order_item_modifiers_item_fk on public.order_item_modifiers(merchant_id,item_id);
create index order_item_modifiers_modifier_fk on public.order_item_modifiers(merchant_id,modifier_id);
create index call_sessions_order_fk on public.call_sessions(merchant_id,order_id);
create index conversation_turns_session_fk on public.conversation_turns(merchant_id,session_id);
create index escalations_order_fk on public.escalations(merchant_id,order_id);
create index runtime_invitations_merchant_fk on ring_private.merchant_invitations(merchant_id);
create index runtime_events_merchant_fk on ring_private.processed_events(merchant_id);

-- Cache row-independent JWT lookups without changing ownership predicates.
alter policy merchants_create on public.merchants with check(
 owner_user_id=((select auth.jwt())->>'sub')
 and nullif((select auth.jwt())->>'sub','') is not null
);
alter policy merchants_update on public.merchants
 using(owner_user_id=((select auth.jwt())->>'sub'))
 with check(owner_user_id=((select auth.jwt())->>'sub'));
alter policy users_read on public.merchant_users using(
 ring_private.has_role(merchant_id,array['OWNER','MANAGER'])
 or user_id=((select auth.jwt())->>'sub')
);
