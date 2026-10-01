import fs from 'fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || 'PLACEHOLDER');

const CSV_PATH = 'customers data/ListOfConsumers (2).csv';

async function runMerge() {
  console.log('====================================================');
  console.log('Starting Bharat Gas Consumers Merge & Update Process');
  console.log('====================================================');
  console.log('Reading file:', CSV_PATH);

  const startTime = Date.now();
  const fileBuf = fs.readFileSync(CSV_PATH);
  const workbook = XLSX.read(fileBuf, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Range 3 skips lines 1-3 (metadata banner) so line 4 is the header
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: 3 });
  console.log(`Parsed ${rawRows.length} total raw rows from CSV.`);

  // Deduplicate and process unique consumers
  const consumerMap = new Map();
  let duplicateCount = 0;

  for (const row of rawRows) {
    const rawNum = String(row.ConsumerNumber !== undefined ? row.ConsumerNumber : '').trim();
    if (!rawNum || !/^\d+$/.test(rawNum)) continue;

    const consumerNumber = rawNum;
    const consumerName = String(row.ConsumerName || '').trim();
    
    // Clean mobile number (remove non-digits, keep 10 digits or fallback)
    let mobile = String(row.MobileNumber || row.PhoneNumber || '').replace(/\D/g, '').trim();
    if (mobile.length > 10 && mobile.startsWith('91')) {
      mobile = mobile.slice(2);
    }
    if (mobile.length !== 10 || mobile === '0000000000') {
      mobile = String(row.MobileNumber || '').trim() || 'N/A';
    }

    // Compose address
    let directAddress = String(row.Address || '').replace(/\s+/g, ' ').trim();
    const landmark = String(row.AreaLandMark || '').trim();
    const village = String(row.CityTownVillage || '').trim();
    const pincode = String(row.PinCode || '').trim();

    // If direct address doesn't include landmark or village, append for field clarity
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
      // If previous entry had empty mobile/address and this one has it, enrich it
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
        updated_at: new Date().toISOString()
      });
    }
  }

  const uniqueConsumers = Array.from(consumerMap.values());
  console.log(`Processed ${uniqueConsumers.length} unique consumers.`);
  console.log(`Filtered out ${duplicateCount} multi-cylinder / secondary SV entries.`);

  console.log('\n--- Beginning Batch Upsert to Supabase ---');
  const BATCH_SIZE = 1000;
  const totalBatches = Math.ceil(uniqueConsumers.length / BATCH_SIZE);
  let processedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < uniqueConsumers.length; i += BATCH_SIZE) {
    const batch = uniqueConsumers.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchStart = Date.now();

    const { error } = await supabase
      .from('consumers')
      .upsert(batch, { onConflict: 'consumer_number' });

    const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(2);

    if (error) {
      console.error(`[Error] Batch ${batchNum}/${totalBatches} failed:`, error.message);
      errorCount++;
    } else {
      processedCount += batch.length;
      const percent = Math.round((processedCount / uniqueConsumers.length) * 100);
      console.log(`[Batch ${batchNum}/${totalBatches}] Upserted ${batch.length} consumers (${batchDuration}s) | Progress: ${percent}%`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n====================================================');
  console.log('Merge & Update Completed!');
  console.log(`Total Time: ${totalTime}s`);
  console.log(`Total Consumers Processed: ${processedCount}`);
  console.log(`Batch Errors: ${errorCount}`);
  console.log('====================================================\n');

  // Verify counts in DB
  const { count: finalTotal } = await supabase.from('consumers').select('*', { count: 'exact', head: true });
  const { count: withAreaCode } = await supabase.from('consumers').select('*', { count: 'exact', head: true }).not('area_code', 'is', null);
  const { count: locCount } = await supabase.from('consumer_locations').select('*', { count: 'exact', head: true });
  const { count: photoCount } = await supabase.from('consumer_photos').select('*', { count: 'exact', head: true });

  console.log('Database Status Verification:');
  console.log('  Total Consumers in DB:', finalTotal);
  console.log('  Consumers with Area Code populated:', withAreaCode);
  console.log('  Preserved GPS Locations in DB:', locCount);
  console.log('  Preserved House Photos in DB:', photoCount);
}

runMerge().catch(err => {
  console.error('Fatal error during merge execution:', err);
  process.exit(1);
});
