// wise-sync.js — Proxy Wise API pour soldes et transactions
// GET /api/wise-sync?action=balances
// GET /api/wise-sync?action=transactions&profileId=xxx&currency=EUR&limit=10

const WISE_BASE = 'https://api.wise.com';

async function wiseGet(token, path) {
  const res = await fetch(`${WISE_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise API ${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

export default async (req) => {
  const token = Netlify.env.get('WISE_API_TOKEN');
  if (!token) return Response.json({ ok: false, error: 'WISE_API_TOKEN manquant dans Netlify env' }, { status: 500 });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'balances';

    if (action === 'balances') {
      // 1. Récupérer les profils (perso + business si existant)
      const profiles = await wiseGet(token, '/v1/profiles');
      const personal = profiles.find(p => p.type === 'personal');
      const business = profiles.find(p => p.type === 'business');

      const results = [];

      for (const profile of [personal, business].filter(Boolean)) {
        try {
          // 2. Soldes multi-devises
          const balances = await wiseGet(token, `/v4/profiles/${profile.id}/balances?types=STANDARD`);
          results.push({
            profileId: profile.id,
            profileType: profile.type,
            name: profile.type === 'personal'
              ? `${profile.details?.firstName || ''} ${profile.details?.lastName || ''}`.trim()
              : profile.details?.name || 'Business',
            balances: (balances || [])
              .filter(b => b.amount?.value > 0)
              .map(b => ({
                currency: b.amount?.currency,
                value: b.amount?.value,
                balanceType: b.balanceType,
              }))
              .sort((a, b) => b.value - a.value),
          });
        } catch (e) {
          results.push({ profileId: profile.id, profileType: profile.type, error: e.message });
        }
      }

      return Response.json({ ok: true, profiles: results });

    } else if (action === 'transactions') {
      const profileId = url.searchParams.get('profileId');
      const currency = url.searchParams.get('currency') || 'EUR';
      const limit = parseInt(url.searchParams.get('limit') || '10');

      if (!profileId) return Response.json({ ok: false, error: 'profileId requis' }, { status: 400 });

      // Récupérer les dernières transactions
      const now = new Date();
      const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      const intervalStart = monthAgo.toISOString();

      const transfers = await wiseGet(token,
        `/v1/transfers?profile=${profileId}&sourceCurrency=${currency}&limit=${limit}&createdDateStart=${intervalStart}`
      );

      const txList = (Array.isArray(transfers) ? transfers : []).map(t => ({
        id: t.id,
        amount: t.sourceValue,
        currency: t.sourceCurrency,
        targetAmount: t.targetValue,
        targetCurrency: t.targetCurrency,
        status: t.status,
        reference: t.details?.reference || '',
        created: t.created,
      }));

      return Response.json({ ok: true, transactions: txList });

    } else {
      return Response.json({ ok: false, error: `Action inconnue : ${action}` }, { status: 400 });
    }

  } catch (err) {
    console.error('Wise sync error:', err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

export const config = { path: '/api/wise-sync' };
