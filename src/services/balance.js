const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./googlefit');

/**
 * Calculates energy balance and formats output message as a Telegram monospace table card with blockquote
 * @param {number} consumed - Consumed calories (Inflow)
 * @param {number} burned - Burned calories (Outflow)
 * @returns {string} Formatted telegram markdown message
 */
function formatEnergyBalance(consumed, burned) {
  const diff = consumed - burned;
  let formattedDiff;
  let statusText = '';

  if (diff > 0) {
    formattedDiff = `+${diff} ккал`;
    statusText = `🔴 *Профицит:* съедено на ${diff} ккал больше, чем сожжено.`;
  } else if (diff < 0) {
    formattedDiff = `${diff} ккал`;
    statusText = `🟢 *Дефицит:* сожжено на ${Math.abs(diff)} ккал больше, чем съедено.`;
  } else {
    formattedDiff = `0 ккал`;
    statusText = `⚪ *Баланс:* потребление равно расходу.`;
  }

  const consumedStr = `${consumed} ккал`.padStart(10, ' ');
  const burnedStr = `${burned} ккал`.padStart(10, ' ');
  const diffStr = `${formattedDiff}`.padStart(10, ' ');

  const message = [
    `📊 *Энергетический баланс за сегодня*`,
    ``,
    `\`\`\``,
    `┌───────────────┬────────────┐`,
    `│ Параметр      │ Значение   │`,
    `├───────────────┼────────────┤`,
    `│ 📥 Приход     │ ${consumedStr} │`,
    `│ 📤 Расход     │ ${burnedStr} │`,
    `├───────────────┼────────────┤`,
    `│ ⚖️ Итог       │ ${diffStr} │`,
    `└───────────────┴────────────┘`,
    `\`\`\``,
    `> ${statusText}`,
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
      text: `⚠️ *Не удалось рассчитать баланс:*\n\n• 📤 *Расход (Google Fit):* ${burnedResult.error || 'недоступен'}\n\n_Подключите Google Fit кнопкой на клавиатуре ниже._`,
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
