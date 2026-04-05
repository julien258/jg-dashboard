// qonto-bank-sync.js
// Synchronise Qonto + Wise → bank_accounts_pro (upsert + suppression des clôturés)
// POST /api/qonto-bank-sync          → sync tout
// POST /api/qonto-bank-sync?dry=true → simulation sans écriture

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
const WISE_BASE  = 'https://api.wise.com';
const TIMEOUT_MS = 8000;

const QONTO_ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    companyId: 'sarl-guiraud' },
  { envKey: 'QONTO_LIVING',     companyId: 'sas-living' },
  { envKey: 'QONTO_MEULETTE',   companyId: 'meulette' },
  { envKey: 'QONTO_REAL_GAINS', companyId: 'real-gains' },
  { envKey: 'QONTO_MONIKAZA',   companyId: 'spv-monikaza' },
];

// Mapping Wise par profile ID (récupéré via /v1/profiles)
// À mettre à jour quand de nouveaux comptes Wise sont créés
const WISE_PROFILE_ID_MAP = {
  24414380: 'perso',        // JULIEN GUIRAUD — personnel
  24414368: 'real-gains',   // BACK END LOGISTICS — Real Gains
  // À ajouter quand créés :
  // XXXXX: 'sas-living',
  // XXXXX: 'meulette',
};

function wiseCompanyId(profile) {
  return WISE_PROFILE_ID_MAP[profile.id] || (profile.type === 'personal' ? 'perso' : 'real-gains');
}

function getCreds(envKey) {
  const val = Netlify.env.get(envKey);
  if (!val) return null;
  const idx = val.indexOf(':');
  return idx === -1 ? null : { login: val.substring(0, idx), secret: val.substring(idx + 1) };
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch(e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Timeout');
    throw e;
  }
}

