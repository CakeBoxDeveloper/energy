const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./googlefit');

/**
 * Calculates energy balance and formats output message as a clean monospace table with native HTML quote
 * @param {number} consumed - Consumed calories (Inflow)
 * @param {number} burned - Burned calories (Outflow)
 * @returns {string} Formatted telegram HTML message
 */
function formatEnergyBalance(consumed, burned) {
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

  const consumedStr = `${consumed} ккал`.padStart(10, ' ');
  const burnedStr = `${burned} ккал`.padStart(10, ' ');
  const diffStr = `${formattedDiff}`.padStart(10, ' ');

  const message = [
    `📊 <b>Энергетический баланс за сегодня:</b>`,
    ``,
    `<code>┌───────────────┬────────────┐`,
    `│ 📥 Приход     │ ${consumedStr} │`,
    `│ 📤 Расход     │ ${burnedStr} │`,
    `├───────────────┼────────────┤`,
    `│ ⚖️ Итог       │ ${diffStr} │`,
    `└───────────────┴────────────┘</code>`,
    ``,
    `<blockquote>${statusText}</blockquote>`,
  ].join('\n');

  return message;
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
