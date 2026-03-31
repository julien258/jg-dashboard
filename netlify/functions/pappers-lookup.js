// pappers-lookup.js — Enrichissement fournisseur depuis SIREN via API Pappers

function getEnv(key) {
  return process.env[key] || null;
}

export default async (req) => {
  const url = new URL(req.url);
  const siren = url.searchParams.get('siren')?.replace(/\s/g, '');

  if (!siren || siren.length !== 9) {
    return new Response(JSON.stringify({ ok: false, error: 'SIREN invalide (9 chiffres requis)' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const apiKey = getEnv('PAPPERS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Clé Pappers manquante' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const res = await fetch(
      `https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${apiKey}`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Pappers ${res.status}: ${txt.substring(0, 200)}`);
    }
    const data = await res.json();

    // Normaliser la réponse
    return new Response(JSON.stringify({
      ok: true,
      siren: data.siren,
      denomination: data.nom_entreprise || data.denomination,
      forme_juridique: data.forme_juridique,
      code_naf: data.code_naf,
      numero_tva_intracommunautaire: data.numero_tva_intracommunautaire,
      siret_siege: data.siege?.siret,
      siege: {
        adresse_ligne_1: [data.siege?.numero_voie, data.siege?.type_voie, data.siege?.libelle_voie].filter(Boolean).join(' '),
        code_postal: data.siege?.code_postal,
        ville: data.siege?.ville
      },
      dirigeants: (data.dirigeants || []).slice(0, 3).map(d => `${d.prenom || ''} ${d.nom || d.denomination || ''}`.trim()),
      capital: data.capital,
      date_creation: data.date_creation,
      effectif: data.tranche_effectif_salarie
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/pappers-lookup' };
