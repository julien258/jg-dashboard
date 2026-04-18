// expense-receipt-drive-sync.js
// Sync best-effort d'un justificatif déjà uploadé sur Supabase vers Google Drive
// Non bloquant : si échec Drive, on retourne 200 avec drive_id=null
// POST { base64, fileName, mimeType, expenseId, nature, dateStr }

const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_API    = 'https://www.googleapis.com/drive/v3/files';
const OAUTH_URL    = 'https://oauth2.googleapis.com/token';

// Dossier racine "Justificatifs Foyer" — à créer dans Drive et coller son ID ici
// Pour l'instant on essaie la racine perso et on crée la hiérarchie au besoin
const FOYER_ROOT_FOLDER_ID = process.env.DRIVE_FOYER_ROOT_FOLDER_ID || null;

async function getAccessToken() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error('Google OAuth env vars missing');
  }
  const r = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Token refresh failed: ${r.status} ${t.substring(0, 200)}`);
  }
  const j = await r.json();
  return j.access_token;
}

async function findOrCreateFolder(token, name, parentId) {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`
  );
  const search = await fetch(`${DRIVE_API}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await search.json();
  if (data.files && data.files.length > 0) return data.files[0].id;

  // Créer
  const body = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];
  const create = await fetch(DRIVE_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const created = await create.json();
  return created.id;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const { base64, fileName, mimeType, expenseId, nature, dateStr } = JSON.parse(event.body || '{}');
    if (!base64 || !fileName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'base64 and fileName required' }) };
    }

    const token = await getAccessToken();

    // Hiérarchie : Justificatifs Foyer / YYYY / nature
    const year = (dateStr || new Date().toISOString()).substring(0, 4);
    const root = FOYER_ROOT_FOLDER_ID || (await findOrCreateFolder(token, 'Justificatifs Foyer', null));
    const yearFolder = await findOrCreateFolder(token, year, root);
    const natFolder = nature ? await findOrCreateFolder(token, nature, yearFolder) : yearFolder;

    // Préfixer le nom avec date + ID partiel pour traçabilité
    const safeName = fileName.replace(/[^\w.\-_ ]/g, '_');
    const finalName = `${dateStr || ''}_${(expenseId || '').substring(0, 8)}_${safeName}`.replace(/^_+/, '');

    // Multipart upload
    const boundary = `boundary_${Date.now()}`;
    const metadata = {
      name: finalName,
      parents: [natFolder],
    };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${mimeType || 'application/octet-stream'}\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      base64 +
      `\r\n--${boundary}--`;

    const uploadRes = await fetch(`${DRIVE_UPLOAD}&fields=id,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text();
      throw new Error(`Drive upload failed: ${uploadRes.status} ${t.substring(0, 200)}`);
    }
    const uploaded = await uploadRes.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        drive_id: uploaded.id,
        drive_url: uploaded.webViewLink,
      }),
    };
  } catch (e) {
    // Best-effort : retourne 200 avec error pour ne pas bloquer le client
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: false,
        error: String(e.message || e),
        drive_id: null,
        drive_url: null,
      }),
    };
  }
};
