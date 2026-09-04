const axios = require('axios');
const crypto = require('crypto');
const config = require('../config');
const { getUserServiceData, setUserServiceData } = require('./db');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Calculates days since Jan 1, 1970 UTC for FatSecret API date format
 */
function getFatSecretDateNumber(date = new Date()) {
  const epoch = new Date(Date.UTC(1970, 0, 1));
  const diffTime = date.getTime() - epoch.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Generates OAuth 1.0a HMAC-SHA1 signature
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

/**
 * Fetches total consumed calories for today from FatSecret API
 * Supports both OAuth 1.0a 3-legged user tokens and OAuth 2.0 Bearer tokens
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ calories: number, details?: object, success: boolean, error?: string }>}
 */
async function getCaloriesConsumedToday(userId = null) {
  try {
    const dateNumber = getFatSecretDateNumber();
    const clientId = config.fatsecret.clientId;
    const clientSecret = config.fatsecret.clientSecret;

    let userData = null;
    if (userId) {
      userData = await getUserServiceData(userId, 'fatsecret');
    }

    // 1. If user has OAuth 1.0a tokens (user_token / auth_token)
    if (userData && (userData.user_token || userData.oauth_token || userData.auth_token)) {
      const userToken = userData.user_token || userData.oauth_token || userData.auth_token;
      const userSecret = userData.user_secret || userData.oauth_token_secret || userData.auth_secret || '';

      const requestParams = {
        date: dateNumber.toString(),
        format: 'json',
        method: 'food_entries.get.v2',
        oauth_consumer_key: clientId,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: userToken,
        oauth_version: '1.0',
      };

      requestParams.oauth_signature = generateOAuthSignature(
        'GET',
        config.fatsecret.apiBaseUrl,
        requestParams,
        clientSecret,
        userSecret
      );

      const response = await axios.get(config.fatsecret.apiBaseUrl, {
        params: requestParams,
        timeout: 8000,
      });

      return parseFatSecretResponse(response.data);
    }

    // 2. If user or global has OAuth 2.0 Bearer access_token
    const bearerToken = userData?.access_token || config.fatsecret.accessToken;
    if (bearerToken) {
      const response = await axios.get(config.fatsecret.apiBaseUrl, {
        params: {
          method: 'food_entries.get.v2',
          format: 'json',
          date: dateNumber,
        },
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
        },
        timeout: 8000,
      });

      return parseFatSecretResponse(response.data);
    }

    throw new Error('Необходимо подключить FatSecret. Нажмите кнопку авторизации в боте.');
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown FatSecret API error';
    return {
      calories: null,
      success: false,
      error: `FatSecret: ${errorMessage}`,
    };
  }
}

function parseFatSecretResponse(data) {
  let totalCalories = 0;

  if (data && data.food_entries) {
    const entries = Array.isArray(data.food_entries.food_entry)
      ? data.food_entries.food_entry
      : data.food_entries.food_entry
      ? [data.food_entries.food_entry]
      : [];

    for (const entry of entries) {
      const cal = parseFloat(entry.calories) || 0;
      totalCalories += cal;
    }
  } else if (data && data.calories !== undefined) {
    totalCalories = parseFloat(data.calories) || 0;
  }

  return {
    calories: Math.round(totalCalories),
    success: true,
  };
}

module.exports = {
  getCaloriesConsumedToday,
  getFatSecretDateNumber,
  generateOAuthSignature,
};
