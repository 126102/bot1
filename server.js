const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const Filter = require('bad-words');

// Enhanced configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// URL detection
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

// Enhanced logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
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
        category TEXT NOT NULL,
        keyword TEXT NOT NULL,
        priority INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category, keyword)
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
          logger.error('Database error:', err);
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
    ]
  },
  bollywood: {
    spicy: [
      'Bollywood scandal exposed', 'celebrity affair revealed', 'nepotism controversy'
    ]
  },
  cricket: {
    spicy: [
      'cricket scandal exposed', 'match fixing revelation', 'IPL drama behind scenes'
    ]
  },
  national: {
    spicy: [
      'political scandal exposed', 'corruption revelation', 'election manipulation exposed'
    ]
  },
  pakistan: {
    spicy: [
      'Pakistan political crisis', 'Imran Khan controversy'
    ]
  }
};

// Keywords for scoring
const SPICY_KEYWORDS = [
  'controversy', 'drama', 'fight', 'viral', 'trending', 'breaking',
  'scandal', 'exposed', 'beef', 'roast', 'diss'
];

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
    if (!dateString) return 'Just now';
    
    const newsDate = new Date(dateString);
    if (isNaN(newsDate.getTime())) return 'Just now';
    
    const now = new Date();
    const diffInMinutes = Math.floor((now - newsDate) / (1000 * 60));
    
    if (diffInMinutes < 5) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)}h ago`;
    
    return newsDate.toLocaleDateString('en-IN', { 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return 'Just now';
  }
}

function calculateSpiceScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  
  SPICY_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) {
      score += 2;
    }
  });
  
  return Math.min(score, 10);
}

function categorizeNews(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  if (content.match(/youtube|youtuber|creator|influencer|carry|minati|elvish|yadav/i)) {
    return 'youtubers';
  }
  
  if (content.match(/bollywood|hindi film|movie|cinema|actor|actress/i)) {
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

// News scraping function
async function scrapeRealNews(query, category) {
  try {
    logger.info(`Fetching news for: ${query}`);
    const articles = [];
    
    // Google News RSS
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data, { xmlMode: true });
      
      $('item').each((i, elem) => {
        if (i >= 10) return false;
        
        const title = $(elem).find('title').text().trim();
        const link = $(elem).find('link').text().trim();
        const pubDate = $(elem).find('pubDate').text().trim();
        const description = $(elem).find('description').text().trim();

        if (title && link && title.length > 10) {
          // Extract real URL
          let realUrl = link;
          if (link.includes('url=')) {
            const urlMatch = link.match(/url=([^&]+)/);
            if (urlMatch) {
              try {
                realUrl = decodeURIComponent(urlMatch[1]);
              } catch (e) {
                realUrl = link;
              }
            }
          }
          
          let source = 'News Source';
          if (title.includes(' - ')) {
            const parts = title.split(' - ');
            if (parts.length > 1) {
              source = parts[parts.length - 1].trim();
            }
          }
          
          const spiceScore = calculateSpiceScore(title, description);
          
          articles.push({
            title: title.replace(/\s+/g, ' ').trim(),
            link: realUrl,
            pubDate: pubDate,
            formattedDate: formatNewsDate(pubDate),
            description: description ? description.substring(0, 120) + '...' : '',
            source: source,
            category: categorizeNews(title, description),
            timestamp: new Date().toISOString(),
            spiceScore: spiceScore,
            conspiracyScore: 3,
            importanceScore: 5,
            totalScore: spiceScore + 8
          });
        }
      });
      
      logger.info(`Found ${articles.length} articles from Google News`);
      
    } catch (error) {
      logger.error(`Google News error: ${error.message}`);
    }
    
    return articles;
    
  } catch (error) {
    logger.error(`News scraping error: ${error.message}`);
    return [];
  }
}

// Enhanced content fetching
async function fetchEnhancedContent(category, userId = null) {
  try {
    logger.info(`Fetching enhanced content for ${category}`);
    
    const allArticles = [];
    const categoryKeywords = ENHANCED_SEARCH_KEYWORDS[category];
    
    if (!categoryKeywords) {
      logger.warn(`No keywords found for category: ${category}`);
      return [];
    }
    
    // Get user's custom keywords
    let userKeywords = [];
    if (userId) {
      try {
        userKeywords = await database.getUserKeywords(userId, category);
        logger.info(`Found ${userKeywords.length} user keywords for ${category}`);
      } catch (error) {
        logger.warn('Could not fetch user keywords:', error.message);
      }
    }
    
    // Search using user keywords first
    for (const userKeyword of userKeywords.slice(0, 2)) {
      try {
        logger.info(`Searching user keyword: ${userKeyword.keyword}`);
        const articles = await scrapeRealNews(userKeyword.keyword, category);
        allArticles.push(...articles);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(`User keyword search error: ${error.message}`);
      }
    }
    
    // Search using default spicy keywords
    for (const keyword of categoryKeywords.spicy.slice(0, 3)) {
      try {
        logger.info(`Searching spicy keyword: ${keyword}`);
        const articles = await scrapeRealNews(keyword, category);
        allArticles.push(...articles);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(`Spicy search error: ${error.message}`);
      }
    }
    
    // Remove duplicates
    const uniqueArticles = [];
    const seenTitles = new Set();
    
    for (const article of allArticles) {
      const titleKey = article.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50);
      
      if (!seenTitles.has(titleKey)) {
        seenTitles.add(titleKey);
        uniqueArticles.push(article);
      }
    }
    
    // Sort by score
    uniqueArticles.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
    
    logger.info(`Final articles for ${category}: ${uniqueArticles.length}`);
    return uniqueArticles.slice(0, 15);
    
  } catch (error) {
    logger.error(`Enhanced content fetch error: ${error.message}`);
    return [];
  }
}

// Message formatting
async function formatAndSendNewsMessage(chatId, articles, category, bot) {
  if (!articles || articles.length === 0) {
    await bot.sendMessage(chatId, `❌ No recent ${category} news found. Try /refresh`);
    return;
  }

  try {
    const currentTime = getCurrentIndianTime();
    const avgScore = articles.length > 0 ? Math.round(articles.reduce((sum, article) => sum + (article.totalScore || 0), 0) / articles.length) : 0;
    const spicyCount = articles.filter(a => a.spiceScore > 6).length;
    
    const summaryMessage = `🔥 *${category.toUpperCase()} SPICY NEWS* 🔥

