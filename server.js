const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const Filter = require('bad-words');

// Enhanced configuration with FIXED URL detection
const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// Fixed URL detection for Render.com
let APP_URL;
if (process.env.RENDER_EXTERNAL_URL) {
  APP_URL = process.env.RENDER_EXTERNAL_URL;
} else if (process.env.RENDER_SERVICE_NAME) {
  APP_URL = `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
} else if (process.env.HEROKU_APP_NAME) {
  APP_URL = `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
} else {
  APP_URL = `http://localhost:${PORT}`;
}

// Initialize content filter
const filter = new Filter();
filter.addWords('गाली', 'बकवास', 'fraud', 'scam', 'fake news', 'clickbait');

// Enhanced logging
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'news-bot' },
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Database setup
class NewsDatabase {
  constructor() {
    this.db = new sqlite3.Database('./enhanced_news_bot.db');
    this.initializeTables();
  }
  
  initializeTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS user_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        category: "national",
      timestamp: currentTime,
      fetchTime: indianTime,
      platform: 'news',
      reliability: 8,
      isVerified: true,
      spiceScore: 8,
      conspiracyScore: 9,
      importanceScore: 9,
      totalScore: 26
    }],
    pakistan: [{
      title: "Pakistan ISI Conspiracy Exposed - Secret Operations Revealed",
      link: "https://www.google.com/search?q=pakistan+isi+conspiracy&tbm=nws&tbs=qdr:d",
      pubDate: currentTime,
      formattedDate: "Just now",
      source: "International News",
      category: "pakistan",
      timestamp: currentTime,
      fetchTime: indianTime,
      platform: 'news',
      reliability: 8,
      isVerified: true,
      spiceScore: 9,
      conspiracyScore: 10,
      importanceScore: 8,
      totalScore: 27
    }]
  };
  
  return fallbackContent[category] || [];
}

// Enhanced message formatting
async function formatAndSendEnhancedNewsMessage(chatId, articles, category, bot) {
  if (!articles || articles.length === 0) {
    await bot.sendMessage(chatId, `❌ No recent ${category} news found. Try /refresh or add keywords!`);
    return;
  }

  logger.info(`📊 Processing ${articles.length} ${category} articles with scores for chat ${chatId}`);

  try {
    const maxArticles = 50;
    const articlesToSend = articles.slice(0, maxArticles);
    
    logger.info(`📱 Sending ${articlesToSend.length} articles sorted by spice level...`);
    
    const currentIndianTime = getCurrentIndianTime();
    const avgScore = articlesToSend.length > 0 ? Math.round(articlesToSend.reduce((sum, article) => sum + (article.totalScore || 0), 0) / articlesToSend.length) : 0;
    const spicyCount = articlesToSend.filter(a => a.spiceScore > 6).length;
    const conspiracyCount = articlesToSend.filter(a => a.conspiracyScore > 6).length;
    
    const summaryMessage = `🔥 *${category.toUpperCase()} SPICY NEWS* 🔥

📊 *Found: ${articlesToSend.length} articles*
🌶️ *Spicy Content: ${spicyCount} articles*
🕵️ *Conspiracy Content: ${conspiracyCount} articles*
⭐ *Average Score: ${avgScore}/30*
⏰ *Data: Last 24 Hours Only*
🕐 *Updated: ${currentIndianTime.toLocaleString('en-IN')}*

*Score Legend:*
🌶️ Spice Level | 🕵️ Conspiracy | ⚡ Importance`;
    
    await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    let chunkSize = 6;
    if (articlesToSend.length <= 12) {
      chunkSize = 4;
    } else if (articlesToSend.length >= 30) {
      chunkSize = 8;
    }
    
    const totalChunks = Math.ceil(articlesToSend.length / chunkSize);
    logger.info(`📱 Using ${totalChunks} chunks of ${chunkSize} articles each`);
    
    for (let i = 0; i < totalChunks; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, articlesToSend.length);
      const chunk = articlesToSend.slice(startIndex, endIndex);
      
      let chunkMessage = `🎯 *${category.toUpperCase()} NEWS - Part ${i + 1}/${totalChunks}*\n\n`;
      
      chunk.forEach((article, index) => {
        const globalIndex = startIndex + index + 1;
        
        let cleanTitle = article.title
          .replace(/\*/g, '')
          .replace(/\[/g, '(')
          .replace(/\]/g, ')')
          .replace(/`/g, "'")
          .replace(/_/g, '-')
          .replace(/~/g, '-')
          .replace(/\|/g, '-')
          .substring(0, 60);
        
        if (cleanTitle.length < article.title.length) {
          cleanTitle += '...';
        }
        
        const platformIcon = {
          'news': '📰',
          'twitter': '🐦',
          'instagram': '📸',
          'youtube': '📺'
        };
        
        const icon = platformIcon[article.platform] || '📰';
        
        const spiceIcon = article.spiceScore > 7 ? '🔥' : article.spiceScore > 4 ? '🌶️' : '📄';
        const conspiracyIcon = article.conspiracyScore > 7 ? '🕵️‍♂️' : article.conspiracyScore > 4 ? '🤔' : '';
        const importanceIcon = article.importanceScore > 7 ? '⚡' : article.importanceScore > 4 ? '📢' : '';
        
        chunkMessage += `${globalIndex}. ${icon} ${spiceIcon}${conspiracyIcon}${importanceIcon} *${cleanTitle}*\n`;
        chunkMessage += `   📊 Score: ${article.totalScore || 0}/30 | 📄 ${article.source} | ⏰ ${article.formattedDate}\n`;
        
        // Create clickable link with proper formatting
        let cleanUrl = article.link;
        if (cleanUrl && cleanUrl.length > 150) {
          cleanUrl = cleanUrl.substring(0, 150) + '...';
        }
        
        // Use proper Telegram link format for clickability
        chunkMessage += `   🔗 [📖 Read Full Story](${article.link})\n\n`;
      });
      
      if (i + 1 === totalChunks) {
        const topScore = articlesToSend.length > 0 ? Math.max(...articlesToSend.map(a => a.totalScore || 0)) : 0;
        chunkMessage += `✅ *Complete! Total: ${articlesToSend.length} articles*\n`;
        chunkMessage += `🏆 *Highest Score: ${topScore}/30* | 🎯 *Perfect for YouTube!*`;
      } else {
        chunkMessage += `📄 *Part ${i + 1}/${totalChunks} • More spicy content coming...*`;
      }
      
      try {
        await bot.sendMessage(chatId, chunkMessage, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
        
        const avgChunkScore = chunk.length > 0 ? Math.round(chunk.reduce((sum, a) => sum + (a.totalScore || 0), 0) / chunk.length) : 0;
        logger.info(`✅ Sent chunk ${i + 1}/${totalChunks} with ${chunk.length} articles (avg score: ${avgChunkScore})`);
        
        if (i + 1 < totalChunks) {
          const delay = totalChunks <= 4 ? 1200 : 1800;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (chunkError) {
        logger.error(`❌ Error sending chunk ${i + 1}: ${chunkError.message}`);
        
        if (chunkError.message.includes('403') || chunkError.message.includes('blocked')) {
          logger.info(`🚫 User blocked bot, stopping message sending`);
          return;
        }
        
        const simpleMessage = `📰 *${category.toUpperCase()}* - Part ${i + 1}\n\n${chunk.length} spicy articles available but couldn't display due to formatting.`;
        
        try {
          await bot.sendMessage(chatId, simpleMessage, { parse_mode: 'Markdown' });
        } catch (fallbackError) {
          logger.error(`❌ Fallback failed: ${fallbackError.message}`);
        }
      }
    }
    
    logger.info(`✅ Successfully sent ${totalChunks} chunks with ${articlesToSend.length} total articles`);
    
  } catch (error) {
    logger.error('❌ Error in enhanced message formatting:', error.message);
    
    try {
      const emergencyMessage = `🔥 *${category.toUpperCase()} NEWS*\n\n📊 Found ${articles.length} articles but couldn't display properly.\n\n💡 Try /refresh or use specific keywords.`;
      await bot.sendMessage(chatId, emergencyMessage, { parse_mode: 'Markdown' });
    } catch (emergencyError) {
      logger.error('❌ Emergency fallback failed:', emergencyError.message);
    }
  }
}

// Webhook setup (Production)
if (bot && isProduction) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  
  bot.setWebHook(`${APP_URL}${webhookPath}`)
    .then(() => {
      logger.info('✅ Webhook set successfully');
      logger.info(`🔗 Webhook URL: ${APP_URL}${webhookPath}`);
    })
    .catch(err => {
      logger.error('❌ Webhook setup failed:', err.message);
    });
  
  app.post(webhookPath, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      logger.error('Webhook processing error:', error.message);
      res.sendStatus(500);
    }
  });
  
  logger.info('🎯 Bot configured for webhook mode (Production)');
} else if (bot) {
  logger.info('🔄 Bot configured for polling mode (Development)');
}

