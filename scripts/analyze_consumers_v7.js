import fs from 'fs';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [k, ...v] = line.trim().split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CSV_PATH = 'customers data/ListOfConsumers (7).csv';

async function analyze() {
  console.log('====================================================');
  console.log('Analyzing ListOfConsumers (7).csv');
  console.log('====================================================');

  const startTime = Date.now();
  console.log('Reading file...');
  const fileBuf = fs.readFileSync(CSV_PATH);
  const workbook = XLSX.read(fileBuf, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Skip range 3 (banner rows)
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: 3 });
  console.log(`Parsed ${rawRows.length} raw rows from CSV.`);

  const consumerMap = new Map();
  let duplicateRows = 0;
  let invalidRows = 0;

  for (const row of rawRows) {
    const rawNum = String(row.ConsumerNumber !== undefined ? row.ConsumerNumber : '').trim();
    if (!rawNum || !/^\d+$/.test(rawNum)) {
      invalidRows++;
      continue;
    }

    const consumerNumber = rawNum;
    const consumerName = String(row.ConsumerName || '').trim();

    let mobile = String(row.MobileNumber || row.PhoneNumber || '').replace(/\D/g, '').trim();
    if (mobile.length > 10 && mobile.startsWith('91')) {
      mobile = mobile.slice(2);
    }
    if (mobile.length !== 10 || mobile === '0000000000') {
      mobile = String(row.MobileNumber || '').trim() || 'N/A';
    }

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
      duplicateRows++;
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

  const uniqueConsumers = Array.from(consumerMap.values());
  console.log(`Unique consumers in CSV: ${uniqueConsumers.length}`);
  console.log(`Duplicate / multi-SV rows: ${duplicateRows}`);
  console.log(`Invalid / non-numeric rows: ${invalidRows}`);

  // Fetch all existing consumer numbers from Supabase
  console.log('\nFetching existing consumers from Supabase...');
  const existingSet = new Set();
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('consumers')
      .select('consumer_number')
      .range(from, from + step - 1);

    if (error) {
      console.error('Fetch error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      existingSet.add(r.consumer_number);
    }
    from += data.length;
    if (data.length < step) break;
  }

  console.log(`Current existing consumers in Supabase: ${existingSet.size}`);

  let newCount = 0;
  let existingInCsvCount = 0;

  for (const c of uniqueConsumers) {
    if (existingSet.has(c.consumer_number)) {
      existingInCsvCount++;
    } else {
      newCount++;
    }
  }

  console.log('\n====================================================');
  console.log('Analysis Summary:');
  console.log(`  ⭐ Brand NEW consumers in CSV: ${newCount}`);
  console.log(`  🔄 Existing consumers in CSV to update: ${existingInCsvCount}`);
  console.log(`  📊 Total Consumers in CSV: ${uniqueConsumers.length}`);
  console.log(`  ⏱️ Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  console.log('====================================================');
}

analyze().catch(console.error);

