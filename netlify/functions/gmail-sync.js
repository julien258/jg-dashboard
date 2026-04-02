// gmail-sync.js — Lecture Gmail multi-comptes par société
// GET  /api/gmail-sync?societe=sas-living&action=list&maxResults=20
// GET  /api/gmail-sync?societe=sas-living&action=thread&threadId=xxx
// POST /api/gmail-sync { societe, action:'draft', to, subject, body, attachments[] }
// POST /api/gmail-sync { societe, action:'attachment', messageId, attachmentId }

const OAUTH_URL  = 'https://oauth2.googleapis.com/token';
const GMAIL_API  = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Mapping société → variable d'env du refresh token
const ACCOUNT_MAP = {
  'sas-living':   { token: 'GMAIL_TOKEN_LIVING',   email: 'julien@sas-living.com' },
  'sarl-guiraud': { token: 'GMAIL_TOKEN_SARL',     email: 'jguiraudeurl@gmail.com' },
  'meulette':     { token: 'GMAIL_TOKEN_MEULETTE', email: 'sarllameulette@gmail.com' },
  'real-gains':   { token: 'GMAIL_TOKEN_MONIKAZA', email: 'julien.guiraud@monikaza.com' },
  'spv-monikaza': { token: 'GMAIL_TOKEN_MONIKAZA', email: 'julien.guiraud@monikaza.com' },
  'perso':        { token: 'GOOGLE_REFRESH_TOKEN', email: 'jguiraud.rca@gmail.com' },
};

// Expéditeurs connus → classification auto
const SENDER_TAGS = {
  'urssaf':     { tag: '👥 Social',     priority: 'high',   category: 'social' },
  'dgfip':      { tag: '🏛️ Fiscal',    priority: 'high',   category: 'fiscal' },
  'impots.gouv':{ tag: '🏛️ Fiscal',    priority: 'high',   category: 'fiscal' },
  'tggv':       { tag: '⚖️ Huissier',  priority: 'high',   category: 'juridique' },
  'pecastaing': { tag: '⚖️ Huissier',  priority: 'high',   category: 'juridique' },
  'klesia':     { tag: '⚖️ Juridique', priority: 'high',   category: 'juridique' },
  'cgw':        { tag: '💼 CGW',        priority: 'normal', category: 'commercial' },
  'manhattanpcm':{ tag: '💼 CGW',       priority: 'normal', category: 'commercial' },
  '451f':       { tag: '📊 Comptable', priority: 'normal', category: 'fiscal' },
  'winston':    { tag: '💼 Winston',   priority: 'normal', category: 'commercial' },
  'velomotion': { tag: '🚗 Client',    priority: 'normal', category: 'commercial' },
  'huissier':   { tag: '⚖️ Huissier',  priority: 'high',   category: 'juridique' },
  'avocat':     { tag: '⚖️ Juridique', priority: 'high',   category: 'juridique' },
  'bpifrance':  { tag: '🏦 BPI',       priority: 'normal', category: 'commercial' },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAccessToken(societe) {
  const account = ACCOUNT_MAP[societe];
  if (!account) throw new Error(`Société inconnue : ${societe}`);

  const refreshToken = process.env[account.token];
  if (!refreshToken) throw new Error(`Token manquant pour ${societe} (${account.token})`);

  // Essayer d'abord avec notre client Web (tokens générés avec nos credentials)
  // Si ça échoue, essayer avec le client Desktop original (ancien GOOGLE_CLIENT_ID)
  const candidates = [
    { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
    { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET },
  ].filter(c => c.id && c.secret);

  for (const cred of candidates) {
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     cred.id,
        client_secret: cred.secret,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
        redirect_uri:  'https://developers.google.com/oauthplayground',
      }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token;
    console.log('Token attempt failed with client', cred.id?.substring(0,20), ':', data.error);
  }
  throw new Error('Token Google invalide : aucun client_id compatible');
}

async function gmailGet(accessToken, endpoint) {
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API ${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

async function gmailPost(accessToken, endpoint, body) {
  const res = await fetch(`${GMAIL_API}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API POST ${res.status}: ${err.substring(0, 200)}`);
  }
  return res.json();
}

function classifySender(from) {
  const fromLower = (from || '').toLowerCase();
  for (const [key, info] of Object.entries(SENDER_TAGS)) {
    if (fromLower.includes(key)) return info;
  }
  return { tag: '📧 Autre', priority: 'normal', category: 'autre' };
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractBody(payload) {
  if (!payload) return '';
  // Direct body
  if (payload.body?.data) return decodeBase64(payload.body.data);
  // Multipart
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64(part.body.data);
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return decodeBase64(part.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  return '';
}

function extractAttachments(payload) {
  const attachments = [];
  function scan(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          name: part.filename,
          mimeType: part.mimeType,
          size: part.body.size,
        });
      }
      if (part.parts) scan(part.parts);
    }
  }
  scan(payload?.parts);
  return attachments;
}

