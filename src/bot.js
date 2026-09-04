const { Bot } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport, formatEnergyBalance } = require('./services/balance');
const { getCaloriesBurnedToday, getCaloriesConsumedFromGoogleFit } = require('./services/googlefit');
const {
  getUserServiceData,
  deleteUserServiceData,
  getLastMessageId,
  setLastMessageId,
  getPinnedMessageId,
  setPinnedMessageId,
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

// ─── Pinned status message ────────────────────────────────────────────────────

/**
 * Builds text + inline keyboard for the pinned balance message.
 * Shows a stub when Google Fit is not connected, otherwise shows the balance.
 *
 * @param {boolean} isGoogleConnected
 * @param {{ consumed: number, burned: number, diff: number }|null} balanceData
 * @returns {{ text: string, reply_markup: object }}
 */
function buildPinnedMessageContent(isGoogleConnected, balanceData = null) {
  if (!isGoogleConnected) {
    return {
      text:
        `📊 <b>Энергетический баланс</b>\n\n` +
        `<blockquote>⚙️ Для отображения баланса необходимо подключить <b>Google Fit</b>.\n` +
        `Нажмите кнопку «🔵 Подключить Google Fit» на клавиатуре ниже.</blockquote>`,
      reply_markup: inlineKb([
        [btn('⚡ Баланс энергии: — ккал', { callback_data: 'pinned_hint' })],
      ]),
    };
  }

  const { consumed = 0, burned = 0, diff = 0 } = balanceData || {};
  let sign = diff > 0 ? '+' : '';
  let statusIcon = diff > 0 ? '🔴' : diff < 0 ? '🟢' : '⚪';
  let statusLabel = diff > 0 ? 'профицит' : diff < 0 ? 'дефицит' : 'норма';

  return {
    text:
      `📊 <b>Энергетический баланс</b>\n\n` +
      `<code>Приход:  ${String(consumed + ' ккал').padStart(11)}\n` +
      `Расход:  ${String(burned + ' ккал').padStart(11)}\n` +
      `──────────────────────\n` +
      `Итог:    ${String(sign + diff + ' ккал').padStart(11)}</code>\n\n` +
      `<blockquote>${statusIcon} ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}: <b>${sign}${diff} ккал</b></blockquote>`,
    reply_markup: inlineKb([
      [btn(`⚡ Баланс энергии: ${sign}${diff} ккал`, { callback_data: 'pinned_hint' })],
    ]),
  };
}

/**
 * Creates (on first call) or edits the pinned balance message.
 * The pinned message is never deleted — it lives at the top of the chat.
 *
 * @param {object} ctx  grammy context
 * @param {boolean} isGoogleConnected
 * @param {{ consumed: number, burned: number, diff: number }|null} balanceData
 */
async function ensurePinnedMessage(ctx, isGoogleConnected, balanceData = null) {
  const userId = ctx.from.id;
  const { text, reply_markup } = buildPinnedMessageContent(isGoogleConnected, balanceData);
  const existingId = await getPinnedMessageId(userId);

  if (existingId) {
    // Try to edit the existing pinned message
    try {
      await ctx.api.editMessageText(ctx.chat.id, Number(existingId), text, {
        parse_mode: 'HTML',
        reply_markup,
      });
      return; // successfully updated — done
    } catch (e) {
      // Message was deleted by user or Telegram — fall through to create a new one
    }
  }

  // Create a fresh pinned message and pin it
  const msg = await ctx.api.sendMessage(ctx.chat.id, text, {
    parse_mode: 'HTML',
    reply_markup,
  });
  await setPinnedMessageId(userId, msg.message_id);

  try {
    await ctx.api.pinChatMessage(ctx.chat.id, msg.message_id, {
      disable_notification: true,
    });
  } catch (_) {
    // Pinning may fail in private chats without admin rights — silently ignore
  }
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
      // Google Fit not connected — update pinned message with stub
      await ensurePinnedMessage(ctx, false);
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

    // Update pinned message with actual balance
    await ensurePinnedMessage(ctx, true, { consumed, burned, diff });

    const latestDataMillis = Math.max(consumedRes.lastModifiedMillis || 0, burnedRes.lastModifiedMillis || 0);
    let dataTimeStr = null;
    if (latestDataMillis > 0) {
      dataTimeStr = new Intl.DateTimeFormat('ru-RU', {
        timeZone: config.app.timezone || 'Europe/Moscow',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(latestDataMillis));
    }

    const message = formatEnergyBalance(consumed, burned, dataTimeStr);
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
• <b>Последнее обновление:</b> ${lastSync}`;

    // Inline buttons under the message: Back (blue) and Disconnect (red)
    const inlineMarkup = inlineKb([
      [
        btn('← Назад', { callback_data: 'back_to_balance', style: 'primary' }),
        btn('🔴 Выйти из аккаунта', { callback_data: 'disconnect_google', style: 'danger' }),
      ],
    ]);

    await sendReplaceMessage(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: inlineMarkup,
    });
  } else {
    const authUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;

    const text =
`⌚ <b>Google Fit не подключен</b>

Нажмите синюю кнопку ниже для авторизации под вашим Google-аккаунтом:`;

    const inlineMarkup = inlineKb([
      [btn('🔵 Войти через Google', { url: authUrl, style: 'primary' })],
      [btn('← Назад к балансу', { callback_data: 'back_to_balance' })],
    ]);

    await sendReplaceMessage(ctx, text, {
      parse_mode: 'HTML',
      reply_markup: inlineMarkup,
    });
  }
}

// ─── Command & text handlers ──────────────────────────────────────────────────
bot.command(['balance', 'today'], sendBalanceReport);
bot.command('auth', sendGoogleFitStatus);

// Inline callbacks
bot.callbackQuery('pinned_hint', async (ctx) => {
  await ctx.answerCallbackQuery({ text: '📊 Это закреплённый баланс. Нажмите «🔄 Обновить баланс» для актуальных данных.' });
});

bot.callbackQuery('back_to_balance', async (ctx) => {
  await ctx.answerCallbackQuery();
  return sendBalanceReport(ctx);
});

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
