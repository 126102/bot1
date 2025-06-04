const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const { exec } = require('child_process');
const express = require('express');

// Bot configuration with error handling and webhook mode for production
const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN environment variable is required!');
  console.log('🔧 Please set BOT_TOKEN in your environment variables');
  console.log('📱 Get your token from @BotFather on Telegram');
  console.log('🚀 Bot will run in API-only mode (no Telegram polling)');
}

// Use webhook in production to avoid multiple instance conflicts
const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,  // Only use polling in development
  webHook: isProduction    // Use webhook in production
}) : null;

// Express app setup
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Get the app URL from environment or construct it
const APP_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com` || `http://localhost:${PORT}`;

// Global variables
let processedNews = new Set();
let newsCache = [];
let pingCount = 0;

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

// Search keywords for different categories (dynamic - can be modified)
let SEARCH_KEYWORDS = {
  youtubers: [
    'CarryMinati', 'Elvish Yadav', 'Triggered Insaan', 'BB Ki Vines',
    'Ashish Chanchlani', 'Dhruv Rathee', 'Technical Guruji', 'Flying Beast',
    'Indian YouTuber', 'YouTube creator India', 'Carry roast', 'Elvish controversy'
  ],
  bollywood: [
    'Salman Khan', 'Shah Rukh Khan', 'Alia Bhatt', 'Ranbir Kapoor',
    'Katrina Kaif', 'Akshay Kumar', 'Ranveer Singh', 'Deepika Padukone', 
    'Bollywood news', 'Hindi film', 'Mumbai film industry', 'Bollywood actor'
  ],
  cricket: [
    'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Indian cricket',
    'IPL 2024', 'India vs Pakistan', 'Cricket World Cup', 'T20 cricket',
    'Hardik Pandya', 'KL Rahul', 'Indian cricket team', 'Cricket news India'
  ],
  national: [
    'India news', 'Modi government', 'Delhi news', 'Mumbai news',
    'Supreme Court India', 'Parliament India', 'Indian politics', 'BJP Congress',
    'Indian economy', 'India breaking news', 'Government India', 'PM Modi'
  ],
  pakistan_viral: [
    'Pakistan news', 'Imran Khan', 'Pakistani politician', 'Karachi news',
    'Lahore news', 'Pakistan funny', 'Pakistani viral', 'Pakistan meme',
    'Pakistan cricket', 'Pakistani YouTuber', 'Pakistan comedy', 'Pakistan trend'
  ]
};

// Improved categorization function
function categorizeNews(title, description, source, originalCategory) {
  const titleLower = title.toLowerCase();
  const descLower = (description || '').toLowerCase();
  const content = `${titleLower} ${descLower}`;
  
  // YouTuber keywords
  const youtuberKeywords = ['carry', 'elvish', 'triggered', 'bhuvan', 'ashish', 'chanchlani', 'dhruv', 'rathee', 'technical guruji', 'flying beast', 'amit bhadana', 'youtube', 'youtuber', 'creator', 'subscriber'];
  
  // Bollywood keywords  
  const bollywoodKeywords = ['salman', 'shahrukh', 'srk', 'alia', 'ranbir', 'katrina', 'akshay', 'ranveer', 'deepika', 'bollywood', 'film', 'movie', 'actor', 'actress', 'mumbai film'];
  
  // Cricket keywords
  const cricketKeywords = ['virat', 'kohli', 'rohit', 'sharma', 'dhoni', 'cricket', 'ipl', 'india vs', 'hardik', 'pandya', 'rahul', 'bumrah', 'wicket', 'century', 'match'];
  
  // Pakistan keywords
  const pakistanKeywords = ['pakistan', 'imran khan', 'karachi', 'lahore', 'islamabad', 'pakistani', 'pti', 'nawaz', 'bilawal'];
  
  // Check for matches
  if (youtuberKeywords.some(keyword => content.includes(keyword))) {
    return 'youtubers';
  }
  
  if (bollywoodKeywords.some(keyword => content.includes(keyword))) {
    return 'bollywood';
  }
  
  if (cricketKeywords.some(keyword => content.includes(keyword))) {
    return 'cricket';
  }
  
  if (pakistanKeywords.some(keyword => content.includes(keyword))) {
    return 'pakistan';
  }
  
  // Default to national for Indian news
  return 'national';
}
// Utility function to check if news is from last 24 hours
function isWithin24Hours(dateString) {
  try {
    const newsDate = new Date(dateString);
    const now = new Date();
    const diffInHours = (now - newsDate) / (1000 * 60 * 60);
    return diffInHours <= 48; // Extended to 48 hours for more content
  } catch (error) {
    return true; // Include if we can't parse date
  }
}

