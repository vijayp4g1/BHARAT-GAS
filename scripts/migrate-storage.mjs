// Copy consumer photos from the old Supabase public bucket URLs into the new
// project's consumer-photos bucket.
//
// Inputs (all git-ignored):
//   migration/new-url.txt          - new project URL
//   migration/new-service-key.txt  - new project service_role key
//   migration/photo-urls.txt       - one public photo URL per line
//
// Usage: node scripts/migrate-storage.mjs

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const NEW_URL = fs.readFileSync('migration/new-url.txt', 'utf8').trim();
const SERVICE_KEY = fs.readFileSync('migration/new-service-key.txt', 'utf8').trim();
const URLS_FILE = process.env.PHOTO_URLS_FILE || 'migration/photo-urls.txt';
const BUCKET = 'consumer-photos';
const CONCURRENCY = 8;

const supabase = createClient(NEW_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const unique = [
  ...new Set(
    fs
      .readFileSync(URLS_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('http'))
  ),
];

let ok = 0;
let fail = 0;
const failures = [];

async function copyOne(url) {
  try {
    const marker = `/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) throw new Error('URL does not contain the bucket path');

    const encodedPath = url.slice(idx + marker.length).split('?')[0];
    const path = decodeURIComponent(encodedPath).replace(/^\/+/, '');
    if (!path) throw new Error('Empty object path');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);

    const blob = await res.blob();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { upsert: true, contentType });

    if (error) throw new Error(error.message);
    ok += 1;
  } catch (err) {
    fail += 1;
    failures.push(`${url} :: ${err?.message || err}`);
  }

  const done = ok + fail;
  if (done % 100 === 0 || done === unique.length) {
    console.log(`${done}/${unique.length}  ok=${ok}  failed=${fail}`);
  }
}

async function main() {
  if (unique.length === 0) {
    console.log(`No photo URLs found in ${URLS_FILE}`);
    return;
  }

  console.log(`Copying ${unique.length} photos into ${NEW_URL}/${BUCKET} ...`);

  let next = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < unique.length) {
      const url = unique[next];
      next += 1;
      await copyOne(url);
    }
  });

  await Promise.all(workers);

  console.log(`Finished. ok=${ok} failed=${fail}`);
  if (failures.length > 0) {
    fs.writeFileSync('migration/storage-failures.txt', failures.join('\n'));
    console.log('Failures written to migration/storage-failures.txt');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
