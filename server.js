const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Basic config
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

console.log('🚀 Starting bot...');
console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('Production mode:', isProduction);

// App setup
const app = express();
app.use(express.json());

// Bot setup - Simple test
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,
  webHook: isProduction 
}) : null;

if (!bot) {
  console.error('❌ BOT_TOKEN missing!');
  process.exit(1);
}

// URL for webhook
let APP_URL;
if (process.env.RENDER_EXTERNAL_URL) {
  APP_URL = process.env.RENDER_EXTERNAL_URL;
} else if (process.env.RENDER_SERVICE_NAME) {
  APP_URL = `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
} else {
  APP_URL = `http://localhost:${PORT}`;
}

console.log('App URL:', APP_URL);

// Webhook setup for production
if (isProduction && bot) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  const webhookUrl = `${APP_URL}${webhookPath}`;
  
  console.log('Setting webhook:', webhookUrl);
  
  bot.setWebHook(webhookUrl)
    .then(() => {
      console.log('✅ Webhook set successfully');
    })
    .catch(err => {
      console.error('❌ Webhook failed:', err.message);
    });
  
  // Webhook endpoint
  app.post(webhookPath, (req, res) => {
    console.log('📨 Webhook received:', JSON.stringify(req.body, null, 2));
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('Webhook processing error:', error);
      res.sendStatus(500);
    }
  });
} else {
  console.log('🔄 Using polling mode');
}

// Simple test commands
if (bot) {
  // Error handling
  bot.on('polling_error', error => {
    console.error('Polling error:', error.message);
  });

  bot.on('webhook_error', error => {
    console.error('Webhook error:', error.message);
  });

  // Test command
  bot.onText(/\/start/, async (msg) => {
    console.log('📱 Received /start from:', msg.from.username || msg.from.first_name);
    
    const chatId = msg.chat.id;
    const testMessage = `🤖 *BOT IS WORKING!* 

✅ Deployment successful
✅ Webhook active
✅ Ready for commands

*Available commands:*
/test - Simple test
/ping - Check response
/debug - Debug info

🎉 Bot is live and responding!`;

    try {
      await bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });
      console.log('✅ Message sent successfully');
    } catch (error) {
      console.error('❌ Send message error:', error);
    }
  });

  bot.onText(/\/test/, async (msg) => {
    console.log('📱 Received /test');
    const chatId = msg.chat.id;
    
    try {
      await bot.sendMessage(chatId, '✅ Test successful! Bot is responding perfectly.');
      console.log('✅ Test response sent');
    } catch (error) {
      console.error('❌ Test error:', error);
    }
  });

  bot.onText(/\/ping/, async (msg) => {
    console.log('📱 Received /ping');
    const chatId = msg.chat.id;
    
    try {
      const now = new Date();
      await bot.sendMessage(chatId, `🏓 Pong!\n\nTime: ${now.toLocaleString('en-IN')}\nBot is alive and responding!`);
      console.log('✅ Ping response sent');
    } catch (error) {
      console.error('❌ Ping error:', error);
    }
  });

  bot.onText(/\/debug/, async (msg) => {
    console.log('📱 Received /debug');
    const chatId = msg.chat.id;
    
    try {
      const debugInfo = `🔧 *DEBUG INFO*

*Environment:*
• Production: ${isProduction}
• Port: ${PORT}
• URL: ${APP_URL}

*Bot Status:*
• Token: ${BOT_TOKEN ? 'Set' : 'Missing'}
• Mode: ${isProduction ? 'Webhook' : 'Polling'}

*Server Time:*
${new Date().toLocaleString('en-IN')}`;

      await bot.sendMessage(chatId, debugInfo, { parse_mode: 'Markdown' });
      console.log('✅ Debug info sent');
    } catch (error) {
      console.error('❌ Debug error:', error);
    }
  });

  console.log('✅ Bot commands registered');
} else {
  console.error('❌ Bot not initialized');
}

// Health check endpoint
app.get('/', (req, res) => {
  console.log('🌐 Health check accessed');
  res.json({
    status: 'Bot is running',
    timestamp: new Date().toISOString(),
    botToken: !!BOT_TOKEN,
    production: isProduction,
    url: APP_URL
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    bot: !!bot,
    token: !!BOT_TOKEN,
    mode: isProduction ? 'webhook' : 'polling'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`🤖 Bot status: ${bot ? 'Active' : 'Inactive'}`);
  console.log(`📱 Mode: ${isProduction ? 'Webhook (Production)' : 'Polling (Development)'}`);
  console.log('✅ Ready to receive messages!');
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
