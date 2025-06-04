const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Bot configuration with error handling and webhook mode for production
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN environment variable is required!');
  console.log('🔧 Please set BOT_TOKEN in your environment variables');
  console.log('📱 Get your token from @BotFather on Telegram');
  console.log('🚀 Bot will run in API-only mode (no Telegram polling)');
}

// Use webhook in production to avoid multiple instance conflicts
const isProduction = process.env.NODE_ENV === 'production';
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,  // Only use polling in development
  webHook: isProduction    // Use webhook in production
}) : null;

// News sources and handles
const NEWS_SOURCES = {
  indian_news: [
    'https://www.ndtv.com/latest',
    'https://indianexpress.com/section/india/',
    'https://timesofindia.indiatimes.com/briefs.cms',
    'https://www.news18.com/news/'
  ],
  rss_feeds: [
    'https://feeds.feedburner.com/ndtvnews-latest',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://www.news18.com/commonfeeds/v1/eng/rss/india.xml',
    'https://indianexpress.com/print/front-page/feed/'
  ],
  twitter_handles: {
    youtubers: [
      'CarryMinati', 'ashchanchlani', 'TriggeredInsaan', 'ElvishYadav', 
      'BBkvines', 'TechnoGamerz123', 'dhruv_rathee', 'ScoutOP', 
      'totalgaming093', 'flyingbeast320', 'GyanGaming2', 'AmanDhattarwal'
    ],
    bollywood: [
      'BeingSalmanKhan', 'iamsrk', 'TheAaryanKartik', 'RanveerOfficial',
      'akshaykumar', 'aliaa08', 'kritisanon', 'deepikapadukone', 'ananyapandayy'
    ],
    cricketers: [
      'imVkohli', 'ImRo45', 'hardikpandya7', 'ShubmanGill',
      'RishabhPant17', 'klrahul', 'Jaspritbumrah93', 'msdhoni'
    ],
    news_outlets: [
      'aajtak', 'ndtv', 'ABPNews', 'republic', 'ANI', 'IndiaToday', 'timesofindia'
    ],
    pakistan: [
      'GeoNewsOfficial', 'Dawn_News', 'FawadChaudhry', 'ImranKhanPTI',
      'CBA_Arslan', 'NadirAliPodcast', 'IrfanJunejo'
    ]
  }
};

// Search keywords for different categories
const SEARCH_KEYWORDS = {
  youtubers: [
    'CarryMinati controversy', 'Elvish Yadav arrest', 'Triggered Insaan roast',
    'BB Ki Vines new video', 'Ashish Chanchlani viral', 'Dhruv Rathee exposed'
  ],
  bollywood: [
    'Salman Khan news', 'Shah Rukh Khan film', 'Alia Bhatt wedding',
    'Ranveer Singh controversy', 'Katrina Kaif viral', 'Bollywood scandal'
  ],
  cricket: [
    'Virat Kohli century', 'Rohit Sharma captain', 'India vs Pakistan',
    'IPL controversy', 'Cricket match fixing', 'Indian cricket team'
  ],
  national: [
    'India breaking news', 'Delhi blast', 'Supreme Court verdict',
    'Modi speech', 'Parliament session', 'Train accident India'
  ],
  pakistan_viral: [
    'Pakistan funny news', 'Pakistani minister gaffe', 'Imran Khan meme',
    'Pakistan blackout', 'Karachi flood', 'Lahore viral video'
  ]
};

// Store processed news to avoid duplicates
let processedNews = new Set();
let newsCache = [];

// Utility function to check if news is from last 24 hours
function isWithin24Hours(dateString) {
  try {
    const newsDate = new Date(dateString);
    const now = new Date();
    const diffInHours = (now - newsDate) / (1000 * 60 * 60);
    return diffInHours <= 24;
  } catch (error) {
    return true; // Include if we can't parse date
  }
}

