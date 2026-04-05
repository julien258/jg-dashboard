// qonto-sync.js — Proxy API Qonto multi-comptes
// GET /api/qonto-sync?action=balances
// GET /api/qonto-sync?action=transactions&account=GUIRAUD
// GET /api/qonto-sync?action=missing&account=GUIRAUD

import { env } from 'process';

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
const TIMEOUT_MS = 8000;

const ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    label: 'SARL GUIRAUD',  companyId: 'sarl-guiraud' },
  { envKey: 'QONTO_LIVING',     label: 'SAS LIVING',    companyId: 'sas-living' },
  { envKey: 'QONTO_MEULETTE',   label: 'La Meulette',   companyId: 'meulette' },
  { envKey: 'QONTO_REAL_GAINS', label: 'Real Gains',    companyId: 'real-gains' },
  { envKey: 'QONTO_MONIKAZA',   label: 'Monikaza SPV',  companyId: 'spv-monikaza' },
];

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function getCredentials(envKey) {
  // Essayer process.env ET Netlify.env
  let val = env[envKey];
  if (!val && typeof Netlify !== 'undefined') {
    try { val = Netlify.env.get(envKey); } catch(e) {}
  }
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

async function fetchAccount(acc) {
  const creds = getCredentials(acc.envKey);
  if (!creds) return { ...acc, configured: false, bank_accounts: [], error: 'Token manquant' };

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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'balances';
  const accountFilter = url.searchParams.get('account');

  try {
    // ── BALANCES : tous les comptes en parallèle ──────────────────────────
    if (action === 'balances') {
      const toFetch = accountFilter
        ? ACCOUNTS.filter(a => a.envKey.includes(accountFilter.toUpperCase()))
        : ACCOUNTS;

      // Appels PARALLÈLES avec Promise.allSettled
      const results = await Promise.allSettled(toFetch.map(fetchAccount));
      const accounts = results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { ...toFetch[i], error: r.reason?.message, bank_accounts: [], total_balance: 0 }
      );

      const totalEur = accounts.reduce((s, a) => s + (a.total_balance || 0), 0);

      return new Response(JSON.stringify({ ok: true, accounts, totalEur }), { headers: CORS });
    }

    // ── TRANSACTIONS ─────────────────────────────────────────────────────
    if (action === 'transactions') {
      if (!accountFilter) return new Response(JSON.stringify({ ok: false, error: 'account requis' }), { status: 400, headers: CORS });
      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return new Response(JSON.stringify({ ok: false, error: 'Compte inconnu: ' + accountFilter }), { status: 400, headers: CORS });

      const creds = getCredentials(acc.envKey);
      if (!creds) return new Response(JSON.stringify({ ok: false, error: acc.envKey + ' non configuré' }), { status: 500, headers: CORS });

      const perPage = url.searchParams.get('per_page') || '30';
      const status = url.searchParams.get('status') || 'completed';

      // Récupérer le slug du compte principal
      const orgData = await qontoFetch(creds.login, creds.secret, '/organization');
      const slug = orgData.organization?.bank_accounts?.[0]?.slug;
      if (!slug) return new Response(JSON.stringify({ ok: false, error: 'Aucun compte bancaire' }), { status: 404, headers: CORS });

      const params = new URLSearchParams({ bank_account_slug: slug, status, current_page: 1, per_page: perPage, sort_by: 'settled_at:desc' });
      const txData = await qontoFetch(creds.login, creds.secret, `/transactions?${params}`);

      const transactions = (txData.transactions || []).map(t => ({
        id: t.transaction_id,
        amount: t.amount,
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
      }));

      return new Response(JSON.stringify({
        ok: true, account: acc.label, companyId: acc.companyId,
        transactions,
        missing_attachments: transactions.filter(t => t.side === 'debit' && !t.has_attachments).length,
        meta: txData.meta || {}
      }), { headers: CORS });
    }

    // ── ATTACHMENTS ───────────────────────────────────────────────────────
    if (action === 'attachments') {
      const transactionId = url.searchParams.get('transaction_id');
      if (!accountFilter || !transactionId) return new Response(JSON.stringify({ ok: false, error: 'account et transaction_id requis' }), { status: 400, headers: CORS });

      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return new Response(JSON.stringify({ ok: false, error: 'Compte inconnu' }), { status: 400, headers: CORS });

      const creds = getCredentials(acc.envKey);
      if (!creds) return new Response(JSON.stringify({ ok: false, error: acc.envKey + ' non configuré' }), { status: 500, headers: CORS });

      const txData = await qontoFetch(creds.login, creds.secret, `/transactions/${transactionId}`);
      const attachmentIds = txData.transaction?.attachment_ids || [];

      const attachments = await Promise.allSettled(
        attachmentIds.map(id => qontoFetch(creds.login, creds.secret, `/attachments/${id}`))
      );

      return new Response(JSON.stringify({
        ok: true,
        transaction_id: transactionId,
        attachments: attachments.map((r, i) =>
          r.status === 'fulfilled'
            ? { id: attachmentIds[i], url: r.value.attachment?.url, filename: r.value.attachment?.filename, content_type: r.value.attachment?.content_type }
            : { id: attachmentIds[i], error: r.reason?.message }
        )
      }), { headers: CORS });
    }

    // ── MISSING : transactions sans pièce jointe ──────────────────────────
    if (action === 'missing') {
      if (!accountFilter) return new Response(JSON.stringify({ ok: false, error: 'account requis' }), { status: 400, headers: CORS });

      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return new Response(JSON.stringify({ ok: false, error: 'Compte inconnu' }), { status: 400, headers: CORS });

      const creds = getCredentials(acc.envKey);
      if (!creds) return new Response(JSON.stringify({ ok: false, error: acc.envKey + ' non configuré' }), { status: 500, headers: CORS });

      const orgData = await qontoFetch(creds.login, creds.secret, '/organization');
      const slug = orgData.organization?.bank_accounts?.[0]?.slug;

      const params = new URLSearchParams({ bank_account_slug: slug, status: 'completed', current_page: 1, per_page: '50', sort_by: 'settled_at:desc' });
      const txData = await qontoFetch(creds.login, creds.secret, `/transactions?${params}`);

      const missing = (txData.transactions || [])
        .filter(t => t.side === 'debit' && (t.attachment_ids || []).length === 0)
        .map(t => ({ id: t.transaction_id, label: t.label, amount: t.amount, settled_at: t.settled_at, category: t.category }));

      return new Response(JSON.stringify({ ok: true, account: acc.label, missing_count: missing.length, missing }), { headers: CORS });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Action inconnue: ' + action }), { status: 400, headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/qonto-sync' };
