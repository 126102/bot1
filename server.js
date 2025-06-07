
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
  MAX_REQUESTS_PER_HOUR: 1000
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

// RSS Sources
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

// Keywords for scoring
const SPICY_KEYWORDS = ['controversy', 'drama', 'fight', 'viral', 'trending', 'breaking', 'scandal', 'exposed', 'beef', 'roast', 'diss', 'leaked', 'secret'];
const CONSPIRACY_KEYWORDS = ['conspiracy', 'secret', 'hidden', 'exposed', 'leaked', 'revelation', 'behind scenes', 'truth', 'cover up'];
const IMPORTANCE_KEYWORDS = ['breaking', 'urgent', 'alert', 'emergency', 'crisis', 'important'];

// Database Class
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
}

// Enhanced Feedly Pro+ API Class - NO CACHE, FRESH DATA ALWAYS
class EnhancedFeedlyAPI {
  constructor() {
    this.headers = {
      'Authorization': `Bearer ${FEEDLY_CONFIG.ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ViralNewsBot/4.0'
    };
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
    if (now - feedlyLastReset > 3600000) {
      feedlyRequestCounter = 0;
      feedlyLastReset = now;
    }
    
    feedlyRequestCounter++;
    botStats.feedlyRequests++;
  }

  async searchContent(query, category, count = 50) {
    try {
      if (!this.isConfigured) {
        console.warn('⚠️ Feedly not configured, skipping search');
        return [];
      }

      console.log(`🤖 Feedly Pro+ FRESH search: "${query}" in ${category}`);
      
      this.checkRateLimit();
      
      const searchParams = {
        q: query,
        count: Math.min(count, 100),
        locale: 'en'
      };

      const response = await axios.get(`${FEEDLY_CONFIG.BASE_URL}/search/feeds`, {
        headers: this.headers,
        params: searchParams,
        timeout: 15000
      });
      
      if (response.data.results && response.data.results.length > 0) {
        console.log(`📡 Found ${response.data.results.length} relevant feeds`);
        
        const allArticles = [];
        
        for (const feed of response.data.results.slice(0, 3)) {
          try {
            const feedContent = await this.getFeedContent(feed.feedId, query, 25);
            allArticles.push(...feedContent);
          } catch (feedError) {
            console.warn(`⚠️ Failed to get content from feed ${feed.title}: ${feedError.message}`);
          }
        }
        
        const formattedResults = this.formatResults(allArticles, query, category);
        
        console.log(`✅ Feedly FRESH found ${formattedResults.length} articles for: "${query}"`);
        return formattedResults;
      } else {
        console.log(`🔍 No feeds found for "${query}"`);
        return [];
      }
      
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('🔑 Token expired, attempting refresh...');
        const refreshed = await this.refreshToken();
        if (refreshed) {
          return this.searchContent(query, category, count);
        }
      }
      
      if (error.response?.status === 429) {
        console.error(`❌ Feedly rate limit hit: ${error.response?.data?.errorMessage || 'Rate limit exceeded'}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
          return this.searchContent(query, category, count);
        } catch (retryError) {
          console.error(`❌ Retry also failed: ${retryError.message}`);
          return [];
        }
      }
      