// Scrape RSS feeds for news
async function scrapeRSSFeed(feedUrl) {
  try {
    const response = await axios.get(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const articles = [];

    $('item').each((i, elem) => {
      if (articles.length >= 15) return false;
      
      const title = $(elem).find('title').text();
      const link = $(elem).find('link').text();
      const pubDate = $(elem).find('pubDate').text();
      const description = $(elem).find('description').text();

      if (isWithin24Hours(pubDate)) {
        articles.push({
          title,
          link,
          pubDate,
          description: description.substring(0, 200) + '...',
          source: 'RSS Feed',
          category: 'Indian News'
        });
      }
    });

    return articles;
  } catch (error) {
    console.error(`Error scraping RSS feed ${feedUrl}:`, error.message);
    return [];
  }
}
async function scrapeGoogleNews(query) {
  try {
    const searchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const articles = [];

    $('item').each((i, elem) => {
      if (articles.length >= 10) return false;
      
      const title = $(elem).find('title').text();
      const link = $(elem).find('link').text();
      const pubDate = $(elem).find('pubDate').text();
      const description = $(elem).find('description').text();

      if (isWithin24Hours(pubDate)) {
        articles.push({
          title,
          link,
          pubDate,
          description: description.substring(0, 200) + '...',
          source: 'Google News',
          category: query
        });
      }
    });

    return articles;
  } catch (error) {
    console.error(`Error scraping Google News for ${query}:`, error.message);
    return [];
  }
}

// Scrape Indian news websites
async function scrapeIndianNews(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const articles = [];
    let selectors = [];

    // Different selectors for different sites
    if (url.includes('ndtv.com')) {
      selectors = ['.news_Itm', '.story-card', '.nstory_header'];
    } else if (url.includes('aajtak.in')) {
      selectors = ['.story-card', '.headline', '.news-item'];
    } else if (url.includes('abplive.com')) {
      selectors = ['.story-card', '.news-card', '.headline'];
    }

    selectors.forEach(selector => {
      $(selector).each((i, elem) => {
        if (articles.length >= 15) return false;

        const titleElem = $(elem).find('h1, h2, h3, h4, .headline, .title').first();
        const linkElem = $(elem).find('a').first();
        const timeElem = $(elem).find('.time, .date, .published-time').first();

        const title = titleElem.text().trim();
        const relativeLink = linkElem.attr('href');
        const timeText = timeElem.text().trim();

        if (title && relativeLink) {
          const fullLink = relativeLink.startsWith('http') ? relativeLink : new URL(relativeLink, url).href;
          
          articles.push({
            title,
            link: fullLink,
            pubDate: timeText || 'Recent',
            source: new URL(url).hostname,
            category: 'Indian News'
          });
        }
      });
    });

    return articles;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return [];
  }
}

// Alternative Twitter scraping without snscrape (using web scraping)
async function scrapeTwitterAlternative(handle, category) {
  try {
    // Method 1: Try Nitter (Twitter alternative frontend)
    const nitterInstances = [
      'https://nitter.net',
      'https://nitter.it',
      'https://nitter.unixfox.eu'
    ];

    for (const instance of nitterInstances) {
      try {
        const url = `${instance}/${handle}`;
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const tweets = [];

        $('.timeline-item').each((i, elem) => {
          if (tweets.length >= 3) return false;

          const tweetText = $(elem).find('.tweet-content').text().trim();
          const timeText = $(elem).find('.tweet-date a').attr('title') || 'Recent';
          const tweetLink = $(elem).find('.tweet-date a').attr('href');

          if (tweetText && tweetText.length > 10) {
            tweets.push({
              title: `@${handle}: ${tweetText.substring(0, 100)}...`,
              link: tweetLink ? `https://twitter.com${tweetLink}` : `https://twitter.com/${handle}`,
              pubDate: timeText,
              source: 'Twitter (Alt)',
              category: category,
              engagement: '🐦 Twitter Post'
            });
          }
        });

        if (tweets.length > 0) {
          console.log(`✅ Successfully scraped @${handle} via ${instance}`);
          return tweets;
        }
      } catch (error) {
        continue; // Try next instance
      }
    }

    // Method 2: Search for mentions in Google News
    const searchQuery = `${handle} site:twitter.com OR "${handle}" twitter`;
    const googleResults = await scrapeGoogleNews(searchQuery);
    
    if (googleResults.length > 0) {
      return googleResults.slice(0, 2).map(result => ({
        ...result,
        title: `@${handle}: ${result.title}`,
        source: 'Google News (Twitter)',
        category: category
      }));
    }

    return [];
  } catch (error) {
    console.error(`Error scraping Twitter @${handle}:`, error.message);
    return [];
  }
}

