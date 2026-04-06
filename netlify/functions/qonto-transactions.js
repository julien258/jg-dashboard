// qonto-transactions.js — Transactions Qonto par société
// GET /api/qonto-transactions?account=GUIRAUD&per_page=50&status=completed

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';

const ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    label: 'SARL GUIRAUD',  companyId: 'sarl-guiraud' },
  { envKey: 'QONTO_LIVING',     label: 'SAS LIVING',    companyId: 'sas-living' },
  { envKey: 'QONTO_MEULETTE',   label: 'La Meulette',   companyId: 'meulette' },
  { envKey: 'QONTO_REAL_GAINS', label: 'Real Gains',    companyId: 'real-gains' },
  { envKey: 'QONTO_MONIKAZA',   label: 'Monikaza SPV',  companyId: 'spv-monikaza' },
];

function getCreds(envKey) {
  const val = Netlify.env.get(envKey);
  if (!val) return null;
  const idx = val.indexOf(':');
  return idx === -1 ? null : { login: val.substring(0, idx), secret: val.substring(idx + 1) };
}

async function qontoFetch(login, secret, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${QONTO_BASE}${path}`, {
      headers: { 'Authorization': `${login}:${secret}` },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`Qonto ${res.status}: ${text.substring(0, 200)}`);
    return JSON.parse(text);
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout Qonto');
    throw e;
  }
}

function mapTx(t) {
  return {
    id: t.transaction_id,
    amount: t.amount,
    currency: t.currency,
    side: t.side,
    label: t.label,
    reference: t.reference,
    status: t.status,
    settled_at: t.settled_at,
    emitted_at: t.emitted_at,
    category: t.category,
    note: t.note,
    has_attachments: (t.attachment_ids || []).length > 0,
    attachment_ids: t.attachment_ids || [],
    vat_amount: t.vat_amount,
    vat_rate: t.vat_rate,
  };
}

export default async (req, context) => {
  const url = new URL(req.url);
  const accountFilter = url.searchParams.get('account');
  const perPage = url.searchParams.get('per_page') || '50';
  const status = url.searchParams.get('status') || 'completed';

  if (!accountFilter) {
    return Response.json({ ok: false, error: 'Paramètre account requis' }, { status: 400 });
  }

  const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
  if (!acc) {
    return Response.json({ ok: false, error: 'Compte inconnu: ' + accountFilter }, { status: 400 });
  }

  const creds = getCreds(acc.envKey);
  if (!creds) {
    return Response.json({ ok: false, error: acc.envKey + ' non configuré' }, { status: 500 });
  }

  try {
    // Récupérer tous les comptes de la société
    const orgData = await qontoFetch(creds.login, creds.secret, '/organization');
    const toQuery = orgData.organization?.bank_accounts || [];
    if (!toQuery.length) {
      return Response.json({ ok: false, error: 'Aucun compte bancaire trouvé' }, { status: 404 });
    }

    // Fetcher les transactions pour chaque compte actif
    const allTx = [];
    for (const ba of toQuery) {
      if (!ba.iban) continue;
      try {
        const params = new URLSearchParams({
          iban: ba.iban,
          status,
          current_page: 1,
          per_page: perPage,
          sort_by: 'settled_at:desc'
        });
        const data = await qontoFetch(creds.login, creds.secret, '/transactions?' + params);
        allTx.push(...(data.transactions || []).map(mapTx));
      } catch(e) {
        // Ignorer les erreurs par compte et continuer
      }
    }

    // Dédupliquer et trier
    const seen = new Set();
    const transactions = allTx
      .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; })
      .sort((a, b) => new Date(b.settled_at || b.emitted_at) - new Date(a.settled_at || a.emitted_at));

    return Response.json({
      ok: true,
      account: acc.label,
      companyId: acc.companyId,
      transactions,
      missing_attachments: transactions.filter(t => t.side === 'debit' && !t.has_attachments).length,
    });

  } catch(e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/qonto-transactions' };
