const { Bot, InlineKeyboard } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport } = require('./services/balance');
const { getUserServiceData, deleteUserServiceData } = require('./services/db');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

/**
 * Builds inline authorization keyboard for a specific user
 */
function getAuthKeyboard(userId) {
  const keyboard = new InlineKeyboard();
  const googleAuthUrl = `${config.app.appUrl}/api/auth/google/start?userId=${userId}`;
  const fatsecretAuthUrl = `${config.app.appUrl}/api/auth/fatsecret/start?userId=${userId}`;

  keyboard
    .url('🔗 Подключить Google Fit (Amazfit)', googleAuthUrl)
    .row()
    .url('🔗 Подключить FatSecret', fatsecretAuthUrl);

  return keyboard;
}

// Handle /start command
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  const [googleData, fatsecretData] = await Promise.all([
    getUserServiceData(userId, 'google'),
    getUserServiceData(userId, 'fatsecret'),
  ]);

  const isGoogleConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);
  const isFatSecretConnected = !!(fatsecretData?.access_token || config.fatsecret.accessToken || (config.fatsecret.clientId && config.fatsecret.clientSecret));

  let text = 
`👋 *Привет! Я бот для расчета суточного энергетического баланса.*

Я собираю данные за сегодня:
• 📥 *Приход (калории):* из вашего дневника FatSecret
• 📤 *Расход (калории):* из Google Fit / Health Connect (синхронизировано с Amazfit)

📌 *Доступные команды:*
/balance — Показать текущий энергетический баланс
/auth — Подключить или переподключить сервисы
/status — Проверить статус подключения
/help — Справка`;

  if (!isGoogleConnected || !isFatSecretConnected) {
    text += `\n\n⚠️ *Для начала работы подключите ваши аккаунты по кнопкам ниже:*`;
    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: getAuthKeyboard(userId),
    });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  }
});

// Handle /auth command
bot.command(['auth', 'login'], async (ctx) => {
  const userId = ctx.from.id;
  await ctx.reply(
    '🔐 *Авторизация сервисов:*\nНажмите на кнопки ниже, чтобы войти под своим Google и FatSecret аккаунтом:',
    {
      parse_mode: 'Markdown',
      reply_markup: getAuthKeyboard(userId),
    }
  );
});

// Handle /logout or /disconnect
bot.command(['logout', 'disconnect'], async (ctx) => {
  const userId = ctx.from.id;
  await deleteUserServiceData(userId, 'all');
  await ctx.reply('🗑️ Ваши подключенные аккаунты Google Fit и FatSecret успешно отвязаны.');
});

// Handle /status command
bot.command('status', async (ctx) => {
  const userId = ctx.from.id;
  const [googleData, fatsecretData] = await Promise.all([
    getUserServiceData(userId, 'google'),
    getUserServiceData(userId, 'fatsecret'),
  ]);

  const isGoogleConnected = !!(googleData?.refresh_token || config.googleFit.refreshToken);
  const isFatSecretConnected = !!(fatsecretData?.access_token || config.fatsecret.accessToken || (config.fatsecret.clientId && config.fatsecret.clientSecret));

  const statusText =
`🔍 *Статус подключения для вашего профиля (ID: ${userId}):*

• *Google Fit (Amazfit):* ${isGoogleConnected ? '✅ Подключен' : '❌ Не подключен'}
• *FatSecret:* ${isFatSecretConnected ? '✅ Подключен' : '❌ Не подключен'}
• *Часовой пояс:* \`${config.app.timezone}\``;

  const replyMarkup = (!isGoogleConnected || !isFatSecretConnected) ? getAuthKeyboard(userId) : undefined;

  await ctx.reply(statusText, {
    parse_mode: 'Markdown',
    reply_markup: replyMarkup,
  });
});

// Handle /help command
bot.command('help', async (ctx) => {
  const helpText =
`ℹ️ *Справка по боту:*

1. Отправьте команду /balance в любое время, чтобы узнать текущий баланс за день.
2. Формула расчета: \`Баланс = Приход - Расход\`
   • Со знаком \`+\` — профицит калорий
   • Со знаком \`-\` — дефицит калорий

⚙️ *Команды настройки:*
/auth — Авторизоваться в Google Fit и FatSecret через браузер
/status — Проверить статус привязки аккаунтов
/logout — Отвязать аккаунты`;

  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Handle /balance and /today commands
async function handleBalanceCommand(ctx) {
  const userId = ctx.from.id;
  try {
    const sentMsg = await ctx.reply('⏳ Получаю данные из FatSecret и Google Fit...');
    const report = await getDailyEnergyBalanceReport(userId);

    const replyMarkup = !report.success ? getAuthKeyboard(userId) : undefined;
    
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        sentMsg.message_id,
        report.text,
        {
          parse_mode: report.success ? undefined : 'Markdown',
          reply_markup: replyMarkup,
        }
      );
    } catch {
      await ctx.reply(report.text, {
        parse_mode: report.success ? undefined : 'Markdown',
        reply_markup: replyMarkup,
      });
    }
  } catch (error) {
    console.error('Error handling /balance command:', error);
    await ctx.reply('❌ Произошла непредвиденная ошибка при расчете баланса.');
  }
}

bot.command(['balance', 'today'], handleBalanceCommand);

// Fallback message for text messages
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text.trim().toLowerCase();
  if (text === 'баланс' || text === 'balance') {
    return handleBalanceCommand(ctx);
  }
  await ctx.reply('Используйте команду /balance для расчета энергетического баланса или /auth для авторизации.');
});

module.exports = bot;
