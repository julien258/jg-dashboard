// ged-drive-sync.js — Upload Drive pour un document déjà en Supabase
// POST /api/ged-drive-sync { docId, base64, fileName, companyId, docType, docDate }

const OAUTH_URL  = 'https://oauth2.googleapis.com/token';
const DRIVE_API  = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const SUPABASE_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';

const DRIVE_ROOTS = {
  'sas-living':   '1PMVTYSm6AxhyzMpFVznlWMRYJ8Cx2tFh',
  'sarl-guiraud': '1Rmq0MVxE_b8iANDT3rR2cv08r9e1YCYi',
  'meulette':     '1NVNUOHHbYlcUVgCAbjMkFbdCgRBeqGqa',
  'real-gains':   '17enGaylIk0B0Y3DHhYssG4ZDc9etvKzW',
  'spv-monikaza': '1kGqZq5XGPo0FKqXDQWmd_elyhhAngYIQ',
};

const TYPE_FOLDER = {
  'facture_recue': 'Factures reçues',
  'recommande':    'Courriers',
  'recouvrement':  'Recouvrement',
  'fiscal':        'Fiscal',
  'social':        'Social',
  'contrat':       'Contrats',
  'assurance':     'Assurances',
  'juridique':     'Juridique',
  'releve':        'Relevés',
  'autre':         'Divers',
};

async function getGoogleToken() {
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     Netlify.env.get('GOOGLE_CLIENT_ID'),
      client_secret: Netlify.env.get('GOOGLE_CLIENT_SECRET'),
      refresh_token: Netlify.env.get('GOOGLE_REFRESH_TOKEN'),
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token Drive invalide: ' + (data.error || 'unknown'));
  return data.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
  const q = encodeURIComponent(`name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`${DRIVE_API}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) return searchData.files[0].id;

  const createRes = await fetch(DRIVE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const created = await createRes.json();
  return created.id;
}

async function uploadToDrive(accessToken, folderId, fileName, base64Content) {
  const boundary = 'ged_boundary_' + Date.now();
  const binaryContent = Uint8Array.from(atob(base64Content), c => c.charCodeAt(0));
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });

  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Content}\r\n`,
    `--${boundary}--`,
  ];
  const body = bodyParts.join('');

  const uploadRes = await fetch(`${DRIVE_UPLOAD}&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  return await uploadRes.json();
}

async function updateSupabase(docId, driveUrl, driveId) {
  const anonKey = Netlify.env.get('SUPABASE_ANON_KEY') || Netlify.env.get('VITE_SUPABASE_ANON_KEY');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ged_documents?id=eq.${docId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ drive_url: driveUrl, drive_id: driveId }),
  });
  return res.ok;
}

export default async (req) => {
  const H = { 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST requis' }), { status: 405, headers: H });

  try {
    const body = await req.json();
    const { docId, base64, fileName, companyId = 'sas-living', docType = 'autre', docDate } = body;

    if (!base64 || !docId) return new Response(JSON.stringify({ error: 'docId et base64 requis' }), { status: 400, headers: H });

    const rootId = DRIVE_ROOTS[companyId];
    if (!rootId) return new Response(JSON.stringify({ error: `Société inconnue : ${companyId}` }), { status: 400, headers: H });

    const accessToken = await getGoogleToken();
    const subFolderName = TYPE_FOLDER[docType] || 'Divers';
    const year = (docDate || new Date().toISOString()).substring(0, 4);

    const subFolderId  = await findOrCreateFolder(accessToken, rootId, subFolderName);
    const yearFolderId = await findOrCreateFolder(accessToken, subFolderId, year);
    const uploaded     = await uploadToDrive(accessToken, yearFolderId, fileName, base64);

    const driveUrl = uploaded.webViewLink || null;
    const driveId  = uploaded.id || null;

    if (!driveUrl) throw new Error('Upload Drive échoué : ' + JSON.stringify(uploaded));

    // Mise à jour Supabase
    await updateSupabase(docId, driveUrl, driveId);

    return new Response(JSON.stringify({ ok: true, drive_url: driveUrl, drive_id: driveId }), { headers: H });

  } catch (e) {
    console.error('ged-drive-sync error:', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: H });
  }
};

export const config = { path: '/api/ged-drive-sync' };
