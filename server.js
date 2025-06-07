const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const Filter = require('bad-words');

const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

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

const filter = new Filter();
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

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
        if (err) console.error('Database error:', err);
      });
    });
  }
  
  async addUserKeyword(userId, category, keyword, priority = 1) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO user_keywords (user_id, category, keyword, priority) VALUES (?, ?, ?, ?)',
        [userId, category, keyword, priority],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
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
          if (err) reject(err);
          else resolve(rows);
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
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }
}

const database = new NewsDatabase();
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,
  webHook: isProduction 
}) : null;

const app = express();
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);

let newsCache = [];
let userRateLimits = new Map();
let botStats = {
  totalRequests: 0,
  successfulRequests: 0,
  errors: 0,
  startTime: Date.now()
};

const ENHANCED_RSS_SOURCES = {
  youtubers: [
    'https://timesofindia.indiatimes.com/rssfeeds/54829575.cms',
    'https://feeds.feedburner.com/ndtvnews-trending-news',
    'https://www.indiatoday.in/rss/1206514',
    'https://news.google.com/rss/search?q=YouTubers+India&hl=en&gl=IN&ceid=IN:en'
  ],
  bollywood: [
    'https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms',
    'https://feeds.feedburner.com/ndtvnews-trending-news',
    'https://www.indiatoday.in/rss/1206514',
    'https://news.google.com/rss/search?q=Bollywood+scandal&hl=en&gl=IN&ceid=IN:en'
  ],
  cricket: [
    'https://timesofindia.indiatimes.com/rssfeeds/4719148.cms',
    'https://feeds.feedburner.com/ndtvsports-latest',
    'https://www.indiatoday.in/rss/1206570',
    'https://news.google.com/rss/search?q=Cricket+India&hl=en&gl=IN&ceid=IN:en'
  ],
  national: [
    'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
    'https://feeds.feedburner.com/ndtvnews-india-news',
    'https://www.indiatoday.in/rss/1206514',
    'https://news.google.com/rss/search?q=India+politics&hl=en&gl=IN&ceid=IN:en'
  ],
  pakistan: [
    'https://www.dawn.com/feeds/home',
    'https://arynews.tv/en/feed/',
    'https://news.google.com/rss/search?q=Pakistan+politics&hl=en&gl=PK&ceid=PK:en'
  ]
};

const ENHANCED_SEARCH_KEYWORDS = {
  youtubers: { spicy: [] },
  bollywood: { spicy: [] },
  cricket: { spicy: [] },
  national: { spicy: [] },
  pakistan: { spicy: [] }
};

const SPICY_KEYWORDS = ['controversy', 'drama', 'fight', 'viral', 'trending', 'breaking', 'scandal', 'exposed', 'beef', 'roast', 'diss', 'leaked', 'secret'];
const CONSPIRACY_KEYWORDS = ['conspiracy', 'secret', 'hidden', 'exposed', 'leaked', 'revelation', 'behind scenes', 'truth', 'cover up'];
const IMPORTANCE_KEYWORDS = ['breaking', 'urgent', 'alert', 'emergency', 'crisis', 'important'];

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
    const diffInHours = Math.floor(diffInMinutes / 60);
    
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    const daysDiff = Math.floor(diffInHours / 24);
    if (daysDiff === 1) return 'Yesterday';
    if (daysDiff < 7) return `${daysDiff}d ago`;
    
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
    if (content.includes(keyword.toLowerCase())) score += 2;
  });
  return Math.min(score, 10);
}

function calculateConspiracyScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  CONSPIRACY_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) score += 3;
  });
  return Math.min(score, 10);
}

function calculateImportanceScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  IMPORTANCE_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) score += 3;
  });
  return Math.min(score, 10);
}

function categorizeNews(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  if (content.match(/youtube|youtuber|creator|influencer|vlog|gaming|streaming|content creator|viral video|subscriber|channel|video|upload/i)) {
    return 'youtubers';
  }
  if (content.match(/bollywood|hindi film|movie|cinema|actor|actress|film industry|director|producer|entertainment industry|indian cinema/i)) {
    return 'bollywood';
  }
  if (content.match(/cricket|ipl|t20|odi|test match|wicket|batsman|bowler|fielder|stadium|tournament|league|match|team|player|sport/i)) {
    return 'cricket';
  }
  if (content.match(/pakistan|pakistani|karachi|lahore|islamabad|pti|pmln|imran khan|shehbaz sharif|punjab|sindh|balochistan|kpk/i)) {
    return 'pakistan';
  }
  return 'national';
}

function checkUserRateLimit(userId, command) {
  const key = `${userId}:${command}`;
  const now = Date.now();
  const userHistory = userRateLimits.get(key) || [];
  const filtered = userHistory.filter(time => now - time < 3600000);
  
  if (filtered.length >= 15) {
    return {
      allowed: false,
      resetTime: Math.ceil((filtered[0] + 3600000 - now) / 60000)
    };
  }
  
  filtered.push(now);
  userRateLimits.set(key, filtered);
  return { allowed: true };
}

