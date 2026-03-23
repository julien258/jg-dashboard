const https = require('https');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  try {
    const { base64, docType } = JSON.parse(event.body);
    const apiKey = "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";
    const prompt = docType === 'releve_bancaire' ? 'Analyse ce releve bancaire JSON only: {bank_name,period,month,year,total_credits,total_debits,closing_balance}' : 'Analyse cet avis imposition JSON only: {bank_name,period,year,total_credits,total_debits,closing_balance}';
    const body = JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }, { type: 'text', text: prompt }] }] });
    const result = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let data = ''; res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      }); req.on('error', reject); req.write(body); req.end();
    });
    if (result.status !== 200) return { statusCode: 500, body: JSON.stringify({ error: result.body.error ? result.body.error.message : 'Erreur' }) };
    let extracted = {}; try { extracted = JSON.parse(result.body.content[0].text.replace(/```json|```/g, '').trim()); } catch(e) {}
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extracted) };
  } catch(err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
};
