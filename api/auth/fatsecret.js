const axios = require('axios');
const url = require('url');
const config = require('../../src/config');
const { setUserServiceData } = require('../../src/services/db');

module.exports = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '';
  const query = parsedUrl.query || {};

  const redirectUri = `${config.app.appUrl}/api/auth/fatsecret/callback`;

  // 1. START OAUTH FLOW: /api/auth/fatsecret/start?userId=123456
  if (pathname.includes('/start') || query.action === 'start') {
    const userId = query.userId;
    if (!userId) {
      return res.status(400).send('<h1>Ошибка: Не передан Telegram User ID</h1>');
    }

    // FatSecret OAuth 2.0 authorization URL
    const authUrl = `https://oauth.fatsecret.com/connect/authorize?` +
      `response_type=code&` +
      `client_id=${encodeURIComponent(config.fatsecret.clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=basic%20premier&` +
      `state=${encodeURIComponent(userId)}`;

    return res.redirect(authUrl);
  }

  // 2. CALLBACK FROM FATSECRET: /api/auth/fatsecret/callback?code=...&state=...
  if (pathname.includes('/callback') || query.code) {
    const code = query.code;
    const userId = query.state;

    if (!code || !userId) {
      return res.status(400).send('<h1>Ошибка: Отсутствует код подтверждения или ID пользователя</h1>');
    }

    try {
      const credentials = Buffer.from(`${config.fatsecret.clientId}:${config.fatsecret.clientSecret}`).toString('base64');
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', redirectUri);

      const tokenRes = await axios.post(config.fatsecret.tokenUrl, params.toString(), {
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 8000,
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;

      if (access_token) {
        await setUserServiceData(userId, 'fatsecret', {
          access_token,
          refresh_token: refresh_token || null,
          expires_at: Date.now() + (expires_in || 86400) * 1000,
          updated_at: new Date().toISOString(),
        });
      }

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
      console.error('FatSecret OAuth callback error:', err.response?.data || err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h1>❌ Ошибка авторизации FatSecret</h1>
          <p>${err.response?.data?.error_description || err.response?.data?.error || err.message}</p>
        </div>
      `);
    }
  }

  res.status(404).send('Not Found');
};
