import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load environment variables safely from .env.local
let env = {};
if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf-8');
  envContent.split('\n').forEach(line => {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) env[k.trim()] = v.join('=').trim();
  });
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || 'https://skkebmqxhrtarpfwffgx.supabase.co';
const SERVICE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Error: Missing VITE_SUPABASE_SERVICE_ROLE_KEY in .env.local or environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const rawInput = [
  { consNo: '101334568', name: 'Mrs MUDUMBA  SRIDEVI' },
  { consNo: '80761318', name: 'MR. GANESH  D' },
  { consNo: '4664', name: 'Mr. RAMAGONI  SOWMYA' },
  { consNo: '30285685', name: 'MR. SRINIVAS V' },
  { consNo: '54552676', name: 'MR. SRINIVAS  NILLA' },
  { consNo: '5851', name: 'MR. N  PRAVEEN KUMAR' },
  { consNo: '107908690', name: 'Mrs CHINTALA  MALLESHWARI' },
  { consNo: '35501767', name: 'MADESHETTI RAMESH KUMAR' },
  { consNo: '10130', name: 'CH ASHOK' },
  { consNo: '77004836', name: 'MRS NURJAHA  N' },
  { consNo: '4180', name: 'M SRINIVASULU' },
  { consNo: '9131', name: 'CH. VENKATESWARAO' },
  { consNo: '54028608', name: 'BUDEVI' },
  { consNo: '8859', name: 'MD.AZEEM' },
  { consNo: '81610708', name: 'MRS V K KRISHNA  VENI' },
  { consNo: '60364676', name: 'MRS REZWANA  BEGUM' },
  { consNo: '53340401', name: 'LAKSHMI' },
  { consNo: '52893336', name: 'CH.POCHMMA' },
  { consNo: '52893091', name: 'N.LAXMI' },
  { consNo: '70202914', name: 'MRS BONAKOLLURU  HARIKA' },
  { consNo: '116845897', name: 'Mrs DODDY  SANTHOSHI KUMARI' },
  { consNo: '121545069', name: 'Mr. KADUDULA  DAMODAR' },
  { consNo: '75892871', name: 'MR. BODAS  RAMNARSAIAH' },
  { consNo: '109804712', name: 'Mr. MALA AMRUTHA' },
  { consNo: '54149128', name: 'Unverified / Manual Entry' },
  { consNo: '123115742', name: 'Ms. BEGARI PRIYANKA' },
  { consNo: '91207531', name: 'Mr. KASHA  GANESH' },
  { consNo: '12339', name: 'SUNIL' },
  { consNo: '10876', name: 'GANAPATI SAHU' },
  { consNo: '86147020', name: 'MR. PANUGANTI  CHANTIVIJAY' },
  { consNo: '122662801', name: 'Mr. MOHAMMAD ABDUL MOQEET' },
  { consNo: '70651907', name: 'MR. ARURI  NARENDER' },
  { consNo: '116782525', name: 'Mr. GONE  ANIL KUMAR' },
  { consNo: '55164326', name: 'SHOBA' },
  { consNo: '63363656', name: 'MRS CHIMALAKONDURU  LAVANYA' },
  { consNo: '23024186', name: 'Mr. SABA   BEGUM' },
  { consNo: '52914563', name: 'ARUNA' },
  { consNo: '53454492', name: 'SRILATHA' },
  { consNo: '90123898', name: 'Mr. CHINTAKULA  ANNAVARAM' },
  { consNo: '32445213', name: 'A.GANESH' },
  { consNo: '40496', name: 'RAZIYA SULTANA' },
  { consNo: '114146318', name: 'Mr. MR DAMERA RAKESH' },
  { consNo: '22171265', name: 'Y RAM MOHANA RAO' },
  { consNo: '20714944', name: 'Mr. KONNURU  RAMULU' }
];