// Main news aggregation function
async function aggregateNews() {
  console.log('🔄 Starting news aggregation...');
  let allNews = [];

  try {
    // 1. Scrape Google News for different categories
    console.log('📰 Scraping Google News...');
    for (const category in SEARCH_KEYWORDS) {
      for (const keyword of SEARCH_KEYWORDS[category]) {
        const articles = await scrapeGoogleNews(keyword);
        allNews.push(...articles);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
      }
    }

    // 2. Scrape RSS feeds
    console.log('📡 Scraping RSS feeds...');
    for (const feedUrl of NEWS_SOURCES.rss_feeds) {
      const articles = await scrapeRSSFeed(feedUrl);
      allNews.push(...articles);
      await new Promise(resolve => setTimeout(resolve, 1500)); // Rate limiting
    }

    // 3. Scrape Indian news websites
    console.log('🇮🇳 Scraping Indian news sites...');
    for (const url of NEWS_SOURCES.indian_news) {
      const articles = await scrapeIndianNews(url);
      allNews.push(...articles);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
    }

    // 4. Scrape Twitter handles (with fallback methods)
    console.log('🐦 Scraping Twitter handles...');
    for (const category in NEWS_SOURCES.twitter_handles) {
      for (const handle of NEWS_SOURCES.twitter_handles[category]) {
        // Try snscrape first, fallback to alternative method
        let tweets = await scrapeTwitterHandle(handle, category);
        if (tweets.length === 0) {
          tweets = await scrapeTwitterAlternative(handle, category);
        }
        allNews.push(...tweets);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Increased delay for Twitter
      }
    }

  } catch (error) {
    console.error('Error in news aggregation:', error);
  }

  // Remove duplicates and filter
  const uniqueNews = allNews.filter(article => {
    const key = article.title.toLowerCase().substring(0, 50);
    if (processedNews.has(key)) {
      return false;
    }
    processedNews.add(key);
    return true;
  });

  // Sort by engagement and recency
  uniqueNews.sort((a, b) => {
    if (a.engagement && b.engagement) {
      const aLikes = parseInt(a.engagement.match(/❤️ (\d+)/)?.[1] || 0);
      const bLikes = parseInt(b.engagement.match(/❤️ (\d+)/)?.[1] || 0);
      return bLikes - aLikes;
    }
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // Keep only top 100 results
  newsCache = uniqueNews.slice(0, 100);
  
  console.log(`✅ Aggregated ${newsCache.length} unique news items`);
  console.log(`📊 Sources: Google News, RSS Feeds, Indian Sites, Twitter`);
  return newsCache;
}

// Fallback function for snscrape (try original method first)
async function scrapeTwitterHandle(handle, category) {
  return new Promise((resolve) => {
    const command = `snscrape --jsonl --max-results 5 twitter-user ${handle}`;
    
    exec(command, { timeout: 8000 }, (error, stdout) => {
      if (error) {
        // snscrape not available, will use alternative method
        resolve([]);
        return;
      }

      try {
        const tweets = stdout.split('\n')
          .filter(line => line.trim())
          .map(line => JSON.parse(line))
          .filter(tweet => {
            const tweetDate = new Date(tweet.date);
            return isWithin24Hours(tweetDate);
          })
          .slice(0, 3)
          .map(tweet => ({
            title: `@${handle}: ${tweet.rawContent.substring(0, 100)}...`,
            link: tweet.url,
            pubDate: tweet.date,
            source: 'Twitter',
            category: category,
            engagement: `❤️ ${tweet.likeCount || 0} 🔄 ${tweet.retweetCount || 0}`
          }));

        resolve(tweets);
      } catch (parseError) {
        resolve([]);
      }
    });
  });
}

// Format news for Telegram
function formatNewsMessage(articles, category) {
  if (!articles.length) {
    return `❌ No recent ${category} news found in the last 24 hours.`;
  }

  let message = `🔥 **${category.toUpperCase()} NEWS** (Last 24 Hours)\n\n`;
  
  articles.slice(0, 10).forEach((article, index) => {
    message += `${index + 1}. **${article.title}**\n`;
    if (article.engagement) {
      message += `   ${article.engagement}\n`;
    }
    message += `   🔗 [Read More](${article.link})\n`;
    message += `   📅 ${article.pubDate} | 📰 ${article.source}\n\n`;
  });

  return message;
}

// Express app setup
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Global ping counter
let pingCount = 0;

// Get the app URL from environment or construct it
const APP_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com` || `http://localhost:${PORT}`;

// Set up webhook for production
if (bot && isProduction) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  
  // Set webhook
  bot.setWebHook(`${APP_URL}${webhookPath}`)
    .then(() => {
      console.log('✅ Webhook set successfully');
    })
    .catch(err => {
      console.error('❌ Failed to set webhook:', err.message);
    });

  // Handle webhook updates
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

// Bot commands (only if bot is initialized)
if (bot) {
  // Error handling for bot
  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
      console.log('⚠️ Multiple bot instances detected. Switching to webhook mode...');
      if (!isProduction) {
        // Force production mode to use webhook
        process.env.NODE_ENV = 'production';
      }
    } else {
      console.error('Telegram polling error:', error.message);
    }
  });

  bot.on('webhook_error', (error) => {
    console.error('Telegram webhook error:', error);
  });
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🔥 **VIRAL NEWS BOT** 🔥

