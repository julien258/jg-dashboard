// pennylane-create-doc.js
// Crée une facture, un devis ou un avoir dans Pennylane depuis un contrat CRM

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

function getEnv(key) {
  return process.env[key] || null;
}

const TOKEN_MAP = {
  'sas-living':      () => getEnv('PENNYLANE_LIVING_TOKEN'),
  'sarl-guiraud':    () => getEnv('PENNYLANE_SARL_TOKEN'),
  'meulette':        () => getEnv('PENNYLANE_MEULETTE_TOKEN'),
  'sci-la-meulette': () => getEnv('PENNYLANE_MEULETTE_TOKEN'),
};

// Appel API Pennylane
async function plFetch(token, method, endpoint, body) {
  const res = await fetch(`${PENNYLANE_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch(e) { throw new Error(`JSON invalide: ${text.substring(0,200)}`); }
  if (!res.ok) throw new Error(`Pennylane ${res.status}: ${JSON.stringify(json).substring(0,300)}`);
  return json;
}

// Appel REST Supabase (sans SDK)
async function sbFetch(path, options = {}) {
  const url = `${getEnv('SUPABASE_URL')}/rest/v1${path}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_KEY')}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...( options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.substring(0,200)}`);
  return text ? JSON.parse(text) : null;
}

// Trouver ou créer un client Pennylane (idempotent via external_reference)
async function findOrCreateCustomer(token, client) {
  const ref = client.id;
  try {
    const filter = JSON.stringify([{field:'external_reference', operator:'eq', value:ref}]);
    const res = await plFetch(token, 'GET', `/customers?filter=${encodeURIComponent(filter)}`);
    const list = res.customers || res.items || (Array.isArray(res) ? res : []);
    if (list.length > 0) return list[0].id;
  } catch(e) { /* continuer */ }

  const payload = {
    customer: {
      name: client.company_name || client.name,
      external_reference: ref,
      ...(client.contact_email ? { emails: [client.contact_email] } : {})
    }
  };
  const created = await plFetch(token, 'POST', '/company_customers', payload);
  return created.customer?.id || created.id;
}

// Convertit tva_taux (0, 5.5, 10, 20) en code Pennylane
function tvaCode(tva_taux) {
  const v = parseFloat(tva_taux);
  if (!v || v === 0) return 'FR_000';
  if (v >= 20) return 'FR_200';
  if (v >= 10) return 'FR_100';
  if (v >= 5.5) return 'FR_055';
  return 'FR_000';
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({error: 'Méthode non autorisée'}), {status: 405, headers: {'Content-Type':'application/json'}});
  }

  let body;
  try { body = await req.json(); }
  catch(e) { return new Response(JSON.stringify({error: 'Body JSON invalide'}), {status: 400, headers: {'Content-Type':'application/json'}}); }

  const { contract_id, doc_type = 'invoice', date, deadline, description, override_amount, tva_taux } = body;
  if (!contract_id) return new Response(JSON.stringify({error: 'contract_id manquant'}), {status: 400, headers: {'Content-Type':'application/json'}});

  try {
    // Charger contrat + client depuis Supabase REST
    const contracts = await sbFetch(`/contracts?id=eq.${contract_id}&select=*,clients(*)&limit=1`);
    if (!contracts?.length) throw new Error('Contrat introuvable');
    const contract = contracts[0];
    const client = contract.clients;
    if (!client) throw new Error('Client introuvable pour ce contrat');

    const token = TOKEN_MAP[contract.billing_company_id]?.();
    if (!token) throw new Error(`Token Pennylane manquant pour ${contract.billing_company_id}`);

    // Bloquer si facture déjà existante (sauf si force=true ou doc_type=credit_note)
    if (contract.invoice_name && doc_type === 'invoice' && !body.force) {
      return new Response(JSON.stringify({
        ok: false,
        already_exists: true,
        invoice_number: contract.invoice_name,
        error: `Facture ${contract.invoice_name} déjà créée pour ce contrat. Passez force:true pour créer quand même, ou créez un avoir.`
      }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }

    // Trouver ou créer le client dans Pennylane
    const plCustomerId = await findOrCreateCustomer(token, client);

    // Paramètres du document
    const montantHT = parseFloat(override_amount ?? contract.commission_amount ?? 0);
    const tvaVal = tva_taux ?? contract.tva_taux;
    const tva = tvaCode(tvaVal);
    const invoiceDate = date || new Date().toISOString().split('T')[0];
    const invoiceDeadline = deadline || new Date(Date.now() + 30*24*3600*1000).toISOString().split('T')[0];
    const label = description || contract.label || 'Commission';

    const docPayload = {
      customer_id: plCustomerId,
      date: invoiceDate,
      deadline: invoiceDeadline,
      invoice_lines: [{
        label,
        quantity: 1,
        unit_price: montantHT,
        vat_rate: tva
      }]
    };

    // Créer le document dans Pennylane
    let endpoint, bodyKey, resultKey;
    if (doc_type === 'quote') {
      endpoint = '/quotes'; bodyKey = 'quote'; resultKey = 'quote';
    } else if (doc_type === 'credit_note') {
      endpoint = '/credit_notes'; bodyKey = 'credit_note'; resultKey = 'credit_note';
    } else {
      endpoint = '/customer_invoices'; bodyKey = 'invoice'; resultKey = 'invoice';
    }

    const result = await plFetch(token, 'POST', endpoint, { [bodyKey]: docPayload });
    const doc = result[resultKey] || result;
    const invoiceNumber = doc.invoice_number || doc.quote_number || String(doc.id);
    const pennylaneId = doc.id;
    const pennylaneUrl = doc.public_url || `https://app.pennylane.com/invoices/${pennylaneId}`;

    // Mettre à jour le contrat en base si c'est une facture
    if (doc_type === 'invoice') {
      await sbFetch(`/contracts?id=eq.${contract_id}`, {
        method: 'PATCH',
        body: { invoice_name: invoiceNumber, invoice_date: invoiceDate, invoice_status: 'emise' },
        prefer: 'return=minimal'
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      doc_type,
      invoice_number: invoiceNumber,
      pennylane_id: pennylaneId,
      pennylane_url: pennylaneUrl,
      montant_ht: montantHT,
      tva_code: tva,
      date: invoiceDate
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/pennylane-create-doc' };