📊 *Found: ${articles.length} articles*
🌶️ *Spicy Content: ${spicyCount} articles*
⭐ *Average Score: ${avgScore}/30*
🕐 *Updated: ${currentTime.toLocaleString('en-IN')}*

*Score Legend:* 🌶️ Spice Level | 🕵️ Conspiracy | ⚡ Importance`;
    
    await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send articles in chunks
    const chunkSize = 5;
    const totalChunks = Math.ceil(articles.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, articles.length);
      const chunk = articles.slice(startIndex, endIndex);
      
      let chunkMessage = `🎯 *${category.toUpperCase()} NEWS - Part ${i + 1}/${totalChunks}*\n\n`;
      
      chunk.forEach((article, index) => {
        const globalIndex = startIndex + index + 1;
        
        let cleanTitle = article.title
          .replace(/\*/g, '')
          .replace(/\[/g, '(')
          .replace(/\]/g, ')')
          .substring(0, 70);
        
        if (cleanTitle.length < article.title.length) {
          cleanTitle += '...';
        }
        
        const spiceIcon = article.spiceScore > 7 ? '🔥' : article.spiceScore > 4 ? '🌶️' : '📄';
        
        chunkMessage += `${globalIndex}. 📰 ${spiceIcon} *${cleanTitle}*\n`;
        chunkMessage += `   📊 Score: ${article.totalScore || 0}/30 | 📄 ${article.source} | ⏰ ${article.formattedDate}\n`;
        chunkMessage += `   🔗 [📖 Read Full Story](${article.link})\n\n`;
      });
      
      if (i + 1 === totalChunks) {
        chunkMessage += `✅ *Complete! Total: ${articles.length} articles*\n`;
        chunkMessage += `🎯 *Perfect for YouTube content!*`;
      }
      
      try {
        await bot.sendMessage(chatId, chunkMessage, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
        
        if (i + 1 < totalChunks) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (chunkError) {
        logger.error(`Error sending chunk: ${chunkError.message}`);
      }
    }
    
  } catch (error) {
    logger.error('Message formatting error:', error.message);
    await bot.sendMessage(chatId, `❌ Error displaying news. Try again.`);
  }
}

// Webhook setup
if (bot && isProduction) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  
  bot.setWebHook(`${APP_URL}${webhookPath}`)
    .then(() => {
      logger.info('Webhook set successfully');
    })
    .catch(err => {
      logger.error('Webhook setup failed:', err.message);
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
}

// Bot commands
if (bot) {
  bot.on('polling_error', error => {
    logger.error('Telegram polling error:', error.message);
  });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const welcomeMessage = `🔥 *VIRAL NEWS BOT v3.0* 🔥

