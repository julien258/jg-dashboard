// Récupère les transactions bancaires Pennylane pour détecter les jours de prélèvement
export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });

  const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';
  const SOCIETIES = [
    { key: 'sas-living',   token: process.env.PENNYLANE_LIVING_TOKEN },
    { key: 'sarl-guiraud', token: process.env.PENNYLANE_SARL_TOKEN },
    { key: 'meulette',     token: process.env.PENNYLANE_MEULETTE_TOKEN },
    { key: 'real-gains',   token: process.env.PENNYLANE_REALGAINS_TOKEN },
  ];

  const url = new URL(req.url);
  const societeKey = url.searchParams.get('societe');
  const societes = societeKey ? SOCIETIES.filter(s => s.key === societeKey) : SOCIETIES;

  // Dates : 6 derniers mois
  const dateFrom = new Date();
  dateFrom.setMonth(dateFrom.getMonth() - 6);
  const dateFromStr = dateFrom.toISOString().substring(0, 10);

  const results = await Promise.all(societes.map(async (soc) => {
    if (!soc.token) return { key: soc.key, transactions: [], error: 'Token manquant' };
    try {
      // Récupérer les comptes d'abord
      const comptesRes = await fetch(`${PENNYLANE_API}/bank_accounts`, {
        headers: { 'Authorization': `Bearer ${soc.token}`, 'Accept': 'application/json' }
      });
      const comptesData = await comptesRes.json();
      const comptes = comptesData.bank_accounts || comptesData.items || [];

      // Pour chaque compte, récupérer les transactions
      const allTx = [];
      for (const compte of comptes) {
        try {
          const txRes = await fetch(
            `${PENNYLANE_API}/bank_transactions?bank_account_id=${compte.id}&min_date=${dateFromStr}&per_page=200&sort=-date`,
            { headers: { 'Authorization': `Bearer ${soc.token}`, 'Accept': 'application/json' } }
          );
          const txData = await txRes.json();
          const txList = txData.bank_transactions || txData.transactions || txData.items || [];
          txList.forEach(tx => {
            const amount = parseFloat(tx.amount ?? tx.amount_cents / 100 ?? 0);
            if (amount < 0) { // Seulement les débits
              allTx.push({
                id: tx.id,
                date: tx.date || tx.transaction_date,
                label: tx.description || tx.label || tx.reference || '',
                amount: amount,
                account_id: compte.id,
                account_name: compte.name || compte.label
              });
            }
          });
        } catch(e) { /* compte sans transactions */ }
      }
      return { key: soc.key, transactions: allTx };
    } catch(e) {
      return { key: soc.key, transactions: [], error: e.message };
    }
  }));

  // Analyse des patterns : regrouper par label normalisé et détecter le jour habituel
  const patterns = {};
  results.forEach(soc => {
    (soc.transactions || []).forEach(tx => {
      const labelNorm = tx.label.toUpperCase().replace(/\s+\d{2,}/g, '').trim().substring(0, 40);
      if (!labelNorm || labelNorm.length < 3) return;
      if (!patterns[labelNorm]) patterns[labelNorm] = { societe: soc.key, occurrences: [], amounts: [], days: [] };
      const day = new Date(tx.date).getDate();
      patterns[labelNorm].occurrences.push(tx.date);
      patterns[labelNorm].amounts.push(Math.abs(tx.amount));
      patterns[labelNorm].days.push(day);
    });
  });

  // Filtrer : >= 2 occurrences = récurrent
  const recurring = Object.entries(patterns)
    .filter(([, v]) => v.occurrences.length >= 2)
    .map(([label, v]) => {
      const avgDay = Math.round(v.days.reduce((s, d) => s + d, 0) / v.days.length);
      const avgAmount = Math.round(v.amounts.reduce((s, a) => s + a, 0) / v.amounts.length);
      return { label, societe: v.societe, avg_day: avgDay, avg_amount: avgAmount, count: v.occurrences.length, last_date: v.occurrences.sort().reverse()[0] };
    })
    .sort((a, b) => b.count - a.count);

  return new Response(JSON.stringify({ ok: true, societes: results, recurring_patterns: recurring }), { status: 200, headers });
};

export const config = { path: '/api/pennylane-transactions' };
