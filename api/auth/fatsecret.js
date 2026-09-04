const axios = require('axios');
const crypto = require('crypto');
const url = require('url');
const config = require('../../src/config');
const { setUserServiceData, getUserServiceData } = require('../../src/services/db');

/**
 * Generates OAuth 1.0a signature for FatSecret REST API
 */
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

  const callbackUrl = `${config.app.appUrl}/api/auth/fatsecret/callback`;

  // 1. START OAUTH 1.0a / 2.0 FLOW: /api/auth/fatsecret/start?userId=123456
  if (pathname.includes('/start') || query.action === 'start') {
    const userId = query.userId;
    if (!userId) {
      return res.status(400).send('<h1>Ошибка: Не передан Telegram User ID</h1>');
    }

    const clientId = config.fatsecret.clientId;
    const clientSecret = config.fatsecret.clientSecret;

    if (!clientId || !clientSecret) {
      return res.status(500).send('<h1>Ошибка: FATSECRET_CLIENT_ID или FATSECRET_CLIENT_SECRET не настроены на Vercel.</h1>');
    }

    try {
      // Step 1: Request unauthorized token from FatSecret
      const requestTokenUrl = 'https://www.fatsecret.com/oauth/request_token';
      const nonce = crypto.randomBytes(16).toString('hex');
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const oauthParams = {
        oauth_callback: callbackUrl,
        oauth_consumer_key: clientId,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_version: '1.0',
      };

      oauthParams.oauth_signature = generateOAuthSignature('GET', requestTokenUrl, oauthParams, clientSecret, '');

      const response = await axios.get(requestTokenUrl, {
        params: oauthParams,
        timeout: 8000,
      });

      const responseParams = new URLSearchParams(response.data);
      const reqToken = responseParams.get('oauth_token');
      const reqSecret = responseParams.get('oauth_token_secret');

      if (!reqToken) {
        throw new Error('Не удалось получить временный токен FatSecret: ' + response.data);
      }

      // Save temporary secret in DB linked to userId and reqToken
      await setUserServiceData(userId, 'fatsecret_temp', {
        oauth_token: reqToken,
        oauth_token_secret: reqSecret,
      });

      // Redirect user to FatSecret authorization page
      const authorizeUrl = `https://www.fatsecret.com/oauth/authorize?oauth_token=${encodeURIComponent(reqToken)}`;
      return res.redirect(authorizeUrl);
    } catch (err) {
      console.error('FatSecret OAuth Start error:', err.response?.data || err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h1>❌ Ошибка подключения FatSecret</h1>
          <p>${err.response?.data || err.message}</p>
          <p>Проверьте корректность FATSECRET_CLIENT_ID и FATSECRET_CLIENT_SECRET в переменных Vercel.</p>
        </div>
      `);
    }
  }

  // 2. CALLBACK FROM FATSECRET: /api/auth/fatsecret/callback?oauth_token=...&oauth_verifier=...
  if (pathname.includes('/callback') || query.oauth_token) {
    const oauthToken = query.oauth_token;
    const oauthVerifier = query.oauth_verifier;

    if (!oauthToken || !oauthVerifier) {
      return res.status(400).send('<h1>Ошибка: Не получены параметры подтверждения от FatSecret</h1>');
    }

    try {
      const clientId = config.fatsecret.clientId;
      const clientSecret = config.fatsecret.clientSecret;

      // Exchange request token for access token
      const accessTokenUrl = 'https://www.fatsecret.com/oauth/access_token';
      const nonce = crypto.randomBytes(16).toString('hex');
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const oauthParams = {
        oauth_consumer_key: clientId,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_token: oauthToken,
        oauth_verifier: oauthVerifier,
        oauth_version: '1.0',
      };

      // In FatSecret OAuth 1.0a, token secret is empty string or temporary token secret
      oauthParams.oauth_signature = generateOAuthSignature('GET', accessTokenUrl, oauthParams, clientSecret, '');

      const response = await axios.get(accessTokenUrl, {
        params: oauthParams,
        timeout: 8000,
      });

      const responseParams = new URLSearchParams(response.data);
      const userToken = responseParams.get('oauth_token');
      const userSecret = responseParams.get('oauth_token_secret');

      if (!userToken) {
        throw new Error('Не удалось получить Access Token FatSecret: ' + response.data);
      }

      // If state or userId wasn't in callback query, save user credentials in global/session
      const userId = query.userId || query.state || 'default_user';

      await setUserServiceData(userId, 'fatsecret', {
        user_token: userToken,
        user_secret: userSecret,
        access_token: userToken,
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
            <p>Ваш дневник питания и потребленные калории теперь синхронизируются с ботом.</p>
            <p>Вернитесь в Telegram и вызовите команду <b>/balance</b>.</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error('FatSecret Access Token error:', err.response?.data || err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h1>❌ Ошибка авторизации FatSecret</h1>
          <p>${err.response?.data || err.message}</p>
        </div>
      `);
    }
  }

  res.status(404).send('Not Found');
};
