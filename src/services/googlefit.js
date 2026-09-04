const axios = require('axios');
const config = require('../config');

let cachedGoogleToken = null;
let googleTokenExpiresAt = 0;

/**
 * Returns start of today in milliseconds based on user timezone
 */
function getStartOfDayMillis(timezone = config.app.timezone) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { timeZone: timezone });
  const startOfDay = new Date(`${dateStr} 00:00:00`);
  return startOfDay.getTime();
}

const { getUserServiceData, setUserServiceData } = require('./db');

/**
 * Exchanges Google OAuth 2.0 refresh token for a fresh access token
 */
async function getGoogleAccessToken(userId = null) {
  let refreshToken = config.googleFit.refreshToken;

  if (userId) {
    const userData = await getUserServiceData(userId, 'google');
    if (userData && userData.refresh_token) {
      refreshToken = userData.refresh_token;
    }
  }

  const { clientId, clientSecret, tokenUrl } = config.googleFit;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Необходимо подключить Google Fit. Нажмите кнопку авторизации в боте.');
  }

  const response = await axios.post(tokenUrl, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
  });

  if (response.data && response.data.access_token) {
    return response.data.access_token;
  }

  throw new Error('Failed to obtain Google Fit access token');
}

/**
 * Fetches total burned calories for today from Google Fit API (synced from Amazfit)
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ calories: number, success: boolean, error?: string }>}
 */
async function getCaloriesBurnedToday(userId = null) {
  try {
    const accessToken = await getGoogleAccessToken(userId);
    const startTimeMillis = getStartOfDayMillis();
    const endTimeMillis = Date.now();

    const requestBody = {
      aggregateBy: [
        {
          dataTypeName: 'com.google.calories.expended',
        },
      ],
      bucketByTime: {
        durationMillis: 86400000, // 1 day bucket
      },
      startTimeMillis,
      endTimeMillis,
    };

    const response = await axios.post(config.googleFit.fitnessApiUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    });

    let totalBurned = 0;
    const buckets = response.data?.bucket || [];

    for (const bucket of buckets) {
      const datasets = bucket.dataset || [];
      for (const dataset of datasets) {
        const points = dataset.point || [];
        for (const point of points) {
          const values = point.value || [];
          for (const val of values) {
            if (typeof val.fpVal === 'number') {
              totalBurned += val.fpVal;
            } else if (typeof val.intVal === 'number') {
              totalBurned += val.intVal;
            }
          }
        }
      }
    }

    return {
      calories: Math.round(totalBurned),
      success: true,
    };
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message || 'Unknown Google Fit API error';
    return {
      calories: null,
      success: false,
      error: `Google Fit: ${errorMessage}`,
    };
  }
}

module.exports = {
  getCaloriesBurnedToday,
  getStartOfDayMillis,
  getGoogleAccessToken,
};
