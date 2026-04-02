// claude-proxy.js — Proxy serveur pour appels Claude API (évite CORS depuis le navigateur)
// POST /api/claude-proxy { model, max_tokens, messages, system? }

export default async (req) => {
  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return Response.json({ ok: false, error: 'ANTHROPIC_API_KEY manquant' }, { status: 500 });

  try {
    const body = await req.json();
    const { model, max_tokens, messages, system } = body;

    const payload = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 1000,
      messages,
      ...(system ? { system } : {}),
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) return Response.json({ ok: false, error: data?.error?.message || 'Erreur API' }, { status: res.status });

    return Response.json({ ok: true, content: data.content });

  } catch (err) {
    console.error('claude-proxy error:', err.message);
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

export const config = { path: '/api/claude-proxy' };
