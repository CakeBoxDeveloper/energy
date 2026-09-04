const axios = require('axios');
const url = require('url');
const config = require('../../src/config');
const { setUserServiceData } = require('../../src/services/db');

const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read',
  'https://www.googleapis.com/auth/fitness.nutrition.read',
].join(' ');

module.exports = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '';
  const query = parsedUrl.query || {};

  const redirectUri = `${config.app.appUrl}/api/auth/google/callback`;

  // 1. START OAUTH FLOW: /api/auth/google/start?userId=123456
  if (pathname.includes('/start') || query.action === 'start') {
    const userId = query.userId;
    if (!userId) {
      return res.status(400).send('<h1>Ошибка: Не передан Telegram User ID</h1>');
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(config.googleFit.clientId)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(SCOPES)}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `state=${encodeURIComponent(userId)}`;

    return res.redirect(authUrl);
  }

  // 2. CALLBACK FROM GOOGLE: /api/auth/google/callback?code=...&state=...
  if (pathname.includes('/callback') || query.code) {
    const code = query.code;
    const userId = query.state;

    if (!code || !userId) {
      return res.status(400).send('<h1>Ошибка: Отсутствует код подтверждения или ID пользователя</h1>');
    }

    try {
      const tokenRes = await axios.post(config.googleFit.tokenUrl, {
        code,
        client_id: config.googleFit.clientId,
        client_secret: config.googleFit.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });

      const { refresh_token, access_token, expires_in } = tokenRes.data;

      if (refresh_token) {
        await setUserServiceData(userId, 'google', {
          refresh_token,
          access_token,
          expires_at: Date.now() + (expires_in || 3600) * 1000,
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
          <title>Google Fit подключен!</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
            .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 420px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .icon { font-size: 54px; margin-bottom: 16px; }
            h1 { font-size: 22px; margin-bottom: 8px; color: #38bdf8; }
            p { color: #94a3b8; font-size: 15px; line-height: 1.5; margin-bottom: 24px; }
            a { display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">✅</div>
            <h1>Google Fit успешно подключен!</h1>
            <p>Данные активности и сожженные калории с ваших часов Amazfit теперь синхронизируются с ботом.</p>
            <p>Вернитесь в Telegram и вызовите команду <b>/balance</b>.</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error('Google OAuth callback error:', err.response?.data || err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h1>❌ Ошибка авторизации Google Fit</h1>
          <p>${err.response?.data?.error_description || err.message}</p>
        </div>
      `);
    }
  }

  res.status(404).send('Not Found');
};
