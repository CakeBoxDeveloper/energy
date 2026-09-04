const { Bot, Keyboard, InlineKeyboard } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./services/googlefit');
const { getUserServiceData, deleteUserServiceData } = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

/**
 * Builds the bottom Reply Keyboard
 */
async function buildPersistentKeyboard(userId, balanceSummary = null) {
  const keyboard = new Keyboard();

  const googleData = await getUserServiceData(userId, 'google');
  const isGoogleConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  let balanceBtnText = '📊 Показать баланс';
  if (balanceSummary) {
    const { diff } = balanceSummary;
    if (diff < 0) {
      balanceBtnText = `⚖️ Баланс: ${diff} ккал 🟢 (Дефицит)`;
    } else if (diff > 0) {
      balanceBtnText = `⚖️ Баланс: +${diff} ккал 🔴 (Профицит)`;
    } else {
      balanceBtnText = `⚖️ Баланс: 0 ккал ⚪ (В норме)`;
    }
  }

  keyboard.text(balanceBtnText).row();

  // Bottom row
  const googleBtnText = isGoogleConnected ? '🟢 Google Fit (Подключен)' : '🔵 Подключить Google Fit';

  keyboard
    .text(googleBtnText)
    .text('🔄 Обновить баланс')
    .row();

  keyboard.resized().persistent();
  return keyboard;
}

// Handle /start, /help, /menu commands
bot.command(['start', 'help', 'menu'], async (ctx) => {
  const userId = ctx.from.id;
  const keyboard = await buildPersistentKeyboard(userId);

  const text =
`📊 <b>Энергетический баланс (Google Fit + Amazfit + FatSecret)</b>

Все данные синхронизируются через ваш <b>Google Fit</b>.
Используйте кнопки на панели внизу экрана 👇`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
});

// Handle balance calculation
async function sendBalanceReport(ctx) {
  const userId = ctx.from.id;

  try {
    const [consumedRes, burnedRes] = await Promise.all([
      getCaloriesConsumedFromGoogleFit(userId),
      getCaloriesBurnedToday(userId),
    ]);

    if (!burnedRes.success) {
      const report = await getDailyEnergyBalanceReport(userId);
      const keyboard = await buildPersistentKeyboard(userId);
      return ctx.reply(report.text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }

    const consumed = consumedRes.success ? consumedRes.calories : 0;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const message = formatEnergyBalance(consumed, burned);
    const keyboard = await buildPersistentKeyboard(userId, { consumed, burned, diff });

    // Inline button attached to the balance message with color styling
    const inlineButtons = {
      inline_keyboard: [
        [
          {
            text: diff < 0 ? `🟢 Дефицит: ${diff} ккал` : diff > 0 ? `🔴 Профицит: +${diff} ккал` : `⚪ Баланс: 0 ккал`,
            callback_data: 'refresh_balance_inline',
            style: diff < 0 ? 'success' : diff > 0 ? 'destructive' : 'primary',
          },
        ],
      ],
    };

    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: inlineButtons,
    });
  } catch (error) {
    console.error('Error calculating balance:', error);
    await ctx.reply('❌ Произошла ошибка при расчете баланса: ' + (error.message || ''));
  }
}

// Handle Google Fit button press
async function sendGoogleFitStatus(ctx) {
  const userId = ctx.from.id;
  const googleData = await getUserServiceData(userId, 'google');
  const isConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  if (isConnected) {
    const lastSync = googleData?.updated_at ? new Date(googleData.updated_at).toLocaleString('ru-RU', { timeZone: config.app.timezone }) : 'Ранее';
    const email = googleData?.email || 'slardaran@gmail.com';

    const text =
`⌚ <b>Google Fit подключен ✅</b>

<blockquote>📧 <b>Подключенный аккаунт:</b> ${email}</blockquote>

• <b>Расход калорий:</b> с часов (Amazfit / Zepp)
• <b>Приход калорий:</b> из дневника питания (FatSecret)
• <b>Последнее обновление:</b> ${lastSync}

Чтобы сменить Google-аккаунт, нажмите красную кнопку отключения:`;

    // Red destructive disconnect button and green status button
    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: '🟢 Аккаунт активен (slardaran@gmail.com)',
            callback_data: 'account_active_info',
            style: 'success',
          },
        ],
        [
          {
            text: '🔴 Отключить Google Fit',
            callback_data: 'disconnect_google',
            style: 'destructive',
          },
        ],
      ],
    };

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;
    const text =
`⌚ <b>Google Fit не подключен</b>

Нажмите синюю кнопку ниже для авторизации под вашим Google-аккаунтом:`;

    // Blue primary connect button
    const inlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: '🔵 Войти через Google',
            url: authUrl,
            style: 'primary',
          },
        ],
      ],
    };

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard,
    });
  }
}

// Command & button handlers
bot.command(['balance', 'today'], sendBalanceReport);
bot.command('auth', sendGoogleFitStatus);

// Inline Callbacks
bot.callbackQuery('refresh_balance_inline', async (ctx) => {
  await ctx.answerCallbackQuery({ text: '🔄 Баланс актуален' });
});

bot.callbackQuery('account_active_info', async (ctx) => {
  await ctx.answerCallbackQuery({ text: '✅ Синхронизация активна' });
});

bot.callbackQuery('disconnect_google', async (ctx) => {
  const userId = ctx.from.id;
  await deleteUserServiceData(userId, 'google');
  await ctx.answerCallbackQuery({ text: 'Google Fit отключен' });
  const keyboard = await buildPersistentKeyboard(userId);
  await ctx.reply('🗑️ <b>Google Fit успешно отключен.</b> Вы можете привязать другой аккаунт.', {
    parse_mode: 'HTML',
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
