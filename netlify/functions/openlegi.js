// openlegi.js — Proxy MCP vers OpenLegi (Legifrance, RNE, EUR-Lex)
// GET  /api/openlegi?action=search_code&search=...&code=Code+civil
// GET  /api/openlegi?action=search_juri&search=...
// GET  /api/openlegi?action=search_loda&search=...
// POST /api/openlegi { action:'analyze_document', text:'...' }

const MCP_BASE   = 'https://mcp.openlegi.fr';
const SESSION_ID_MAP = {}; // cache session par service

// Parser la réponse SSE du protocole MCP
function parseSSE(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch {}
    }
  }
  throw new Error('Réponse MCP invalide : aucune ligne data: trouvée');
}

// Initialiser une session MCP et récupérer le session ID
async function initSession(service, token) {
  const endpoint = `${MCP_BASE}/${service}/mcp`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'DashboardJG', version: '1.0.0' }
      }
    })
  });
  const sessionId = res.headers.get('mcp-session-id');
  return { sessionId, endpoint };
}

// Appeler un outil MCP
async function callTool(endpoint, sessionId, token, toolName, args) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${token}`,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args }
    })
  });
  const text = await res.text();
  const parsed = parseSSE(text);
  if (parsed.error) throw new Error(`MCP Error: ${JSON.stringify(parsed.error)}`);
  return parsed.result;
}

export default async (req) => {
  const token = Netlify.env.get('OPENLEGI_TOKEN');
  if (!token) return Response.json({ ok: false, error: 'OPENLEGI_TOKEN manquant' }, { status: 500 });

  try {
    const url    = new URL(req.url);
    let body = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch {}
    }
    const action = url.searchParams.get('action') || body.action;

    let service  = 'legifrance';
    let toolName = '';
    let args     = {};

    // Router selon l'action
    if (action === 'search_code') {
      toolName = 'rechercher_code';
      args = {
        search:      url.searchParams.get('search') || '',
        code_name:   url.searchParams.get('code') || 'Code civil',
        max_results: parseInt(url.searchParams.get('max') || '5'),
      };
    } else if (action === 'search_juri') {
      toolName = 'rechercher_jurisprudence_judiciaire';
      args = {
        search:      url.searchParams.get('search') || '',
        max_results: parseInt(url.searchParams.get('max') || '5'),
        sort:        'DATE_DESC',
      };
    } else if (action === 'search_loda') {
      toolName = 'rechercher_dans_texte_legal';
      args = {
        search:      url.searchParams.get('search') || '',
        max_results: parseInt(url.searchParams.get('max') || '5'),
      };
    } else if (action === 'search_jorf') {
      toolName = 'recherche_journal_officiel';
      args = {
        search:      url.searchParams.get('search') || '',
        max_results: parseInt(url.searchParams.get('max') || '5'),
      };
    } else if (action === 'search_rne') {
      service  = 'rne';
      toolName = 'rne_search_companies';
      args = {
        query:    url.searchParams.get('search') || '',
        page:     1,
        per_page: parseInt(url.searchParams.get('max') || '5'),
      };
    } else if (action === 'analyze_document') {
      // Analyse d'un texte OCR — on extrait les références légales et on recherche
      const text = body?.text || url.searchParams.get('text') || '';

      // Extraction des références via Claude
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Analyse ce courrier juridique et extrais UNIQUEMENT en JSON :
{
  "articles": ["L.123-1", "R.456-2"],  // articles de loi cités
  "codes": ["Code du travail"],          // codes juridiques cités
  "keywords": ["cotisations", "URSSAF"], // mots-clés pour recherche jurisprudence
  "delai_jours": 30,                     // délai légal mentionné (null si absent)
  "type_courrier": "mise en demeure"     // type de document
}
Courrier : ${text.substring(0, 2000)}`
          }]
        })
      });
      const claudeData = await claudeRes.json();
      let refs = {};
      try {
        const raw = claudeData.content?.[0]?.text || '{}';
        refs = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } catch {}

      // Rechercher dans OpenLegi avec les mots-clés extraits
      const results = { refs, legifrance: null, jurisprudence: null };
      const { sessionId, endpoint } = await initSession('legifrance', token);

      if (refs.keywords?.length) {
        const query = refs.keywords.slice(0, 3).join(' ');
        try {
          results.legifrance = await callTool(endpoint, sessionId, token, 'rechercher_dans_texte_legal', {
            search: query, max_results: 3
          });
        } catch {}
        try {
          results.jurisprudence = await callTool(endpoint, sessionId, token, 'rechercher_jurisprudence_judiciaire', {
            search: query, max_results: 3, sort: 'DATE_DESC'
          });
        } catch {}
      }

      return Response.json({ ok: true, ...results });
    } else {
      return Response.json({ ok: false, error: `Action inconnue : ${action}` }, { status: 400 });
    }

    // Appel MCP standard
    const { sessionId, endpoint } = await initSession(service, token);
    const result = await callTool(endpoint, sessionId, token, toolName, args);
    const text = result?.content?.[0]?.text || JSON.stringify(result);

    return Response.json({ ok: true, text, raw: result });

  } catch (err) {
    console.error('OpenLegi error:', err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

export const config = { path: '/api/openlegi' };
