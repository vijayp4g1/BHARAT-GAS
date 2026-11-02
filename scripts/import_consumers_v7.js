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

const CSV_PATH = 'customers data/ListOfConsumers (7).csv';

async function runImport() {
  console.log('====================================================');
  console.log('Bharat Gas Master Consumer Import & Update (v7)');
  console.log('====================================================');
  console.log('Target CSV:', CSV_PATH);

  const startTime = Date.now();

  // 1. Initial State Check in Supabase
  console.log('\n[1/6] Checking current Supabase counts before update...');
  const { count: initialTotal } = await supabase
    .from('consumers')
    .select('*', { count: 'exact', head: true });

  const { count: initialLocCount } = await supabase
    .from('consumer_locations')
    .select('*', { count: 'exact', head: true });

  const { count: initialPhotoCount } = await supabase
    .from('consumer_photos')
    .select('*', { count: 'exact', head: true });

  const { count: initialNotesCount } = await supabase
    .from('delivery_notes')
    .select('*', { count: 'exact', head: true });

  console.log(`Current Consumers in Database: ${initialTotal}`);
  console.log(`Current Verified Locations:    ${initialLocCount}`);
  console.log(`Current House Photos:          ${initialPhotoCount}`);
  console.log(`Current Delivery Notes:        ${initialNotesCount}`);

  // 2. Parse CSV (skipping first 3 metadata banner rows)
  console.log('\n[2/6] Reading and parsing CSV file...');
  const fileBuf = fs.readFileSync(CSV_PATH);
  const workbook = XLSX.read(fileBuf, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: 3 });
  console.log(`Parsed ${rawRows.length} total raw rows from CSV.`);

  // 3. Clean and deduplicate unique consumers
  console.log('\n[3/6] Cleaning and deduplicating unique consumers...');
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
  console.log(`Duplicate / multi-SV rows filtered: ${duplicateCount}`);

  // 4. Fetch all existing consumers from Supabase
  console.log('\n[4/6] Querying existing consumers from Supabase...');
  const existingMap = new Map();
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('consumers')
      .select('id, consumer_number, consumer_name, mobile, address, area_code, verification_status, cylinder_type, created_at, assigned_agent_id')
      .range(from, from + step - 1);

    if (error) {
      console.error('Fetch error:', error);
      throw error;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      existingMap.set(r.consumer_number, r);
    }
    from += data.length;
    if (from % 10000 === 0 || data.length < step) {
      console.log(`  Fetched ${existingMap.size} records from Supabase...`);
    }
    if (data.length < step) break;
  }
  console.log(`Loaded ${existingMap.size} total existing records from Supabase.`);

  // 5. Separate Brand New Consumers and Existing Consumers to Update
  const newConsumers = [];
  const existingToUpdate = [];
  const nowIso = new Date().toISOString();

  for (const c of allCsvConsumers) {
    if (!existingMap.has(c.consumer_number)) {
      newConsumers.push({
        id: uuidv4(),
        consumer_number: c.consumer_number,
        consumer_name: c.consumer_name,
        mobile: c.mobile,
        address: c.address,
        area_code: c.area_code,
        verification_status: 'Not Collected',
        cylinder_type: '14.2KG_STD',
        created_at: nowIso,
        updated_at: nowIso
      });
    } else {
      const existing = existingMap.get(c.consumer_number);

      // Mobile resolution: if CSV has a valid 10-digit mobile, use it. Otherwise keep existing mobile if valid.
      let finalMobile = c.mobile;
      if ((!finalMobile || finalMobile === 'N/A' || finalMobile === '0000000000') && (existing.mobile && existing.mobile !== 'N/A')) {
        finalMobile = existing.mobile;
      }

      // Address resolution: prefer the newly formatted address if it has content
      let finalAddress = (c.address && c.address !== 'Address not provided') ? c.address : (existing.address || 'Address not provided');

      // Area code resolution
      let finalAreaCode = c.area_code || existing.area_code;

      // Name resolution
      let finalName = (c.consumer_name && c.consumer_name !== 'Unknown') ? c.consumer_name : (existing.consumer_name || 'Unknown');

      existingToUpdate.push({
        id: existing.id, // Strictly preserve existing UUID primary key!
        consumer_number: c.consumer_number,
        consumer_name: finalName,
        mobile: finalMobile,
        address: finalAddress,
        area_code: finalAreaCode,
        verification_status: existing.verification_status, // Strictly preserve verification status!
        cylinder_type: existing.cylinder_type || '14.2KG_STD', // Preserve cylinder type
        assigned_agent_id: existing.assigned_agent_id, // Preserve assigned agent
        created_at: existing.created_at, // Preserve original created_at
        updated_at: nowIso
      });
    }
  }

  console.log('\n====================================================');
  console.log(`Classification:`);
  console.log(`  ⭐ Brand NEW Consumers to INSERT:    ${newConsumers.length}`);
  console.log(`  🔄 Existing Consumers to UPDATE:     ${existingToUpdate.length}`);
  console.log('====================================================');

  // 6. Execute Insertions and Updates
  console.log('\n[5/6] Writing updates to Supabase...');

  // A. Insert Brand New Consumers
  if (newConsumers.length > 0) {
    console.log(`\nInserting ${newConsumers.length} brand new consumers...`);
    const BATCH_SIZE_NEW = 100;
    for (let i = 0; i < newConsumers.length; i += BATCH_SIZE_NEW) {
      const batch = newConsumers.slice(i, i + BATCH_SIZE_NEW);
      const { error: insErr } = await supabase.from('consumers').insert(batch);
      if (insErr) {
        console.error(`[Error] Insert batch failed at index ${i}:`, insErr);
        throw insErr;
      }
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE_NEW, newConsumers.length)} / ${newConsumers.length} new consumers`);
    }
    console.log(`✅ All ${newConsumers.length} new consumers inserted successfully!`);
  }

  // B. Upsert Existing Consumers in Batches
  if (existingToUpdate.length > 0) {
    console.log(`\nUpdating ${existingToUpdate.length} existing consumers in batches of 500...`);
    const BATCH_SIZE_UPDATE = 500;
    const totalBatches = Math.ceil(existingToUpdate.length / BATCH_SIZE_UPDATE);
    let processed = 0;
    let batchErrors = 0;

    for (let i = 0; i < existingToUpdate.length; i += BATCH_SIZE_UPDATE) {
      const batch = existingToUpdate.slice(i, i + BATCH_SIZE_UPDATE);
      const batchNum = Math.floor(i / BATCH_SIZE_UPDATE) + 1;
      const batchStart = Date.now();

      const { error: upsertErr } = await supabase
        .from('consumers')
        .upsert(batch, { onConflict: 'consumer_number' });

      const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(2);

      if (upsertErr) {
        console.error(`  [Error] Batch ${batchNum}/${totalBatches} failed:`, upsertErr.message);
        batchErrors++;
      } else {
        processed += batch.length;
        if (batchNum % 10 === 0 || batchNum === totalBatches) {
          const pct = Math.round((processed / existingToUpdate.length) * 100);
          console.log(`  [Batch ${batchNum}/${totalBatches}] Updated ${processed} / ${existingToUpdate.length} (${pct}%) in ${batchDuration}s`);
        }
      }
    }

    if (batchErrors > 0) {
      console.warn(`⚠️ Warning: ${batchErrors} batches encountered errors during update.`);
    } else {
      console.log(`✅ All ${processed} existing consumers updated successfully!`);
    }
  }

  // 7. Verify Integrity
  console.log('\n[6/6] Verifying database integrity after import...');
  const { count: finalTotal } = await supabase
    .from('consumers')
    .select('*', { count: 'exact', head: true });

  const { count: finalLocCount } = await supabase
    .from('consumer_locations')
    .select('*', { count: 'exact', head: true });

  const { count: finalPhotoCount } = await supabase
    .from('consumer_photos')
    .select('*', { count: 'exact', head: true });

  const { count: finalNotesCount } = await supabase
    .from('delivery_notes')
    .select('*', { count: 'exact', head: true });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n====================================================');
  console.log('Master Consumer Import & Update Complete!');
  console.log(`Total Time Elapsed:           ${totalTime}s`);
  console.log(`Brand New Consumers Added:    ${newConsumers.length}`);
  console.log(`Existing Consumers Updated:   ${existingToUpdate.length}`);
  console.log(`Total Consumers in Database:  ${finalTotal} (Previous: ${initialTotal})`);
  console.log(`Preserved Locations:          ${finalLocCount} (Initial: ${initialLocCount})`);
  console.log(`Preserved House Photos:       ${finalPhotoCount} (Initial: ${initialPhotoCount})`);
  console.log(`Preserved Delivery Notes:     ${finalNotesCount} (Initial: ${initialNotesCount})`);
  console.log('====================================================\n');
}

runImport().catch(err => {
  console.error('Fatal import error:', err);
  process.exit(1);
});

