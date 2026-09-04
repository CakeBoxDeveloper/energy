const { Bot } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./services/googlefit');
const { getUserServiceData, deleteUserServiceData } = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

// ─── Raw inline keyboard helpers (like Barokko) ───────────────────────────────
function btn(text, { callback_data, url, style } = {}) {
  const b = { text };
  if (callback_data) b.callback_data = callback_data;
  if (url)           b.url = url;
  if (style)         b.style = style;
  return b;
}

function inlineKb(rows) {
  return { inline_keyboard: rows };
}

// ─── Bottom Reply Keyboard ────────────────────────────────────────────────────
async function buildPersistentKeyboard(userId, balanceSummary = null) {
  const googleData = await getUserServiceData(userId, 'google');
  const isGoogleConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  let balanceBtnText = '📊 Показать баланс';
  let balanceStyle = undefined;

  if (balanceSummary) {
    const { diff } = balanceSummary;
    if (diff < 0) {
      balanceBtnText = `⚖️ Баланс (${diff} ккал) 🟢 Дефицит`;
      balanceStyle = 'success';
    } else if (diff > 0) {
      balanceBtnText = `⚖️ Баланс (+${diff} ккал) 🔴 Профицит`;
      balanceStyle = 'danger';
    } else {
      balanceBtnText = `⚖️ Баланс (0 ккал) ⚪ Норма`;
    }
  }

  const googleBtnText = isGoogleConnected ? 'Google Fit ✅' : '🔵 Подключить Google Fit';

  // ReplyKeyboardMarkup JSON with native style support
  const keyboard = {
    keyboard: [
      [{ text: balanceBtnText, ...(balanceStyle ? { style: balanceStyle } : {}) }],
      [
        { text: googleBtnText, ...(isGoogleConnected ? { style: 'success' } : { style: 'primary' }) },
        { text: '🔄 Обновить баланс' }
      ]
    ],
    resize_keyboard: true,
    is_persistent: true,
  };

  return keyboard;
}

// ─── /start, /help, /menu ────────────────────────────────────────────────────
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

// ─── Balance report ───────────────────────────────────────────────────────────
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
      return ctx.reply(report.text, { parse_mode: 'HTML', reply_markup: keyboard });
    }

    const consumed = consumedRes.success ? consumedRes.calories : 0;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const message = formatEnergyBalance(consumed, burned);
    const keyboard = await buildPersistentKeyboard(userId, { consumed, burned, diff });

    // Colored inline button: green for deficit, red for surplus
    const balanceLabel =
      diff < 0 ? `🟢 Дефицит: ${diff} ккал` :
      diff > 0 ? `🔴 Профицит: +${diff} ккал` :
                 `⚪ Баланс: 0 ккал`;
    const balanceBtnStyle = diff < 0 ? 'success' : diff > 0 ? 'danger' : undefined;

    const replyMarkup = inlineKb([
      [btn(balanceLabel, { callback_data: 'refresh_balance_inline', style: balanceBtnStyle })],
    ]);

    // Send report with colored inline button
    await ctx.reply(message, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });

    // Update bottom persistent keyboard with fresh balance & colors
    await ctx.reply('Клавиатура обновлена 👇', {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Error calculating balance:', error);
    await ctx.reply('❌ Ошибка расчета баланса: ' + (error.message || ''));
  }
}

// ─── Google Fit status ────────────────────────────────────────────────────────
async function sendGoogleFitStatus(ctx) {
  const userId = ctx.from.id;
  const googleData = await getUserServiceData(userId, 'google');
  const isConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);

  if (isConnected) {
    const lastSync = googleData?.updated_at
      ? new Date(googleData.updated_at).toLocaleString('ru-RU', { timeZone: config.app.timezone })
      : 'Ранее';
    const email = googleData?.email || 'slardaran@gmail.com';

    const text =
`⌚ <b>Google Fit подключен ✅</b>

<blockquote>📧 <b>Подключенный аккаунт:</b> ${email}</blockquote>

• <b>Расход калорий:</b> с часов (Amazfit / Zepp)
• <b>Приход калорий:</b> из дневника питания (FatSecret)
• <b>Последнее обновление:</b> ${lastSync}

Чтобы сменить Google-аккаунт, нажмите красную кнопку отключения:`;

    // 🟢 green "account" button + 🔴 red "disconnect" button
    const replyMarkup = inlineKb([
      [btn(`🟢 Аккаунт: ${email}`, { callback_data: 'account_active_info', style: 'success' })],
      [btn('🔴 Отключить Google Fit',  { callback_data: 'disconnect_google', style: 'danger' })],
    ]);

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;

    const text =
`⌚ <b>Google Fit не подключен</b>

Нажмите синюю кнопку ниже для авторизации под вашим Google-аккаунтом:`;

    // 🔵 blue "connect" button
    const replyMarkup = inlineKb([
      [btn('🔵 Войти через Google', { url: authUrl, style: 'primary' })],
    ]);

    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
  }
}

// ─── Command & text handlers ──────────────────────────────────────────────────
bot.command(['balance', 'today'], sendBalanceReport);
bot.command('auth', sendGoogleFitStatus);

// Inline callbacks
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

// Bottom keyboard text listener
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
