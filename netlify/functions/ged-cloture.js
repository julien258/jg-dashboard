// ged-cloture.js — Dépôt automatique GED depuis la clôture mensuelle
// POST /api/ged-cloture
// Body: { mois: "2026-03", societe: "sas-living", type: "releve|facture_recue|facture_emise", fichiers: [{nom, base64, mime}] }

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_API    = 'https://www.googleapis.com/drive/v3/files';
const OAUTH_URL    = 'https://oauth2.googleapis.com/token';
const SUPABASE_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';

const DRIVE_ROOTS = {
  'sas-living':   '1PMVTYSm6AxhyzMpFVznlWMRYJ8Cx2tFh',
  'sarl-guiraud': '1Rmq0MVxE_b8iANDT3rR2cv08r9e1YCYi',
  'meulette':     '1NVNUOHHbYlcUVgCAbjMkFbdCgRBeqGqa',
  'real-gains':   '17enGaylIk0B0Y3DHhYssG4ZDc9etvKzW',
  'spv-monikaza': '1kGqZq5XGPo0FKqXDQWmd_elyhhAngYIQ',
};

const TYPE_TO_FOLDER = {
  'releve':        'Banque',
  'facture_recue': 'Comptabilité',
  'facture_emise': 'Comptabilité',
  'fiscal':        'Comptabilité',
  'social':        'Comptabilité',
  'juridique':     'Juridique',
  'recouvrement':  'Juridique',
  'autre':         'Comptabilité',
};

const COMPANY_LABEL = {
  'sas-living':   'LIVING',
  'sarl-guiraud': 'SARL',
  'meulette':     'MEULETTE',
  'real-gains':   'REALGAINS',
  'spv-monikaza': 'MONIKAZA',
};

async function getGoogleToken() {
  const clientId     = Netlify.env.get('GOOGLE_CLIENT_ID');
  const clientSecret = Netlify.env.get('GOOGLE_CLIENT_SECRET');
  const refreshToken = Netlify.env.get('GOOGLE_REFRESH_TOKEN');
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token Google invalide: ' + JSON.stringify(data));
  return data.access_token;
}

async function findOrCreateFolder(token, parentId, name) {
  const q = encodeURIComponent(`name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const search = await fetch(`${DRIVE_API}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await search.json();
  if (data.files?.length) return data.files[0].id;
  const create = await fetch(DRIVE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const folder = await create.json();
  return folder.id;
}

async function uploadToDrive(token, folderId, fileName, base64, mimeType = 'application/pdf') {
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const boundary = 'boundary_ged_cloture';
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`;
  const filePart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing  = `\r\n--${boundary}--`;
  const encoder  = new TextEncoder();
  const body     = new Uint8Array([...encoder.encode(metaPart), ...encoder.encode(filePart), ...bytes, ...encoder.encode(closing)]);
  const res = await fetch(`${DRIVE_UPLOAD}&fields=id,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return res.json();
}

async function sbInsert(table, data) {
  const key = Netlify.env.get('SUPABASE_SERVICE_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

export default async (req) => {
  const H = { 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST requis' }), { status: 405, headers: H });

  try {
    const body = await req.json();
    const { mois, societe, type = 'releve', fichiers = [] } = body;

    if (!mois || !societe) return new Response(JSON.stringify({ error: 'mois et societe requis' }), { status: 400, headers: H });
    const rootId = DRIVE_ROOTS[societe];
    if (!rootId) return new Response(JSON.stringify({ error: `Pas de Drive pour ${societe}` }), { status: 400, headers: H });

    const annee  = mois.substring(0, 4);
    const folder = TYPE_TO_FOLDER[type] || 'Comptabilité';
    const co     = COMPANY_LABEL[societe] || societe;

    const token = await getGoogleToken();

    // Créer arborescence : Banque/2026/ ou Comptabilité/2026/
    const subFolderId  = await findOrCreateFolder(token, rootId, folder);
    const yearFolderId = await findOrCreateFolder(token, subFolderId, annee);

    const results = [];

    for (const f of fichiers) {
      if (!f.base64 || !f.nom) { results.push({ nom: f.nom, ok: false, error: 'base64 ou nom manquant' }); continue; }

      // Nom normalisé : TYPE_ANNEE-MOIS_SOCIETE_NOM-ORIGINAL
      const ext = f.nom.includes('.') ? f.nom.split('.').pop() : 'pdf';
      const baseName = f.nom.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\-_]/g, '-').substring(0, 40);
      const fileName = `${type.toUpperCase()}_${mois}_${co}_${baseName}.${ext}`;
      const mime = f.mime || (ext === 'pdf' ? 'application/pdf' : 'application/octet-stream');

      let driveUrl = null, driveId = null;
      try {
        const uploaded = await uploadToDrive(token, yearFolderId, fileName, f.base64, mime);
        driveUrl = uploaded.webViewLink || null;
        driveId  = uploaded.id || null;
      } catch(e) {
        results.push({ nom: f.nom, ok: false, error: 'Drive: ' + e.message }); continue;
      }

      // Indexer dans ged_documents Supabase
      try {
        await sbInsert('ged_documents', {
          company_id: societe,
          doc_type:   type,
          doc_date:   mois + '-01',
          file_name:  fileName,
          file_url:   driveUrl,
          drive_url:  driveUrl,
          drive_id:   driveId,
          status:     'actif',
          source:     'cloture_auto',
          mois_cloture: mois,
        });
      } catch(e) {
        // Non bloquant — Drive ok, Supabase a échoué
        console.warn('Supabase insert error:', e.message);
      }

      results.push({ nom: f.nom, fileName, driveUrl, ok: true });
    }

    const nbOk = results.filter(r => r.ok).length;
    return new Response(JSON.stringify({
      ok: true,
      mois,
      societe,
      type,
      folder: `${folder}/${annee}`,
      deposited: nbOk,
      total: fichiers.length,
      results,
    }), { status: 200, headers: H });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: H });
  }
};

export const config = { path: '/api/ged-cloture' };
