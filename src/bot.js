const { Bot, Keyboard, InlineKeyboard } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesConsumedToday } = require('./services/fatsecret');
const { getCaloriesBurnedToday } = require('./services/googlefit');
const { getUserServiceData, deleteUserServiceData } = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

/**
 * Builds the bottom persistent Reply Keyboard (в панели под полем ввода)
 * @param {string|number} userId Telegram User ID
 * @param {object} [balanceSummary] Optional balance numbers { consumed, burned, diff }
 */
async function buildPersistentKeyboard(userId, balanceSummary = null) {
  const keyboard = new Keyboard();

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
      balanceBtnText = `⚖️ Баланс: ${diff} ккал 🟢`;
    } else if (diff > 0) {
      balanceBtnText = `⚖️ Баланс: +${diff} ккал 🔴`;
    } else {
      balanceBtnText = `⚖️ Баланс: 0 ккал ⚪`;
    }
  }

  keyboard.text(balanceBtnText).row();

  // Row 2: Two buttons in a row for Google Fit & FatSecret
  const googleBtnText = isGoogleConnected ? 'Google Fit ✅' : '🔗 Google Fit';
  const fatsecretBtnText = isFatSecretConnected ? 'FatSecret ✅' : '🔗 FatSecret';

  keyboard
    .text(googleBtnText)
    .text(fatsecretBtnText)
    .row();

  // Row 3: Refresh button
  keyboard.text('🔄 Обновить баланс');

  keyboard.resized().persistent();
  return keyboard;
}

// Handle /start, /help, /menu commands
bot.command(['start', 'help', 'menu'], async (ctx) => {
  const userId = ctx.from.id;
  const keyboard = await buildPersistentKeyboard(userId);

  const text =
`📊 *Энергетический баланс (Amazfit + FatSecret)*

Используйте кнопки на панели внизу экрана 👇`;

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
});

// Handle balance calculation
async function sendBalanceReport(ctx) {
  const userId = ctx.from.id;

  try {
    const [consumedRes, burnedRes] = await Promise.all([
      getCaloriesConsumedToday(userId),
      getCaloriesBurnedToday(userId),
    ]);

    if (!consumedRes.success || !burnedRes.success) {
      const report = await getDailyEnergyBalanceReport(userId);
      const keyboard = await buildPersistentKeyboard(userId);
      return ctx.reply(report.text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }

    const consumed = consumedRes.calories;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const message = formatEnergyBalance(consumed, burned);
    const keyboard = await buildPersistentKeyboard(userId, { consumed, burned, diff });

    await ctx.reply(message, {
      reply_markup: keyboard,
    });
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
`⌚ *Google Fit (Amazfit) подключен ✅*

• *Синхронизация:* Сожженные калории за сегодня
• *Последнее обновление:* ${lastSync}

Чтобы сменить Google аккаунт, нажмите кнопку ниже:`;

    inlineKeyboard.text('❌ Отключить Google Fit', 'disconnect_google');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;
    const text =
`⌚ *Google Fit (Amazfit) не подключен*

Нажмите кнопку ниже для авторизации:`;

    inlineKeyboard.url('🔗 Войти в Google Fit', authUrl);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard,
    });
  }
}

// Handle FatSecret button press on bottom keyboard
async function sendFatSecretStatus(ctx) {
  const userId = ctx.from.id;
  const fatsecretData = await getUserServiceData(userId, 'fatsecret');
  const isConnected = !!(fatsecretData?.user_token || fatsecretData?.auth_token || fatsecretData?.access_token || config.fatsecret.accessToken);

  const inlineKeyboard = new InlineKeyboard();

  if (isConnected) {
    const lastSync = fatsecretData?.updated_at ? new Date(fatsecretData.updated_at).toLocaleString('ru-RU', { timeZone: config.app.timezone }) : 'Ранее';
    const text =
`🥗 *FatSecret подключен ✅*

• *Синхронизация:* Дневник питания и съеденные калории
• *Последнее обновление:* ${lastSync}

Чтобы сменить аккаунт FatSecret, нажмите кнопку ниже:`;

    inlineKeyboard.text('❌ Отключить FatSecret', 'disconnect_fatsecret');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/fatsecret/start?userId=${userId}`;
    const text =
`🥗 *FatSecret не подключен*

Нажмите кнопку ниже для подключения дневника:`;

    inlineKeyboard.url('🔗 Подключить FatSecret', authUrl);

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard,
    });
  }
}

// Command & button handlers
bot.command(['balance', 'today'], sendBalanceReport);
bot.command('auth', async (ctx) => {
  await sendGoogleFitStatus(ctx);
  await sendFatSecretStatus(ctx);
});

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

// Inline Callback: disconnect_fatsecret
bot.callbackQuery('disconnect_fatsecret', async (ctx) => {
  const userId = ctx.from.id;
  await deleteUserServiceData(userId, 'fatsecret');
  await ctx.answerCallbackQuery({ text: 'FatSecret отключен' });
  const keyboard = await buildPersistentKeyboard(userId);
  await ctx.reply('🗑️ *FatSecret успешно отключен.*', {
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
  if (text.includes('FatSecret')) {
    return sendFatSecretStatus(ctx);
  }
  if (text.includes('Обновить') || text.includes('обновить')) {
    const keyboard = await buildPersistentKeyboard(ctx.from.id);
    return ctx.reply('🔄 Клавиатура обновлена.', { reply_markup: keyboard });
  }

  const keyboard = await buildPersistentKeyboard(ctx.from.id);
  await ctx.reply('Выберите действие на клавиатуре внизу 👇', { reply_markup: keyboard });
});

module.exports = bot;
