const axios = require('axios');
const config = require('../config');
const { getUserServiceData, setUserServiceData } = require('./db');

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
        { dataTypeName: 'com.google.calories.expended' },
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

/**
 * Helper to recursively extract calories from Google Fit values
 */
function extractCaloriesFromVal(val) {
  let sum = 0;
  if (!val) return 0;

  if (typeof val === 'number') return val;

  if (typeof val.fpVal === 'number') {
    sum += val.fpVal;
  } else if (typeof val.intVal === 'number') {
    sum += val.intVal;
  }

  if (Array.isArray(val.mapVal)) {
    for (const entry of val.mapVal) {
      if (entry.key && (entry.key.toLowerCase().includes('calorie') || entry.key.toLowerCase().includes('energy'))) {
        if (entry.value && typeof entry.value.fpVal === 'number') {
          sum += entry.value.fpVal;
        } else if (entry.value && typeof entry.value.intVal === 'number') {
          sum += entry.value.intVal;
        }
      }
    }
  } else if (typeof val.mapVal === 'object' && val.mapVal !== null) {
    for (const [k, v] of Object.entries(val.mapVal)) {
      if (k.toLowerCase().includes('calorie') || k.toLowerCase().includes('energy')) {
        if (typeof v === 'number') sum += v;
        else if (v && typeof v.fpVal === 'number') sum += v.fpVal;
      }
    }
  }

  return sum;
}

/**
 * Fetches total consumed calories for today synced into Google Fit from FatSecret / Health Connect
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ calories: number, success: boolean, error?: string }>}
 */
async function getCaloriesConsumedFromGoogleFit(userId = null) {
  try {
    const accessToken = await getGoogleAccessToken(userId);
    const startTimeMillis = getStartOfDayMillis();
    const endTimeMillis = Date.now();

    let totalConsumed = 0;

    // 1. Try Aggregate Endpoint
    try {
      const requestBody = {
        aggregateBy: [
          { dataTypeName: 'com.google.nutrition.summary' },
          { dataTypeName: 'com.google.nutrition' },
          { dataTypeName: 'com.google.calories.consumed' },
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

      for (const bucket of response.data?.bucket || []) {
        for (const dataset of bucket.dataset || []) {
          for (const point of dataset.point || []) {
            for (const val of point.value || []) {
              totalConsumed += extractCaloriesFromVal(val);
            }
          }
        }
      }
    } catch (aggErr) {
      console.log('Aggregate nutrition error:', aggErr.message);
    }

    // 2. Query all DataSources for nutrition & calories
    try {
      const startNanos = (BigInt(startTimeMillis) * BigInt(1000000)).toString();
      const endNanos = (BigInt(endTimeMillis) * BigInt(1000000)).toString();

      const dataSourcesRes = await axios.get('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        timeout: 8000,
      });

      const sources = dataSourcesRes.data?.dataSource || [];
      const relevantSources = sources.filter(s => {
        const name = (s.dataType?.name || '').toLowerCase();
        return name.includes('nutrition') || name.includes('calories.consumed');
      });

      for (const src of relevantSources) {
        try {
          const dsId = encodeURIComponent(src.dataStreamId);
          const datasetUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dsId}/datasets/${startNanos}-${endNanos}`;
          const dsRes = await axios.get(datasetUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` },
            timeout: 8000,
          });

          for (const point of dsRes.data?.point || []) {
            for (const val of point.value || []) {
              totalConsumed += extractCaloriesFromVal(val);
            }
          }
        } catch (e) {
          // continue
        }
      }
    } catch (srcErr) {
      console.log('DataSources nutrition error:', srcErr.message);
    }

    return {
      calories: Math.round(totalConsumed),
      success: true,
    };
  } catch (error) {
    return {
      calories: 0,
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  getCaloriesBurnedToday,
  getCaloriesConsumedFromGoogleFit,
  getStartOfDayMillis,
  getGoogleAccessToken,
};
