// cloture-mensuelle.js
// Gère la clôture mensuelle : relevés Qonto, checklist documents, statut pièces manquantes
// GET /api/cloture-mensuelle?mois=2026-03                → checklist complète
// GET /api/cloture-mensuelle?mois=2026-03&action=statements → relevés Qonto disponibles
// GET /api/cloture-mensuelle?mois=2026-03&action=missing&account=GUIRAUD → pièces manquantes

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
const TIMEOUT_MS = 10000;

const ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    companyId: 'sarl-guiraud',  label: 'SARL GUIRAUD',
    extraDocs: [{ label: 'CA Aquitaine', keys: ['credit-agricole', 'cr-dit-agricole', 'ca-aquitaine', 'credit agricole'] }] },
  { envKey: 'QONTO_LIVING',     companyId: 'sas-living',    label: 'SAS LIVING',
    extraDocs: [] },
  { envKey: 'QONTO_MEULETTE',   companyId: 'meulette',      label: 'La Meulette',
    extraDocs: [
      { label: 'CA Aquitaine', keys: ['credit-agricole', 'cr-dit-agricole', 'ca-aquitaine', 'credit agricole'] },
      { label: 'Banque Populaire', keys: ['banque-populaire', 'banque populaire', 'bpoc', 'bp-occ'] },
    ] },
  { envKey: 'QONTO_REAL_GAINS', companyId: 'real-gains',    label: 'Real Gains',
    extraDocs: [] },
  { envKey: 'QONTO_MONIKAZA',   companyId: 'spv-monikaza',  label: 'Monikaza SPV',
    extraDocs: [] },
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
    if (!res.ok) throw new Error(`Qonto ${res.status}: ${txt.substring(0, 200)}`);
    return JSON.parse(txt);
  } catch(e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error('Timeout Qonto');
    throw e;
  }
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

// Récupère les relevés Qonto disponibles pour un compte et un mois
async function getStatements(login, secret, mois) {
  try {
    // Liste tous les comptes bancaires
    const orgData = await qontoGet(login, secret, '/organization');
    const bankAccounts = orgData.organization?.bank_accounts || [];
    
    const statements = [];
    for (const ba of bankAccounts) {
      try {
        // Récupère les relevés pour ce compte
        const data = await qontoGet(login, secret, `/bank_accounts/${ba.slug}/statements`);
        const stmts = data.statements || data.bank_statements || [];
        
        // Filtre sur le mois demandé
        const filtered = stmts.filter(s => {
          const period = s.period_start || s.start_date || s.created_at || '';
          return period.startsWith(mois);
        });
        
        statements.push(...filtered.map(s => ({
          id: s.id,
          iban: ba.iban,
          compte_name: ba.name || 'Compte principal',
          period: s.period_start || s.start_date,
          url: s.url || s.download_url || null,
          status: s.status || 'available',
        })));
      } catch(e) {
        // Continuer si un compte n'a pas de relevé
      }
    }
    return statements;
  } catch(e) {
    return [];
  }
}

// Récupère les transactions sans pièce jointe pour un mois
async function getMissingAttachments(login, secret, mois) {
  try {
    const orgData = await qontoGet(login, secret, '/organization');
    const slug = orgData.organization?.bank_accounts?.[0]?.slug;
    if (!slug) return [];

    const dateFrom = `${mois}-01T00:00:00.000Z`;
    const [year, month] = mois.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const dateTo = `${mois}-${String(lastDay).padStart(2,'0')}T23:59:59.999Z`;

    const params = new URLSearchParams({
      bank_account_slug: slug,
      status: 'completed',
      settled_at_from: dateFrom,
      settled_at_to: dateTo,
      per_page: '100',
      sort_by: 'settled_at:desc'
    });

    const data = await qontoGet(login, secret, `/transactions?${params}`);
    const txs = data.transactions || [];

    return txs
      .filter(t => t.side === 'debit' && (t.attachment_ids || []).length === 0)
      .map(t => ({
        id: t.transaction_id,
        label: t.label,
        amount: t.amount,
        settled_at: t.settled_at,
        category: t.category,
      }));
  } catch(e) {
    return [];
  }
}

// Compte les transactions du mois
async function getTransactionCount(login, secret, mois) {
  try {
    const orgData = await qontoGet(login, secret, '/organization');
    const slug = orgData.organization?.bank_accounts?.[0]?.slug;
    if (!slug) return { total: 0, debit: 0, credit: 0 };

    const [year, month] = mois.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();

    const params = new URLSearchParams({
      bank_account_slug: slug,
      status: 'completed',
      settled_at_from: `${mois}-01T00:00:00.000Z`,
      settled_at_to: `${mois}-${String(lastDay).padStart(2,'0')}T23:59:59.999Z`,
      per_page: '100',
    });

    const data = await qontoGet(login, secret, `/transactions?${params}`);
    const txs = data.transactions || [];
    return {
      total: txs.length,
      debit: txs.filter(t => t.side === 'debit').length,
      credit: txs.filter(t => t.side === 'credit').length,
      missing_attachments: txs.filter(t => t.side === 'debit' && (t.attachment_ids||[]).length === 0).length,
      meta: data.meta || {}
    };
  } catch(e) {
    return { total: 0, debit: 0, credit: 0, missing_attachments: 0, error: e.message };
  }
}

