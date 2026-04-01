// ged-signed-url.js — Génère une URL signée Supabase Storage (valable 1h)
// GET /api/ged-signed-url?path=sas-living/juridique/MON-DOC.pdf

const SUPABASE_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';

export default async (req) => {
  const H = { 'Content-Type': 'application/json' };
  const serviceKey = Netlify.env.get('SUPABASE_SERVICE_KEY');
  if (!serviceKey) return Response.json({ error: 'SUPABASE_SERVICE_KEY manquant' }, { status: 500, headers: H });

  const url = new URL(req.url);
  const path = url.searchParams.get('path');
  if (!path) return Response.json({ error: 'path requis' }, { status: 400, headers: H });

  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documents/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
      },
      body: JSON.stringify({ expiresIn: 3600 }), // 1 heure
    });
    const data = await res.json();
    if (!data.signedURL) throw new Error(data.error || 'URL signée non générée');
    // signedURL retourne /storage/v1/object/sign/... — on construit l'URL complète
    const signedUrl = data.signedURL.startsWith('/storage') ? SUPABASE_URL + data.signedURL : `${SUPABASE_URL}/storage/v1${data.signedURL}`;
    return Response.json({ ok: true, url: signedUrl }, { headers: H });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500, headers: H });
  }
};

export const config = { path: '/api/ged-signed-url' };
