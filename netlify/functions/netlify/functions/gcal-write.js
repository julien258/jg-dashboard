// gcal-write.js — Création d'événements dans Google Calendar
// Variables d'environnement Netlify requises :
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
const https = require('https');

async function refreshAccessToken() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Variables Google manquantes');
  }

  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    'refresh_token',
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(json.error_description || 'Token refresh failed'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function createCalendarEvent(accessToken, calendarId, eventData) {
  const calId = encodeURIComponent(calendarId || 'primary');
  const body  = JSON.stringify(eventData);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path:     `/calendar/v3/calendars/${calId}/events`,
      method:   'POST',
      headers:  {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { error: data } }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, message: 'Variables Netlify non configurées — voir guide setup' }),
    };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON invalide' }) }; }

  const { title, date, startTime, endTime, description = '', calendarId = 'primary' } = payload;
  if (!title || !date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'title et date requis' }) };
  }

  // Construction de l'événement Google Calendar
  let eventData;
  if (startTime && endTime) {
    // Événement avec horaire précis
    eventData = {
      summary:     title,
      description,
      start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Europe/Paris' },
      end:   { dateTime: `${date}T${endTime}:00`,   timeZone: 'Europe/Paris' },
    };
  } else {
    // Événement toute la journée
    eventData = {
      summary:     title,
      description,
      start: { date },
      end:   { date },
    };
  }

  try {
    const accessToken = await refreshAccessToken();
    const result = await createCalendarEvent(accessToken, calendarId, eventData);

    if (result.status === 200 || result.status === 201) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, eventId: result.body.id, htmlLink: result.body.htmlLink }),
      };
    } else {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, message: result.body?.error?.message || 'Erreur création événement' }),
      };
    }
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};
