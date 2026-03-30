// pennylane-sync.js
// Synchronise les données Pennylane pour 3 espaces : LIVING, SARL GUIRAUD, LA MEULETTE
// Retourne : soldes bancaires + factures clients impayées

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

const SOCIETIES = [
  { key: 'living',   label: 'SAS Living',       token: process.env.PENNYLANE_LIVING_TOKEN },
  { key: 'sarl',     label: 'SARL Guiraud',      token: process.env.PENNYLANE_SARL_TOKEN },
  { key: 'meulette', label: 'La Meulette',       token: process.env.PENNYLANE_MEULETTE_TOKEN },
];

async function fetchPennylane(token, endpoint) {
  const res = await fetch(`${PENNYLANE_API}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pennylane ${endpoint} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function syncSociete(soc) {
  if (!soc.token) {
    return { key: soc.key, label: soc.label, error: 'Token manquant', comptes: [], impayes: [] };
  }

  try {
    // 1. Comptes bancaires + soldes
    const comptesData = await fetchPennylane(soc.token, '/bank_accounts');
    const comptes = (comptesData.bank_accounts || []).map(c => ({
      id: c.id,
      nom: c.name || c.iban || 'Compte',
      solde: parseFloat(c.balance || 0),
      devise: c.currency || 'EUR',
      iban: c.iban || null,
      banque: c.bank_name || null,
      derniere_maj: c.updated_at || null
    }));

    // 2. Factures clients impayées (statut != paid)
    const filter = JSON.stringify([
      { field: 'status', operator: 'neq', value: 'paid' }
    ]);
    const facturesData = await fetchPennylane(
      soc.token,
      `/customer_invoices?filter=${encodeURIComponent(filter)}&per_page=50&sort=-date`
    );
    const impayes = (facturesData.invoices || []).map(f => ({
      id: f.id,
      numero: f.invoice_number || f.id,
      client: f.customer_name || '—',
      montant_ttc: parseFloat(f.amount || 0),
      montant_ht: parseFloat(f.amount_before_tax || 0),
      date_emission: f.date || null,
      date_echeance: f.deadline || null,
      statut: f.status || 'unknown',
      en_retard: f.deadline ? new Date(f.deadline) < new Date() : false
    }));

    return {
      key: soc.key,
      label: soc.label,
      comptes,
      impayes,
      total_soldes: comptes.reduce((s, c) => s + c.solde, 0),
      total_impayes: impayes.reduce((s, f) => s + f.montant_ttc, 0),
      nb_en_retard: impayes.filter(f => f.en_retard).length,
      synced_at: new Date().toISOString()
    };
  } catch (e) {
    return {
      key: soc.key,
      label: soc.label,
      error: e.message,
      comptes: [],
      impayes: [],
      total_soldes: 0,
      total_impayes: 0
    };
  }
}

export default async (req) => {
  // Optionnel : filtrer sur une seule société via ?societe=living
  const url = new URL(req.url);
  const filtre = url.searchParams.get('societe');

  const societes = filtre
    ? SOCIETIES.filter(s => s.key === filtre)
    : SOCIETIES;

  const resultats = await Promise.all(societes.map(syncSociete));

  // Totaux consolidés groupe
  const totalSoldes = resultats.reduce((s, r) => s + (r.total_soldes || 0), 0);
  const totalImpayes = resultats.reduce((s, r) => s + (r.total_impayes || 0), 0);
  const totalEnRetard = resultats.reduce((s, r) => s + (r.nb_en_retard || 0), 0);

  return new Response(JSON.stringify({
    ok: true,
    synced_at: new Date().toISOString(),
    groupe: {
      total_soldes_bancaires: totalSoldes,
      total_impayes: totalImpayes,
      nb_factures_en_retard: totalEnRetard
    },
    societes: resultats
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
};

export const config = {
  path: '/api/pennylane-sync'
};
