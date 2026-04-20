// pennylane-batch-meulette-2025.js
// POST /api/pennylane-batch-meulette-2025?dry_run=true|false
// Crée toutes les factures manquantes 2025 pour La Meulette
//
// Stratégie :
//  1) Hardcode la liste des 42 factures à créer (tiers, période, lignes)
//  2) Résout les customer_ids Pennylane par nom exact via GET /customers
//  3) POST /customer_invoices pour chaque facture (ligne par ligne avec bon TVA)
//  4) Retourne un récap JSON détaillé

const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';

function getEnv(k) { return process.env[k] || null; }

async function pl(token, method, path, body) {
  const res = await fetch(`${PENNYLANE_API}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch(e) {}
  if (!res.ok) {
    const err = new Error(`Pennylane ${res.status}: ${text.substring(0, 400)}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

// Récupère tous les clients Pennylane (pagination)
async function fetchAllCustomers(token) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const path = cursor
      ? `/customers?per_page=100&cursor=${encodeURIComponent(cursor)}`
      : `/customers?per_page=100`;
    const res = await pl(token, 'GET', path);
    const items = res.items || res.customers || (Array.isArray(res) ? res : []);
    all.push(...items);
    cursor = res.next_cursor || null;
    if (!cursor || items.length === 0) break;
  }
  return all;
}

// === LISTE DES 42 FACTURES À CRÉER ===
// Structure : { tiers, date, periode, lines: [{label, ht, tva_rate}] }
// TVA : "FR_200" (20%) | "FR_000" (0%, pour charges)

function buildInvoiceList() {
  const list = [];
  const m = n => String(n).padStart(2, '0');
  const dateMois = n => `2025-${m(n)}-05`;
  const periode = n => {
    const noms = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    return noms[n-1] + ' 2025';
  };

  // --- PANGEE : jan à sept 2025 (9 factures) ---
  // Ventilation : 2000 loc + 300 charges (0% TVA) + 980 prestation = 3280 HT
  for (let mo = 1; mo <= 9; mo++) {
    list.push({
      tiers: 'PANGEE',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureaux',                       ht: 2000, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht:  300, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  980, tva: 'FR_200' },
      ]
    });
  }

  // --- DATA SENSEI : 12 mois 2025 ---
  // 200 loc + 30 charges (0%) + 98 prestation = 328 HT
  for (let mo = 1; mo <= 12; mo++) {
    list.push({
      tiers: 'DATA SENSEI',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureau et siège social',        ht: 200, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht:  30, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  98, tva: 'FR_200' },
      ]
    });
  }

  // --- HGP : 12 mois 2025 ---
  for (let mo = 1; mo <= 12; mo++) {
    list.push({
      tiers: 'HGP',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureau et siège social',        ht: 200, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht:  30, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  98, tva: 'FR_200' },
      ]
    });
  }

  // --- FINANCE PHARMA : jan-avr + oct-déc (7 mois à compléter) ---
  // Déjà émises dans Pennylane : mai à sept (F-2025-09-158 à 162)
  // 100 loc + 100 charges (0%) + 98 prestation = 298 HT
  for (const mo of [1,2,3,4,10,11,12]) {
    list.push({
      tiers: 'FINANCE PHARMA',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureau et siège social',        ht: 100, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht: 100, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  98, tva: 'FR_200' },
      ]
    });
  }

  // --- MA CENTRALE GENERIQUES : jan-fév + oct-déc (5 mois) ---
  // Déjà émises : mars-sept (F-2025-09-164) + rattrapage nov 2024 (F-2025-09-163)
  for (const mo of [1,2,10,11,12]) {
    list.push({
      tiers: 'MA CENTRALE GENERIQUES',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureau et siège social',        ht: 100, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht: 100, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  98, tva: 'FR_200' },
      ]
    });
  }

  // --- PHARM & YOU CONSULTING : jan-fév + oct-déc (5 mois) ---
  // Déjà émises : mars-sept (F-2025-09-165)
  for (const mo of [1,2,10,11,12]) {
    list.push({
      tiers: 'PHARM & YOU CONSULTING',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureau et siège social',        ht: 100, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht: 100, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  98, tva: 'FR_200' },
      ]
    });
  }

  // --- PHARM & YOU GROUP : jan-fév + oct-déc (5 mois) ---
  // Déjà émises : mars-sept (F-2025-09-166)
  for (const mo of [1,2,10,11,12]) {
    list.push({
      tiers: 'PHARM & YOU GROUP',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'LOCATION - Bureau et siège social',        ht: 100, tva: 'FR_200' },
        { label: 'Provision sur charge',                     ht: 100, tva: 'FR_000' },
        { label: 'Convention de prestation de services',     ht:  98, tva: 'FR_200' },
      ]
    });
  }

  // --- SARL GUIRAUD JULIEN : 12 mois (mise à dispo siège social Fronsac) ---
  // 1200 HT/mois
  for (let mo = 1; mo <= 12; mo++) {
    list.push({
      tiers: 'GUIRAUD JULIEN',
      date: dateMois(mo),
      periode: periode(mo),
      lines: [
        { label: 'Prestation - mise à disposition siège social Fronsac', ht: 1200, tva: 'FR_200' },
      ]
    });
  }

  return list;
}

