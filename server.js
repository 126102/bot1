const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const Filter = require('bad-words');

// Environment Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// App URL Configuration
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

// Initialize components
const filter = new Filter();
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

// Enhanced Feedly Pro+ Configuration
const FEEDLY_CONFIG = {
  ACCESS_TOKEN: process.env.FEEDLY_ACCESS_TOKEN,
  REFRESH_TOKEN: process.env.FEEDLY_REFRESH_TOKEN,
  USER_ID: process.env.FEEDLY_USER_ID,
  BASE_URL: 'https://cloud.feedly.com/v3',
  SUBSCRIPTION_LEVEL: 'pro+',
  MAX_REQUESTS_PER_HOUR: 1000,
  CONCURRENT_REQUESTS: 10
};

// Global Variables
let newsCache = [];
let userRateLimits = new Map();
let feedlyRequestCounter = 0;
let feedlyLastReset = Date.now();

// Bot Statistics
let botStats = {
  totalRequests: 0,
  successfulRequests: 0,
  errors: 0,
  feedlyRequests: 0,
  startTime: Date.now()
};

// Enhanced RSS Sources with Feedly Integration
const ENHANCED_RSS_SOURCES = {
  youtubers: {
    rss: [
      'https://timesofindia.indiatimes.com/rssfeeds/54829575.cms',
      'https://feeds.feedburner.com/ndtvnews-trending-news',
      'https://www.indiatoday.in/rss/1206514',
      'https://news.google.com/rss/search?q=YouTubers+India&hl=en&gl=IN&ceid=IN:en'
    ],
    feedlyStreams: [] // Will be populated dynamically if user has categories
  },
  bollywood: {
    rss: [
      'https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms',
      'https://feeds.feedburner.com/ndtvnews-trending-news',
      'https://www.indiatoday.in/rss/1206514',
      'https://news.google.com/rss/search?q=Bollywood+scandal&hl=en&gl=IN&ceid=IN:en'
    ],
    feedlyStreams: []
  },
  cricket: {
    rss: [
      'https://timesofindia.indiatimes.com/rssfeeds/4719148.cms',
      'https://feeds.feedburner.com/ndtvsports-latest',
      'https://www.indiatoday.in/rss/1206570',
      'https://news.google.com/rss/search?q=Cricket+India&hl=en&gl=IN&ceid=IN:en'
    ],
    feedlyStreams: []
  },
  national: {
    rss: [
      'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms',
      'https://feeds.feedburner.com/ndtvnews-india-news',
      'https://www.indiatoday.in/rss/1206514',
      'https://news.google.com/rss/search?q=India+politics&hl=en&gl=IN&ceid=IN:en'
    ],
    feedlyStreams: []
  },
  pakistan: {
    rss: [
      'https://www.dawn.com/feeds/home',
      'https://arynews.tv/en/feed/',
      'https://news.google.com/rss/search?q=Pakistan+politics&hl=en&gl=PK&ceid=PK:en'
    ],
    feedlyStreams: []
  }
};

// Keywords for scoring
const SPICY_KEYWORDS = ['controversy', 'drama', 'fight', 'viral', 'trending', 'breaking', 'scandal', 'exposed', 'beef', 'roast', 'diss', 'leaked', 'secret'];
const CONSPIRACY_KEYWORDS = ['conspiracy', 'secret', 'hidden', 'exposed', 'leaked', 'revelation', 'behind scenes', 'truth', 'cover up'];
const IMPORTANCE_KEYWORDS = ['breaking', 'urgent', 'alert', 'emergency', 'crisis', 'important'];

