import fs from 'fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// 1. Read environment variables from .env.local
const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const SUPABASE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CSV_PATH = 'customers data/ListOfConsumers (5).csv';

async function runImport() {
  console.log('====================================================');
  console.log('Bharat Gas Master Consumer Import & Sync (v5)');
  console.log('====================================================');
  console.log('Target CSV:', CSV_PATH);

  const startTime = Date.now();

  // 1. Parse CSV (skipping first 3 metadata banner rows)
  console.log('\n[1/5] Reading and parsing CSV file...');
  const fileBuf = fs.readFileSync(CSV_PATH);
  const workbook = XLSX.read(fileBuf, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: 3 });
  console.log(`Parsed ${rawRows.length} total raw rows from CSV.`);

  // 2. Clean and deduplicate unique consumers
  console.log('\n[2/5] Cleaning and deduplicating unique consumers...');
  const consumerMap = new Map();
  let duplicateCount = 0;

  for (const row of rawRows) {
    const rawNum = String(row.ConsumerNumber !== undefined ? row.ConsumerNumber : '').trim();
    if (!rawNum || !/^\d+$/.test(rawNum)) continue;

    const consumerNumber = rawNum;
    const consumerName = String(row.ConsumerName || '').trim();

    // Clean mobile number (strip non-digits, handle 91 prefix, validate 10 digits)
    let mobile = String(row.MobileNumber || row.PhoneNumber || '').replace(/\D/g, '').trim();
    if (mobile.length > 10 && mobile.startsWith('91')) {
      mobile = mobile.slice(2);
    }
    if (mobile.length !== 10 || mobile === '0000000000') {
      mobile = String(row.MobileNumber || '').trim() || 'N/A';
    }

    // Build structured address
    let directAddress = String(row.Address || '').replace(/\s+/g, ' ').trim();
    const landmark = String(row.AreaLandMark || '').trim();
    const village = String(row.CityTownVillage || '').trim();
    const pincode = String(row.PinCode || '').trim();

    let fullAddress = directAddress;
    if (landmark && landmark !== '-' && !fullAddress.toLowerCase().includes(landmark.toLowerCase())) {
      fullAddress += `, Near ${landmark}`;
    }
    if (village && village !== '-' && !fullAddress.toLowerCase().includes(village.toLowerCase())) {
      fullAddress += `, ${village}`;
    }
    if (pincode && pincode !== '0' && !fullAddress.includes(pincode)) {
      fullAddress += ` - ${pincode}`;
    }
    fullAddress = fullAddress.replace(/,\s*,/g, ',').trim();

    const areaCode = String(row.AreaCodeDesc || '').trim() || null;

    if (consumerMap.has(consumerNumber)) {
      duplicateCount++;
      const prev = consumerMap.get(consumerNumber);
      if ((!prev.mobile || prev.mobile === 'N/A') && mobile && mobile !== 'N/A') {
        prev.mobile = mobile;
      }
      if (areaCode && !prev.area_code) {
        prev.area_code = areaCode;
      }
    } else {
      consumerMap.set(consumerNumber, {
        consumer_number: consumerNumber,
        consumer_name: consumerName || 'Unknown',
        mobile: mobile || 'N/A',
        address: fullAddress || 'Address not provided',
        area_code: areaCode,
      });
    }
  }

  const allCsvConsumers = Array.from(consumerMap.values());
  console.log(`Unique consumers in CSV: ${allCsvConsumers.length}`);
  console.log(`Filtered multi-cylinder / secondary SV rows: ${duplicateCount}`);

  // 3. Fetch existing consumers to compute exact diff
  console.log('\n[3/5] Querying existing consumers from Supabase...');
  const existingSet = new Set();
  const existingMap = new Map();
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('consumers')
      .select('id, consumer_number, consumer_name, mobile, address, area_code, verification_status')
      .range(from, from + step - 1);

    if (error) {
      console.error('Fetch error:', error);
      throw error;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      existingSet.add(r.consumer_number);
      existingMap.set(r.consumer_number, r);
    }
    from += data.length;
    if (data.length < step) break;
  }
  console.log(`Found ${existingSet.size} existing consumers currently in Supabase.`);

  // 4. Identify Brand New vs Existing to Update
  const newConsumers = [];
  const updatedConsumers = [];

  for (const c of allCsvConsumers) {
    if (!existingSet.has(c.consumer_number)) {
      newConsumers.push(c);
    } else {
      const existing = existingMap.get(c.consumer_number);
      const hasBetterMobile = 
        (!existing.mobile || existing.mobile === 'N/A' || existing.mobile === '0000000000') && 
        (c.mobile && c.mobile !== 'N/A' && c.mobile !== '0000000000');
      const hasBetterAddress = 
        (!existing.address || existing.address.length < 10) && 
        (c.address && c.address.length > 10);
      const hasAreaCodeUpdate = !existing.area_code && c.area_code;
      
      if (hasBetterMobile || hasBetterAddress || hasAreaCodeUpdate) {
        updatedConsumers.push({
          id: existing.id,
          consumer_number: c.consumer_number,
          consumer_name: existing.consumer_name || c.consumer_name,
          mobile: hasBetterMobile ? c.mobile : existing.mobile,
          address: hasBetterAddress ? c.address : existing.address,
          area_code: hasAreaCodeUpdate ? c.area_code : existing.area_code,
          verification_status: existing.verification_status // preserve existing verification status!
        });
      }
    }
  }

  console.log(`\nDiff Summary:`);
  console.log(`  ⭐ Brand NEW consumers to INSERT: ${newConsumers.length}`);
  console.log(`  🔄 Existing consumers to ENRICH: ${updatedConsumers.length}`);
  console.log(`  ✅ Existing consumers up to date: ${allCsvConsumers.length - newConsumers.length - updatedConsumers.length}`);

  // 5. Execute insertions and enrichments
  console.log('\n[4/5] Syncing new and enriched consumers to Supabase...');
  const nowIso = new Date().toISOString();

  // A. Insert Brand New Consumers
  if (newConsumers.length > 0) {
    console.log(`Inserting ${newConsumers.length} brand new consumers...`);
    const insertPayload = newConsumers.map(c => ({
      id: uuidv4(),
      consumer_number: c.consumer_number,
      consumer_name: c.consumer_name,
      mobile: c.mobile,
      address: c.address,
      area_code: c.area_code,
      verification_status: 'Not Collected',
      cylinder_type: '14.2KG_STD',
      created_at: nowIso,
      updated_at: nowIso,
    }));

    const BATCH_SIZE = 50;
    for (let i = 0; i < insertPayload.length; i += BATCH_SIZE) {
      const batch = insertPayload.slice(i, i + BATCH_SIZE);
      const { error: insErr } = await supabase.from('consumers').insert(batch);
      if (insErr) {
        console.error(`[Error] Insert batch failed at index ${i}:`, insErr);
        throw insErr;
      }
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, insertPayload.length)} / ${insertPayload.length} new consumers...`);
    }
  }

  // B. Enrich Existing Consumers
  if (updatedConsumers.length > 0) {
    console.log(`Enriching ${updatedConsumers.length} existing consumers...`);
    let enrichSuccess = 0;
    let enrichFail = 0;
    for (const u of updatedConsumers) {
      const { error: updErr } = await supabase
        .from('consumers')
        .update({
          mobile: u.mobile,
          address: u.address,
          area_code: u.area_code,
          updated_at: nowIso
        })
        .eq('id', u.id);

      if (updErr) {
        console.warn(`[Warn] Failed updating consumer ${u.consumer_number}:`, updErr.message);
        enrichFail++;
      } else {
        enrichSuccess++;
      }
    }
    console.log(`  Enrichment completed: ${enrichSuccess} succeeded, ${enrichFail} failed.`);
  }

  // 6. Verification
  console.log('\n[5/5] Verifying database integrity after import...');
  const { count: finalTotal } = await supabase
    .from('consumers')
    .select('*', { count: 'exact', head: true });

  const { count: locCount } = await supabase
    .from('consumer_locations')
    .select('*', { count: 'exact', head: true });

  const { count: photoCount } = await supabase
    .from('consumer_photos')
    .select('*', { count: 'exact', head: true });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n====================================================');
  console.log('Import & Database Sync Complete for ListOfConsumers (5)!');
  console.log(`Total Time Elapsed: ${totalTime}s`);
  console.log(`Brand New Consumers Added: ${newConsumers.length}`);
  console.log(`Existing Consumers Enriched: ${updatedConsumers.length}`);
  console.log(`Total Consumers in Supabase Now: ${finalTotal} (Previous: ${existingSet.size})`);
  console.log(`Preserved Locations: ${locCount}`);
  console.log(`Preserved House Photos: ${photoCount}`);
  console.log('====================================================\n');
}

runImport().catch(err => {
  console.error('Fatal import error:', err);
  process.exit(1);
});
