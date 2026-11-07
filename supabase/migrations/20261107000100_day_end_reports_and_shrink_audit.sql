-- 1. The app has always written to public.day_end_reports, but the table was never
--    created in production. Every primary save silently failed and fell back to the
--    staff_cylinder_settlements.notes JSON blob.
create table if not exists public.day_end_reports (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete set null,
  agent_name text not null,
  report_date date not null default current_date,
  total_deliveries integer not null default 0,
  domestic_14kg integer not null default 0,
  composite_10kg integer not null default 0,
  commercial_19kg integer not null default 0,
  empties_collected integer not null default 0,
  cash_count integer not null default 0,
  upi_count integer not null default 0,
  due_count integer not null default 0,
  entries jsonb not null default '[]'::jsonb,
  raw_csv text,
  supervisor_phone text,
  scanned_by_staff text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint day_end_reports_date_agent_name_key unique (report_date, agent_name)
);

create index if not exists day_end_reports_date_idx
  on public.day_end_reports (report_date);

alter table public.day_end_reports enable row level security;

drop policy if exists "Allow authenticated read/write on day_end_reports" on public.day_end_reports;
create policy "Allow authenticated read/write on day_end_reports"
  on public.day_end_reports
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 2. Helper: count scanned bills stored inside staff_cylinder_settlements.notes
create or replace function public.bgcls_scanned_bill_count(notes text)
returns integer
language plpgsql
immutable
as $$
declare
  raw text;
  parsed jsonb;
begin
  if notes is null or position('__BGCLS_SCANNED_BILLS__' in notes) = 0 then
    return 0;
  end if;
  raw := split_part(notes, '__BGCLS_SCANNED_BILLS__', 2);
  raw := split_part(raw, '__BGCLS_BPCL_REPORT__', 1);
  if btrim(raw) = '' then
    return 0;
  end if;
  parsed := btrim(raw)::jsonb;
  if jsonb_typeof(parsed) = 'array' then
    return jsonb_array_length(parsed);
  end if;
  return 0;
exception when others then
  return 0;
end;
$$;

-- 3. Helper: extract the consumer numbers from the scanned-bill JSON
create or replace function public.bgcls_scanned_bill_numbers(notes text)
returns jsonb
language plpgsql
immutable
as $$
declare
  raw text;
  parsed jsonb;
begin
  if notes is null or position('__BGCLS_SCANNED_BILLS__' in notes) = 0 then
    return '[]'::jsonb;
  end if;
  raw := split_part(notes, '__BGCLS_SCANNED_BILLS__', 2);
  raw := split_part(raw, '__BGCLS_BPCL_REPORT__', 1);
  if btrim(raw) = '' then
    return '[]'::jsonb;
  end if;
  parsed := btrim(raw)::jsonb;
  if jsonb_typeof(parsed) <> 'array' then
    return '[]'::jsonb;
  end if;
  return coalesce(
    (
      select jsonb_agg(coalesce(e ->> 'consumer_number', ''))
      from jsonb_array_elements(parsed) e
      where coalesce(e ->> 'consumer_number', '') <> ''
    ),
    '[]'::jsonb
  );
exception when others then
  return '[]'::jsonb;
end;
$$;

-- 4. Permanent history of every time the bill list shrinks (deletion audit trail)
create table if not exists public.settlement_shrink_history (
  id bigserial primary key,
  settlement_id uuid,
  settlement_date date,
  agent_id uuid,
  agent_name text,
  old_bill_count integer not null default 0,
  new_bill_count integer not null default 0,
  removed_numbers jsonb not null default '[]'::jsonb,
  old_updated_at timestamptz,
  new_updated_at timestamptz,
  detected_at timestamptz not null default now()
);

create index if not exists settlement_shrink_history_date_idx
  on public.settlement_shrink_history (settlement_date, agent_name);

alter table public.settlement_shrink_history enable row level security;

drop policy if exists "Allow authenticated read on settlement_shrink_history" on public.settlement_shrink_history;
create policy "Allow authenticated read on settlement_shrink_history"
  on public.settlement_shrink_history
  for select
  using (auth.role() = 'authenticated');

create or replace function public.log_settlement_shrink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_count integer;
  new_count integer;
  old_numbers jsonb;
  new_numbers jsonb;
  removed jsonb;
begin
  old_count := bgcls_scanned_bill_count(old.notes);
  new_count := bgcls_scanned_bill_count(new.notes);

  if new_count < old_count then
    old_numbers := bgcls_scanned_bill_numbers(old.notes);
    new_numbers := bgcls_scanned_bill_numbers(new.notes);
    select coalesce(jsonb_agg(value), '[]'::jsonb)
      into removed
      from jsonb_array_elements_text(old_numbers) value
      where not (new_numbers ? value);

    insert into public.settlement_shrink_history (
      settlement_id,
      settlement_date,
      agent_id,
      agent_name,
      old_bill_count,
      new_bill_count,
      removed_numbers,
      old_updated_at,
      new_updated_at
    ) values (
      old.id,
      old.settlement_date,
      old.agent_id,
      old.agent_name,
      old_count,
      new_count,
      removed,
      old.updated_at,
      new.updated_at
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_settlement_shrink on public.staff_cylinder_settlements;
create trigger trg_log_settlement_shrink
  after update of notes on public.staff_cylinder_settlements
  for each row
  execute function public.log_settlement_shrink();
