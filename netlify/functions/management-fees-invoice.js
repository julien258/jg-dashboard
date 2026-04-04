// management-fees-invoice.js
// Crée une facture Management Fees GUIRAUD JULIEN → SAS LIVING dans Pennylane
// POST /api/management-fees-invoice  { mois: "2026-01", force: false }

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';
const AMOUNT_HT = 60000;
const TVA_CODE = 'FR_200';
const CUSTOMER_NAME = 'LIVING';

const MOIS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin',
                  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function getEnv(k) { return process.env[k] || null; }

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function resp(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
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
  if (!res.ok) throw new Error(`Pennylane ${res.status}: ${JSON.stringify(json).substring(0,300)}`);
  return json;
}

async function sbFetch(path, options = {}) {
  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_KEY')}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.substring(0,200)}`);
  return text ? JSON.parse(text) : null;
}

// Trouve le client "LIVING" dans Pennylane SARL GUIRAUD
async function findCustomerLiving(token) {
  try {
    // Pennylane supporte un paramètre search sur le nom
    const res = await plFetch(token, 'GET', `/customers?search=${encodeURIComponent(CUSTOMER_NAME)}&limit=50`);
    const list = res.customers || res.items || (Array.isArray(res) ? res : []);
    const found = list.find(c =>
      (c.name || '').toUpperCase().includes('LIVING') ||
      (c.company_name || '').toUpperCase().includes('LIVING')
    );
    if (found) return found.id;
  } catch(e) {
    // fallback : lister sans filtre et chercher côté serveur
  }

  try {
    const res = await plFetch(token, 'GET', `/customers?limit=100`);
    const list = res.customers || res.items || (Array.isArray(res) ? res : []);
    const found = list.find(c =>
      (c.name || '').toUpperCase().includes('LIVING') ||
      (c.company_name || '').toUpperCase().includes('LIVING')
    );
    if (found) return found.id;
    const names = list.slice(0, 10).map(c => c.name || c.company_name).join(', ');
    throw new Error(`Client "LIVING" introuvable. Clients disponibles : ${names}`);
  } catch(e) {
    throw new Error(`Recherche client Pennylane: ${e.message}`);
  }
}

// Libellé du mois en français depuis "2026-01"
function moisLabel(mois) {
  const [y, m] = mois.split('-');
  return `${MOIS_FR[parseInt(m) - 1]} ${y}`;
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { headers: CORS });
  if (req.method !== 'POST') return resp({ error: 'Méthode non autorisée' }, 405);

  let body;
  try { body = await req.json(); } catch(e) { return resp({ error: 'Body JSON invalide' }, 400); }

  const { mois, force = false } = body;

  // Validation du mois
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
    return resp({ error: 'mois invalide — format attendu: 2026-01' }, 400);
  }

  const token = getEnv('PENNYLANE_SARL_TOKEN');
  if (!token) return resp({ error: 'PENNYLANE_SARL_TOKEN manquant' }, 500);

  try {
    // Vérifier si la facture existe déjà en base
    const existing = await sbFetch(`/management_fees_invoices?mois=eq.${mois}&limit=1`);
    if (existing?.length > 0 && !force) {
      return resp({
        ok: false,
        already_exists: true,
        mois,
        invoice_number: existing[0].invoice_number,
        pennylane_url: existing[0].pennylane_url,
        error: `Facture déjà émise pour ${moisLabel(mois)} : ${existing[0].invoice_number}. Passez force:true pour recréer.`
      }, 409);
    }

    // Trouver le client LIVING dans Pennylane
    const customerId = await findCustomerLiving(token);

    // Dates
    const today = new Date().toISOString().split('T')[0];
    const deadline = new Date(Date.now() + 15 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const label = moisLabel(mois);

    // Créer la facture dans Pennylane — payload direct sans wrapper
    const invoicePayload = {
      customer_id: customerId,
      date: today,
      deadline: deadline,
      invoice_lines: [{
        label: `Convention de management fees GUIRAUD JULIEN / SAS LIVING — ${label}`,
        quantity: 1,
        unit: 'piece',
        raw_currency_unit_price: String(AMOUNT_HT),
        vat_rate: TVA_CODE
      }]
    };

    const result = await plFetch(token, 'POST', '/customer_invoices', invoicePayload);
    const doc = result.invoice || result;
    const invoiceNumber = doc.invoice_number || String(doc.id);
    const pennylaneId = doc.id;
    const pennylaneUrl = doc.public_url || `https://app.pennylane.com/invoices/${pennylaneId}`;

    // Enregistrer en base
    const sbPayload = {
      mois,
      invoice_id: String(pennylaneId),
      invoice_number: invoiceNumber,
      invoice_date: today,
      amount_ht: AMOUNT_HT,
      tva: AMOUNT_HT * 0.20,
      amount_ttc: AMOUNT_HT * 1.20,
      status: 'emise',
      pennylane_url: pennylaneUrl
    };

    // Upsert (force = update si existe)
    await sbFetch('/management_fees_invoices', {
      method: 'POST',
      body: sbPayload,
      prefer: 'resolution=merge-duplicates,return=minimal',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' }
    });

    return resp({
      ok: true,
      mois,
      mois_label: label,
      invoice_number: invoiceNumber,
      pennylane_id: pennylaneId,
      pennylane_url: pennylaneUrl,
      amount_ht: AMOUNT_HT,
      tva: AMOUNT_HT * 0.20,
      amount_ttc: AMOUNT_HT * 1.20,
      invoice_date: today,
      deadline
    });

  } catch(e) {
    return resp({ ok: false, error: e.message }, 500);
  }
};

export const config = { path: '/api/management-fees-invoice' };
