// pennylane-sync.js — Synchronise soldes bancaires + factures impayées

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

export default async (req) => {
  const getToken = (key) => {
    try { return Netlify.env.get(key) || process.env[key] || null; }
    catch(e) { return process.env[key] || null; }
  };

  const SOCIETIES = [
    { key: 'living',   label: 'SAS Living',   token: getToken('PENNYLANE_LIVING_TOKEN') },
    { key: 'sarl',     label: 'SARL Guiraud', token: getToken('PENNYLANE_SARL_TOKEN') },
    { key: 'meulette', label: 'La Meulette',  token: getToken('PENNYLANE_MEULETTE_TOKEN') },
  ];

  const url = new URL(req.url);
  const filtre = url.searchParams.get('societe');
  const societes = filtre ? SOCIETIES.filter(s => s.key === filtre) : SOCIETIES;

  const resultats = await Promise.all(societes.map(syncSociete));

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
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.substring(0, 300)}`);
  try { return JSON.parse(text); } catch(e) { throw new Error('JSON invalide: ' + text.substring(0, 100)); }
}

async function syncSociete(soc) {
  if (!soc.token) {
    return { key: soc.key, label: soc.label, error: 'Token manquant', comptes: [], impayes: [], total_soldes: 0, total_impayes: 0, nb_en_retard: 0 };
  }

  const result = { key: soc.key, label: soc.label, comptes: [], impayes: [], total_soldes: 0, total_impayes: 0, nb_en_retard: 0, errors: [] };

  // 1. Comptes bancaires — endpoint sans filtre
  try {
    const data = await fetchPennylane(soc.token, '/bank_accounts');
    // Pennylane retourne { bank_accounts: [...] } ou directement un tableau
    const liste = data.bank_accounts || data.items || (Array.isArray(data) ? data : []);
    result.comptes = liste.map(c => ({
      id: c.id,
      nom: c.name || c.label || 'Compte',
      solde: parseFloat(c.balance?.amount ?? c.balance?.value ?? c.balance ?? c.current_balance ?? c.last_balance ?? 0),
      devise: c.balance?.currency || c.currency || 'EUR',
      iban: c.iban || null,
      banque: c.institution_name || c.bank_name || c.provider_name || null,
      raw: JSON.stringify(c).substring(0, 200)
    }));
    result.total_soldes = result.comptes.reduce((s, c) => s + c.solde, 0);
  } catch(e) {
    result.errors.push('Comptes bancaires: ' + e.message);
  }

  // 2. Factures clients impayées — statut not_paid ou draft
  try {
    // Essayer sans filtre complexe d'abord, filtrer côté client
    const data = await fetchPennylane(soc.token, '/customer_invoices?per_page=50&sort=-date');
    const liste = data.invoices || data.customer_invoices || data.items || (Array.isArray(data) ? data : []);
    const impayes = liste.filter(f => f.status && !['paid', 'cancelled'].includes(f.status));
    result.impayes = impayes.map(f => ({
      id: f.id,
      numero: f.invoice_number || f.label || f.id,
      client: f.customer?.name || f.customer?.customer_name || f.customer_name || f.label?.split(' - ')[0] || '—',
      montant_ttc: parseFloat(f.amount || f.total_amount || 0),
      date_emission: f.date || f.issue_date || null,
      date_echeance: f.deadline || f.due_date || null,
      statut: f.status,
      en_retard: (f.deadline || f.due_date) ? new Date(f.deadline || f.due_date) < new Date() : false
    }));
    result.total_impayes = result.impayes.reduce((s, f) => s + f.montant_ttc, 0);
    result.nb_en_retard = result.impayes.filter(f => f.en_retard).length;
  } catch(e) {
    result.errors.push('Factures: ' + e.message);
  }

  if (result.errors.length > 0) result.error = result.errors.join(' | ');
  result.synced_at = new Date().toISOString();
  return result;
}

export const config = { path: '/api/pennylane-sync' };
