// Run this once to seed the database tables and preset questions
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testConnection() {
  // Just test that we can reach Supabase
  const { data, error } = await supabase.from('profiles').select('count').limit(1);
  if (error && error.code === '42P01') {
    console.log('\n⚠️  Tables not created yet. Please run the SQL schema first:');
    console.log('   1. Go to your Supabase Dashboard → SQL Editor');
    console.log('   2. Click "New Query"');
    console.log('   3. Paste the contents of supabase-schema.sql');
    console.log('   4. Click "Run"\n');
    return false;
  }
  if (error) {
    console.log('Connection error:', error.message);
    return false;
  }
  console.log('✅ Connected to Supabase successfully!');
  return true;
}

testConnection();
