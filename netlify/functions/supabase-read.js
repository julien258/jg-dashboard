const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // Sécurité basique
  const secret = event.headers['x-sync-secret'];
  if (!secret || secret !== process.env.NETLIFY_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const [
      settingsRes,
      debtsRes,
      payablesRes,
      contractsRes,
      debtsPersoRes
    ] = await Promise.all([
      sb.from('settings').select('key,value').in('key', ['paye_perso']),
      sb.from('debts').select('debiteur,company_id,monthly_amount,amount_remaining,urgency_level,nature,status').eq('status','en_cours').neq('monthly_amount', 0),
      sb.from('payables').select('fournisseur,company_id,amount_ht,amount_ttc,due_date,invoice_ref,nature,status').eq('status','a_payer'),
      sb.from('contracts').select('client,commission_amount,tva_taux,payment_expected_date,invoice_date,status,recurrence').in('status',['facture','signe']),
      sb.from('debts').select('debiteur,monthly_amount,amount_remaining').eq('company_id','perso').eq('status','en_cours')
    ]);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: settingsRes.data,
        debts: debtsRes.data,
        payables: payablesRes.data,
        contracts: contractsRes.data,
        debts_perso: debtsPersoRes.data
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