// Initialize Database
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
        feedly_used INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS feedly_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query_hash TEXT UNIQUE,
        category TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
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
  
  async logAnalytics(userId, command, category, responseTime, success = 1, feedlyUsed = 0) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO bot_analytics (user_id, command, category, response_time, success, feedly_used) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, command, category, responseTime, success, feedlyUsed],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  async getCachedFeedlyResults(queryHash) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT content FROM feedly_cache WHERE query_hash = ? AND expires_at > datetime("now")',
        [queryHash],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? JSON.parse(row.content) : null);
        }
      );
    });
  }

  async cacheFeedlyResults(queryHash, category, content, expiryMinutes = 30) {
    return new Promise((resolve, reject) => {
      const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
      this.db.run(
        'INSERT OR REPLACE INTO feedly_cache (query_hash, category, content, expires_at) VALUES (?, ?, ?, ?)',
        [queryHash, category, JSON.stringify(content), expiresAt],
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

// Express app setup
const app = express();
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' }
});
app.use('/api/', limiter);
// Enhanced Feedly Pro+ API Class
class EnhancedFeedlyAPI {
  constructor() {
    this.headers = {
      'Authorization': `Bearer ${FEEDLY_CONFIG.ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ViralNewsBot/4.0'
    };
    this.rateLimitManager = new Map();
    this.isConfigured = this.validateConfig();
  }

  validateConfig() {
    if (!FEEDLY_CONFIG.ACCESS_TOKEN || FEEDLY_CONFIG.ACCESS_TOKEN === 'undefined') {
      console.warn('⚠️ Feedly ACCESS_TOKEN not configured');
      return false;
    }
    if (!FEEDLY_CONFIG.USER_ID || FEEDLY_CONFIG.USER_ID === 'undefined') {
      console.warn('⚠️ Feedly USER_ID not configured');
      return false;
    }
    console.log('✅ Feedly Pro+ configuration validated');
    return true;
  }

  async refreshToken() {
    try {
      if (!FEEDLY_CONFIG.REFRESH_TOKEN || FEEDLY_CONFIG.REFRESH_TOKEN === 'undefined') {
        console.warn('⚠️ No refresh token available');
        return false;
      }

      console.log('🔄 Refreshing Feedly token...');
      const response = await axios.post(`${FEEDLY_CONFIG.BASE_URL}/auth/token`, {
        refresh_token: FEEDLY_CONFIG.REFRESH_TOKEN,
        grant_type: 'refresh_token'
      });

      if (response.data.access_token) {
        process.env.FEEDLY_ACCESS_TOKEN = response.data.access_token;
        this.headers['Authorization'] = `Bearer ${response.data.access_token}`;
        console.log('✅ Feedly token refreshed successfully');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Feedly token refresh failed:', error.response?.data || error.message);
      return false;
    }
  }

  checkRateLimit() {
    if (!this.isConfigured) {
      throw new Error('Feedly not properly configured');
    }

    const now = Date.now();
    if (now - feedlyLastReset > 3600000) { // Reset every hour
      feedlyRequestCounter = 0;
      feedlyLastReset = now;
    }
    
    if (feedlyRequestCounter >= FEEDLY_CONFIG.MAX_REQUESTS_PER_HOUR) {
      const resetTime = Math.ceil((feedlyLastReset + 3600000 - now) / 60000);
      throw new Error(`Feedly rate limit exceeded. Reset in ${resetTime} minutes.`);
    }
    
    feedlyRequestCounter++;
    botStats.feedlyRequests++;
  }

  async searchContent(query, category, count = 30) {
    try {
      if (!this.isConfigured) {
        console.warn('⚠️ Feedly not configured, skipping search');
        return [];
      }

      this.checkRateLimit();
      
      const queryHash = this.generateQueryHash(query, category);
      const cachedResults = await database.getCachedFeedlyResults(queryHash);
      
      if (cachedResults) {
        console.log(`🎯 Feedly cache hit for: "${query}"`);
        return cachedResults;
      }

      console.log(`🤖 Feedly Pro+ searching: "${query}" in ${category}`);
      
      const searchParams = {
        query: query,
        count: Math.min(count, 100), // Feedly limit
        newerThan: Date.now() - 86400000, // Last 24 hours
        locale: 'en'
      };

      const response = await axios.get(`${FEEDLY_CONFIG.BASE_URL}/search/contents`, {
        headers: this.headers,
        params: searchParams,
        timeout: 15000
      });
      
      const formattedResults = this.formatResults(response.data.results || [], query, category);
      
      // Cache results for 30 minutes
      await database.cacheFeedlyResults(queryHash, category, formattedResults, 30);
      
      console.log(`✅ Feedly found ${formattedResults.length} articles for: "${query}"`);
      return formattedResults;
      
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('🔑 Token expired, attempting refresh...');
        const refreshed = await this.refreshToken();
        if (refreshed) {
          return this.searchContent(query, category, count);
        }
      }
      
      console.error(`❌ Feedly search error: ${error.response?.data?.errorMessage || error.message}`);
      return [];
    }
  }

  async getUserProfile() {
    try {
      if (!this.isConfigured) {
        return null;
      }

      this.checkRateLimit();
      
      const response = await axios.get(`${FEEDLY_CONFIG.BASE_URL}/profile`, {
        headers: this.headers,
        timeout: 10000
      });
      
      return response.data;
      
    } catch (error) {
      console.error(`❌ Feedly profile error: ${error.message}`);
      return null;
    }
  }

  async getTrendingTopics(category = 'technology') {
    try {
      if (!this.isConfigured) {
        console.warn('⚠️ Feedly not configured, skipping trending');
        return [];
      }

      this.checkRateLimit();
      
      console.log(`📈 Getting trending topics for: ${category}`);
      
      // Use a simpler endpoint that's more likely to work
      const response = await axios.get(`${FEEDLY_CONFIG.BASE_URL}/topics`, {
        headers: this.headers,
        params: {
          count: 20
        },
        timeout: 10000
      });
      
      return response.data || [];
      
    } catch (error) {
      console.error(`❌ Feedly trending error: ${error.response?.data?.errorMessage || error.message}`);
      return [];
    }
  }

  generateQueryHash(query, category) {
    return require('crypto').createHash('md5').update(`${query}_${category}_${Math.floor(Date.now() / 1800000)}`).digest('hex');
  }

  formatResults(results, query, category) {
    if (!results || results.length === 0) return [];
    
    return results.map(item => {
      const publishTime = item.published || item.crawled || Date.now();
      const pubDate = new Date(publishTime);
      
      return {
        title: this.cleanTitle(item.title || 'No Title'),
        link: item.canonicalUrl || item.alternate?.[0]?.href || item.originId || '#',
        pubDate: pubDate.toISOString(),
        formattedDate: formatNewsDate(pubDate),
        description: this.cleanDescription(item.summary?.content || item.content?.content || ''),
        source: item.origin?.title || 'Feedly Source',
        category: category,
        timestamp: pubDate.toISOString(),
        platform: 'feedly_pro',
        reliability: this.calculateReliability(item),
        isVerified: true,
        spiceScore: calculateSpiceScore(item.title, item.summary?.content || ''),
        conspiracyScore: calculateConspiracyScore(item.title, item.summary?.content || ''),
        importanceScore: calculateImportanceScore(item.title, item.summary?.content || ''),
        hoursAgo: Math.floor((Date.now() - publishTime) / (1000 * 60 * 60)),
        sourceType: 'Feedly Pro+',
        matchedKeyword: query,
        feedlyEngagement: item.engagement || 0,
        feedlyScore: item.engagementRate || 0,
        matchPriority: this.calculateMatchPriority(item.title, item.summary?.content || '', query),
        totalScore: 0 // Will be calculated after
      };
    }).map(article => {
      article.totalScore = article.spiceScore + article.conspiracyScore + article.importanceScore;
      return article;
    });
  }

  cleanTitle(title) {
    return title.replace(/\*/g, '').replace(/\[/g, '(').replace(/\]/g, ')').replace(/`/g, "'").replace(/_/g, '-').substring(0, 80).trim();
  }

  cleanDescription(description) {
    const cleanDesc = description.replace(/<[^>]*>/g, '').substring(0, 150);
    return cleanDesc.length < description.length ? cleanDesc + '...' : cleanDesc;
  }

  calculateReliability(item) {
    let score = 8; // Base Feedly score
    
    if (item.origin?.title) {
      const source = item.origin.title.toLowerCase();
      if (source.includes('times') || source.includes('bbc') || source.includes('reuters')) score += 2;
      if (source.includes('blog') || source.includes('personal')) score -= 1;
    }
    
    if (item.engagement > 100) score += 1;
    if (item.engagementRate > 0.1) score += 1;
    
    return Math.min(score, 10);
  }

  calculateMatchPriority(title, description, query) {
    const titleLower = (title || '').toLowerCase();
    const descLower = (description || '').toLowerCase();
    const queryLower = query.toLowerCase();
    
    if (titleLower.includes(queryLower)) return 100;
    if (descLower.includes(queryLower)) return 75;
    
    const queryWords = queryLower.split(/\s+/);
    const titleWords = titleLower.split(/\s+/);
    const descWords = descLower.split(/\s+/);
    
    const titleMatches = queryWords.filter(word => titleWords.includes(word)).length;
    const descMatches = queryWords.filter(word => descWords.includes(word)).length;
    
    return Math.max(
      (titleMatches / queryWords.length) * 50,
      (descMatches / queryWords.length) * 25
    );
  }
}

const feedlyAPI = new EnhancedFeedlyAPI();

// Utility Functions
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

// Enhanced keyword management functions
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

// Enhanced RSS scraping with Feedly integration
async function scrapeRealNews(query, category) {
  try {
    console.log(`⚡ HYBRID search: "${query}" in ${category}`);
    const articles = [];
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get RSS sources for category
    const sourceConfig = ENHANCED_RSS_SOURCES[category] || {};
    const rssSources = sourceConfig.rss || [];
    
    console.log(`📡 Using ${rssSources.length} RSS sources + Feedly for ${category}`);
    
    // First, try RSS sources (faster)
    for (let sourceIndex = 0; sourceIndex < Math.min(rssSources.length, 3); sourceIndex++) {
      const rssUrl = rssSources[sourceIndex];
      
      try {
        console.log(`🔍 RSS Source ${sourceIndex + 1}`);
        
        const response = await axios.get(rssUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml'
          },
          timeout: 8000
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        let foundInThisSource = 0;
        
        const items = $('item').length > 0 ? $('item') : $('entry');
        
        items.each((i, elem) => {
          if (i >= 10 || foundInThisSource >= 8) return false;
          
          const $elem = $(elem);
          const title = $elem.find('title').text().trim();
          const link = $elem.find('link').attr('href') || $elem.find('link').text().trim();
          const pubDate = $elem.find('pubDate').text().trim() || $elem.find('published').text().trim();
          const description = $elem.find('description').text().trim() || $elem.find('summary').text().trim();
          
          if (title && link && title.length > 10) {
            const titleLower = title.toLowerCase();
            const descLower = description.toLowerCase();
            const queryLower = query.toLowerCase();
            
            let hasMatch = false;
            const titleWords = titleLower.split(/\s+/);
            const descWords = descLower.split(/\s+/);
            const searchWords = queryLower.split(/\s+/);
            
            if (searchWords.every(searchWord => 
              titleWords.includes(searchWord) || descWords.includes(searchWord)
            )) {
              hasMatch = true;
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
                
                let source = rssUrl.split('/')[2].replace('www.', '');
                if (source.includes('timesofindia')) source = 'Times of India';
                else if (source.includes('ndtv')) source = 'NDTV';
                else if (source.includes('indiatoday')) source = 'India Today';
                else if (source.includes('india.com')) source = 'India.com';
                else if (source.includes('news.google')) source = 'Google News';
                else if (source.includes('dawn.com')) source = 'Dawn';
                else if (source.includes('arynews')) source = 'ARY News';
                
                let cleanTitle = title.replace(/\s+/g, ' ').trim();
                
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
                  
                  let matchPriority = 0;
                  if (titleLower.includes(queryLower)) {
                    matchPriority = 100;
                  } else if (descLower.includes(queryLower)) {
                    matchPriority = 50;
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
                    matchPriority: matchPriority
                  });
                  
                  foundInThisSource++;
                }
              }
            }
          }
        });
        
        console.log(`✅ RSS Source completed: Found ${foundInThisSource} matches`);
        
        if (sourceIndex < rssSources.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`❌ RSS Source ${sourceIndex + 1} failed: ${error.message}`);
      }
    }
    
    // Then, enhance with Feedly Pro+ results (only if configured)
    try {
      if (feedlyAPI.isConfigured) {
        console.log(`🤖 Enhancing with Feedly Pro+ for: "${query}"`);
        const feedlyResults = await feedlyAPI.searchContent(query, category, 30);
        
        for (const feedlyArticle of feedlyResults) {
          const isDuplicate = articles.some(existing => {
            const existingKey = existing.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 30);
            const feedlyKey = feedlyArticle.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 30);
            return existingKey === feedlyKey || existing.link === feedlyArticle.link;
          });
          
          if (!isDuplicate) {
            articles.push(feedlyArticle);
          }
        }
        
        console.log(`✅ Feedly added ${feedlyResults.length} unique articles`);
      } else {
        console.log(`⚠️ Feedly not configured, using RSS only`);
      }
      
    } catch (feedlyError) {
      console.error(`⚠️ Feedly enhancement failed: ${feedlyError.message}`);
    }
    
    // Sort by match priority, then score, then recency
    articles.sort((a, b) => {
      const priorityDiff = (b.matchPriority || 0) - (a.matchPriority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 1) return scoreDiff;
      
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    console.log(`🎯 Total hybrid matches: ${articles.length}`);
    return articles.slice(0, 50); // Limit to 50 best results
    
  } catch (error) {
    console.error(`Hybrid scraping error: ${error.message}`);
    return [];
  }
}

