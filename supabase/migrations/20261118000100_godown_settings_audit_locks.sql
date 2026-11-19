-- Godown settings, automatic day lock, audit trail, and own-only read policies.
--
-- Safe to run more than once. The app falls back gracefully until this is applied.

-- ---------------------------------------------------------------------------
-- 1. Identity helpers
-- ---------------------------------------------------------------------------

create or replace function public.current_agent_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from public.agents a
  where a.id = auth.uid()
     or lower(a.username) = lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1))
  order by (a.id = auth.uid()) desc
  limit 1
$$;

create or replace function public.current_agent_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.name
  from public.agents a
  where a.id = public.current_agent_id()
  limit 1
$$;

create or replace function public.is_staff_or_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
    or lower(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)) in ('john', 'ganesh')
    or exists (
      select 1
      from public.agents a
      where a.id = public.current_agent_id()
        and (
          a.role = 'MANAGER'
          or a.is_staff = true
          or lower(a.username) in ('john', 'ganesh')
        )
    )
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'manager'
    or exists (
      select 1
      from public.agents a
      where a.id = public.current_agent_id()
        and a.role = 'MANAGER'
    )
$$;

grant execute on function public.current_agent_id() to authenticated;
grant execute on function public.current_agent_name() to authenticated;
grant execute on function public.is_staff_or_manager() to authenticated;
grant execute on function public.is_manager() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Shared agency settings (manager-only 14.2kg rate)
-- ---------------------------------------------------------------------------

create table if not exists public.agency_settings (
  id integer primary key default 1,
  cylinder_rate numeric not null default 994 check (cylinder_rate > 0),
  rate_effective_from date not null default current_date,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint agency_settings_singleton check (id = 1)
);

insert into public.agency_settings (id, cylinder_rate, rate_effective_from)
values (1, 994, current_date)
on conflict (id) do nothing;

alter table public.agency_settings enable row level security;

drop policy if exists "agency_settings read" on public.agency_settings;
create policy "agency_settings read"
  on public.agency_settings for select
  to authenticated
  using (true);

drop policy if exists "agency_settings insert manager" on public.agency_settings;
create policy "agency_settings insert manager"
  on public.agency_settings for insert
  to authenticated
  with check (public.is_manager());

drop policy if exists "agency_settings update manager" on public.agency_settings;
create policy "agency_settings update manager"
  on public.agency_settings for update
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- 3. Automatic day unlock records (past dates are locked by default)
-- ---------------------------------------------------------------------------

create table if not exists public.day_unlocks (
  unlock_date date primary key,
  unlocked_by uuid references auth.users(id),
  reason text,
  unlocked_at timestamptz not null default now()
);

alter table public.day_unlocks enable row level security;

drop policy if exists "day_unlocks read" on public.day_unlocks;
create policy "day_unlocks read"
  on public.day_unlocks for select
  to authenticated
  using (true);

drop policy if exists "day_unlocks staff write" on public.day_unlocks;
create policy "day_unlocks staff write"
  on public.day_unlocks for all
  to authenticated
  using (public.is_staff_or_manager())
  with check (public.is_staff_or_manager());

-- ---------------------------------------------------------------------------
-- 4. Audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.godown_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text,
  entity_id text,
  settlement_date date,
  agent_id uuid,
  agent_name text,
  before_data jsonb,
  after_data jsonb,
  changed_by uuid,
  changed_by_name text,
  reason text,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists godown_audit_date_idx on public.godown_audit (settlement_date);
create index if not exists godown_audit_created_idx on public.godown_audit (created_at desc);

alter table public.godown_audit enable row level security;

drop policy if exists "godown_audit staff read" on public.godown_audit;
create policy "godown_audit staff read"
  on public.godown_audit for select
  to authenticated
  using (public.is_staff_or_manager());

drop policy if exists "godown_audit write" on public.godown_audit;
create policy "godown_audit write"
  on public.godown_audit for insert
  to authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 5. Own-only reads / safe writes for settlements and day-end reports
-- ---------------------------------------------------------------------------

alter table public.staff_cylinder_settlements enable row level security;
drop policy if exists "Allow authenticated read/write on staff_cylinder_settlements" on public.staff_cylinder_settlements;

drop policy if exists "settlements read own or staff" on public.staff_cylinder_settlements;
create policy "settlements read own or staff"
  on public.staff_cylinder_settlements for select
  to authenticated
  using (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  );

drop policy if exists "settlements insert own or staff" on public.staff_cylinder_settlements;
create policy "settlements insert own or staff"
  on public.staff_cylinder_settlements for insert
  to authenticated
  with check (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  );

drop policy if exists "settlements update own or staff" on public.staff_cylinder_settlements;
create policy "settlements update own or staff"
  on public.staff_cylinder_settlements for update
  to authenticated
  using (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  )
  with check (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  );

drop policy if exists "settlements delete staff" on public.staff_cylinder_settlements;
create policy "settlements delete staff"
  on public.staff_cylinder_settlements for delete
  to authenticated
  using (public.is_staff_or_manager());

alter table public.day_end_reports enable row level security;
drop policy if exists "Allow authenticated read/write on day_end_reports" on public.day_end_reports;

drop policy if exists "day_end read own or staff" on public.day_end_reports;
create policy "day_end read own or staff"
  on public.day_end_reports for select
  to authenticated
  using (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  );

drop policy if exists "day_end insert own or staff" on public.day_end_reports;
create policy "day_end insert own or staff"
  on public.day_end_reports for insert
  to authenticated
  with check (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  );

drop policy if exists "day_end update own or staff" on public.day_end_reports;
create policy "day_end update own or staff"
  on public.day_end_reports for update
  to authenticated
  using (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  )
  with check (
    public.is_staff_or_manager()
    or agent_id = public.current_agent_id()
    or lower(agent_name) = lower(coalesce(public.current_agent_name(), ''))
  );

drop policy if exists "day_end delete staff" on public.day_end_reports;
create policy "day_end delete staff"
  on public.day_end_reports for delete
  to authenticated
  using (public.is_staff_or_manager());

-- ---------------------------------------------------------------------------
-- 6. Realtime for the shared settings / lock tables
-- ---------------------------------------------------------------------------

do $$
declare
  target_table text;
  target_tables text[] := array['agency_settings', 'day_unlocks'];
begin
  foreach target_table in array target_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end $$;
