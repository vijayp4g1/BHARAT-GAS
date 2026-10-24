import fs from 'fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

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

async function updateExistingConsumers() {
  console.log('====================================================');
  console.log('Updating Existing Consumers from ListOfConsumers (5)');
  console.log('====================================================');

  const startTime = Date.now();

  // 1. Parse CSV
  console.log('\n[1/4] Parsing CSV file...');
  const fileBuf = fs.readFileSync(CSV_PATH);
  const workbook = XLSX.read(fileBuf, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: 3 });
  console.log(`Parsed ${rawRows.length} total rows from CSV.`);

  // 2. Clean and deduplicate unique consumers from CSV
  console.log('\n[2/4] Deduplicating unique consumers from CSV...');
  const csvConsumerMap = new Map();

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

    if (csvConsumerMap.has(consumerNumber)) {
      const prev = csvConsumerMap.get(consumerNumber);
      if ((!prev.mobile || prev.mobile === 'N/A') && mobile && mobile !== 'N/A') {
        prev.mobile = mobile;
      }
      if (areaCode && !prev.area_code) {
        prev.area_code = areaCode;
      }
    } else {
      csvConsumerMap.set(consumerNumber, {
        consumer_number: consumerNumber,
        consumer_name: consumerName || 'Unknown',
        mobile: mobile || 'N/A',
        address: fullAddress || 'Address not provided',
        area_code: areaCode,
      });
    }
  }

  console.log(`Unique consumers in CSV: ${csvConsumerMap.size}`);

  // 3. Fetch existing consumers from Supabase
  console.log('\n[3/4] Fetching all existing consumers from Supabase...');
  const existingMap = new Map();
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('consumers')
      .select('id, consumer_number, mobile, verification_status, area_code')
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
    if (from % 10000 === 0) {
      console.log(`  Fetched ${existingMap.size} records so far...`);
    }
    if (data.length < step) break;
  }

  console.log(`Loaded ${existingMap.size} total existing records from Supabase.`);

  // 4. Build update payloads for all matching consumers
  const updatePayload = [];
  const nowIso = new Date().toISOString();

  for (const [cNum, csvC] of csvConsumerMap.entries()) {
    if (existingMap.has(cNum)) {
      const existing = existingMap.get(cNum);
      const finalMobile = (csvC.mobile && csvC.mobile !== 'N/A' && csvC.mobile !== '0000000000')
        ? csvC.mobile
        : (existing.mobile || 'N/A');

      updatePayload.push({
        id: existing.id,
        consumer_number: cNum,
        consumer_name: csvC.consumer_name,
        mobile: finalMobile,
        address: csvC.address,
        area_code: csvC.area_code || existing.area_code,
        verification_status: existing.verification_status, // preserve status
        updated_at: nowIso
      });
    }
  }

  console.log(`\nMatched ${updatePayload.length} existing consumers to update in Supabase.`);

  // 5. Execute batch upsert
  console.log('\n[4/4] Executing batch upserts to update names, phone numbers, addresses, and area codes...');
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(updatePayload.length / BATCH_SIZE);
  let processed = 0;
  let batchErrors = 0;

  for (let i = 0; i < updatePayload.length; i += BATCH_SIZE) {
    const batch = updatePayload.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
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
        const pct = Math.round((processed / updatePayload.length) * 100);
        console.log(`  [Batch ${batchNum}/${totalBatches}] Updated ${processed}/${updatePayload.length} (${pct}%) in ${batchDuration}s`);
      }
    }
  }

  // 6. Final verification
  console.log('\nVerifying database state after update...');
  const { count: finalTotal } = await supabase.from('consumers').select('*', { count: 'exact', head: true });
  const { count: locCount } = await supabase.from('consumer_locations').select('*', { count: 'exact', head: true });
  const { count: photoCount } = await supabase.from('consumer_photos').select('*', { count: 'exact', head: true });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n====================================================');
  console.log('Update Complete!');
  console.log(`Total Time Elapsed: ${totalTime}s`);
  console.log(`Existing Consumers Updated: ${processed}`);
  console.log(`Batch Errors: ${batchErrors}`);
  console.log(`Total Consumers in Supabase: ${finalTotal}`);
  console.log(`Preserved Locations: ${locCount}`);
  console.log(`Preserved House Photos: ${photoCount}`);
  console.log('====================================================\n');
}

updateExistingConsumers().catch(err => {
  console.error('Fatal update error:', err);
  process.exit(1);
});