async function scrapeRealNews(query, category) {
  try {
    console.log(`⚡ FAST search: "${query}" in ${category}`);
    const articles = [];
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get RSS sources for category
    const rssSources = ENHANCED_RSS_SOURCES[category] || [];
    console.log(`📡 Using ${rssSources.length} WORKING sources for ${category}`);
    
    for (let sourceIndex = 0; sourceIndex < rssSources.length; sourceIndex++) {
      const rssUrl = rssSources[sourceIndex];
      
      try {
        console.log(`🔍 Source ${sourceIndex + 1}/${rssSources.length}`);
        
        const response = await axios.get(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml'
          },
          timeout: 8000 // Faster timeout
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        let foundInThisSource = 0;
        
        // Handle both RSS and Atom formats
        const items = $('item').length > 0 ? $('item') : $('entry');
        
        items.each((i, elem) => {
          if (i >= 15 || foundInThisSource >= 10) return false; // Strict limits for speed
          
          const $elem = $(elem);
          const title = $elem.find('title').text().trim();
          const link = $elem.find('link').attr('href') || $elem.find('link').text().trim();
          const pubDate = $elem.find('pubDate').text().trim() || $elem.find('published').text().trim();
          const description = $elem.find('description').text().trim() || $elem.find('summary').text().trim();
          
          if (title && link && title.length > 10) {
            // EXACT keyword matching - STRICT
            const titleLower = title.toLowerCase();
            const descLower = description.toLowerCase();
            const queryLower = query.toLowerCase();
            
            // STRICT keyword matching with word boundaries
            let hasMatch = false;
            
            // Create regex for exact word match
            const createWordRegex = (word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            
            // 1. Full keyword exact match
            if (titleLower.includes(queryLower) || descLower.includes(queryLower)) {
              hasMatch = true;
            }
            // 2. Word boundary match (complete words only)
            else {
              const queryWords = queryLower.split(' ').filter(word => word.length > 2);
              hasMatch = queryWords.some(word => {
                const regex = createWordRegex(word);
                return regex.test(title) || regex.test(description);
              });
            }

            if (hasMatch) {
              let articleDate = new Date();
              if (pubDate) {
                const parsedDate = new Date(pubDate);
                if (!isNaN(parsedDate.getTime())) {
                  articleDate = parsedDate;
                }
              }
              
              const hoursAgo = Math.floor((now - articleDate) / (1000 * 60 * 60));
              
              if (articleDate >= last24Hours && hoursAgo <= 24) {
                let realUrl = link;
                try {
                  if (link.includes('url=')) {
                    const urlMatch = link.match(/url=([^&]+)/);
                    if (urlMatch) {
                      realUrl = decodeURIComponent(urlMatch[1]);
                    }
                  }
                  if (!realUrl.startsWith('http')) {
                    realUrl = 'https://' + realUrl;
                  }
                } catch (e) {
                  realUrl = link;
                }
                
                // Extract source name from RSS URL
                let source = rssUrl.split('/')[2].replace('www.', '');
                if (source.includes('timesofindia')) source = 'Times of India';
                else if (source.includes('ndtv')) source = 'NDTV';
                else if (source.includes('indiatoday')) source = 'India Today';
                else if (source.includes('india.com')) source = 'India.com';
                else if (source.includes('news.google')) source = 'Google News';
                else if (source.includes('dawn.com')) source = 'Dawn';
                else if (source.includes('arynews')) source = 'ARY News';
                
                let cleanTitle = title.replace(/\s+/g, ' ').trim();
                
                // Remove source name from title if present
                if (cleanTitle.includes(' - ') && cleanTitle.includes(source)) {
                  cleanTitle = cleanTitle.split(' - ')[0].trim();
                }
                
                const titleKey = cleanTitle.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 30);
                const isDuplicate = articles.some(existing => {
                  const existingKey = existing.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 30);
                  return titleKey === existingKey || existing.link === realUrl;
                });
                
                if (!isDuplicate) {
                  const spiceScore = calculateSpiceScore(cleanTitle, description);
                  const conspiracyScore = calculateConspiracyScore(cleanTitle, description);
                  const importanceScore = calculateImportanceScore(cleanTitle, description);
                  
                  // BULLETPROOF STRICT matching - EXACT PHRASES ONLY
                  let matchPriority = 0;
                  if (titleLower.includes(queryLower)) {
                    matchPriority = 100; // Title match
                  } else if (descLower.includes(queryLower)) {
                    matchPriority = 50;  // Description match
                  }
                  
                  articles.push({
                    title: cleanTitle,
                    link: realUrl,
                    pubDate: pubDate,
                    formattedDate: formatNewsDate(pubDate),
                    description: description ? description.substring(0, 120) + '...' : '',
                    source: source,
                    category: category,
                    timestamp: articleDate.toISOString(),
                    platform: 'rss',
                    reliability: 9,
                    isVerified: true,
                    spiceScore: spiceScore,
                    conspiracyScore: conspiracyScore,
                    importanceScore: importanceScore,
                    totalScore: spiceScore + conspiracyScore + importanceScore,
                    hoursAgo: hoursAgo,
                    sourceType: source,
                    rssSource: rssUrl,
                    matchedKeyword: query,
                    matchPriority: matchPriority  // NEW FIELD
                  });
                  
                  foundInThisSource++;
                }
              }
            }
          }
        });
        
        console.log(`✅ Source completed: Found ${foundInThisSource} EXACT matches`);
        
        // Reduced delay for speed
        if (sourceIndex < rssSources.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second only
        }
        
      } catch (error) {
        console.error(`❌ Source ${sourceIndex + 1} failed: ${error.message}`);
      }
    }
    
    // Sort by match priority FIRST, then score, then recency
    articles.sort((a, b) => {
    // 1. Match priority is KING (huge difference)
    const priorityDiff = (b.matchPriority || 0) - (a.matchPriority || 0);
    if (priorityDiff !== 0) return priorityDiff;
    
    // 2. Score only matters within SAME priority level
    const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
    if (Math.abs(scoreDiff) > 1) return scoreDiff;
    
    // 3. Recency as final tie-breaker
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
    
    console.log(`🎯 Total EXACT matches: ${articles.length}`);
    return articles;
    
  } catch (error) {
    console.error(`RSS scraping error: ${error.message}`);
    return [];
  }
}

async function addMultipleKeywords(userId, category, keywordsString) {
  const keywords = keywordsString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const results = [];
  
  for (const keyword of keywords) {
    try {
      const existingKeywords = await database.getUserKeywords(userId, category);
      const keywordExists = existingKeywords.some(k => k.keyword.toLowerCase() === keyword.toLowerCase());
      
      if (!keywordExists) {
        await database.addUserKeyword(userId, category, keyword, 5);
        results.push({ keyword, status: 'added' });
      } else {
        results.push({ keyword, status: 'exists' });
      }
    } catch (error) {
      results.push({ keyword, status: 'error' });
    }
  }
  
  return results;
}

async function fetchEnhancedContent(category, userId = null) {
  try {
    console.log(`⚡ FAST fetch for ${category} - USER KEYWORDS ONLY`);
    
    const allArticles = [];
    let userKeywords = [];
    
    if (userId) {
      try {
        userKeywords = await database.getUserKeywords(userId, category);
        console.log(`📝 Found ${userKeywords.length} user keywords for ${category}`);
      } catch (error) {
        console.warn('Could not fetch user keywords:', error.message);
        return [];
      }
    }
    
    if (userKeywords.length === 0) {
      console.log(`❌ No user keywords found for ${category}. User must add keywords first.`);
      return [];
    }
    
    // USE ALL KEYWORDS - User ne add kiye hain to sabhi search karne padenge
    console.log(`🎯 Using ALL ${userKeywords.length} keywords`);
    
    for (let i = 0; i < userKeywords.length; i++) {
      const userKeyword = userKeywords[i];
      try {
        console.log(`   🎯 KEYWORD ${i + 1}/${userKeywords.length}: "${userKeyword.keyword}"`);
        const articles = await scrapeRealNews(userKeyword.keyword, category);
        console.log(`   ✅ Found ${articles.length} EXACT matches for: ${userKeyword.keyword}`);
        
        articles.forEach(article => {
          article.searchKeyword = userKeyword.keyword;
          article.keywordPriority = userKeyword.priority || 1;
        });
        
        allArticles.push(...articles);
        
        // Shorter delay between keywords for SPEED
        if (i < userKeywords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800)); // Reduced to 0.8 seconds
        }
        
      } catch (error) {
        console.error(`❌ Error searching for "${userKeyword.keyword}": ${error.message}`);
      }
    }
    
    // SMART deduplication
    const uniqueArticles = [];
    const seenTitles = new Set();
    const seenUrls = new Set();
    
    for (const article of allArticles) {
      const titleKey = article.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim().substring(0, 25);
      const urlKey = article.link.toLowerCase().replace(/[^\w]/g, '').substring(0, 40);
      
      if (!seenTitles.has(titleKey) && !seenUrls.has(urlKey)) {
        seenTitles.add(titleKey);
        seenUrls.add(urlKey);
        uniqueArticles.push(article);
      }
    }
    
    // SMART sorting - Priority + Score + Recency
    uniqueArticles.sort((a, b) => {
      const priorityDiff = (b.keywordPriority || 1) - (a.keywordPriority || 1);
      if (priorityDiff !== 0) return priorityDiff;
      
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff;
      
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // EXACTLY 50 articles max
    const finalArticles = uniqueArticles.slice(0, 50);
    console.log(`✅ FINAL: ${finalArticles.length} EXACT matches for ${category}`);
    
    return finalArticles;
    
  } catch (error) {
    console.error(`Enhanced content fetch error: ${error.message}`);
    return [];
  }
}

function createFallbackContent(category) {
  return [{
    title: `Add keywords to get ${category} news`,
    link: "https://www.google.com/search?q=how+to+add+keywords",
    pubDate: getCurrentTimestamp(),
    formattedDate: "Now",
    source: "Bot Help",
    category: category,
    timestamp: getCurrentTimestamp(),
    spiceScore: 0,
    conspiracyScore: 0,
    importanceScore: 10,
    totalScore: 10,
    searchKeyword: "help",
    description: `Use /addkeyword ${category} <your_keyword> to start getting news`
  }];
}

async function removeMultipleKeywords(userId, category, keywordsString) {
  const keywords = keywordsString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const results = [];
  
  for (const keyword of keywords) {
    try {
      const removed = await new Promise((resolve, reject) => {
        database.db.run(
          'DELETE FROM user_keywords WHERE user_id = ? AND category = ? AND keyword = ?',
          [userId, category, keyword],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes > 0);
          }
        );
      });
      
      if (removed) {
        results.push({ keyword, status: 'removed' });
      } else {
        results.push({ keyword, status: 'not_found' });
      }
    } catch (error) {
      results.push({ keyword, status: 'error' });
    }
  }
  
  return results;
}

