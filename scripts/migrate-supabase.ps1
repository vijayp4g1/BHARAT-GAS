# Migrate the full Supabase database (schema + data + auth users) to a new project.
#
# Prerequisites:
#   1. Docker Desktop is running.
#   2. migration/old-url.txt contains the OLD project's Session pooler URL.
#   3. migration/new-url.txt contains the NEW project's Session pooler URL.
#      (Both files are git-ignored. Delete them after the migration.)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/migrate-supabase.ps1

param(
  [string]$OldUrlFile = "migration/old-url.txt",
  [string]$NewUrlFile = "migration/new-url.txt",
  [string]$OutDir = "migration"
)

$ErrorActionPreference = "Stop"

function Read-DbUrl([string]$path) {
  if (-not (Test-Path $path)) {
    throw "Missing $path. Put the Session pooler connection string in it."
  }
  $url = (Get-Content $path -Raw).Trim()
  if (-not $url.StartsWith("postgresql://")) {
    throw "Invalid connection string in $path (must start with postgresql://)"
  }
  return $url
}

$oldUrl = Read-DbUrl $OldUrlFile
$newUrl = Read-DbUrl $NewUrlFile

New-Item -ItemType Directory -Force $OutDir | Out-Null

Write-Host "`n[1/4] Dumping roles..." -ForegroundColor Cyan
npx supabase db dump --db-url $oldUrl -f "$OutDir/roles.sql" --role-only
if ($LASTEXITCODE -ne 0) { throw "Role dump failed. Is the old database reachable?" }

Write-Host "`n[2/4] Dumping schema..." -ForegroundColor Cyan
npx supabase db dump --db-url $oldUrl -f "$OutDir/schema.sql"
if ($LASTEXITCODE -ne 0) { throw "Schema dump failed." }

Write-Host "`n[3/4] Dumping data (includes auth users and storage metadata)..." -ForegroundColor Cyan
npx supabase db dump --db-url $oldUrl -f "$OutDir/data.sql" --use-copy --data-only `
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
if ($LASTEXITCODE -ne 0) { throw "Data dump failed." }

Write-Host "`n[4/4] Restoring into the new project..." -ForegroundColor Cyan
$mount = "$(Resolve-Path $OutDir):/work"
docker run --rm -i -v $mount -w /work postgres:17 `
  psql $newUrl --single-transaction --variable ON_ERROR_STOP=1 `
  --file roles.sql --file schema.sql `
  --command "SET session_replication_role = replica" `
  --file data.sql

if ($LASTEXITCODE -ne 0) {
  Write-Host "`nRestore stopped on an error. Common fixes:" -ForegroundColor Yellow
  Write-Host " - Comment out lines containing OWNER TO `"supabase_admin`" in migration/schema.sql"
  Write-Host " - Comment out GRANT `"postgres`" TO `"cli_login_postgres`" in migration/roles.sql"
  throw "Restore failed."
}

Write-Host "`nDatabase restore complete." -ForegroundColor Green
Write-Host "Verify in the new project's SQL editor before deploying functions:"
Write-Host "  select count(*) from public.consumers;"
Write-Host "  select count(*) from auth.users;"
