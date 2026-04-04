// management-fees.js — Calcul convention management fees GUIRAUD → LIVING
// GET /api/management-fees
// Lit les données foyer-budget (avr–déc 2026) + charges SARL GUIRAUD depuis Supabase

export default async (req) => {
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const SB_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) return Response.json({ ok: false, error: 'SUPABASE_SERVICE_KEY manquant' }, { status: 500, headers: CORS });

  const sbHeaders = { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey };
  const sbFetch = async (table, params = '') => {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${params}`, { headers: sbHeaders });
    return r.ok ? r.json() : [];
  };

  try {
    const [fixes, dettes_perso, mensuel, projets_perso, projects, charges_g, dettes_g] = await Promise.all([
      sbFetch('fixed_expenses', 'active=eq.true'),
      sbFetch('debts', 'company_id=eq.perso&status=neq.solde'),
      sbFetch('budget_mensuel_perso'),
      sbFetch('projets_perso'),
      sbFetch('projects'),
      sbFetch('recurring_charges', 'company_id=eq.sarl-guiraud&is_active=eq.true'),
      sbFetch('debts', 'company_id=eq.sarl-guiraud&status=neq.solde'),
    ]);

    // Index mensuel
    const mensuelMap = {};
    (mensuel || []).forEach(m => { mensuelMap[m.mois] = m; });

    // Charges fixes perso
    const fixesBase = (fixes || []).reduce((s, f) => s + Number(f.amount || 0), 0);

    // Projets fusionnés
    const nomsCoverts = new Set((projets_perso || []).map(p => (p.nom || p.name || '').toLowerCase()));
    const allProjets = [
      ...(projects || []).map(p => ({ ...p, cout_total: p.budget || p.cout_total, nom: p.name, duree_mois: p.duration_months || p.duree_mois })).filter(p => !nomsCoverts.has((p.name || '').toLowerCase())),
      ...(projets_perso || []).map(p => ({ ...p, name: p.nom })),
    ];

    function dettesMois(year, month) {
      return (dettes_perso || []).filter(d => {
        if (d.frequency !== 'monthly') return false;
        if (d.nature?.includes('IR 2025')) return false;
        const ms = new Date(year, month, 1);
        if (d.start_date) { const s = new Date(d.start_date); if (ms < new Date(s.getFullYear(), s.getMonth(), 1)) return false; }
        if (d.end_date) { const e = new Date(d.end_date); if (ms > new Date(e.getFullYear(), e.getMonth(), 1)) return false; }
        return true;
      }).reduce((s, d) => s + Number(d.monthly_amount || 0), 0);
    }

    function ir2025Mois(monthIndex) {
      if (monthIndex < 8 || monthIndex > 11) return 0;
      const d = (dettes_perso || []).find(d => d.nature?.includes('IR 2025'));
      return d ? Number(d.monthly_amount || 0) : 0;
    }

    function projetsMois(year, month) {
      let t = 0;
      allProjets.forEach(p => {
        if (p.date_debut && p.duree_mois) {
          const cout = p.cout_total || p.budget || 0;
          const mp = Math.ceil(cout / p.duree_mois);
          for (let k = 0; k < p.duree_mois; k++) {
            const dd = new Date(p.date_debut);
            dd.setMonth(dd.getMonth() + k);
            if (dd.getFullYear() === year && dd.getMonth() === month) t += mp;
          }
        }
      });
      return t;
    }

    // GUIRAUD
    const gCharges = (charges_g || []).reduce((s, c) => s + Number(c.amount || 0), 0);
    const gDettes = (dettes_g || []).filter(d => d.frequency === 'monthly').reduce((s, d) => s + Number(d.monthly_amount || 0), 0);
    const gTotal = gCharges + gDettes;

    // Calcul avr (index 3) → déc (index 11)
    const MOIS_LABELS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const moisData = [];
    let totalPerso = 0;

    for (let i = 3; i <= 11; i++) {
      const key = `2026-${String(i + 1).padStart(2, '0')}-01`;
      const men = mensuelMap[key] || {};
      const dettes = dettesMois(2026, i);
      const ir = ir2025Mois(i);
      const vars = men.depenses_variables != null ? Number(men.depenses_variables) : 0;
      const impots = men.impots_pas != null ? Number(men.impots_pas) : 0;
      const rav = men.rav_cible != null ? Number(men.rav_cible) : 0;
      const projets = projetsMois(2026, i);
      const revNec = dettes + ir + fixesBase + vars + impots + projets + rav;
      totalPerso += revNec;
      moisData.push({ mois: MOIS_LABELS[i], key, dettes, ir, fixes: fixesBase, vars, impots, projets, rav, revNec });
    }

    const totalG9 = gTotal * 9;
    const totalAnnee = totalPerso + totalG9;
    const mensuelConvention = Math.round(totalAnnee / 12);

    return Response.json({
      ok: true,
      moisData,
      guiraud: {
        charges: (charges_g || []).map(c => ({ label: c.label || c.name, amount: Number(c.amount || 0) })),
        dettes: (dettes_g || []).filter(d => d.frequency === 'monthly').map(d => ({ label: d.label || d.nature, amount: Number(d.monthly_amount || 0) })),
        chargesTotal: gCharges,
        dettesTotal: gDettes,
        total: gTotal,
      },
      totaux: {
        perso9mois: Math.round(totalPerso),
        guiraud9mois: Math.round(totalG9),
        total9mois: Math.round(totalAnnee),
        mensuelConvention,
        ttc: Math.round(mensuelConvention * 1.2),
        tva: Math.round(mensuelConvention * 0.2),
      },
      sources: {
        fixesBase,
        nbDettesPerso: dettes_perso.length,
        nbChargesG: (charges_g || []).length,
        nbDettesG: (dettes_g || []).filter(d => d.frequency === 'monthly').length,
        nbMoisSauvegardes: (mensuel || []).filter(m => m.mois >= '2026-04-01' && m.mois <= '2026-12-01').length,
      }
    }, { headers: CORS });

  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500, headers: CORS });
  }
};

export const config = { path: '/api/management-fees' };
