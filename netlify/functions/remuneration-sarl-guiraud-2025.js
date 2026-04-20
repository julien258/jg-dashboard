// remuneration-sarl-guiraud-2025.js v2
// Utilise l'endpoint /transactions correct et pagination
// Nécessite le scope transactions:readonly sur le token PENNYLANE_SARL_TOKEN

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });

  const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';
  const token = process.env.PENNYLANE_SARL_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'PENNYLANE_SARL_TOKEN manquant' }), { status: 400, headers });
  }

  const DATE_FROM = '2025-01-01';
  const DATE_TO = '2025-12-31';

  try {
    // 1. Vérification scope via /me
    const meRes = await fetch(`${PENNYLANE_API}/me`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const meData = await meRes.json();

    // 2. Lister les comptes bancaires
    const ctsRes = await fetch(`${PENNYLANE_API}/bank_accounts`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const ctsData = await ctsRes.json();
    const comptes = ctsData.bank_accounts || ctsData.items || [];

    // 3. Pagination transactions sur toute l'année 2025
    const allTx = [];
    let page = 1;
    let hasMore = true;
    let totalPages = 0;
    let errorDetails = null;
    
    while (hasMore && page <= 50) {
      const filterStr = encodeURIComponent(JSON.stringify([
        { field: "date", operator: "gteq", value: DATE_FROM },
        { field: "date", operator: "lteq", value: DATE_TO }
      ]));
      const url = `${PENNYLANE_API}/transactions?per_page=100&page=${page}&filter=${filterStr}`;
      try {
        const txRes = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        
        if (!txRes.ok) {
          errorDetails = {
            status: txRes.status,
            url: url.substring(0, 200),
            body: (await txRes.text()).substring(0, 300)
          };
          break;
        }
        
        const txData = await txRes.json();
        const txList = txData.transactions || txData.items || txData.data || [];
        
        if (txList.length === 0) { hasMore = false; break; }
        
        txList.forEach(tx => {
          allTx.push({
            id: tx.id,
            date: tx.date || tx.transaction_date || tx.value_date,
            label: tx.description || tx.label || tx.reference || tx.narration || '',
            amount: parseFloat(tx.amount ?? 0),
            currency: tx.currency || 'EUR',
            account_id: tx.bank_account_id || tx.account_id,
            direction: tx.direction || (parseFloat(tx.amount) < 0 ? 'debit' : 'credit'),
          });
        });
        
        totalPages = page;
        if (txList.length < 100) hasMore = false;
        page++;
      } catch(e) {
        errorDetails = { message: e.message, page };
        break;
      }
    }

    // 4. Classification automatique
    const sorties = allTx.filter(tx => tx.amount < 0);

    const categories = {
      remuneration_julien: [],
      wise_eurl_guiraud: [],
      intra_sas_living: [],
      intra_meulette: [],
      intra_pangee: [],
      urssaf: [],
      impots: [],
      fournisseurs: [],
      leasing_vehicules: [],
      frais_bancaires: [],
      autres: [],
    };

    sorties.forEach(tx => {
      const label = (tx.label || '').toUpperCase();
      
      if (/JULIEN\s+(ANDRE\s+RENE\s+)?GUIRAUD|GUIRAUD\s+JULIEN(?!\s+EURL|\s+SARL)/i.test(label)
          && !/EURL|SARL/i.test(label)) {
        categories.remuneration_julien.push(tx);
      }
      else if (/EURL\s+GUIRAUD|WISE.*GUIRAUD|GUIRAUD.*EURL/i.test(label)) {
        categories.wise_eurl_guiraud.push(tx);
      }
      else if (/SAS\s+LIVING|\sLIVING\s/i.test(label)) {
        categories.intra_sas_living.push(tx);
      }
      else if (/MEULETTE/i.test(label)) {
        categories.intra_meulette.push(tx);
      }
      else if (/PANGEE|PANGÉE|HOLDING\s+GROUPE/i.test(label)) {
        categories.intra_pangee.push(tx);
      }
      else if (/URSSAF|COTISATION|CIPAV|RSI|SECURITE\s+SOCIALE|MSA/i.test(label)) {
        categories.urssaf.push(tx);
      }
      else if (/DGFIP|IMPOT|TRESOR\s+PUBLIC|FINANCES\s+PUBLIQUES|TVA|CVAE|CFE/i.test(label)) {
        categories.impots.push(tx);
      }
      else if (/AYVENS|ARVAL|BMW\s+FINANCE|VIAXEL|LLD|LEASEPLAN|ALPHABET|ALD\s+AUTO|PORSCHE\s+FINANCE|FERRARI/i.test(label)) {
        categories.leasing_vehicules.push(tx);
      }
      else if (/(QONTO|WISE|REVOLUT)\s*(FRAIS|COMMISSION)?/i.test(label) && Math.abs(tx.amount) < 100) {
        categories.frais_bancaires.push(tx);
      }
      else {
        categories.autres.push(tx);
      }
    });

    const totaux = {};
    for (const [cat, txs] of Object.entries(categories)) {
      totaux[cat] = {
        count: txs.length,
        total: Math.abs(txs.reduce((s, t) => s + t.amount, 0)),
        transactions: txs.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      };
    }

    const total_flux_perso_julien = totaux.remuneration_julien.total + totaux.wise_eurl_guiraud.total;

    return new Response(JSON.stringify({
      ok: true,
      period: { from: DATE_FROM, to: DATE_TO },
      pagination: { pages_loaded: totalPages, error: errorDetails },
      auth: {
        me_status: meRes.status,
        me_keys: meData ? Object.keys(meData) : [],
      },
      summary: {
        comptes_pennylane: comptes.length,
        total_transactions_2025: allTx.length,
        total_sorties_2025: sorties.length,
        total_flux_vers_perso_julien: total_flux_perso_julien,
        cca_disponible_au_01_01_2025: 349703.73,
        cca_restant_apres_imputation: Math.max(0, 349703.73 - total_flux_perso_julien),
      },
      totaux,
    }, null, 2), { status: 200, headers });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack }), { status: 500, headers });
  }
};

export const config = { path: '/api/remuneration-sarl-guiraud-2025' };
