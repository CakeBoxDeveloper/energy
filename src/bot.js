const { Bot, InlineKeyboard } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesConsumedToday } = require('./services/fatsecret');
const { getCaloriesBurnedToday } = require('./services/googlefit');
const { getUserServiceData, deleteUserServiceData } = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

/**
 * Builds the main 4-button interactive dashboard keyboard
 * @param {string|number} userId Telegram User ID
 * @param {object} [balanceSummary] Optional balance numbers { consumed, burned, diff }
 */
async function buildDashboardKeyboard(userId, balanceSummary = null) {
  const keyboard = new InlineKeyboard();

  const [googleData, fatsecretData] = await Promise.all([
    getUserServiceData(userId, 'google'),
    getUserServiceData(userId, 'fatsecret'),
  ]);

  const isGoogleConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);
  const isFatSecretConnected = !!(fatsecretData?.user_token || fatsecretData?.auth_token || fatsecretData?.access_token || config.fatsecret.accessToken);

  // Row 1: Full-width Balance button with dynamic + / - and color indicator
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

  keyboard.text(balanceBtnText, 'action_balance').row();

  // Row 2: Two buttons for Google Fit & FatSecret with ✅ indicator
  const googleBtnText = isGoogleConnected ? 'Google Fit ✅' : '🔗 Google Fit';
  const fatsecretBtnText = isFatSecretConnected ? 'FatSecret ✅' : '🔗 FatSecret';

  keyboard
    .text(googleBtnText, 'manage_google')
    .text(fatsecretBtnText, 'manage_fatsecret')
    .row();

  // Row 3: Refresh button
  keyboard.text('🔄 Обновить баланс', 'action_refresh');

  return keyboard;
}

