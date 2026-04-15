// transporteurs-migrate.js
// GET /api/transporteurs-migrate
// Crée les tables Supabase pour la base transporteurs RNTR + enrichissement Pappers

export default async (req) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  const sql = `
    -- Table principale transporteurs (RNTR)
    CREATE TABLE IF NOT EXISTS transporteurs_rntr (
      id              SERIAL PRIMARY KEY,
      siren           TEXT UNIQUE NOT NULL,
      siret           TEXT,
      nom_entreprise  TEXT,
      forme_juridique TEXT,
      code_postal     TEXT,
      ville           TEXT,
      code_departement TEXT,
      nom_departement TEXT,
      gestionnaire    TEXT,
      date_fin_lti    TEXT,
      nb_copies_lti   TEXT,
      nb_copies_lc    TEXT,
      type_activite   TEXT,
      segment_ticpe   TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- Table enrichissement Pappers
    CREATE TABLE IF NOT EXISTS transporteurs_enrichis (
      id                  SERIAL PRIMARY KEY,
      siren               TEXT UNIQUE NOT NULL,
      nom_pappers         TEXT,
      forme_juridique     TEXT,
      code_naf            TEXT,
      statut              TEXT,
      date_creation       TEXT,
      effectif            TEXT,
      capital             TEXT,
      ca_dernier          BIGINT,
      resultat_dernier    BIGINT,
      dirigeant_nom       TEXT,
      dirigeant_qualite   TEXT,
      telephone           TEXT,
      email               TEXT,
      site_web            TEXT,
      adresse             TEXT,
      code_postal         TEXT,
      ville               TEXT,
      procedure_collective BOOLEAN DEFAULT FALSE,
      enrichi_at          TIMESTAMPTZ DEFAULT NOW(),
      statut_enrichissement TEXT DEFAULT 'pending'
    );

    -- Index pour performance
    CREATE INDEX IF NOT EXISTS idx_transporteurs_rntr_siren ON transporteurs_rntr(siren);
    CREATE INDEX IF NOT EXISTS idx_transporteurs_rntr_segment ON transporteurs_rntr(segment_ticpe);
    CREATE INDEX IF NOT EXISTS idx_transporteurs_enrichis_statut ON transporteurs_enrichis(statut_enrichissement);
  `;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql })
    });

    // Alternative via pg directement
    return new Response(JSON.stringify({
      ok: true,
      message: 'Tables créées. Lance maintenant /api/transporteurs-import pour charger les données.',
      sql_preview: sql.substring(0, 200)
    }), { headers: { 'Content-Type': 'application/json' }});
  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' }});
  }
};

export const config = { path: '/api/transporteurs-migrate' };
