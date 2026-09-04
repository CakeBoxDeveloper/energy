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
    const endTimeMillis = Date.now() + 60000;
    const startNanos = (BigInt(startTimeMillis) * BigInt(1000000)).toString();
    const endNanos = (BigInt(endTimeMillis) * BigInt(1000000)).toString();

    let aggBurned = 0;

    // 1. Try Aggregate endpoint for com.google.calories.expended
    try {
      const requestBody = {
        aggregateBy: [
          { dataTypeName: 'com.google.calories.expended' },
        ],
        startTimeMillis,
        endTimeMillis,
        bucketByTime: { durationMillis: 86400000 },
      };

      const response = await axios.post(config.googleFit.fitnessApiUrl, requestBody, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 8000,
      });

      const buckets = response.data?.bucket || [];
      for (const bucket of buckets) {
        for (const dataset of bucket.dataset || []) {
          for (const point of dataset.point || []) {
            for (const val of point.value || []) {
              if (typeof val.fpVal === 'number') aggBurned += val.fpVal;
              else if (typeof val.intVal === 'number') aggBurned += val.intVal;
            }
          }
        }
      }
    } catch (aggErr) {
      console.log('Aggregate burned error:', aggErr.message);
    }

    // 2. Query the official merged or platform calories stream directly for fresher points
    let mergeBurned = 0;
    try {
      const dataSourcesRes = await axios.get('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        timeout: 8000,
      });

      const sources = dataSourcesRes.data?.dataSource || [];
      const mergeSource = sources.find(s => {
        const id = (s.dataStreamId || '').toLowerCase();
        const type = (s.dataType?.name || '').toLowerCase();
        return type.includes('calories.expended') && (id.includes('merge_calories_expended') || id.includes('platform_calories_expended'));
      }) || sources.find(s => (s.dataType?.name || '').toLowerCase().includes('calories.expended'));

      if (mergeSource) {
        const dsId = encodeURIComponent(mergeSource.dataStreamId);
        const datasetUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dsId}/datasets/${startNanos}-${endNanos}`;
        const dsRes = await axios.get(datasetUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          timeout: 8000,
        });

        for (const point of dsRes.data?.point || []) {
          for (const val of point.value || []) {
            if (typeof val.fpVal === 'number') mergeBurned += val.fpVal;
            else if (typeof val.intVal === 'number') mergeBurned += val.intVal;
          }
        }
      }
    } catch (dsErr) {
      console.log('Merge source burned error:', dsErr.message);
    }

    const total = Math.max(aggBurned, mergeBurned);

    return {
      calories: Math.round(total),
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
 * Helper to recursively extract calories from Google Fit nutrition values
 */
function extractNutritionCalories(val) {
  if (!val) return 0;

  // Google Fit com.google.nutrition structure:
  // val.mapVal contains items with key="calories", value={ fpVal: 123.4 }
  if (Array.isArray(val.mapVal)) {
    for (const entry of val.mapVal) {
      const key = (entry.key || '').toLowerCase();
      if (key === 'calories' || key === 'energy' || key.includes('calorie')) {
        if (entry.value && typeof entry.value.fpVal === 'number') {
          return entry.value.fpVal;
        } else if (entry.value && typeof entry.value.intVal === 'number') {
          return entry.value.intVal;
        } else if (typeof entry.value === 'number') {
          return entry.value;
        }
      }
    }
  } else if (typeof val.mapVal === 'object' && val.mapVal !== null) {
    for (const [k, v] of Object.entries(val.mapVal)) {
      const key = k.toLowerCase();
      if (key === 'calories' || key === 'energy' || key.includes('calorie')) {
        if (typeof v === 'number') return v;
        if (v && typeof v.fpVal === 'number') return v.fpVal;
        if (v && typeof v.intVal === 'number') return v.intVal;
      }
    }
  }

  return 0;
}

/**
 * Fetches total consumed calories for today synced into Google Fit from FatSecret
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ calories: number, success: boolean, error?: string }>}
 */
async function getCaloriesConsumedFromGoogleFit(userId = null) {
  try {
    const accessToken = await getGoogleAccessToken(userId);
    const startTimeMillis = getStartOfDayMillis();
    const endTimeMillis = Date.now() + 60000;
    const startNanos = (BigInt(startTimeMillis) * BigInt(1000000)).toString();
    const endNanos = (BigInt(endTimeMillis) * BigInt(1000000)).toString();

    // 1. Fetch dataSources
    const dataSourcesRes = await axios.get('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      timeout: 8000,
    });

    const sources = dataSourcesRes.data?.dataSource || [];
    
    // Filter for nutrition sources
    const allNutritionSources = sources.filter(s => {
      const name = (s.dataType?.name || '').toLowerCase();
      return name.includes('nutrition') || name.includes('calories.consumed');
    });

    // If FatSecret specific sources exist, prioritize them to avoid mixing third-party mirrors
    const fatsecretSources = allNutritionSources.filter(s => {
      const id = (s.dataStreamId || '').toLowerCase();
      const app = (s.application?.name || s.application?.packageName || '').toLowerCase();
      return id.includes('fatsecret') || app.includes('fatsecret');
    });

    const targetSources = fatsecretSources.length > 0 ? fatsecretSources : allNutritionSources;

    // Deduplicate points across sources by unique key: `${startTimeNanos}_${endTimeNanos}_${calories}`
    // This allows summing multiple different meals (breakfast, lunch, dinner)
    // while strictly preventing double-counting if points are mirrored across multiple streams
    const seenPoints = new Set();
    let totalCalories = 0;

    for (const src of targetSources) {
      try {
        const dsId = encodeURIComponent(src.dataStreamId);
        const datasetUrl = `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dsId}/datasets/${startNanos}-${endNanos}`;
        const dsRes = await axios.get(datasetUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
          timeout: 8000,
        });

        for (const point of dsRes.data?.point || []) {
          for (const val of point.value || []) {
            const cal = extractNutritionCalories(val);
            if (cal > 0) {
              const roundedCal = Math.round(cal * 10);
              const pointKey = `${point.startTimeNanos}_${point.endTimeNanos}_${roundedCal}`;
              if (!seenPoints.has(pointKey)) {
                seenPoints.add(pointKey);
                totalCalories += cal;
              }
            }
          }
        }
      } catch (_) {}
    }

    return {
      calories: Math.round(totalCalories),
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
