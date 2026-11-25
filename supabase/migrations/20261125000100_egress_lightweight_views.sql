-- Day End egress fix: keep the large JSON blobs on the server.
--
-- The heavy columns are:
--   * staff_cylinder_settlements.notes  (~13.6 KB/row: scanned bills + BPCL JSON)
--   * day_end_reports.entries           (~15 KB/row: the full scanned bill list)
--
-- The roster only needs small aggregates, duplicate-detection numbers and a few
-- BPCL flags, but it used to download every blob for every delivery boy. These
-- views/functions expose just what the UI consumes; Postgres still reads the
-- blob server-side, so only small rows cross the network.
--
-- Safe to run more than once. The client keeps a legacy fallback until this is
-- applied.

-- ---------------------------------------------------------------------------
-- 1. Normalise a consumer number exactly like src/lib/scanUtils.ts numberKey()
-- ---------------------------------------------------------------------------
create or replace function public.bgcls_number_key(raw text)
returns text
language sql
immutable
as $$
  with d as (
    select regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits = '' then ''
    else coalesce(nullif(regexp_replace(digits, '^0+', ''), ''), digits)
  end
  from d;
$$;

-- ---------------------------------------------------------------------------
-- 2. Extract the scanned-bill array from settlement notes
-- ---------------------------------------------------------------------------
create or replace function public.bgcls_scanned_bills(notes text)
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
  if jsonb_typeof(parsed) = 'array' then
    return parsed;
  end if;
  return '[]'::jsonb;
exception when others then
  return '[]'::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Extract only the BPCL report JSON from settlement notes
-- ---------------------------------------------------------------------------
create or replace function public.bgcls_bpcl_report_from_notes(notes text)
returns jsonb
language plpgsql
immutable
as $$
declare
  raw text;
begin
  if notes is null or position('__BGCLS_BPCL_REPORT__' in notes) = 0 then
    return null;
  end if;
  raw := split_part(notes, '__BGCLS_BPCL_REPORT__', 2);
  raw := split_part(raw, '__BGCLS_SCANNED_BILLS__', 1);
  if btrim(raw) = '' then
    return null;
  end if;
  return btrim(raw)::jsonb;
exception when others then
  return null;
end;
$$;

revoke all on function public.bgcls_number_key(text) from public;
revoke all on function public.bgcls_scanned_bills(text) from public;
revoke all on function public.bgcls_bpcl_report_from_notes(text) from public;
revoke all on function public.bgcls_number_key(text) from anon;
revoke all on function public.bgcls_scanned_bills(text) from anon;
revoke all on function public.bgcls_bpcl_report_from_notes(text) from anon;
grant execute on function public.bgcls_number_key(text) to authenticated, service_role;
grant execute on function public.bgcls_scanned_bills(text) to authenticated, service_role;
grant execute on function public.bgcls_bpcl_report_from_notes(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Roster summaries: aggregates + a trimmed entry list (4 fields per bill)
-- ---------------------------------------------------------------------------
create or replace view public.day_end_report_summaries
with (security_invoker = true)
as
select
  r.id,
  r.report_date,
  r.agent_id,
  r.agent_name,
  r.total_deliveries,
  r.domestic_14kg,
  r.composite_10kg,
  r.commercial_19kg,
  r.empties_collected,
  r.cash_count,
  r.upi_count,
  r.due_count,
  r.updated_at,
  r.created_at,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_array(
          e ->> 'consumer_number',
          e ->> 'consumer_name',
          e ->> 'scanned_at',
          e ->> 'duplicate_of_agent'
        )
      )
      from jsonb_array_elements(coalesce(r.entries, '[]'::jsonb)) e
      where coalesce(e ->> 'consumer_number', '') <> ''
    ),
    '[]'::jsonb
  ) as entries_compact
from public.day_end_reports r;

grant select on public.day_end_report_summaries to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Flat claim history (small rows) for 7-day duplicate detection
-- ---------------------------------------------------------------------------
create or replace view public.day_end_claim_history
with (security_invoker = true)
as
select
  r.report_date as settlement_date,
  r.agent_id,
  r.agent_name,
  e ->> 'consumer_number' as consumer_number,
  public.bgcls_number_key(e ->> 'consumer_number') as consumer_key
from public.day_end_reports r
cross join lateral jsonb_array_elements(coalesce(r.entries, '[]'::jsonb)) e
where coalesce(e ->> 'consumer_number', '') <> ''
union all
select
  s.settlement_date,
  s.agent_id,
  s.agent_name,
  e ->> 'consumer_number',
  public.bgcls_number_key(e ->> 'consumer_number')
from public.staff_cylinder_settlements s
cross join lateral jsonb_array_elements(public.bgcls_scanned_bills(s.notes)) e
where s.notes like '%__BGCLS_SCANNED_BILLS__%'
  and coalesce(e ->> 'consumer_number', '') <> '';

grant select on public.day_end_claim_history to authenticated, service_role;

-- Range scans over the claim window.
create index if not exists staff_cylinder_settlements_date_idx
  on public.staff_cylinder_settlements (settlement_date);

-- ---------------------------------------------------------------------------
-- 6. One compact JSON map for the 7-day window.
--
-- A plain select would hit PostgREST's 1000-row cap and need ~8 paginated
-- requests. Returning a single jsonb object is one small response:
--   { "<consumer_key>": { "a": "<agent name>", "d": "YYYY-MM-DD" } }
-- Only the latest claim per consumer is kept, matching the old client logic.
-- ---------------------------------------------------------------------------
create or replace function public.bgcls_claim_map(p_start date, p_end date)
returns jsonb
language sql
stable
as $$
  with claims as (
    select
      settlement_date,
      agent_name,
      consumer_key
    from public.day_end_claim_history
    where settlement_date >= p_start
      and settlement_date <= p_end
      and consumer_key <> ''
  ),
  latest as (
    select distinct on (consumer_key)
      consumer_key,
      agent_name,
      settlement_date
    from claims
    order by consumer_key, settlement_date desc
  )
  select coalesce(
    jsonb_object_agg(
      consumer_key,
      jsonb_build_object('a', agent_name, 'd', settlement_date)
    ),
    '{}'::jsonb
  )
  from latest;
$$;

revoke all on function public.bgcls_claim_map(date, date) from public;
revoke all on function public.bgcls_claim_map(date, date) from anon;
grant execute on function public.bgcls_claim_map(date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. BPCL-only view: the BPCL JSON without the scanned-bill blob
-- ---------------------------------------------------------------------------
create or replace view public.staff_cylinder_settlements_bpcl
with (security_invoker = true)
as
select
  id,
  settlement_date,
  agent_id,
  agent_name,
  updated_at,
  public.bgcls_bpcl_report_from_notes(notes) as bpcl_report
from public.staff_cylinder_settlements
where notes like '%__BGCLS_BPCL_REPORT__%';

grant select on public.staff_cylinder_settlements_bpcl to authenticated, service_role;

-- Supabase's default privileges grant ALL on new objects to anon/authenticated.
-- These views expose staff data and are read-only: remove anon entirely and the
-- write privileges from authenticated.
revoke all on public.day_end_report_summaries from anon;
revoke all on public.day_end_claim_history from anon;
revoke all on public.staff_cylinder_settlements_bpcl from anon;
revoke insert, update, delete, truncate on public.day_end_report_summaries from authenticated;
revoke insert, update, delete, truncate on public.day_end_claim_history from authenticated;
revoke insert, update, delete, truncate on public.staff_cylinder_settlements_bpcl from authenticated;

notify pgrst, 'reload schema';
