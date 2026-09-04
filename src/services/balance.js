const { getCaloriesConsumedToday } = require('./fatsecret');
const { getCaloriesBurnedToday } = require('./googlefit');

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
    `📊 **Энергетический баланс за сегодня**`,
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
  const [consumedResult, burnedResult] = await Promise.all([
    getCaloriesConsumedToday(userId),
    getCaloriesBurnedToday(userId),
  ]);

  const errors = [];
  if (!consumedResult.success) {
    errors.push(`• 📥 **Приход (FatSecret):** ${consumedResult.error || 'недоступен'}`);
  }
  if (!burnedResult.success) {
    errors.push(`• 📤 **Расход (Google Fit / Amazfit):** ${burnedResult.error || 'недоступен'}`);
  }

  if (errors.length > 0) {
    let message = `⚠️ **Не удалось рассчитать баланс:**\n\n` + errors.join('\n');
    
    if (consumedResult.success) {
      message += `\n\n📥 Приход: **${consumedResult.calories} ккал**`;
    }
    if (burnedResult.success) {
      message += `\n\n📤 Расход: **${burnedResult.calories} ккал**`;
    }

    message += `\n\n_Подключите необходимые сервисы кнопками на клавиатуре ниже._`;
    return {
      text: message,
      success: false,
    };
  }

  const message = formatEnergyBalance(consumedResult.calories, burnedResult.calories);
  return {
    text: message,
    success: true,
  };
}

module.exports = {
  formatEnergyBalance,
  getDailyEnergyBalanceReport,
};
