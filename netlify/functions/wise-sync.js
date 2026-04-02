// wise-sync.js — Proxy Wise API
// GET /api/wise-sync?action=balances
// GET /api/wise-sync?action=debug  (pour diagnostiquer)

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
  const token = Netlify.env.get('WISE_API_TOKEN');
  if (!token) return Response.json({ ok: false, error: 'WISE_API_TOKEN manquant' }, { status: 500 });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'balances';

    // Étape 1 : profils
    const profiles = await wiseGet(token, '/v1/profiles');

    if (action === 'debug') {
      // Retourner toutes les données brutes pour diagnostic
      const debug = { profiles_raw: profiles, balances_raw: {} };
      for (const p of profiles) {
        try {
          debug.balances_raw[p.id] = await wiseGet(token, `/v4/profiles/${p.id}/balances?types=STANDARD`);
        } catch(e) {
          debug.balances_raw[p.id] = { error: e.message };
        }
      }
      return Response.json({ ok: true, debug });
    }

    // Action balances standard
    const results = [];
    for (const profile of profiles) {
      try {
        const balances = await wiseGet(token, `/v4/profiles/${profile.id}/balances?types=STANDARD`);
        const name = profile.type === 'personal'
          ? `${profile.details?.firstName||''} ${profile.details?.lastName||''}`.trim() || 'Personnel'
          : profile.details?.name || 'Business';

        results.push({
          profileId: profile.id,
          profileType: profile.type,
          name,
          balances: (Array.isArray(balances) ? balances : [])
            .filter(b => (b.amount?.value ?? b.value ?? 0) !== 0)
            .map(b => ({
              currency: b.currency || b.amount?.currency,
              value: b.amount?.value ?? b.value ?? 0,
            }))
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
        });
      } catch(e) {
        results.push({ profileId: profile.id, profileType: profile.type, name: profile.type, error: e.message, balances: [] });
      }
    }

    return Response.json({ ok: true, profiles: results });

  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

export const config = { path: '/api/wise-sync' };
