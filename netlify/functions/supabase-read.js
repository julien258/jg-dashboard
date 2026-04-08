// supabase-read.js — lecture Supabase via REST direct (pas de SDK)
const sbFetch = async (env, path, params = {}) => {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

exports.handler = async (event) => {
  const secret = event.headers['x-sync-secret'];
  if (!secret || secret !== process.env.NETLIFY_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
  };
  try {
    const [settings, debts, payables, contracts, debtsPerso] = await Promise.all([
      sbFetch(env, '/settings', { 'key': 'eq.paye_perso', 'select': 'key,value' }),
      sbFetch(env, '/debts', { 'status': 'eq.en_cours', 'monthly_amount': 'neq.0', 'select': 'debiteur,company_id,monthly_amount,amount_remaining,urgency_level,nature' }),
      sbFetch(env, '/payables', { 'status': 'eq.a_payer', 'select': 'fournisseur,company_id,amount_ht,amount_ttc,due_date,invoice_ref,nature' }),
      sbFetch(env, '/contracts', { 'status': 'in.(facture,signe)', 'select': 'client_id,commission_amount,tva_taux,payment_expected_date,invoice_date,status' }),
      sbFetch(env, '/debts', { 'company_id': 'eq.perso', 'status': 'eq.en_cours', 'select': 'debiteur,monthly_amount,amount_remaining' })
    ]);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings, debts, payables, contracts, debts_perso: debtsPerso })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