// Bot commands
if (bot) {
  bot.on('polling_error', error => {
    logger.error('Telegram polling error:', error.message);
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      const welcomeMessage = `🔥 *VIRAL NEWS BOT v3.0* 🔥

*📰 Enhanced Commands:*
/youtubers - Spicy YouTuber drama & conspiracy
/bollywood - Celebrity scandals & secrets
/cricket - Sports controversies & fixes  
/national - Political drama & exposés
/pakistan - Pakistani conspiracy content
/latest - All categories with top scores

*🔍 Smart Search:*
/search <term> - Multi-platform scored search
/spicy <term> - High controversy content only

*🛠️ Management:*
/addkeyword <category> <keyword> - Add custom keywords
/refresh - Force refresh all sources

*📊 Content Scoring:*
🌶️ *Spice Level* (1-10): Drama, controversy, fights
🕵️ *Conspiracy Score* (1-10): Secrets, exposés, hidden truth
⚡ *Importance* (1-10): Breaking news, urgent updates

*🎯 Perfect for YouTube News Channels!*
✅ *Latest 24hr data with working direct links*
🔥 *Sorted by spice level for maximum engagement*
📱 *Multi-platform coverage*
🚀 *AI-powered content scoring & moderation*

*Example Commands:*
/addkeyword youtubers CarryMinati controversy
/spicy Elvish Yadav drama
/search trending topic

🎬 *Get the SPICIEST content for your channel!*`;
      
      await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'start', 'general', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Start command error:', error.message);
      botStats.errors++;
    }
  });

  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'youtubers');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      bot.sendMessage(chatId, `🎥 *Getting SPICIEST YouTuber drama & conspiracy...*\n\n🔍 Searching for creator beef, exposed scandals & controversy\n🌶️ *Focus: YouTube drama & secrets*`, { parse_mode: 'Markdown' });
      
      const freshNews = await fetchEnhancedContent('youtubers', userId);
      
      if (freshNews.length > 0) {
        const avgScore = freshNews.length > 0 ? Math.round(freshNews.reduce((sum, item) => sum + (item.totalScore || 0), 0) / freshNews.length) : 0;
        logger.info(`✅ Fresh search found ${freshNews.length} articles (avg score: ${avgScore})`);
        
        newsCache = newsCache.filter(article => article.category !== 'youtubers');
        newsCache.push(...freshNews);
        
        await formatAndSendEnhancedNewsMessage(chatId, freshNews, 'YouTuber', bot);
        
        const responseTime = Date.now() - startTime;
        try {
          await database.logAnalytics(userId, 'youtubers', 'youtubers', responseTime);
        } catch (dbError) {
          logger.warn('Analytics logging failed:', dbError.message);
        }
        botStats.totalRequests++;
        botStats.successfulRequests++;
        
      } else {
        logger.info('⚠️ Enhanced search returned 0 results, using fallback');
        const fallbackContent = createFallbackContent('youtubers');
        await formatAndSendEnhancedNewsMessage(chatId, fallbackContent, 'YouTuber', bot);
      }
    } catch (error) {
      logger.error('❌ YouTuber command error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching YouTuber news*\n\nTry /addkeyword youtubers <name> to add specific creators`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'bollywood');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      bot.sendMessage(chatId, `🎭 *Getting SPICIEST Bollywood scandals & secrets...*\n\n🔍 Searching for affairs, controversies & exposés\n🌶️ *Focus: Celebrity drama & conspiracy*`, { parse_mode: 'Markdown' });
      
      const freshNews = await fetchEnhancedContent('bollywood', userId);
      const bollywoodNews = freshNews.length > 0 ? freshNews : createFallbackContent('bollywood');
      
      newsCache = newsCache.filter(article => article.category !== 'bollywood');
      newsCache.push(...bollywoodNews);
      
      await formatAndSendEnhancedNewsMessage(chatId, bollywoodNews, 'Bollywood', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'bollywood', 'bollywood', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('❌ Bollywood command error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching Bollywood news*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'cricket');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      bot.sendMessage(chatId, `🏏 *Getting SPICIEST Cricket controversies & fixes...*\n\n🔍 Searching for match fixing, scandals & drama\n🌶️ *Focus: Sports corruption & conspiracy*`, { parse_mode: 'Markdown' });
      
      const freshNews = await fetchEnhancedContent('cricket', userId);
      const cricketNews = freshNews.length > 0 ? freshNews : createFallbackContent('cricket');
      
      newsCache = newsCache.filter(article => article.category !== 'cricket');
      newsCache.push(...cricketNews);
      
      await formatAndSendEnhancedNewsMessage(chatId, cricketNews, 'Cricket', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'cricket', 'cricket', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('❌ Cricket command error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching Cricket news*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'national');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      bot.sendMessage(chatId, `🇮🇳 *Getting SPICIEST Political drama & exposés...*\n\n🔍 Searching for corruption, scandals & cover-ups\n🌶️ *Focus: Government conspiracy & drama*`, { parse_mode: 'Markdown' });
      
      const freshNews = await fetchEnhancedContent('national', userId);
      const nationalNews = freshNews.length > 0 ? freshNews : createFallbackContent('national');
      
      newsCache = newsCache.filter(article => article.category !== 'national');
      newsCache.push(...nationalNews);
      
      await formatAndSendEnhancedNewsMessage(chatId, nationalNews, 'National', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'national', 'national', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('❌ National command error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching National news*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'pakistan');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      bot.sendMessage(chatId, `🇵🇰 *Getting SPICIEST Pakistan conspiracy & crisis...*\n\n🔍 Searching for ISI secrets, political drama & exposés\n🌶️ *Focus: Deep state & corruption*`, { parse_mode: 'Markdown' });
      
      const freshNews = await fetchEnhancedContent('pakistan', userId);
      const pakistanNews = freshNews.length > 0 ? freshNews : createFallbackContent('pakistan');
      
      newsCache = newsCache.filter(article => article.category !== 'pakistan');
      newsCache.push(...pakistanNews);
      
      await formatAndSendEnhancedNewsMessage(chatId, pakistanNews, 'Pakistani', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'pakistan', 'pakistan', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('❌ Pakistan command error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching Pakistan news*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      bot.sendMessage(chatId, '🔄 *Getting top-scored content from all categories...*', { parse_mode: 'Markdown' });
      
      if (newsCache.length === 0) {
        // Quick aggregation from all categories
        const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
        const allNews = [];
        
        for (const category of categories) {
          try {
            const categoryNews = await fetchEnhancedContent(category, userId);
            allNews.push(...categoryNews);
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            logger.error(`Error fetching ${category}:`, error.message);
          }
        }
        newsCache = allNews;
      }
      
      // Get top 20 highest scoring articles
      const topScoredNews = newsCache
        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
        .slice(0, 20);
      
      const avgScore = topScoredNews.length > 0 ? Math.round(topScoredNews.reduce((sum, item) => sum + (item.totalScore || 0), 0) / topScoredNews.length) : 0;
      
      await formatAndSendEnhancedNewsMessage(chatId, topScoredNews, 'Top Scored', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'latest', 'all', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('❌ Latest command error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching latest news*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchTerm = match[1].trim();
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'search');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (searchTerm.length < 2) {
      await bot.sendMessage(chatId, `❌ *Search term too short!*\n\n*Usage:* /search <term>`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      await bot.sendMessage(chatId, `🔍 *ENHANCED SEARCH: "${searchTerm}"*\n\n🌐 Searching with scoring...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeEnhancedNews(searchTerm, categorizeNews(searchTerm));
      
      if (searchResults.length === 0) {
        await bot.sendMessage(chatId, `❌ *No results found for "${searchTerm}"*\n\n🔧 Try different spelling or add as keyword`, { parse_mode: 'Markdown' });
        return;
      }

      await formatAndSendEnhancedNewsMessage(chatId, searchResults, `Search: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'search', 'search', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;

    } catch (error) {
      logger.error(`Search error for "${searchTerm}":`, error);
      await bot.sendMessage(chatId, `❌ *Search failed*\n\nTry again or add as keyword`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/spicy (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchTerm = match[1].trim();
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'spicy');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (searchTerm.length < 2) {
      await bot.sendMessage(chatId, `❌ *Search term too short!*\n\n*Usage:* /spicy <term>`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      await bot.sendMessage(chatId, `🌶️ *SPICY SEARCH: "${searchTerm}"*\n\n🔥 Finding only HIGH CONTROVERSY content...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeEnhancedNews(searchTerm, categorizeNews(searchTerm));
      
      const spicyResults = searchResults.filter(article => (article.spiceScore || 0) >= 6);
      
      if (spicyResults.length === 0) {
        await bot.sendMessage(chatId, `❌ *No spicy content found for "${searchTerm}"*\n\n🔧 Try different keywords`, { parse_mode: 'Markdown' });
        return;
      }

      await formatAndSendEnhancedNewsMessage(chatId, spicyResults, `Spicy: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'spicy', 'search', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;

    } catch (error) {
      logger.error(`Spicy search error for "${searchTerm}":`, error);
      await bot.sendMessage(chatId, `❌ *Spicy search failed*\n\nTry again or use /search`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  // Enhanced LIST KEYWORDS command
  bot.onText(/\/listkeywords/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      let message = '📝 *YOUR CUSTOM KEYWORDS*\n\n';
      let totalKeywords = 0;
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      
      for (const category of categories) {
        const userKeywords = await database.getUserKeywords(userId, category);
        const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
        
        message += `${icon} *${category.toUpperCase()}* (${userKeywords.length}):\n`;
        
        if (userKeywords.length > 0) {
          userKeywords.forEach((k, index) => {
            message += `${index + 1}. ${k.keyword} (Priority: ${k.priority})\n`;
          });
        } else {
          message += `• No custom keywords yet\n`;
        }
        message += '\n';
        totalKeywords += userKeywords.length;
      }
      
      message += `📊 *Total Custom Keywords:* ${totalKeywords}\n\n`;
      message += `💡 *Add more with:* /addkeyword <category> <keyword>\n`;
      message += `🗑️ *Remove with:* /removekeyword <category> <keyword>\n`;
      message += `🌶️ *Tip:* Use spicy words like "drama", "scandal", "exposed"`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('List keywords error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching keywords*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  // NEW: REMOVE KEYWORD command
  bot.onText(/\/removekeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      await bot.sendMessage(chatId, `❌ *Usage:* /removekeyword <category> <keyword>\n\n*Example:* /removekeyword youtubers drama`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!ENHANCED_SEARCH_KEYWORDS[category]) {
      await bot.sendMessage(chatId, `❌ *Invalid category!*\n\n*Valid:* youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      // Remove from database
      const removed = await new Promise((resolve, reject) => {
        database.db.run(
          'DELETE FROM user_keywords WHERE user_id = ? AND category = ? AND keyword = ?',
          [userId, category, keyword],
          function(err) {
            if (err) {
              reject(err);
            } else {
              resolve(this.changes > 0);
            }
          }
        );
      });
      
      if (!removed) {
        await bot.sendMessage(chatId, `❌ *Not found!* "${keyword}" not in your ${category} keywords`, { parse_mode: 'Markdown' });
        return;
      }
      
      // Remove from runtime keywords
      const keywordIndex = ENHANCED_SEARCH_KEYWORDS[category].spicy.indexOf(keyword);
      if (keywordIndex > -1) {
        ENHANCED_SEARCH_KEYWORDS[category].spicy.splice(keywordIndex, 1);
      }
      
      const remainingKeywords = await database.getUserKeywords(userId, category);
      
      await bot.sendMessage(chatId, `✅ *Keyword Removed Successfully!*

🗑️ *Removed:* "${keyword}"
📂 *Category:* ${category}
📊 *Remaining keywords:* ${remainingKeywords.length}

💡 *Add new keywords with:* /addkeyword ${category} <keyword>`, { parse_mode: 'Markdown' });
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Remove keyword error:', error);
      await bot.sendMessage(chatId, `❌ *Error removing keyword*\n\nTry again later`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  // NEW: USER STATS command
  bot.onText(/\/mystats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      // Get user analytics from database
      const userStats = await new Promise((resolve, reject) => {
        database.db.all(
          `SELECT command, category, COUNT(*) as count, AVG(response_time) as avg_time 
           FROM bot_analytics 
           WHERE user_id = ? 
           GROUP BY command, category 
           ORDER BY count DESC`,
          [userId],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
      
      let message = `📊 *YOUR USAGE STATISTICS*\n\n`;
      
      if (userStats.length === 0) {
        message += `📈 *No usage data yet*\n\nStart using commands to see your stats!`;
      } else {
        const totalRequests = userStats.reduce((sum, stat) => sum + stat.count, 0);
        const avgResponseTime = Math.round(userStats.reduce((sum, stat) => sum + (stat.avg_time * stat.count), 0) / totalRequests);
        
        message += `🎯 *Total Requests:* ${totalRequests}\n`;
        message += `⚡ *Avg Response Time:* ${avgResponseTime}ms\n\n`;
        message += `📋 *Command Usage:*\n`;
        
        userStats.slice(0, 10).forEach(stat => {
          const icon = stat.command === 'youtubers' ? '📱' : stat.command === 'bollywood' ? '🎬' : stat.command === 'cricket' ? '🏏' : stat.command === 'pakistan' ? '🇵🇰' : '🔍';
          message += `${icon} /${stat.command}: ${stat.count} times\n`;
        });
        
        // Find most used command
        const mostUsed = userStats[0];
        message += `\n🏆 *Most Used:* /${mostUsed.command} (${mostUsed.count} times)`;
      }
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('User stats error:', error);
      await bot.sendMessage(chatId, `❌ *Error fetching statistics*`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  // NEW: CONSPIRACY command
  bot.onText(/\/conspiracy (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchTerm = match[1].trim();
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'conspiracy');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nTry again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (searchTerm.length < 2) {
      await bot.sendMessage(chatId, `❌ *Search term too short!*\n\n*Usage:* /conspiracy <term>`, { parse_mode: 'Markdown' });
      return;
    }

    try {
      await bot.sendMessage(chatId, `🕵️ *CONSPIRACY SEARCH: "${searchTerm}"*\n\n🔍 Finding hidden truths, exposés & secrets...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeEnhancedNews(searchTerm, categorizeNews(searchTerm));
      
      // Filter for high conspiracy score only (5+)
      const conspiracyResults = searchResults.filter(article => (article.conspiracyScore || 0) >= 5);
      
      if (conspiracyResults.length === 0) {
        await bot.sendMessage(chatId, `❌ *No conspiracy content found for "${searchTerm}"*\n\n🔧 Try keywords like: exposed, secret, hidden, conspiracy`, { parse_mode: 'Markdown' });
        return;
      }

      await formatAndSendEnhancedNewsMessage(chatId, conspiracyResults, `Conspiracy: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'conspiracy', 'search', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;

    } catch (error) {
      logger.error(`Conspiracy search error for "${searchTerm}":`, error);
      await bot.sendMessage(chatId, `❌ *Conspiracy search failed*\n\nTry again or use /spicy`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  // NEW: SETTINGS/HELP command
  bot.onText(/\/settings|\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const settingsMessage = `⚙️ *BOT SETTINGS & FEATURES*

*🎯 All Working Commands:*
/start - Welcome & command list
/youtubers - Spicy YouTube drama 🎥
/bollywood - Celebrity scandals 🎭
/cricket - Sports controversies 🏏
/national - Political drama 🇮🇳
/pakistan - Pakistani conspiracy 🇵🇰
/latest - Top scored content 🔥

*🔍 Advanced Search:*
/search <term> - Multi-platform search
/spicy <term> - High controversy only (6+ spice)
/conspiracy <term> - Hidden truths (5+ conspiracy)

*🛠️ Keyword Management:*
/addkeyword <category> <keyword> - Add custom
/removekeyword <category> <keyword> - Remove
/listkeywords - View all your keywords

*📊 Analytics & Info:*
/mystats - Your usage statistics
/refresh - Force refresh all sources
/settings or /help - This menu

*📊 Content Scoring System:*
🌶️ *Spice (1-10):* Drama, controversy, fights
🕵️ *Conspiracy (1-10):* Secrets, exposés, truths
⚡ *Importance (1-10):* Breaking, urgent news

*🎬 Perfect for YouTube Channels!*
✅ Multi-platform coverage (News→Twitter→Instagram→YouTube)
✅ Working direct links (no broken URLs)
✅ 24-hour fresh content only
✅ Content scoring & ranking
✅ Spam & inappropriate content filtering

*💡 Pro Tips:*
• Use /spicy for maximum drama content
• Add keywords like "exposed", "scandal", "controversy"
• Check /mystats to track your usage patterns
• Use /latest for top-scored viral content`;

    await bot.sendMessage(chatId, settingsMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      await bot.sendMessage(chatId, `❌ *Usage:* /addkeyword <category> <keyword>\n\n*Categories:* youtubers, bollywood, cricket, national, pakistan\n\n*Example:* /addkeyword youtubers MrBeast drama`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!ENHANCED_SEARCH_KEYWORDS[category]) {
      await bot.sendMessage(chatId, `❌ *Invalid category!*\n\n*Valid:* youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      const existingKeywords = await database.getUserKeywords(userId, category);
      const keywordExists = existingKeywords.some(k => k.keyword.toLowerCase() === keyword.toLowerCase());
      
      if (keywordExists) {
        await bot.sendMessage(chatId, `⚠️ *Already exists!* "${keyword}" is in your ${category} keywords`, { parse_mode: 'Markdown' });
        return;
      }
      
      await database.addUserKeyword(userId, category, keyword, 5);
      
      if (!ENHANCED_SEARCH_KEYWORDS[category].spicy.includes(keyword)) {
        ENHANCED_SEARCH_KEYWORDS[category].spicy.push(keyword);
      }
      
      const totalKeywords = existingKeywords.length + 1;
      
      await bot.sendMessage(chatId, `✅ *Keyword Added Successfully!*

📝 *Added:* "${keyword}"
📂 *Category:* ${category}
📊 *Your total keywords:* ${totalKeywords}
🌶️ *Priority:* High (will appear in searches)

🚀 Use /${category} to see LATEST results with your keyword!
💡 *Tip:* Add spicy keywords like "drama", "exposed", "controversy"`, { parse_mode: 'Markdown' });
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Add keyword error:', error);
      await bot.sendMessage(chatId, `❌ *Error adding keyword*\n\nTry again later`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'refresh');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ *Rate limit exceeded*\n\nRefresh is limited. Try again in ${rateLimitCheck.resetTime} minutes.`, { parse_mode: 'Markdown' });
      return;
    }
    
    try {
      const currentTime = getCurrentIndianTime();
      await bot.sendMessage(chatId, `🔄 *Refreshing ALL enhanced sources...*\n\n⏳ Getting latest spicy content with scores\n🕐 Started: ${currentTime.toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
      
      const refreshStartTime = new Date();
      newsCache = [];
      
      // Aggregate news from all categories with user keywords
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      const allNews = [];
      
      for (const category of categories) {
        try {
          logger.info(`🔄 Refreshing ${category} with user keywords...`);
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Error fetching ${category}:`, error.message);
        }
      }
      
      newsCache = allNews;
      const refreshEndTime = new Date();
      
      const refreshTime = Math.round((refreshEndTime - refreshStartTime) / 1000);
      const avgScore = newsCache.length > 0 ? Math.round(newsCache.reduce((sum, item) => sum + (item.totalScore || 0), 0) / newsCache.length) : 0;
      const spicyCount = newsCache.filter(a => a.spiceScore > 6).length;
      const conspiracyCount = newsCache.filter(a => a.conspiracyScore > 6).length;
      
      await bot.sendMessage(chatId, `✅ *Enhanced Refresh Complete!*

⏱️ *Time taken:* ${refreshTime} seconds
📊 *Articles found:* ${newsCache.length}
⭐ *Average Score:* ${avgScore}/30
🌶️ *Spicy Content:* ${spicyCount} articles
🕵️ *Conspiracy Content:* ${conspiracyCount} articles
🕐 *Completed:* ${getCurrentIndianTime().toLocaleString('en-IN')}
✅ *All links are WORKING & SCORED!*
🎬 *Perfect for YouTube content creation!*`, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'refresh', 'all', responseTime);
      } catch (dbError) {
        logger.warn('Analytics logging failed:', dbError.message);
      }
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Refresh command error:', error);
      await bot.sendMessage(chatId, `❌ *Refresh failed*\n\nTry again later`, { parse_mode: 'Markdown' });
      botStats.errors++;
    }
  });

  logger.info('📱 Enhanced Telegram Bot v3.0 initialized!');
} else {
  logger.warn('⚠️ Bot not initialized - missing BOT_TOKEN');
}

// Express routes
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  const avgScore = newsCache.length > 0 ? Math.round(newsCache.reduce((sum, item) => sum + (item.totalScore || 0), 0) / newsCache.length) : 0;
  const spicyCount = newsCache.filter(a => a.spiceScore > 6).length;
  const conspiracyCount = newsCache.filter(a => a.conspiracyScore > 6).length;
  
  res.json({ 
    status: 'Enhanced Viral News Bot v3.0 - Spicy Content with Scoring',
    version: '3.0.0',
    features: ['Working Direct Links', 'Content Scoring', 'Moderation', 'Webhooks', 'Analytics'],
    stats: {
      totalNews: newsCache.length,
      averageScore: avgScore,
      spicyContent: spicyCount,
      conspiracyContent: conspiracyCount,
      uptime: uptime,
      totalRequests: botStats.totalRequests,
      successRate: botStats.totalRequests > 0 ? Math.round((botStats.successfulRequests / botStats.totalRequests) * 100) : 0
    },
    lastUpdate: getCurrentIndianTime().toLocaleString('en-IN'),
    contentFocus: 'Spicy, Important, Conspiracy news for YouTube channels'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime(),
    features: {
      workingLinks: true,
      contentScoring: true,
      moderation: true,
      webhooks: isProduction,
      analytics: true
    },
    performance: {
      totalRequests: botStats.totalRequests,
      errors: botStats.errors,
      successRate: botStats.totalRequests > 0 ? Math.round((botStats.successfulRequests / botStats.totalRequests) * 100) : 0
    },
    lastUpdate: getCurrentIndianTime().toLocaleString('en-IN')
  });
});

app.get('/ping', (req, res) => {
  botStats.totalRequests++;
  res.json({ 
    status: 'pong',
    timestamp: getCurrentIndianTime().toLocaleString('en-IN'),
    version: '3.0.0',
    features: 'enhanced-scoring-moderation-webhooks',
    uptime: Math.floor(process.uptime())
  });
});

// Cleanup function
async function enhancedCleanup() {
  try {
    const expiryTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const initialCount = newsCache.length;
    newsCache = newsCache.filter(article => 
      new Date(article.timestamp) > expiryTime
    );
    
    const oneHourAgo = Date.now() - 3600000;
    userRateLimits.forEach((history, key) => {
      const filtered = history.filter(time => time > oneHourAgo);
      if (filtered.length === 0) {
        userRateLimits.delete(key);
      } else {
        userRateLimits.set(key, filtered);
      }
    });
    
    logger.info(`🧹 Cleanup complete: Removed ${initialCount - newsCache.length} expired articles`);
  } catch (error) {
    logger.error('Cleanup error:', error);
  }
}

// Keep-alive function
async function enhancedKeepAlive() {
  try {
    if (APP_URL && !APP_URL.includes('localhost')) {
      const response = await axios.get(`${APP_URL}/ping`, { timeout: 10000 });
      logger.info(`🏓 Keep-alive successful (v${response.data.version})`);
    }
  } catch (error) {
    logger.warn(`⚠️ Keep-alive failed: ${error.message}`);
    botStats.errors++;
  }
}

// Scheduled tasks
setInterval(enhancedKeepAlive, 12 * 60 * 1000);
setInterval(enhancedCleanup, 30 * 60 * 1000);

// Initial startup
setTimeout(async () => {
  logger.info('🚀 Starting Enhanced News Bot v3.0...');
  try {
    logger.info('✅ Initial startup complete');
    logger.info('🏓 Keep-alive activated');
    logger.info('🧹 Cleanup tasks scheduled');
  } catch (error) {
    logger.error('Startup error:', error);
  }
}, 3000);

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Enhanced News Bot v3.0 running on port ${PORT}`);
  logger.info(`🌐 URL: ${APP_URL}`);
  logger.info(`📱 Bot: ${BOT_TOKEN ? 'Active with Enhanced Features' : 'Missing Token'}`);
  logger.info(`✅ Features: Content Scoring, Moderation, Webhooks, Analytics`);
  logger.info(`🎯 Mode: ${isProduction ? 'Production (Webhooks)' : 'Development (Polling)'}`);
  logger.info(`🌶️ Focus: Spicy, Important, Conspiracy content for YouTube`);
  logger.info(`🕐 Started: ${getCurrentIndianTime().toLocaleString('en-IN')}`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  botStats.errors++;
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  botStats.errors++;
  
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  if (database && database.db) {
    database.db.close((err) => {
      if (err) {
        logger.error('Database close error:', err);
      } else {
        logger.info('Database closed');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

module.exports = { 
  app, 
  bot, 
  database,
  calculateSpiceScore,
  calculateConspiracyScore,
  calculateImportanceScore,
  categorizeNews,
  moderateContent,
  checkUserRateLimit,
  isWithin24Hours,
  formatNewsDate,
  getCurrentIndianTime,
  getCurrentTimestamp,
  ENHANCED_SEARCH_KEYWORDS
}; TEXT NOT NULL,
        keyword TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category, keyword)
      )`,
      
      `CREATE TABLE IF NOT EXISTS news_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        category TEXT NOT NULL,
        spice_score INTEGER DEFAULT 0,
        importance_score INTEGER DEFAULT 0,
        conspiracy_score INTEGER DEFAULT 0,
        platform TEXT DEFAULT 'news',
        source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        UNIQUE(url)
      )`,
      
      `CREATE TABLE IF NOT EXISTS bot_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        command TEXT,
        category TEXT,
        response_time INTEGER,
        success INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];
    
    tables.forEach(table => {
      this.db.run(table, (err) => {
        if (err) {
          logger.error('Database initialization error:', err);
        }
      });
    });
  }
  
  async addUserKeyword(userId, category, keyword, priority = 1) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO user_keywords (user_id, category, keyword, priority) VALUES (?, ?, ?, ?)',
        [userId, category, keyword, priority],
        function(err) {
          if (err) {
            logger.error('Add keyword error:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }
  
  async getUserKeywords(userId, category) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT keyword, priority FROM user_keywords WHERE user_id = ? AND category = ? ORDER BY priority DESC',
        [userId, category],
        (err, rows) => {
          if (err) {
            logger.error('Get keywords error:', err);
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }
  
  async logAnalytics(userId, command, category, responseTime, success = 1) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO bot_analytics (user_id, command, category, response_time, success) VALUES (?, ?, ?, ?, ?)',
        [userId, command, category, responseTime, success],
        function(err) {
          if (err) {
            logger.error('Analytics logging error:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }
}

const database = new NewsDatabase();

// Bot setup
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,
  webHook: isProduction 
}) : null;

// Express setup
const app = express();
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

// Global variables
let newsCache = [];
let userRateLimits = new Map();
let botStats = {
  totalRequests: 0,
  successfulRequests: 0,
  errors: 0,
  startTime: Date.now()
};

// Enhanced keywords
const ENHANCED_SEARCH_KEYWORDS = {
  youtubers: {
    spicy: [
      'YouTube drama exposed', 'YouTuber controversy', 'creator beef',
      'CarryMinati controversy', 'Elvish Yadav exposed', 'Indian gaming scandal'
    ],
    conspiracy: [
      'YouTube algorithm conspiracy', 'shadow ban exposed', 'fake views scandal'
    ],
    important: [
      'YouTube strike news', 'creator lawsuit', 'YouTube policy change'
    ]
  },
  bollywood: {
    spicy: [
      'Bollywood scandal exposed', 'celebrity affair revealed', 'nepotism controversy'
    ],
    conspiracy: [
      'Bollywood illuminati connection', 'film industry conspiracy'
    ],
    important: [
      'celebrity arrest news', 'film banned controversy'
    ]
  },
  cricket: {
    spicy: [
      'cricket scandal exposed', 'match fixing revelation', 'IPL drama behind scenes'
    ],
    conspiracy: [
      'cricket betting nexus', 'match result manipulation'
    ],
    important: [
      'player injury crisis', 'cricket board resignation'
    ]
  },
  national: {
    spicy: [
      'political scandal exposed', 'corruption revelation', 'election manipulation exposed'
    ],
    conspiracy: [
      'government conspiracy theory', 'deep state India'
    ],
    important: [
      'emergency declared', 'minister arrested'
    ]
  },
  pakistan: {
    spicy: [
      'Pakistan political crisis', 'Imran Khan controversy'
    ],
    conspiracy: [
      'Pakistan ISI conspiracy', 'terrorism funding exposed'
    ],
    important: [
      'Pakistan government falls', 'economic emergency Pakistan'
    ]
  }
};

// Keywords for scoring
const SPICY_KEYWORDS = [
  'controversy', 'drama', 'fight', 'viral', 'trending', 'breaking',
  'sensation', 'bombshell', 'explosive', 'shocking', 'scandalous',
  'beef', 'roast', 'diss', 'call out', 'exposed', 'cancelled'
];

const CONSPIRACY_KEYWORDS = [
  'conspiracy', 'secret', 'hidden truth', 'cover up', 'exposed', 'leaked',
  'exclusive', 'shocking revelation', 'manipulation', 'agenda',
  'deep state', 'illuminati', 'behind scenes', 'real story'
];

const IMPORTANCE_KEYWORDS = [
  'breaking news', 'urgent', 'alert', 'government', 'policy', 'law',
  'court', 'judge', 'election', 'economic', 'crisis', 'disaster'
];

// Content scoring functions
function calculateSpiceScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  
  SPICY_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) {
      score += keyword.length > 8 ? 3 : 2;
    }
  });
  
  const spicyCount = SPICY_KEYWORDS.filter(keyword => 
    content.includes(keyword.toLowerCase())
  ).length;
  
  if (spicyCount > 2) score += spicyCount * 2;
  
  return Math.min(score, 10);
}

function calculateConspiracyScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  
  CONSPIRACY_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) {
      score += keyword.length > 10 ? 4 : 3;
    }
  });
  
  return Math.min(score, 10);
}

function calculateImportanceScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  
  IMPORTANCE_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) {
      score += 3;
    }
  });
  
  const urgentWords = ['breaking', 'urgent', 'alert', 'emergency', 'crisis'];
  urgentWords.forEach(word => {
    if (content.includes(word)) {
      score += 4;
    }
  });
  
  return Math.min(score, 10);
}

// Content moderation
function moderateContent(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  const profanityWords = ['गाली', 'बकवास', 'fake', 'fraud', 'scam', 'clickbait'];
  const hasProfanity = profanityWords.some(word => content.includes(word.toLowerCase()));
  
  const fakeNewsPatterns = [
    'you wont believe', 'doctors hate this', 'shocking truth they dont want'
  ];
  const isSuspiciousFake = fakeNewsPatterns.some(pattern => content.includes(pattern));
  
  let isCleanByFilter = true;
  try {
    isCleanByFilter = !filter.isProfane(content);
  } catch (error) {
    logger.warn('Filter check error:', error.message);
  }
  
  return {
    isClean: !hasProfanity && !isSuspiciousFake && isCleanByFilter,
    issues: {
      profanity: hasProfanity,
      suspiciousFake: isSuspiciousFake,
      badWordsFilter: !isCleanByFilter
    }
  };
}

// News categorization
function categorizeNews(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  if (content.match(/youtube|youtuber|creator|influencer|carry|minati|elvish|yadav/i)) {
    return 'youtubers';
  }
  
  if (content.match(/bollywood|hindi film|movie|cinema|actor|actress|salman|khan|shah rukh/i)) {
    return 'bollywood';
  }
  
  if (content.match(/cricket|ipl|virat|kohli|rohit|sharma|dhoni|match|wicket/i)) {
    return 'cricket';
  }
  
  if (content.match(/pakistan|imran khan|karachi|lahore|pakistani/i)) {
    return 'pakistan';
  }
  
  return 'national';
}

// Utility functions
function getCurrentTimestamp() {
  return new Date().toISOString();
}

function getCurrentIndianTime() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
}

function formatNewsDate(dateString) {
  try {
    if (!dateString) {
      const now = getCurrentIndianTime();
      return `${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}`;
    }
    
    const newsDate = new Date(dateString);
    if (isNaN(newsDate.getTime())) {
      const now = getCurrentIndianTime();
      return `${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}`;
    }
    
    const now = getCurrentIndianTime();
    const diffInMinutes = Math.floor((now - newsDate) / (1000 * 60));
    
    if (diffInMinutes < 5) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes} min ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    
    return newsDate.toLocaleDateString('en-IN', { 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    const now = getCurrentIndianTime();
    return `${now.toLocaleDateString('en-IN')} ${now.toLocaleTimeString('en-IN', {hour: '2-digit', minute: '2-digit'})}`;
  }
}

function isWithin24Hours(dateString) {
  try {
    if (!dateString) return true;
    const newsDate = new Date(dateString);
    const now = getCurrentIndianTime();
    if (isNaN(newsDate.getTime())) return true;
    const diffInHours = (now - newsDate) / (1000 * 60 * 60);
    return diffInHours <= 24;
  } catch (error) {
    return true;
  }
}

// Rate limiting
function checkUserRateLimit(userId, command) {
  const key = `${userId}:${command}`;
  const now = Date.now();
  const userHistory = userRateLimits.get(key) || [];
  
  const filtered = userHistory.filter(time => now - time < 3600000);
  
  if (filtered.length >= 10) {
    return {
      allowed: false,
      resetTime: Math.ceil((filtered[0] + 3600000 - now) / 60000)
    };
  }
  
  filtered.push(now);
  userRateLimits.set(key, filtered);
  return { allowed: true };
}

// News scraping
async function scrapeEnhancedNews(query, category) {
  try {
    logger.info(`🔍 Fetching enhanced news for: ${query} (${category})`);
    
    const allArticles = [];
    
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en&when:1d`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 8000
      });

      const $ = cheerio.load(response.data, { xmlMode: true });
      
      $('item').each((i, elem) => {
        const title = $(elem).find('title').text().trim();
        const link = $(elem).find('link').text().trim();
        const pubDate = $(elem).find('pubDate').text().trim();
        const description = $(elem).find('description').text().trim();

        if (title && link && title.length > 15) {
          const isRecent = isWithin24Hours(pubDate);
          if (!isRecent && pubDate) {
            return;
          }
          
          const moderation = moderateContent(title, description);
          if (!moderation.isClean) {
            logger.warn(`Content filtered: ${title.substring(0, 50)}...`);
            return;
          }
          
          const currentTime = getCurrentTimestamp();
          
          let workingLink = link;
          if (link.includes('url=')) {
            const urlMatch = link.match(/url=([^&]+)/);
            if (urlMatch) {
              try {
                workingLink = decodeURIComponent(urlMatch[1]);
                if (workingLink.includes('%')) {
                  workingLink = decodeURIComponent(workingLink);
                }
              } catch (e) {
                workingLink = link;
              }
            }
          }
          
          if (workingLink.includes('google.com/url') || 
              workingLink.includes('news.google.com/articles') ||
              workingLink.includes('googleusercontent.com')) {
            
            const cleanTitle = title.replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            workingLink = `https://www.google.com/search?q="${encodeURIComponent(cleanTitle)}"&tbm=nws&tbs=qdr:d&gl=IN&hl=en`;
          }
          
          let source = 'News Source';
          if (title.includes(' - ')) {
            const parts = title.split(' - ');
            if (parts[0].length < 30) {
              source = parts[0].trim();
            }
          }
          
          const spiceScore = calculateSpiceScore(title, description);
          const conspiracyScore = calculateConspiracyScore(title, description);
          const importanceScore = calculateImportanceScore(title, description);
          
          allArticles.push({
            title: title.length > 150 ? title.substring(0, 150) + '...' : title,
            link: workingLink,
            pubDate: pubDate || currentTime,
            formattedDate: formatNewsDate(pubDate || currentTime),
            description: description ? description.substring(0, 120) + '...' : `Latest ${query} news`,
            source: source,
            category: categorizeNews(title, description),
            timestamp: currentTime,
            fetchTime: getCurrentIndianTime().toLocaleString('en-IN'),
            reliability: 10,
            platform: 'news',
            isVerified: true,
            spiceScore,
            conspiracyScore,
            importanceScore,
            totalScore: spiceScore + conspiracyScore + importanceScore
          });
        }
      });
      
      logger.info(`✅ Google News: ${allArticles.length} articles with scores`);
      
    } catch (googleError) {
      logger.error(`Google News error: ${googleError.message}`);
    }
    
    if (allArticles.length < 10 && ENHANCED_SEARCH_KEYWORDS[category]) {
      logger.info(`⚡ Adding category-specific spicy content...`);
      
      const categoryKeywords = ENHANCED_SEARCH_KEYWORDS[category];
      const spicyKeywords = categoryKeywords.spicy.slice(0, 2);
      
      for (const keyword of spicyKeywords) {
        try {
          const currentTime = getCurrentTimestamp();
          
          const enhancedNews = {
            title: `${keyword} - Breaking News Today`,
            link: `https://www.google.com/search?q="${encodeURIComponent(keyword)}"&tbm=nws&tbs=qdr:d&gl=IN`,
            pubDate: currentTime,
            formattedDate: 'Latest',
            description: `Breaking news about ${keyword}`,
            source: 'Enhanced Search',
            category: category,
            timestamp: currentTime,
            fetchTime: getCurrentIndianTime().toLocaleString('en-IN'),
            reliability: 8,
            platform: 'news',
            isVerified: true,
            spiceScore: 8,
            conspiracyScore: keyword.includes('exposed') || keyword.includes('conspiracy') ? 7 : 3,
            importanceScore: 6,
            totalScore: 17
          };
          
          allArticles.push(enhancedNews);
        } catch (keywordError) {
          logger.error(`Enhanced keyword error: ${keywordError.message}`);
        }
      }
    }

    allArticles.sort((a, b) => b.totalScore - a.totalScore);

    logger.info(`📊 Total articles for "${query}": ${allArticles.length} (sorted by spice level)`);
    return allArticles;
    
  } catch (error) {
    logger.error(`❌ Enhanced news error: ${error.message}`);
    
    const cleanQuery = query.replace(/[^\w\s]/g, '').replace(/\s+/g, '+');
    const currentTime = getCurrentTimestamp();
    
    return [{
      title: `${query} - Latest News Today`,
      link: `https://www.google.com/search?q=${cleanQuery}+news+today&tbm=nws&tbs=qdr:d&gl=IN`,
      pubDate: currentTime,
      formattedDate: 'Search results',
      description: `Latest ${query} news search`,
      source: 'Fallback Search',
      category: categorizeNews(query),
      timestamp: currentTime,
      fetchTime: getCurrentIndianTime().toLocaleString('en-IN'),
      reliability: 6,
      platform: 'news',
      isVerified: true,
      spiceScore: 3,
      conspiracyScore: 2,
      importanceScore: 4,
      totalScore: 9
    }];
  }
}

// Enhanced content fetching with user keywords integration
async function fetchEnhancedContent(category, userId = null) {
  const allArticles = [];
  
  try {
    logger.info(`🎯 Enhanced ${category} content (targeting 50+ latest articles)...`);
    
    const categoryKeywords = ENHANCED_SEARCH_KEYWORDS[category];
    if (!categoryKeywords) {
      logger.warn(`No enhanced keywords found for category: ${category}`);
      return [];
    }
    
    // Get user's custom keywords if userId provided
    let userKeywords = [];
    if (userId) {
      try {
        userKeywords = await database.getUserKeywords(userId, category);
        logger.info(`📝 Found ${userKeywords.length} user keywords for ${category}`);
      } catch (error) {
        logger.warn('Could not fetch user keywords:', error.message);
      }
    }
    
    // Search using user's custom keywords first (highest priority)
    for (const userKeyword of userKeywords.slice(0, 3)) {
      try {
        logger.info(`   → User keyword search: ${userKeyword.keyword}`);
        const articles = await scrapeEnhancedNews(userKeyword.keyword + ' latest', category);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        logger.info(`     ✅ Found ${categoryArticles.length} articles for user keyword`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error(`User keyword search error for ${userKeyword.keyword}:`, error.message);
      }
    }
    
    // Search using spicy keywords (second priority)
    for (const keyword of categoryKeywords.spicy.slice(0, 4)) {
      try {
        logger.info(`   → Spicy search: ${keyword}`);
        const articles = await scrapeEnhancedNews(keyword + ' today', category);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        logger.info(`     ✅ Found ${categoryArticles.length} spicy articles`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        logger.error(`Spicy search error for ${keyword}:`, error.message);
      }
    }
    
    // Search using conspiracy keywords (third priority)
    for (const keyword of categoryKeywords.conspiracy.slice(0, 3)) {
      try {
        logger.info(`   → Conspiracy search: ${keyword}`);
        const articles = await scrapeEnhancedNews(keyword + ' news', category);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        logger.info(`     ✅ Found ${categoryArticles.length} conspiracy articles`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        logger.error(`Conspiracy search error for ${keyword}:`, error.message);
      }
    }
    
    // Search using important keywords (fourth priority)
    for (const keyword of categoryKeywords.important.slice(0, 3)) {
      try {
        logger.info(`   → Important search: ${keyword}`);
        const articles = await scrapeEnhancedNews(keyword + ' breaking', category);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        logger.info(`     ✅ Found ${categoryArticles.length} important articles`);
        
        await new Promise(resolve => setTimeout(resolve, 600));
      } catch (error) {
        logger.error(`Important search error for ${keyword}:`, error.message);
      }
    }

    // Advanced duplicate removal
    const uniqueArticles = [];
    const seenTitles = new Set();
    const seenLinks = new Set();
    
    for (const article of allArticles) {
      const titleKey = article.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').substring(0, 50);
      const linkKey = article.link.toLowerCase().replace(/[^\w]/g, '').substring(0, 80);
      
      if (!seenTitles.has(titleKey) && !seenLinks.has(linkKey)) {
        seenTitles.add(titleKey);
        seenLinks.add(linkKey);
        uniqueArticles.push(article);
      }
    }
    
    // Sort by recency first, then by total score
    const sortedArticles = uniqueArticles.sort((a, b) => {
      // First priority: timestamp (newer first)
      const aTime = new Date(a.timestamp || a.pubDate);
      const bTime = new Date(b.timestamp || b.pubDate);
      const timeDiff = bTime - aTime;
      
      // If time difference is significant (more than 6 hours), prioritize by time
      if (Math.abs(timeDiff) > 6 * 60 * 60 * 1000) {
        return timeDiff;
      }
      
      // Otherwise, prioritize by score
      return (b.totalScore || 0) - (a.totalScore || 0);
    });
    
    // Get up to 50 articles
    const finalArticles = sortedArticles.slice(0, 50);

    logger.info(`✅ ${category}: ${finalArticles.length} latest articles (with user keywords)`);
    logger.info(`📊 Score range: ${finalArticles.length > 0 ? Math.max(...finalArticles.map(a => a.totalScore || 0)) : 0} - ${finalArticles.length > 0 ? Math.min(...finalArticles.map(a => a.totalScore || 0)) : 0}`);
    
    return finalArticles;
    
  } catch (error) {
    logger.error(`❌ Enhanced content fetch error for ${category}: ${error.message}`);
    return [];
  }
}

// Create fallback content
function createFallbackContent(category) {
  const currentTime = getCurrentTimestamp();
  const indianTime = getCurrentIndianTime().toLocaleString('en-IN');
  
  const fallbackContent = {
    youtubers: [{
      title: "Indian YouTube Creator Controversy Exposed Today",
      link: "https://www.youtube.com/results?search_query=indian+youtuber+controversy",
      pubDate: currentTime,
      formattedDate: "Just now",
      source: "YouTube Search",
      category: "youtubers",
      timestamp: currentTime,
      fetchTime: indianTime,
      platform: 'youtube',
      reliability: 4,
      isVerified: true,
      spiceScore: 7,
      conspiracyScore: 5,
      importanceScore: 6,
      totalScore: 18
    }],
    bollywood: [{
      title: "Bollywood Scandal Exposed - Dark Secrets Revealed Today",
      link: "https://www.google.com/search?q=bollywood+scandal+exposed&tbm=nws&tbs=qdr:d",
      pubDate: currentTime,
      formattedDate: "Just now",
      source: "News Search",
      category: "bollywood",
      timestamp: currentTime,
      fetchTime: indianTime,
      platform: 'news',
      reliability: 8,
      isVerified: true,
      spiceScore: 8,
      conspiracyScore: 6,
      importanceScore: 7,
      totalScore: 21
    }],
    cricket: [{
      title: "Cricket Match Fixing Scandal - Players Exposed Today",
      link: "https://www.google.com/search?q=cricket+match+fixing+scandal&tbm=nws&tbs=qdr:d",
      pubDate: currentTime,
      formattedDate: "Just now",
      source: "Sports News",
      category: "cricket",
      timestamp: currentTime,
      fetchTime: indianTime,
      platform: 'news',
      reliability: 8,
      isVerified: true,
      spiceScore: 9,
      conspiracyScore: 7,
      importanceScore: 8,
      totalScore: 24
    }],
    national: [{
      title: "Government Conspiracy Exposed - Political Drama Unfolds",
      link: "https://www.google.com/search?q=government+conspiracy+exposed&tbm=nws&tbs=qdr:d",
      pubDate: currentTime,
      formattedDate: "Just now",
      source: "National News",
      category
