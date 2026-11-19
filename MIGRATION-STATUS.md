# Supabase Migration Status (BHARATHGAS → BHARATHGAS-2)

**Last updated:** 2026-11-19  
**Status:** Database/auth/functions/app migration complete. **Old photo files are pending until 2026-12-16.**

> **If you are an AI agent or developer reading this before touching Supabase, auth, storage, or deployment:**  
> The app now uses a **new Supabase project**. The old project is restricted and its Storage API/S3 return **HTTP 402**. Do **not** point the app back to the old project. Do **not** delete the old project until the photo copy below is completed.

---

## 1. Projects

| | Old (restricted) | New (active) |
|---|---|---|
| Project ref | `skkebmqxhrtarpfwffgx` | `zdipbxhgjhxfslpoizkj` |
| URL | `https://skkebmqxhrtarpfwffgx.supabase.co` | `https://zdipbxhgjhxfslpoizkj.supabase.co` |
| Name | BHARATHGAS | BHARATHGAS-2 |
| Region | — | Southeast Asia (Singapore) |
| Plan | Free — **116% egress, restricted** | Free — fresh quota |
| CLI linked | no | yes (`supabase/.temp/project-ref`) |

The old project is restricted because Free-plan **egress reached 5.781 GB / 5 GB**. It clears at the start of the next billing cycle (**2026-12-16**) or immediately on upgrade. This is not a device-storage or code problem.

### Root cause of the egress spike (already fixed)

`pullLatestCloudData()` downloaded the full `consumer_locations`, `consumer_photos`, and `manager_consumer_summary` tables **on every device every 60 seconds** just to reconcile two boolean flags. Fixed in commit `0bd79ba`:

- full scans removed (incremental pulls already set the flags),
- interval changed 60s → 5 minutes,
- column-limited selects added.

Do not reintroduce full-table scans on an interval.

---

## 2. What was migrated (verified)

| Item | Count |
|---|---:|
| Consumers | 33,612 |
| Agents | 25 |
| Auth users | 27 |
| Settlements (`staff_cylinder_settlements`) | 279 |
| Day-end reports | 167 |
| Delivery notes | 212 |
| Audit logs | 41 |
| Dispatch items | 158 |
| Storage metadata rows (`consumer-photos`) | 1,412 |

Also migrated/applied:

- Public schema: tables, views, functions, triggers, constraints.
- RLS policies (33 public policies).
- Auth users, identities and **original bcrypt password hashes** (all 27 confirmed).
- Godown migration `20261118000100_godown_settings_audit_locks.sql`:
  - `agency_settings` (rate ₹994),
  - `day_unlocks`,
  - `godown_audit`,
  - own-only RLS policies.
- Edge Functions deployed: `admin-api`, `create-agent`.
- Realtime publication includes: `agency_settings`, `agent_locations`, `consumer_locations`, `consumer_photos`, `day_unlocks`, `staff_cylinder_settlements`.
- Migration history repaired for:
  - `20261107000100`
  - `20261110000100`
  - `20261118000100`
- Storage bucket `consumer-photos` is public.
- Storage policies recreated (authenticated INSERT/UPDATE/DELETE/SELECT on `consumer-photos`).
- Photo URLs in `consumer_photos.photo_url` rewritten to the new host (1,307 rows).

### App / deployment

| Item | Value |
|---|---|
| Vercel project | `vijay-s-projects7/bharat-gas` |
| Production alias | `https://bharat-gas-two.vercel.app` |
| Latest CLI deployment (at time of writing) | `bharat-p81adi5k9-vijay-s-projects7.vercel.app` |
| Env updated (Production/Preview/Development) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| Bundle verified | contains new URL + new anon key, **no** old URL |

Relevant commits on `main`:

- `309c6fc` — godown features, day lock, shared rate, audit, shortage split
- `e88a7aa` — login survives full localStorage
- `0ef8077` — correct Supabase usage-limit error reporting
- `0bd79ba` — egress fix
- `e2e4bd2` — app pointed at BHARATHGAS-2 + migration script

---

## 3. Login behaviour (expected, not a bug)

The new project has a **new JWT secret**, so every old session is invalid.

