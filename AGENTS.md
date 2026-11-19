# Repository instructions

## Read this before touching Supabase, auth, storage or deployments

The app now uses the **new** Supabase project `zdipbxhgjhxfslpoizkj` (BHARATHGAS-2).

The **old** project `skkebmqxhrtarpfwffgx` is **egress-restricted** on the Free plan and its Storage API/S3 return **HTTP 402 until 2026-12-16**.

**Full context, counts, commands and do-not list:** [`MIGRATION-STATUS.md`](./MIGRATION-STATUS.md)

### Critical rules

- Do **not** point the app back to `skkebmqxhrtarpfwffgx`.
- Do **not** delete/pause the old project before the 1,412 photo files are copied on 2026-12-16.
- Do **not** run `supabase init` (the repo already has `supabase/`) or `supabase db push` without reading the migration notes.
- Do **not** commit `.env*`, `migration/`, database dumps, connection strings or service keys. They are git-ignored and contain personal data/credentials.
- Do **not** reintroduce full-table sync scans on a timer; that caused the 5 GB egress overage (fixed in `0bd79ba`).
- Do **not** add automatic `autoSyncMasterConsumers()` calls. The 33k customer master is manual-only (Manager Dashboard → Resync Customers, or Agent Search → database icon), about once a week. Only `pullLatestCloudData()` (incremental locations/photos/notes) is automatic, and it is coalesced to at most once every 2 minutes.
- Do **not** re-add a `pullLatestCloudData` interval timer or per-event `agents` lookups; keep the existing caches/dedupes.
- Do **not** re-enable PWA `autoUpdate` or reload on `visibilitychange`/app resume. Updates must be an explicit “Reload” prompt; the Day End page persists date/tab/selected boy in `sessionStorage` so a resume/reload returns to the same scan list.
- Do **not** refetch the Staff Book list on tab focus/app resume; realtime keeps it current.
- Existing users must log in again once: the new project has a new JWT secret. Their old passwords were migrated.

### Pending task

On/after **2026-12-16**:

```powershell
$env:PHOTO_URLS_FILE='migration/old-object-urls.txt'
node scripts/migrate-storage.mjs
```

Then verify the bucket count and delete the old project.
