-- Editable "total bills" (morning load) for a delivery boy, set from Day End.
--
-- This is kept separate from supplied_cylinders because Day End rewrites
-- supplied_cylinders with the number of bills currently recorded on every
-- save. The target must survive those saves so the roster can still show
-- "45/46 bills" and flag missing bills.
alter table public.staff_cylinder_settlements
  add column if not exists load_target integer;

alter table public.staff_cylinder_settlements
  drop constraint if exists staff_cylinder_settlements_load_target_check;

alter table public.staff_cylinder_settlements
  add constraint staff_cylinder_settlements_load_target_check
  check (load_target is null or load_target >= 0);

comment on column public.staff_cylinder_settlements.load_target is
  'Expected total bills / morning load set from Day End. Null = not set.';

notify pgrst, 'reload schema';
