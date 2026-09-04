const axios = require('axios');
const url = require('url');
const config = require('../../src/config');
const { getGoogleAccessToken, getStartOfDayMillis } = require('../../src/services/googlefit');

module.exports = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const userId = parsedUrl.query.userId || req.query?.userId;

  try {
    const accessToken = await getGoogleAccessToken(userId);
    const startTimeMillis = getStartOfDayMillis();
    const endTimeMillis = Date.now();
    const startNanos = (BigInt(startTimeMillis) * BigInt(1000000)).toString();
    const endNanos = (BigInt(endTimeMillis) * BigInt(1000000)).toString();

    // 1. Fetch all data sources
    const dsRes = await axios.get('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const sources = dsRes.data?.dataSource || [];
    const sourceDetails = [];

    for (const s of sources) {
      const type = (s.dataType?.name || '').toLowerCase();
      if (type.includes('nutrition') || type.includes('calorie')) {
        const dsId = encodeURIComponent(s.dataStreamId);
        let points = [];
        try {
          const pointsRes = await axios.get(
            `https://www.googleapis.com/fitness/v1/users/me/dataSources/${dsId}/datasets/${startNanos}-${endNanos}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          points = pointsRes.data?.point || [];
        } catch (e) {
          points = [{ error: e.message }];
        }

        sourceDetails.push({
          dataStreamId: s.dataStreamId,
          dataType: s.dataType?.name,
          app: s.application?.name || s.application?.packageName,
          pointsCount: points.length,
          points: points,
        });
      }
    }

    // 2. Try aggregate for calories expended only
    let aggCaloriesExpended = null;
    try {
      const aggRes = await axios.post(config.googleFit.fitnessApiUrl, {
        aggregateBy: [
          { dataTypeName: 'com.google.calories.expended' },
        ],
        startTimeMillis,
        endTimeMillis,
        bucketByTime: { durationMillis: 86400000 },
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      aggCaloriesExpended = aggRes.data;
    } catch (e) {
      aggCaloriesExpended = { error: e.response?.data || e.message };
    }

    res.status(200).json({
      status: 'ok',
      startTime: new Date(startTimeMillis).toISOString(),
      endTime: new Date(endTimeMillis).toISOString(),
      sources: sourceDetails,
      aggCaloriesExpended,
    });
  } catch (err) {
    res.status(500).json({
      error: err.response?.data || err.message,
    });
  }
};