// Vérifie les documents uploadés dans la GED pour ce mois
async function getGedDocuments(companyId, mois) {
  try {
    // Fenêtre élargie : du 1er du mois au 15 du mois suivant
    // (les relevés arrivent souvent début du mois suivant)
    const dateFrom = mois + '-01';
    const year = parseInt(mois.split('-')[0]);
    const month = parseInt(mois.split('-')[1]);
    const nextMonth = month === 12 ? '01' : String(month + 1).padStart(2, '0');
    const nextYear = month === 12 ? year + 1 : year;
    const dateTo = `${nextYear}-${nextMonth}-15`;

    // Récupérer tous les relevés de cette société (doc_type=releve)
    const data = await sbFetch(
      `/ged_documents?company_id=eq.${companyId}&doc_type=eq.releve&select=id,file_name,doc_type,doc_date,created_at`
    );

    // Filtrer : doc_date dans la fenêtre OU nom de fichier contenant le mois
    const moisNoms = {
      '01': ['janvier', 'jan'],
      '02': ['fevrier', 'fev', 'feb'],
      '03': ['mars', 'mar'],
      '04': ['avril', 'avr', 'apr'],
      '05': ['mai', 'may'],
      '06': ['juin', 'jun'],
      '07': ['juillet', 'jul'],
      '08': ['aout', 'aug'],
      '09': ['septembre', 'sep'],
      '10': ['octobre', 'oct'],
      '11': ['novembre', 'nov'],
      '12': ['decembre', 'dec'],
    };
    const moisKeys = moisNoms[String(month).padStart(2, '0')] || [];
    const moisStr = mois.replace('-', '-'); // ex: 2026-03

    return (data || []).filter(d => {
      const fname = (d.file_name || '').toLowerCase();
      const dateOk = d.doc_date && d.doc_date >= dateFrom && d.doc_date <= dateTo;
      const nameOk = fname.includes(moisStr) || moisKeys.some(k => fname.includes(k));
      return dateOk || nameOk;
    });
  } catch(e) {
    return [];
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const mois = url.searchParams.get('mois') || '2026-03';
  const action = url.searchParams.get('action') || 'checklist';
  const accountFilter = url.searchParams.get('account');

  const moisLabel = new Date(mois + '-15').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  try {

    // ── CHECKLIST COMPLÈTE ────────────────────────────────────────────────
    if (action === 'checklist') {
      const results = await Promise.allSettled(ACCOUNTS.map(async (acc) => {
        const creds = getCreds(acc.envKey);
        if (!creds) return { ...acc, error: 'Token manquant', txCount: null, statements: [], gedDocs: [], missingDocs: acc.extraDocs };

        const [txCount, statements, gedDocs] = await Promise.allSettled([
          getTransactionCount(creds.login, creds.secret, mois),
          getStatements(creds.login, creds.secret, mois),
          getGedDocuments(acc.companyId, mois),
        ]);

        const gedDocsData = gedDocs.status === 'fulfilled' ? gedDocs.value : [];
        const gedFileNames = gedDocsData.map(d => (d.file_name || '').toLowerCase());

        // Vérifie quels documents manuels manquent encore
        const missingDocs = acc.extraDocs.filter(doc => {
          const keys = doc.keys || [doc.toLowerCase()];
          return !gedFileNames.some(fname => keys.some(k => fname.includes(k)));
        }).map(doc => doc.label || doc);

        return {
          ...acc,
          txCount: txCount.status === 'fulfilled' ? txCount.value : null,
          statements: statements.status === 'fulfilled' ? statements.value : [],
          gedDocs: gedDocsData,
          missingDocs,
          ready: missingDocs.length === 0 && (txCount.status === 'fulfilled' ? txCount.value.missing_attachments === 0 : false),
        };
      }));

      const checklist = results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { ...ACCOUNTS[i], error: r.reason?.message }
      );

      const totalMissing = checklist.reduce((s, c) => s + (c.missingDocs?.length || 0), 0);
      const totalMissingAttachments = checklist.reduce((s, c) => s + (c.txCount?.missing_attachments || 0), 0);
      const allReady = checklist.every(c => c.ready);

      return Response.json({
        ok: true,
        mois,
        moisLabel,
        checklist,
        summary: {
          totalMissingDocs: totalMissing,
          totalMissingAttachments,
          allReady,
          societesReady: checklist.filter(c => c.ready).length,
          societesTotal: checklist.length,
        }
      });
    }

    // ── PIÈCES MANQUANTES PAR COMPTE ─────────────────────────────────────
    if (action === 'missing') {
      if (!accountFilter) return Response.json({ ok: false, error: 'account requis' }, { status: 400 });
      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return Response.json({ ok: false, error: 'Compte inconnu' }, { status: 400 });

      const creds = getCreds(acc.envKey);
      if (!creds) return Response.json({ ok: false, error: 'Token manquant' }, { status: 500 });

      const missing = await getMissingAttachments(creds.login, creds.secret, mois);
      return Response.json({ ok: true, account: acc.label, mois, moisLabel, missing_count: missing.length, missing });
    }

    // ── RELEVÉS DISPONIBLES ───────────────────────────────────────────────
    if (action === 'statements') {
      const toFetch = accountFilter
        ? ACCOUNTS.filter(a => a.envKey.includes(accountFilter.toUpperCase()))
        : ACCOUNTS;

      const results = await Promise.allSettled(toFetch.map(async (acc) => {
        const creds = getCreds(acc.envKey);
        if (!creds) return { companyId: acc.companyId, label: acc.label, statements: [], error: 'Token manquant' };
        const stmts = await getStatements(creds.login, creds.secret, mois);
        return { companyId: acc.companyId, label: acc.label, statements: stmts };
      }));

      return Response.json({
        ok: true, mois, moisLabel,
        accounts: results.map((r, i) =>
          r.status === 'fulfilled' ? r.value : { ...toFetch[i], statements: [], error: r.reason?.message }
        )
      });
    }

    return Response.json({ ok: false, error: 'Action inconnue: ' + action }, { status: 400 });

  } catch(e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/cloture-mensuelle' };
