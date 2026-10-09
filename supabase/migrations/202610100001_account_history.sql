begin;

create table public.practice_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 250000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index practice_sessions_owner_created on public.practice_sessions (user_id, created_at desc, id);
alter table public.practice_sessions enable row level security;
create policy "Read own sessions" on public.practice_sessions for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.practice_sessions from anon, authenticated;
grant select on public.practice_sessions to authenticated;

-- Writes go through compare-and-swap, preventing silent overwrites between devices.
create function public.save_practice_session(session_id uuid, session_payload jsonb, expected_version bigint, expected_owner uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); new_version bigint;
begin
  if owner_id is null or owner_id <> expected_owner then raise exception 'Authentication required' using errcode = '42501'; end if;
  if expected_version < 0 or session_payload->>'id' is distinct from session_id::text
    or jsonb_typeof(session_payload->'config') is distinct from 'object'
    or jsonb_typeof(session_payload->'challenge') is distinct from 'object'
    or jsonb_typeof(session_payload->'answer') is distinct from 'string'
    or jsonb_typeof(session_payload->'startedAt') is distinct from 'number'
    or jsonb_typeof(session_payload->'deadline') is distinct from 'number'
    or char_length(session_payload->>'answer') > 16000 then
    raise exception 'Invalid session' using errcode = '22023';
  end if;
  if expected_version = 0 then
    insert into public.practice_sessions (user_id, id, payload) values (owner_id, session_id, session_payload) returning version into new_version;
  else
    update public.practice_sessions set payload = session_payload, version = version + 1, updated_at = now()
      where user_id = owner_id and id = session_id and version = expected_version returning version into new_version;
    if new_version is null then raise exception 'Session changed on another device' using errcode = 'P0001'; end if;
  end if;
  return new_version;
end;
$$;
revoke all on function public.save_practice_session(uuid,jsonb,bigint,uuid) from public, anon;
grant execute on function public.save_practice_session(uuid,jsonb,bigint,uuid) to authenticated;

create table public.login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, auth_session_id)
);
create index login_events_owner_created on public.login_events (user_id, created_at desc);
alter table public.login_events enable row level security;
create policy "Read own login events" on public.login_events for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.login_events from anon, authenticated;
grant select on public.login_events to authenticated;

-- Record authenticated sessions with server timestamps, deduplicated across refreshes.
create function public.record_login(expected_owner uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid(); session_id uuid := (auth.jwt()->>'session_id')::uuid;
begin
  if owner_id is null or owner_id <> expected_owner or session_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.login_events(user_id, auth_session_id) values(owner_id, session_id) on conflict (user_id, auth_session_id) do nothing;
end;
$$;
revoke all on function public.record_login(uuid) from public, anon;
grant execute on function public.record_login(uuid) to authenticated;
commit;
