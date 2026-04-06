// pennylane-factures.js
// GET /api/pennylane-factures?mois=2026-03
// Retourne toutes les factures émises du mois par société

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

const SOCIETIES = [
  { key: 'sas-living',  label: 'SAS LIVING',   envKey: 'PENNYLANE_LIVING_TOKEN' },
  { key: 'sarl-guiraud',label: 'SARL GUIRAUD', envKey: 'PENNYLANE_SARL_TOKEN' },
  { key: 'meulette',    label: 'La Meulette',  envKey: 'PENNYLANE_MEULETTE_TOKEN' },
  { key: 'real-gains',  label: 'Real Gains',   envKey: 'PENNYLANE_REALGAINS_TOKEN' },
];

async function fetchPennylane(token, endpoint) {
  const res = await fetch(`${PENNYLANE_API}${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error(`Pennylane ${res.status}: ${await res.text().then(t => t.substring(0,100))}`);
  return res.json();
}

export default async (req) => {
  const url = new URL(req.url);
  const mois = url.searchParams.get('mois') || '2026-03';

  // Calculer début et fin du mois
  const dateFrom = mois + '-01';
  const [year, month] = mois.split('-').map(Number);
  const nextM = month === 12 ? '01' : String(month + 1).padStart(2, '0');
  const nextY = month === 12 ? year + 1 : year;
  const dateTo = `${nextY}-${nextM}-01`;

  const results = await Promise.allSettled(SOCIETIES.map(async (soc) => {
    const token = Netlify.env.get(soc.envKey);
    if (!token) return { ...soc, factures: [], error: 'Token manquant', total: 0 };

    try {
      // Pennylane ne supporte pas de filtre de date direct — on récupère les 100 dernières et on filtre
      const data = await fetchPennylane(token,
        `/customer_invoices?per_page=100&sort=-date`
      );
      const liste = data.invoices || data.customer_invoices || data.items || (Array.isArray(data) ? data : []);

      // Filtrer par mois côté JS
      const factures = liste
        .filter(f => (f.date || f.invoice_date || '').substring(0, 7) === mois)
        .map(f => ({
        id: f.id,
        numero: f.invoice_number || f.label || f.id,
        client: f.customer?.name || f.customer_name || f.billing_name || '—',
        montant_ht: parseFloat(f.amount_without_tax || f.amount_ht || 0),
        montant_ttc: parseFloat(f.amount || f.total || 0),
        date: f.date || f.invoice_date || null,
        echeance: f.deadline || f.due_date || null,
        statut: f.status || '—',
        paye: ['paid', 'paye', 'closed'].includes((f.status || '').toLowerCase()),
        pdf_url: f.pdf_url || f.file_url || null,
        pennylane_url: `https://app.pennylane.com/invoices/${f.id}`,
      }));

      return {
        ...soc,
        factures,
        total_ht: factures.reduce((s, f) => s + f.montant_ht, 0),
        total_ttc: factures.reduce((s, f) => s + f.montant_ttc, 0),
        nb_payees: factures.filter(f => f.paye).length,
        error: null
      };
    } catch(e) {
      return { ...soc, factures: [], total_ht: 0, total_ttc: 0, error: e.message };
    }
  }));

  const societes = results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { ...SOCIETIES[i], factures: [], error: r.reason?.message, total_ht: 0, total_ttc: 0 }
  );

  return Response.json({
    ok: true,
    mois,
    societes,
    total_ttc: societes.reduce((s, soc) => s + (soc.total_ttc || 0), 0),
  });
};

export const config = { path: '/api/pennylane-factures' };
