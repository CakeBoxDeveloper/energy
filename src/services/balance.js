const { getCaloriesConsumedToday } = require('./fatsecret');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./googlefit');

/**
 * Calculates energy balance and formats output message as a native Telegram Rich Text Markdown table
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
    statusText = `🔴 **Профицит:** съедено на ${diff} ккал больше, чем сожжено.`;
  } else if (diff < 0) {
    formattedDiff = `${diff} ккал`;
    statusText = `🟢 **Дефицит:** сожжено на ${Math.abs(diff)} ккал больше, чем съедено.`;
  } else {
    formattedDiff = `0 ккал`;
    statusText = `⚪ **Баланс:** потребление равно расходу.`;
  }

  const message = [
    `**📊 Энергетический баланс за сегодня**`,
    ``,
    `| Параметр | Калории |`,
    `| :--- | ---: |`,
    `| 📥 Приход | ${consumed} ккал |`,
    `| 📤 Расход | ${burned} ккал |`,
    `| ⚖️ Итог | ${formattedDiff} |`,
    ``,
    `> ${statusText}`,
  ].join('\n');

  return message;
}

/**
 * Fetches data from FatSecret and Google Fit, computes balance and generates output
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ text: string, success: boolean }>}
 */
async function getDailyEnergyBalanceReport(userId = null) {
  const [consumedFsResult, burnedResult, consumedGfResult] = await Promise.all([
    getCaloriesConsumedToday(userId),
    getCaloriesBurnedToday(userId),
    getCaloriesConsumedFromGoogleFit(userId),
  ]);

  if (!burnedResult.success) {
    return {
      text: `⚠️ **Не удалось рассчитать баланс:**\n\n• 📤 **Расход (Google Fit):** ${burnedResult.error || 'недоступен'}\n\n_Подключите Google Fit кнопкой на клавиатуре ниже._`,
      success: false,
    };
  }

  // Use FatSecret direct API if > 0, or Google Fit synced nutrition if > 0
  let consumedCalories = 0;
  if (consumedFsResult.success && consumedFsResult.calories > 0) {
    consumedCalories = consumedFsResult.calories;
  } else if (consumedGfResult.success && consumedGfResult.calories > 0) {
    consumedCalories = consumedGfResult.calories;
  } else if (consumedFsResult.success) {
    consumedCalories = consumedFsResult.calories;
  } else if (consumedGfResult.success) {
    consumedCalories = consumedGfResult.calories;
  }

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
