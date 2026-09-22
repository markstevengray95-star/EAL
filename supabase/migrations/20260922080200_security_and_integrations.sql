-- EAL Progress Hub: production RLS helpers and integration indexes.
-- Apply after schema.sql and 003_central_sync.sql.

create or replace function public.is_school_member(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1 from public.school_memberships
    where school_id=p_school_id and user_id=auth.uid()
  );
$$;

create or replace function public.has_school_role(p_school_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1 from public.school_memberships
    where school_id=p_school_id and user_id=auth.uid() and role=any(p_roles)
  );
$$;

revoke all on function public.is_school_member(uuid) from public;
revoke all on function public.has_school_role(uuid,text[]) from public;
grant execute on function public.is_school_member(uuid) to authenticated, service_role;
grant execute on function public.has_school_role(uuid,text[]) to authenticated, service_role;

drop policy if exists schools_member_select on public.schools;
create policy schools_member_select on public.schools for select
using (public.is_school_member(id));

drop policy if exists membership_self_select on public.school_memberships;
create policy membership_self_select on public.school_memberships for select
using (
  user_id=auth.uid()
  or public.has_school_role(school_id,array['administrator','eal_coordinator'])
);

drop policy if exists snapshot_member_select on public.app_snapshots;
create policy snapshot_member_select on public.app_snapshots for select
using (public.is_school_member(school_id));

drop policy if exists snapshot_member_insert on public.app_snapshots;
create policy snapshot_member_insert on public.app_snapshots for insert
with check (public.has_school_role(school_id,array['administrator','eal_coordinator']));

drop policy if exists snapshot_member_update on public.app_snapshots;
create policy snapshot_member_update on public.app_snapshots for update
using (public.has_school_role(school_id,array['administrator','eal_coordinator','teacher']))
with check (public.has_school_role(school_id,array['administrator','eal_coordinator','teacher']));

drop policy if exists evidence_member_select on public.evidence_files;
create policy evidence_member_select on public.evidence_files for select
using (public.is_school_member(school_id));

drop policy if exists evidence_editor_insert on public.evidence_files;
create policy evidence_editor_insert on public.evidence_files for insert
with check (public.has_school_role(school_id,array['administrator','eal_coordinator','teacher']));

drop policy if exists sync_log_member_select on public.integration_sync_log;
create policy sync_log_member_select on public.integration_sync_log for select
using (public.is_school_member(school_id));

drop policy if exists central_audit_member_select on public.central_audit_log;
create policy central_audit_member_select on public.central_audit_log for select
using (public.is_school_member(school_id));

drop policy if exists students_core_member_select on public.students_core;
create policy students_core_member_select on public.students_core for select
using (public.is_school_member(school_id));

drop policy if exists integration_member_select on public.integration_connections;
create policy integration_member_select on public.integration_connections for select
using (public.is_school_member(school_id));

create unique index if not exists evidence_provider_file_unique
  on public.evidence_files(school_id,student_id,provider,provider_file_id)
  where provider_file_id is not null and provider_file_id <> '';

create index if not exists integration_sync_log_school_created_idx
  on public.integration_sync_log(school_id,created_at desc);

create index if not exists students_core_school_name_idx
  on public.students_core(school_id,name);
