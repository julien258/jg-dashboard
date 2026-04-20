// remuneration-sarl-2025.js
// Extraction DIRECTE via API Qonto SARL GUIRAUD (pas de Pennylane)
// Récupère toutes les transactions 2025, les classifie par catégorie
// Usage : GET /api/remuneration-sarl-2025

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
const DATE_FROM = '2025-01-01';
const DATE_TO = '2025-12-31';

function getQontoCreds() {
  const val = process.env.QONTO_GUIRAUD;
  if (!val) return null;
  const idx = val.indexOf(':');
  return idx === -1 ? null : { login: val.substring(0, idx), secret: val.substring(idx + 1) };
}

async function qontoFetch(login, secret, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${QONTO_BASE}${path}`, {
      headers: { 'Authorization': `${login}:${secret}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`Qonto ${res.status}: ${text.substring(0, 200)}`);
    return JSON.parse(text);
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

function classify(label, reference, note) {
  const txt = ((label || '') + ' ' + (reference || '') + ' ' + (note || '')).toUpperCase();

  // 1. Virements vers Julien perso (pas EURL ni SARL)
  if (/JULIEN\s+(ANDRE\s+RENE\s+)?GUIRAUD|GUIRAUD\s+JULIEN/i.test(txt)
      && !/EURL|SARL/i.test(txt)) {
    return 'remuneration_julien';
  }
  // 2. Ancien compte Wise EURL GUIRAUD
  if (/EURL\s+GUIRAUD|TRANSFERWISE|WISE\s+EUROPE/i.test(txt)) {
    return 'wise_eurl_guiraud';
  }
  // 3. SAS LIVING
  if (/SAS\s+LIVING|\bLIVING\b/i.test(txt)) return 'intra_sas_living';
  // 4. Meulette
  if (/MEULETTE/i.test(txt)) return 'intra_meulette';
  // 5. Pangée
  if (/PANGEE|PANGÉE|HOLDING\s+GROUPE/i.test(txt)) return 'intra_pangee';
  // 6. Real Gains / Monikaza
  if (/REAL\s+GAINS|MONIKAZA|BACK\s+END\s+LOGISTICS/i.test(txt)) return 'intra_real_gains';
  // 7. URSSAF / cotisations
  if (/URSSAF|COTISATION|CIPAV|RSI|SECURITE\s+SOCIALE|SS\s*INDEPENDANTS|MSA/i.test(txt)) return 'urssaf';
  // 8. Impôts
  if (/DGFIP|IMPOT|TRESOR\s+PUBLIC|FINANCES\s+PUBLIQUES|TVA|CVAE|CFE|DIR\s+GENERALE/i.test(txt)) return 'impots';
  // 9. Leasing véhicules
  if (/AYVENS|ARVAL|BMW\s+FINANCE|VIAXEL|LLD|LEASEPLAN|ALPHABET|ALD\s+AUTO|PORSCHE\s+FINANCE|FERRARI|LOA\s+AUTO|FREE2MOVE|COBALT\s+AUTO/i.test(txt)) return 'leasing_vehicules';
  // 10. Carburant
  if (/TOTAL\s*ENERGIES|TOTALENERGIES|SHELL|ESSO|BP\s+STATION|AVIA|INTERMARCHE.*STATION|CARREFOUR.*STATION/i.test(txt)) return 'carburant';
  // 11. Frais bancaires
  if (/QONTO|WISE\s*$|COMMISSION|FRAIS\s+BANCAIRES/i.test(txt) && label.length < 40) return 'frais_bancaires';
  // 12. Assurance
  if (/ALLIANZ|MATMUT|AXA|MACIF|GENERALI|GMF|MMA|MATRISK|MAAF/i.test(txt)) return 'assurance';
  // Par défaut
  return 'autres';
}

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });

  const result = {
    period: { from: DATE_FROM, to: DATE_TO },
    source: 'Qonto SARL GUIRAUD (API directe)',
    accounts: [],
    total_transactions: 0,
    errors: [],
  };

  try {
    const creds = getQontoCreds();
    if (!creds) {
      return new Response(JSON.stringify({ ok: false, error: 'QONTO_GUIRAUD non configuré' }), { status: 500, headers });
    }

    // 1. Récupérer les comptes Qonto de la SARL GUIRAUD
    const orgData = await qontoFetch(creds.login, creds.secret, '/organization');
    const bankAccounts = orgData?.organization?.bank_accounts || [];

    if (bankAccounts.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Aucun compte trouvé', raw_org: orgData }), { status: 200, headers });
    }

    // 2. Pour chaque compte, paginer les transactions 2025
    const allTx = [];
    for (const acc of bankAccounts) {
      const accId = acc.id || acc.slug;
      result.accounts.push({
        id: accId,
        name: acc.name || acc.slug,
        iban: acc.iban,
        balance: acc.balance,
      });

      let page = 1;
      const maxPages = 30;
      while (page <= maxPages) {
        const path = `/transactions?bank_account_id=${encodeURIComponent(accId)}&settled_at_from=${DATE_FROM}T00:00:00.000Z&settled_at_to=${DATE_TO}T23:59:59.999Z&per_page=100&current_page=${page}&sort_by=settled_at:asc`;
        try {
          const data = await qontoFetch(creds.login, creds.secret, path);
          const txs = data.transactions || [];
          if (txs.length === 0) break;
          txs.forEach(t => {
            const side = t.side; // 'debit' ou 'credit'
            const signedAmount = Number(t.amount || 0) * (side === 'debit' ? -1 : 1);
            allTx.push({
              account_name: acc.name || acc.slug,
              id: t.transaction_id,
              date: (t.settled_at || t.emitted_at || '').substring(0, 10),
              label: t.label || '',
              reference: t.reference || '',
              note: t.note || '',
              side: side,
              amount: signedAmount,
              currency: t.currency || 'EUR',
              category_qonto: t.category || '',
            });
          });
          if (txs.length < 100) break;
          page++;
        } catch(e) {
          result.errors.push({ account: accId, page, error: e.message });
          break;
        }
      }
    }

    result.total_transactions = allTx.length;

    // 3. Séparer sorties (debit) et entrées (credit)
    const sorties = allTx.filter(t => t.amount < 0);
    const entrees = allTx.filter(t => t.amount > 0);

    // 4. Classifier les sorties
    const sortiesParCat = {};
    for (const tx of sorties) {
      const cat = classify(tx.label, tx.reference, tx.note);
      if (!sortiesParCat[cat]) sortiesParCat[cat] = [];
      sortiesParCat[cat].push(tx);
    }

    // 5. Totaux par catégorie
    const totaux = {};
    for (const [cat, txs] of Object.entries(sortiesParCat)) {
      totaux[cat] = {
        count: txs.length,
        total_absolu: Math.abs(txs.reduce((s, t) => s + t.amount, 0)),
        transactions: txs.sort((a, b) => a.date.localeCompare(b.date)),
      };
    }

    // 6. Focus : flux qualifiables en rémunération OU remboursement CCA
    const flux_perso = (totaux.remuneration_julien?.total_absolu || 0) + (totaux.wise_eurl_guiraud?.total_absolu || 0);
    const cca_dispo = 349703.73;

    return new Response(JSON.stringify({
      ok: true,
      period: result.period,
      source: result.source,
      accounts: result.accounts,
      errors: result.errors,
      summary: {
        total_transactions_2025: allTx.length,
        total_sorties: sorties.length,
        total_entrees: entrees.length,
        total_sorties_EUR: Math.abs(sorties.reduce((s, t) => s + t.amount, 0)),
        total_entrees_EUR: entrees.reduce((s, t) => s + t.amount, 0),
        flux_vers_perso_julien_2025: flux_perso,
        cca_disponible_au_01_01_2025: cca_dispo,
        cca_restant_si_tout_imputé_CCA: Math.max(0, cca_dispo - flux_perso),
      },
      totaux_par_categorie: totaux,
    }, null, 2), { status: 200, headers });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack }), { status: 500, headers });
  }
};

export const config = { path: '/api/remuneration-sarl-2025' };
