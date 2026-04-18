// oauth-init.js
// Initialise le flux OAuth Google Drive pour générer un nouveau refresh_token
// Usage : ouvrir https://jg-groupe-dashboard.netlify.app/.netlify/functions/oauth-init dans le navigateur

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.send',          // pour les éventuels usages Gmail futurs
  'https://www.googleapis.com/auth/calendar',            // pour gcal si utilisé
].join(' ');

exports.handler = async (event) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `<h1>❌ Erreur</h1><p>Variable Netlify <code>GOOGLE_CLIENT_ID</code> manquante.</p>`,
    };
  }

  // Construire l'URL de redirection vers Google OAuth
  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  const redirectUri = `${siteUrl}/.netlify/functions/oauth-callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',     // CRUCIAL : pour obtenir un refresh_token
    prompt: 'consent',           // CRUCIAL : force l'écran de consentement = re-génère un refresh_token
    include_granted_scopes: 'true',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  // Page intermédiaire avec instructions + bouton de redirection
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>OAuth Drive — Init</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;max-width:680px;margin:40px auto;padding:24px;color:#333;line-height:1.6}
  .card{background:#f5f5f7;border-radius:12px;padding:24px;margin:16px 0;border-left:4px solid #5856d6}
  .warn{border-left-color:#FF9500;background:#FFF3E0}
  code{background:#e8e8ed;padding:2px 6px;border-radius:4px;font-size:13px}
  .btn{display:inline-block;background:#5856d6;color:white;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:600;margin-top:16px}
  .btn:hover{background:#4644b8}
  pre{background:#1d1d1f;color:#a3e8a3;padding:12px;border-radius:6px;overflow-x:auto;font-size:12px}
</style></head><body>
<h1>🔧 Régénération du refresh_token Google Drive</h1>

<div class="card warn">
  <strong>⚠ Avant de cliquer sur le bouton :</strong>
  <p>Vérifie que cette URL est bien ajoutée comme <strong>Redirect URI autorisée</strong> dans Google Cloud Console :</p>
  <pre>${redirectUri}</pre>
  <p>Si ce n'est pas fait :</p>
  <ol>
    <li>Va sur <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console → Credentials</a></li>
    <li>Clique sur ton OAuth 2.0 Client ID (<code>${clientId.substring(0, 20)}...</code>)</li>
    <li>Dans <strong>Authorized redirect URIs</strong>, ajoute exactement l'URL ci-dessus</li>
    <li>Sauvegarde, attends 1 minute, puis reviens ici</li>
  </ol>
</div>

<div class="card">
  <strong>📋 Scopes demandés</strong> (Drive + Gmail send + Calendar — usage futur)
  <ul>
    <li>https://www.googleapis.com/auth/drive</li>
    <li>https://www.googleapis.com/auth/gmail.send</li>
    <li>https://www.googleapis.com/auth/calendar</li>
  </ul>
</div>

<div class="card">
  <strong>🚀 Quand tout est prêt :</strong>
  <p>Clique sur le bouton ci-dessous. Tu seras redirigé vers la page de consentement Google. Connecte-toi avec le compte Google qui possède le Drive cible (probablement ton compte principal). Accepte les permissions. Tu seras renvoyé vers une page qui affichera le nouveau refresh_token à copier.</p>
  <a href="${authUrl}" class="btn">🔓 Lancer le flux OAuth Google →</a>
</div>

<div class="card" style="border-left-color:#888">
  <strong>Note technique :</strong>
  <ul>
    <li><code>access_type=offline</code> + <code>prompt=consent</code> : garantit qu'on obtient un nouveau refresh_token (sinon Google ne le redonne pas si déjà accordé)</li>
    <li>Si ton app OAuth est en mode "Testing", le token expirera dans 7 jours. Pense à publier l'app en "In production" dans <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank">OAuth consent screen</a></li>
  </ul>
</div>

</body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
