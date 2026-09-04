const axios = require('axios');
const { Bot, Keyboard, InlineKeyboard } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./services/googlefit');
const { getUserServiceData, deleteUserServiceData } = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

/**
 * Builds the bottom Reply Keyboard with styled colors (Bot API 9.4+ / 10.x button styling)
 * @param {string|number} userId Telegram User ID
 * @param {object} [balanceSummary] Optional balance numbers { consumed, burned, diff }
 */
async function buildPersistentKeyboard(userId, balanceSummary = null) {
  const googleData = await getUserServiceData(userId, 'google');
  const isGoogleConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  let balanceBtnText = '📊 Показать баланс';
  let balanceBtnStyle = 'primary';

  if (balanceSummary) {
    const { diff } = balanceSummary;
    if (diff < 0) {
      balanceBtnText = `⚖️ Баланс: ${diff} ккал (Дефицит)`;
      balanceBtnStyle = 'positive'; // Зеленый цвет кнопки
    } else if (diff > 0) {
      balanceBtnText = `⚖️ Баланс: +${diff} ккал (Профицит)`;
      balanceBtnStyle = 'destructive'; // Красный цвет кнопки
    } else {
      balanceBtnText = `⚖️ Баланс: 0 ккал (В норме)`;
      balanceBtnStyle = 'secondary';
    }
  }

  const googleBtnText = isGoogleConnected ? 'Google Fit ✅' : '🔗 Подключить Google Fit';

  // Reply Keyboard with native style support
  return {
    keyboard: [
      [
        {
          text: balanceBtnText,
          style: balanceBtnStyle,
        },
      ],
      [
        {
          text: googleBtnText,
          style: isGoogleConnected ? 'secondary' : 'primary',
        },
        {
          text: '🔄 Обновить баланс',
          style: 'secondary',
        },
      ],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * Sends a native Telegram Rich Message (Bot API 10.x sendRichMessage with InputRichBlockTable)
 */
async function sendRichBalanceReport(chatId, consumed, burned, diff, replyMarkup) {
  const isDeficit = diff < 0;
  const isSurplus = diff > 0;
  const formattedDiff = isSurplus ? `+${diff} ккал` : `${diff} ккал`;

  const statusText = isDeficit
    ? `🟢 Дефицит: сожжено на ${Math.abs(diff)} ккал больше, чем съедено.`
    : isSurplus
    ? `🔴 Профицит: съедено на ${diff} ккал больше, чем сожжено.`
    : `⚪ Баланс: потребление равно расходу.`;

  const payload = {
    chat_id: chatId,
    rich_message: {
      blocks: [
        {
          type: 'paragraph',
          text: {
            text: '📊 Энергетический баланс за сегодня',
            entities: [{ type: 'bold', offset: 0, length: 35 }],
          },
        },
        {
          type: 'table',
          is_bordered: true,
          is_striped: true,
          is_compact: false,
          cells: [
            [
              { text: { text: 'Параметр', entities: [{ type: 'bold', offset: 0, length: 8 }] } },
              { text: { text: 'Значение', entities: [{ type: 'bold', offset: 0, length: 8 }] } },
            ],
            [
              { text: { text: '📥 Приход' } },
              { text: { text: `${consumed} ккал` } },
            ],
            [
              { text: { text: '📤 Расход' } },
              { text: { text: `${burned} ккал` } },
            ],
            [
              { text: { text: '⚖️ Итог', entities: [{ type: 'bold', offset: 0, length: 7 }] } },
              { text: { text: formattedDiff, entities: [{ type: 'bold', offset: 0, length: formattedDiff.length }] } },
            ],
          ],
        },
        {
          type: 'block_quotation',
          text: {
            text: statusText,
          },
        },
      ],
    },
    reply_markup: replyMarkup,
  };

  try {
    const res = await axios.post(`https://api.telegram.org/bot${botToken}/sendRichMessage`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    return res.data;
  } catch (err) {
    console.log('sendRichMessage failed, fallback to standard message:', err.response?.data || err.message);
    const fallbackText = formatEnergyBalance(consumed, burned);
    return bot.api.sendMessage(chatId, fallbackText, {
      parse_mode: 'Markdown',
      reply_markup: replyMarkup,
    });
  }
}

// Handle /start, /help, /menu commands
bot.command(['start', 'help', 'menu'], async (ctx) => {
  const userId = ctx.from.id;
  const keyboard = await buildPersistentKeyboard(userId);

  const text =
`📊 *Энергетический баланс (Google Fit + Amazfit + FatSecret)*

Все данные синхронизируются через ваш **Google Fit**.
Используйте кнопки на панели внизу экрана 👇`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Handle balance calculation
async function sendBalanceReport(ctx) {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;

  try {
    const [consumedRes, burnedRes] = await Promise.all([
      getCaloriesConsumedFromGoogleFit(userId),
      getCaloriesBurnedToday(userId),
    ]);

    if (!burnedRes.success) {
      const report = await getDailyEnergyBalanceReport(userId);
      const keyboard = await buildPersistentKeyboard(userId);
      return ctx.reply(report.text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

    const consumed = consumedRes.success ? consumedRes.calories : 0;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const keyboard = await buildPersistentKeyboard(userId, { consumed, burned, diff });

    await sendRichBalanceReport(chatId, consumed, burned, diff, keyboard);
  } catch (error) {
    console.error('Error calculating balance:', error);
    await ctx.reply('❌ Произошла ошибка при расчете баланса.');
  }
}

// Handle Google Fit button press on bottom keyboard
async function sendGoogleFitStatus(ctx) {
  const userId = ctx.from.id;
  const googleData = await getUserServiceData(userId, 'google');
  const isConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  const inlineKeyboard = new InlineKeyboard();

  if (isConnected) {
    const lastSync = googleData?.updated_at ? new Date(googleData.updated_at).toLocaleString('ru-RU', { timeZone: config.app.timezone }) : 'Ранее';
    const text =
`⌚ *Google Fit подключен ✅*

• *Расход калорий:* с часов (Amazfit / Zepp)
• *Приход калорий:* из дневника питания (FatSecret)
• *Последнее обновление:* ${lastSync}

Чтобы сменить Google-аккаунт, нажмите кнопку ниже:`;

    inlineKeyboard.text('❌ Отключить Google Fit', 'disconnect_google');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;
    const text =
`⌚ *Google Fit не подключен*

Нажмите кнопку ниже для авторизации под вашим Google-аккаунтом:`;

    inlineKeyboard.url('🔗 Войти в Google Fit', authUrl);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard,
    });
  }
}

// Command & button handlers
bot.command(['balance', 'today'], sendBalanceReport);
bot.command('auth', sendGoogleFitStatus);

// Inline Callback: disconnect_google
bot.callbackQuery('disconnect_google', async (ctx) => {
  const userId = ctx.from.id;
  await deleteUserServiceData(userId, 'google');
  await ctx.answerCallbackQuery({ text: 'Google Fit отключен' });
  const keyboard = await buildPersistentKeyboard(userId);
  await ctx.reply('🗑️ *Google Fit успешно отключен.*', {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Text message listener for bottom keyboard buttons
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (text.includes('Баланс') || text.includes('баланс') || text.includes('balance')) {
    return sendBalanceReport(ctx);
  }
  if (text.includes('Google Fit')) {
    return sendGoogleFitStatus(ctx);
  }
  if (text.includes('Обновить') || text.includes('обновить')) {
    return sendBalanceReport(ctx);
  }

  const keyboard = await buildPersistentKeyboard(ctx.from.id);
  await ctx.reply('Выберите действие на клавиатуре внизу 👇', { reply_markup: keyboard });
});

module.exports = bot;