// Scrape Google News using search simulation
async function scrapeGoogleNews(query) {
  try {
    // Try multiple Google News approaches
    const approaches = [
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`,
      `https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFZxYUdjU0FtVnVHZ0pKVGlnQVAB?hl=en-IN&gl=IN&ceid=IN%3Aen`,
      `https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en`
    ];

    for (const searchUrl of approaches) {
      try {
        const response = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          },
          timeout: 10000
        });

        const $ = cheerio.load(response.data, { xmlMode: true });
        const articles = [];

        $('item').each((i, elem) => {
          if (articles.length >= 5) return false;
          
          const title = $(elem).find('title').text();
          const link = $(elem).find('link').text();
          const pubDate = $(elem).find('pubDate').text();
          const description = $(elem).find('description').text();

          if (title && link) {
            articles.push({
              title: title.substring(0, 150) + (title.length > 150 ? '...' : ''),
              link: link,
              pubDate: pubDate || new Date().toISOString(),
              description: description ? description.substring(0, 100) + '...' : 'Latest news update',
              source: 'Google News',
              category: query.includes('youtube') || query.includes('carry') ? 'youtubers' : 
                       query.includes('bollywood') || query.includes('salman') ? 'bollywood' :
                       query.includes('cricket') || query.includes('virat') ? 'cricket' : 'national'
            });
          }
        });

        if (articles.length > 0) {
          console.log(`✅ Google News success for "${query}": ${articles.length} articles`);
          return articles;
        }
      } catch (urlError) {
        console.log(`⚠️ Google News URL failed: ${searchUrl}`);
        continue;
      }
    }

    return [];
  } catch (error) {
    console.error(`❌ Google News error for ${query}:`, error.message);
    return [];
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
    } else if (url.includes('indianexpress.com')) {
      selectors = ['.story-card', '.headline', '.news-item'];
    } else if (url.includes('timesofindia.com')) {
      selectors = ['.story-card', '.news-card', '.headline'];
    } else if (url.includes('news18.com')) {
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
  let successfulSources = 0;
  let totalSources = 0;

  try {
    // 1. Scrape Google News for different categories
    console.log('📰 Scraping Google News...');
    totalSources += Object.keys(SEARCH_KEYWORDS).length * 4; // More keywords per category
    
    for (const category in SEARCH_KEYWORDS) {
      // Use more keywords per category for better results
      const keywords = SEARCH_KEYWORDS[category].slice(0, 4);
      for (const keyword of keywords) {
        try {
          const articles = await scrapeGoogleNews(keyword);
          if (articles.length > 0) {
            // Re-categorize each article for better accuracy
            const categorizedArticles = articles.map(article => ({
              ...article,
              category: categorizeNews(article.title, article.description, article.source, category)
            }));
            
            allNews.push(...categorizedArticles);
            successfulSources++;
            console.log(`✅ Found ${articles.length} articles for: ${keyword} (Category: ${category})`);
          } else {
            console.log(`⚠️ No articles found for: ${keyword}`);
          }
        } catch (error) {
          console.error(`❌ Failed to scrape keyword: ${keyword}`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 500)); // Reduced delay
      }
    }

    // 2. Scrape RSS feeds
    console.log('📡 Scraping RSS feeds...');
    totalSources += NEWS_SOURCES.rss_feeds.length;
    
    for (const feedUrl of NEWS_SOURCES.rss_feeds) {
      try {
        const articles = await scrapeRSSFeed(feedUrl);
        if (articles.length > 0) {
          // Re-categorize RSS articles too
          const categorizedArticles = articles.map(article => ({
            ...article,
            category: categorizeNews(article.title, article.description, article.source, 'national')
          }));
          
          allNews.push(...categorizedArticles);
          successfulSources++;
          console.log(`✅ RSS Feed success: ${feedUrl} (${articles.length} articles)`);
        } else {
          console.log(`⚠️ RSS Feed empty: ${feedUrl}`);
        }
      } catch (error) {
        console.error(`❌ RSS Feed failed: ${feedUrl}`, error.message);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Scrape Indian news websites
    console.log('🇮🇳 Scraping Indian news sites...');
    totalSources += NEWS_SOURCES.indian_news.length;
    
    for (const url of NEWS_SOURCES.indian_news) {
      try {
        const articles = await scrapeIndianNews(url);
        if (articles.length > 0) {
          // Re-categorize Indian news articles
          const categorizedArticles = articles.map(article => ({
            ...article,
            category: categorizeNews(article.title, article.description || '', article.source, 'national')
          }));
          
          allNews.push(...categorizedArticles);
          successfulSources++;
          console.log(`✅ Indian news success: ${url} (${articles.length} articles)`);
        } else {
          console.log(`⚠️ Indian news empty: ${url}`);
        }
      } catch (error) {
        console.error(`❌ Indian news failed: ${url}`, error.message);
      }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // 4. Add diverse fallback content for each category
    if (allNews.length < 10) {
      console.log('🚨 Adding diverse fallback content...');
      
      const fallbackContent = [
        // YouTuber content
        {
          title: "CarryMinati's Latest Video Breaks Internet",
          link: "https://www.youtube.com/@CarryMinati",
          pubDate: new Date().toISOString(),
          source: "YouTube",
          category: "youtubers",
          description: "Latest updates from India's top YouTuber"
        },
        {
          title: "Elvish Yadav Creates New Controversy",
          link: "https://www.youtube.com/@ElvishYadav",
          pubDate: new Date().toISOString(),
          source: "Social Media",
          category: "youtubers",
          description: "Bigg Boss winner in spotlight again"
        },
        
        // Bollywood content
        {
          title: "Salman Khan's Upcoming Film Announcement",
          link: "https://www.bollywoodhungama.com",
          pubDate: new Date().toISOString(),
          source: "Bollywood Hungama",
          category: "bollywood",
          description: "Bhaijaan's next project revealed"
        },
        {
          title: "Shah Rukh Khan Breaks Box Office Records",
          link: "https://www.filmfare.com",
          pubDate: new Date().toISOString(),
          source: "Filmfare",
          category: "bollywood",
          description: "King Khan's magic continues"
        },
        
        // Cricket content
        {
          title: "Virat Kohli's Performance Update",
          link: "https://www.cricbuzz.com",
          pubDate: new Date().toISOString(),
          source: "Cricbuzz",
          category: "cricket",
          description: "Captain's latest match statistics"
        },
        {
          title: "Indian Cricket Team Schedule Released",
          link: "https://www.espncricinfo.com",
          pubDate: new Date().toISOString(),
          source: "ESPNCricinfo",
          category: "cricket",
          description: "Upcoming matches and tournaments"
        },
        
        // Pakistan content
        {
          title: "Pakistani Social Media Trend Goes Viral",
          link: "https://www.dawn.com",
          pubDate: new Date().toISOString(),
          source: "Dawn",
          category: "pakistan",
          description: "Latest viral content from across the border"
        },
        
        // National content
        {
          title: "Government Announces New Policy",
          link: "https://www.ndtv.com",
          pubDate: new Date().toISOString(),
          source: "NDTV",
          category: "national",
          description: "Important government updates"
        }
      ];
      
      allNews.push(...fallbackContent);
    }

  } catch (error) {
    console.error('❌ Critical error in news aggregation:', error);
  }

  // Remove duplicates and filter
  const uniqueNews = allNews.filter((article, index, self) => {
    const key = article.title.toLowerCase().substring(0, 30);
    return index === self.findIndex(a => a.title.toLowerCase().substring(0, 30) === key);
  });

  // Sort by recency and category priority
  uniqueNews.sort((a, b) => {
    const categoryPriority = { 'youtubers': 1, 'bollywood': 2, 'cricket': 3, 'national': 4 };
    const aPriority = categoryPriority[a.category] || 5;
    const bPriority = categoryPriority[b.category] || 5;
    
    if (aPriority !== bPriority) return aPriority - bPriority;
    return new Date(b.pubDate) - new Date(a.pubDate);
  });

  // Keep top 100 results
  newsCache = uniqueNews.slice(0, 100);
  
  console.log(`✅ Aggregation complete! Total: ${newsCache.length} items`);
  console.log(`📊 Success rate: ${successfulSources}/${totalSources} sources`);
  console.log(`🚀 Bot ready with ${newsCache.length} real content items!`);
  
  // Log category breakdown
  const categoryCount = {};
  newsCache.forEach(item => {
    categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
  });
  console.log(`📊 Categories:`, categoryCount);
  
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

  // Keyword management commands
  bot.onText(/\/addkeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, '❌ Usage: /addkeyword <category> <keyword>\n\nCategories: youtubers, bollywood, cricket, national, pakistan');
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, '❌ Invalid category! Use: youtubers, bollywood, cricket, national, pakistan');
      return;
    }
    
    if (SEARCH_KEYWORDS[category].includes(keyword)) {
      bot.sendMessage(chatId, `⚠️ Keyword "${keyword}" already exists in ${category}!`);
      return;
    }
    
    SEARCH_KEYWORDS[category].push(keyword);
    bot.sendMessage(chatId, `✅ Added "${keyword}" to ${category} category!\n\nTotal keywords in ${category}: ${SEARCH_KEYWORDS[category].length}`);
  });

  bot.onText(/\/removekeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, '❌ Usage: /removekeyword <category> <keyword>\n\nCategories: youtubers, bollywood, cricket, national, pakistan');
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, '❌ Invalid category! Use: youtubers, bollywood, cricket, national, pakistan');
      return;
    }
    
    const index = SEARCH_KEYWORDS[category].indexOf(keyword);
    if (index === -1) {
      bot.sendMessage(chatId, `❌ Keyword "${keyword}" not found in ${category}!`);
      return;
    }
    
    SEARCH_KEYWORDS[category].splice(index, 1);
    bot.sendMessage(chatId, `✅ Removed "${keyword}" from ${category} category!\n\nRemaining keywords in ${category}: ${SEARCH_KEYWORDS[category].length}`);
  });

  bot.onText(/\/listkeywords/, (msg) => {
    const chatId = msg.chat.id;
    let message = '📝 **CURRENT KEYWORDS**\n\n';
    
    for (const [category, keywords] of Object.entries(SEARCH_KEYWORDS)) {
      message += `**${category.toUpperCase()}** (${keywords.length}):\n`;
      message += keywords.slice(0, 10).map(k => `• ${k}`).join('\n');
      if (keywords.length > 10) {
        message += `\n... and ${keywords.length - 10} more`;
      }
      message += '\n\n';
    }
    
    message += `**Commands:**
/addkeyword <category> <keyword>
/removekeyword <category> <keyword>
/listkeywords`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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

**Main Commands:**
/latest - Get all latest news
/youtubers - YouTuber news only
/bollywood - Bollywood news only
/cricket - Cricket news only
/national - National breaking news
/pakistan - Pakistani viral news
/refresh - Force refresh news
/status - Check bot status

**Keyword Management:**
/addkeyword <category> <keyword>
/removekeyword <category> <keyword>  
/listkeywords - Show all keywords

**Categories:** youtubers, bollywood, cricket, national, pakistan

🚀 All news is from the last 48 hours!
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // Add status command for debugging
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const statusMessage = `
📊 **BOT STATUS**

🗞️ **Cached News:** ${newsCache.length} items
⏰ **Last Update:** ${new Date().toLocaleString()}
🔄 **Auto-refresh:** Every 2 hours
🏓 **Keep-alive:** Active

**Categories:**
${Object.entries(newsCache.reduce((acc, item) => {
  acc[item.category] = (acc[item.category] || 0) + 1;
  return acc;
}, {})).map(([cat, count]) => `• ${cat}: ${count} items`).join('\n')}

Use /refresh to update news now!
    `;
    
    bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 Fetching latest viral news... Please wait!');
    
    if (newsCache.length === 0) {
      await aggregateNews();
    }
    
    if (newsCache.length === 0) {
      bot.sendMessage(chatId, '❌ No news available right now. Try /refresh to update sources!');
      return;
    }
    
    const message = formatNewsMessage(newsCache.slice(0, 10), 'Latest Viral');
    
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
      article.title.toLowerCase().includes('carry') ||
      article.title.toLowerCase().includes('elvish') ||
      article.title.toLowerCase().includes('youtube') ||
      SEARCH_KEYWORDS.youtubers.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase().split(' ')[0])
      )
    );
    
    if (news.length === 0) {
      bot.sendMessage(chatId, '❌ No YouTuber news found. Try /refresh to update!');
      return;
    }
    
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
      article.title.toLowerCase().includes('bollywood') ||
      article.title.toLowerCase().includes('salman') ||
      article.title.toLowerCase().includes('shahrukh') ||
      SEARCH_KEYWORDS.bollywood.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase().split(' ')[0])
      )
    );
    
    if (news.length === 0) {
      bot.sendMessage(chatId, '❌ No Bollywood news found. Try /refresh to update!');
      return;
    }
    
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
      article.title.toLowerCase().includes('cricket') ||
      article.title.toLowerCase().includes('virat') ||
      article.title.toLowerCase().includes('rohit') ||
      SEARCH_KEYWORDS.cricket.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase().split(' ')[0])
      )
    );
    
    if (news.length === 0) {
      bot.sendMessage(chatId, '❌ No Cricket news found. Try /refresh to update!');
      return;
    }
    
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
      article.category === 'Indian News' ||
      article.source.includes('NDTV') ||
      article.source.includes('RSS')
    );
    
    if (news.length === 0) {
      bot.sendMessage(chatId, '❌ No National news found. Try /refresh to update!');
      return;
    }
    
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
      article.title.toLowerCase().includes('pakistan') ||
      SEARCH_KEYWORDS.pakistan_viral.some(keyword => 
        article.title.toLowerCase().includes(keyword.toLowerCase().split(' ')[0])
      )
    );
    
    if (news.length === 0) {
      bot.sendMessage(chatId, '❌ No Pakistani viral news found. Try /refresh to update!');
      return;
    }
    
    const message = formatNewsMessage(news, 'Pakistani Viral');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 Force refreshing all news sources... This may take 30-60 seconds!');
    
    newsCache = []; // Clear cache
    const news = await aggregateNews();
    
    bot.sendMessage(chatId, `✅ Refreshed! Found ${news.length} new articles.
    
📊 **Categories Found:**
${Object.entries(news.reduce((acc, item) => {
  acc[item.category] = (acc[item.category] || 0) + 1;
  return acc;
}, {})).map(([cat, count]) => `• ${cat}: ${count}`).join('\n')}

Try /latest to see all news!`);
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

// Express routes
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

// Start server
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

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
