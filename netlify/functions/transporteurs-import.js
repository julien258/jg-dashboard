// transporteurs-import.js
// Importe la base RNTR dans Supabase par chunks
// POST /api/transporteurs-import   body: { records: [...], reset: false }
// Le CSV est découpé côté client en chunks de 500 lignes et envoyé en plusieurs POST

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  try {
    const body = await req.json();
    const { records = [], reset = false } = body;

    if (!records.length) {
      return json({ ok: false, error: 'Aucun record fourni' }, 400);
    }

    // Optionnel : vider la table avant import
    if (reset) {
      await fetch(`${SUPABASE_URL}/rest/v1/transporteurs_rntr?siren=neq.null`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
    }

    // Nettoyer et formater les records
    const cleaned = records.map(r => ({
      siren:            String(r.siren || '').trim(),
      siret:            String(r.siret || '').trim() || null,
      nom_entreprise:   String(r.nom_entreprise || '').trim() || null,
      forme_juridique:  String(r.forme_juridique || '').trim() || null,
      code_postal:      String(r.code_postal || '').trim() || null,
      ville:            String(r.ville || '').trim() || null,
      code_departement: String(r.code_departement || '').trim() || null,
      nom_departement:  String(r.nom_departement || '').trim() || null,
      gestionnaire:     String(r.gestionnaire || '').trim() || null,
      date_fin_lti:     String(r.date_fin_lti || '').trim() || null,
      nb_copies_lti:    String(r.nb_copies_lti || '').trim() || null,
      nb_copies_lc:     String(r.nb_copies_lc || '').trim() || null,
      type_activite:    String(r.type_activite || '').trim() || null,
      segment_ticpe:    String(r.segment_ticpe || '').trim() || null,
    })).filter(r => r.siren.length === 9);

    // Upsert dans Supabase
    const res = await fetch(`${SUPABASE_URL}/rest/v1/transporteurs_rntr`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(cleaned)
    });

    if (!res.ok) {
      const err = await res.text();
      return json({ ok: false, error: err }, 500);
    }

    return json({ ok: true, imported: cleaned.length, ignored: records.length - cleaned.length });

  } catch(e) {
    return json({ ok: false, error: e.message }, 500);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { path: '/api/transporteurs-import' };
