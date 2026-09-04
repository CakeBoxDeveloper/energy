const { getCaloriesConsumedToday } = require('./fatsecret');
const { getCaloriesBurnedToday } = require('./googlefit');

/**
 * Calculates energy balance and formats output message
 * @param {number} consumed - Consumed calories (Inflow)
 * @param {number} burned - Burned calories (Outflow)
 * @returns {string} Formatted telegram message
 */
function formatEnergyBalance(consumed, burned) {
  const diff = consumed - burned;
  let formattedDiff;
  if (diff > 0) {
    formattedDiff = `+${diff}`;
  } else if (diff < 0) {
    formattedDiff = `${diff}`;
  } else {
    formattedDiff = `0`;
  }

  return [
    `📊 Энергетический баланс:`,
    `📥 Приход: ${consumed} ккал`,
    `📤 Расход: ${burned} ккал`,
    `⚖️ Итог: ${formattedDiff} ккал`,
  ].join('\n');
}

/**
 * Fetches data from FatSecret and Google Fit, computes balance and generates output
 * @returns {Promise<{ text: string, success: boolean }>}
 */
async function getDailyEnergyBalanceReport() {
  const [consumedResult, burnedResult] = await Promise.all([
    getCaloriesConsumedToday(),
    getCaloriesBurnedToday(),
  ]);

  const errors = [];
  if (!consumedResult.success) {
    errors.push(`• 📥 Приход (FatSecret): ${consumedResult.error || 'недоступен'}`);
  }
  if (!burnedResult.success) {
    errors.push(`• 📤 Расход (Google Fit / Amazfit): ${burnedResult.error || 'недоступен'}`);
  }

  if (errors.length > 0) {
    let message = `⚠️ *Не удалось полностью рассчитать баланс:*\n\n` + errors.join('\n');
    
    // If one of the services succeeded, provide partial info
    if (consumedResult.success) {
      message += `\n\n📥 Приход: ${consumedResult.calories} ккал`;
    }
    if (burnedResult.success) {
      message += `\n\n📤 Расход: ${burnedResult.calories} ккал`;
    }

    message += `\n\n_Попробуйте повторить запрос позже или проверьте настройки API ключей._`;
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
