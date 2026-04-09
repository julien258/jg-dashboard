// pappers-lookup.js — Enrichissement société via API Pappers
// GET /api/pappers-lookup?siren=XXX         → fiche complète par SIREN
// GET /api/pappers-lookup?nom=XXX           → recherche par nom (retourne liste)
// GET /api/pappers-lookup?siren=XXX&full=1  → fiche + bilans + procédures judiciaires

export default async (req) => {
  const url = new URL(req.url);
  const siren  = url.searchParams.get('siren')?.replace(/\s/g, '');
  const nom    = url.searchParams.get('nom');
  const full   = url.searchParams.get('full') === '1';

  const apiKey = process.env.PAPPERS_API_KEY;
  if (!apiKey) {
    return json({ ok: false, error: 'PAPPERS_API_KEY manquante dans Netlify env vars' }, 500);
  }

  try {
    // MODE RECHERCHE PAR NOM
    if (nom && !siren) {
      const res = await pappersGet(`https://api.pappers.fr/v2/recherche?q=${encodeURIComponent(nom)}&par_page=5&api_token=${apiKey}`);
      const resultats = (res.resultats || []).map(e => ({
        siren:         e.siren,
        denomination:  e.nom_entreprise || e.denomination,
        forme:         e.forme_juridique,
        siege:         [e.siege?.code_postal, e.siege?.ville].filter(Boolean).join(' '),
        statut:        e.statut_juridique,
        date_creation: e.date_creation,
        code_naf:      e.code_naf,
      }));
      return json({ ok: true, query: nom, total: res.total, resultats });
    }

    // MODE FICHE PAR SIREN
    if (!siren || siren.length !== 9) {
      return json({ ok: false, error: 'Paramètre siren (9 chiffres) ou nom requis' }, 400);
    }

    const data = await pappersGet(`https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${apiKey}`);

    const fiche = {
      ok:              true,
      siren:           data.siren,
      denomination:    data.nom_entreprise || data.denomination,
      forme_juridique: data.forme_juridique,
      statut:          data.statut_juridique,
      code_naf:        data.code_naf,
      libelle_naf:     data.libelle_code_naf,
      tva_intra:       data.numero_tva_intracommunautaire,
      date_creation:   data.date_creation,
      capital:         data.capital ? `${Number(data.capital).toLocaleString('fr-FR')} €` : null,
      effectif:        data.tranche_effectif_salarie,
      siege: {
        adresse:    [data.siege?.numero_voie, data.siege?.type_voie, data.siege?.libelle_voie].filter(Boolean).join(' '),
        code_postal: data.siege?.code_postal,
        ville:       data.siege?.ville,
        siret:       data.siege?.siret,
      },
      dirigeants: (data.dirigeants || []).map(d => ({
        nom:            `${d.prenom || ''} ${d.nom || d.denomination || ''}`.trim(),
        qualite:        d.qualite,
        date_naissance: d.date_de_naissance_formate,
      })),
      beneficiaires: (data.beneficiaires_effectifs || []).map(b => ({
        nom:   `${b.prenom || ''} ${b.nom || ''}`.trim(),
        parts: b.pourcentage_parts,
      })),
    };

    if (!full) return json(fiche);

    // MODE FULL : bilans + procédures judiciaires
    const [bilansRes, proceduresRes] = await Promise.allSettled([
      pappersGet(`https://api.pappers.fr/v2/entreprise?siren=${siren}&extrait_inpi=true&api_token=${apiKey}`),
      pappersGet(`https://api.pappers.fr/v2/entreprise?siren=${siren}&procedures_collectives=true&api_token=${apiKey}`),
    ]);

    const bilansData = bilansRes.status === 'fulfilled' ? bilansRes.value : {};
    fiche.bilans = (bilansData.finances || []).slice(0, 3).map(b => ({
      annee:            b.annee,
      chiffre_affaires: b.chiffre_affaires ? `${Number(b.chiffre_affaires).toLocaleString('fr-FR')} €` : null,
      resultat:         b.resultat ? `${Number(b.resultat).toLocaleString('fr-FR')} €` : null,
      effectif:         b.effectif,
    }));

    const procData = proceduresRes.status === 'fulfilled' ? proceduresRes.value : {};
    const procedures = procData.procedures_collectives || [];
    fiche.procedures_collectives = procedures.map(p => ({
      type:          p.type,
      date_debut:    p.date_debut,
      date_fin:      p.date_fin,
      tribunal:      p.tribunal,
    }));
    fiche.alerte_juridique = procedures.some(p => !p.date_fin);

    return json(fiche);

  } catch(e) {
    return json({ ok: false, error: e.message }, 500);
  }
};

async function pappersGet(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Pappers HTTP ${res.status}: ${txt.substring(0, 300)}`);
  }
  return res.json();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export const config = { path: '/api/pappers-lookup' };
