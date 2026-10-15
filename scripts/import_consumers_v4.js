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
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CSV_PATH = 'customers data/ListOfConsumers (4).csv';

async function runImport() {
  console.log('====================================================');
  console.log('Bharat Gas Master Consumer Import & Diff Sync (v4)');
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
  console.log(`Parsed ${rawRows.length} total rows from CSV.`);

  // 2. Deduplicate by Consumer Number and clean/enrich fields
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

  // 3. Directly check these 126 consumer numbers against Supabase
  console.log('\n[3/5] Checking existing records in Supabase (direct targeted query)...');
  const numbersToCheck = allCsvConsumers.map(c => c.consumer_number);
  
  const { data: existingRows, error: searchErr } = await supabase
    .from('manager_consumer_summary')
    .select('id, consumer_number, consumer_name, mobile, address')
    .in('consumer_number', numbersToCheck);

  if (searchErr) {
    console.error('Search error:', searchErr);
    throw searchErr;
  }

  const remoteMap = new Map();
  (existingRows || []).forEach(r => remoteMap.set(String(r.consumer_number), r));
  console.log(`Matched ${remoteMap.size} existing consumers in Supabase.`);

  // 4. Identify Brand New vs Existing to Update
  const newConsumers = [];
  const updatedConsumers = [];

  for (const c of allCsvConsumers) {
    if (!remoteMap.has(c.consumer_number)) {
      newConsumers.push(c);
    } else {
      const existing = remoteMap.get(c.consumer_number);
      const hasBetterMobile = 
        (!existing.mobile || existing.mobile === 'N/A' || existing.mobile === '0000000000') && 
        (c.mobile && c.mobile !== 'N/A' && c.mobile !== '0000000000');
      const hasBetterAddress = 
        (!existing.address || existing.address.length < 10) && 
        (c.address && c.address.length > 10);
      
      if (hasBetterMobile || hasBetterAddress || c.area_code) {
        updatedConsumers.push({
          id: existing.id,
          consumer_number: c.consumer_number,
          consumer_name: c.consumer_name || existing.consumer_name,
          mobile: hasBetterMobile ? c.mobile : existing.mobile,
          address: hasBetterAddress ? c.address : existing.address,
          area_code: c.area_code
        });
      }
    }
  }

  console.log(`\nDiff Results for CSV (4):`);
  console.log(`  ⭐ Brand NEW consumers to INSERT: ${newConsumers.length}`);
  console.log(`  🔄 Existing consumers to UPDATE/ENRICH: ${updatedConsumers.length}`);
  console.log(`  ✅ Existing consumers already up to date: ${allCsvConsumers.length - newConsumers.length - updatedConsumers.length}`);

  // 5. Execute insertions and updates via sync_consumer RPC
  console.log('\n[4/5] Syncing to Supabase via sync_consumer RPC...');
  const nowIso = new Date().toISOString();
  let successCount = 0;
  let errorCount = 0;

  const itemsToSync = [
    ...newConsumers.map(c => ({
      p_id: uuidv4(),
      p_consumer_number: c.consumer_number,
      p_consumer_name: c.consumer_name,
      p_mobile: c.mobile,
      p_address: c.address,
      p_verification_status: 'Not Collected',
      p_assigned_agent_id: null,
      p_area_code: c.area_code,
      p_created_at: nowIso,
      p_updated_at: nowIso,
      type: 'NEW'
    })),
    ...updatedConsumers.map(c => ({
      p_id: c.id,
      p_consumer_number: c.consumer_number,
      p_consumer_name: c.consumer_name,
      p_mobile: c.mobile,
      p_address: c.address,
      p_verification_status: 'Verified',
      p_assigned_agent_id: null,
      p_area_code: c.area_code,
      p_created_at: nowIso,
      p_updated_at: nowIso,
      type: 'UPDATE'
    }))
  ];

  console.log(`Total database sync operations to execute: ${itemsToSync.length}`);

  if (itemsToSync.length > 0) {
    const CONCURRENCY = 5;
    for (let i = 0; i < itemsToSync.length; i += CONCURRENCY) {
      const chunk = itemsToSync.slice(i, i + CONCURRENCY);
      const chunkStart = Date.now();

      const results = await Promise.all(
        chunk.map(item => 
          supabase.rpc('sync_consumer', {
            p_id: item.p_id,
            p_consumer_number: item.p_consumer_number,
            p_consumer_name: item.p_consumer_name,
            p_mobile: item.p_mobile,
            p_address: item.p_address,
            p_verification_status: item.p_verification_status,
            p_assigned_agent_id: item.p_assigned_agent_id,
            p_area_code: item.p_area_code,
            p_created_at: item.p_created_at,
            p_updated_at: item.p_updated_at
          })
        )
      );

      for (const res of results) {
        if (res.error) {
          console.warn('Sync notice:', res.error.message || res.error);
          errorCount++;
        } else {
          successCount++;
        }
      }

      const duration = ((Date.now() - chunkStart) / 1000).toFixed(2);
      const progressPct = Math.round(((i + chunk.length) / itemsToSync.length) * 100);
      console.log(`[Sync] Progress: ${i + chunk.length}/${itemsToSync.length} (${progressPct}%) in ${duration}s`);
    }
  }

  // 6. Verification
  console.log('\n[5/5] Verifying final database count in Supabase...');
  const { count: finalTotal } = await supabase
    .from('manager_consumer_summary')
    .select('*', { count: 'exact', head: true });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n====================================================');
  console.log('Import & Database Sync Complete for CSV (4)!');
  console.log(`Total Time Elapsed: ${totalTime}s`);
  console.log(`Brand New Consumers Added: ${newConsumers.length}`);
  console.log(`Existing Consumers Enriched: ${updatedConsumers.length}`);
  console.log(`Successful Sync Operations: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total Consumers in Supabase Now: ${finalTotal}`);
  console.log('====================================================\n');
}

runImport().catch(err => {
  console.error('Fatal import error:', err);
  process.exit(1);
});
