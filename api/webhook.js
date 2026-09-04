const { webhookCallback } = require('grammy');
const bot = require('../src/bot');
const config = require('../src/config');

// Handler for Vercel Serverless Function
const handleWebhook = webhookCallback(bot, 'http', {
  secretToken: config.telegram.secretToken || undefined,
  timeoutMilliseconds: 10000,
});

module.exports = async (req, res) => {
  // Allow GET requests for simple health check
  if (req.method === 'GET') {
    res.status(200).json({
      status: 'ok',
      message: 'Telegram Energy Balance Bot Webhook is active.',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    await handleWebhook(req, res);
  } catch (error) {
    console.error('Webhook error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error processing webhook' });
    }
  }
};
