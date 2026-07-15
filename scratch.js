import { createClient } from '@supabase/supabase-js';

// Load env vars
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: dispatches, error: dError } = await supabase
    .from('daily_dispatch')
    .select('*, agents(name)');
  console.log("Dispatches:", dispatches);

  const { data: items, error: iError } = await supabase
    .from('dispatch_items')
    .select('*, consumers(consumer_name)');
  console.log("Items:", items);
}

check();
