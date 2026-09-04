const { Bot } = require('grammy');
const config = require('./config');
const { getDailyEnergyBalanceReport } = require('./services/balance');

const botToken = config.telegram.botToken || '1234567890:AAFakeTokenForModuleInitBeforeEnvConfigured';
const bot = new Bot(botToken);

// Handle /start command
bot.command('start', async (ctx) => {
  const welcomeText = 
`👋 *Привет! Я бот для расчета суточного энергетического баланса.*

Я собираю данные за сегодня:
• 📥 *Приход (калории):* из вашего дневника FatSecret
• 📤 *Расход (калории):* из Google Fit / Health Connect (синхронизировано с Amazfit)

📌 *Доступные команды:*
/balance — Показать текущий энергетический баланс
/status — Проверить статус подключения API
/help — Справка по настройке и использованию`;

  await ctx.reply(welcomeText, { parse_mode: 'Markdown' });
});

// Handle /help command
bot.command('help', async (ctx) => {
  const helpText =
`ℹ️ *Справка по боту:*

1. Отправьте команду /balance в любое время, чтобы узнать текущий баланс за день.
2. Формула расчета: \`Баланс = Приход - Расход\`
   • Со знаком \`+\` — профицит калорий (съели больше, чем потратили)
   • Со знаком \`-\` — дефицит калорий (потратили больше, чем съели)

⚙️ *Источники данных:*
• *FatSecret*: съеденные блюда за текущие сутки
• *Google Fit*: суммарно сожженные калории (BMR + активные калории с браслета/часов Amazfit)`;

  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Handle /status command
bot.command('status', async (ctx) => {
  const fsConfigured = !!(config.fatsecret.accessToken || (config.fatsecret.clientId && config.fatsecret.clientSecret));
  const gfConfigured = !!(config.googleFit.clientId && config.googleFit.clientSecret && config.googleFit.refreshToken);

  const statusText =
`🔍 *Статус конфигурации API:*

• *FatSecret API:* ${fsConfigured ? '✅ Настроен' : '❌ Не настроен (задайте FATSECRET_CLIENT_ID / SECRET)'}
• *Google Fit API:* ${gfConfigured ? '✅ Настроен' : '❌ Не настроен (задайте GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN)'}
• *Часовой пояс:* \`${config.app.timezone}\``;

  await ctx.reply(statusText, { parse_mode: 'Markdown' });
});

// Handle /balance and /today commands
async function handleBalanceCommand(ctx) {
  try {
    const sentMsg = await ctx.reply('⏳ Получаю данные из FatSecret и Google Fit...');
    const report = await getDailyEnergyBalanceReport();
    
    // Edit the loading message or send a new one
    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        sentMsg.message_id,
        report.text,
        { parse_mode: report.success ? undefined : 'Markdown' }
      );
    } catch {
      await ctx.reply(report.text, {
        parse_mode: report.success ? undefined : 'Markdown',
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
  await ctx.reply('Используйте команду /balance для расчета энергетического баланса.');
});

module.exports = bot;
