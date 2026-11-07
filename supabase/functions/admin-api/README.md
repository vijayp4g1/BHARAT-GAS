# admin-api (Supabase Edge Function)

Narrow, authenticated gateway for the database operations that used to run in
the browser with the `service_role` key.

The service key is injected by Supabase into the function runtime as
`SUPABASE_SERVICE_ROLE_KEY`. It must **never** be exposed as a `VITE_*`
variable or added to Vercel.

## Authorization model

| Caller | Can do |
| --- | --- |
| Any signed-in user | read `agents`, `audit_logs`, `agent_locations` |
| Staff (`agents.is_staff = true` or manager) | read day-end / settlement / dispatch / customer tables; write `day_end_reports`, `staff_cylinder_settlements`, `dispatch_items`; create agents; assign delivery boys |
| Manager (`app_metadata.role = 'manager'` or `agents.role = 'MANAGER'`) | everything staff can do, plus change `agents.is_staff` / `agents.role` and create manager accounts |

Authorization is computed inside the function from fresh database data on every
request. There is no generic SQL passthrough and no access to `auth.users` lists.

## Actions

- `me` — returns the caller's server-verified identity/permissions
- `select` / `insert` / `update` / `delete` — allowlisted tables only
- `create_agent` — creates an auth user + `agents` row (rolls back on failure)
- `assign_delivery_boy` — updates auth user metadata + appends an audit row

## Deploy

```bash
npx supabase login
npx supabase link --project-ref skkebmqxhrtarpfwffgx
npx supabase functions deploy admin-api
```

Do this **before** deploying the frontend that no longer contains the service
key, otherwise staff screens will show permission errors until the function is
live.

## Local development (optional)

```bash
npx supabase functions serve admin-api --env-file ./.env.local
```

For local serving, the function runtime still needs `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in the environment (the CLI provides the local
service key automatically when running the local stack).
