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
    const sourceSummary = sources.map(s => ({
      dataStreamId: s.dataStreamId,
      dataType: s.dataType?.name,
      app: s.application?.name || s.application?.packageName,
    }));

    // 2. Fetch aggregate data for nutrition and calories
    const aggRes = await axios.post(config.googleFit.fitnessApiUrl, {
      aggregateBy: [
        { dataTypeName: 'com.google.calories.expended' },
        { dataTypeName: 'com.google.nutrition.summary' },
        { dataTypeName: 'com.google.nutrition' },
        { dataTypeName: 'com.google.calories.consumed' },
      ],
      startTimeMillis,
      endTimeMillis,
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    res.status(200).json({
      status: 'ok',
      startTime: new Date(startTimeMillis).toISOString(),
      endTime: new Date(endTimeMillis).toISOString(),
      dataSourcesCount: sources.length,
      sources: sourceSummary,
      aggregateResponse: aggRes.data,
    });
  } catch (err) {
    res.status(500).json({
      error: err.response?.data || err.message,
    });
  }
};
