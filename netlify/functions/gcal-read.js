
// gcal-read.js — Lecture des événements Google Calendar
// Variables d'environnement Netlify requises :
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
const https = require('https');

async function refreshAccessToken() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Variables Google manquantes (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN)');
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

async function fetchCalendarEvents(accessToken, calendarId, year, month) {
  // month est 1-based
  const timeMin = new Date(year, month - 1, 1).toISOString();
  const timeMax = new Date(year, month, 0, 23, 59, 59).toISOString();
  const calId   = encodeURIComponent(calendarId || 'primary');
  const params  = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path:     `/calendar/v3/calendars/${calId}/events?${params}`,
      method:   'GET',
      headers:  { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { error: data } }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const { year, month, calendarId = 'primary' } = event.queryStringParameters || {};

  // Vérification des variables
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ connected: false, events: [], message: 'Variables Netlify non configurées — voir guide setup' }),
    };
  }

  try {
    const accessToken = await refreshAccessToken();
    const result = await fetchCalendarEvents(accessToken, calendarId, parseInt(year) || new Date().getFullYear(), parseInt(month) || new Date().getMonth() + 1);

    if (result.status !== 200) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ connected: false, events: [], message: result.body?.error?.message || 'Erreur API Google Calendar' }),
      };
    }

    const events = (result.body.items || []).map(item => ({
      id:    item.id,
      title: item.summary || '(Sans titre)',
      date:  (item.start?.date || item.start?.dateTime || '').slice(0, 10),
      start: item.start?.dateTime || item.start?.date || '',
      end:   item.end?.dateTime   || item.end?.date   || '',
      description: item.description || '',
      htmlLink: item.htmlLink || '',
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ connected: true, events }),
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ connected: false, events: [], message: err.message }),
    };
  }
};

