export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const { base64, titre, partie_adverse, montant, description, juridiction } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY manquante' }), { status: 500, headers });

    const systemPrompt = `Tu es un juriste expert en droit français des affaires, droit commercial et contentieux. 
Tu analyses des documents juridiques et financiers pour produire des analyses claires et actionnables.
Tu réponds toujours en français, de manière structurée et professionnelle.`;

    const userPrompt = `Analyse ce dossier contentieux et produis une analyse juridique structurée.

DOSSIER :
- Titre : ${titre || 'Non précisé'}
- Partie adverse : ${partie_adverse || 'Non précisée'}
- Montant contesté : ${montant ? montant + ' €' : 'Non précisé'}
- Juridiction : ${juridiction || 'Non précisée'}
- Description : ${description || 'Non précisée'}

${base64 ? 'Un document est joint à analyser.' : ''}

Produis une analyse JSON avec exactement cette structure :
{
  "qualification": "qualification juridique du litige en 1-2 phrases",
  "fondements": ["article ou principe juridique 1", "article ou principe juridique 2"],
  "arguments_defense": ["argument défensif 1", "argument défensif 2", "argument défensif 3"],
  "risques": ["risque principal 1", "risque principal 2"],
  "recommandations": ["action recommandée 1", "action recommandée 2"],
  "draft_reponse": "Courrier de réponse type prêt à envoyer (formel, professionnel, en français)",
  "urgence": "faible|modérée|élevée|critique",
  "resume": "résumé exécutif en 3 lignes maximum"
}

Réponds UNIQUEMENT avec le JSON valide, sans markdown ni explication.`;

    const messages = [];
    if (base64) {
      const isPDF = base64.startsWith('JVBERi');
      messages.push({
        role: 'user',
        content: [
          isPDF
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
            : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
          { type: 'text', text: userPrompt }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 4000, system: systemPrompt, messages })
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: 'API Anthropic: ' + response.status, detail: err }), { status: 502, headers });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '{}';
    const clean = rawText.replace(/```json|```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch(e) { parsed = { resume: rawText, error: 'JSON malformé' }; }

    return new Response(JSON.stringify(parsed), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/claude-legal' };
