// qonto-sync.js — Proxy API Qonto multi-comptes
// GET /api/qonto-sync?action=balances
// GET /api/qonto-sync?action=transactions&account=GUIRAUD&iban=FR76...&per_page=25
// GET /api/qonto-sync?action=attachments&transaction_id=xxx&account=GUIRAUD

const QONTO_BASE = 'https://thirdparty.qonto.com/v2';

// Map des comptes : variable d'env → label dashboard
const ACCOUNTS = [
  { envKey: 'QONTO_GUIRAUD',    label: 'SARL GUIRAUD',  companyId: 'sarl-guiraud' },
  { envKey: 'QONTO_LIVING',     label: 'SAS LIVING',    companyId: 'sas-living' },
  { envKey: 'QONTO_MEULETTE',   label: 'La Meulette',   companyId: 'meulette' },
  { envKey: 'QONTO_REAL_GAINS', label: 'Real Gains',    companyId: 'real-gains' },
  { envKey: 'QONTO_MONIKAZA',   label: 'Monikaza SPV',  companyId: 'spv-monikaza' },
];

function getEnv(k) { return process.env[k] || null; }

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function qontoGet(login, secret, path) {
  const res = await fetch(`${QONTO_BASE}${path}`, {
    headers: {
      'Authorization': `${login}:${secret}`,
      'Content-Type': 'application/json'
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Qonto ${res.status}: ${text.substring(0, 300)}`);
  try { return JSON.parse(text); } catch(e) { throw new Error(`JSON invalide: ${text.substring(0, 200)}`); }
}

function parseCredentials(envKey) {
  const val = getEnv(envKey);
  if (!val) return null;
  const idx = val.indexOf(':');
  if (idx === -1) return null;
  return { login: val.substring(0, idx), secret: val.substring(idx + 1) };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get('action') || 'balances';
  const accountFilter = url.searchParams.get('account'); // ex: GUIRAUD

  try {
    // ── ACTION : balances (tous les comptes) ──────────────────────────────
    if (action === 'balances') {
      const results = [];

      for (const acc of ACCOUNTS) {
        const creds = parseCredentials(acc.envKey);
        if (!creds) {
          results.push({ ...acc, configured: false, bank_accounts: [] });
          continue;
        }
        try {
          const data = await qontoGet(creds.login, creds.secret, '/organization');
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
          results.push({
            ...acc,
            configured: true,
            org_name: org.legal_name || org.slug,
            bank_accounts: bankAccounts,
            total_balance: bankAccounts.reduce((s, b) => s + b.balance, 0),
          });
        } catch(e) {
          results.push({ ...acc, configured: true, error: e.message, bank_accounts: [] });
        }
      }

      return resp({ ok: true, accounts: results });
    }

    // ── ACTION : transactions ─────────────────────────────────────────────
    if (action === 'transactions') {
      const iban = url.searchParams.get('iban');
      const perPage = parseInt(url.searchParams.get('per_page') || '25');
      const page = parseInt(url.searchParams.get('page') || '1');
      const status = url.searchParams.get('status') || 'completed'; // completed|pending|reversed

      if (!accountFilter) return resp({ ok: false, error: 'Paramètre account manquant' }, 400);

      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return resp({ ok: false, error: 'Compte inconnu: ' + accountFilter }, 400);

      const creds = parseCredentials(acc.envKey);
      if (!creds) return resp({ ok: false, error: `${acc.envKey} non configuré` }, 500);

      // Récupérer l'IBAN si pas fourni
      let slug = iban;
      if (!slug) {
        const org = await qontoGet(creds.login, creds.secret, '/organization');
        const firstAccount = org.organization?.bank_accounts?.[0];
        if (!firstAccount) return resp({ ok: false, error: 'Aucun compte bancaire trouvé' }, 404);
        slug = firstAccount.slug;
      }

      const params = new URLSearchParams({
        bank_account_slug: slug,
        status,
        current_page: page,
        per_page: perPage,
        sort_by: 'settled_at:desc'
      });

      const data = await qontoGet(creds.login, creds.secret, `/transactions?${params}`);
      const transactions = (data.transactions || []).map(t => ({
        id: t.transaction_id,
        amount: t.amount,
        amount_cents: t.amount_cents,
        currency: t.currency,
        side: t.side, // debit | credit
        label: t.label,
        reference: t.reference,
        status: t.status,
        settled_at: t.settled_at,
        emitted_at: t.emitted_at,
        category: t.category,
        note: t.note,
        attachment_ids: t.attachment_ids || [],
        has_attachments: (t.attachment_ids || []).length > 0,
        vat_amount: t.vat_amount,
        vat_rate: t.vat_rate,
        initiator_id: t.initiator_id,
      }));

      return resp({
        ok: true,
        account: acc.label,
        company_id: acc.companyId,
        transactions,
        meta: data.meta || {},
        missing_attachments: transactions.filter(t => t.side === 'debit' && !t.has_attachments).length,
      });
    }

    // ── ACTION : attachments ──────────────────────────────────────────────
    if (action === 'attachments') {
      const transactionId = url.searchParams.get('transaction_id');
      if (!accountFilter || !transactionId) {
        return resp({ ok: false, error: 'account et transaction_id requis' }, 400);
      }

      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return resp({ ok: false, error: 'Compte inconnu' }, 400);

      const creds = parseCredentials(acc.envKey);
      if (!creds) return resp({ ok: false, error: `${acc.envKey} non configuré` }, 500);

      const data = await qontoGet(creds.login, creds.secret, `/transactions/${transactionId}`);
      const attachmentIds = data.transaction?.attachment_ids || [];

      const attachments = [];
      for (const id of attachmentIds) {
        try {
          const att = await qontoGet(creds.login, creds.secret, `/attachments/${id}`);
          attachments.push({
            id,
            url: att.attachment?.url,
            filename: att.attachment?.filename || `piece-${id}.pdf`,
            content_type: att.attachment?.content_type,
            size: att.attachment?.size,
          });
        } catch(e) {
          attachments.push({ id, error: e.message });
        }
      }

      return resp({ ok: true, transaction_id: transactionId, attachments });
    }

    // ── ACTION : missing (transactions sans pièce jointe) ─────────────────
    if (action === 'missing') {
      if (!accountFilter) return resp({ ok: false, error: 'account requis' }, 400);

      const acc = ACCOUNTS.find(a => a.envKey.includes(accountFilter.toUpperCase()));
      if (!acc) return resp({ ok: false, error: 'Compte inconnu' }, 400);

      const creds = parseCredentials(acc.envKey);
      if (!creds) return resp({ ok: false, error: `${acc.envKey} non configuré` }, 500);

      const org = await qontoGet(creds.login, creds.secret, '/organization');
      const slug = org.organization?.bank_accounts?.[0]?.slug;
      if (!slug) return resp({ ok: false, error: 'Aucun compte' }, 404);

      // Récupérer les 100 dernières transactions débit sans pièce
      const params = new URLSearchParams({
        bank_account_slug: slug,
        status: 'completed',
        side: 'debit',
        current_page: 1,
        per_page: 100,
        sort_by: 'settled_at:desc'
      });

      const data = await qontoGet(creds.login, creds.secret, `/transactions?${params}`);
      const missing = (data.transactions || [])
        .filter(t => (t.attachment_ids || []).length === 0)
        .map(t => ({
          id: t.transaction_id,
          label: t.label,
          amount: t.amount,
          currency: t.currency,
          settled_at: t.settled_at,
          category: t.category,
        }));

      return resp({
        ok: true,
        account: acc.label,
        missing_count: missing.length,
        missing,
      });
    }

    return resp({ ok: false, error: `Action inconnue: ${action}. Valeurs: balances, transactions, attachments, missing` }, 400);

  } catch(e) {
    return resp({ ok: false, error: e.message }, 500);
  }
};

export const config = { path: '/api/qonto-sync' };