async function formatAndSendNewsMessage(chatId, articles, category, bot) {
  if (!articles || articles.length === 0) {
    await bot.sendMessage(chatId, `❌ No news found for ${category}!\n\n*Reason:* No keywords added yet.\n\n*Solution:* Add keywords first:\n/addkeyword ${category} <your_keyword>\n\n*Example:* /addkeyword ${category} trending topic`);
    return;
  }

  try {
    const currentTime = getCurrentIndianTime();
    const avgScore = articles.length > 0 ? Math.round(articles.reduce((sum, article) => sum + (article.totalScore || 0), 0) / articles.length) : 0;
    const spicyCount = articles.filter(a => (a.spiceScore || 0) > 6).length;
    const conspiracyCount = articles.filter(a => (a.conspiracyScore || 0) > 5).length;
    
    const summaryMessage = `🔥 *${category.toUpperCase()} USER KEYWORDS NEWS* 🔥

📊 *Found: ${articles.length} articles (Last 24 hours)*
🌶️ *Spicy Content: ${spicyCount} articles*
🕵️ *Conspiracy Content: ${conspiracyCount} articles*
⭐ *Average Score: ${avgScore}/30*
🌐 *Sources: Worldwide multi-source fetch*
🕐 *Updated: ${currentTime.toLocaleString('en-IN')}*

*🎯 Only YOUR keywords searched - No default keywords!*
*Score Legend:* 🌶️ Spice | 🕵️ Conspiracy | ⚡ Importance`;
    
    await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const chunkSize = 5;
    const totalChunks = Math.ceil(articles.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, articles.length);
      const chunk = articles.slice(startIndex, endIndex);
      
      let chunkMessage = `🎯 *${category.toUpperCase()} NEWS - Part ${i + 1}/${totalChunks}*\n\n`;
      
      chunk.forEach((article, index) => {
        const globalIndex = startIndex + index + 1;
        
        let cleanTitle = article.title.replace(/\*/g, '').replace(/\[/g, '(').replace(/\]/g, ')').replace(/`/g, "'").replace(/_/g, '-').substring(0, 60);
        
        if (cleanTitle.length < article.title.length) {
          cleanTitle += '...';
        }
        
        const spiceIcon = (article.spiceScore || 0) > 7 ? '🔥' : (article.spiceScore || 0) > 4 ? '🌶️' : '📄';
        const conspiracyIcon = (article.conspiracyScore || 0) > 6 ? '🕵️‍♂️' : (article.conspiracyScore || 0) > 3 ? '🤔' : '';
        const importanceIcon = (article.importanceScore || 0) > 6 ? '⚡' : (article.importanceScore || 0) > 3 ? '📢' : '';
        
        const keywordInfo = article.searchKeyword ? ` [🔍 ${article.searchKeyword}]` : '';
        const sourceInfo = article.sourceType ? ` [🌐 ${article.sourceType}]` : '';
        
        chunkMessage += `${globalIndex}. 📰 ${spiceIcon}${conspiracyIcon}${importanceIcon} *${cleanTitle}*\n`;
        chunkMessage += `   📊 Score: ${article.totalScore || 0}/30 | ⏰ ${article.formattedDate || 'Recent'}${keywordInfo}\n`;
        chunkMessage += `   📄 ${article.source || 'News'}${sourceInfo}\n`;
        chunkMessage += `   🔗 [📖 Read Full Story](${article.link})\n\n`;
      });
      
      if (i + 1 === totalChunks) {
        const topScore = articles.length > 0 ? Math.max(...articles.map(a => a.totalScore || 0)) : 0;
        const uniqueKeywords = [...new Set(articles.map(a => a.searchKeyword).filter(k => k))];
        chunkMessage += `✅ *Complete! Total: ${articles.length} articles*\n`;
        chunkMessage += `🏆 *Highest Score: ${topScore}/30*\n`;
        chunkMessage += `🎯 *Keywords used: ${uniqueKeywords.length}* | 🌐 *Direct links only!*`;
      } else {
        chunkMessage += `📄 *Part ${i + 1}/${totalChunks} • More content coming...*`;
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
        console.error(`Error sending chunk ${i + 1}: ${chunkError.message}`);
        
        try {
          await bot.sendMessage(chatId, `📰 *${category.toUpperCase()}* - Part ${i + 1}\n\n${chunk.length} articles found but couldn't display due to formatting.`, { parse_mode: 'Markdown' });
        } catch (fallbackError) {
          console.error(`Fallback failed: ${fallbackError.message}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Message formatting error:', error.message);
    await bot.sendMessage(chatId, `❌ Error displaying news. Try again.`);
  }
}

// Webhook setup for production
if (bot && isProduction) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  const webhookUrl = `${APP_URL}${webhookPath}`;
  
  bot.setWebHook(webhookUrl).then(() => {
    console.log('✅ Webhook set successfully');
  }).catch(err => {
    console.error('❌ Webhook setup failed:', err.message);
  });
  
  app.post(webhookPath, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('Webhook processing error:', error.message);
      res.sendStatus(500);
    }
  });
}

// Bot error handling
if (bot) {
  bot.on('polling_error', error => {
    console.error('Telegram polling error:', error.message);
  });

  bot.on('webhook_error', error => {
    console.error('Webhook error:', error.message);
  });

  // Command: /start
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const welcomeMessage = `🔥 *VIRAL NEWS BOT v3.0* 🔥

*📰 Enhanced Commands:*
/youtubers - YouTube drama & scandals 🎥
/bollywood - Celebrity controversies 🎭
/cricket - Sports scandals & fixes 🏏
/national - Political drama & corruption 🇮🇳
/pakistan - Pakistani political crisis 🇵🇰
/latest - Top scored content from all categories 🔥

*🔍 Smart Search Commands:*
/search <term> - Multi-source news search
/spicy <term> - High controversy content only (6+ spice)

*🛠️ Keyword Management:*
/addkeyword <category> <keyword> - Add custom keywords
/listkeywords - View all your keywords  
/removekeyword <category> <keyword> - Remove keywords

*📊 Analytics & Info:*
/mystats - Your usage statistics
/refresh - Force refresh all sources
/help - This complete menu

*Example Commands:*
• /addkeyword youtubers CarryMinati controversy
• /search Elvish Yadav drama
• /spicy YouTube scandal

🎬 *Get the SPICIEST content for your channel!*`;
    
    try {
      await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'start', 'general', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Start command error:', error);
      botStats.errors++;
    }
  });

  // Command: /youtubers
  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'youtubers');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🎥 *Getting YouTuber news...*\n\n🔍 Searching your keywords\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('youtubers', userId);
      
      if (news.length > 0) {
        newsCache = newsCache.filter(article => article.category !== 'youtubers');
        newsCache.push(...news);
        await formatAndSendNewsMessage(chatId, news, 'YouTuber', bot);
        
        const responseTime = Date.now() - startTime;
        try {
          await database.logAnalytics(userId, 'youtubers', 'youtubers', responseTime);
        } catch (dbError) {
          console.warn('Analytics failed:', dbError.message);
        }
      } else {
        const fallbackContent = createFallbackContent('youtubers');
        await formatAndSendNewsMessage(chatId, fallbackContent, 'YouTuber', bot);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('YouTuber command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching YouTuber news. Try /addkeyword youtubers <creator_name>`);
      botStats.errors++;
    }
  });

  // Command: /bollywood
  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'bollywood');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🎭 *Getting Bollywood news...*\n\n🔍 Searching your keywords\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('bollywood', userId);
      const bollywoodNews = news.length > 0 ? news : createFallbackContent('bollywood');
      
      newsCache = newsCache.filter(article => article.category !== 'bollywood');
      newsCache.push(...bollywoodNews);
      
      await formatAndSendNewsMessage(chatId, bollywoodNews, 'Bollywood', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'bollywood', 'bollywood', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Bollywood command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Bollywood news. Try again.`);
      botStats.errors++;
    }
  });

  // Command: /cricket
  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'cricket');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🏏 *Getting Cricket news...*\n\n🔍 Searching your keywords\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('cricket', userId);
      const cricketNews = news.length > 0 ? news : createFallbackContent('cricket');
      
      newsCache = newsCache.filter(article => article.category !== 'cricket');
      newsCache.push(...cricketNews);
      
      await formatAndSendNewsMessage(chatId, cricketNews, 'Cricket', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'cricket', 'cricket', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Cricket command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Cricket news. Try again.`);
      botStats.errors++;
    }
  });

  // Command: /national
  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'national');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🇮🇳 *Getting National news...*\n\n🔍 Searching your keywords\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('national', userId);
      const nationalNews = news.length > 0 ? news : createFallbackContent('national');
      
      newsCache = newsCache.filter(article => article.category !== 'national');
      newsCache.push(...nationalNews);
      
      await formatAndSendNewsMessage(chatId, nationalNews, 'National', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'national', 'national', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('National command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching National news. Try again.`);
      botStats.errors++;
    }
  });

  // Command: /pakistan
  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'pakistan');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🇵🇰 *Getting Pakistan news...*\n\n🔍 Searching your keywords\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
      const news = await fetchEnhancedContent('pakistan', userId);
      const pakistanNews = news.length > 0 ? news : createFallbackContent('pakistan');
      
      newsCache = newsCache.filter(article => article.category !== 'pakistan');
      newsCache.push(...pakistanNews);
      
      await formatAndSendNewsMessage(chatId, pakistanNews, 'Pakistani', bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'pakistan', 'pakistan', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Pakistan command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Pakistan news. Try again.`);
      botStats.errors++;
    }
  });

  // Command: /latest
  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      await bot.sendMessage(chatId, '🔄 *Getting top-scored content from all categories...*', { parse_mode: 'Markdown' });
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      const allNews = [];
      
      for (const category of categories) {
        try {
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error fetching ${category}:`, error.message);
        }
      }
      
      const topNews = allNews.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)).slice(0, 20);
      
      if (topNews.length > 0) {
        await formatAndSendNewsMessage(chatId, topNews, 'Latest Top', bot);
      } else {
        await bot.sendMessage(chatId, `❌ No recent news found. Add keywords first.`);
      }
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'latest', 'all', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Latest command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching latest news`);
      botStats.errors++;
    }
  });

  // Command: /search
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchTerm = match[1].trim();
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'search');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    if (searchTerm.length < 2) {
      await bot.sendMessage(chatId, `❌ Search term too short!\n\n*Usage:* /search <term>\n*Example:* /search Elvish Yadav`);
      return;
    }

    try {
      await bot.sendMessage(chatId, `🔍 *SEARCH: "${searchTerm}"*\n\n🌐 Searching...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      
      if (searchResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No results found for "${searchTerm}"`);
        return;
      }

      await formatAndSendNewsMessage(chatId, searchResults, `Search: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'search', 'search', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;

    } catch (error) {
      console.error(`Search error: ${error.message}`);
      await bot.sendMessage(chatId, `❌ Search failed. Try again.`);
      botStats.errors++;
    }
  });

  // Command: /spicy
  bot.onText(/\/spicy (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const searchTerm = match[1].trim();
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'spicy');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    if (searchTerm.length < 2) {
      await bot.sendMessage(chatId, `❌ Search term too short!\n\n*Usage:* /spicy <term>\n*Example:* /spicy YouTube drama`);
      return;
    }

    try {
      await bot.sendMessage(chatId, `🌶️ *SPICY SEARCH: "${searchTerm}"*\n\n🔥 Finding controversy...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      const spicyResults = searchResults.filter(article => (article.spiceScore || 0) >= 6);
      
      if (spicyResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No spicy content found for "${searchTerm}"`);
        return;
      }

      await formatAndSendNewsMessage(chatId, spicyResults, `Spicy: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'spicy', 'search', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;

    } catch (error) {
      console.error(`Spicy search error: ${error.message}`);
      await bot.sendMessage(chatId, `❌ Spicy search failed. Try again.`);
      botStats.errors++;
    }
  });

  // Command: /addkeyword
  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const input = match[1].trim();
  const parts = input.split(' ');
  
  if (parts.length < 2) {
    await bot.sendMessage(chatId, `❌ *Usage:* /addkeyword <category> <keywords>

*Categories:* youtubers, bollywood, cricket, national, pakistan

*Single Keyword:*
• /addkeyword youtubers CarryMinati

*Multiple Keywords (comma separated):*
• /addkeyword youtubers CarryMinati, Elvish Yadav, Triggered Insaan
• /addkeyword bollywood Salman Khan, Shah Rukh Khan, Akshay Kumar

*Pro Tip:* Use commas to separate multiple keywords!`, { parse_mode: 'Markdown' });
    return;
  }
  
  const category = parts[0].toLowerCase();
  const keywordsPart = parts.slice(1).join(' ');
  
  if (!ENHANCED_SEARCH_KEYWORDS[category]) {
    await bot.sendMessage(chatId, `❌ Invalid category!\n\n*Valid categories:* youtubers, bollywood, cricket, national, pakistan`);
    return;
  }
  
  try {
    // Check if multiple keywords (contains comma)
    if (keywordsPart.includes(',')) {
      const results = await addMultipleKeywords(userId, category, keywordsPart);
      
      const added = results.filter(r => r.status === 'added');
      const existing = results.filter(r => r.status === 'exists');
      const errors = results.filter(r => r.status === 'error');
      
      let message = `📝 *MULTIPLE KEYWORDS PROCESSED*\n\n`;
      
      if (added.length > 0) {
        message += `✅ *Added (${added.length}):*\n`;
        added.forEach(r => message += `• ${r.keyword}\n`);
        message += '\n';
      }
      
      if (existing.length > 0) {
        message += `⚠️ *Already Exist (${existing.length}):*\n`;
        existing.forEach(r => message += `• ${r.keyword}\n`);
        message += '\n';
      }
      
      if (errors.length > 0) {
        message += `❌ *Errors (${errors.length}):*\n`;
        errors.forEach(r => message += `• ${r.keyword}\n`);
        message += '\n';
      }
      
      message += `📂 *Category:* ${category}\n`;
      message += `🚀 Use /${category} to see results!`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } else {
      // Single keyword (existing logic)
      const keyword = keywordsPart;
      const existingKeywords = await database.getUserKeywords(userId, category);
      const keywordExists = existingKeywords.some(k => k.keyword.toLowerCase() === keyword.toLowerCase());
      
      if (keywordExists) {
        await bot.sendMessage(chatId, `⚠️ Already exists! "${keyword}" is already in your ${category} keywords`);
        return;
      }
      
      await database.addUserKeyword(userId, category, keyword, 5);
      
      const totalKeywords = existingKeywords.length + 1;
      
      await bot.sendMessage(chatId, `✅ *Keyword Added Successfully!*

📝 *Added:* "${keyword}"
📂 *Category:* ${category}
📊 *Your total keywords:* ${totalKeywords}

🚀 Use /${category} to see results with your keyword!`, { parse_mode: 'Markdown' });
    }
    
    botStats.totalRequests++;
    botStats.successfulRequests++;
    
  } catch (error) {
    console.error('Add keyword error:', error);
    await bot.sendMessage(chatId, `❌ Error adding keyword. Try again.`);
    botStats.errors++;
  }
});

  // Command: /listkeywords
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
        console.error(`Error fetching ${category} keywords:`, categoryError);
      }
    }
    
    message += `📊 *Total Keywords:* ${totalKeywords}\n\n`;
    message += `💡 *Add more:* /addkeyword <category> <keyword>\n`;
    message += `🗑️ *Remove:* /removekeyword <category> <keyword>`;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    botStats.totalRequests++;
    botStats.successfulRequests++;
    
  } catch (error) {
    console.error('List keywords error:', error);
    await bot.sendMessage(chatId, `❌ Error fetching keywords. Try again.`);
    botStats.errors++;
  }
});
  
  // Command: /removekeyword
  bot.onText(/\/removekeyword (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const input = match[1].trim();
  const parts = input.split(' ');
  
  if (parts.length < 2) {
    await bot.sendMessage(chatId, `❌ *Usage:* /removekeyword <category> <keywords>

*Single Keyword:*
• /removekeyword youtubers CarryMinati

*Multiple Keywords (comma separated):*
• /removekeyword youtubers CarryMinati, Elvish Yadav, Triggered Insaan

*Categories:* youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
    return;
  }
  
  const category = parts[0].toLowerCase();
  const keywordsPart = parts.slice(1).join(' ');
  
  if (!ENHANCED_SEARCH_KEYWORDS[category]) {
    await bot.sendMessage(chatId, `❌ Invalid category!\n\n*Valid categories:* youtubers, bollywood, cricket, national, pakistan`);
    return;
  }
  
  try {
    // Check if multiple keywords (contains comma)
    if (keywordsPart.includes(',')) {
      const results = await removeMultipleKeywords(userId, category, keywordsPart);
      
      const removed = results.filter(r => r.status === 'removed');
      const notFound = results.filter(r => r.status === 'not_found');
      const errors = results.filter(r => r.status === 'error');
      
      let message = `🗑️ *MULTIPLE KEYWORDS REMOVAL*\n\n`;
      
      if (removed.length > 0) {
        message += `✅ *Removed (${removed.length}):*\n`;
        removed.forEach(r => message += `• ${r.keyword}\n`);
        message += '\n';
      }
      
      if (notFound.length > 0) {
        message += `⚠️ *Not Found (${notFound.length}):*\n`;
        notFound.forEach(r => message += `• ${r.keyword}\n`);
        message += '\n';
      }
      
      if (errors.length > 0) {
        message += `❌ *Errors (${errors.length}):*\n`;
        errors.forEach(r => message += `• ${r.keyword}\n`);
        message += '\n';
      }
      
      message += `📂 *Category:* ${category}`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } else {
      // Single keyword removal
      const keyword = keywordsPart;
      
      const removed = await new Promise((resolve, reject) => {
        database.db.run(
          'DELETE FROM user_keywords WHERE user_id = ? AND category = ? AND keyword = ?',
          [userId, category, keyword],
          function(err) {
            if (err) reject(err);
            else resolve(this.changes > 0);
          }
        );
      });
      
      if (!removed) {
        await bot.sendMessage(chatId, `❌ Not found! "${keyword}" is not in your ${category} keywords`);
        return;
      }
      
      await bot.sendMessage(chatId, `✅ *Keyword Removed Successfully!*

🗑️ *Removed:* "${keyword}"
📂 *Category:* ${category}`, { parse_mode: 'Markdown' });
    }
    
    botStats.totalRequests++;
    botStats.successfulRequests++;
    
  } catch (error) {
    console.error('Remove keyword error:', error);
    await bot.sendMessage(chatId, `❌ Error removing keyword. Try again.`);
    botStats.errors++;
  }
});
  // Command: /mystats
  bot.onText(/\/mystats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      const userStats = await new Promise((resolve, reject) => {
        database.db.all(
          `SELECT command, COUNT(*) as count, AVG(response_time) as avg_time
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
        message += `📈 *No usage data yet*\n\nStart using commands to see your stats!`;
      } else {
        const totalRequests = userStats.reduce((sum, stat) => sum + stat.count, 0);
        const avgResponseTime = userStats.length > 0 ? Math.round(userStats.reduce((sum, stat) => sum + (stat.avg_time * stat.count), 0) / totalRequests) : 0;
        
        message += `🎯 *Total Requests:* ${totalRequests}\n`;
        message += `⚡ *Avg Response Time:* ${avgResponseTime}ms\n\n`;
        message += `📋 *Command Usage:*\n`;
        
        userStats.slice(0, 10).forEach(stat => {
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
      console.error('User stats error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching statistics`);
      botStats.errors++;
    }
  });

  // Command: /refresh
  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'refresh');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🔄 *Refreshing sources...*\n\n⏳ Getting latest content`, { parse_mode: 'Markdown' });
      
      newsCache = [];
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      const allNews = [];
      
      for (const category of categories) {
        try {
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error refreshing ${category}:`, error.message);
        }
      }
      
      newsCache = allNews;
      
      await bot.sendMessage(chatId, `✅ *Refresh Complete!*

📊 *Articles found:* ${newsCache.length}
🕐 *Completed:* ${getCurrentIndianTime().toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'refresh', 'all', responseTime);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Refresh error:', error);
      await bot.sendMessage(chatId, `❌ Refresh failed. Try again later.`);
      botStats.errors++;
    }
  });

  // Command: /help
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `⚙️ *BOT HELP*

*🎯 News Commands:*
/youtubers - YouTube news 🎥
/bollywood - Bollywood news 🎭
/cricket - Cricket news 🏏
/national - National news 🇮🇳
/pakistan - Pakistan news 🇵🇰
/latest - Top content 🔥

*🔍 Search Commands:*
/search <term> - Search news
/spicy <term> - Spicy content only

*🛠️ Keywords:*
/addkeyword <category> <keyword>
/listkeywords
/removekeyword <category> <keyword>

*📊 Other:*
/mystats - Your stats
/refresh - Refresh sources
/help - This menu

*Example:*
/addkeyword youtubers CarryMinati

🔥 Only YOUR keywords are searched!`;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

// Express routes
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  res.json({ 
    status: 'Enhanced Viral News Bot v3.0',
    version: '3.0.0',
    uptime: uptime,
    totalRequests: botStats.totalRequests,
    features: 'User keywords only, 50 articles max, 24h filter, direct links'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime(),
    totalRequests: botStats.totalRequests,
    errors: botStats.errors
  });
});

app.get('/ping', (req, res) => {
  botStats.totalRequests++;
  res.json({ 
    status: 'pong',
    timestamp: getCurrentIndianTime().toLocaleString('en-IN'),
    version: '3.0.0'
  });
});

// Enhanced cleanup function
async function enhancedCleanup() {
  try {
    const expiryTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const initialCount = newsCache.length;
    
    newsCache = newsCache.filter(article => {
      const articleDate = new Date(article.timestamp);
      return articleDate > expiryTime;
    });
    
    console.log(`🧹 Cleanup: Removed ${initialCount - newsCache.length} old articles`);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Enhanced keep-alive function
async function enhancedKeepAlive() {
  try {
    if (APP_URL && !APP_URL.includes('localhost')) {
      const response = await axios.get(`${APP_URL}/ping`, { timeout: 10000 });
      console.log(`🏓 Keep-alive successful`);
    }
  } catch (error) {
    console.warn(`⚠️ Keep-alive failed: ${error.message}`);
    botStats.errors++;
  }
}

// Set intervals for maintenance
setInterval(enhancedKeepAlive, 12 * 60 * 1000); // Every 12 minutes
setInterval(enhancedCleanup, 30 * 60 * 1000);   // Every 30 minutes

// Startup delay
setTimeout(() => {
  console.log('🚀 Bot fully loaded!');
}, 3000);

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`📱 Bot: ${BOT_TOKEN ? 'Active' : 'Missing Token'}`);
});

// Process error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  botStats.errors++;
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  botStats.errors++;
  setTimeout(() => process.exit(1), 5000);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  if (database && database.db) {
    database.db.close((err) => {
      if (err) {
        console.error('Database close error:', err);
      } else {
        console.log('Database closed successfully');
      }
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Module exports
module.exports = { 
  app, 
  bot, 
  database,
  calculateSpiceScore,
  calculateConspiracyScore,
  calculateImportanceScore,
  categorizeNews,
  checkUserRateLimit,
  formatNewsDate,
  getCurrentIndianTime,
  getCurrentTimestamp,
  ENHANCED_SEARCH_KEYWORDS
};
