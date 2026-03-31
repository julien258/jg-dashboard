// netlify/functions/ocr-pro.js
// Fonction OCR universelle — analyse tout document PDF/image via Claude
// Déployer dans : netlify/functions/ocr-pro.js
// Variables d'environnement requises : ANTHROPIC_API_KEY

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const { base64, docType = 'document_universel', company = '', companyId = '', fileName = '' } = body;

    if (!base64) {
      return new Response(JSON.stringify({ error: 'base64 manquant' }), { status: 400, headers });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    console.log('ENV check - SUPABASE_URL:', !!process.env.SUPABASE_URL, 'SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_KEY);
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY non configurée' }), { status: 500, headers });
    }

    // Prompt selon le type de document
    const prompts = {
      facture_recue: `Tu es un OCR expert spécialisé dans les factures françaises et internationales. Extrais TOUTES les informations visibles.
RÈGLES CRITIQUES :
- Les montants avec espaces comme séparateurs (ex: "488 626,67" ou "488 626.67") = 488626.67 — convertis TOUJOURS en nombre décimal avec point
- Le FOURNISSEUR est l'entreprise QUI ÉMET la facture (émetteur, en haut à gauche), PAS le destinataire
- Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant ou après le JSON
{
  "fournisseur": "raison sociale complète de l'émetteur",
  "forme_juridique_fournisseur": "SAS/SARL/SA/etc si visible, sinon null",
  "siret_fournisseur": "SIRET (14 chiffres) si visible, sinon null",
  "siren_fournisseur": "SIREN (9 chiffres) si visible, sinon null",
  "tva_fournisseur": "numéro TVA intracommunautaire ex: FR66442110789, sinon null",
  "adresse_fournisseur": "adresse complète de l'émetteur (rue, cp, ville), sinon null",
  "telephone_fournisseur": "téléphone de l'émetteur si visible, sinon null",
  "email_fournisseur": "email de l'émetteur si visible, sinon null",
  "site_web_fournisseur": "site web si visible, sinon null",
  "iban_fournisseur": "IBAN complet ex: FR76 1820 6002..., sinon null",
  "bic_fournisseur": "BIC/SWIFT si visible, sinon null",
  "banque_fournisseur": "nom de la banque si visible, sinon null",
  "destinataire": "raison sociale du destinataire/client",
  "siret_destinataire": "SIRET du destinataire si visible, sinon null",
  "numero_facture": "numéro de facture exact",
  "date_facture": "date au format YYYY-MM-DD",
  "date_echeance": "date d'échéance au format YYYY-MM-DD, null si absent",
  "periode": "période couverte ex: Mars 2026, Q1 2026, null si absent",
  "objet": "objet ou libellé principal de la facture",
  "lignes": [{"designation": "...", "quantite": 0, "prix_unitaire": 0, "montant_ht": 0}],
  "montant_ht": montant HT total en nombre décimal,
  "tva_taux": taux TVA en pourcentage (ex: 20),
  "montant_tva": montant TVA en nombre décimal,
  "montant_ttc": montant TTC total en nombre décimal,
  "remise": montant remise globale si visible sinon 0,
  "mode_paiement": "virement ou prelevement ou cheque ou carte",
  "code_client": "code client si visible, sinon null",
  "reference_commande": "numéro de commande ou référence si visible, sinon null",
  "urgence": "message si retard/mise en demeure/pénalités détectés, sinon null"
}`,

      facture_emise: `Tu es un OCR expert. Analyse cette facture émise et extrais les informations en JSON strict.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans explication.
{
  "client": "nom du client/destinataire",
  "numero_facture": "numéro de facture",
  "date": "date au format YYYY-MM-DD",
  "echeance": "date d'échéance YYYY-MM-DD, null si absent",
  "objet": "objet ou libellé",
  "ht": nombre décimal ou 0,
  "tva": nombre décimal ou 0,
  "montant_ttc": nombre décimal ou 0,
  "total": nombre décimal (TTC) ou 0
}`,

      releve_bancaire: `Tu es un OCR expert. Analyse ce relevé bancaire et extrais les informations en JSON strict.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans explication.
{
  "banque": "nom de la banque",
  "compte": "numéro de compte ou IBAN partiel",
  "date_debut": "YYYY-MM-DD",
  "date_fin": "YYYY-MM-DD",
  "solde_debut": nombre décimal,
  "solde_fin": nombre décimal,
  "total_debits": nombre décimal (total des dépenses),
  "total_credits": nombre décimal (total des recettes),
  "net": nombre décimal (crédits - débits),
  "montant": nombre décimal (solde final),
  "entite_concernee": "société si visible"
}`,

      bilan: `Tu es un OCR expert comptable. Analyse ce bilan ou compte de résultat et extrais les informations en JSON strict.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans explication.
{
  "societe": "nom de la société",
  "exercice": "année ou période",
  "chiffre_affaires": nombre décimal ou null,
  "resultat_net": nombre décimal ou null,
  "capitaux_propres": nombre décimal ou null,
  "total_bilan": nombre décimal ou null,
  "cc_associe": nombre décimal (compte courant associé si présent) ou null,
  "montant": nombre décimal (valeur principale du document),
  "entite_concernee": "nom de la société"
}`,

      devis: `Tu es un OCR expert. Analyse ce devis et extrais les informations en JSON strict.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans explication.
{
  "fournisseur": "émetteur du devis",
  "client": "destinataire",
  "numero": "numéro du devis",
  "date": "YYYY-MM-DD",
  "validite": "date de validité YYYY-MM-DD ou null",
  "objet": "objet des travaux/prestations",
  "montant_ht": nombre décimal ou 0,
  "tva": nombre décimal ou 0,
  "montant_ttc": nombre décimal ou 0,
  "entite_concernee": "société concernée"
}`,

      document_universel: `Tu es un OCR expert. Analyse ce document et extrais toutes les informations pertinentes en JSON strict.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans explication.
{
  "type_document": "type détecté : facture_recue | facture_emise | releve_bancaire | contrat | courrier | recommande | bilan | devis | autre",
  "emetteur": "expéditeur ou émetteur du document",
  "fournisseur": "fournisseur si facture",
  "siret_fournisseur": "SIRET si visible, sinon null",
  "date": "date principale YYYY-MM-DD",
  "date_echeance": "échéance si présente YYYY-MM-DD ou null",
  "objet": "objet ou sujet du document",
  "montant_ht": nombre décimal ou null,
  "montant_ttc": nombre décimal ou null,
  "montant": nombre décimal (montant principal) ou null,
  "entite_concernee": "société ou entité destinataire",
  "urgence": "message si document urgent (mise en demeure, retard, huissier), sinon null",
  "resume": "résumé en 1 phrase du document"
}`,

      autre: `Tu es un OCR expert. Analyse ce document et extrais toutes les informations pertinentes en JSON strict.
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans explication.
{
  "type_document": "type détecté",
  "emetteur": "expéditeur",
  "date": "YYYY-MM-DD ou null",
  "objet": "sujet principal",
  "montant": nombre décimal ou null,
  "entite_concernee": "entité concernée ou null",
  "urgence": "message si urgent, sinon null",
  "resume": "résumé en 1 phrase"
}`
    };

    const systemPrompt = prompts[docType] || prompts['document_universel'];
    const contextNote = company ? `\nContexte : document appartenant à ${company}.` : '';

    // Sauvegarder le fichier original dans Supabase Storage si c'est une facture reçue
    let storagePath = null;
    if (docType === 'facture_recue' && base64 && fileName) {
      try {
        const sbUrl = process.env.SUPABASE_URL;
        const sbKey = process.env.SUPABASE_SERVICE_KEY;
        if (sbUrl && sbKey) {
          const fileBuffer = Buffer.from(base64, 'base64');
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
          const path = `${companyId || 'unknown'}/${Date.now()}_${safeName}`;
          const contentType = fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? 'image/' + (fileName.match(/\.([^.]+)$/)[1].toLowerCase().replace('jpg','jpeg')) : 'application/pdf';
          const uploadRes = await fetch(`${sbUrl}/storage/v1/object/payables-docs/${path}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${sbKey}`,
              'Content-Type': contentType,
              'x-upsert': 'true'
            },
            body: fileBuffer
          });
          if (uploadRes.ok) { storagePath = path; console.log('Storage OK:', path); }
          else { const t = await uploadRes.text(); console.warn('Storage upload failed:', uploadRes.status, t.substring(0,200)); }
        }
      } catch(e) { console.warn('Storage upload exception:', e.message); }
    }

    // Détecte si c'est un PDF (base64 commence par JVBERi) ou une image
    const isPDF = base64.startsWith('JVBERi') || base64.startsWith('/9j/') === false && base64.length > 100;
    
    // Essaie de deviner le type MIME
    let mediaType = 'image/jpeg';
    if (base64.startsWith('JVBERi')) mediaType = 'application/pdf';
    else if (base64.startsWith('iVBORw')) mediaType = 'image/png';
    else if (base64.startsWith('/9j/')) mediaType = 'image/jpeg';
    else if (base64.startsWith('R0lGO')) mediaType = 'image/gif';

    const contentBlock = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              { type: 'text', text: systemPrompt + contextNote + '\n\nRéponds UNIQUEMENT avec le JSON, sans aucun texte avant ou après.' }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return new Response(JSON.stringify({ error: 'Erreur API Anthropic: ' + response.status, detail: errText }), { status: 502, headers });
    }

    const claudeData = await response.json();
    const rawText = claudeData.content?.[0]?.text || '{}';

    // Nettoie les éventuels backticks markdown
    const cleanText = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      console.error('JSON parse error:', e.message, 'Raw:', cleanText.substring(0, 200));
      // Tente une extraction basique si le JSON est malformé
      parsed = { error: 'JSON malformé', raw: cleanText.substring(0, 500) };
    }

    const debugInfo = {
      _storage_path: storagePath,
      _storage_attempted: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY && fileName),
      _supabase_url_set: !!process.env.SUPABASE_URL,
      _supabase_key_set: !!process.env.SUPABASE_SERVICE_KEY,
      _filename: fileName || null
    };
    return new Response(JSON.stringify({...parsed, ...debugInfo}), { status: 200, headers });

  } catch (err) {
    console.error('ocr-pro error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/.netlify/functions/ocr-pro' };
