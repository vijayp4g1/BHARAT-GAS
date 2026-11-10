-- Enable Realtime for the tables whose changes the app already subscribes to.
--
-- Several screens call `supabase.channel(...).on('postgres_changes', ...)`, but
-- only `agent_locations` was ever added to the `supabase_realtime` publication.
-- Without these entries those listeners never fire, so other devices only saw
-- updates after a manual refresh.
--
-- Safe to re-run: each table is added only when it is not already a member.

do $$
declare
  target_table text;
  target_tables text[] := array[
    'staff_cylinder_settlements',
    'consumer_locations',
    'consumer_photos'
  ];
begin
  foreach target_table in array target_tables loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = target_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        target_table
      );
    end if;
  end loop;
end $$;
