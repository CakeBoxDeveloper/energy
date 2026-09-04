const config = require('../config');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./googlefit');

/**
 * Calculates energy balance and formats output message as a clean mobile-friendly monospace table with native HTML quote
 * @param {number} consumed - Consumed calories (Inflow)
 * @param {number} burned - Burned calories (Outflow)
 * @param {string} [dataTime] - Timestamp of latest data point from Google Fit
 * @returns {string} Formatted telegram HTML message
 */
function formatEnergyBalance(consumed, burned, dataTime = null) {
  const diff = consumed - burned;
  let formattedDiff;
  let statusText = '';

  if (diff > 0) {
    formattedDiff = `+${diff} ккал`;
    statusText = `🔴 <b>Профицит:</b> съедено на ${diff} ккал больше, чем сожжено.`;
  } else if (diff < 0) {
    formattedDiff = `${diff} ккал`;
    statusText = `🟢 <b>Дефицит:</b> сожжено на ${Math.abs(diff)} ккал больше, чем съедено.`;
  } else {
    formattedDiff = `0 ккал`;
    statusText = `⚪ <b>Баланс:</b> потребление равно расходу.`;
  }

  const timeLabel = dataTime
    ? `<code>Данные в Google Fit: от ${dataTime}</code>`
    : `<code>Обновлено в ${new Intl.DateTimeFormat('ru-RU', { timeZone: config.app?.timezone || 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }).format(new Date())}</code>`;

  // Rich HTML message with native Telegram table (Bot API 10.1+)
  const html = [
    `📊 <b>Энергетический баланс за сегодня:</b>`,
    ``,
    `<table>`,
    `<tr><th>Приход</th><td>${consumed} ккал</td></tr>`,
    `<tr><th>Расход</th><td>${burned} ккал</td></tr>`,
    `<tr><th>Баланс</th><td><b>${formattedDiff}</b></td></tr>`,
    `</table>`,
    ``,
    `<blockquote>${statusText}</blockquote>`,
    ``,
    timeLabel,
  ].join('\n');

  return html;
}

/**
 * Fetches data from Google Fit, computes balance and generates output
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ text: string, success: boolean }>}
 */
async function getDailyEnergyBalanceReport(userId = null) {
  const [burnedResult, consumedResult] = await Promise.all([
    getCaloriesBurnedToday(userId),
    getCaloriesConsumedFromGoogleFit(userId),
  ]);

  if (!burnedResult.success) {
    return {
      text: `⚠️ <b>Не удалось рассчитать баланс:</b>\n\n• 📤 <b>Расход (Google Fit):</b> ${burnedResult.error || 'недоступен'}\n\n<i>Подключите Google Fit кнопкой на клавиатуре ниже.</i>`,
      success: false,
    };
  }

  const consumedCalories = consumedResult.success ? consumedResult.calories : 0;
  const message = formatEnergyBalance(consumedCalories, burnedResult.calories);
  return {
    text: message,
    success: true,
  };
}

module.exports = {
  formatEnergyBalance,
  getDailyEnergyBalanceReport,
};
