// pennylane-debug-sarl.js - Debug spécifique compte SARL GUIRAUD
export default async (req) => {
  const headers = { 'Content-Type': 'application/json' };
  const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';
  const token = process.env.PENNYLANE_SARL_TOKEN;
  if (!token) return new Response(JSON.stringify({ error: 'Token manquant' }), { headers });

  const result = { steps: [] };

  try {
    // Étape 1 : lister les comptes
    const ctsRes = await fetch(`${PENNYLANE_API}/bank_accounts`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const ctsData = await ctsRes.json();
    const comptes = ctsData.bank_accounts || ctsData.items || [];
    result.steps.push({
      step: 1,
      name: 'Liste des comptes',
      status: ctsRes.status,
      nb: comptes.length,
      structure_keys: comptes[0] ? Object.keys(comptes[0]) : [],
    });

    // Étape 2 : essayer différents endpoints pour les transactions
    const testAccount = comptes.find(c => /guiraud|qonto/i.test(c.name || c.label || '')) || comptes[0];
    
    // Test A : endpoint v2 bank_transactions avec bank_account_id
    const urlA = `${PENNYLANE_API}/bank_transactions?bank_account_id=${testAccount.id}&per_page=10`;
    const resA = await fetch(urlA, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const dataA = await resA.json();
    const txListA = dataA.bank_transactions || dataA.transactions || dataA.items || [];
    result.steps.push({
      step: 2,
      name: 'Test A : /bank_transactions?bank_account_id',
      url: urlA,
      status: resA.status,
      response_keys: Object.keys(dataA),
      nb_tx: txListA.length,
      first_tx: txListA[0] || null,
      raw_response_sample: JSON.stringify(dataA).substring(0, 500),
    });

    // Test B : endpoint v2 transactions tout court
    const urlB = `${PENNYLANE_API}/transactions?per_page=10`;
    const resB = await fetch(urlB, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const dataB = resB.ok ? await resB.json() : { error: resB.status };
    result.steps.push({
      step: 3,
      name: 'Test B : /transactions',
      url: urlB,
      status: resB.status,
      response_keys: dataB.error ? [] : Object.keys(dataB),
      sample: JSON.stringify(dataB).substring(0, 500),
    });

    // Test C : avec filtre dates 2025
    const urlC = `${PENNYLANE_API}/bank_transactions?bank_account_id=${testAccount.id}&min_date=2025-01-01&max_date=2025-12-31&per_page=10`;
    const resC = await fetch(urlC, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const dataC = await resC.json();
    const txListC = dataC.bank_transactions || dataC.transactions || dataC.items || [];
    result.steps.push({
      step: 4,
      name: 'Test C : bank_transactions 2025',
      url: urlC,
      status: resC.status,
      nb_tx: txListC.length,
      response_keys: Object.keys(dataC),
      sample_tx_keys: txListC[0] ? Object.keys(txListC[0]) : [],
      first_3_tx: txListC.slice(0, 3),
    });

    // Test D : API v1 (legacy) au cas où
    const urlD = `https://app.pennylane.com/api/external/v1/transactions?per_page=10`;
    const resD = await fetch(urlD, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
    const dataD = resD.ok ? await resD.json() : { error: resD.status };
    result.steps.push({
      step: 5,
      name: 'Test D : API v1 transactions',
      url: urlD,
      status: resD.status,
      sample: JSON.stringify(dataD).substring(0, 500),
    });

    result.compte_testé = { id: testAccount.id, name: testAccount.name || testAccount.label };

  } catch(e) {
    result.error = { message: e.message, stack: e.stack };
  }

  return new Response(JSON.stringify(result, null, 2), { headers });
};

export const config = { path: '/api/pennylane-debug-sarl' };