Get the latest viral & controversial news from:
📱 Indian YouTubers & Creators
🎬 Bollywood Celebrities  
🏏 Indian Cricket Stars
📰 Breaking National News
🤣 Funny Pakistani News

**Commands:**
/latest - Get all latest news
/youtubers - YouTuber news only
/bollywood - Bollywood news only
/cricket - Cricket news only
/national - National breaking news
/pakistan - Pakistani viral news
/refresh - Force refresh news

🚀 All news is from the last 24 hours only!
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 Fetching latest viral news... Please wait!');
    
    const news = await aggregateNews();
    const message = formatNewsMessage(news, 'Latest Viral');
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🎥 Getting YouTuber news...');
    
    const news = newsCache.filter(article => 
      article.category === 'youtubers' || 
      SEARCH_KEYWORDS.youtubers.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    const message = formatNewsMessage(news, 'YouTuber');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🎭 Getting Bollywood news...');
    
    const news = newsCache.filter(article => 
      article.category === 'bollywood' || 
      SEARCH_KEYWORDS.bollywood.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    const message = formatNewsMessage(news, 'Bollywood');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🏏 Getting Cricket news...');
    
    const news = newsCache.filter(article => 
      article.category === 'cricket' || 
      SEARCH_KEYWORDS.cricket.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    const message = formatNewsMessage(news, 'Cricket');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🇮🇳 Getting National news...');
    
    const news = newsCache.filter(article => 
      article.category === 'national' || 
      article.category === 'Indian News'
    );
    
    const message = formatNewsMessage(news, 'National Breaking');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🤣 Getting Pakistani viral news...');
    
    const news = newsCache.filter(article => 
      article.category === 'pakistan' || 
      SEARCH_KEYWORDS.pakistan_viral.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    const message = formatNewsMessage(news, 'Pakistani Viral');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 Force refreshing all news sources...');
    
    processedNews.clear();
    const news = await aggregateNews();
    
    bot.sendMessage(chatId, `✅ Refreshed! Found ${news.length} new articles in the last 24 hours.`);
  });

  console.log('📱 Telegram Bot is active!');
  if (isProduction) {
    console.log('🌐 Using webhook mode (production)');
  } else {
    console.log('🔄 Using polling mode (development)');
  }
} else {
  console.log('⚠️ Telegram Bot not initialized - missing BOT_TOKEN');
  console.log('🌐 Running in API-only mode');
}

// Health check endpoint for Render

// Get the app URL from environment or construct it
const APP_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com` || `http://localhost:${PORT}`;

app.get('/', (req, res) => {
  res.json({ 
    status: 'Bot is running!', 
    newsCount: newsCache.length,
    lastUpdate: new Date().toISOString(),
    telegramBot: BOT_TOKEN ? 'Connected' : 'Not configured - missing BOT_TOKEN',
    uptime: Math.floor(process.uptime()),
    keepAlive: 'Active - Auto-ping enabled',
    apiEndpoints: {
      health: '/health',
      news: '/api/news',
      categories: '/api/news/:category'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    uptime: process.uptime(),
    newsAggregation: 'working',
    telegramBot: BOT_TOKEN ? 'active' : 'inactive',
    lastPing: new Date().toISOString(),
    totalPings: pingCount
  });
});

// Keep-alive ping endpoint
app.get('/ping', (req, res) => {
  pingCount++;
  res.json({ 
    status: 'pong', 
    timestamp: new Date().toISOString(),
    pingCount: pingCount,
    uptime: Math.floor(process.uptime())
  });
});

// API endpoints to access news data directly
app.get('/api/news', async (req, res) => {
  try {
    if (newsCache.length === 0) {
      await aggregateNews();
    }
    res.json({
      total: newsCache.length,
      lastUpdate: new Date().toISOString(),
      news: newsCache.slice(0, 50) // Return first 50 items
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.get('/api/news/:category', async (req, res) => {
  try {
    const category = req.params.category.toLowerCase();
    const filteredNews = newsCache.filter(article => 
      article.category === category || 
      (SEARCH_KEYWORDS[category] && 
       SEARCH_KEYWORDS[category].some(keyword => 
         article.title.toLowerCase().includes(keyword.toLowerCase())
       ))
    );
    
    res.json({
      category,
      total: filteredNews.length,
      news: filteredNews.slice(0, 20)
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch category news' });
  }
});

// Global ping counter
let pingCount = 0;

// Auto-ping function to keep server alive
async function keepServerAlive() {
  try {
    if (APP_URL && !APP_URL.includes('localhost')) {
      const response = await axios.get(`${APP_URL}/ping`, {
        timeout: 10000,
        headers: {
          'User-Agent': 'KeepAlive-Bot/1.0'
        }
      });
      console.log(`🏓 Keep-alive ping successful: ${response.data.status} | Ping #${response.data.pingCount}`);
    }
  } catch (error) {
    console.log(`⚠️ Keep-alive ping failed: ${error.message}`);
  }
}

// External ping to other free services (backup method)
async function externalPing() {
  try {
    const pingTargets = [
      'https://httpbin.org/get',
      'https://api.github.com',
      'https://jsonplaceholder.typicode.com/posts/1'
    ];
    
    const randomTarget = pingTargets[Math.floor(Math.random() * pingTargets.length)];
    await axios.get(randomTarget, { timeout: 5000 });
    console.log(`🌐 External ping successful to: ${randomTarget}`);
  } catch (error) {
    console.log(`⚠️ External ping failed: ${error.message}`);
  }
}

// Set up keep-alive intervals
const PING_INTERVAL = 12 * 60 * 1000; // 12 minutes (before 15-min sleep)
const EXTERNAL_PING_INTERVAL = 25 * 60 * 1000; // 25 minutes

// Start keep-alive system
setInterval(keepServerAlive, PING_INTERVAL);
setInterval(externalPing, EXTERNAL_PING_INTERVAL);

// Initial ping after 2 minutes
setTimeout(() => {
  console.log('🏓 Starting keep-alive system...');
  keepServerAlive();
}, 2 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 App URL: ${APP_URL}`);
  if (BOT_TOKEN) {
    console.log(`📱 Telegram Bot is active!`);
    if (isProduction) {
      console.log('🌐 Using webhook mode (production)');
    } else {
      console.log('🔄 Using polling mode (development)');
    }
  } else {
    console.log(`⚠️ Telegram Bot not active - Add BOT_TOKEN environment variable`);
    console.log(`🌐 API endpoints available at ${APP_URL}/api/news`);
  }
  console.log(`🏓 Keep-alive system will start in 2 minutes`);
  console.log(`⏰ Auto-ping every 12 minutes to prevent sleep`);
});

// Auto-refresh news every 2 hours
setInterval(async () => {
  console.log('🔄 Auto-refreshing news...');
  await aggregateNews();
}, 2 * 60 * 60 * 1000);

// Initial news load
setTimeout(async () => {
  console.log('🚀 Initial news aggregation...');
  await aggregateNews();
}, 5000);

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
