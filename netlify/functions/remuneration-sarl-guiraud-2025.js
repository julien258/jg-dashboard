// remuneration-sarl-guiraud-2025.js
// Extrait toutes les transactions 2025 de la SARL GUIRAUD
// Classification automatique : rémunération perso vs CCA vs intra-groupe vs fournisseurs

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
    // 1. Récupérer tous les comptes bancaires SARL GUIRAUD dans Pennylane
    const comptesRes = await fetch(`${PENNYLANE_API}/bank_accounts`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    });
    const comptesData = await comptesRes.json();
    const comptes = comptesData.bank_accounts || comptesData.items || [];

    // 2. Pour chaque compte, pagination complète des transactions 2025
    const allTx = [];
    for (const compte of comptes) {
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= 20) { // Limite de sécurité à 20 pages
        try {
          const txRes = await fetch(
            `${PENNYLANE_API}/bank_transactions?bank_account_id=${compte.id}&min_date=${DATE_FROM}&max_date=${DATE_TO}&per_page=100&page=${page}&sort=date`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
          );
          const txData = await txRes.json();
          const txList = txData.bank_transactions || txData.transactions || txData.items || [];
          if (txList.length === 0) { hasMore = false; break; }
          txList.forEach(tx => {
            allTx.push({
              id: tx.id,
              date: tx.date || tx.transaction_date,
              label: tx.description || tx.label || tx.reference || '',
              amount: parseFloat(tx.amount ?? 0),
              account_id: compte.id,
              account_name: compte.name || compte.label || 'Qonto'
            });
          });
          if (txList.length < 100) hasMore = false;
          page++;
        } catch(e) { hasMore = false; }
      }
    }

    // 3. Classification automatique des sorties (débits = amount < 0)
    const sorties = allTx.filter(tx => tx.amount < 0);

    const categories = {
      remuneration_julien: [],        // Virements vers Julien GUIRAUD perso
      wise_eurl_guiraud: [],          // Vers ancien compte Wise EURL GUIRAUD
      intra_sas_living: [],           // Vers SAS LIVING
      intra_meulette: [],             // Vers La Meulette
      intra_pangee: [],               // Vers Pangée / Holding Pangée
      urssaf: [],                     // URSSAF, cotisations
      impots: [],                     // DGFiP, IS, IR, TVA
      fournisseurs: [],               // Tiers
      leasing_vehicules: [],          // Ayvens, BMW Finance, Viaxel, etc.
      frais_bancaires: [],
      autres: [],
    };

    sorties.forEach(tx => {
      const label = (tx.label || '').toUpperCase();
      
      // 1. Virements vers Julien perso (hors SARL) - patterns variés
      if (/JULIEN\s+GUIRAUD|GUIRAUD\s+JULIEN|JULIEN\s+ANDRE/i.test(label) 
          && !/EURL|SARL|GUIRAUD\s+JULIEN\s+4|GUIRAUD\s+J\.?\s+LA\s+CROIX/i.test(label)) {
        categories.remuneration_julien.push(tx);
      }
      // 2. Wise EURL GUIRAUD (ancien compte)
      else if (/EURL\s+GUIRAUD|WISE.*GUIRAUD|GUIRAUD.*WISE/i.test(label)) {
        categories.wise_eurl_guiraud.push(tx);
      }
      // 3. SAS LIVING
      else if (/SAS\s+LIVING|LIVING/i.test(label) && !/LIVING\s+ROOM/i.test(label)) {
        categories.intra_sas_living.push(tx);
      }
      // 4. Meulette
      else if (/MEULETTE/i.test(label)) {
        categories.intra_meulette.push(tx);
      }
      // 5. Pangée
      else if (/PANGEE|PANGÉE|HOLDING\s+GROUPE/i.test(label)) {
        categories.intra_pangee.push(tx);
      }
      // 6. URSSAF / cotisations
      else if (/URSSAF|COTISATION|CIPAV|RSI|SECURITE\s+SOCIALE|MSA/i.test(label)) {
        categories.urssaf.push(tx);
      }
      // 7. Impôts
      else if (/DGFIP|IMPOT|TRESOR\s+PUBLIC|FINANCES\s+PUBLIQUES|TVA|CVAE|CFE/i.test(label)) {
        categories.impots.push(tx);
      }
      // 8. Leasing véhicules
      else if (/AYVENS|ARVAL|BMW\s+FINANCE|VIAXEL|LLD|LEASEPLAN|ALPHABET|ALD\s+AUTO/i.test(label)) {
        categories.leasing_vehicules.push(tx);
      }
      // 9. Frais bancaires
      else if (/QONTO|FRAIS\s+BANCAIRES|COMMISSION/i.test(label) && Math.abs(tx.amount) < 100) {
        categories.frais_bancaires.push(tx);
      }
      // 10. Autres
      else {
        categories.autres.push(tx);
      }
    });

    // 4. Totaux par catégorie
    const totaux = {};
    for (const [cat, txs] of Object.entries(categories)) {
      totaux[cat] = {
        count: txs.length,
        total: Math.abs(txs.reduce((s, t) => s + t.amount, 0)),
        transactions: txs.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      };
    }

    // 5. Analyse spéciale : le cumul qui pourrait être qualifié CCA
    const total_flux_perso_julien = 
      totaux.remuneration_julien.total + 
      totaux.wise_eurl_guiraud.total;

    return new Response(JSON.stringify({
      ok: true,
      period: { from: DATE_FROM, to: DATE_TO },
      summary: {
        comptes_analysés: comptes.map(c => ({ id: c.id, name: c.name || c.label })),
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