// Enhanced content fetching with Feedly Pro+ integration
async function fetchEnhancedContent(category, userId = null) {
  try {
    console.log(`⚡ ENHANCED fetch for ${category} with Feedly Pro+`);
    
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
    
    // Use up to 5 keywords for better performance
    const keywordsToUse = userKeywords.slice(0, 5);
    console.log(`🎯 Using ${keywordsToUse.length} keywords`);
    
    // Process keywords with Feedly Pro+ and RSS hybrid approach
    for (let i = 0; i < keywordsToUse.length; i++) {
      const userKeyword = keywordsToUse[i];
      try {
        console.log(`   🎯 KEYWORD ${i + 1}/${keywordsToUse.length}: "${userKeyword.keyword}"`);
        
        // Get articles from hybrid search (RSS + Feedly)
        const articles = await scrapeRealNews(userKeyword.keyword, category);
        console.log(`   ✅ Found ${articles.length} matches for: ${userKeyword.keyword}`);
        
        // Skip Feedly streams for now since they require proper configuration
        // This can be enabled later when user has proper Feedly categories set up
        
        articles.forEach(article => {
          article.searchKeyword = userKeyword.keyword;
          article.keywordPriority = userKeyword.priority || 1;
        });
        
        allArticles.push(...articles);
        
        if (i < keywordsToUse.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
        
      } catch (error) {
        console.error(`❌ Error searching for "${userKeyword.keyword}": ${error.message}`);
      }
    }
    
    // Enhanced deduplication
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
    
    // Enhanced sorting with Feedly engagement
    uniqueArticles.sort((a, b) => {
      // 1. Keyword priority
      const priorityDiff = (b.keywordPriority || 1) - (a.keywordPriority || 1);
      if (priorityDiff !== 0) return priorityDiff;
      
      // 2. Match priority
      const matchDiff = (b.matchPriority || 0) - (a.matchPriority || 0);
      if (matchDiff !== 0) return matchDiff;
      
      // 3. Platform preference (Feedly Pro+ gets bonus)
      const platformDiff = (b.platform === 'feedly_pro' ? 1 : 0) - (a.platform === 'feedly_pro' ? 1 : 0);
      if (platformDiff !== 0) return platformDiff;
      
      // 4. Total score
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff;
      
      // 5. Feedly engagement (if available)
      const engagementDiff = (b.feedlyEngagement || 0) - (a.feedlyEngagement || 0);
      if (engagementDiff !== 0) return engagementDiff;
      
      // 6. Recency
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    const finalArticles = uniqueArticles.slice(0, 50);
    console.log(`✅ FINAL: ${finalArticles.length} enhanced matches for ${category}`);
    
    return finalArticles;
    
  } catch (error) {
    console.error(`Enhanced content fetch error: ${error.message}`);
    return [];
  }
}

// Fallback content function
function createFallbackContent(category) {
  return [{
    title: `Add keywords to get ${category} news with Feedly Pro+`,
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
    description: `Use /addkeyword ${category} <your_keyword> to start getting enhanced news`,
    platform: 'help',
    sourceType: 'Feedly Pro+ Enhanced Bot'
  }];
}

// Command: /trending (Feedly Pro+ exclusive)
  bot.onText(/\/trending/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      if (!feedlyAPI.isConfigured) {
        await bot.sendMessage(chatId, `❌ *Feedly Pro+ not configured*\n\nTrending topics require Feedly Pro+ setup.\n\nSet these environment variables:\n• FEEDLY_ACCESS_TOKEN\n• FEEDLY_USER_ID\n• FEEDLY_REFRESH_TOKEN`, { parse_mode: 'Markdown' });
        return;
      }

      await bot.sendMessage(chatId, `📈 *Getting trending topics with Feedly Pro+...*`, { parse_mode: 'Markdown' });
      
      const trendingTopics = await feedlyAPI.getTrendingTopics('technology');
      
      if (trendingTopics.length === 0) {
        await bot.sendMessage(chatId, `❌ No trending topics available right now.\n\nThis might be due to:\n• Feedly API limits\n• Configuration issues\n• Service temporarily unavailable`);
        return;
      }
      
      let message = `📈 *TRENDING TOPICS (Feedly Pro+)*\n\n`;
      
      trendingTopics.slice(0, 15).forEach((topic, index) => {
        message += `${index + 1}. 🔥 *${topic.label || topic.id}*\n`;
        if (topic.description) {
          message += `   📄 ${topic.description.substring(0, 80)}...\n`;
        }
        message += `   📊 Interest: ${topic.score || 'N/A'}\n\n`;
      });
      
      message += `🤖 *Powered by Feedly Pro+ AI*`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'trending', 'trending', responseTime, 1, 1);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Trending command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching trending topics\n\nError: ${error.message}\n\nTry again later or check Feedly configuration.`);
      botStats.errors++;
    }
  });

  // Command: /feedlystats
  bot.onText(/\/feedlystats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const uptime = Math.floor((Date.now() - botStats.startTime) / 1000 / 60); // minutes
      const feedlyUsagePercent = botStats.totalRequests > 0 ? Math.round((botStats.feedlyRequests / botStats.totalRequests) * 100) : 0;
      const remainingRequests = Math.max(0, FEEDLY_CONFIG.MAX_REQUESTS_PER_HOUR - feedlyRequestCounter);
      const resetTime = Math.max(0, Math.ceil((feedlyLastReset + 3600000 - Date.now()) / 60000));
      
      const configStatus = feedlyAPI.isConfigured ? '✅ Configured' : '❌ Not Configured';
      const tokenStatus = FEEDLY_CONFIG.ACCESS_TOKEN && FEEDLY_CONFIG.ACCESS_TOKEN !== 'undefined' ? '✅ Active' : '❌ Missing';
      
      const message = `🤖 *FEEDLY PRO+ STATISTICS*

🔧 *Configuration:*
• Status: ${configStatus}
• Access Token: ${tokenStatus}
• User ID: ${FEEDLY_CONFIG.USER_ID ? '✅ Set' : '❌ Missing'}
• Refresh Token: ${FEEDLY_CONFIG.REFRESH_TOKEN ? '✅ Set' : '❌ Missing'}

📊 *Current Session:*
• Total Bot Requests: ${botStats.totalRequests}
• Feedly API Calls: ${botStats.feedlyRequests}
• Feedly Usage: ${feedlyUsagePercent}%
• Success Rate: ${botStats.totalRequests > 0 ? Math.round((botStats.successfulRequests / botStats.totalRequests) * 100) : 0}%

⚡ *Rate Limits:*
• Remaining This Hour: ${remainingRequests}
• Reset In: ${resetTime} minutes
• Max Per Hour: ${FEEDLY_CONFIG.MAX_REQUESTS_PER_HOUR}

🚀 *Performance:*
• Uptime: ${uptime} minutes
• Cached Articles: ${newsCache.length}
• Error Rate: ${botStats.totalRequests > 0 ? Math.round((botStats.errors / botStats.totalRequests) * 100) : 0}%

🎯 *Subscription Level:* ${FEEDLY_CONFIG.SUBSCRIPTION_LEVEL.toUpperCase()}

${!feedlyAPI.isConfigured ? '\n⚠️ *Setup Required:*\nSet FEEDLY_ACCESS_TOKEN, FEEDLY_USER_ID, and FEEDLY_REFRESH_TOKEN environment variables.' : ''}`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Feedly stats error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Feedly statistics: ${error.message}`);
    }
  });// Enhanced message formatting function
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
    const feedlyCount = articles.filter(a => a.platform === 'feedly_pro').length;
    
    const summaryMessage = `🔥 *${category.toUpperCase()} FEEDLY PRO+ NEWS* 🔥

📊 *Found: ${articles.length} articles (Last 24 hours)*
🤖 *Feedly Pro+ Articles: ${feedlyCount}*
🌶️ *Spicy Content: ${spicyCount} articles*
🕵️ *Conspiracy Content: ${conspiracyCount} articles*
⭐ *Average Score: ${avgScore}/30*
🌐 *Sources: RSS + Feedly Pro+ hybrid*
🕐 *Updated: ${currentTime.toLocaleString('en-IN')}*

*🎯 Only YOUR keywords + AI-enhanced discovery!*
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
        const platformIcon = article.platform === 'feedly_pro' ? '🤖' : '📡';
        
        const keywordInfo = article.searchKeyword ? ` [🔍 ${article.searchKeyword}]` : '';
        const sourceInfo = article.sourceType ? ` [${platformIcon} ${article.sourceType}]` : '';
        
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
        chunkMessage += `🎯 *Keywords used: ${uniqueKeywords.length}* | 🤖 *Feedly Pro+ Enhanced!*`;
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
    
    const welcomeMessage = `🔥 *FEEDLY PRO+ VIRAL NEWS BOT v4.0* 🔥

