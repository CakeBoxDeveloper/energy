/**
 * Helper script to generate a Google Fit Refresh Token
 * Run: node scripts/get-google-token.js
 */

const http = require('http');
const url = require('url');
const axios = require('axios');
const readline = require('readline');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.body.read',
  'https://www.googleapis.com/auth/fitness.nutrition.read',
].join(' ');

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const clientId = CLIENT_ID || await new Promise(res => rl.question('Enter your GOOGLE_CLIENT_ID: ', res));
  const clientSecret = CLIENT_SECRET || await new Promise(res => rl.question('Enter your GOOGLE_CLIENT_SECRET: ', res));
  rl.close();

  if (!clientId || !clientSecret) {
    console.error('❌ Client ID and Secret are required!');
    process.exit(1);
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(SCOPES)}&` +
    `access_type=offline&` +
    `prompt=consent`;

  console.log('\n🔗 Open the following URL in your browser to authorize access:');
  console.log('--------------------------------------------------');
  console.log(authUrl);
  console.log('--------------------------------------------------\n');
  console.log(`Waiting for callback on http://localhost:${PORT}/oauth2callback ...`);

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname === '/oauth2callback') {
        const code = parsedUrl.query.code;

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Error: No authorization code received.</h1>');
          return;
        }

        // Exchange code for tokens
        const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
          grant_type: 'authorization_code',
        });

        const { refresh_token, access_token } = tokenRes.data;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <h1>✅ Авторизация успешна!</h1>
          <p>Вы можете закрыть это окно и вернуться в терминал.</p>
        `);

        console.log('\n🎉 SUCCESS! Your Google Refresh Token:');
        console.log('--------------------------------------------------');
        console.log(`GOOGLE_REFRESH_TOKEN=${refresh_token}`);
        console.log('--------------------------------------------------');
        console.log('Add this token to your .env file and to Vercel Environment Variables!\n');

        server.close();
        process.exit(0);
      }
    } catch (err) {
      console.error('Error exchanging code for token:', err.response?.data || err.message);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Ошибка при получении токена</h1><p>' + err.message + '</p>');
    }
  });

  server.listen(PORT);
}

main().catch(console.error);
