const { getCaloriesConsumedToday } = require('./fatsecret');
const { getCaloriesBurnedToday } = require('./googlefit');

/**
 * Calculates energy balance and formats output message as a rich text monospace table (Telegram Rich Text)
 * @param {number} consumed - Consumed calories (Inflow)
 * @param {number} burned - Burned calories (Outflow)
 * @returns {string} Formatted telegram message with HTML table and rich layout
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

  const table = [
    `📊 <b>Энергетический баланс за сегодня:</b>\n`,
    `<pre>`,
    `┌───────────────┬────────────┐`,
    `│ Параметр      │ Значение   │`,
    `├───────────────┼────────────┤`,
    `│ 📥 Приход     │ ${consumedStr} │`,
    `│ 📤 Расход     │ ${burnedStr} │`,
    `├───────────────┼────────────┤`,
    `│ ⚖️ Итог       │ ${diffStr} │`,
    `└───────────────┴────────────┘`,
    `</pre>`,
    `\n<blockquote>${statusText}</blockquote>`,
  ].join('\n');

  return table;
}

/**
 * Fetches data from FatSecret and Google Fit, computes balance and generates output
 * @param {string|number} [userId] Telegram user ID
 * @returns {Promise<{ text: string, success: boolean, parseMode?: string }>}
 */
async function getDailyEnergyBalanceReport(userId = null) {
  const [consumedResult, burnedResult] = await Promise.all([
    getCaloriesConsumedToday(userId),
    getCaloriesBurnedToday(userId),
  ]);

  const errors = [];
  if (!consumedResult.success) {
    errors.push(`• 📥 <b>Приход (FatSecret):</b> ${consumedResult.error || 'недоступен'}`);
  }
  if (!burnedResult.success) {
    errors.push(`• 📤 <b>Расход (Google Fit / Amazfit):</b> ${burnedResult.error || 'недоступен'}`);
  }

  if (errors.length > 0) {
    let message = `⚠️ <b>Не удалось рассчитать баланс:</b>\n\n` + errors.join('\n');
    
    if (consumedResult.success) {
      message += `\n\n📥 Приход: <b>${consumedResult.calories} ккал</b>`;
    }
    if (burnedResult.success) {
      message += `\n\n📤 Расход: <b>${burnedResult.calories} ккал</b>`;
    }

    message += `\n\n<i>Подключите необходимые сервисы кнопками на клавиатуре ниже.</i>`;
    return {
      text: message,
      success: false,
      parseMode: 'HTML',
    };
  }

  const message = formatEnergyBalance(consumedResult.calories, burnedResult.calories);
  return {
    text: message,
    success: true,
    parseMode: 'HTML',
  };
}

module.exports = {
  formatEnergyBalance,
  getDailyEnergyBalanceReport,
};