async function qontoGet(login, secret, path) {
  const res = await fetchWithTimeout(`${QONTO_BASE}${path}`, {
    headers: { 'Authorization': `${login}:${secret}` }
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Qonto ${res.status}: ${txt.substring(0, 150)}`);
  return JSON.parse(txt);
}

async function wiseGet(token, path) {
  const res = await fetchWithTimeout(`${WISE_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Wise ${res.status}: ${txt.substring(0, 150)}`);
  return JSON.parse(txt);
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${Netlify.env.get('SUPABASE_URL')}/rest/v1${path}`, {
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

// Upsert/suppression générique pour une liste de comptes
async function syncAccounts({ companyId, source, accounts, dryRun }) {
  // accounts = [{ iban, bic, balance, name, currency, external_ref }]
  const existing = await sbFetch(
    `/bank_accounts_pro?company_id=eq.${companyId}&source=eq.${source}&select=id,iban,external_ref`
  );

  const existingByRef = {};
  existing.forEach(e => {
    const key = e.iban || e.external_ref;
    existingByRef[key] = e;
  });

  const incomingRefs = new Set(accounts.map(a => a.iban || a.external_ref));
  let created = 0, updated = 0, deleted = 0;

  for (const acct of accounts) {
    const key = acct.iban || acct.external_ref;
    const payload = {
      company_id: companyId,
      banque: source === 'qonto' ? 'QONTO' : 'WISE',
      iban: acct.iban || null,
      bic: acct.bic || null,
      type_compte: 'courant',
      solde: acct.balance,
      solde_date: new Date().toISOString().split('T')[0],
      source,
      external_ref: acct.external_ref || acct.iban,
      nom_compte: acct.name,
      devise: acct.currency || 'EUR',
    };

    if (!dryRun) {
      if (existingByRef[key]) {
        await sbFetch(
          `/bank_accounts_pro?id=eq.${existingByRef[key].id}`,
          { method: 'PATCH', body: { solde: acct.balance, solde_date: payload.solde_date, nom_compte: acct.name }, prefer: 'return=minimal' }
        );
        updated++;
      } else {
        await sbFetch('/bank_accounts_pro', { method: 'POST', body: payload, prefer: 'return=minimal' });
        created++;
      }
    } else {
      existingByRef[key] ? updated++ : created++;
    }
  }

  // Supprimer les comptes disparus (clôturés)
  for (const ex of existing) {
    const key = ex.iban || ex.external_ref;
    if (!incomingRefs.has(key)) {
      if (!dryRun) {
        await sbFetch(`/bank_accounts_pro?id=eq.${ex.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      }
      deleted++;
    }
  }

  return { created, updated, deleted };
}

export default async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry') === 'true';
  const report = { ok: true, dryRun, created: 0, updated: 0, deleted: 0, errors: [], companies: [] };

  // ── QONTO ─────────────────────────────────────────────────────────────────
  await Promise.allSettled(QONTO_ACCOUNTS.map(async (acc) => {
    const creds = getCreds(acc.envKey);
    if (!creds) { report.errors.push(`${acc.companyId}: QONTO token manquant`); return; }
    try {
      const data = await qontoGet(creds.login, creds.secret, '/organization');
      const accounts = (data.organization?.bank_accounts || []).map(ba => ({
        iban: ba.iban,
        bic: ba.bic,
        balance: ba.balance_cents / 100,
        name: ba.name || 'Compte principal',
        external_ref: ba.slug,
        currency: ba.currency || 'EUR',
      }));
      const r = await syncAccounts({ companyId: acc.companyId, source: 'qonto', accounts, dryRun });
      report.created += r.created;
      report.updated += r.updated;
      report.deleted += r.deleted;
      report.companies.push({ source: 'qonto', companyId: acc.companyId, accounts: accounts.length, ...r });
    } catch(e) {
      report.errors.push(`qonto/${acc.companyId}: ${e.message}`);
    }
  }));

  // ── WISE ──────────────────────────────────────────────────────────────────
  // Chaque token Wise peut couvrir 1 ou plusieurs profils
  const wiseTokens = [
    { envKey: 'WISE_API_TOKEN',    defaultCompanyId: 'perso' },      // perso + real-gains
    { envKey: 'WISE_LIVING_TOKEN', defaultCompanyId: 'sas-living' }, // SAS LIVING
    { envKey: 'WISE_MEULETTE_TOKEN', defaultCompanyId: 'meulette' }, // La Meulette (à ajouter)
  ];

  for (const wt of wiseTokens) {
    const wiseToken = Netlify.env.get(wt.envKey);
    if (!wiseToken) continue;

    try {
      const profiles = await wiseGet(wiseToken, '/v1/profiles');
      await Promise.allSettled(profiles.map(async (profile) => {
        const companyId = wiseCompanyId(profile) || wt.defaultCompanyId;
        try {
          const balances = await wiseGet(wiseToken, `/v4/profiles/${profile.id}/balances?types=STANDARD`);
          const accounts = (Array.isArray(balances) ? balances : [])
            .filter(b => (b.amount?.value ?? 0) !== 0)
            .map(b => ({
              iban: null,
              bic: null,
              balance: b.amount?.value ?? 0,
              name: `Wise ${b.currency || b.amount?.currency}`,
              external_ref: `wise-${profile.id}-${b.currency || b.amount?.currency}`,
              currency: b.currency || b.amount?.currency,
            }));
          const r = await syncAccounts({ companyId, source: 'wise', accounts, dryRun });
          report.created += r.created;
          report.updated += r.updated;
          report.deleted += r.deleted;
          report.companies.push({ source: 'wise', companyId, profileType: profile.type, accounts: accounts.length, ...r });
        } catch(e) {
          report.errors.push(`wise/${wt.envKey}/${profile.type}: ${e.message}`);
        }
      }));
    } catch(e) {
      report.errors.push(`wise/${wt.envKey}: ${e.message}`);
    }
  }

  report.message = dryRun
    ? `Simulation : ${report.created} à créer, ${report.updated} à mettre à jour, ${report.deleted} à supprimer`
    : `Sync OK — Qonto + Wise : ${report.created} créés, ${report.updated} mis à jour, ${report.deleted} supprimés`;

  return Response.json(report);
};

export const config = { path: '/api/qonto-bank-sync' };
