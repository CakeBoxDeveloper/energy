const dotenv = require('dotenv');
dotenv.config();

const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    secretToken: process.env.TELEGRAM_SECRET_TOKEN || '',
  },
  fatsecret: {
    clientId: process.env.FATSECRET_CLIENT_ID || '',
    clientSecret: process.env.FATSECRET_CLIENT_SECRET || '',
    accessToken: process.env.FATSECRET_ACCESS_TOKEN || '',
    userToken: process.env.FATSECRET_USER_TOKEN || '',
    userSecret: process.env.FATSECRET_USER_SECRET || '',
    apiBaseUrl: process.env.FATSECRET_API_URL || 'https://platform.fatsecret.com/rest/server.api',
    tokenUrl: process.env.FATSECRET_TOKEN_URL || 'https://oauth.fatsecret.com/connect/token',
  },
  googleFit: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    fitnessApiUrl: 'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
  },
  app: {
    timezone: process.env.USER_TIMEZONE || 'Europe/Moscow',
  },
};

module.exports = config;
