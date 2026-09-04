const axios = require('axios');
const config = require('../config');
const { getUserServiceData, setUserServiceData } = require('./db');

let cachedGoogleToken = null;
let googleTokenExpiresAt = 0;

/**
 * Returns exact start of today (00:00:00.000) in milliseconds for the user timezone
 */
function getStartOfDayMillis(timezone = config.app.timezone || 'Europe/Moscow') {
  const now = new Date();
  
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10) % 24;
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);
  const elapsedMillisToday = (hour * 3600 + minute * 60 + second) * 1000 + (now.getTime() % 1000);

  return now.getTime() - elapsedMillisToday;
}

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
 * Fetches total burned calories for today ONLY (from 00:00:00 today to current time)
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

    // If response is bucketed or direct dataset
    if (buckets.length > 0) {
      for (const bucket of buckets) {
        const datasets = bucket.dataset || [];
        for (const dataset of datasets) {
          for (const point of dataset.point || []) {
            for (const val of point.value || []) {
              if (typeof val.fpVal === 'number') totalBurned += val.fpVal;
              else if (typeof val.intVal === 'number') totalBurned += val.intVal;
            }
          }
        }
      }
    } else if (response.data?.dataset) {
      for (const dataset of response.data.dataset) {
        for (const point of dataset.point || []) {
          for (const val of point.value || []) {
            if (typeof val.fpVal === 'number') totalBurned += val.fpVal;
            else if (typeof val.intVal === 'number') totalBurned += val.intVal;
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
