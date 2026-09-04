const axios = require('axios');
const crypto = require('crypto');
const url = require('url');
const config = require('../../src/config');
const { setUserServiceData, getUserServiceData } = require('../../src/services/db');

function generateOAuthSignature(httpMethod, baseUrl, params, consumerSecret, tokenSecret = '') {
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const baseString = [
    httpMethod.toUpperCase(),
    encodeURIComponent(baseUrl),
    encodeURIComponent(paramString),
  ].join('&');

  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

module.exports = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const query = parsedUrl.query || {};
  const userId = query.userId || 'default_user';

  const clientId = (config.fatsecret.clientId || '').trim();
  const clientSecret = (config.fatsecret.clientSecret || '').trim();
  const apiUrl = config.fatsecret.apiBaseUrl || 'https://platform.fatsecret.com/rest/server.api';

  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // In FatSecret API: profile.create creates an auth profile and returns auth_token & auth_secret
    const params = {
      format: 'json',
      method: 'profile.create',
      oauth_consumer_key: clientId,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_version: '1.0',
    };

    params.oauth_signature = generateOAuthSignature('GET', apiUrl, params, clientSecret, '');

    const response = await axios.get(apiUrl, { params, timeout: 8000 });
    const profile = response.data?.profile;

    if (profile && profile.auth_token && profile.auth_secret) {
      await setUserServiceData(userId, 'fatsecret', {
        auth_token: profile.auth_token,
        auth_secret: profile.auth_secret,
        user_token: profile.auth_token,
        user_secret: profile.auth_secret,
        updated_at: new Date().toISOString(),
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>FatSecret подключен!</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
            .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .icon { font-size: 54px; margin-bottom: 16px; }
            h1 { font-size: 22px; margin-bottom: 8px; color: #4ade80; }
            p { color: #94a3b8; font-size: 15px; line-height: 1.5; margin-bottom: 24px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🥗</div>
            <h1>FatSecret успешно подключен!</h1>
            <p>Дневник питания FatSecret привязан к вашему профилю в Telegram.</p>
            <p>Вернитесь в Telegram и нажмите кнопку <b>Баланс</b>.</p>
          </div>
        </body>
        </html>
      `);
    }

    throw new Error(JSON.stringify(response.data));
  } catch (err) {
    console.error('FatSecret linking error:', err.response?.data || err.message);
    const errText = err.response?.data ? JSON.stringify(err.response.data) : err.message;

    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <div style="font-family:sans-serif; text-align:center; padding:40px; background:#0f172a; color:#fff;">
        <h1>❌ Ошибка подключения FatSecret</h1>
        <pre style="background:#1e293b; color:#f87171; padding:15px; border-radius:8px;">${errText}</pre>
        <p><a href="/api/auth/fatsecret/start?userId=${userId}" style="color:#38bdf8;">Попробовать снова</a></p>
      </div>
    `);
  }
};
