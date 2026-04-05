// qonto-bank-sync.js
// Synchronise les comptes Qonto vers bank_accounts_pro (upsert + suppression des clôturés)
// POST /api/qonto-bank-sync          → sync tous les comptes
// POST /api/qonto-bank-sync?dry=true → simulation sans écriture

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
const TIMEOUT_MS = 8000;

const ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    companyId: 'sarl-guiraud' },
  { envKey: 'QONTO_LIVING',     companyId: 'sas-living' },
  { envKey: 'QONTO_MEULETTE',   companyId: 'meulette' },
  { envKey: 'QONTO_REAL_GAINS', companyId: 'real-gains' },
  { envKey: 'QONTO_MONIKAZA',   companyId: 'spv-monikaza' },
];

function getCreds(envKey) {
  const val = Netlify.env.get(envKey);
  if (!val) return null;
  const idx = val.indexOf(':');
  return idx === -1 ? null : { login: val.substring(0, idx), secret: val.substring(idx + 1) };
}

async function qontoGet(login, secret, path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${QONTO_BASE}${path}`, {
      headers: { 'Authorization': `${login}:${secret}` },
      signal: ctrl.signal
    });
    clearTimeout(t);
    const txt = await res.text();
    if (!res.ok) throw new Error(`Qonto ${res.status}: ${txt.substring(0, 150)}`);
    return JSON.parse(txt);
  } catch(e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Timeout Qonto');
    throw e;
  }
}

async function sbFetch(path, opts = {}) {
  const url = `${Netlify.env.get('SUPABASE_URL')}/rest/v1${path}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'apikey': Netlify.env.get('SUPABASE_SERVICE_KEY'),
      'Authorization': `Bearer ${Netlify.env.get('SUPABASE_SERVICE_KEY')}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${txt.substring(0, 150)}`);
  return txt ? JSON.parse(txt) : [];
}

export default async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry') === 'true';

  const report = { synced: 0, created: 0, updated: 0, deleted: 0, errors: [], companies: [] };

  const results = await Promise.allSettled(ACCOUNTS.map(async (acc) => {
    const creds = getCreds(acc.envKey);
    if (!creds) {
      report.errors.push(`${acc.companyId}: token manquant`);
      return;
    }

    try {
      // 1. Récupérer les comptes Qonto
      const data = await qontoGet(creds.login, creds.secret, '/organization');
      const qontoAccounts = (data.organization?.bank_accounts || []).map(ba => ({
        iban: ba.iban,
        bic: ba.bic,
        balance: ba.balance_cents / 100,
        name: ba.name || 'Compte principal',
        slug: ba.slug,
        currency: ba.currency || 'EUR',
      }));

      // 2. Récupérer les comptes Qonto existants en base pour cette société
      const existing = await sbFetch(
        `/bank_accounts_pro?company_id=eq.${acc.companyId}&source=eq.qonto&select=id,iban,external_ref`
      );

      const existingByIban = {};
      existing.forEach(e => { existingByIban[e.iban] = e; });
      const qontoIbans = new Set(qontoAccounts.map(a => a.iban));

      let created = 0, updated = 0, deleted = 0;

      // 3. Upsert chaque compte Qonto
      for (const qa of qontoAccounts) {
        const payload = {
          company_id: acc.companyId,
          banque: 'QONTO',
          iban: qa.iban,
          bic: qa.bic,
          type_compte: 'courant',
          solde: qa.balance,
          solde_date: new Date().toISOString().split('T')[0],
          source: 'qonto',
          external_ref: qa.slug,
          nom_compte: qa.name,
          devise: qa.currency,
        };

        if (!dryRun) {
          if (existingByIban[qa.iban]) {
            // Update
            await sbFetch(
              `/bank_accounts_pro?id=eq.${existingByIban[qa.iban].id}`,
              { method: 'PATCH', body: { solde: qa.balance, solde_date: payload.solde_date, nom_compte: qa.name }, prefer: 'return=minimal' }
            );
            updated++;
          } else {
            // Insert
            await sbFetch('/bank_accounts_pro', { method: 'POST', body: payload, prefer: 'return=minimal' });
            created++;
          }
        } else {
          existingByIban[qa.iban] ? updated++ : created++;
        }
      }

      // 4. Supprimer les comptes Qonto qui n'existent plus
      for (const ex of existing) {
        if (!qontoIbans.has(ex.iban)) {
          if (!dryRun) {
            await sbFetch(`/bank_accounts_pro?id=eq.${ex.id}`, { method: 'DELETE', prefer: 'return=minimal' });
          }
          deleted++;
        }
      }

      report.synced++;
      report.created += created;
      report.updated += updated;
      report.deleted += deleted;
      report.companies.push({ companyId: acc.companyId, accounts: qontoAccounts.length, created, updated, deleted });

    } catch(e) {
      report.errors.push(`${acc.companyId}: ${e.message}`);
    }
  }));

  return Response.json({
    ok: true,
    dryRun,
    ...report,
    message: dryRun
      ? `Simulation : ${report.created} à créer, ${report.updated} à mettre à jour, ${report.deleted} à supprimer`
      : `Sync OK : ${report.created} créés, ${report.updated} mis à jour, ${report.deleted} supprimés`
  });
};

export const config = { path: '/api/qonto-bank-sync' };