// Handle /start and /help command
bot.command(['start', 'help', 'menu'], async (ctx) => {
  const userId = ctx.from.id;
  const keyboard = await buildDashboardKeyboard(userId);

  const text =
`📊 *Панель управления энергетическим балансом*

Нажмите кнопку на клавиатуре ниже:
• *Баланс:* расчет калорий за сегодня (Приход - Расход)
• *Google Fit / FatSecret:* статус и привязка аккаунтов`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Handle /balance command
bot.command(['balance', 'today'], async (ctx) => {
  return handleBalanceAction(ctx, false);
});

// Action: Click on Balance or Refresh
async function handleBalanceAction(ctx, isCallback = true) {
  const userId = ctx.from.id;

  try {
    if (isCallback) {
      await ctx.answerCallbackQuery({ text: '⏳ Считаю калории...' });
    }

    const [consumedRes, burnedRes] = await Promise.all([
      getCaloriesConsumedToday(userId),
      getCaloriesBurnedToday(userId),
    ]);

    if (!consumedRes.success || !burnedRes.success) {
      const report = await getDailyEnergyBalanceReport(userId);
      const keyboard = await buildDashboardKeyboard(userId);
      return ctx.reply(report.text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

    const consumed = consumedRes.calories;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const message = formatEnergyBalance(consumed, burned);
    const keyboard = await buildDashboardKeyboard(userId, { consumed, burned, diff });

    await ctx.reply(message, {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Error calculating balance:', error);
    await ctx.reply('❌ Произошла ошибка при расчете баланса.');
  }
}

// Callback query: action_balance and action_refresh
bot.callbackQuery(['action_balance', 'action_refresh'], async (ctx) => {
  await handleBalanceAction(ctx, true);
});

// Callback query: manage_google
bot.callbackQuery('manage_google', async (ctx) => {
  const userId = ctx.from.id;
  const googleData = await getUserServiceData(userId, 'google');
  const isConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  const keyboard = new InlineKeyboard();

  if (isConnected) {
    const lastSync = googleData?.updated_at ? new Date(googleData.updated_at).toLocaleString('ru-RU', { timeZone: config.app.timezone }) : 'Ранее';
    const text =
`⌚ *Google Fit (Amazfit) подключен ✅*

• *Статус:* Активен
• *Синхронизация:* Сожженные калории за сегодня
• *Последнее обновление токена:* ${lastSync}

Вы можете отвязать аккаунт, чтобы подключить другой.`;

    keyboard
      .text('❌ Отключить Google Fit', 'disconnect_google')
      .row()
      .text('⬅️ Назад в меню', 'back_to_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;
    const text =
`⌚ *Google Fit (Amazfit) не подключен*

Нажмите кнопку ниже, чтобы войти в ваш Google аккаунт, синхронизированный с приложением Zepp / часами Amazfit:`;

    keyboard
      .url('🔗 Войти в Google Fit', authUrl)
      .row()
      .text('⬅️ Назад в меню', 'back_to_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  await ctx.answerCallbackQuery();
});

// Callback query: manage_fatsecret
bot.callbackQuery('manage_fatsecret', async (ctx) => {
  const userId = ctx.from.id;
  const fatsecretData = await getUserServiceData(userId, 'fatsecret');
  const isConnected = !!(fatsecretData?.user_token || fatsecretData?.auth_token || fatsecretData?.access_token || config.fatsecret.accessToken);

  const keyboard = new InlineKeyboard();

  if (isConnected) {
    const lastSync = fatsecretData?.updated_at ? new Date(fatsecretData.updated_at).toLocaleString('ru-RU', { timeZone: config.app.timezone }) : 'Ранее';
    const text =
`🥗 *FatSecret подключен ✅*

• *Статус:* Активен
• *Синхронизация:* Дневник питания и съеденные калории
• *Последнее обновление:* ${lastSync}

Вы можете отвязать аккаунт, чтобы перезайти.`;

    keyboard
      .text('❌ Отключить FatSecret', 'disconnect_fatsecret')
      .row()
      .text('⬅️ Назад в меню', 'back_to_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/fatsecret/start?userId=${userId}`;
    const text =
`🥗 *FatSecret не подключен*

Нажмите кнопку ниже, чтобы привязать ваш аккаунт/дневник питания FatSecret:`;

    keyboard
      .url('🔗 Подключить FatSecret', authUrl)
      .row()
      .text('⬅️ Назад в меню', 'back_to_menu');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  await ctx.answerCallbackQuery();
});

// Callback query: disconnect_google
bot.callbackQuery('disconnect_google', async (ctx) => {
  const userId = ctx.from.id;
  await deleteUserServiceData(userId, 'google');
  await ctx.answerCallbackQuery({ text: 'Google Fit отключен' });
  const keyboard = await buildDashboardKeyboard(userId);
  await ctx.reply('🗑️ *Google Fit успешно отключен.* Вы можете привязать другой аккаунт в любое время.', {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Callback query: disconnect_fatsecret
bot.callbackQuery('disconnect_fatsecret', async (ctx) => {
  const userId = ctx.from.id;
  await deleteUserServiceData(userId, 'fatsecret');
  await ctx.answerCallbackQuery({ text: 'FatSecret отключен' });
  const keyboard = await buildDashboardKeyboard(userId);
  await ctx.reply('🗑️ *FatSecret успешно отключен.* Вы можете привязать другой аккаунт в любое время.', {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Callback query: back_to_menu
bot.callbackQuery('back_to_menu', async (ctx) => {
  const userId = ctx.from.id;
  const keyboard = await buildDashboardKeyboard(userId);
  await ctx.reply('📊 *Главное меню:*', {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
  await ctx.answerCallbackQuery();
});

// Fallback message for text messages
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim().toLowerCase();
  if (text === 'баланс' || text === 'balance') {
    return handleBalanceAction(ctx, false);
  }
  const keyboard = await buildDashboardKeyboard(ctx.from.id);
  await ctx.reply('Используйте кнопки на панели ниже:', { reply_markup: keyboard });
});

module.exports = bot;
