// expense-receipt-detect-type.js
// OCR via Claude pour détecter automatiquement le type d'un justificatif
// POST { base64, mimeType }
// Retour : { doc_type, supplier_name, supplier_email, total_ttc, date_doc, confidence, raw }

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

const PROMPT = `Tu analyses un document financier (justificatif de dépense). Retourne UNIQUEMENT un JSON valide, sans texte autour, sans backticks.

Format strict :
{
  "doc_type": "devis" | "bon_commande" | "facture" | "facture_acquittee" | "ticket" | "livraison" | "autre",
  "supplier_name": "nom du fournisseur ou null",
  "supplier_email": "email contact ou null",
  "total_ttc": montant numérique TTC ou null,
  "date_doc": "YYYY-MM-DD" ou null,
  "confidence": "high" | "medium" | "low"
}

Règles :
- "devis" si le document mentionne explicitement "devis", "estimation", "quote", "proposal" ou s'il s'agit d'une proposition non payée
- "facture_acquittee" si mention "acquittée", "payée", "réglée", "PAID", "soldée" ou si le solde restant = 0
- "facture" pour une facture standard (non explicitement acquittée)
- "ticket" pour un ticket de caisse (boutique, courses, station)
- "bon_commande" pour bon de commande / order form
- "livraison" pour bon de livraison
- "autre" si rien ne correspond

Réponds avec le JSON et rien d'autre.`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { base64, mimeType } = JSON.parse(event.body || '{}');
    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'base64 required' }) };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Fail-soft : pas de clé = pas d'OCR mais l'upload doit continuer
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'OCR indisponible', doc_type: null }) };
    }

    // Détecter type de contenu pour Claude
    const isPdf = (mimeType || '').includes('pdf');
    const content = isPdf
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: PROMPT },
        ]
      : [
          { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: base64 } },
          { type: 'text', text: PROMPT },
        ];

    const r = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return { statusCode: 200, body: JSON.stringify({ success: false, error: `Claude API ${r.status}: ${t.substring(0, 200)}`, doc_type: null }) };
    }

    const data = await r.json();
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();

    // Extraire le JSON même si Claude met des ```json autour (sécurité)
    let json = text;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) json = m[0];

    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ success: false, error: 'JSON invalide: ' + text.substring(0, 200), doc_type: null }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        doc_type: parsed.doc_type || null,
        supplier_name: parsed.supplier_name || null,
        supplier_email: parsed.supplier_email || null,
        total_ttc: parsed.total_ttc || null,
        date_doc: parsed.date_doc || null,
        confidence: parsed.confidence || 'medium',
      }),
    };
  } catch (e) {
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: String(e.message || e), doc_type: null }),
    };
  }
};
