// pennylane-create-doc.js
// Crée une facture, un devis ou un avoir dans Pennylane depuis un contrat CRM
// POST /api/pennylane-create-doc
// Body: { contract_id, doc_type: 'invoice'|'quote'|'credit_note', date, deadline, description, override_amount }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

const TOKEN_MAP = {
  'sas-living':   () => getEnv('PENNYLANE_LIVING_TOKEN'),
  'sarl-guiraud': () => getEnv('PENNYLANE_SARL_TOKEN'),
  'meulette':     () => getEnv('PENNYLANE_MEULETTE_TOKEN'),
  'sci-la-meulette': () => getEnv('PENNYLANE_MEULETTE_TOKEN'),
};

function getEnv(key) {
  try { return Netlify.env.get(key) || process.env[key] || null; }
  catch(e) { return process.env[key] || null; }
}

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
  if (!res.ok) throw new Error(`Pennylane ${res.status}: ${json?.error || json?.message || text.substring(0,200)}`);
  return json;
}

// Trouve ou crée un client dans Pennylane — idempotent via external_reference
async function findOrCreateCustomer(token, client) {
  const ref = client.id; // UUID Supabase comme external_reference
  // Chercher par external_reference
  try {
    const filter = JSON.stringify([{field:'external_reference', operator:'eq', value:ref}]);
    const res = await plFetch(token, 'GET', `/customers?filter=${encodeURIComponent(filter)}`);
    const customers = res.customers || res.items || (Array.isArray(res) ? res : []);
    if (customers.length > 0) return customers[0].id;
  } catch(e) { /* continuer, on va créer */ }

  // Créer le client
  const payload = {
    name: client.company_name || client.name,
    external_reference: ref,
    ...(client.contact_email ? { emails: [client.contact_email] } : {})
  };
  const created = await plFetch(token, 'POST', '/company_customers', { customer: payload });
  return created.customer?.id || created.id;
}

// Convertit tva_taux en code TVA Pennylane
function tvaCode(tva_taux) {
  const v = parseFloat(tva_taux);
  if (!v || v === 0) return 'FR_000'; // exonéré
  if (v >= 20 || v >= 0.20) return 'FR_200'; // 20%
  if (v >= 10 || v >= 0.10) return 'FR_100'; // 10%
  if (v >= 5.5 || v >= 0.055) return 'FR_055'; // 5,5%
  return 'FR_000';
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({error: 'Méthode non autorisée'}), {status: 405, headers: {'Content-Type':'application/json'}});
  }

  let body;
  try { body = await req.json(); } catch(e) { return new Response(JSON.stringify({error: 'Body JSON invalide'}), {status: 400, headers: {'Content-Type':'application/json'}}); }

  const { contract_id, doc_type = 'invoice', date, deadline, description, override_amount } = body;
  if (!contract_id) return new Response(JSON.stringify({error: 'contract_id manquant'}), {status: 400, headers: {'Content-Type':'application/json'}});

  // Init Supabase
  const sb = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_KEY'));

  try {
    // Charger le contrat + client
    const { data: contract, error: cErr } = await sb.from('contracts')
      .select('*, clients(*)')
      .eq('id', contract_id)
      .single();
    if (cErr || !contract) throw new Error('Contrat introuvable: ' + (cErr?.message || ''));

    const client = contract.clients;
    if (!client) throw new Error('Client introuvable pour ce contrat');

    const token = TOKEN_MAP[contract.billing_company_id]?.();
    if (!token) throw new Error(`Token Pennylane manquant pour ${contract.billing_company_id}`);

    // Trouver ou créer le client dans Pennylane
    const plCustomerId = await findOrCreateCustomer(token, client);

    // Montant HT
    const montantHT = parseFloat(override_amount || contract.commission_amount || 0);
    const tva = tvaCode(contract.tva_taux);
    const invoiceDate = date || new Date().toISOString().split('T')[0];
    const invoiceDeadline = deadline || new Date(Date.now() + 30*24*3600*1000).toISOString().split('T')[0];
    const label = description || contract.label || 'Commission';

    // Payload facture
    const invoicePayload = {
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

    let result;
    let endpoint;
    let resultKey;

    if (doc_type === 'quote') {
      endpoint = '/quotes';
      resultKey = 'quote';
      result = await plFetch(token, 'POST', endpoint, { quote: invoicePayload });
    } else if (doc_type === 'credit_note') {
      endpoint = '/credit_notes';
      resultKey = 'credit_note';
      result = await plFetch(token, 'POST', endpoint, { credit_note: invoicePayload });
    } else {
      endpoint = '/customer_invoices';
      resultKey = 'invoice';
      result = await plFetch(token, 'POST', endpoint, { invoice: invoicePayload });
    }

    const doc = result[resultKey] || result;
    const invoiceNumber = doc.invoice_number || doc.quote_number || doc.id;
    const pennylaneId = doc.id;
    const pennylaneUrl = doc.public_url || `https://app.pennylane.com/invoices/${pennylaneId}`;

    // Mettre à jour le contrat en base
    if (doc_type === 'invoice') {
      await sb.from('contracts').update({
        invoice_name: invoiceNumber,
        invoice_date: invoiceDate,
        invoice_status: 'emise'
      }).eq('id', contract_id);
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