function buildMimeMessage({ from, to, subject, body, inReplyTo, references }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('', body);
  return Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function listMessages(accessToken, maxResults = 20, query = '') {
  // Non lus en priorité + tous les messages récents
  const q = encodeURIComponent(`is:unread -in:spam -in:promotions -in:trash ${query}`.trim());
  const data = await gmailGet(accessToken, `/messages?maxResults=${maxResults}&q=${q}`);
  const messages = data.messages || [];

  // Récupérer les détails de chaque message (format metadata)
  const details = await Promise.all(
    messages.slice(0, maxResults).map(async m => {
      try {
        const msg = await gmailGet(accessToken, `/messages/${m.id}?format=metadata&metadataHeaders=From,To,Subject,Date`);
        const headers = {};
        (msg.payload?.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
        const classification = classifySender(headers.from || '');
        return {
          id: m.id,
          threadId: msg.threadId,
          subject: headers.subject || '(sans objet)',
          from: headers.from || '',
          date: headers.date || '',
          snippet: msg.snippet || '',
          unread: (msg.labelIds || []).includes('UNREAD'),
          hasAttachment: (msg.labelIds || []).includes('HAS_ATTACHMENT') || msg.payload?.parts?.some(p => p.filename),
          ...classification,
        };
      } catch (e) {
        return { id: m.id, subject: 'Erreur chargement', error: e.message };
      }
    })
  );

  // Trier : urgents d'abord, puis par date
  return details.sort((a, b) => {
    if (a.priority === 'high' && b.priority !== 'high') return -1;
    if (b.priority === 'high' && a.priority !== 'high') return 1;
    return 0;
  });
}

async function getThread(accessToken, threadId) {
  const data = await gmailGet(accessToken, `/threads/${threadId}?format=full`);
  return (data.messages || []).map(msg => {
    const headers = {};
    (msg.payload?.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
    return {
      id: msg.id,
      from: headers.from || '',
      to: headers.to || '',
      subject: headers.subject || '',
      date: headers.date || '',
      body: extractBody(msg.payload).substring(0, 3000),
      attachments: extractAttachments(msg.payload),
      messageId: headers['message-id'] || '',
      references: headers.references || '',
    };
  });
}

async function getAttachment(accessToken, messageId, attachmentId) {
  const data = await gmailGet(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  return data.data; // base64 encoded
}

async function createDraft(accessToken, societe, { to, subject, body, inReplyTo, references }) {
  const account = ACCOUNT_MAP[societe];
  const raw = buildMimeMessage({ from: account.email, to, subject, body, inReplyTo, references });
  const draft = await gmailPost(accessToken, '/drafts', { message: { raw } });
  return draft;
}

async function markAsRead(accessToken, messageId) {
  await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async (req) => {
  const H = { 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('', { status: 200, headers: H });

  try {
    const url = new URL(req.url);
    const societe = url.searchParams.get('societe') || 'sas-living';
    const action = url.searchParams.get('action') || 'list';

    const account = ACCOUNT_MAP[societe];
    if (!account) return new Response(JSON.stringify({ error: `Société inconnue : ${societe}` }), { status: 400, headers: H });

    const tokenKey = account.token;
    if (!process.env[tokenKey]) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Token Gmail manquant pour ${societe}`,
        tokenKey,
        messages: [],
      }), { headers: H });
    }

    const accessToken = await getAccessToken(societe);

    if (req.method === 'GET') {
      if (action === 'list') {
        const maxResults = parseInt(url.searchParams.get('max') || '30');
        const query = url.searchParams.get('q') || '';
        const messages = await listMessages(accessToken, maxResults, query);
        return new Response(JSON.stringify({ ok: true, societe, email: account.email, messages }), { headers: H });
      }

      if (action === 'thread') {
        const threadId = url.searchParams.get('threadId');
        if (!threadId) return new Response(JSON.stringify({ error: 'threadId requis' }), { status: 400, headers: H });
        const thread = await getThread(accessToken, threadId);
        return new Response(JSON.stringify({ ok: true, thread }), { headers: H });
      }

      if (action === 'attachment') {
        const messageId = url.searchParams.get('messageId');
        const attachmentId = url.searchParams.get('attachmentId');
        if (!messageId || !attachmentId) return new Response(JSON.stringify({ error: 'messageId et attachmentId requis' }), { status: 400, headers: H });
        const base64 = await getAttachment(accessToken, messageId, attachmentId);
        return new Response(JSON.stringify({ ok: true, base64 }), { headers: H });
      }
    }

    if (req.method === 'POST') {
      const body = await req.json();

      if (body.action === 'draft') {
        const draft = await createDraft(accessToken, societe, body);
        return new Response(JSON.stringify({ ok: true, draftId: draft.id }), { headers: H });
      }

      if (body.action === 'read') {
        await markAsRead(accessToken, body.messageId);
        return new Response(JSON.stringify({ ok: true }), { headers: H });
      }

      if (body.action === 'ged') {
        // Récupérer une PJ et la renvoyer pour archivage GED
        const base64 = await getAttachment(accessToken, body.messageId, body.attachmentId);
        return new Response(JSON.stringify({ ok: true, base64, fileName: body.fileName }), { headers: H });
      }
    }

    return new Response(JSON.stringify({ error: 'Action inconnue' }), { status: 400, headers: H });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: H });
  }
};

export const config = { path: '/api/gmail-sync' };
