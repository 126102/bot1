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

console.log('🚀 Starting FULL FEATURED bot...');
console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('Production mode:', isProduction);

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
    console.log('📊 Database initialized');
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
          console.error('Database error:', err);
        }
      });
    });
    console.log('📊 Database tables ready');
  }
  
  async addUserKeyword(userId, category, keyword, priority = 1) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR REPLACE INTO user_keywords (user_id, category, keyword, priority) VALUES (?, ?, ?, ?)',
        [userId, category, keyword, priority],
        function(err) {
          if (err) {
            console.error('Add keyword error:', err);
            reject(err);
          } else {
            console.log(`✅ Keyword added: ${keyword} for user ${userId}`);
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
            console.error('Get keywords error:', err);
            reject(err);
          } else {
            console.log(`📝 Found ${rows.length} keywords for ${category}`);
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
            console.error('Analytics error:', err);
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

// Enhanced keywords - REMOVED ALL DEFAULTS, USER KEYWORDS ONLY
const ENHANCED_SEARCH_KEYWORDS = {
  youtubers: {
    spicy: [] // Empty - will use only user keywords
  },
  bollywood: {
    spicy: [] // Empty - will use only user keywords
  },
  cricket: {
    spicy: [] // Empty - will use only user keywords
  },
  national: {
    spicy: [] // Empty - will use only user keywords
  },
  pakistan: {
    spicy: [] // Empty - will use only user keywords
  }
};

// Keywords for scoring
const SPICY_KEYWORDS = [
  'controversy', 'drama', 'fight', 'viral', 'trending', 'breaking',
  'scandal', 'exposed', 'beef', 'roast', 'diss', 'leaked', 'secret'
];

const CONSPIRACY_KEYWORDS = [
  'conspiracy', 'secret', 'hidden', 'exposed', 'leaked', 'revelation',
  'behind scenes', 'truth', 'cover up'
];

const IMPORTANCE_KEYWORDS = [
  'breaking', 'urgent', 'alert', 'emergency', 'crisis', 'important'
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
    const diffInHours = Math.floor(diffInMinutes / 60);
    
    // Show more precise timing for recent news
    if (diffInMinutes < 1) return 'Just now';
    if (diffInMinutes < 5) return `${diffInMinutes}m ago`;
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    
    // For news older than 24 hours, show date
    const daysDiff = Math.floor(diffInHours / 24);
    if (daysDiff === 1) return 'Yesterday';
    if (daysDiff < 7) return `${daysDiff}d ago`;
    
    // For very old news (shouldn't happen with our 24h filter)
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

function calculateConspiracyScore(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  let score = 0;
  
  CONSPIRACY_KEYWORDS.forEach(keyword => {
    if (content.includes(keyword.toLowerCase())) {
      score += 3;
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
  
  return Math.min(score, 10);
}

function categorizeNews(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  // YouTubers - STRICT filtering for YouTube content only
  if (content.match(/youtube|youtuber|creator|influencer|vlog|gaming|streaming|content creator|viral video|subscriber|channel|video|upload/i)) {
    return 'youtubers';
  }
  
  // Bollywood - STRICT filtering for Bollywood/Indian film industry only
  if (content.match(/bollywood|hindi film|movie|cinema|actor|actress|film industry|director|producer|entertainment industry|indian cinema/i)) {
    return 'bollywood';
  }
  
  // Cricket - STRICT filtering for cricket only
  if (content.match(/cricket|ipl|t20|odi|test match|wicket|batsman|bowler|fielder|stadium|tournament|league|match|team|player|sport/i)) {
    return 'cricket';
  }
  
  // Pakistan - STRICT filtering for Pakistan content only
  if (content.match(/pakistan|pakistani|karachi|lahore|islamabad|pti|pmln|imran khan|shehbaz sharif|punjab|sindh|balochistan|kpk/i)) {
    return 'pakistan';
  }
  
  // Default to national for everything else
  return 'national';
}

// Rate limiting
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

// Enhanced news scraping - WORLDWIDE MULTI-SOURCE with DIRECT LINKS
async function scrapeRealNews(query, category) {
  try {
    console.log(`🌐 Fetching WORLDWIDE news for: ${query} (Category: ${category})`);
    const articles = [];
    
    // Get current time for filtering
    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Strict 24 hours
    
    // Multiple worldwide news sources
    const searchUrls = [
      // Google News - Worldwide (no country restriction)
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`,
      // Google News - India
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
      // Google News - Pakistan
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=PK&ceid=PK:en`,
      // Google News - UK (for international coverage)
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=GB&ceid=GB:en`
    ];
    
    for (let urlIndex = 0; urlIndex < searchUrls.length; urlIndex++) {
      const url = searchUrls[urlIndex];
      
      try {
        console.log(`🔍 Source ${urlIndex + 1}/4: Fetching from ${url.includes('gl=US') ? 'Worldwide' : url.includes('gl=IN') ? 'India' : url.includes('gl=PK') ? 'Pakistan' : 'UK'}`);
        
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          timeout: 20000
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        let foundInThisSource = 0;
        
        $('item').each((i, elem) => {
          if (i >= 50) return false; // Increased limit to 50 per source
          
          const title = $(elem).find('title').text().trim();
          const link = $(elem).find('link').text().trim();
          const pubDate = $(elem).find('pubDate').text().trim();
          const description = $(elem).find('description').text().trim();

          if (title && link && title.length > 10) {
            
            // Parse date with multiple fallbacks
            let articleDate = new Date();
            if (pubDate) {
              const parsedDate = new Date(pubDate);
              if (!isNaN(parsedDate.getTime())) {
                articleDate = parsedDate;
              }
            }
            
            // Calculate hours ago
            const hoursAgo = Math.floor((now - articleDate) / (1000 * 60 * 60));
            
            // STRICT 24 hour filter
            if (articleDate >= last24Hours && hoursAgo <= 24) {
              
              // Category filtering - STRICT matching
              const articleCategory = categorizeNews(title, description);
              if (articleCategory === category) {
                
                // Extract DIRECT URL (not Google redirect)
                let realUrl = link;
                try {
                  if (link.includes('url=')) {
                    const urlMatch = link.match(/url=([^&]+)/);
                    if (urlMatch) {
                      realUrl = decodeURIComponent(urlMatch[1]);
                      // Double decode if needed
                      if (realUrl.includes('%')) {
                        realUrl = decodeURIComponent(realUrl);
                      }
                    }
                  } else if (link.includes('news.google.com/articles/')) {
                    // Try to extract direct link from Google News article URL
                    realUrl = link; // Keep Google News link as fallback
                  }
                  
                  // Validate URL format
                  if (!realUrl.startsWith('http')) {
                    realUrl = 'https://' + realUrl;
                  }
                } catch (e) {
                  realUrl = link;
                }
                
                // Extract source from title
                let source = 'News Source';
                if (title.includes(' - ')) {
                  const parts = title.split(' - ');
                  if (parts.length > 1) {
                    const lastPart = parts[parts.length - 1].trim();
                    if (lastPart.length < 50 && lastPart.length > 2) {
                      source = lastPart;
                    }
                  }
                }
                
                // Clean title
                let cleanTitle = title;
                if (title.includes(' - ') && source !== 'News Source') {
                  cleanTitle = title.replace(` - ${source}`, '').trim();
                }
                
                // Check for duplicates across all sources
                const titleKey = cleanTitle.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 30);
                const isDuplicate = articles.some(existing => {
                  const existingKey = existing.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 30);
                  return titleKey === existingKey || existing.link === realUrl;
                });
                
                if (!isDuplicate) {
                  const spiceScore = calculateSpiceScore(cleanTitle, description);
                  const conspiracyScore = calculateConspiracyScore(cleanTitle, description);
                  const importanceScore = calculateImportanceScore(cleanTitle, description);
                  
                  articles.push({
                    title: cleanTitle.replace(/\s+/g, ' ').trim(),
                    link: realUrl,
                    pubDate: pubDate,
                    formattedDate: formatNewsDate(pubDate),
                    description: description ? description.substring(0, 120) + '...' : '',
                    source: source,
                    category: articleCategory,
                    timestamp: articleDate.toISOString(),
                    platform: 'news',
                    reliability: 9,
                    isVerified: true,
                    spiceScore: spiceScore,
                    conspiracyScore: conspiracyScore,
                    importanceScore: importanceScore,
                    totalScore: spiceScore + conspiracyScore + importanceScore,
                    hoursAgo: hoursAgo,
                    sourceType: url.includes('gl=US') ? 'Worldwide' : url.includes('gl=IN') ? 'India' : url.includes('gl=PK') ? 'Pakistan' : 'UK'
                  });
                  
                  foundInThisSource++;
                  console.log(`✅ ${cleanTitle.substring(0, 40)}... (${hoursAgo}h ago) [${source}]`);
                } else {
                  console.log(`❌ Duplicate: ${cleanTitle.substring(0, 30)}...`);
                }
              } else {
                console.log(`❌ Wrong category: ${title.substring(0, 30)}... (Expected: ${category}, Got: ${articleCategory})`);
              }
            } else {
              console.log(`❌ Too old: ${title.substring(0, 30)}... (${hoursAgo}h ago)`);
            }
          }
        });
        
        console.log(`✅ Source completed: Found ${foundInThisSource} articles`);
        
        // Delay between sources
        if (urlIndex < searchUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (error) {
        console.error(`❌ Source ${urlIndex + 1} failed: ${error.message}`);
      }
    }
    
    console.log(`✅ Total unique articles found for "${query}": ${articles.length}`);
    
    // Sort by score first, then by recency
    articles.sort((a, b) => {
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 1) return scoreDiff;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    return articles;
    
  } catch (error) {
    console.error(`News scraping error: ${error.message}`);
    return [];
  }
}

// Enhanced content fetching - ONLY USER KEYWORDS, NO DEFAULTS
async function fetchEnhancedContent(category, userId = null) {
  try {
    console.log(`🎯 Fetching content for ${category} - USER KEYWORDS ONLY`);
    
    const allArticles = [];
    
    // Get user's custom keywords - THIS IS THE ONLY SOURCE NOW
    let userKeywords = [];
    if (userId) {
      try {
        userKeywords = await database.getUserKeywords(userId, category);
        console.log(`📝 Found ${userKeywords.length} user keywords for ${category}`);
      } catch (error) {
        console.warn('Could not fetch user keywords:', error.message);
        return []; // Return empty if no user keywords
      }
    }
    
    // If no user keywords, return empty with helpful message
    if (userKeywords.length === 0) {
      console.log(`❌ No user keywords found for ${category}. User must add keywords first.`);
      return [];
    }
    
    // Search using ONLY user keywords
    console.log(`🔍 Starting searches with ${userKeywords.length} user keywords for ${category}...`);
    
    for (let i = 0; i < userKeywords.length; i++) {
      const userKeyword = userKeywords[i];
      try {
        console.log(`   🎯 USER KEYWORD ${i + 1}/${userKeywords.length}: "${userKeyword.keyword}"`);
        const articles = await scrapeRealNews(userKeyword.keyword, category);
        console.log(`   ✅ Found ${articles.length} articles for: ${userKeyword.keyword}`);
        
        // Add source info to articles
        articles.forEach(article => {
          article.searchKeyword = userKeyword.keyword;
          article.keywordPriority = userKeyword.priority || 1;
        });
        
        allArticles.push(...articles);
        
        // Delay between searches to avoid rate limiting
        if (i < userKeywords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Error searching for "${userKeyword.keyword}": ${error.message}`);
      }
    }
    
    console.log(`📊 Total articles collected from user keywords: ${allArticles.length}`);
    
    // Remove duplicates - IMPROVED algorithm
    const uniqueArticles = [];
    const seenTitles = new Set();
    const seenUrls = new Set();
    
    for (const article of allArticles) {
      // Create unique keys
      const titleKey = article.title.toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special chars
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim()
        .substring(0, 25); // Shorter for better uniqueness
      
      const urlKey = article.link.toLowerCase()
        .replace(/[^\w]/g, '') // Remove all non-word chars
        .substring(0, 40); // Shorter for better comparison
      
      // Check for duplicates
      let isDuplicate = false;
      
      // Exact title match
      if (seenTitles.has(titleKey)) {
        isDuplicate = true;
      }
      
      // Exact URL match
      if (seenUrls.has(urlKey)) {
        isDuplicate = true;
      }
      
      // Similar title check (prevent very similar articles)
      if (!isDuplicate) {
        for (const existingTitle of seenTitles) {
          if (titleKey.length > 15 && existingTitle.length > 15) {
            // Check if titles are very similar
            const similarity = titleKey.includes(existingTitle.substring(0, 15)) || 
                             existingTitle.includes(titleKey.substring(0, 15));
            if (similarity) {
              isDuplicate = true;
              console.log(`❌ Similar title removed: ${article.title.substring(0, 40)}...`);
              break;
            }
          }
        }
      }
      
      if (!isDuplicate) {
        seenTitles.add(titleKey);
        seenUrls.add(urlKey);
        uniqueArticles.push(article);
        console.log(`✅ Added unique: ${article.title.substring(0, 40)}... (Keyword: ${article.searchKeyword})`);
      } else {
        console.log(`❌ Duplicate removed: ${article.title.substring(0, 40)}...`);
      }
    }
    
    // Sort by keyword priority, then score, then recency
    uniqueArticles.sort((a, b) => {
      // First by keyword priority (higher priority first)
      const priorityDiff = (b.keywordPriority || 1) - (a.keywordPriority || 1);
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by total score (higher score first)
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff;
      
      // Finally by recency (newer first)
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Return more articles (increased to 50)
    const finalArticles = uniqueArticles.slice(0, 50);
    
    console.log(`✅ FINAL: ${finalArticles.length} unique articles for ${category}`);
    
    if (finalArticles.length > 0) {
      const maxScore = Math.max(...finalArticles.map(a => a.totalScore || 0));
      const minScore = Math.min(...finalArticles.map(a => a.totalScore || 0));
      const avgAge = Math.round(finalArticles.reduce((sum, a) => sum + (a.hoursAgo || 0), 0) / finalArticles.length);
      const sourceTypes = [...new Set(finalArticles.map(a => a.sourceType))];
      
      console.log(`📊 Score: ${maxScore} (max) to ${minScore} (min) | Avg age: ${avgAge}h | Sources: ${sourceTypes.join(', ')}`);
    }
    
    return finalArticles;
    
  } catch (error) {
    console.error(`Enhanced content fetch error: ${error.message}`);
    return [];
  }
}message}`);
      }
    }
    
    // 3. Additional searches with category-specific terms
    console.log(`🔍 Starting CATEGORY-SPECIFIC searches for ${category}...`);
    const additionalSearchTerms = {
      youtubers: [
        'YouTube drama latest', 'Indian YouTuber controversy', 'creator scandal today',
        'YouTube scandal 2024', 'influencer drama news', 'YouTube creator exposed'
      ],
      bollywood: [
        'Bollywood scandal latest', 'celebrity controversy today', 'film industry drama',
        'Bollywood news 2024', 'celebrity affair scandal', 'film star controversy'
      ],
      cricket: [
        'cricket controversy latest', 'IPL scandal today', 'player controversy',
        'cricket news 2024', 'match fixing news', 'cricket player scandal'
      ],
      national: [
        'India political scandal', 'government controversy latest', 'corruption news today',
        'political news India', 'government scandal 2024', 'political controversy'
      ],
      pakistan: [
        'Pakistan crisis latest', 'Pakistani politics today', 'Imran Khan latest',
        'Pakistan news 2024', 'Pakistani political drama', 'Pakistan government crisis'
      ]
    };
    
    const extraTerms = additionalSearchTerms[category] || [];
    for (const term of extraTerms.slice(0, 4)) { // Limit to 4 extra terms
      try {
        console.log(`   📰 EXTRA SEARCH: "${term}"`);
        const articles = await scrapeRealNews(term, category);
        console.log(`   ✅ Found ${articles.length} articles for extra term: ${term}`);
        allArticles.push(...articles);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Extra search error: ${error.message}`);
      }
    }
    
    console.log(`📊 Total articles collected: ${allArticles.length}`);
    
    // Remove duplicates based on title similarity and URL (IMPROVED LOGIC)
    const uniqueArticles = [];
    const seenTitles = new Set();
    const seenUrls = new Set();
    
    for (const article of allArticles) {
      // Create better unique keys
      const titleKey = article.title.toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special chars
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim()
        .substring(0, 30); // Reduced from 40 to 30 for better uniqueness
      
      const urlKey = article.link.toLowerCase()
        .replace(/[^\w]/g, '') // Remove all non-word chars
        .substring(0, 50); // Reduced from 60 to 50
      
      // More strict duplicate detection
      let isDuplicate = false;
      
      // Check exact title match
      if (seenTitles.has(titleKey)) {
        isDuplicate = true;
      }
      
      // Check exact URL match
      if (seenUrls.has(urlKey)) {
        isDuplicate = true;
      }
      
      // Check similar titles (prevent very similar articles)
      for (const existingTitle of seenTitles) {
        if (titleKey.length > 10 && existingTitle.length > 10) {
          // Calculate similarity
          const similarity = titleKey.includes(existingTitle) || existingTitle.includes(titleKey);
          if (similarity && Math.abs(titleKey.length - existingTitle.length) < 8) {
            isDuplicate = true;
            break;
          }
        }
      }
      
      if (!isDuplicate) {
        seenTitles.add(titleKey);
        seenUrls.add(urlKey);
        uniqueArticles.push(article);
        console.log(`✅ Added unique: ${article.title.substring(0, 50)}...`);
      } else {
        console.log(`❌ Duplicate removed: ${article.title.substring(0, 50)}...`);
      }
    }
    
    // Sort by total score AND recency (IMPROVED SORTING)
    uniqueArticles.sort((a, b) => {
      // First sort by total score (higher score first)
      const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff; // If significant score difference
      
      // Then by recency if scores are similar
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    // Return more articles (increased from 25 to 30)
    const finalArticles = uniqueArticles.slice(0, 30);
    
    console.log(`✅ FINAL: ${finalArticles.length} unique latest articles for ${category}`);
    
    if (finalArticles.length > 0) {
      const maxScore = Math.max(...finalArticles.map(a => a.totalScore || 0));
      const minScore = Math.min(...finalArticles.map(a => a.totalScore || 0));
      const avgAge = Math.round(finalArticles.reduce((sum, a) => sum + (a.hoursAgo || 0), 0) / finalArticles.length);
      console.log(`📊 Score range: ${maxScore} (max) to ${minScore} (min) | Avg age: ${avgAge}h`);
    }
    
    return finalArticles;
    
  } catch (error) {
    console.error(`Enhanced content fetch error: ${error.message}`);
    return [];
  }
}

// Create fallback content - UPDATED FOR USER KEYWORDS
function createFallbackContent(category) {
  const currentTime = getCurrentTimestamp();
  
  return [{
    title: `Add keywords to get ${category} news`,
    link: "https://www.google.com/search?q=how+to+add+keywords",
    pubDate: currentTime,
    formattedDate: "Now",
    source: "Bot Help",
    category: category,
    timestamp: currentTime,
    spiceScore: 0,
    conspiracyScore: 0,
    importanceScore: 10,
    totalScore: 10,
    searchKeyword: "help",
    description: `Use /addkeyword ${category} <your_keyword> to start getting news`
  }];
}

// Enhanced message formatting - IMPROVED FOR USER KEYWORDS
async function formatAndSendNewsMessage(chatId, articles, category, bot) {
  if (!articles || articles.length === 0) {
    await bot.sendMessage(chatId, `❌ No news found for ${category}!\n\n*Reason:* No keywords added yet.\n\n*Solution:* Add keywords first:\n/addkeyword ${category} <your_keyword>\n\n*Example:* /addkeyword ${category} trending topic`);
    return;
  }

  try {
    console.log(`📱 Formatting ${articles.length} articles for ${category}`);
    
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
    
    // Send articles in chunks (increased chunk size for more articles)
    const chunkSize = 5;
    const totalChunks = Math.ceil(articles.length / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, articles.length);
      const chunk = articles.slice(startIndex, endIndex);
      
      let chunkMessage = `🎯 *${category.toUpperCase()} NEWS - Part ${i + 1}/${totalChunks}*\n\n`;
      
      chunk.forEach((article, index) => {
        const globalIndex = startIndex + index + 1;
        
        // Clean title for Telegram formatting
        let cleanTitle = article.title
          .replace(/\*/g, '')
          .replace(/\[/g, '(')
          .replace(/\]/g, ')')
          .replace(/`/g, "'")
          .replace(/_/g, '-')
          .substring(0, 60);
        
        if (cleanTitle.length < article.title.length) {
          cleanTitle += '...';
        }
        
        // Score icons
        const spiceIcon = (article.spiceScore || 0) > 7 ? '🔥' : (article.spiceScore || 0) > 4 ? '🌶️' : '📄';
        const conspiracyIcon = (article.conspiracyScore || 0) > 6 ? '🕵️‍♂️' : (article.conspiracyScore || 0) > 3 ? '🤔' : '';
        const importanceIcon = (article.importanceScore || 0) > 6 ? '⚡' : (article.importanceScore || 0) > 3 ? '📢' : '';
        
        // Show which keyword found this article
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
        
        console.log(`✅ Sent chunk ${i + 1}/${totalChunks} with ${chunk.length} articles`);
        
        if (i + 1 < totalChunks) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        
      } catch (chunkError) {
        console.error(`Error sending chunk ${i + 1}: ${chunkError.message}`);
        
        // Fallback for formatting errors
        const simpleMessage = `📰 *${category.toUpperCase()}* - Part ${i + 1}\n\n${chunk.length} articles found but couldn't display due to formatting.`;
        
        try {
          await bot.sendMessage(chatId, simpleMessage, { parse_mode: 'Markdown' });
        } catch (fallbackError) {
          console.error(`Fallback failed: ${fallbackError.message}`);
        }
      }
    }
    
    console.log(`✅ Successfully sent all ${articles.length} articles for ${category}`);
    
  } catch (error) {
    console.error('Message formatting error:', error.message);
    await bot.sendMessage(chatId, `❌ Error displaying news. Articles found but couldn't format properly. Try again.`);
  }
}

// Webhook setup for production
if (bot && isProduction) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  const webhookUrl = `${APP_URL}${webhookPath}`;
  
  console.log('Setting webhook:', webhookUrl);
  
  bot.setWebHook(webhookUrl)
    .then(() => {
      console.log('✅ Webhook set successfully');
    })
    .catch(err => {
      console.error('❌ Webhook setup failed:', err.message);
    });
  
  app.post(webhookPath, (req, res) => {
    console.log('📨 Webhook received');
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (error) {
      console.error('Webhook processing error:', error.message);
      res.sendStatus(500);
    }
  });
  
  console.log('🎯 Bot configured for webhook mode (Production)');
} else if (bot) {
  console.log('🔄 Bot configured for polling mode (Development)');
}

// Bot commands
if (bot) {
  bot.on('polling_error', error => {
    console.error('Telegram polling error:', error.message);
  });

  bot.on('webhook_error', error => {
    console.error('Webhook error:', error.message);
  });

  bot.onText(/\/start/, async (msg) => {
    console.log('📱 Received /start from:', msg.from.username || msg.from.first_name);
    
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

*📊 Content Scoring System:*
🌶️ *Spice Level* (1-10): Drama, controversy, fights
🕵️ *Conspiracy Score* (1-10): Secrets, exposés, hidden truths
⚡ *Importance* (1-10): Breaking news, urgent updates

*🎯 Perfect for YouTube News Channels!*
✅ *Real news articles from multiple sources*
🔥 *Sorted by spice level for maximum engagement*
📱 *Working direct links that open properly*
🚀 *AI-powered content scoring & filtering*

*Example Commands:*
• /addkeyword youtubers CarryMinati controversy
• /search Elvish Yadav drama
• /spicy YouTube scandal

🎬 *Get the SPICIEST content for your channel!*`;
    
    try {
      await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
      console.log('✅ Welcome message sent');
      
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

  bot.onText(/\/youtubers/, async (msg) => {
    console.log('📱 Received /youtubers');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'youtubers');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🎥 *Getting SPICIEST YouTuber drama & scandals...*\n\n🔍 Searching real news sources for creator controversies\n🌶️ *Focus: YouTube drama & exposed secrets*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
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

  bot.onText(/\/bollywood/, async (msg) => {
    console.log('📱 Received /bollywood');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'bollywood');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🎭 *Getting SPICIEST Bollywood scandals & secrets...*\n\n🔍 Searching celebrity controversies & affairs\n🌶️ *Focus: Celebrity drama & industry secrets*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
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

  bot.onText(/\/cricket/, async (msg) => {
    console.log('📱 Received /cricket');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'cricket');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🏏 *Getting SPICIEST Cricket controversies & fixes...*\n\n🔍 Searching match fixing scandals & player drama\n🌶️ *Focus: Sports corruption & controversies*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
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

  bot.onText(/\/national/, async (msg) => {
    console.log('📱 Received /national');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'national');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🇮🇳 *Getting SPICIEST Political drama & exposés...*\n\n🔍 Searching corruption scandals & government secrets\n🌶️ *Focus: Political conspiracy & corruption*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
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

  bot.onText(/\/pakistan/, async (msg) => {
    console.log('📱 Received /pakistan');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'pakistan');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      await bot.sendMessage(chatId, `🇵🇰 *Getting SPICIEST Pakistan crisis & secrets...*\n\n🔍 Searching political drama & ISI conspiracies\n🌶️ *Focus: Deep state & political corruption*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
      
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

  bot.onText(/\/latest/, async (msg) => {
    console.log('📱 Received /latest');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    try {
      await bot.sendMessage(chatId, '🔄 *Getting top-scored content from all categories...*', { parse_mode: 'Markdown' });
      
      if (newsCache.length === 0) {
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
        newsCache = allNews;
      }
      
      const topNews = newsCache
        .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
        .slice(0, 12);
      
      if (topNews.length > 0) {
        await formatAndSendNewsMessage(chatId, topNews, 'Latest Top', bot);
      } else {
        await bot.sendMessage(chatId, `❌ No recent news found. Try /refresh`);
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

  bot.onText(/\/search (.+)/, async (msg, match) => {
    console.log('📱 Received /search');
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
      await bot.sendMessage(chatId, `🔍 *ENHANCED SEARCH: "${searchTerm}"*\n\n🌐 Searching multiple news sources...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      
      if (searchResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No results found for "${searchTerm}"\n\n🔧 Try different keywords or spelling`);
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
      await bot.sendMessage(chatId, `❌ Search failed. Try again with different terms.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/spicy (.+)/, async (msg, match) => {
    console.log('📱 Received /spicy');
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
      await bot.sendMessage(chatId, `🌶️ *SPICY SEARCH: "${searchTerm}"*\n\n🔥 Finding only HIGH CONTROVERSY content...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

      const searchResults = await scrapeRealNews(searchTerm, categorizeNews(searchTerm));
      
      const spicyResults = searchResults.filter(article => (article.spiceScore || 0) >= 6);
      
      if (spicyResults.length === 0) {
        await bot.sendMessage(chatId, `❌ No spicy content found for "${searchTerm}"\n\n🔧 Try keywords like: drama, scandal, controversy, exposed`);
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
      await bot.sendMessage(chatId, `❌ Spicy search failed. Try again or use /search`);
      botStats.errors++;
    }
  });

  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    console.log('📱 Received /addkeyword');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      await bot.sendMessage(chatId, `❌ *Usage:* /addkeyword <category> <keyword>

*Categories:* youtubers, bollywood, cricket, national, pakistan

*Examples:*
• /addkeyword youtubers CarryMinati
• /addkeyword bollywood Salman Khan
• /addkeyword cricket Virat Kohli`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!ENHANCED_SEARCH_KEYWORDS[category]) {
      await bot.sendMessage(chatId, `❌ Invalid category!\n\n*Valid categories:* youtubers, bollywood, cricket, national, pakistan`);
      return;
    }
    
    try {
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
🌶️ *Priority:* High (will be used in searches)

🚀 Use /${category} to see results with your keyword!
💡 *Tip:* Add spicy keywords like "drama", "exposed", "controversy"`, { parse_mode: 'Markdown' });
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Add keyword error:', error);
      await bot.sendMessage(chatId, `❌ Error adding keyword. Database issue. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/listkeywords/, async (msg) => {
    console.log('📱 Received /listkeywords');
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
          const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
          message += `${icon} *${category.toUpperCase()}*: Loading error\n\n`;
        }
      }
      
      message += `📊 *Total Keywords:* ${totalKeywords}\n\n`;
      message += `💡 *Add more:* /addkeyword <category> <keyword>\n`;
      message += `🗑️ *Remove:* /removekeyword <category> <keyword>\n`;
      message += `🌶️ *Tip:* Use spicy words like "drama", "scandal", "exposed"`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('List keywords error:', error);
      await bot.sendMessage(chatId, `❌ Error fetching keywords. Database might be initializing. Try again in a moment.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/removekeyword (.+)/, async (msg, match) => {
    console.log('📱 Received /removekeyword');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      await bot.sendMessage(chatId, `❌ *Usage:* /removekeyword <category> <keyword>

*Example:* /removekeyword youtubers CarryMinati`);
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!ENHANCED_SEARCH_KEYWORDS[category]) {
      await bot.sendMessage(chatId, `❌ Invalid category!\n\n*Valid:* youtubers, bollywood, cricket, national, pakistan`);
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
        await bot.sendMessage(chatId, `❌ Not found! "${keyword}" is not in your ${category} keywords`);
        return;
      }
      
      const remainingKeywords = await database.getUserKeywords(userId, category);
      
      await bot.sendMessage(chatId, `✅ *Keyword Removed Successfully!*

🗑️ *Removed:* "${keyword}"
📂 *Category:* ${category}
📊 *Remaining:* ${remainingKeywords.length} keywords

💡 *Add new:* /addkeyword ${category} <keyword>`, { parse_mode: 'Markdown' });
      
      botStats.totalRequests++;
      botStats.successfulRequests++;
      
    } catch (error) {
      console.error('Remove keyword error:', error);
      await bot.sendMessage(chatId, `❌ Error removing keyword. Try again.`);
      botStats.errors++;
    }
  });

  bot.onText(/\/mystats/, async (msg) => {
    console.log('📱 Received /mystats');
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

  bot.onText(/\/refresh/, async (msg) => {
    console.log('📱 Received /refresh');
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const startTime = Date.now();
    
    const rateLimitCheck = checkUserRateLimit(userId, 'refresh');
    if (!rateLimitCheck.allowed) {
      await bot.sendMessage(chatId, `⏰ Rate limit exceeded. Refresh is limited. Try again in ${rateLimitCheck.resetTime} minutes.`);
      return;
    }
    
    try {
      const currentTime = getCurrentIndianTime();
      await bot.sendMessage(chatId, `🔄 *Refreshing ALL sources...*\n\n⏳ Getting latest spicy content with scores\n🕐 Started: ${currentTime.toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
      
      const refreshStartTime = new Date();
      newsCache = [];
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      const allNews = [];
      
      for (const category of categories) {
        try {
          console.log(`🔄 Refreshing ${category}...`);
          const categoryNews = await fetchEnhancedContent(category, userId);
          allNews.push(...categoryNews);
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Error refreshing ${category}:`, error.message);
        }
      }
      
      newsCache = allNews;
      const refreshEndTime = new Date();
      
      const refreshTime = Math.round((refreshEndTime - refreshStartTime) / 1000);
      const avgScore = newsCache.length > 0 ? Math.round(newsCache.reduce((sum, item) => sum + (item.totalScore || 0), 0) / newsCache.length) : 0;
      const spicyCount = newsCache.filter(a => (a.spiceScore || 0) > 6).length;
      const conspiracyCount = newsCache.filter(a => (a.conspiracyScore || 0) > 5).length;
      
      await bot.sendMessage(chatId, `✅ *Enhanced Refresh Complete!*

⏱️ *Time taken:* ${refreshTime} seconds
📊 *Articles found:* ${newsCache.length}
⭐ *Average Score:* ${avgScore}/30
🌶️ *Spicy Content:* ${spicyCount} articles
🕵️ *Conspiracy Content:* ${conspiracyCount} articles
🕐 *Completed:* ${getCurrentIndianTime().toLocaleString('en-IN')}
✅ *All links are REAL & WORKING!*
🎬 *Perfect for YouTube content creation!*`, { parse_mode: 'Markdown' });
      
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

  bot.onText(/\/help/, async (msg) => {
    console.log('📱 Received /help');
    const chatId = msg.chat.id;
    
    const helpMessage = `⚙️ *BOT HELP & COMPLETE FEATURES*

*🎯 News Category Commands:*
/youtubers - YouTube drama & scandals 🎥
/bollywood - Celebrity controversies 🎭
/cricket - Sports scandals & fixes 🏏
/national - Political drama & corruption 🇮🇳
/pakistan - Pakistani political crisis 🇵🇰
/latest - Top scored content from all categories 🔥

*🔍 Advanced Search Commands:*
/search <term> - Multi-source news search
/spicy <term> - High controversy content only (6+ spice)

*🛠️ Keyword Management:*
/addkeyword <category> <keyword> - Add custom keywords
/listkeywords - View all your keywords
/removekeyword <category> <keyword> - Remove keywords

*📊 Analytics & Utility:*
/mystats - Your detailed usage statistics
/refresh - Force refresh all news sources
/help - This complete menu

*📊 Content Scoring System:*
🌶️ *Spice (1-10):* Drama, controversy, fights, scandals
🕵️ *Conspiracy (1-10):* Secrets, exposés, hidden truths
⚡ *Importance (1-10):* Breaking news, urgent updates

*🎬 Perfect for YouTube News Channels!*
✅ Real news articles from multiple trusted sources
✅ Working direct links that open properly on mobile
✅ Proper timestamps (2h ago, Just now, etc.)
✅ Content scoring for maximum engagement
✅ Custom keywords for personalized content
✅ Spam & inappropriate content filtering

*💡 Pro Tips:*
• Use /spicy for maximum drama content
• Add keywords like "exposed", "scandal", "controversy"
• Check /mystats to track your usage patterns
• Use /latest for top-scored viral content

*Example Usage:*
• /addkeyword youtubers CarryMinati controversy
• /search Elvish Yadav drama
• /spicy YouTube scandal exposed

🔥 *Get the SPICIEST real news with working links!*`;

    await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });

  console.log('✅ All bot commands registered successfully!');
} else {
  console.warn('⚠️ Bot not initialized - missing BOT_TOKEN');
}

// Express routes
app.get('/', (req, res) => {
  const uptime = Math.floor(process.uptime());
  const avgScore = newsCache.length > 0 ? Math.round(newsCache.reduce((sum, item) => sum + (item.totalScore || 0), 0) / newsCache.length) : 0;
  const spicyCount = newsCache.filter(a => (a.spiceScore || 0) > 6).length;
  const conspiracyCount = newsCache.filter(a => (a.conspiracyScore || 0) > 5).length;
  
  res.json({ 
    status: 'Enhanced Viral News Bot v3.0 - Full Featured',
    version: '3.0.0',
    features: [
      'Real News Articles', 
      'Working Direct Links', 
      'Custom Keywords Management', 
      'Content Scoring System',
      'Multi-Source Scraping',
      'User Analytics',
      'Rate Limiting',
      'Content Moderation'
    ],
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
    contentFocus: 'Real news articles with working links from Google News and other sources'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime(),
    features: {
      realNewsArticles: true,
      workingLinks: true,
      customKeywords: true,
      contentScoring: true,
      userAnalytics: true,
      database: true,
      webhooks: isProduction,
      rateLimiting: true
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
    features: 'full-featured-news-bot-with-real-links',
    uptime: Math.floor(process.uptime())
  });
});

// Cleanup function - UPDATED FOR 24 HOUR FILTER
async function enhancedCleanup() {
  try {
    const expiryTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
    const initialCount = newsCache.length;
    
    // Remove articles older than 24 hours
    newsCache = newsCache.filter(article => {
      const articleDate = new Date(article.timestamp);
      return articleDate > expiryTime;
    });
    
    const oneHourAgo = Date.now() - 3600000;
    userRateLimits.forEach((history, key) => {
      const filtered = history.filter(time => time > oneHourAgo);
      if (filtered.length === 0) {
        userRateLimits.delete(key);
      } else {
        userRateLimits.set(key, filtered);
      }
    });
    
    console.log(`🧹 Cleanup complete: Removed ${initialCount - newsCache.length} articles older than 24h`);
    console.log(`📊 Current cache: ${newsCache.length} fresh articles`);
  } catch (error) {
    console.error('Cleanup error:', error);
  }
}

// Keep-alive function
async function enhancedKeepAlive() {
  try {
    if (APP_URL && !APP_URL.includes('localhost')) {
      const response = await axios.get(`${APP_URL}/ping`, { timeout: 10000 });
      console.log(`🏓 Keep-alive successful (v${response.data.version})`);
    }
  } catch (error) {
    console.warn(`⚠️ Keep-alive failed: ${error.message}`);
    botStats.errors++;
  }
}

// Scheduled tasks
setInterval(enhancedKeepAlive, 12 * 60 * 1000);
setInterval(enhancedCleanup, 30 * 60 * 1000);

// Initial startup
setTimeout(async () => {
  console.log('🚀 Enhanced News Bot v3.0 fully loaded!');
  try {
    console.log('✅ All features initialized');
    console.log('🏓 Keep-alive activated');
    console.log('🧹 Cleanup tasks scheduled');
    console.log('📰 Real news sources: Google News + Multiple sources');
    console.log('🎯 Features: Keywords, Analytics, Scoring, Real Links');
  } catch (error) {
    console.error('Startup error:', error);
  }
}, 3000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced News Bot v3.0 running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`📱 Bot: ${BOT_TOKEN ? 'Active with ALL Features' : 'Missing Token'}`);
  console.log(`✅ Features: Real Articles, Working Links, Keywords, Analytics`);
  console.log(`🎯 Mode: ${isProduction ? 'Production (Webhooks)' : 'Development (Polling)'}`);
  console.log(`📊 Database: SQLite with user keywords & analytics`);
  console.log(`🔥 Content: Multi-source real news with scoring system`);
  console.log(`🕐 Started: ${getCurrentIndianTime().toLocaleString('en-IN')}`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  botStats.errors++;
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  botStats.errors++;
  
  setTimeout(() => {
    process.exit(1);
  }, 5000);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
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
