// expense-receipts-resync.js
// Rattrape rétroactivement les justificatifs présents sur Supabase mais pas sur Drive
// (utile après réparation du bug invalid_grant)
// POST {} → traite tous les expense_requests avec file_path mais sans drive_id

const SUPABASE_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_API    = 'https://www.googleapis.com/drive/v3/files';
const OAUTH_URL    = 'https://oauth2.googleapis.com/token';

const FOYER_ROOT_FOLDER_ID = process.env.DRIVE_FOYER_ROOT_FOLDER_ID || null;

async function getAccessToken() {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const r = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`OAuth failed: ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
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
  const body = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) body.parents = [parentId];
  const create = await fetch(DRIVE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await create.json()).id;
}

// Récupère depuis Supabase Storage l'URL signée + télécharge le fichier en base64
async function fetchFromSupabase(filePath) {
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!sbKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_ANON_KEY manquante');

  // Public URL (le bucket "documents" est public d'après le code existant)
  const url = `${SUPABASE_URL}/storage/v1/object/public/documents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Supabase fetch ${r.status} pour ${filePath}`);
  const buf = await r.arrayBuffer();
  const mimeType = r.headers.get('content-type') || 'application/octet-stream';
  // Convert ArrayBuffer → base64
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = Buffer.from(binary, 'binary').toString('base64');
  return { base64, mimeType };
}

async function uploadToDrive(token, base64, mimeType, fileName, folderId) {
  const boundary = `b_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const metadata = { name: fileName, parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
    base64 +
    `\r\n--${boundary}--`;

  const r = await fetch(`${DRIVE_UPLOAD}&fields=id,webViewLink`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!r.ok) throw new Error(`Drive upload ${r.status}: ${(await r.text()).substring(0, 200)}`);
  return await r.json();
}

async function updateExpenseRequest(id, driveData) {
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/expense_requests?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(driveData),
  });
  if (!r.ok) throw new Error(`Supabase update ${r.status}: ${await r.text()}`);
}

exports.handler = async (event) => {
  const report = {
    timestamp: new Date().toISOString(),
    processed: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  try {
    // 1. Lister les expense_requests qui ont file_path mais pas drive_id
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!sbKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE keys manquantes' }) };
    }

    const listR = await fetch(
      `${SUPABASE_URL}/rest/v1/expense_requests?select=id,file_path,file_name,nature,date_prevue,nom&file_path=not.is.null&drive_id=is.null`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } }
    );
    if (!listR.ok) throw new Error(`Supabase list ${listR.status}: ${await listR.text()}`);
    const items = await listR.json();

    if (!items.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ...report, message: 'Aucun justificatif à rattraper — tout est déjà sync 🎉' }),
      };
    }

    // 2. Obtenir un access_token
    const token = await getAccessToken();

    // 3. Pour chacun : fetch Supabase → upload Drive → update DB
    for (const item of items) {
      report.processed++;
      const detail = { id: item.id, name: item.nom, status: 'pending' };
      try {
        const { base64, mimeType } = await fetchFromSupabase(item.file_path);

        // Hiérarchie Drive : Justificatifs Foyer / YYYY / nature
        const year = (item.date_prevue || new Date().toISOString()).substring(0, 4);
        const root = FOYER_ROOT_FOLDER_ID || (await findOrCreateFolder(token, 'Justificatifs Foyer', null));
        const yearFolder = await findOrCreateFolder(token, year, root);
        const natFolder = item.nature ? await findOrCreateFolder(token, item.nature, yearFolder) : yearFolder;

        const safeName = (item.file_name || 'sans_nom').replace(/[^\w.\-_ ]/g, '_');
        const finalName = `${item.date_prevue || ''}_${item.id.substring(0, 8)}_${safeName}`.replace(/^_+/, '');

        const uploaded = await uploadToDrive(token, base64, mimeType, finalName, natFolder);

        // Update DB
        await updateExpenseRequest(item.id, {
          drive_id: uploaded.id,
          drive_url: uploaded.webViewLink,
        });

        detail.status = 'success';
        detail.drive_id = uploaded.id;
        report.success++;
      } catch (e) {
        detail.status = 'failed';
        detail.error = String(e.message || e);
        report.failed++;
      }
      report.details.push(detail);
    }

    return { statusCode: 200, body: JSON.stringify(report, null, 2) };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ...report, fatal: String(e.message || e) }),
    };
  }
};