async function main() {
  console.log(`Starting to save Raju's 44 bills...`);

  // 1. Look up consumers in Supabase
  const consNumbers = rawInput.map(i => i.consNo);
  const { data: dbConsumers, error: dbError } = await supabase
    .from('consumers')
    .select('id, consumer_number, consumer_name, address, mobile')
    .in('consumer_number', consNumbers);

  if (dbError) {
    console.error('Error fetching consumers:', dbError);
  }

  const consMap = new Map();
  if (dbConsumers) {
    dbConsumers.forEach(c => consMap.set(c.consumer_number, c));
  }

  const entries = rawInput.map(item => {
    const matched = consMap.get(item.consNo);
    return {
      consumer_id: matched ? matched.id : undefined,
      consumer_number: item.consNo,
      consumer_name: matched ? (matched.consumer_name || item.name) : item.name,
      address: matched ? (matched.address || '') : '',
      mobile: matched ? (matched.mobile || '') : '',
      found: !!matched,
      source: 'camera',
      cylinder_type: '14.2KG_STD',
      payment_mode: 'CASH',
      empty_collected: true,
      scanned_at: new Date().toISOString()
    };
  });

  const matchedCount = entries.filter(e => e.found).length;
  console.log(`Matched ${matchedCount} / ${entries.length} consumers from database`);

  const reportDate = '2026-11-02';
  const agentName = 'RAJU';
  const agentId = '893216f0-42ce-44e4-b9ed-89ebfa310ff4';
  const rawCsv = entries.map(e => e.consumer_number).join(',');
  const count14kg = entries.filter(e => e.cylinder_type === '14.2KG_STD').length;
  const count10kg = entries.filter(e => e.cylinder_type === '10KG_LITE').length;
  const count19kg = entries.filter(e => e.cylinder_type === '19KG_COMM').length;
  const empties = entries.filter(e => e.empty_collected).length;
  const cashCount = entries.filter(e => e.payment_mode === 'CASH').length;
  const upiCount = entries.filter(e => e.payment_mode === 'UPI').length;
  const dueCount = entries.filter(e => e.payment_mode === 'DUE').length;

  // Check if day_end_reports table exists
  try {
    const { error: dayEndErr } = await supabase.from('day_end_reports').upsert({
      report_date: reportDate,
      agent_id: agentId,
      agent_name: agentName,
      total_deliveries: entries.length,
      domestic_14kg: count14kg,
      composite_10kg: count10kg,
      commercial_19kg: count19kg,
      empties_collected: empties,
      cash_count: cashCount,
      upi_count: upiCount,
      due_count: dueCount,
      entries: entries,
      raw_csv: rawCsv,
      updated_at: new Date().toISOString()
    }, { onConflict: 'report_date, agent_name' });

    if (dayEndErr) {
      console.log('day_end_reports upsert note:', dayEndErr.message);
    } else {
      console.log('Successfully upserted into day_end_reports table!');
    }
  } catch (err) {
    console.log('day_end_reports exception:', err.message);
  }

  // 2. Check and persist to staff_cylinder_settlements
  const scannedBillsJson = JSON.stringify(entries);
  const notesWithBills = `Scanned ${entries.length} day-end cash memos on ${reportDate}__BGCLS_SCANNED_BILLS__${scannedBillsJson}`;

  const { data: existingSettlement, error: setFetchErr } = await supabase
    .from('staff_cylinder_settlements')
    .select('*')
    .eq('settlement_date', reportDate)
    .eq('agent_id', agentId)
    .maybeSingle();

  if (existingSettlement) {
    console.log('Updating existing settlement for Raju on', reportDate);
    const { error: updateErr } = await supabase
      .from('staff_cylinder_settlements')
      .update({
        notes: notesWithBills,
        cash_cylinders: cashCount,
        upi_cylinders: upiCount,
        due_cylinders: dueCount,
        empty_cylinders: empties,
        updated_at: new Date().toISOString()
      })
      .eq('id', existingSettlement.id);

    if (updateErr) {
      console.error('Error updating staff_cylinder_settlements:', updateErr);
    } else {
      console.log('Successfully updated staff_cylinder_settlements with 44 bills!');
    }
  } else {
    console.log('Creating new settlement entry for Raju on', reportDate);
    const { error: insertErr } = await supabase
      .from('staff_cylinder_settlements')
      .insert({
        settlement_date: reportDate,
        agent_id: agentId,
        agent_name: agentName,
        supplied_cylinders: entries.length,
        cash_cylinders: cashCount,
        upi_cylinders: upiCount,
        due_cylinders: dueCount,
        online_cylinders: 0,
        returned_full_cylinders: 0,
        empty_cylinders: empties,
        notes: notesWithBills,
        updated_at: new Date().toISOString()
      });

    if (insertErr) {
      console.error('Error inserting into staff_cylinder_settlements:', insertErr);
    } else {
      console.log('Successfully created staff_cylinder_settlements record for Raju with 44 bills!');
    }
  }

  console.log('ALL DONE! Raju bills saved.');
}

main().catch(console.error);
