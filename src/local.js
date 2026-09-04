const bot = require('./bot');
const config = require('./config');

if (!config.telegram.botToken) {
  console.error('❌ Error: TELEGRAM_BOT_TOKEN is not set in your .env file.');
  process.exit(1);
}

console.log('🚀 Starting Telegram Energy Balance Bot in Long Polling mode for local testing...');

bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Bot @${botInfo.username} successfully started and listening for commands!`);
  },
}).catch((err) => {
  console.error('❌ Error starting bot:', err);
});