// Helpers de match de tiers (tolérant aux variantes de casse / accents)
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function findCustomer(customers, tiersName) {
  const target = norm(tiersName);
  return customers.find(c => norm(c.name || c.company_name || '') === target) || null;
}

export default async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dry_run') !== 'false'; // défaut = dry run pour sécurité

  const token = getEnv('PENNYLANE_MEULETTE_TOKEN');
  if (!token) {
    return Response.json({ ok: false, error: 'PENNYLANE_MEULETTE_TOKEN manquant' }, { status: 500 });
  }

  try {
    // 1) Récupérer tous les clients Meulette
    const customers = await fetchAllCustomers(token);

    // 2) Construire la liste
    const invoices = buildInvoiceList();

    // 3) Résoudre les customer_ids
    const uniqueTiers = [...new Set(invoices.map(i => i.tiers))];
    const resolution = {};
    const unresolved = [];
    for (const t of uniqueTiers) {
      const c = findCustomer(customers, t);
      if (c) {
        resolution[t] = { id: c.id, name: c.name || c.company_name };
      } else {
        unresolved.push(t);
      }
    }

    if (unresolved.length > 0) {
      return Response.json({
        ok: false,
        error: 'Tiers introuvables dans Pennylane',
        unresolved,
        customers_sample: customers.slice(0, 20).map(c => ({ id: c.id, name: c.name || c.company_name }))
      }, { status: 400 });
    }

    // 4) Récap avant création
    const recap = {
      total_factures: invoices.length,
      dry_run: dryRun,
      resolution,
      par_tiers: {}
    };
    for (const i of invoices) {
      const ht = i.lines.reduce((s, l) => s + l.ht, 0);
      if (!recap.par_tiers[i.tiers]) recap.par_tiers[i.tiers] = { nb: 0, total_ht: 0 };
      recap.par_tiers[i.tiers].nb += 1;
      recap.par_tiers[i.tiers].total_ht += ht;
    }
    recap.total_ht_global = Object.values(recap.par_tiers).reduce((s, x) => s + x.total_ht, 0);

    if (dryRun) {
      return Response.json({ ok: true, dry_run: true, recap, first_invoice_preview: invoices[0] });
    }

    // 5) Créer réellement les factures
    const created = [];
    const errors = [];

    for (let idx = 0; idx < invoices.length; idx++) {
      const inv = invoices[idx];
      const customerId = resolution[inv.tiers].id;

      const deadline = inv.date; // même date que l'émission (comme les existantes)

      const payload = {
        invoice: {
          customer_id: customerId,
          date: inv.date,
          deadline: deadline,
          invoice_lines: inv.lines.map(l => ({
            label: l.label,
            quantity: 1,
            unit_price: l.ht,
            vat_rate: l.tva
          })),
          currency: 'EUR'
        }
      };

      try {
        const res = await pl(token, 'POST', '/customer_invoices', payload);
        const doc = res.invoice || res.customer_invoice || res;
        created.push({
          idx,
          tiers: inv.tiers,
          periode: inv.periode,
          date: inv.date,
          pennylane_id: doc.id,
          invoice_number: doc.invoice_number || null,
          status: doc.status || null,
          total_ht: inv.lines.reduce((s, l) => s + l.ht, 0)
        });
      } catch (e) {
        errors.push({
          idx,
          tiers: inv.tiers,
          periode: inv.periode,
          date: inv.date,
          error: e.message,
          payload_sent: payload
        });
      }

      // Throttle léger pour éviter rate limit
      if (idx % 5 === 4) await new Promise(r => setTimeout(r, 300));
    }

    return Response.json({
      ok: errors.length === 0,
      dry_run: false,
      nb_crees: created.length,
      nb_erreurs: errors.length,
      recap,
      created,
      errors
    });

  } catch (e) {
    return Response.json({ ok: false, error: e.message, stack: e.stack?.substring(0, 500) }, { status: 500 });
  }
};

export const config = { path: '/api/pennylane-batch-meulette-2025' };
