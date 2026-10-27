-- Optional running Supabase JSON-state repository plus service-only scoped RPC.
-- Append to the normalized schema; no previous migration is changed.
create table ring_private.app_state (
 merchant_id text primary key references public.merchants(id),revision bigint not null default 0,
 payload jsonb not null,updated_at timestamptz not null default now(),
 check(payload->'merchant'->>'id'=merchant_id)
);
create table ring_private.processed_events (
 event_id text primary key,merchant_id text not null references public.merchants(id),
 provider text not null,event_type text not null,created_at timestamptz not null default now()
);
create table ring_private.merchant_invitations (
 id text primary key,merchant_id text not null references public.merchants(id),token_hash text not null unique,
 email text not null,name text not null,role text not null check(role in ('MANAGER','STAFF')),
 expires_at timestamptz not null,created_at timestamptz not null default now(),accepted_by text,accepted_at timestamptz
);
alter table ring_private.app_state enable row level security;
alter table ring_private.processed_events enable row level security;
alter table ring_private.merchant_invitations enable row level security;
revoke all on ring_private.app_state,ring_private.processed_events,ring_private.merchant_invitations from public,anon,authenticated;

create function public.ring_load_state(p_merchant_id text,p_subject text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('state',s.payload,'revision',s.revision)
 from ring_private.app_state s join public.merchants m on m.id=s.merchant_id
 where s.merchant_id=p_merchant_id and nullif(p_subject,'') is not null and (
 m.owner_user_id=p_subject or exists(select 1 from public.merchant_users u where u.merchant_id=m.id and u.user_id=p_subject));
$$;
create function public.ring_load_trusted_state(p_merchant_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('state',payload,'revision',revision) from ring_private.app_state where merchant_id=p_merchant_id;
$$;
create function public.ring_create_state(p_merchant_id text,p_subject text,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if nullif(p_subject,'') is null or p_payload->'merchant'->>'id' is distinct from p_merchant_id then raise exception 'Invalid merchant identity';end if;
 insert into public.merchants(id,owner_user_id,name) values(p_merchant_id,p_subject,p_payload->'merchant'->>'name') on conflict(id) do nothing;
 if not exists(select 1 from public.merchants where id=p_merchant_id and owner_user_id=p_subject) then raise exception 'Merchant ownership mismatch';end if;
 insert into ring_private.app_state(merchant_id,payload) values(p_merchant_id,p_payload) on conflict(merchant_id) do nothing;
 return true;
end;
$$;
create function public.ring_save_state(p_merchant_id text,p_subject text,p_revision bigint,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if nullif(p_subject,'') is null or p_payload->'merchant'->>'id' is distinct from p_merchant_id then return false;end if;
 update ring_private.app_state s set payload=p_payload,revision=s.revision+1,updated_at=now()
 where s.merchant_id=p_merchant_id and s.revision=p_revision and exists(
 select 1 from public.merchants m where m.id=s.merchant_id and (m.owner_user_id=p_subject or exists(select 1 from public.merchant_users u where u.merchant_id=m.id and u.user_id=p_subject)));
 get diagnostics changed=row_count;return changed=1;
end;
$$;
create function public.ring_save_trusted_state(p_merchant_id text,p_revision bigint,p_payload jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 if p_payload->'merchant'->>'id' is distinct from p_merchant_id then return false;end if;
 update ring_private.app_state set payload=p_payload,revision=revision+1,updated_at=now() where merchant_id=p_merchant_id and revision=p_revision;
 get diagnostics changed=row_count;return changed=1;
end;
$$;
create function public.ring_has_event(p_event_id text) returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from ring_private.processed_events where event_id=p_event_id); $$;
create function public.ring_record_event(p_event_id text,p_merchant_id text,p_provider text,p_event_type text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 insert into ring_private.processed_events(event_id,merchant_id,provider,event_type) values(p_event_id,p_merchant_id,p_provider,p_event_type) on conflict(event_id) do nothing;return true;
end;
$$;
create function public.ring_memberships(p_subject text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(rows)),'[]'::jsonb) from (
 select m.id as merchant_id,p_subject as subject,'' as email,m.name,'OWNER' as role from public.merchants m where m.owner_user_id=p_subject and nullif(p_subject,'') is not null
 union all select u.merchant_id,p_subject as subject,'' as email,m.name,u.role from public.merchant_users u join public.merchants m on m.id=u.merchant_id where u.user_id=p_subject and m.owner_user_id<>p_subject
 )rows;
$$;
create function public.ring_create_invitation(p_invitation jsonb,p_owner_subject text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.merchants where id=p_invitation->>'merchant_id' and owner_user_id=p_owner_subject) then raise exception 'Owner permission required';end if;
 insert into ring_private.merchant_invitations(id,merchant_id,token_hash,email,name,role,expires_at)
 values(p_invitation->>'id',p_invitation->>'merchant_id',p_invitation->>'token_hash',lower(p_invitation->>'email'),p_invitation->>'name',p_invitation->>'role',(p_invitation->>'expires_at')::timestamptz);
 return true;
end;
$$;
create function public.ring_get_invitation(p_hash text) returns jsonb
language sql stable security definer set search_path='' as $$ select to_jsonb(i) from ring_private.merchant_invitations i where token_hash=p_hash; $$;
create function public.ring_accept_invitation(p_hash text,p_subject text,p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare invite ring_private.merchant_invitations%rowtype;
begin
 if nullif(p_subject,'') is null or nullif(p_email,'') is null then return null;end if;
 select * into invite from ring_private.merchant_invitations where token_hash=p_hash for update;
 if not found or invite.accepted_by is not null or invite.expires_at<=now() or lower(invite.email)<>lower(p_email) then return null;end if;
 update ring_private.merchant_invitations set accepted_by=p_subject,accepted_at=now() where id=invite.id returning * into invite;
 insert into public.merchant_users(merchant_id,user_id,role) values(invite.merchant_id,p_subject,invite.role)
 on conflict(merchant_id,user_id) do update set role=excluded.role where merchant_users.role<>'OWNER';
 return to_jsonb(invite);
end;
$$;
-- Service-only execution. Browser authenticated/anonymous roles cannot call any runtime RPC.
revoke all on function public.ring_load_state(text,text),public.ring_load_trusted_state(text),public.ring_create_state(text,text,jsonb),public.ring_save_state(text,text,bigint,jsonb),public.ring_save_trusted_state(text,bigint,jsonb),public.ring_has_event(text),public.ring_record_event(text,text,text,text),public.ring_memberships(text),public.ring_create_invitation(jsonb,text),public.ring_get_invitation(text),public.ring_accept_invitation(text,text,text) from public,anon,authenticated;
grant execute on function public.ring_load_state(text,text),public.ring_load_trusted_state(text),public.ring_create_state(text,text,jsonb),public.ring_save_state(text,text,bigint,jsonb),public.ring_save_trusted_state(text,bigint,jsonb),public.ring_has_event(text),public.ring_record_event(text,text,text,text),public.ring_memberships(text),public.ring_create_invitation(jsonb,text),public.ring_get_invitation(text),public.ring_accept_invitation(text,text,text) to service_role;
