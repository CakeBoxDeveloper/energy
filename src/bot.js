const { Bot } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./services/googlefit');
const {
  getUserServiceData,
  deleteUserServiceData,
  getPinnedMessageId,
  setPinnedMessageId
} = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

// ─── Delete user's incoming command message to keep chat clean ────────────────
async function cleanUserMessage(ctx) {
  if (ctx.message?.message_id) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    } catch (_) {}
  }
}

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

// ─── Bottom Reply Keyboard (1 button per row, Обновить is blue) ───────────────
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

  // ReplyKeyboardMarkup: 1 button per row, "🔄 Обновить баланс" is style 'primary' (blue)
  const keyboard = {
    keyboard: [
      [{ text: balanceBtnText, ...(balanceStyle ? { style: balanceStyle } : {}) }],
      [{ text: '🔄 Обновить баланс', style: 'primary' }],
      [{ text: googleBtnText, ...(isGoogleConnected ? { style: 'success' } : { style: 'primary' }) }]
    ],
    resize_keyboard: true,
    is_persistent: true,
  };

  return keyboard;
}

// ─── Pinned Status Message (Edited in-place without deleting chat) ─────────────
async function updatePinnedStatusMessage(ctx, text, replyMarkup = null) {
  const userId = ctx.from.id;
  const pinnedId = await getPinnedMessageId(userId);

  if (pinnedId) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, Number(pinnedId), text, {
        parse_mode: 'HTML',
        reply_markup: replyMarkup || undefined,
      });
      return;
    } catch (e) {
      // If message was deleted or cannot be edited, fall through to create new
    }
  }

  // Send initial message and pin it
  const sent = await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: replyMarkup || undefined,
  });

  if (sent?.message_id) {
    await setPinnedMessageId(userId, sent.message_id);
    try {
      await ctx.api.pinChatMessage(ctx.chat.id, sent.message_id, { disable_notification: true });
    } catch (_) {}
  }
}

// ─── /start, /help, /menu ────────────────────────────────────────────────────
bot.command(['start', 'help', 'menu'], async (ctx) => {
  await cleanUserMessage(ctx);
  await sendBalanceReport(ctx);
});

// ─── Balance report (Edits pinned status message) ─────────────────────────────
async function sendBalanceReport(ctx) {
  const userId = ctx.from.id;
  await cleanUserMessage(ctx);

  try {
    const [consumedRes, burnedRes] = await Promise.all([
      getCaloriesConsumedFromGoogleFit(userId),
      getCaloriesBurnedToday(userId),
    ]);

    if (!burnedRes.success) {
      const report = await getDailyEnergyBalanceReport(userId);
      const keyboard = await buildPersistentKeyboard(userId);
      await updatePinnedStatusMessage(ctx, report.text);
      await ctx.reply('⚙️ Панель обновлена', { reply_markup: keyboard });
      return;
    }

    const consumed = consumedRes.success ? consumedRes.calories : 0;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const message = formatEnergyBalance(consumed, burned);
    const keyboard = await buildPersistentKeyboard(userId, { consumed, burned, diff });

    // Edit the pinned status message in place
    await updatePinnedStatusMessage(ctx, message);

    // Update bottom keyboard seamlessly
    await ctx.reply('⚡', { reply_markup: keyboard }).then(msg => {
      // Delete temporary delivery message immediately so no junk remains
      ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    }).catch(() => {});
  } catch (error) {
    console.error('Error calculating balance:', error);
    await updatePinnedStatusMessage(ctx, '❌ Ошибка расчета баланса: ' + (error.message || ''));
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

    await updatePinnedStatusMessage(ctx, text, replyMarkup);
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;

    const text =
`⌚ <b>Google Fit не подключен</b>

Нажмите синюю кнопку ниже для авторизации под вашим Google-аккаунтом:`;

    // 🔵 blue "connect" button
    const replyMarkup = inlineKb([
      [btn('🔵 Войти через Google', { url: authUrl, style: 'primary' })],
    ]);

    await updatePinnedStatusMessage(ctx, text, replyMarkup);
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
  await updatePinnedStatusMessage(ctx, '🗑️ <b>Google Fit успешно отключен.</b> Вы можете привязать другой аккаунт.');
  await ctx.reply('⚡', { reply_markup: keyboard }).then(msg => {
    ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
  }).catch(() => {});
});

// Bottom keyboard text listener
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim();
  await cleanUserMessage(ctx);

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
  await ctx.reply('⚡', { reply_markup: keyboard }).then(msg => {
    ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
  }).catch(() => {});
});

module.exports = bot;
