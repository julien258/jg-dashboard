// wise-webhook.js — Réception des webhooks Wise
// POST /api/wise-webhook
// Met à jour bank_accounts_pro dans Supabase à chaque événement Wise

const SUPABASE_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';

// Mapping profileId Wise → company_id dashboard
const PROFILE_MAP = {
  24414380: 'perso',
  24414368: 'real-gains',
  84010501: 'sas-living',
  85108582: 'sarl-guiraud',
  86999872: 'meulette',
};

async function sbFetch(path, opts = {}) {
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=minimal',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function updateBalance(profileId, currency, balance) {
  const companyId = PROFILE_MAP[profileId];
  if (!companyId) {
    console.log(`Profil Wise ${profileId} non mappé — ignoré`);
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  // Chercher si une ligne existe déjà
  const existing = await sbFetch(
    `/bank_accounts_pro?company_id=eq.${companyId}&source=eq.wise&devise=eq.${currency}&select=id`
  );

  if (existing && existing.length > 0) {
    await sbFetch(`/bank_accounts_pro?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: { solde: balance, solde_date: today },
    });
  } else {
    await sbFetch('/bank_accounts_pro', {
      method: 'POST',
      body: {
        company_id: companyId,
        banque: 'WISE',
        source: 'wise',
        solde: balance,
        solde_date: today,
        type_compte: 'courant',
        devise: currency,
        external_ref: `wise-${profileId}-${currency}`,
      },
    });
  }
  console.log(`✓ Solde mis à jour : ${companyId} Wise ${currency} = ${balance}`);
}

export default async (req) => {
  // Wise envoie des webhooks en POST avec un body JSON
  let payload;
  try {
    payload = await req.json();
  } catch(e) {
    return Response.json({ ok: false, error: 'Body invalide' }, { status: 400 });
  }

  console.log('Wise webhook reçu:', JSON.stringify(payload).substring(0, 500));

  const eventType = payload.event_type || payload.type || '';
  const data = payload.data || {};

  try {
    // Événement dépôt / crédit
    if (eventType.includes('balance') || eventType.includes('credit') || eventType.includes('deposit')) {
      const profileId = data.resource?.profile_id || data.profile_id;
      const currency = data.currency || data.resource?.currency;
      const balance = data.post_transaction_balance_amount || data.amount?.value;

      if (profileId && balance !== undefined) {
        await updateBalance(profileId, currency || 'EUR', balance);
      }
    }

    // Événement transfert complété
    if (eventType.includes('transfer') && (data.status === 'outgoing_payment_sent' || data.status === 'funds_refunded')) {
      const profileId = data.resource?.profile_id || data.profile_id;
      const currency = data.resource?.currency;
      // Pour les transferts, on ne connaît pas le solde résultant directement
      // → on logge et on laisse la prochaine sync périodique faire le reste
      console.log(`Transfert Wise détecté pour profil ${profileId} — sync périodique à prévoir`);
    }

    return Response.json({ ok: true, received: eventType });

  } catch(e) {
    console.error('Erreur webhook Wise:', e.message);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
};

export const config = { path: '/api/wise-webhook' };