*📰 Working Commands:*
/youtubers - YouTube drama & scandal
/bollywood - Celebrity scandals  
/cricket - Sports controversies
/national - Political drama
/pakistan - Pakistani news
/latest - Top scored content

*🔍 Search Commands:*
/search <term> - Search news
/spicy <term> - High controversy only

*🛠️ Keyword Management:*
/addkeyword <category> <keyword> - Add custom
/listkeywords - View your keywords  
/removekeyword <category> <keyword> - Remove

*📊 Other Commands:*
/mystats - Usage statistics
/refresh - Refresh sources
/help - This menu

*Example:* /addkeyword youtubers MrBeast drama

🎬 *Get REAL news with working links!*`;
    
    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    
    try {
      await database.logAnalytics(userId, 'start', 'general', 100);
    } catch (dbError) {
      logger.warn('Analytics failed:', dbError.message);
    }
    
    botStats.totalRequests++;
    botStats.successfulRequests++;
  });

  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateLimitCheck = checkUserRateLimit(userId, 'youtubers');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🎥 *Getting YouTuber drama & scandals...*\n\n🔍 Searching real news sources\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('youtubers', userId);
      
      if (news.length > 0) {
        await formatAndSendNewsMessage(chatId, news, 'YouTuber', bot);
        
        try {
          await database.logAnalytics(userId, 'youtubers', 'youtubers', 5000);
        } catch (dbError) {
          logger.warn('Analytics failed:', dbError.message);
        }
      } else {
        await bot.sendMessage(chatId, `❌ No YouTuber news found. Try adding keywords with /addkeyword youtubers <keyword>`);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('YouTuber command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching YouTuber news. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateLimitCheck = checkUserRateLimit(userId, 'bollywood');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🎭 *Getting Bollywood scandals...*\n\n🔍 Searching celebrity news\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('bollywood', userId);
      
      if (news.length > 0) {
        await formatAndSendNewsMessage(chatId, news, 'Bollywood', bot);
        
        try {
          await database.logAnalytics(userId, 'bollywood', 'bollywood', 5000);
        } catch (dbError) {
          logger.warn('Analytics failed:', dbError.message);
        }
      } else {
        await bot.sendMessage(chatId, `❌ No Bollywood news found. Try adding keywords.`);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Bollywood command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Bollywood news. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateLimitCheck = checkUserRateLimit(userId, 'cricket');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🏏 *Getting Cricket controversies...*\n\n🔍 Searching sports news\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('cricket', userId);
      
      if (news.length > 0) {
        await formatAndSendNewsMessage(chatId, news, 'Cricket', bot);
        
        try {
          await database.logAnalytics(userId, 'cricket', 'cricket', 5000);
        } catch (dbError) {
          logger.warn('Analytics failed:', dbError.message);
        }
      } else {
        await bot.sendMessage(chatId, `❌ No Cricket news found. Try adding keywords.`);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Cricket command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Cricket news. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateLimitCheck = checkUserRateLimit(userId, 'national');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🇮🇳 *Getting Political drama...*\n\n🔍 Searching government news\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('national', userId);
      
      if (news.length > 0) {
        await formatAndSendNewsMessage(chatId, news, 'National', bot);
        
        try {
          await database.logAnalytics(userId, 'national', 'national', 5000);
        } catch (dbError) {
          logger.warn('Analytics failed:', dbError.message);
        }
      } else {
        await bot.sendMessage(chatId, `❌ No National news found. Try adding keywords.`);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('National command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching National news. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateLimitCheck = checkUserRateLimit(userId, 'pakistan');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🇵🇰 *Getting Pakistan news...*\n\n🔍 Searching political crisis\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('pakistan', userId);
      
      if (news.length > 0) {
        await formatAndSendNewsMessage(chatId, news, 'Pakistan', bot);
        
        try {
          await database.logAnalytics(userId, 'pakistan', 'pakistan', 5000);
        } catch (dbError) {
          logger.warn('Analytics failed:', dbError.message);
        }
      } else {
        await bot.sendMessage(chatId, `❌ No Pakistan news found. Try adding keywords.`);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Pakistan command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Pakistan news. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchTerm = match[1].trim();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'search');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    if (searchTerm.length < 2) {
      await bot.sendMessage(chatId, `❌ Search term too short! Usage: /search <term>`);
      return;
    }

    try {
      await bot.sendMessage(chatId, `🔍 *SEARCHING: "${searchTerm}"*\n\n🌐 Getting real news...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      
      if (searchResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No results found for "${searchTerm}"`);
        return;
      }

      await formatAndSendNewsMessage(chatId, searchResults, `Search: ${searchTerm}`, bot);
      
      try {
        await database.logAnalytics(userId, 'search', 'search', 3000);
      } catch (dbError) {
        logger.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;

    } catch (error) {
      logger.error(`Search error: ${error.message}`);
      await bot.sendMessage(chatId, `❌ Search failed. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      await bot.sendMessage(chatId, `❌ Usage: /addkeyword <category> <keyword>\n\nCategories: youtubers, bollywood, cricket, national, pakistan\n\nExample: /addkeyword youtubers MrBeast`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!ENHANCED_SEARCH_KEYWORDS[category]) {
      await bot.sendMessage(chatId, `❌ Invalid category!\n\nValid: youtubers, bollywood, cricket, national, pakistan`);
      return;
    }
    
    try {
      const existingKeywords = await database.getUserKeywords(userId, category);
      const keywordExists = existingKeywords.some(k => k.keyword.toLowerCase() === keyword.toLowerCase());
      
      if (keywordExists) {
        await bot.sendMessage(chatId, `⚠️ Already exists! "${keyword}" is in your ${category} keywords`);
        return;
      }
      
      await database.addUserKeyword(userId, category, keyword, 5);
      
      const totalKeywords = existingKeywords.length + 1;
      
      await bot.sendMessage(chatId, `✅ *Keyword Added Successfully!*

📝 *Added:* "${keyword}"
📂 *Category:* ${category}
📊 *Your total keywords:* ${totalKeywords}

🚀 Use /${category} to see results with your keyword!`, { parse_mode: 'Markdown' });
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Add keyword error:', error);
      await bot.sendMessage(chatId, `❌ Error adding keyword. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/listkeywords/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      let message = '📝 *YOUR CUSTOM KEYWORDS*\n\n';
      let totalKeywords = 0;
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      
      for (const category of categories) {
        try {
          const userKeywords = await database.getUserKeywords(userId, category);
          const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
          
          message += `${icon} *${category.toUpperCase()}* (${userKeywords.length}):\n`;
          
          if (userKeywords.length > 0) {
            userKeywords.forEach((k, index) => {
              message += `${index + 1}. ${k.keyword}\n`;
            });
          } else {
            message += `• No keywords yet\n`;
          }
          message += '\n';
          totalKeywords += userKeywords.length;
        } catch (categoryError) {
          logger.error(`Error fetching ${category} keywords:`, categoryError);
          message += `${category.toUpperCase()}: Error loading\n\n`;
        }
      }
      
      message += `📊 *Total Keywords:* ${totalKeywords}\n\n`;
      message += `💡 *Add more:* /addkeyword <category> <keyword>\n`;
      message += `🗑️ *Remove:* /removekeyword <category> <keyword>`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('List keywords error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching keywords. Database may be initializing. Try again in a moment.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/removekeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      await bot.sendMessage(chatId, `❌ Usage: /removekeyword <category> <keyword>\n\nExample: /removekeyword youtubers drama`);
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!ENHANCED_SEARCH_KEYWORDS[category]) {
      await bot.sendMessage(chatId, `❌ Invalid category!\n\nValid: youtubers, bollywood, cricket, national, pakistan`);
      return;
    }
    
    try {
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
        await bot.sendMessage(chatId, `❌ Not found! "${keyword}" not in your ${category} keywords`);
        return;
      }
      
      const remainingKeywords = await database.getUserKeywords(userId, category);
      
      await bot.sendMessage(chatId, `✅ *Keyword Removed!*

🗑️ *Removed:* "${keyword}"
📂 *Category:* ${category}
📊 *Remaining:* ${remainingKeywords.length}`, { parse_mode: 'Markdown' });
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Remove keyword error:', error);
      await bot.sendMessage(chatId, `❌ Error removing keyword. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/mystats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const userStats = await new Promise((resolve, reject) => {
        database.db.all(
          `SELECT command, COUNT(*) as count 
           FROM bot_analytics 
           WHERE user_id = ? 
           GROUP BY command 
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
        message += `📈 *No data yet*\n\nStart using commands to see stats!`;
      } else {
        const totalRequests = userStats.reduce((sum, stat) => sum + stat.count, 0);
        
        message += `🎯 *Total Requests:* ${totalRequests}\n\n`;
        message += `📋 *Command Usage:*\n`;
        
        userStats.forEach(stat => {
          const icon = stat.command === 'youtubers' ? '📱' : stat.command === 'bollywood' ? '🎬' : stat.command === 'cricket' ? '🏏' : stat.command === 'pakistan' ? '🇵🇰' : '🔍';
          message += `${icon} /${stat.command}: ${stat.count} times\n`;
        });
        
        const mostUsed = userStats[0];
        message += `\n🏆 *Most Used:* /${mostUsed.command} (${mostUsed.count} times)`;
      }
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('User stats error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching statistics`);
      botStats.errors++;
    }
  });

  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      await bot.sendMessage(chatId, '🔄 *Getting top content from all categories...*', { parse_mode: 'Markdown' });
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      const allNews = [];
      
      for (const category of categories) {
        try {
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error(`Error fetching ${category}:`, error.message);
        }
      }
      
      const topNews = allNews
        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
        .slice(0, 10);
      
      if (topNews.length > 0) {
        await formatAndSendNewsMessage(chatId, topNews, 'Latest Top', bot);
      } else {
        await bot.sendMessage(chatId, `❌ No recent news found. Try /refresh`);
      }
      
      try {
        await database.logAnalytics(userId, 'latest', 'all', 8000);
      } catch (dbError) {
        logger.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Latest command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching latest news`);
      botStats.errors++;
    }
  });

  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateLimitCheck = checkUserRateLimit(userId, 'refresh');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🔄 *Refreshing all sources...*\n\n⏳ Getting latest news\n🕐 Started: ${getCurrentIndianTime().toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
      
      newsCache = [];
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      const allNews = [];
      
      for (const category of categories) {
        try {
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          logger.error(`Error refreshing ${category}:`, error.message);
        }
      }
      
      newsCache = allNews;
      
      const avgScore = newsCache.length > 0 ? Math.round(newsCache.reduce((sum, item) => sum + (item.totalScore || 0), 0) / newsCache.length) : 0;
      const spicyCount = newsCache.filter(a => a.spiceScore > 6).length;
      
      await bot.sendMessage(chatId, `✅ *Refresh Complete!*

📊 *Articles found:* ${newsCache.length}
⭐ *Average Score:* ${avgScore}/30
🌶️ *Spicy Content:* ${spicyCount} articles
🕐 *Completed:* ${getCurrentIndianTime().toLocaleString('en-IN')}
✅ *All links are working!*`, { parse_mode: 'Markdown' });
      
      try {
        await database.logAnalytics(userId, 'refresh', 'all', 15000);
      } catch (dbError) {
        logger.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      logger.error('Refresh error:', error);
      await bot.sendMessage(chatId, `❌ Refresh failed. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `⚙️ *BOT HELP & FEATURES*

*🎯 News Commands:*
/youtubers - YouTube drama 🎥
/bollywood - Celebrity scandals 🎭
/cricket - Sports news 🏏
/national - Political news 🇮🇳
/pakistan - Pakistan news 🇵🇰
/latest - Top content 🔥

*🔍 Search Commands:*
/search <term> - Search news
/spicy <term> - High controversy only

*🛠️ Keyword Management:*
/addkeyword <category> <keyword> - Add custom
/listkeywords - View your keywords
/removekeyword <category> <keyword> - Remove

*📊 Other Commands:*
/mystats - Your usage stats
/refresh - Refresh all sources
/help - This menu

*Examples:*
• /addkeyword youtubers CarryMinati
• /search Bollywood scandal
• /spicy cricket controversy

🎬 *Get real news with working links!*`;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });

  logger.info('Bot initialized successfully!');
} else {
  logger.warn('Bot not initialized - missing BOT_TOKEN');
}

// Express routes
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  
  res.json({ 
    status: 'Viral News Bot v3.0 - Working Links & Real News',
    version: '3.0.0',
    features: ['Real News Articles', 'Working Links', 'Custom Keywords', 'Content Scoring'],
    stats: {
      totalNews: newsCache.length,
      uptime: uptime,
      totalRequests: botStats.totalRequests,
      successRate: botStats.totalRequests > 0 ? Math.round((botStats.successfulRequests / botStats.totalRequests) * 100) : 0
    },
    lastUpdate: getCurrentIndianTime().toLocaleString('en-IN')
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime(),
    features: {
      realNews: true,
      workingLinks: true,
      customKeywords: true,
      contentScoring: true
    }
  });
});

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'pong',
    timestamp: getCurrentIndianTime().toLocaleString('en-IN'),
    version: '3.0.0'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 News Bot v3.0 running on port ${PORT}`);
  logger.info(`🌐 URL: ${APP_URL}`);
  logger.info(`📱 Bot: ${BOT_TOKEN ? 'Active' : 'Missing Token'}`);
  logger.info(`🕐 Started: ${getCurrentIndianTime().toLocaleString('en-IN')}`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

module.exports = { app, bot, database };
