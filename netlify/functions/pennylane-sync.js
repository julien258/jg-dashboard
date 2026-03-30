// pennylane-sync.js
// Synchronise les données Pennylane pour 3 espaces : LIVING, SARL GUIRAUD, LA MEULETTE

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

export default async (req) => {
  // Lire les tokens — essayer process.env ET Netlify.env
  const getToken = (key) => {
    try { return Netlify.env.get(key) || process.env[key] || null; } 
    catch(e) { return process.env[key] || null; }
  };

  const SOCIETIES = [
    { key: 'living',   label: 'SAS Living',  token: getToken('PENNYLANE_LIVING_TOKEN') },
    { key: 'sarl',     label: 'SARL Guiraud', token: getToken('PENNYLANE_SARL_TOKEN') },
    { key: 'meulette', label: 'La Meulette',  token: getToken('PENNYLANE_MEULETTE_TOKEN') },
  ];

  const url = new URL(req.url);
  const filtre = url.searchParams.get('societe');
  const debug = url.searchParams.get('debug');

  if (debug) {
    return new Response(JSON.stringify({
      env_keys: Object.keys(process.env).filter(k => k.startsWith('PENNYLANE')),
      tokens_found: SOCIETIES.map(s => ({ key: s.key, hasToken: !!s.token, len: s.token?.length }))
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const societes = filtre ? SOCIETIES.filter(s => s.key === filtre) : SOCIETIES;
  const resultats = await Promise.all(societes.map(s => syncSociete(s)));

  const totalSoldes = resultats.reduce((s, r) => s + (r.total_soldes || 0), 0);
  const totalImpayes = resultats.reduce((s, r) => s + (r.total_impayes || 0), 0);
  const totalEnRetard = resultats.reduce((s, r) => s + (r.nb_en_retard || 0), 0);

  return new Response(JSON.stringify({
    ok: true,
    synced_at: new Date().toISOString(),
    groupe: { total_soldes_bancaires: totalSoldes, total_impayes: totalImpayes, nb_factures_en_retard: totalEnRetard },
    societes: resultats
  }), { headers: { 'Content-Type': 'application/json' } });
};

async function fetchPennylane(token, endpoint) {
  const res = await fetch(`${PENNYLANE_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

async function syncSociete(soc) {
  if (!soc.token) {
    return { key: soc.key, label: soc.label, error: 'Token manquant', comptes: [], impayes: [], total_soldes: 0, total_impayes: 0, nb_en_retard: 0 };
  }
  try {
    const comptesData = await fetchPennylane(soc.token, '/bank_accounts');
    const comptes = (comptesData.bank_accounts || []).map(c => ({
      id: c.id, nom: c.name || c.iban || 'Compte',
      solde: parseFloat(c.balance || 0), devise: c.currency || 'EUR',
      iban: c.iban || null, banque: c.bank_name || null
    }));

    const filter = JSON.stringify([{ field: 'status', operator: 'neq', value: 'paid' }]);
    const facturesData = await fetchPennylane(soc.token, `/customer_invoices?filter=${encodeURIComponent(filter)}&per_page=50&sort=-date`);
    const impayes = (facturesData.invoices || []).map(f => ({
      id: f.id, numero: f.invoice_number || f.id,
      client: f.customer_name || '—',
      montant_ttc: parseFloat(f.amount || 0),
      date_emission: f.date || null,
      date_echeance: f.deadline || null,
      statut: f.status || 'unknown',
      en_retard: f.deadline ? new Date(f.deadline) < new Date() : false
    }));

    return {
      key: soc.key, label: soc.label, comptes, impayes,
      total_soldes: comptes.reduce((s, c) => s + c.solde, 0),
      total_impayes: impayes.reduce((s, f) => s + f.montant_ttc, 0),
      nb_en_retard: impayes.filter(f => f.en_retard).length,
      synced_at: new Date().toISOString()
    };
  } catch(e) {
    return { key: soc.key, label: soc.label, error: e.message, comptes: [], impayes: [], total_soldes: 0, total_impayes: 0, nb_en_retard: 0 };
  }
}

export const config = { path: '/api/pennylane-sync' };
