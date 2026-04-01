// ged-upload.js — Upload GED : OCR → renommage → Drive → métadonnées Supabase
// POST { base64, fileName, companyId, docType, actionRequired, actionNotes, deadlineDate, dossier }

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const DRIVE_UPLOAD  = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const DRIVE_API     = 'https://www.googleapis.com/drive/v3/files';
const OAUTH_URL     = 'https://oauth2.googleapis.com/token';
const SUPABASE_URL  = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';

// Dossiers Drive racine par société (niveau "DIRECT/SOCIETE")
const DRIVE_ROOTS = {
  'sas-living':   '1PMVTYSm6AxhyzMpFVznlWMRYJ8Cx2tFh',
  'sarl-guiraud': '1Rmq0MVxE_b8iANDT3rR2cv08r9e1YCYi',
  'meulette':     '1NVNUOHHbYlcUVgCAbjMkFbdCgRBeqGqa',
  'real-gains':   '17enGaylIk0B0Y3DHhYssG4ZDc9etvKzW',
  'spv-monikaza': '1kGqZq5XGPo0FKqXDQWmd_elyhhAngYIQ',
  'perso':        null, // pas de Drive dédié
};

// Mapping type document → sous-dossier Drive
const TYPE_FOLDER = {
  'recouvrement': 'Juridique',
  'juridique':    'Juridique',
  'fiscal':       'Comptabilité',
  'social':       'Comptabilité',
  'facture_recue':'Comptabilité',
  'facture_emise':'Comptabilité',
  'releve':       'Banque',
  'contrat':      'Juridique',
  'assurance':    'Juridique',
  'recommande':   'Juridique',
  'autre':        'Comptabilité',
};

const COMPANY_LABEL = {
  'sas-living':   'LIVING',
  'sarl-guiraud': 'SARL',
  'meulette':     'MEULETTE',
  'real-gains':   'REALGAINS',
  'spv-monikaza': 'MONIKAZA',
  'perso':        'PERSO',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getGoogleToken() {
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token Google invalide: ' + (data.error || 'unknown'));
  return data.access_token;
}

async function findOrCreateFolder(accessToken, parentId, folderName) {
  // Chercher si le dossier existe déjà
  const q = encodeURIComponent(`name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const searchRes = await fetch(`${DRIVE_API}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }
  // Créer le dossier
  const createRes = await fetch(DRIVE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const folder = await createRes.json();
  return folder.id;
}

async function uploadToDrive(accessToken, folderId, fileName, base64Content) {
  const binary = Uint8Array.from(atob(base64Content), c => c.charCodeAt(0));

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });

  // Multipart upload
  const metaPart = `${delimiter}Content-Type: application/json\r\n\r\n${metadata}`;
  const filePart = `${delimiter}Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Content}${closeDelimiter}`;
  const body = metaPart + filePart;

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

async function ocrExtract(base64, fileName) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            {
              type: 'text',
              text: `Analyse ce document et réponds UNIQUEMENT en JSON valide, sans markdown :
{
  "from_name": "nom expéditeur/fournisseur court (ex: URSSAF, DGFiP, TGGV, KLESIA)",
  "doc_date": "AAAA-MM-JJ ou null",
  "amount": montant_numerique_ou_null,
  "company_id": "sas-living|sarl-guiraud|meulette|real-gains|spv-monikaza|perso",
  "doc_type": "facture_recue|recommande|recouvrement|releve|fiscal|social|contrat|assurance|juridique|autre",
  "objet": "description courte 3-5 mots (ex: CFE-relance, PAS-rejet, injonction-payer)",
  "action_required": true|false,
  "action_notes": "action à faire si besoin ou null",
  "deadline_date": "AAAA-MM-JJ ou null"
}`,
            },
          ],
        }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    return null;
  }
}

