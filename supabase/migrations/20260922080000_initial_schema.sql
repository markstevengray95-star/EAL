-- EAL Progress Hub central database schema for Supabase/Postgres
-- Run in the Supabase SQL editor for the school project.

create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.school_memberships (
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'teacher' check (role in ('administrator','eal_coordinator','teacher','senior_leadership','read_only')),
  created_at timestamptz not null default now(),
  primary key (school_id,user_id)
);

create table if not exists public.app_snapshots (
  school_id uuid primary key references public.schools(id) on delete cascade,
  state_data jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.evidence_files (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id text not null,
  provider text not null check (provider in ('Google Drive','OneDrive')),
  provider_file_id text,
  file_name text not null,
  mime_type text,
  storage_path text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.integration_sync_log (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  integration text not null,
  status text not null,
  summary jsonb not null default '{}'::jsonb,
  run_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.schools enable row level security;
alter table public.school_memberships enable row level security;
alter table public.app_snapshots enable row level security;
alter table public.evidence_files enable row level security;
alter table public.integration_sync_log enable row level security;

drop policy if exists schools_member_select on public.schools;
create policy schools_member_select on public.schools for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=schools.id and m.user_id=auth.uid()
));

drop policy if exists membership_self_select on public.school_memberships;
create policy membership_self_select on public.school_memberships for select
using (
  user_id=auth.uid()
  or exists (
    select 1 from public.school_memberships me
    where me.school_id=school_memberships.school_id
      and me.user_id=auth.uid()
      and me.role in ('administrator','eal_coordinator')
  )
);

drop policy if exists snapshot_member_select on public.app_snapshots;
create policy snapshot_member_select on public.app_snapshots for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=app_snapshots.school_id and m.user_id=auth.uid()
));

drop policy if exists snapshot_member_insert on public.app_snapshots;
create policy snapshot_member_insert on public.app_snapshots for insert
with check (exists (
  select 1 from public.school_memberships m
  where m.school_id=app_snapshots.school_id
    and m.user_id=auth.uid()
    and m.role in ('administrator','eal_coordinator')
));

drop policy if exists snapshot_member_update on public.app_snapshots;
create policy snapshot_member_update on public.app_snapshots for update
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=app_snapshots.school_id
    and m.user_id=auth.uid()
    and m.role in ('administrator','eal_coordinator','teacher')
))
with check (exists (
  select 1 from public.school_memberships m
  where m.school_id=app_snapshots.school_id
    and m.user_id=auth.uid()
    and m.role in ('administrator','eal_coordinator','teacher')
));

drop policy if exists evidence_member_select on public.evidence_files;
create policy evidence_member_select on public.evidence_files for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=evidence_files.school_id and m.user_id=auth.uid()
));

drop policy if exists evidence_editor_insert on public.evidence_files;
create policy evidence_editor_insert on public.evidence_files for insert
with check (exists (
  select 1 from public.school_memberships m
  where m.school_id=evidence_files.school_id
    and m.user_id=auth.uid()
    and m.role in ('administrator','eal_coordinator','teacher')
));

drop policy if exists sync_log_member_select on public.integration_sync_log;
create policy sync_log_member_select on public.integration_sync_log for select
using (exists (
  select 1 from public.school_memberships m
  where m.school_id=integration_sync_log.school_id and m.user_id=auth.uid()
));

-- Bootstrap example (replace values after the first school admin has signed in):
-- insert into public.schools(name) values ('Your School') returning id;
-- insert into public.school_memberships(school_id,user_id,role)
-- values ('SCHOOL_UUID','AUTH_USER_UUID','administrator');
