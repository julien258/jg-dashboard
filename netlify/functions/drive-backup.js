// Copie automatique des fichiers uploadés vers Google Drive
// Utilise le refresh token OAuth stocké dans les variables Netlify

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const { base64, fileName, companyId, docType } = await req.json();

    if (!base64 || !fileName) {
      return new Response(JSON.stringify({ error: 'base64 et fileName requis' }), { status: 400, headers });
    }

    // Mapping société → dossier Drive
    const driveFolders = {
      'sas-living':    '1PMVTYSm6AxhyzMpFVznlWMRYJ8Cx2tFh',
      'sarl-guiraud':  '1Rmq0MVxE_b8iANDT3rR2cv08r9e1YCYi',
      'meulette':      '1NVNUOHHbYlcUVgCAbjMkFbdCgRBeqGqa',
      'real-gains':    '17enGaylIk0B0Y3DHhYssG4ZDc9etvKzW',
      'spv-monikaza':  '1kGqZq5XGPo0FKqXDQWmd_elyhhAngYIQ',
    };

    const folderId = driveFolders[companyId];
    if (!folderId) {
      return new Response(JSON.stringify({ error: `Dossier Drive non configuré pour : ${companyId}` }), { status: 400, headers });
    }

    // Obtenir un access token via refresh token
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      return new Response(JSON.stringify({ error: 'Variables Google OAuth manquantes' }), { status: 500, headers });
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return new Response(JSON.stringify({ error: 'Token Google invalide', detail: tokenData.error }), { status: 401, headers });
    }

    const accessToken = tokenData.access_token;

    // Upload vers Drive (multipart)
    const fileBuffer = Buffer.from(base64, 'base64');
    const mimeType = fileName.match(/\.(png|jpg|jpeg)$/i) ? 'image/jpeg' : 'application/pdf';
    const safeName = `${new Date().toISOString().substring(0,10)}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    const metadata = JSON.stringify({
      name: safeName,
      parents: [folderId],
    });

    // Construction du body multipart
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const close_delim = `\r\n--${boundary}--`;

    const metaPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`;
    const filePart = `${delimiter}Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}${close_delim}`;
    const body = metaPart + filePart;

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
      body,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return new Response(JSON.stringify({ error: 'Drive upload failed', detail: errText.substring(0, 200) }), { status: 502, headers });
    }

    const driveFile = await uploadRes.json();
    return new Response(JSON.stringify({ 
      success: true, 
      driveFileId: driveFile.id,
      driveName: driveFile.name,
      driveUrl: `https://drive.google.com/file/d/${driveFile.id}/view`
    }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/drive-backup' };