      console.error(`❌ Feedly search error: ${error.response?.data?.errorMessage || error.message}`);
      return [];
    }
  }

  async getFeedContent(feedId, query, count = 25) {
    try {
      this.checkRateLimit();
      
      const response = await axios.get(`${FEEDLY_CONFIG.BASE_URL}/streams/contents`, {
        headers: this.headers,
        params: {
          streamId: feedId,
          count: count,
          newerThan: Date.now() - 86400000
        },
        timeout: 12000
      });
      
      const items = response.data.items || [];
      
      return items.filter(item => {
        const content = `${item.title || ''} ${item.summary?.content || ''}`.toLowerCase();
        const queryLower = query.toLowerCase();
        return content.includes(queryLower) || 
               queryLower.split(' ').some(word => word.length > 2 && content.includes(word));
      });
      
    } catch (error) {
      if (error.response?.status === 429) {
        console.error(`❌ Feed content rate limit: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
          return this.getFeedContent(feedId, query, count);
        } catch (retryError) {
          return [];
        }
      }
      console.error(`❌ Feed content error: ${error.message}`);
      return [];
    }
  }

  async simpleSearch(query, category, count = 30) {
    try {
      if (!this.isConfigured) {
        return [];
      }

      console.log(`🔍 Simple Feedly FRESH search for: "${query}"`);
      
      const feeds = this.getPopularFeedsByCategory(category);
      const allArticles = [];
      
      for (const feedId of feeds) {
        try {
          const feedContent = await this.getFeedContent(feedId, query, count);
          allArticles.push(...feedContent);
        } catch (error) {
          console.warn(`⚠️ Feed ${feedId} failed: ${error.message}`);
        }
      }
      
      return this.formatResults(allArticles, query, category);
      
    } catch (error) {
      console.error(`❌ Simple search error: ${error.message}`);
      return [];
    }
  }

  getPopularFeedsByCategory(category) {
    const feedMap = {
      youtubers: [
        'feed/https://www.tubefilter.com/feed/',
        'feed/https://socialblade.com/blog/feed'
      ],
      bollywood: [
        'feed/https://www.bollywoodhungama.com/rss/news.xml',
        'feed/https://www.pinkvilla.com/rss.xml'
      ],
      cricket: [
        'feed/https://www.espncricinfo.com/rss/content/story/feeds/0.xml',
        'feed/https://www.cricbuzz.com/rss-feed/cricket-news'
      ],
      national: [
        'feed/https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
        'feed/https://www.thehindu.com/news/national/feeder/default.rss'
      ],
      pakistan: [
        'feed/https://www.dawn.com/feeds/home',
        'feed/https://arynews.tv/en/feed/'
      ]
    };
    
    return feedMap[category] || [
      'feed/http://feeds.feedburner.com/TechCrunch',
      'feed/https://www.theverge.com/rss/index.xml'
    ];
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
        totalScore: 0
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
    let score = 8;
    
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

  async getTrendingTopics(category = 'technology') {
    try {
      if (!this.isConfigured) {
        console.warn('⚠️ Feedly not configured, skipping trending');
        return [];
      }

      this.checkRateLimit();
      
      console.log(`📈 Getting trending topics...`);
      
      const trendingStreams = [
        'feed/http://feeds.feedburner.com/TechCrunch',
        'feed/https://www.theverge.com/rss/index.xml',
        'feed/https://techcrunch.com/feed/'
      ];
      
      const allContent = [];
      
      for (const streamId of trendingStreams) {
        try {
          const response = await axios.get(`${FEEDLY_CONFIG.BASE_URL}/streams/contents`, {
            headers: this.headers,
            params: {
              streamId: streamId,
              count: 10,
              newerThan: Date.now() - 86400000
            },
            timeout: 10000
          });
          
          const items = response.data.items || [];
          allContent.push(...items.map(item => ({
            label: item.title || 'Trending Topic',
            description: item.summary?.content?.substring(0, 100) || '',
            score: item.engagement || Math.floor(Math.random() * 100),
            id: item.id || `topic_${Date.now()}`
          })));
          
        } catch (streamError) {
          console.warn(`⚠️ Trending stream failed: ${streamError.message}`);
        }
      }
      
      return allContent
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 15);
      
    } catch (error) {
      console.error(`❌ Feedly trending error: ${error.response?.data?.errorMessage || error.message}`);
      return [];
    }
  }
}

const database = new NewsDatabase();
const feedlyAPI = new EnhancedFeedlyAPI();
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

// Enhanced RSS scraping with FRESH Feedly integration
async function scrapeRealNews(query, category) {
  try {
    console.log(`⚡ HYBRID FRESH search: "${query}" in ${category}`);
    const articles = [];
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const rssSources = ENHANCED_RSS_SOURCES[category] || [];
    console.log(`📡 Using ${rssSources.length} RSS sources + FRESH Feedly for ${category}`);
    
    // First, try RSS sources
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
    
    // Then, enhance with FRESH Feedly Pro+ results
    try {
      if (feedlyAPI.isConfigured) {
        console.log(`🤖 Enhancing with FRESH Feedly Pro+ for: "${query}"`);
        
        let feedlyResults = await feedlyAPI.simpleSearch(query, category, 30);
        const advancedResults = await feedlyAPI.searchContent(query, category, 30);
        feedlyResults = [...feedlyResults, ...advancedResults];
        
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
        
        console.log(`✅ Feedly FRESH added ${feedlyResults.length} unique articles`);
      } else {
        console.log(`⚠️ Feedly not configured, using RSS only`);
      }
      
    } catch (feedlyError) {
      console.error(`⚠️ Feedly enhancement failed: ${feedlyError.message}`);
    }
    
    articles.sort((a, b) => {
      const priorityDiff = (b.matchPriority || 0) - (a.matchPriority || 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 1) return scoreDiff;
      
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    console.log(`🎯 Total FRESH hybrid matches: ${articles.length}`);
    return articles.slice(0, 50);
    
  } catch (error) {
    console.error(`Hybrid scraping error: ${error.message}`);
    return [];
  }
}  

// Enhanced content fetching with ALL user keywords - NO CACHE, FRESH FEEDLY DATA
async function fetchEnhancedContent(category, userId = null) {
  try {
    console.log(`⚡ ENHANCED fetch for ${category} - ALL KEYWORDS, FRESH FEEDLY DATA`);
    
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
    
    console.log(`🎯 Processing ALL ${userKeywords.length} keywords with FRESH Feedly data`);
    
    for (let i = 0; i < userKeywords.length; i++) {
      const userKeyword = userKeywords[i];
      try {
        console.log(`   🎯 KEYWORD ${i + 1}/${userKeywords.length}: "${userKeyword.keyword}" - FRESH SEARCH`);
        
        const articles = await scrapeRealNews(userKeyword.keyword, category);
        console.log(`   ✅ Found ${articles.length} FRESH matches for: ${userKeyword.keyword}`);
        
        articles.forEach(article => {
          article.searchKeyword = userKeyword.keyword;
          article.keywordPriority = userKeyword.priority || 1;
        });
        
        allArticles.push(...articles);
        
        if (i < userKeywords.length - 1) {
          console.log(`   ⏳ Waiting before next keyword...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        console.error(`❌ Error searching for "${userKeyword.keyword}": ${error.message}`);
      }
    }
    
    console.log(`📊 Total FRESH articles from ALL keywords: ${allArticles.length}`);
    
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
    
    console.log(`🔄 After deduplication: ${uniqueArticles.length} unique FRESH articles`);
    
    uniqueArticles.sort((a, b) => {
      const priorityDiff = (b.keywordPriority || 1) - (a.keywordPriority || 1);
      if (priorityDiff !== 0) return priorityDiff;
      
      const matchDiff = (b.matchPriority || 0) - (a.matchPriority || 0);
      if (matchDiff !== 0) return matchDiff;
      
      const platformDiff = (b.platform === 'feedly_pro' ? 1 : 0) - (a.platform === 'feedly_pro' ? 1 : 0);
      if (platformDiff !== 0) return platformDiff;
      
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff;
      
      const engagementDiff = (b.feedlyEngagement || 0) - (a.feedlyEngagement || 0);
      if (engagementDiff !== 0) return engagementDiff;
      
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    const finalArticles = uniqueArticles.slice(0, 75);
    console.log(`✅ FINAL: ${finalArticles.length} FRESH enhanced matches from ALL ${userKeywords.length} keywords`);
    
    const keywordCoverage = {};
    const feedlyCount = finalArticles.filter(a => a.platform === 'feedly_pro').length;
    finalArticles.forEach(article => {
      const keyword = article.searchKeyword;
      if (keyword) {
        keywordCoverage[keyword] = (keywordCoverage[keyword] || 0) + 1;
      }
    });
    
    console.log(`📈 FRESH Keyword coverage:`, keywordCoverage);
    console.log(`🤖 Feedly Pro+ articles: ${feedlyCount}/${finalArticles.length}`);
    
    return finalArticles;
    
  } catch (error) {
    console.error(`Enhanced content fetch error: ${error.message}`);
    return [];
  }
}

// Keyword management functions
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
    description: `Use /addkeyword ${category} <your_keyword> to start getting FRESH enhanced news`,
    platform: 'help',
    sourceType: 'Feedly Pro+ Enhanced Bot'
  }];
}

