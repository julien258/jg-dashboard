// qonto-sync v2 - qonto-sync.js — Proxy API Qonto multi-comptes

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
const TIMEOUT_MS = 5000;

const ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    label: 'SARL GUIRAUD',  companyId: 'sarl-guiraud' },
  { envKey: 'QONTO_LIVING',     label: 'SAS LIVING',    companyId: 'sas-living' },
  { envKey: 'QONTO_MEULETTE',   label: 'La Meulette',   companyId: 'meulette' },
  { envKey: 'QONTO_REAL_GAINS', label: 'Real Gains',    companyId: 'real-gains' },
  { envKey: 'QONTO_MONIKAZA',   label: 'Monikaza SPV',  companyId: 'spv-monikaza' },
];

function getCredentials(envKey) {
  const val = Netlify.env.get(envKey);
  if (!val) return null;
  const idx = val.indexOf(':');
  if (idx === -1) return null;
  return { login: val.substring(0, idx), secret: val.substring(idx + 1) };
}

async function qontoFetch(login, secret, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${QONTO_BASE}${path}`, {
      headers: { 'Authorization': `${login}:${secret}` },
      signal: controller.signal
    });
    clearTimeout(timer);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
    return JSON.parse(text);
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Timeout Qonto (8s)');
    throw e;
  }
}

async function fetchAccountBalances(acc) {
  const creds = getCredentials(acc.envKey);
  if (!creds) return { ...acc, configured: false, bank_accounts: [], total_balance: 0, error: 'Token manquant' };

  try {
    const data = await qontoFetch(creds.login, creds.secret, '/organization');
    const org = data.organization;
    const bankAccounts = (org.bank_accounts || []).map(ba => ({
      iban: ba.iban,
      bic: ba.bic,
      currency: ba.currency,
      balance: ba.balance_cents / 100,
      authorized_balance: ba.authorized_balance_cents / 100,
      name: ba.name || 'Compte principal',
      slug: ba.slug,
    }));
    return {
      ...acc,
      configured: true,
      org_name: org.legal_name || org.slug,
      bank_accounts: bankAccounts,
      total_balance: bankAccounts.reduce((s, b) => s + b.balance, 0),
    };
  } catch(e) {
    return { ...acc, configured: true, error: e.message, bank_accounts: [], total_balance: 0 };
  }
}

export default async (req, context) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'balances';
  const accountFilter = url.searchParams.get('account');

  try {

    // ── BALANCES ─────────────────────────────────────────────────────────
    if (action === 'balances') {
      const toFetch = accountFilter
        ? ACCOUNTS.filter(a => a.envKey.includes(accountFilter.toUpperCase()))
        : ACCOUNTS;

      const settled = await Promise.allSettled(toFetch.map(fetchAccountBalances));
      const accounts = settled.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { ...toFetch[i], error: r.reason?.message, bank_accounts: [], total_balance: 0 }
      );
      const totalQonto = accounts.reduce((s, a) => s + (a.total_balance || 0), 0);

      // Ajouter les soldes Wise depuis bank_accounts_pro
      let totalWise = 0;
      try {
        const sbUrl = Netlify.env.get('SUPABASE_URL') || 'https://uqpgwypgkwlvrpxtxhia.supabase.co';
        const sbKey = Netlify.env.get('SUPABASE_SERVICE_KEY');
        const wRes = await fetch(`${sbUrl}/rest/v1/bank_accounts_pro?source=eq.wise&select=solde`, {
          headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` }
        });
        if (wRes.ok) {
          const wData = await wRes.json();
          totalWise = wData.reduce((s, r) => s + (parseFloat(r.solde) || 0), 0);
        }
      } catch(e) { /* silencieux */ }

      const totalEur = totalQonto + totalWise;
      return Response.json({ ok: true, accounts, totalQonto, totalWise, totalEur });
    }

    // ── TRANSACTIONS ─────────────────────────────────────────────────────
    if (action === 'transactions') {
      if (!accountFilter) return Response.json({ ok: false, error: 'account requis' }, { status: 400 });
      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return Response.json({ ok: false, error: 'Compte inconnu: ' + accountFilter }, { status: 400 });

      const creds = getCredentials(acc.envKey);
      if (!creds) return Response.json({ ok: false, error: acc.envKey + ' non configuré' }, { status: 500 });

      const perPage = url.searchParams.get('per_page') || '30';
      const status = url.searchParams.get('status') || 'completed';
      const ibanParam = url.searchParams.get('iban');
      let ibans = [];

      if (ibanParam) {
        ibans = [ibanParam];
      } else {
        const orgData = await qontoFetch(creds.login, creds.secret, '/organization');
        ibans = (orgData.organization?.bank_accounts || []).map(ba => ba.iban).filter(Boolean);
        if (!ibans.length) return Response.json({ ok: false, error: 'Aucun IBAN' }, { status: 404 });
      }

      const allTxRaw = [];
      for (const iban of ibans) {
        try {
          const p = new URLSearchParams({ iban, status, current_page: 1, per_page: perPage, sort_by: 'settled_at:desc' });
          const d = await qontoFetch(creds.login, creds.secret, '/transactions?' + p);
          allTxRaw.push(...(d.transactions || []));
        } catch(e) {}
      }

      const seen = new Set();
      const transactions = allTxRaw
        .filter(t => { if (seen.has(t.transaction_id)) return false; seen.add(t.transaction_id); return true; })
        .sort((a, b) => new Date(b.settled_at || b.emitted_at) - new Date(a.settled_at || a.emitted_at))
        .map(t => ({
          id: t.transaction_id, amount: t.amount, currency: t.currency, side: t.side,
          label: t.label, reference: t.reference, status: t.status,
          settled_at: t.settled_at, emitted_at: t.emitted_at, category: t.category,
          note: t.note, has_attachments: (t.attachment_ids || []).length > 0,
          attachment_ids: t.attachment_ids || [], vat_amount: t.vat_amount, vat_rate: t.vat_rate,
        }));

      return Response.json({
        ok: true, account: acc.label, companyId: acc.companyId,
        transactions,
        missing_attachments: transactions.filter(t => t.side === 'debit' && !t.has_attachments).length,
        meta: {}
      });
    }

    // ── ATTACHMENTS ───────────────────────────────────────────────────────
    if (action === 'attachments') {
      const transactionId = url.searchParams.get('transaction_id');
      if (!accountFilter || !transactionId) return Response.json({ ok: false, error: 'account et transaction_id requis' }, { status: 400 });

      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return Response.json({ ok: false, error: 'Compte inconnu' }, { status: 400 });

      const creds = getCredentials(acc.envKey);
      if (!creds) return Response.json({ ok: false, error: acc.envKey + ' non configuré' }, { status: 500 });

      const txData = await qontoFetch(creds.login, creds.secret, `/transactions/${transactionId}`);
      const attachmentIds = txData.transaction?.attachment_ids || [];

      const settled = await Promise.allSettled(
        attachmentIds.map(id => qontoFetch(creds.login, creds.secret, `/attachments/${id}`))
      );

      return Response.json({
        ok: true,
        transaction_id: transactionId,
        attachments: settled.map((r, i) =>
          r.status === 'fulfilled'
            ? { id: attachmentIds[i], url: r.value.attachment?.url, filename: r.value.attachment?.filename, content_type: r.value.attachment?.content_type }
            : { id: attachmentIds[i], error: r.reason?.message }
        )
      });
    }

    // ── MISSING ───────────────────────────────────────────────────────────
    if (action === 'missing') {
      if (!accountFilter) return Response.json({ ok: false, error: 'account requis' }, { status: 400 });
      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return Response.json({ ok: false, error: 'Compte inconnu' }, { status: 400 });

      const creds = getCredentials(acc.envKey);
      if (!creds) return Response.json({ ok: false, error: acc.envKey + ' non configuré' }, { status: 500 });

      const orgData = await qontoFetch(creds.login, creds.secret, '/organization');
      const slug = orgData.organization?.bank_accounts?.[0]?.slug;

      const params = new URLSearchParams({ bank_account_slug: slug, status: 'completed', current_page: 1, per_page: '50', sort_by: 'settled_at:desc' });
      const txData = await qontoFetch(creds.login, creds.secret, `/transactions?${params}`);

      const missing = (txData.transactions || [])
        .filter(t => t.side === 'debit' && (t.attachment_ids || []).length === 0)
        .map(t => ({ id: t.transaction_id, label: t.label, amount: t.amount, settled_at: t.settled_at, category: t.category }));

      return Response.json({ ok: true, account: acc.label, missing_count: missing.length, missing });
    }

    return Response.json({ ok: false, error: 'Action inconnue: ' + action }, { status: 400 });

  } catch(e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/qonto-sync' };
