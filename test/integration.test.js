const assert = require('assert');
const { getDailyEnergyBalanceReport } = require('../src/services/balance');
const webhookHandler = require('../api/webhook');

async function testWebhookAndReports() {
  console.log('🧪 Testing webhook and error reporting...');

  // Test report when APIs are not configured (mock environment)
  const report = await getDailyEnergyBalanceReport();
  assert.strictEqual(report.success, false);
  assert(report.text.includes('⚠️ *Не удалось полностью рассчитать баланс:*'), 'Expected error message header');
  assert(report.text.includes('FatSecret:'), 'Expected FatSecret error detail');
  assert(report.text.includes('Google Fit:'), 'Expected Google Fit error detail');
  console.log('✅ Graceful API error handling verified:');
  console.log(report.text);
  console.log('--------------------------------------------------');

  // Test GET request on webhook endpoint
  const reqGet = { method: 'GET' };
  let statusCode = null;
  let jsonResponse = null;
  const resGet = {
    status: (code) => {
      statusCode = code;
      return {
        json: (data) => {
          jsonResponse = data;
        },
      };
    },
  };

  await webhookHandler(reqGet, resGet);
  assert.strictEqual(statusCode, 200);
  assert.strictEqual(jsonResponse.status, 'ok');
  console.log('✅ Webhook GET healthcheck verified');

  console.log('\n🎉 ALL INTEGRATION CHECKS PASSED!');
}

testWebhookAndReports().catch((err) => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
