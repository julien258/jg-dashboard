// drive-diagnose.js
// Diagnostic complet Google Drive : refresh token → access token → list → write
// GET ou POST sans paramètre. Retourne un rapport détaillé de chaque étape.

const OAUTH_URL    = 'https://oauth2.googleapis.com/token';
const DRIVE_API    = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

exports.handler = async () => {
  const report = {
    timestamp: new Date().toISOString(),
    env: {},
    steps: [],
    overall: 'pending',
    suggestions: [],
  };

  // ── Étape 0 : variables d'environnement ──
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  report.env = {
    GOOGLE_REFRESH_TOKEN: refreshToken ? `présent (${refreshToken.length} chars)` : '❌ MANQUANTE',
    GOOGLE_CLIENT_ID:     clientId     ? `présent (${clientId.substring(0, 12)}...)` : '❌ MANQUANTE',
    GOOGLE_CLIENT_SECRET: clientSecret ? `présent (${clientSecret.length} chars)` : '❌ MANQUANTE',
  };

  if (!refreshToken || !clientId || !clientSecret) {
    report.overall = 'fail';
    report.suggestions.push('Vérifier les variables d\'environnement Netlify : GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
    return { statusCode: 200, body: JSON.stringify(report, null, 2) };
  }

  // ── Étape 1 : refresh_token → access_token ──
  let accessToken = null;
  try {
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
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.substring(0, 500) }; }

    if (r.ok && body.access_token) {
      accessToken = body.access_token;
      report.steps.push({
        step: 1,
        name: 'Refresh token → Access token',
        status: '✅ OK',
        details: `Access token obtenu (${body.access_token.substring(0, 20)}..., expire dans ${body.expires_in}s, scope: ${body.scope || 'n/a'})`,
      });
    } else {
      report.steps.push({
        step: 1,
        name: 'Refresh token → Access token',
        status: '❌ ÉCHEC',
        http: r.status,
        error: body.error || 'unknown',
        error_description: body.error_description || text.substring(0, 300),
      });

      // Diagnostic spécifique
      if (body.error === 'invalid_grant') {
        report.suggestions.push('Le refresh_token est invalide ou expiré. Causes possibles :');
        report.suggestions.push('  → App OAuth en mode "Testing" : refresh_tokens expirent après 7 jours. Solution : passer en "In production" dans Google Cloud Console.');
        report.suggestions.push('  → Refresh_token non utilisé depuis 6 mois : Google le révoque. Solution : régénérer via OAuth consent flow.');
        report.suggestions.push('  → Mot de passe Google changé ou app désautorisée : régénérer le refresh_token.');
        report.suggestions.push('  → Variables CLIENT_ID/CLIENT_SECRET ne correspondent pas au refresh_token : vérifier la cohérence.');
      } else if (body.error === 'invalid_client') {
        report.suggestions.push('CLIENT_ID ou CLIENT_SECRET incorrects. Vérifier les valeurs dans Google Cloud Console > Credentials.');
      } else if (body.error === 'unauthorized_client') {
        report.suggestions.push('Le grant_type "refresh_token" n\'est pas autorisé pour ce client OAuth. Vérifier le type de credential.');
      }

      report.overall = 'fail';
      return { statusCode: 200, body: JSON.stringify(report, null, 2) };
    }
  } catch (e) {
    report.steps.push({
      step: 1,
      name: 'Refresh token → Access token',
      status: '❌ EXCEPTION',
      error: String(e.message || e),
    });
    report.overall = 'fail';
    return { statusCode: 200, body: JSON.stringify(report, null, 2) };
  }

  // ── Étape 2 : Lister 1 fichier (lecture) ──
  try {
    const r = await fetch(`${DRIVE_API}?pageSize=1&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.substring(0, 500) }; }

    if (r.ok) {
      report.steps.push({
        step: 2,
        name: 'Lecture Drive (list files)',
        status: '✅ OK',
        details: `${(body.files || []).length} fichier(s) accessible(s)${body.files?.[0] ? ` — exemple : "${body.files[0].name}"` : ''}`,
      });
    } else {
      report.steps.push({
        step: 2,
        name: 'Lecture Drive (list files)',
        status: '❌ ÉCHEC',
        http: r.status,
        error: body.error?.message || 'unknown',
        error_full: body.error || text.substring(0, 300),
      });
      if (r.status === 403) {
        report.suggestions.push('Erreur 403 : scope OAuth insuffisant. Le refresh_token doit avoir scope "https://www.googleapis.com/auth/drive" ou "drive.file".');
      }
      report.overall = 'partial';
    }
  } catch (e) {
    report.steps.push({
      step: 2,
      name: 'Lecture Drive',
      status: '❌ EXCEPTION',
      error: String(e.message || e),
    });
    report.overall = 'partial';
  }

  // ── Étape 3 : Écriture (créer puis supprimer un fichier test) ──
  let testFileId = null;
  try {
    const boundary = `boundary_diag_${Date.now()}`;
    const metadata = { name: `_DIAGNOSTIC_${Date.now()}.txt` };
    const fileContent = btoa('Test diagnostic Drive sync — ' + new Date().toISOString());
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      fileContent +
      `\r\n--${boundary}--`;

    const r = await fetch(`${DRIVE_UPLOAD}&fields=id,webViewLink`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const text = await r.text();
    let bodyJ;
    try { bodyJ = JSON.parse(text); } catch { bodyJ = { raw: text.substring(0, 500) }; }

    if (r.ok && bodyJ.id) {
      testFileId = bodyJ.id;
      report.steps.push({
        step: 3,
        name: 'Écriture Drive (upload fichier test)',
        status: '✅ OK',
        details: `Fichier créé : ${bodyJ.id} (${bodyJ.webViewLink || 'no link'})`,
      });
    } else {
      report.steps.push({
        step: 3,
        name: 'Écriture Drive (upload fichier test)',
        status: '❌ ÉCHEC',
        http: r.status,
        error: bodyJ.error?.message || 'unknown',
        error_full: bodyJ.error || text.substring(0, 300),
      });
      if (r.status === 403) {
        report.suggestions.push('Erreur 403 sur écriture : scope OAuth insuffisant ou quota Drive atteint.');
      } else if (r.status === 401) {
        report.suggestions.push('Erreur 401 : access_token rejeté pour écriture (possible mismatch de scope).');
      }
      report.overall = 'partial';
    }
  } catch (e) {
    report.steps.push({
      step: 3,
      name: 'Écriture Drive',
      status: '❌ EXCEPTION',
      error: String(e.message || e),
    });
    report.overall = 'partial';
  }

  // ── Étape 4 : Nettoyage du fichier test ──
  if (testFileId) {
    try {
      const r = await fetch(`${DRIVE_API}/${testFileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (r.ok || r.status === 204) {
        report.steps.push({
          step: 4,
          name: 'Suppression fichier test (cleanup)',
          status: '✅ OK',
          details: 'Fichier diagnostic supprimé',
        });
      } else {
        report.steps.push({
          step: 4,
          name: 'Suppression fichier test',
          status: '⚠️ Non supprimé',
          http: r.status,
          note: `Le fichier "_DIAGNOSTIC_*.txt" reste dans ton Drive. Tu peux le supprimer manuellement (id: ${testFileId})`,
        });
      }
    } catch (e) {
      report.steps.push({
        step: 4,
        name: 'Suppression fichier test',
        status: '⚠️ EXCEPTION',
        error: String(e.message || e),
      });
    }
  }

  // ── Verdict global ──
  if (report.overall === 'pending') {
    const allOk = report.steps.every(s => s.status.startsWith('✅') || s.step === 4);
    report.overall = allOk ? 'success' : 'partial';
  }

  if (report.overall === 'success') {
    report.suggestions.push('✅ Drive fonctionne parfaitement. Le sync devrait s\'effectuer pour les nouveaux uploads.');
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report, null, 2),
  };
};
