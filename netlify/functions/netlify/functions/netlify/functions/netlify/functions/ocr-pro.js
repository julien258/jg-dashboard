const https = require('https');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { base64, docType } = JSON.parse(event.body);
    const apiKey = "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";
    if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'Cle manquante' }) };
    const prompts = {
      bilan: 'Analyse ce bilan. Réponds UNIQUEMENT avec ce JSON sans markdown: {"company":"","year":2024,"ca":0,"resultat_net":0,"total_actif":0,"capitaux_propres":0,"dettes_financieres":0,"tresorerie":0,"cc_associe":0,"cc_filiales":0}',
      facture_recue: 'Analyse cette facture. Réponds UNIQUEMENT avec ce JSON sans markdown: {"fournisseur":"","numero":"","date":"","objet":"","ht":0,"tva":0,"ttc":0,"echeance":""}',
      facture_emise: 'Analyse cette facture. Réponds UNIQUEMENT avec ce JSON sans markdown: {"client":"","numero":"","date":"","objet":"","ht":0,"tva":0,"ttc":0,"echeance":""}',
      releve_bancaire: 'Analyse ce relevé. Réponds UNIQUEMENT avec ce JSON sans markdown: {"bank_name":"","month":1,"year":2026,"total_credits":0,"total_debits":0,"closing_balance":0}',
      devis: 'Analyse ce devis. Réponds UNIQUEMENT avec ce JSON sans markdown: {"fournisseur":"","date":"","objet":"","total_ht":0,"tva":0,"total_ttc":0}',
      autre: 'Analyse ce document. Réponds UNIQUEMENT avec ce JSON sans markdown: {"type":"","date":"","montant":0,"parties":"","resume":""}'
    };
    const requestBody = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: prompts[docType] || prompts.autre }
      ]}]
    });
    const result = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch(e) { resolve({ status: res.statusCode, body: { error: data } }); } });
      });
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });
    if (result.status !== 200) return { statusCode: 500, body: JSON.stringify({ error: result.body?.error?.message || JSON.stringify(result.body) }) };
    let extracted = {};
    try { extracted = JSON.parse(result.body.content[0].text.replace(/```json|```/g,'').trim()); } catch(e) { extracted = { raw: result.body.content[0].text }; }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extracted) };
  } catch(err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
};
// v2
