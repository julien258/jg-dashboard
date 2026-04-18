// oauth-callback.js
// Callback Google OAuth : reçoit le code d'autorisation, l'échange contre tokens,
// affiche le refresh_token pour copie manuelle dans Netlify env vars.

const OAUTH_URL = 'https://oauth2.googleapis.com/token';

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const error = params.error;

  // Erreur côté Google (refus consentement)
  if (error) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: errorHtml(`Erreur Google : ${error}`, params.error_description || ''),
    };
  }

  if (!code) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: errorHtml('Pas de code d\'autorisation reçu', 'Le paramètre ?code est manquant. As-tu bien cliqué sur "Autoriser" sur la page Google ?'),
    };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: errorHtml('Variables manquantes', 'GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET absentes des env vars Netlify'),
    };
  }

  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/oauth-callback`;

  // Échange code → tokens
  try {
    const r = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const data = await r.json();

    if (!r.ok) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: errorHtml(`HTTP ${r.status} — ${data.error || 'unknown'}`, JSON.stringify(data)),
      };
    }

    if (!data.refresh_token) {
      // Google ne redonne PAS de refresh_token si l'utilisateur avait déjà accepté
      // sans qu'on demande prompt=consent. C'est censé être géré dans oauth-init mais on protège ici.
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: errorHtml(
          'Pas de refresh_token reçu',
          `Google a renvoyé un access_token mais pas de refresh_token. Cela arrive quand l'utilisateur avait déjà autorisé l'app.<br><br>
          <strong>Solution :</strong> aller sur <a href="https://myaccount.google.com/permissions" target="_blank">https://myaccount.google.com/permissions</a>, supprimer l'app de la liste, puis recommencer le flux depuis le début (oauth-init).`
        ),
      };
    }

    // ✅ Succès : afficher le refresh_token de façon visible et avec instructions
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>✅ Refresh token obtenu</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:760px;margin:40px auto;padding:24px;color:#333;line-height:1.6}
  .success{background:#d4f7dc;border:2px solid #18A85A;padding:18px;border-radius:12px;margin:16px 0}
  .card{background:#f5f5f7;border-radius:12px;padding:20px;margin:16px 0}
  .danger{background:#FFE5E5;border-left:4px solid #E53935;padding:14px;border-radius:8px;margin:14px 0}
  code{background:#e8e8ed;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
  .token-box{background:#1d1d1f;color:#a3e8a3;padding:16px;border-radius:8px;font-family:'Courier New',monospace;font-size:13px;word-break:break-all;margin:12px 0;user-select:all;line-height:1.4}
  button{background:#5856d6;color:white;padding:12px 20px;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px}
  button:hover{background:#4644b8}
  .copied{background:#18A85A !important}
  .step{margin:14px 0;padding:14px 18px;background:white;border-radius:8px;border-left:3px solid #5856d6}
  .step strong{display:block;margin-bottom:4px;color:#5856d6}
  .meta{font-size:11px;color:#888;margin-top:8px}
</style></head><body>

<div class="success">
  <h1 style="margin-top:0">✅ Nouveau refresh_token obtenu</h1>
  <p>Le flux OAuth s'est terminé avec succès. Voici le token à copier dans Netlify :</p>
</div>

<div class="card">
  <strong style="font-size:14px">🔑 Ton nouveau GOOGLE_REFRESH_TOKEN :</strong>
  <div class="token-box" id="token">${data.refresh_token}</div>
  <button onclick="copyToken()" id="copyBtn">📋 Copier le token</button>
  <div class="meta">Longueur : ${data.refresh_token.length} caractères · Scope accordé : ${data.scope || 'n/a'} · Expire dans : ${data.expires_in || '?'}s (access_token, le refresh est durable)</div>
</div>

<div class="danger">
  ⚠ <strong>Ce token n'apparaîtra qu'UNE SEULE FOIS sur cette page.</strong> Copie-le et stocke-le immédiatement dans Netlify avant de fermer cet onglet.
</div>

<h2>📝 Étapes suivantes</h2>

<div class="step">
  <strong>Étape 1 — Mettre à jour Netlify env vars</strong>
  <ol>
    <li>Ouvre <a href="https://app.netlify.com/sites/jg-groupe-dashboard/settings/env" target="_blank">Netlify → Site settings → Environment variables</a></li>
    <li>Trouve la variable <code>GOOGLE_REFRESH_TOKEN</code></li>
    <li>Clique <strong>Options → Edit</strong></li>
    <li>Colle le nouveau token (utilise le bouton 📋 ci-dessus)</li>
    <li>Sauvegarde</li>
  </ol>
</div>

<div class="step">
  <strong>Étape 2 — Redéployer</strong>
  <ul>
    <li>Soit Netlify redéploie automatiquement (parfois)</li>
    <li>Soit va dans <strong>Deploys → Trigger deploy → Deploy site</strong></li>
  </ul>
</div>

<div class="step">
  <strong>Étape 3 — Tester</strong>
  <ol>
    <li>Reviens sur <a href="https://jg-groupe-dashboard.netlify.app/foyer-budget.html" target="_blank">foyer-budget.html</a></li>
    <li>Scrolle jusqu'à <strong>🏠 Garanties & justificatifs</strong></li>
    <li>Clique <strong>🔧 Tester Drive</strong></li>
    <li>Tu dois voir : ✅ SUCCÈS sur les 4 étapes</li>
  </ol>
</div>

<div class="step">
  <strong>Étape 4 (optionnel) — Re-sync des justificatifs déjà uploadés</strong>
  <p>Les justificatifs créés avant la réparation sont sur Supabase mais pas sur Drive. Pour les rattraper, clique le bouton <strong>🔄 Re-sync Drive</strong> qui apparaîtra dans la vue Garanties après le test réussi.</p>
</div>

<script>
function copyToken(){
  const t = document.getElementById('token').textContent;
  navigator.clipboard.writeText(t).then(() => {
    const b = document.getElementById('copyBtn');
    b.textContent = '✅ Copié !';
    b.classList.add('copied');
    setTimeout(() => { b.textContent = '📋 Copier le token'; b.classList.remove('copied'); }, 2500);
  });
}
</script>

</body></html>`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: errorHtml('Exception serveur', String(e.message || e)),
    };
  }
};

function errorHtml(title, detail) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>❌ Erreur OAuth</title>
<style>body{font-family:-apple-system,sans-serif;max-width:680px;margin:40px auto;padding:24px}
.err{background:#FFE5E5;border-left:4px solid #E53935;padding:18px;border-radius:8px}
pre{background:#1d1d1f;color:#ff8888;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px;white-space:pre-wrap}
a{color:#5856d6}</style></head><body>
<h1>❌ Erreur OAuth</h1>
<div class="err"><strong>${title}</strong>
<pre>${detail}</pre></div>
<p><a href="/.netlify/functions/oauth-init">↺ Recommencer le flux</a></p>
</body></html>`;
}
