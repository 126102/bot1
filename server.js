const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// News sources and handles
const NEWS_SOURCES = {
  indian_news: [
    'https://www.ndtv.com/latest',
    'https://www.aajtak.in/breaking-news',
    'https://news.abplive.com/news'
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

// Scrape Google News using search simulation
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

// Scrape Twitter using snscrape
async function scrapeTwitterHandle(handle, category) {
  return new Promise((resolve) => {
    const command = `snscrape --jsonl --max-results 5 twitter-user ${handle}`;
    
    exec(command, { timeout: 10000 }, (error, stdout) => {
      if (error) {
        console.error(`Error scraping Twitter @${handle}:`, error.message);
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
        console.error(`Error parsing Twitter data for @${handle}:`, parseError.message);
        resolve([]);
      }
    });
  });
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

    // 2. Scrape Indian news websites
    console.log('🇮🇳 Scraping Indian news sites...');
    for (const url of NEWS_SOURCES.indian_news) {
      const articles = await scrapeIndianNews(url);
      allNews.push(...articles);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limiting
    }

    // 3. Scrape Twitter handles
    console.log('🐦 Scraping Twitter handles...');
    for (const category in NEWS_SOURCES.twitter_handles) {
      for (const handle of NEWS_SOURCES.twitter_handles[category]) {
        const tweets = await scrapeTwitterHandle(handle, category);
        allNews.push(...tweets);
        await new Promise(resolve => setTimeout(resolve, 1500)); // Rate limiting
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
  return newsCache;
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

// Bot commands
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

// Health check endpoint for Render
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ 
    status: 'Bot is running!', 
    newsCount: newsCache.length,
    lastUpdate: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Telegram Bot is active!`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