- Users see the login screen once per device.
- Use the **same username/password** as before; password hashes were migrated.
- If a login fails, check the exact error:
  - “Supabase is not accepting requests / usage limit” → old cached bundle still using the old project; clear cache.
  - “Invalid login credentials” → check/reset that auth user.
  - “Failed to fetch” → network or stale bundle.
- Phones/PWA must load the new deployment once: **“App not updating? Clear cache”** on the login screen, or reinstall.

---

## 4. Pending: old photo files (do this on 2026-12-16)

- **1,412 objects** are recorded in `storage.objects` (1,307 referenced by `consumer_photos`, 105 additional objects).
- Actual files are still in the old S3 bucket.
- Old Storage API and S3 both return **HTTP 402** until the cycle resets.
- New photo uploads already work on the new project.
- Old photos currently show the “Photo unavailable until sync” placeholder (`src/lib/photoFallback.ts`).

### Prepared files (local, git-ignored)

| File | Purpose |
|---|---|
| `migration/old-object-urls.txt` | 1,412 old public URLs to download |
| `migration/photo-urls.txt` | 1,307 DB-referenced URLs |
| `scripts/migrate-storage.mjs` | Downloads old files and uploads to new bucket |
| `migration/new-url.txt` | New project URL |
| `migration/new-service-key.txt` | New service_role key |
| `migration/old-url.txt` / `new-url.txt` | DB connection strings (sensitive) |

### Run on 2026-12-16

```powershell
$env:PHOTO_URLS_FILE='migration/old-object-urls.txt'
node scripts/migrate-storage.mjs
```

Then verify:

```sql
select count(*) from storage.objects where bucket_id = 'consumer-photos';
```

Open a few old consumer photos in the app and confirm they load.

### If `migration/` was lost

Regenerate the old URL list from the **new** database:

```sql
select name from storage.objects where bucket_id = 'consumer-photos';
```

Prefix each name with:

```
https://skkebmqxhrtarpfwffgx.supabase.co/storage/v1/object/public/consumer-photos/
```

URL-encode each path segment, save one URL per line as `migration/old-object-urls.txt`, and run the script.

### After photos are copied

1. Verify a sample of old photos.
2. Delete the old Supabase project (`skkebmqxhrtarpfwffgx`) if no longer needed.
3. Delete `migration/*.sql`, `migration/*-key.txt`, `migration/*-url.txt`, URL lists.
4. Rotate both database passwords.

---

## 5. Do-not list

- **Do not** run `supabase init` in this repo; it already has `supabase/`.
- **Do not** run `supabase db push` against the new project without checking history; the three migrations are marked applied, but the schema came from a full restore.
- **Do not** delete/pause the old project before the photo copy.
- **Do not** commit `migration/`, `.env.local`, `.env*`, or any service keys. They are git-ignored.
- **Do not** reintroduce 60-second full-table syncs.
- **Do not** create more free organizations to reset quotas (fair-use risk).

---

## 6. Useful verification queries

Run against the new project:

```sql
select count(*) from public.consumers;                 -- 33612
select count(*) from public.agents;                    -- 25
select count(*) from auth.users;                       -- 27
select count(*) from public.staff_cylinder_settlements;-- 279
select count(*) from storage.objects
  where bucket_id = 'consumer-photos';                 -- 1412 metadata
select to_regclass('public.agency_settings'),
       to_regclass('public.day_unlocks'),
       to_regclass('public.godown_audit');              -- all non-null
select cylinder_rate from public.agency_settings where id = 1; -- 994
```

Check the deployed bundle (optional):

```powershell
# Should print True / True / False
# has new URL, has new anon key, has old URL
```

---

## 7. Known caveats

- Old project’s **direct Postgres connection still works** (used for the dump), but its **Storage/S3 does not** (402).
- The old project’s 5.78 GB egress remains on its own org; the new org starts fresh.
- Auth sessions/refresh tokens from the old project are invalid by design.
- Custom Auth email templates/SMTP from the old project are **not** migrated; the app only uses email/password with `@bgcls.local` accounts, and confirmations are off.
- Vault/pgsodium secrets were not migrated; the app does not use them. If future features use Vault, migrate the root key separately.
- The new project is in Singapore; latency is slightly higher than Mumbai but functional.
- The migration dumps (`migration/roles.sql`, `schema.sql`, `data.sql`) contain personal data and auth password hashes. Delete them after photos are copied.
