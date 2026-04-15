// transporteurs-enrich.js
// Enrichit la base RNTR avec les données Pappers, par batch de 50
// GET  /api/transporteurs-enrich?action=status   → progression
// POST /api/transporteurs-enrich?batch=50        → enrichit 50 SIRENs
// GET  /api/transporteurs-enrich?action=export   → export JSON complet enrichi

const SUPABASE_URL = () => process.env.SUPABASE_URL;
const SUPABASE_KEY = () => process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const PAPPERS_KEY  = () => process.env.PAPPERS_API_KEY;

function supa(path, opts = {}) {
  return fetch(`${SUPABASE_URL()}/rest/v1${path}`, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY(),
      'Authorization': `Bearer ${SUPABASE_KEY()}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
      ...(opts.headers || {}),
    }
  });
}

async function getPappers(siren) {
  const url = `https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${PAPPERS_KEY()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Pappers ${res.status}`);
  return res.json();
}

function extractEnrichment(data, siren) {
  const dirigeant = (data.dirigeants || [])[0] || {};
  const finances  = (data.finances || []).sort((a, b) => (b.annee || 0) - (a.annee || 0));
  const dernier   = finances[0] || {};
  const siege     = data.siege || {};

  return {
    siren,
    nom_pappers:          data.nom_entreprise || data.denomination || null,
    forme_juridique:      data.forme_juridique || null,
    code_naf:             data.code_naf || null,
    statut:               data.statut_juridique || null,
    date_creation:        data.date_creation || null,
    effectif:             data.tranche_effectif_salarie || null,
    capital:              data.capital ? String(data.capital) : null,
    ca_dernier:           dernier.chiffre_affaires ? Number(dernier.chiffre_affaires) : null,
    resultat_dernier:     dernier.resultat ? Number(dernier.resultat) : null,
    dirigeant_nom:        `${dirigeant.prenom || ''} ${dirigeant.nom || dirigeant.denomination || ''}`.trim() || null,
    dirigeant_qualite:    dirigeant.qualite || null,
    telephone:            data.telephone || null,
    email:                data.email || null,
    site_web:             data.site_web || null,
    adresse:              [siege.numero_voie, siege.type_voie, siege.libelle_voie].filter(Boolean).join(' ') || null,
    code_postal:          siege.code_postal || null,
    ville:                siege.ville || null,
    procedure_collective: (data.procedures_collectives || []).some(p => !p.date_fin),
    statut_enrichissement: 'done',
    enrichi_at:           new Date().toISOString(),
  };
}

export default async (req) => {
  const url    = new URL(req.url);
  const action = url.searchParams.get('action');
  const batch  = parseInt(url.searchParams.get('batch') || '50');
  const segment = url.searchParams.get('segment') || 'tpe'; // tpe | pme | all

  try {
    // ── STATUS ──────────────────────────────────────────
    if (action === 'status') {
      const [rntrRes, enrichiRes] = await Promise.all([
        supa('/transporteurs_rntr?select=count', { headers: { 'Prefer': 'count=exact', 'Range': '0-0' } }),
        supa('/transporteurs_enrichis?select=count,statut_enrichissement', { headers: { 'Prefer': 'count=exact', 'Range': '0-0' } }),
      ]);
      const total  = parseInt(rntrRes.headers.get('content-range')?.split('/')[1] || '0');
      const enrichi = parseInt(enrichiRes.headers.get('content-range')?.split('/')[1] || '0');

      // Compter par statut
      const byStatus = await supa('/transporteurs_enrichis?select=statut_enrichissement').then(r => r.json());
      const counts = {};
      (byStatus || []).forEach(r => { counts[r.statut_enrichissement] = (counts[r.statut_enrichissement] || 0) + 1; });

      return json({
        ok: true,
        total_rntr:    total,
        total_enrichi: enrichi,
        reste:         total - enrichi,
        pct:           total > 0 ? Math.round(enrichi / total * 100) : 0,
        par_statut:    counts,
        prochain_batch: `POST /api/transporteurs-enrich?batch=${batch}&segment=${segment}`,
      });
    }

    // ── EXPORT ──────────────────────────────────────────
    if (action === 'export') {
      const data = await supa(
        `/transporteurs_rntr?select=*,transporteurs_enrichis(*)&segment_ticpe=eq.tpe&limit=500`
      ).then(r => r.json());
      return json({ ok: true, count: data.length, data });
    }

    // ── ENRICHISSEMENT PAR BATCH ────────────────────────
    // 1. Récupérer SIRENs pas encore enrichis
    const segFilter = segment === 'all' ? '' : `&segment_ticpe=eq.${segment}`;
    const rntrData = await supa(
      `/transporteurs_rntr?select=siren,nom_entreprise,segment_ticpe${segFilter}&limit=${batch}`
    ).then(r => r.json());

    if (!rntrData.length) {
      return json({ ok: true, message: 'Aucun SIREN à enrichir pour ce segment.' });
    }

    // Filtrer ceux déjà enrichis
    const sirens = rntrData.map(r => r.siren);
    const dejaDone = await supa(
      `/transporteurs_enrichis?select=siren&siren=in.(${sirens.join(',')})`
    ).then(r => r.json()).then(rows => new Set((rows || []).map(r => r.siren)));

    const aEnrichir = rntrData.filter(r => !dejaDone.has(r.siren));

    if (!aEnrichir.length) {
      return json({ ok: true, message: 'Batch déjà enrichi. Relance pour le suivant.' });
    }

    // 2. Enrichir via Pappers (séquentiel pour respecter rate limit)
    const results = { done: [], errors: [], skipped: 0 };
    results.skipped = rntrData.length - aEnrichir.length;

    for (const company of aEnrichir) {
      try {
        await new Promise(r => setTimeout(r, 200)); // 5 req/sec max
        const pappers = await getPappers(company.siren);
        const enriched = extractEnrichment(pappers, company.siren);
        results.done.push(enriched);
      } catch(e) {
        results.errors.push({ siren: company.siren, nom: company.nom_entreprise, error: e.message });
      }
    }

    // 3. Upsert dans Supabase
    if (results.done.length > 0) {
      await supa('/transporteurs_enrichis', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(results.done),
      });
    }

    return json({
      ok:      true,
      traites: aEnrichir.length,
      reussis: results.done.length,
      erreurs: results.errors.length,
      skipped: results.skipped,
      erreurs_detail: results.errors.slice(0, 5),
      conseil: results.done.length < batch
        ? 'Batch terminé. Relance pour continuer.'
        : `Continue : POST /api/transporteurs-enrich?batch=${batch}&segment=${segment}`,
    });

  } catch(e) {
    return json({ ok: false, error: e.message }, 500);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { path: '/api/transporteurs-enrich' };
