// wise-transactions.js — Transactions Wise compte perso par mois
// GET /api/wise-transactions?year=2026&month=4 (month 1-based)

const WISE_BASE = 'https://api.wise.com';

async function wiseGet(token, path) {
  const res = await fetch(`${WISE_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.substring(0, 300)}`);
  try { return JSON.parse(text); } catch(e) { throw new Error(`JSON invalide: ${text.substring(0,200)}`); }
}

export default async (req) => {
  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });

  try {
    const token = Netlify.env.get('WISE_API_TOKEN'); // compte perso Julien (CB Candice)
    if (!token) return Response.json({ ok: false, error: 'WISE_API_TOKEN manquant' }, { status: 500 });

    const url = new URL(req.url);
    const year  = parseInt(url.searchParams.get('year'))  || new Date().getFullYear();
    const month = parseInt(url.searchParams.get('month')) || new Date().getMonth() + 1;

    // Dates début/fin du mois demandé
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month, 0, 23, 59, 59).toISOString();

    // Récupérer profil perso
    const profiles = await wiseGet(token, '/v1/profiles');
    const personal = profiles.find(p => p.type === 'personal');
    if (!personal) return Response.json({ ok: false, error: 'Profil perso introuvable' }, { status: 404 });

    const profileId = personal.id;

    // Récupérer les accounts (borderAccounts)
    const accounts = await wiseGet(token, `/v1/borderless-accounts?profileId=${profileId}`);
    const account = Array.isArray(accounts) ? accounts[0] : null;
    if (!account) return Response.json({ ok: false, error: 'Aucun compte trouvé', profileId }, { status: 404 });

    const accountId = account.id;

    // Récupérer les transactions EUR du mois
    const txPath = `/v3/profiles/${profileId}/borderless-accounts/${accountId}/statement.json?currency=EUR&intervalStart=${from}&intervalEnd=${to}&type=COMPACT`;
    const statement = await wiseGet(token, txPath);

    const transactions = (statement.transactions || []).map(tx => ({
      id: tx.referenceNumber || tx.details?.id,
      date: tx.date,
      amount: tx.amount?.value ?? 0,
      currency: tx.amount?.currency || 'EUR',
      type: tx.type, // DEBIT ou CREDIT
      description: tx.details?.description || tx.details?.type || '',
      merchant: tx.details?.merchant?.name || '',
      label: tx.details?.description || tx.details?.merchant?.name || tx.details?.type || '',
    }));

    // Agréger par nature (debits uniquement = dépenses)
    const debits = transactions.filter(t => t.type === 'DEBIT' || t.amount < 0);
    const totalDepenses = debits.reduce((s, t) => s + Math.abs(t.amount), 0);

    return Response.json({
      ok: true,
      year, month,
      profileId,
      accountId,
      totalDepenses: Math.round(totalDepenses * 100) / 100,
      transactions: transactions.sort((a, b) => new Date(b.date) - new Date(a.date)),
      debits: debits.sort((a, b) => new Date(b.date) - new Date(a.date)),
      count: transactions.length,
    }, { headers: H });

  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500, headers: H });
  }
};

export const config = { path: '/api/wise-transactions' };