function buildFileName(ocr, companyId, originalName) {
  const from   = (ocr?.from_name || 'INCONNU').toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-').substring(0, 20);
  const date   = ocr?.doc_date || new Date().toISOString().substring(0, 10);
  const co     = COMPANY_LABEL[ocr?.company_id || companyId] || 'GROUPE';
  const objet  = (ocr?.objet || 'document').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').substring(0, 30);
  return `${from}_${date}_${co}_${objet}.pdf`;
}

// ─── Handler principal ────────────────────────────────────────────────────────

export default async (req) => {
  const H = { 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST requis' }), { status: 405, headers: H });

  try {
    const body = await req.json();
    const { base64, fileName, companyId = 'sas-living', docType, dossier } = body;
    if (!base64) return new Response(JSON.stringify({ error: 'base64 requis' }), { status: 400, headers: H });

    // 1. OCR extraction
    const ocr = await ocrExtract(base64, fileName);

    // 2. Nom normalisé
    const normalizedName = buildFileName(ocr, companyId, fileName);

    // 3. Déterminer société et type depuis OCR (priorité) ou paramètres
    const finalCompany = ocr?.company_id || companyId;
    const finalType    = ocr?.doc_type    || docType || 'autre';

    // 4. Upload Drive (tentative — non bloquant)
    // Le document est d'abord inséré en Supabase, Drive est optionnel
    let driveUrl = null;
    let driveFileId = null;
    let driveError = null;
    const rootId = DRIVE_ROOTS[finalCompany];

    if (rootId) {
      try {
        const accessToken = await getGoogleToken();
        const subFolderName = TYPE_FOLDER[finalType] || 'Comptabilité';
        const year = (ocr?.doc_date || new Date().toISOString()).substring(0, 4);
        const subFolderId  = await findOrCreateFolder(accessToken, rootId, subFolderName);
        const yearFolderId = await findOrCreateFolder(accessToken, subFolderId, year);
        const uploaded = await uploadToDrive(accessToken, yearFolderId, normalizedName, base64);
        driveUrl    = uploaded.webViewLink || null;
        driveFileId = uploaded.id || null;
      } catch (driveErr) {
        driveError = driveErr.message;
        console.error('Drive upload error (non-bloquant):', driveErr.message);
      }
    }

    // 5. Upload Supabase Storage (fallback pour le bouton 👁 si Drive échoue)
    let storageUrl = null;
    if (!driveUrl) {
      try {
        const sbUrl = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';
        const sbKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
        const storagePath = `${finalCompany}/${finalType}/${normalizedName}`;
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const uploadRes = await fetch(`${sbUrl}/storage/v1/object/documents/${storagePath}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sbKey}`,
            'apikey': sbKey,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true',
          },
          body: bytes,
        });
        if (uploadRes.ok) {
          storageUrl = `${sbUrl}/storage/v1/object/public/documents/${storagePath}`;
        }
      } catch (storageErr) {
        console.error('Supabase Storage error (non-bloquant):', storageErr.message);
      }
    }

    // 6. Retourner tout pour que le dashboard insère dans Supabase
    // drive_pending=true si Drive a échoué — le dashboard peut réessayer via /api/ged-drive-sync
    return new Response(JSON.stringify({
      ok: true,
      normalized_name: normalizedName,
      drive_url:   driveUrl,
      drive_id:    driveFileId,
      company_id:  finalCompany,
      doc_type:    finalType,
      doc_date:    ocr?.doc_date    || null,
      amount:      ocr?.amount      || null,
      from_name:   ocr?.from_name   || null,
      objet:       ocr?.objet       || null,
      action_required: ocr?.action_required || false,
      action_notes:    ocr?.action_notes    || null,
      deadline_date:   ocr?.deadline_date   || null,
      ocr_raw:     ocr,
      file_url:      storageUrl,
      drive_pending: !driveUrl,
      drive_error:   driveError,
    }), { headers: H });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: H });
  }
};

export const config = { path: '/api/ged-upload' };