*🤖 Enhanced with Feedly Pro+ AI:*
/youtubers - YouTube drama & scandals 🎥
/bollywood - Celebrity controversies 🎭
/cricket - Sports scandals & fixes 🏏
/national - Political drama & corruption 🇮🇳
/pakistan - Pakistani political crisis 🇵🇰
/latest - Top scored content from all categories 🔥

*🔍 AI-Powered Search Commands:*
/search <term> - Feedly Pro+ enhanced search
/spicy <term> - High controversy content only (6+ spice)
/trending - Get trending topics from Feedly

*🛠️ Smart Keyword Management:*
/addkeyword <category> <keyword> - Add custom keywords
/listkeywords - View all your keywords  
/removekeyword <category> <keyword> - Remove keywords

*📊 Analytics & Info:*
/mystats - Your enhanced usage statistics
/feedlystats - Feedly Pro+ usage statistics
/refresh - Force refresh all sources
/help - This complete menu

*Example Commands:*
• /addkeyword youtubers CarryMinati controversy
• /search Elvish Yadav drama
• /spicy YouTube scandal
• /trending

🤖 *Powered by Feedly Pro+ AI for the SPICIEST content!*`;
    
    try {
      await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'start', 'general', responseTime, 1, 0);
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

  // Enhanced category commands with Feedly Pro+
  const categoryCommands = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
  
  categoryCommands.forEach(category => {
    const regex = new RegExp(`\/${category}`);
    
    bot.onText(regex, async (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      const startTime = Date.now();
      
      const rateLimitCheck = checkUserRateLimit(userId, category);
      if (!rateLimitCheck.allowed) {
        await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
        return;
      }
      
      try {
        const categoryIcon = {
          youtubers: '🎥',
          bollywood: '🎭',
          cricket: '🏏',
          national: '🇮🇳',
          pakistan: '🇵🇰'
        };
        
        await bot.sendMessage(chatId, `${categoryIcon[category]} *Getting ${category} news with Feedly Pro+...*\n\n🤖 AI-enhanced search\n⏳ Please wait...`, { parse_mode: 'Markdown' });
        
        const news = await fetchEnhancedContent(category, userId);
        
        if (news.length > 0) {
          newsCache = newsCache.filter(article => article.category !== category);
          newsCache.push(...news);
          await formatAndSendNewsMessage(chatId, news, category.charAt(0).toUpperCase() + category.slice(1), bot);
          
          const responseTime = Date.now() - startTime;
          const feedlyUsed = news.some(a => a.platform === 'feedly_pro') ? 1 : 0;
          try {
            await database.logAnalytics(userId, category, category, responseTime, 1, feedlyUsed);
          } catch (dbError) {
            console.warn('Analytics failed:', dbError.message);
          }
        } else {
          const fallbackContent = createFallbackContent(category);
          await formatAndSendNewsMessage(chatId, fallbackContent, category.charAt(0).toUpperCase() + category.slice(1), bot);
        }
        
        botStats.totalRequests++;
        botStats.successfulRequests++;
        
      } catch (error) {
        console.error(`${category} command error:`, error);
        await bot.sendMessage(chatId, `❌ Error fetching ${category} news. Try /addkeyword ${category} <keyword>`);
        botStats.errors++;
      }
    });
  });

  // Command: /latest
  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      await bot.sendMessage(chatId, '🔄 *Getting top-scored content from all categories with Feedly Pro+...*', { parse_mode: 'Markdown' });
      
      const allNews = [];
      
      for (const category of categoryCommands) {
        try {
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error fetching ${category}:`, error.message);
        }
      }
      
      const topNews = allNews.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0)).slice(0, 25);
      
      if (topNews.length > 0) {
        await formatAndSendNewsMessage(chatId, topNews, 'Latest Top', bot);
      } else {
        await bot.sendMessage(chatId, `❌ No recent news found. Add keywords first.`);
      }
      
      const responseTime = Date.now() - startTime;
      const feedlyUsed = topNews.some(a => a.platform === 'feedly_pro') ? 1 : 0;
      try {
        await database.logAnalytics(userId, 'latest', 'all', responseTime, 1, feedlyUsed);
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
      await bot.sendMessage(chatId, `🔍 *FEEDLY PRO+ SEARCH: "${searchTerm}"*\n\n🤖 AI-enhanced searching...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      
      if (searchResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No results found for "${searchTerm}"`);
        return;
      }

      await formatAndSendNewsMessage(chatId, searchResults, `Search: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      const feedlyUsed = searchResults.some(a => a.platform === 'feedly_pro') ? 1 : 0;
      try {
        await database.logAnalytics(userId, 'search', 'search', responseTime, 1, feedlyUsed);
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

  // Command: /trending (Feedly Pro+ exclusive)
  bot.onText(/\/trending/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      await bot.sendMessage(chatId, `📈 *Getting trending topics with Feedly Pro+...*`, { parse_mode: 'Markdown' });
      
      const trendingTopics = await feedlyAPI.getTrendingTopics('technology');
      
      if (trendingTopics.length === 0) {
        await bot.sendMessage(chatId, `❌ No trending topics available right now.`);
        return;
      }
      
      let message = `📈 *TRENDING TOPICS (Feedly Pro+)*\n\n`;
      
      trendingTopics.slice(0, 15).forEach((topic, index) => {
        message += `${index + 1}. 🔥 *${topic.label || topic.id}*\n`;
        if (topic.description) {
          message += `   📄 ${topic.description.substring(0, 80)}...\n`;
        }
        message += `   📊 Interest: ${topic.score || 'N/A'}\n\n`;
      });
      
      message += `🤖 *Powered by Feedly Pro+ AI*`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'trending', 'trending', responseTime, 1, 1);
      } catch (dbError) {
        console.warn('Analytics failed:', dbError.message);
      }
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Trending command error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching trending topics`);
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
      await bot.sendMessage(chatId, `🌶️ *SPICY FEEDLY PRO+ SEARCH: "${searchTerm}"*\n\n🔥 Finding controversy with AI...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      const spicyResults = searchResults.filter(article => (article.spiceScore || 0) >= 6);
      
      if (spicyResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No spicy content found for "${searchTerm}"`);
        return;
      }

      await formatAndSendNewsMessage(chatId, spicyResults, `Spicy: ${searchTerm}`, bot);
      
      const responseTime = Date.now() - startTime;
      const feedlyUsed = spicyResults.some(a => a.platform === 'feedly_pro') ? 1 : 0;
      try {
        await database.logAnalytics(userId, 'spicy', 'search', responseTime, 1, feedlyUsed);
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
    
    if (!categoryCommands.includes(category)) {
      await bot.sendMessage(chatId, `❌ Invalid category!\n\n*Valid categories:* youtubers, bollywood, cricket, national, pakistan`);
      return;
    }
    
    try {
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
        message += `🚀 Use /${category} to see Feedly Pro+ results!`;
        
        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        
      } else {
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

🤖 Use /${category} to see Feedly Pro+ enhanced results!`, { parse_mode: 'Markdown' });
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
      let message = '📝 *YOUR FEEDLY PRO+ KEYWORDS*\n\n';
      let totalKeywords = 0;
      
      for (const category of categoryCommands) {
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
      message += `🗑️ *Remove:* /removekeyword <category> <keyword>\n`;
      message += `🤖 *Enhanced by Feedly Pro+ AI*`;
      
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
    
    if (!categoryCommands.includes(category)) {
      await bot.sendMessage(chatId, `❌ Invalid category!\n\n*Valid categories:* youtubers, bollywood, cricket, national, pakistan`);
      return;
    }
    
    try {
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
          `SELECT command, COUNT(*) as count, AVG(response_time) as avg_time, SUM(feedly_used) as feedly_count
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
      
      let message = `📊 *YOUR FEEDLY PRO+ STATISTICS*\n\n`;
      
      if (userStats.length === 0) {
        message += `📈 *No usage data yet*\n\nStart using commands to see your stats!`;
      } else {
        const totalRequests = userStats.reduce((sum, stat) => sum + stat.count, 0);
        const totalFeedlyUsage = userStats.reduce((sum, stat) => sum + (stat.feedly_count || 0), 0);
        const avgResponseTime = userStats.length > 0 ? Math.round(userStats.reduce((sum, stat) => sum + (stat.avg_time * stat.count), 0) / totalRequests) : 0;
        
        message += `🎯 *Total Requests:* ${totalRequests}\n`;
        message += `🤖 *Feedly Pro+ Queries:* ${totalFeedlyUsage}\n`;
        message += `⚡ *Avg Response Time:* ${avgResponseTime}ms\n\n`;
        message += `📋 *Command Usage:*\n`;
        
        userStats.slice(0, 10).forEach(stat => {
          const icon = stat.command === 'youtubers' ? '📱' : stat.command === 'bollywood' ? '🎬' : stat.command === 'cricket' ? '🏏' : stat.command === 'pakistan' ? '🇵🇰' : '🔍';
          message += `${icon} /${stat.command}: ${stat.count} times (Feedly: ${stat.feedly_count || 0})\n`;
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

  // Command: /feedlystats
  bot.onText(/\/feedlystats/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
      const uptime = Math.floor((Date.now() - botStats.startTime) / 1000 / 60); // minutes
      const feedlyUsagePercent = botStats.totalRequests > 0 ? Math.round((botStats.feedlyRequests / botStats.totalRequests) * 100) : 0;
      const remainingRequests = FEEDLY_CONFIG.MAX_REQUESTS_PER_HOUR - feedlyRequestCounter;
      const resetTime = Math.ceil((feedlyLastReset + 3600000 - Date.now()) / 60000);
      
      const message = `🤖 *FEEDLY PRO+ STATISTICS*

📊 *Current Session:*
• Total Bot Requests: ${botStats.totalRequests}
• Feedly API Calls: ${botStats.feedlyRequests}
• Feedly Usage: ${feedlyUsagePercent}%
• Success Rate: ${botStats.totalRequests > 0 ? Math.round((botStats.successfulRequests / botStats.totalRequests) * 100) : 0}%

⚡ *Rate Limits:*
• Remaining This Hour: ${remainingRequests}
• Reset In: ${resetTime > 0 ? resetTime : 0} minutes
• Max Per Hour: ${FEEDLY_CONFIG.MAX_REQUESTS_PER_HOUR}

🚀 *Performance:*
• Uptime: ${uptime} minutes
• Cached Articles: ${newsCache.length}
• Error Rate: ${botStats.totalRequests > 0 ? Math.round((botStats.errors / botStats.totalRequests) * 100) : 0}%

🎯 *Subscription Level:* ${FEEDLY_CONFIG.SUBSCRIPTION_LEVEL.toUpperCase()}`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Feedly stats error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching Feedly statistics`);
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
      await bot.sendMessage(chatId, `🔄 *Refreshing all sources with Feedly Pro+...*\n\n⏳ Getting latest content`, { parse_mode: 'Markdown' });
      
      newsCache = [];
      
      const allNews = [];
      
      for (const category of categoryCommands) {
        try {
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error refreshing ${category}:`, error.message);
        }
      }
      
      newsCache = allNews;
      
      const feedlyCount = allNews.filter(a => a.platform === 'feedly_pro').length;
      
      await bot.sendMessage(chatId, `✅ *Refresh Complete!*

📊 *Articles found:* ${newsCache.length}
🤖 *Feedly Pro+ articles:* ${feedlyCount}
🕐 *Completed:* ${getCurrentIndianTime().toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
      
      const responseTime = Date.now() - startTime;
      try {
        await database.logAnalytics(userId, 'refresh', 'all', responseTime, 1, feedlyCount > 0 ? 1 : 0);
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
    
    const helpMessage = `⚙️ *FEEDLY PRO+ BOT HELP*

*🤖 Enhanced News Commands:*
/youtubers - YouTube news 🎥
/bollywood - Bollywood news 🎭
/cricket - Cricket news 🏏
/national - National news 🇮🇳
/pakistan - Pakistan news 🇵🇰
/latest - Top content 🔥

*🔍 AI-Powered Search:*
/search <term> - Feedly Pro+ search
/spicy <term> - Spicy content only
/trending - Trending topics

*🛠️ Keywords:*
/addkeyword <category> <keyword>
/listkeywords
/removekeyword <category> <keyword>

*📊 Statistics:*
/mystats - Your stats
/feedlystats - Feedly Pro+ stats
/refresh - Refresh sources
/help - This menu

*Example:*
/addkeyword youtubers CarryMinati

🤖 Enhanced by Feedly Pro+ AI!`;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

// Express routes
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  res.json({ 
    status: 'Enhanced Viral News Bot v4.0 with Feedly Pro+',
    version: '4.0.0',
    uptime: uptime,
    totalRequests: botStats.totalRequests,
    feedlyRequests: botStats.feedlyRequests,
    features: 'Feedly Pro+ AI, User keywords, 50 articles max, 24h filter, direct links, trending topics'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime(),
    totalRequests: botStats.totalRequests,
    feedlyRequests: botStats.feedlyRequests,
    errors: botStats.errors,
    feedlyRateLimit: {
      used: feedlyRequestCounter,
      max: FEEDLY_CONFIG.MAX_REQUESTS_PER_HOUR,
      resetIn: Math.ceil((feedlyLastReset + 3600000 - Date.now()) / 60000)
    }
  });
});

app.get('/ping', (req, res) => {
  botStats.totalRequests++;
  res.json({ 
    status: 'pong',
    timestamp: getCurrentIndianTime().toLocaleString('en-IN'),
    version: '4.0.0',
    feedly: 'enabled'
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
    
    // Clean old Feedly cache
    database.db.run('DELETE FROM feedly_cache WHERE expires_at < datetime("now")', (err) => {
      if (err) console.error('Cache cleanup error:', err);
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
  console.log('🚀 Feedly Pro+ Bot fully loaded!');
  console.log(`🤖 Feedly Pro+ Status: ${FEEDLY_CONFIG.ACCESS_TOKEN ? 'Active' : 'Missing Token'}`);
}, 3000);

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`📱 Bot: ${BOT_TOKEN ? 'Active' : 'Missing Token'}`);
  console.log(`🤖 Feedly Pro+: ${FEEDLY_CONFIG.ACCESS_TOKEN ? 'Enabled' : 'Disabled'}`);
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
  feedlyAPI,
  calculateSpiceScore,
  calculateConspiracyScore,
  calculateImportanceScore,
  categorizeNews,
  checkUserRateLimit,
  formatNewsDate,
  getCurrentIndianTime,
  getCurrentTimestamp,
  EnhancedFeedlyAPI,
  ENHANCED_RSS_SOURCES,
  FEEDLY_CONFIG
};