// Enhanced message formatting function
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
    
    const summaryMessage = `🔥 *${category.toUpperCase()} FRESH FEEDLY PRO+ NEWS* 🔥

📊 *Found: ${articles.length} articles (Last 24 hours)*
🤖 *Fresh Feedly Pro+ Articles: ${feedlyCount}*
🌶️ *Spicy Content: ${spicyCount} articles*
🕵️ *Conspiracy Content: ${conspiracyCount} articles*
⭐ *Average Score: ${avgScore}/30*
🌐 *Sources: RSS + FRESH Feedly Pro+ hybrid*
🕐 *Updated: ${currentTime.toLocaleString('en-IN')}*

*🎯 ALL YOUR KEYWORDS + FRESH AI-enhanced discovery!*
*Score Legend:* 🌶️ Spice | 🕵️ Conspiracy | ⚡ Importance`;
    
    await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const chunkSize = 5;
    const totalChunks = Math.ceil(articles.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, articles.length);
      const chunk = articles.slice(startIndex, endIndex);
      
      let chunkMessage = `🎯 *${category.toUpperCase()} FRESH NEWS - Part ${i + 1}/${totalChunks}*\n\n`;
      
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
        chunkMessage += `✅ *Complete! Total: ${articles.length} FRESH articles*\n`;
        chunkMessage += `🏆 *Highest Score: ${topScore}/30*\n`;
        chunkMessage += `🎯 *Keywords used: ${uniqueKeywords.length}* | 🤖 *Fresh Feedly Pro+ Enhanced!*`;
      } else {
        chunkMessage += `📄 *Part ${i + 1}/${totalChunks} • More FRESH content coming...*`;
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

// BOT COMMAND HANDLERS - YE BILKUL MISSING HAI!
if (bot) {
  console.log('🤖 Setting up bot commands...');
  
  // Start command
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `🔥 *Welcome to Viral News Bot!* 🔥

🤖 *Enhanced with Feedly Pro+ AI*
📰 Get fresh, spicy news in 5 categories

*📋 Available Commands:*
/youtubers - YouTube creator news
/bollywood - Bollywood gossip & news  
/cricket - Cricket updates
/national - Indian national news
/pakistan - Pakistan news

*🎯 Keyword Management:*
/addkeyword <category> <keyword> - Add search terms
/listkeywords <category> - See your keywords
/removekeyword <category> <keyword> - Remove terms

*Example:* /addkeyword youtubers CarryMinati

*🚀 Start by adding keywords!*`;

    await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // YouTubers command
  bot.onText(/\/youtubers/, async (msg) => {
    const startTime = Date.now();
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const rateCheck = checkUserRateLimit(userId, 'youtubers');
    if (!rateCheck.allowed) {
      return bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateCheck.resetTime} minutes.`);
    }
    
    try {
      await bot.sendMessage(chatId, '🔍 Searching YouTuber news...');
      const articles = await fetchEnhancedContent('youtubers', userId);
      await formatAndSendNewsMessage(chatId, articles, 'youtubers', bot);
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
    } catch (error) {
      console.error('YouTubers error:', error);
      await bot.sendMessage(chatId, '❌ Error. Try again.');
      botStats.errors++;
    }
  });

  // Bollywood command
  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      await bot.sendMessage(chatId, '🔍 Searching Bollywood news...');
      const articles = await fetchEnhancedContent('bollywood', userId);
      await formatAndSendNewsMessage(chatId, articles, 'bollywood', bot);
      botStats.totalRequests++;
      botStats.successfulRequests++;
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error. Try again.');
      botStats.errors++;
    }
  });

  // Cricket command
  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      await bot.sendMessage(chatId, '🔍 Searching Cricket news...');
      const articles = await fetchEnhancedContent('cricket', userId);
      await formatAndSendNewsMessage(chatId, articles, 'cricket', bot);
      botStats.totalRequests++;
      botStats.successfulRequests++;
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error. Try again.');
      botStats.errors++;
    }
  });

  // National command
  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      await bot.sendMessage(chatId, '🔍 Searching National news...');
      const articles = await fetchEnhancedContent('national', userId);
      await formatAndSendNewsMessage(chatId, articles, 'national', bot);
      botStats.totalRequests++;
      botStats.successfulRequests++;
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error. Try again.');
      botStats.errors++;
    }
  });

  // Pakistan command
  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
      await bot.sendMessage(chatId, '🔍 Searching Pakistan news...');
      const articles = await fetchEnhancedContent('pakistan', userId);
      await formatAndSendNewsMessage(chatId, articles, 'pakistan', bot);
      botStats.totalRequests++;
      botStats.successfulRequests++;
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error. Try again.');
      botStats.errors++;
    }
  });

  // Add keyword command
  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    
    const parts = input.split(' ');
    if (parts.length < 2) {
      return bot.sendMessage(chatId, '❌ Format: /addkeyword <category> <keyword>\nExample: /addkeyword youtubers CarryMinati');
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    const validCategories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
    if (!validCategories.includes(category)) {
      return bot.sendMessage(chatId, `❌ Invalid category. Use: ${validCategories.join(', ')}`);
    }
    
    try {
      await database.addUserKeyword(userId, category, keyword, 5);
      await bot.sendMessage(chatId, `✅ Added "${keyword}" to ${category} keywords!`);
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error adding keyword. Try again.');
    }
  });

  // List keywords command
  bot.onText(/\/listkeywords (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const category = match[1].trim().toLowerCase();
    
    try {
      const keywords = await database.getUserKeywords(userId, category);
      if (keywords.length === 0) {
        return bot.sendMessage(chatId, `❌ No keywords found for ${category}. Add some with /addkeyword`);
      }
      
      let message = `📝 *Keywords for ${category}:*\n\n`;
      keywords.forEach((kw, index) => {
        message += `${index + 1}. ${kw.keyword} (Priority: ${kw.priority})\n`;
      });
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error fetching keywords.');
    }
  });

  // Remove keyword command
  bot.onText(/\/removekeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    
    const parts = input.split(' ');
    if (parts.length < 2) {
      return bot.sendMessage(chatId, '❌ Format: /removekeyword <category> <keyword>');
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    try {
      const results = await removeMultipleKeywords(userId, category, keyword);
      if (results[0]?.status === 'removed') {
        await bot.sendMessage(chatId, `✅ Removed "${keyword}" from ${category}!`);
      } else {
        await bot.sendMessage(chatId, `❌ Keyword "${keyword}" not found in ${category}.`);
      }
    } catch (error) {
      await bot.sendMessage(chatId, '❌ Error removing keyword.');
    }
  });

  // Stats command
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const uptime = Math.floor((Date.now() - botStats.startTime) / 1000 / 60);
    
    const statsMessage = `📊 *Bot Statistics*

🕐 Uptime: ${uptime} minutes
📈 Total requests: ${botStats.totalRequests}
✅ Successful: ${botStats.successfulRequests}
❌ Errors: ${botStats.errors}
🤖 Feedly requests: ${botStats.feedlyRequests}
📡 Status: ${feedlyAPI.isConfigured ? '🟢 Feedly Connected' : '🔴 RSS Only'}`;

    await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  });

  // Help command
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `🔥 *Viral News Bot Help* 🔥

*📰 News Commands:*
/youtubers - YouTube creator news
/bollywood - Bollywood updates
/cricket - Cricket news
/national - Indian news
/pakistan - Pakistan news

*🎯 Keyword Commands:*
/addkeyword <category> <keyword>
/listkeywords <category>
/removekeyword <category> <keyword>

*📊 Other Commands:*
/stats - Bot statistics
/start - Welcome message

*💡 Pro Tips:*
• Add multiple keywords for better results
• Keywords help AI find relevant content
• Fresh content updated every search

*🤖 Powered by Feedly Pro+ AI*`;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });

  console.log('✅ Bot commands registered successfully!');
}

// Health check route
app.get('/health', (req, res) => {
  const health = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - botStats.startTime) / 1000),
    botConnected: bot ? true : false,
    feedlyConnected: feedlyAPI.isConfigured,
    stats: botStats
  };
  res.json(health);
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Viral News Bot API',
    status: 'Running',
    version: '4.0',
    features: ['Feedly Pro+', 'Fresh Content', 'AI Enhanced']
  });
});

// ==========================================
// 4. SERVER STARTUP - SABSE LAST ME ADD KARO:
// ==========================================

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 App URL: ${APP_URL}`);
  console.log(`🤖 Bot status: ${bot ? 'Connected' : 'Not configured'}`);
  console.log(`📡 Feedly status: ${feedlyAPI.isConfigured ? 'Connected' : 'Not configured'}`);
  console.log(`🔥 Viral News Bot v4.0 started successfully!`);
});

// Error handling
server.on('error', (error) => {
  console.error('❌ Server error:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log('✅ All systems initialized!');

// Webhook setup for production
if (isProduction && bot) {
  console.log('🔗 Setting up webhook for production...');
  
  app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('Webhook error:', error);
      res.sendStatus(500);
    }
  });
  
  // Set webhook
  bot.setWebHook(`${APP_URL}/webhook/${BOT_TOKEN}`)
    .then(() => {
      console.log('✅ Webhook set successfully');
    })
    .catch((error) => {
      console.error('❌ Webhook setup failed:', error);
    });
} else if (!isProduction && bot) {
  console.log('🔄 Using polling for development...');
}

// 🧹 MEMORY CLEANUP - ADD THIS AFTER WEBHOOK SETUP

// Memory cleanup for rate limits
setInterval(() => {
  const now = Date.now();
  const oneHour = 3600000;
  
  // Clean rate limits Map
  for (const [key, times] of userRateLimits.entries()) {
    const filtered = times.filter(time => now - time < oneHour);
    if (filtered.length === 0) {
      userRateLimits.delete(key);
    } else {
      userRateLimits.set(key, filtered);
    }
  }
  
  console.log(`🧹 Memory cleanup: ${userRateLimits.size} active rate limits`);
}, 300000); // Every 5 minutes
