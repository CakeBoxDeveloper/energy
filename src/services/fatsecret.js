const axios = require('axios');
const config = require('../config');

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
 * Retrieves an OAuth 2.0 access token for FatSecret API
 */
async function getFatSecretAccessToken() {
  if (config.fatsecret.accessToken) {
    return config.fatsecret.accessToken;
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const { clientId, clientSecret, tokenUrl } = config.fatsecret;

  if (!clientId || !clientSecret) {
    throw new Error('FatSecret API credentials (FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET) are not configured.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('scope', 'basic premier');

  const response = await axios.post(tokenUrl, params.toString(), {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 8000,
  });

  if (response.data && response.data.access_token) {
    cachedToken = response.data.access_token;
    const expiresIn = response.data.expires_in || 86400;
    tokenExpiresAt = Date.now() + expiresIn * 1000;
    return cachedToken;
  }

  throw new Error('Failed to obtain FatSecret access token');
}

/**
 * Fetches total consumed calories for today from FatSecret API
 * @returns {Promise<{ calories: number, details: object }>}
 */
async function getCaloriesConsumedToday() {
  try {
    const token = await getFatSecretAccessToken();
    const dateNumber = getFatSecretDateNumber();

    // Call FatSecret food_entries.get.v2
    const response = await axios.get(config.fatsecret.apiBaseUrl, {
      params: {
        method: 'food_entries.get.v2',
        format: 'json',
        date: dateNumber,
      },
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: 8000,
    });

    const data = response.data;
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
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown FatSecret API error';
    return {
      calories: null,
      success: false,
      error: `FatSecret: ${errorMessage}`,
    };
  }
}

module.exports = {
  getCaloriesConsumedToday,
  getFatSecretDateNumber,
};
