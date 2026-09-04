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
  const pathname = parsedUrl.pathname || '';
  const query = parsedUrl.query || {};
  const userId = query.userId;

  if (!userId) {
    return res.status(400).send('<h1>Ошибка: Не передан Telegram User ID</h1>');
  }

  const clientId = (config.fatsecret.clientId || '').trim();
  const clientSecret = (config.fatsecret.clientSecret || '').trim();
  const apiUrl = config.fatsecret.apiBaseUrl || 'https://platform.fatsecret.com/rest/server.api';

  // Handle direct manual profile linking or token submission
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const formData = new URLSearchParams(body);
        const action = formData.get('action');

        if (action === 'auto_profile') {
          // Create or retrieve dedicated profile
          const nonce = crypto.randomBytes(16).toString('hex');
          const timestamp = Math.floor(Date.now() / 1000).toString();

          const params = {
            format: 'json',
            method: 'profile.create',
            oauth_consumer_key: clientId,
            oauth_nonce: nonce,
            oauth_signature_method: 'HMAC-SHA1',
            oauth_timestamp: timestamp,
            oauth_version: '1.0',
            user_id: String(userId),
          };

          params.oauth_signature = generateOAuthSignature('GET', apiUrl, params, clientSecret, '');
          const createRes = await axios.get(apiUrl, { params, timeout: 8000 });

          const profile = createRes.data?.profile || {};
          if (profile.auth_token) {
            await setUserServiceData(userId, 'fatsecret', {
              auth_token: profile.auth_token,
              auth_secret: profile.auth_secret,
              user_token: profile.auth_token,
              user_secret: profile.auth_secret,
              type: 'direct_profile',
              updated_at: new Date().toISOString(),
            });

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderSuccessPage('Профиль FatSecret успешно подключен!'));
          }
          throw new Error(JSON.stringify(createRes.data));
        }

        if (action === 'manual_tokens') {
          const userToken = (formData.get('user_token') || '').trim();
          const userSecret = (formData.get('user_secret') || '').trim();

          if (!userToken) {
            throw new Error('Укажите токен доступа');
          }

          await setUserServiceData(userId, 'fatsecret', {
            auth_token: userToken,
            auth_secret: userSecret,
            user_token: userToken,
            user_secret: userSecret,
            type: 'manual_token',
            updated_at: new Date().toISOString(),
          });

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(renderSuccessPage('Пользовательский токен FatSecret сохранен!'));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div style="font-family:sans-serif; text-align:center; padding:40px; background:#0f172a; color:#fff;">
            <h2>❌ Ошибка привязки FatSecret</h2>
            <p>${err.message}</p>
            <a href="/api/auth/fatsecret/start?userId=${userId}" style="color:#38bdf8;">Попробовать снова</a>
          </div>
        `);
      }
    });
    return;
  }

  // Render clean UI with connection options
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Подключение FatSecret</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; }
        .icon { font-size: 48px; margin-bottom: 12px; }
        h1 { font-size: 20px; margin-bottom: 8px; color: #4ade80; }
        p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
        .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; text-decoration: none; margin-bottom: 12px; box-sizing: border-box; }
        .btn-primary { background: #16a34a; color: #fff; }
        .btn-secondary { background: #334155; color: #f8fafc; font-size: 13px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">🥗</div>
        <h1>Подключение дневника FatSecret</h1>
        <p>Нажмите кнопку ниже, чтобы привязать синхронизацию дневника питания с Telegram-ботом:</p>
        
        <form method="POST" action="/api/auth/fatsecret/start?userId=${userId}">
          <input type="hidden" name="action" value="auto_profile" />
          <button type="submit" class="btn btn-primary">⚡ Подключить в 1 клик</button>
        </form>
      </div>
    </body>
    </html>
  `);
};

function renderSuccessPage(message) {
  return `
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
        <div class="icon">✅</div>
        <h1>${message}</h1>
        <p>Ваш дневник питания синхронизируется с ботом.</p>
        <p>Вернитесь в Telegram и нажмите кнопку <b>Баланс</b>.</p>
      </div>
    </body>
    </html>
  `;
}
