const { Bot } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./services/googlefit');
const {
  getUserServiceData,
  deleteUserServiceData,
  getLastMessageId,
  setLastMessageId,
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

// ─── Bottom Reply Keyboard (1 button per row, Обновить is blue at very bottom)
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

  // Order: 1. Balance, 2. Google Fit, 3. Обновить баланс (at the very bottom, blue)
  const keyboard = {
    keyboard: [
      [{ text: balanceBtnText, ...(balanceStyle ? { style: balanceStyle } : {}) }],
      [{ text: googleBtnText, ...(isGoogleConnected ? { style: 'success' } : { style: 'primary' }) }],
      [{ text: '🔄 Обновить баланс', style: 'primary' }]
    ],
    resize_keyboard: true,
    is_persistent: true,
  };

  return keyboard;
}

// ─── Message management: Send new message FIRST, then delete old ─────────────
async function sendReplaceMessage(ctx, text, extra = {}) {
  const userId = ctx.from.id;

  // 1. Get old message ID from storage
  const oldMsgId = await getLastMessageId(userId);

  // 2. Send the new message with reply_markup attached directly
  const newMsg = await ctx.reply(text, extra);

  // 3. Immediately store new message ID
  if (newMsg?.message_id) {
    await setLastMessageId(userId, newMsg.message_id);
  }

  // 4. AFTER new message is visible, delete previous bot message
  if (oldMsgId) {
    try {
      await ctx.api.deleteMessage(ctx.chat.id, Number(oldMsgId));
    } catch (_) {}
  }

  return newMsg;
}

// ─── /start, /help, /menu ────────────────────────────────────────────────────
bot.command(['start', 'help', 'menu'], async (ctx) => {
  await cleanUserMessage(ctx);
  await sendBalanceReport(ctx);
});

// ─── Balance report (Atomic Replace Message) ──────────────────────────────────
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
      return sendReplaceMessage(ctx, report.text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    }

    const consumed = consumedRes.success ? consumedRes.calories : 0;
    const burned = burnedRes.calories;
    const diff = consumed - burned;

    const message = formatEnergyBalance(consumed, burned);
    const keyboard = await buildPersistentKeyboard(userId, { consumed, burned, diff });

    // Send new message with updated reply keyboard, THEN delete previous message
    await sendReplaceMessage(ctx, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error('Error calculating balance:', error);
    const keyboard = await buildPersistentKeyboard(userId);
    await sendReplaceMessage(ctx, '❌ Ошибка расчета баланса: ' + (error.message || ''), {
      reply_markup: keyboard,
    });
  }
}

// ─── Google Fit status ────────────────────────────────────────────────────────
async function sendGoogleFitStatus(ctx) {
  const userId = ctx.from.id;
  await cleanUserMessage(ctx);

  const googleData = await getUserServiceData(userId, 'google');
  const isConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);
  const keyboard = await buildPersistentKeyboard(userId);

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
    const inlineMarkup = inlineKb([
      [btn(`🟢 Аккаунт: ${email}`, { callback_data: 'account_active_info', style: 'success' })],
      [btn('🔴 Отключить Google Fit',  { callback_data: 'disconnect_google', style: 'danger' })],
    ]);

    // Send message with inline buttons
    await sendReplaceMessage(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: inlineMarkup,
    });

    // Ensure persistent reply keyboard remains visible
    await ctx.reply('👇', { reply_markup: keyboard }).then(msg => {
      ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    }).catch(() => {});
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;

    const text =
`⌚ <b>Google Fit не подключен</b>

Нажмите синюю кнопку ниже для авторизации под вашим Google-аккаунтом:`;

    // 🔵 blue "connect" button
    const inlineMarkup = inlineKb([
      [btn('🔵 Войти через Google', { url: authUrl, style: 'primary' })],
    ]);

    await sendReplaceMessage(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: inlineMarkup,
    });

    // Ensure persistent reply keyboard remains visible
    await ctx.reply('👇', { reply_markup: keyboard }).then(msg => {
      ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});
    }).catch(() => {});
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
  await sendReplaceMessage(ctx, '🗑️ <b>Google Fit успешно отключен.</b> Вы можете привязать другой аккаунт.', {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
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
  await sendReplaceMessage(ctx, 'Выберите действие на клавиатуре внизу 👇', {
    reply_markup: keyboard,
  });
});

module.exports = bot;
