const https = require('https');

// Refresh le token Google et retourne un access_token
async function getAccessToken() {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type:    'refresh_token'
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

// Cherche le fichier dans Drive par nom
async function findFileId(token, filename) {
  const q = encodeURIComponent(`name='${filename}' and trashed=false`);
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await resp.json();
  return data.files?.[0]?.id || null;
}

// Met à jour un fichier existant dans Drive
async function updateFile(token, fileId, content) {
  const resp = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/markdown; charset=utf-8'
      },
      body: content
    }
  );
  return resp.json();
}

// Crée un nouveau fichier dans Drive
async function createFile(token, filename, content) {
  const boundary = 'jg_sync_boundary';
  const meta = JSON.stringify({ name: filename, mimeType: 'text/markdown' });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    meta +
    `\r\n--${boundary}\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  return resp.json();
}

exports.handler = async (event) => {
  // Vérification du secret
  const secret = event.headers['x-sync-secret'];
  if (!secret || secret !== process.env.NETLIFY_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { content, filename } = JSON.parse(event.body);
    if (!content || !filename) throw new Error('content et filename requis');

    const token  = await getAccessToken();
    const fileId = await findFileId(token, filename);

    let result;
    if (fileId) {
      result = await updateFile(token, fileId, content);
      console.log(`Fichier mis à jour : ${fileId}`);
    } else {
      result = await createFile(token, filename, content);
      console.log(`Fichier créé : ${result.id}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, fileId: fileId || result.id, action: fileId ? 'updated' : 'created' })
    };
  } catch (err) {
    console.error('sync-etat-dossiers error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
