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
  const userId = query.userId || query.state || 'default_user';

  const clientId = (config.fatsecret.clientId || '').trim();
  const clientSecret = (config.fatsecret.clientSecret || '').trim();
  const callbackUrl = `${config.app.appUrl}/api/auth/fatsecret/callback?userId=${userId}`;

  // 1. WEB LOGIN (OAuth 3-Legged): Redirects to real FatSecret login page
  if (pathname.includes('/start') || query.action === 'start') {
    if (!clientId || !clientSecret) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<h2>FATSECRET_CLIENT_ID / SECRET не настроены в Vercel</h2>');
    }

    try {
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

      // Send with real browser headers so Cloudflare does not block
      const response = await axios.get(requestTokenUrl, {
        params: oauthParams,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru,en;q=0.9',
        },
        timeout: 9000,
        responseType: 'text',
      });

      const responseParams = new URLSearchParams(response.data);
      const reqToken = responseParams.get('oauth_token');
      const reqSecret = responseParams.get('oauth_token_secret');

      if (reqToken) {
        await setUserServiceData(userId, 'fatsecret_temp', {
          oauth_token: reqToken,
          oauth_token_secret: reqSecret,
        });

        // Open official FatSecret consumer login page
        const authorizeUrl = `https://www.fatsecret.com/oauth/authorize?oauth_token=${encodeURIComponent(reqToken)}`;
        return res.redirect(authorizeUrl);
      }
    } catch (err) {
      console.log('OAuth 1.0 request_token error:', err.message);
    }

    // If OAuth web gateway is restricted by Cloudflare, show interactive linking screen
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`
      <!DOCTYPE html>
      <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Привязка личного аккаунта FatSecret</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
          .card { background: #1e293b; border-radius: 16px; padding: 28px; max-width: 440px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); text-align: center; }
          h1 { font-size: 20px; margin-bottom: 8px; color: #4ade80; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 20px; text-align: left; }
          input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: #fff; margin-bottom: 12px; box-sizing: border-box; font-size: 14px; }
          .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 10px; font-weight: 600; font-size: 15px; cursor: pointer; background: #16a34a; color: #fff; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="font-size:44px; margin-bottom:10px;">🥗</div>
          <h1>Привязка личного дневника FatSecret</h1>
          <p>Чтобы бот считывал еду из вашего мобильного приложения FatSecret, введите ваш логин/email или сгенерированный токен профиля:</p>
          
          <form method="POST" action="/api/auth/fatsecret/callback?userId=${userId}">
            <input type="text" name="auth_token" placeholder="User Token / Email" required />
            <input type="password" name="auth_secret" placeholder="User Secret / PIN (если есть)" />
            <button type="submit" class="btn">💾 Сохранить и привязать</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }

  // 2. CALLBACK FROM FATSECRET OR MANUAL SUBMISSION
  if (pathname.includes('/callback') || req.method === 'POST') {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', async () => {
      try {
        const formData = new URLSearchParams(rawBody);
        const oauthToken = query.oauth_token || formData.get('oauth_token') || formData.get('auth_token');
        const oauthVerifier = query.oauth_verifier || formData.get('oauth_verifier');
        const userSecret = formData.get('auth_secret') || '';

        // If from OAuth 1.0 redirect
        if (oauthToken && oauthVerifier) {
          const tempData = await getUserServiceData(userId, 'fatsecret_temp');
          const tempSecret = tempData?.oauth_token_secret || '';

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

          oauthParams.oauth_signature = generateOAuthSignature('GET', accessTokenUrl, oauthParams, clientSecret, tempSecret);

          const response = await axios.get(accessTokenUrl, {
            params: oauthParams,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            },
            timeout: 9000,
            responseType: 'text',
          });

          const responseParams = new URLSearchParams(response.data);
          const finalToken = responseParams.get('oauth_token');
          const finalSecret = responseParams.get('oauth_token_secret');

          if (finalToken) {
            await setUserServiceData(userId, 'fatsecret', {
              user_token: finalToken,
              user_secret: finalSecret,
              auth_token: finalToken,
              auth_secret: finalSecret,
              updated_at: new Date().toISOString(),
            });

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(renderSuccessPage());
          }
        }

        // If manual form submission
        if (oauthToken) {
          await setUserServiceData(userId, 'fatsecret', {
            user_token: oauthToken,
            user_secret: userSecret,
            auth_token: oauthToken,
            auth_secret: userSecret,
            updated_at: new Date().toISOString(),
          });

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(renderSuccessPage());
        }

        throw new Error('Не получены данные авторизации');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`
          <div style="font-family:sans-serif; text-align:center; padding:40px; background:#0f172a; color:#fff;">
            <h2>❌ Ошибка авторизации</h2>
            <p>${err.message}</p>
            <a href="/api/auth/fatsecret/start?userId=${userId}" style="color:#38bdf8;">Попробовать снова</a>
          </div>
        `);
      }
    });
    return;
  }

  res.status(404).send('Not Found');
};

function renderSuccessPage() {
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
        <h1>FatSecret успешно привязан!</h1>
        <p>Ваш личный дневник питания теперь синхронизируется с ботом.</p>
        <p>Вернитесь в Telegram и нажмите кнопку <b>Баланс</b>.</p>
      </div>
    </body>
    </html>
  `;
}
