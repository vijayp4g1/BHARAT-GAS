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

const CSV_PATH = 'customers data/ListOfConsumers (5).csv';

async function analyze() {
  console.log('====================================================');
  console.log('Analyzing ListOfConsumers (5).csv');
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
  console.log('\nFetching all existing consumer_numbers from Supabase...');
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
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      existingSet.add(r.consumer_number);
      existingMap.set(r.consumer_number, r);
    }
    from += data.length;
    if (from % 5000 === 0) {
      console.log(`Fetched ${existingSet.size} consumers so far...`);
    }
    if (data.length < step) break;
  }

  console.log(`Total existing consumers in Supabase: ${existingSet.size}`);

  // Categorize
  const newConsumers = [];
  const existingConsumersToUpdate = [];
  let unchangedCount = 0;

  for (const c of uniqueConsumers) {
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
        existingConsumersToUpdate.push({
          id: existing.id,
          consumer_number: c.consumer_number,
          consumer_name: existing.consumer_name || c.consumer_name,
          mobile: hasBetterMobile ? c.mobile : existing.mobile,
          address: hasBetterAddress ? c.address : existing.address,
          area_code: hasAreaCodeUpdate ? c.area_code : existing.area_code,
        });
      } else {
        unchangedCount++;
      }
    }
  }

  console.log('\n================ ANALYSIS SUMMARY ================');
  console.log(`Total Unique in ListOfConsumers (5).csv: ${uniqueConsumers.length}`);
  console.log(`Already in Supabase: ${uniqueConsumers.length - newConsumers.length}`);
  console.log(`⭐ Brand NEW Consumers to Insert: ${newConsumers.length}`);
  console.log(`🔄 Existing Consumers to Enrich/Update: ${existingConsumersToUpdate.length}`);
  console.log(`✅ Unchanged Consumers: ${unchangedCount}`);
  console.log(`Time taken: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log('==================================================');

  if (newConsumers.length > 0) {
    console.log('\nSample NEW consumers (up to 5):', JSON.stringify(newConsumers.slice(0, 5), null, 2));
  }
}

analyze().catch(console.error);
