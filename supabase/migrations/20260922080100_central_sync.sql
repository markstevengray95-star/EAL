-- EAL Progress Hub: central sync versioning + normalised core tables
-- Apply after supabase/schema.sql.

alter table public.app_snapshots
  add column if not exists revision bigint not null default 0;

create table if not exists public.central_audit_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  revision bigint,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.students_core (
  school_id uuid not null references public.schools(id) on delete cascade,
  app_student_id text not null,
  external_id text,
  name text not null,
  preferred_name text,
  dob date,
  year_group text,
  form_group text,
  admission_date date,
  first_language text,
  attendance_percent numeric(5,2),
  archived boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (school_id, app_student_id)
);

create unique index if not exists students_core_external_id_unique
  on public.students_core(school_id, external_id)
  where external_id is not null and external_id <> '';

create table if not exists public.integration_connections (
  school_id uuid not null references public.schools(id) on delete cascade,
  integration_kind text not null check (integration_kind in ('storage','mis','auth','other')),
  provider text not null,
  status text not null default 'configured',
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (school_id, integration_kind, provider)
);

alter table public.central_audit_log enable row level security;
alter table public.students_core enable row level security;
alter table public.integration_connections enable row level security;

drop policy if exists central_audit_member_select on public.central_audit_log;
create policy central_audit_member_select on public.central_audit_log for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=central_audit_log.school_id and m.user_id=auth.uid()
));

drop policy if exists students_core_member_select on public.students_core;
create policy students_core_member_select on public.students_core for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=students_core.school_id and m.user_id=auth.uid()
));

drop policy if exists integration_member_select on public.integration_connections;
create policy integration_member_select on public.integration_connections for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=integration_connections.school_id and m.user_id=auth.uid()
));

-- Atomic compare-and-swap save. Called only from the service-role Edge Function.
create or replace function public.save_app_snapshot(
  p_school_id uuid,
  p_state_data jsonb,
  p_expected_revision bigint,
  p_updated_by uuid
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_revision bigint;
  v_updated_at timestamptz;
begin
  update public.app_snapshots
  set state_data=p_state_data,
      revision=app_snapshots.revision+1,
      updated_by=p_updated_by,
      updated_at=now()
  where school_id=p_school_id
    and revision=p_expected_revision
  returning app_snapshots.revision, app_snapshots.updated_at
    into v_revision, v_updated_at;

  if found then
    revision:=v_revision;
    updated_at:=v_updated_at;
    return next;
    return;
  end if;

  if p_expected_revision=0 and not exists (
    select 1 from public.app_snapshots where school_id=p_school_id
  ) then
    insert into public.app_snapshots(school_id,state_data,revision,updated_by,updated_at)
    values (p_school_id,p_state_data,1,p_updated_by,now())
    returning app_snapshots.revision, app_snapshots.updated_at
      into v_revision, v_updated_at;
    revision:=v_revision;
    updated_at:=v_updated_at;
    return next;
    return;
  end if;

  return;
end;
$$;

revoke all on function public.save_app_snapshot(uuid,jsonb,bigint,uuid) from public;
grant execute on function public.save_app_snapshot(uuid,jsonb,bigint,uuid) to service_role;
