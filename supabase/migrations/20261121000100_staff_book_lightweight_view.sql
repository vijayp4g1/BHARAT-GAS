-- Lightweight Staff Book list: same settlement columns, but `notes` contains only
-- the human remarks, not the large scanned-bill / BPCL JSON. The edit form reads
-- the full table row for the one settlement being edited.
create or replace view public.staff_cylinder_settlements_list
with (security_invoker = true)
as
select
  id,
  settlement_date,
  agent_id,
  agent_name,
  cylinder_price,
  supplied_cylinders,
  cash_cylinders,
  online_cylinders,
  upi_cylinders,
  due_cylinders,
  returned_full_cylinders,
  empty_cylinders,
  expected_cash,
  actual_cash,
  cash_difference,
  online_amount,
  upi_amount,
  total_amount,
  status,
  created_at,
  updated_at,
  nullif(
    btrim(
      regexp_replace(
        split_part(
          split_part(coalesce(notes, ''), '__BGCLS_SCANNED_BILLS__', 1),
          '__BGCLS_BPCL_REPORT__',
          1
        ),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  ) as notes
from public.staff_cylinder_settlements;

grant select on public.staff_cylinder_settlements_list to authenticated;

notify pgrst, 'reload schema';
