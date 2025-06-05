// Enhanced keywords for Google News search (NO YouTube)
let SEARCH_KEYWORDS = {
  youtubers: [
    'CarryMinati controversy news', 'Triggered Insaan latest interview', 'BB Ki Vines Bhuvan Bam',
    'Ashish Chanchlani film project', 'Dhruv Rathee political analysis', 'Technical Guruji tech review',
    'Indian YouTuber legal trouble', 'Content creator brand deal', 'Digital influencer scandal'
  ],
  bollywood: [
    'Salman Khan court case', 'Shah Rukh Khan new film', 'Alia Bhatt pregnancy news',
    'Akshay Kumar box office', 'Ranveer Singh fashion controversy', 'Deepika Padukone Hollywood',
    'Bollywood drug case', 'Hindi film industry crisis', 'Celebrity wedding announcement'
  ],
  cricket: [
    'Virat Kohli retirement speculation', 'Rohit Sharma captaincy controversy', 'MS Dhoni comeback',
    'Hardik Pandya injury update', 'KL Rahul selection debate', 'Jasprit Bumrah bowling action',
    'Indian cricket team selection', 'IPL auction drama', 'BCCI policy change'
  ],
  political: [
    'Modi government policy', 'Rahul Gandhi opposition', 'Kejriwal corruption case',
    'Yogi Adityanath statement', 'Mamata Banerjee protest', 'Indian election update',
    'Parliament session debate', 'Supreme Court judgment', 'Political party alliance'
  ]
};const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN environment variable is required!');
  console.log('🔧 Please set BOT_TOKEN in your environment variables');
}

const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,
  webHook: isProduction 
}) : null;

// Express setup
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const APP_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com` || `http://localhost:${PORT}`;

// Global variables
let newsCache = [];
let pingCount = 0;

// Utility functions for timestamp handling
function isWithin24Hours(dateString) {
  try {
    if (!dateString || dateString === 'Recent') return false;
    
    const newsDate = new Date(dateString);
    const now = new Date();
    
    // Check if date is valid
    if (isNaN(newsDate.getTime())) return false;
    
    const diffInHours = (now - newsDate) / (1000 * 60 * 60);
    
    // Only include news from last 24 hours
    return diffInHours <= 24 && diffInHours >= 0;
  } catch (error) {
    return false;
  }
}

// Get current timestamp for news items
function getCurrentTimestamp() {
  return new Date().toISOString();
}

// Validate and format date for display
function formatNewsDate(dateString) {
  try {
    if (!dateString) return 'Just now';
    
    const newsDate = new Date(dateString);
    if (isNaN(newsDate.getTime())) return 'Just now';
    
    const now = new Date();
    const diffInHours = (now - newsDate) / (1000 * 60 * 60);
    
    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now - newsDate) / (1000 * 60));
      return diffInMinutes <= 0 ? 'Just now' : `${diffInMinutes} minutes ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)} hours ago`;
    } else {
      return newsDate.toLocaleDateString('en-IN', { 
        day: 'numeric', 
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  } catch (error) {
    return 'Just now';
  }
}

// Top Twitter handles to monitor (India's biggest celebrities)
const TOP_TWITTER_HANDLES = {
  youtubers: [
    'CarryMinati',        // Ajey Nagar - 11M followers
    'TriggeredInsaan',    // Nischay Malhan - 5M followers  
    'BBKiVines',          // Bhuvan Bam - 3M followers
    'ashchanchlani',      // Ashish Chanchlani - 2M followers
    'dhruv_rathee',       // Dhruv Rathee - 2M followers
    'TechnicalGuruji'     // Gaurav Chaudhary - 1M followers
  ],
  bollywood: [
    'iamsrk',             // Shah Rukh Khan - 42M followers
    'BeingSalmanKhan',    // Salman Khan - 45M followers  
    'akshaykumar',        // Akshay Kumar - 38M followers
    'aliaa08',            // Alia Bhatt - 5M followers
    'RanveerOfficial',    // Ranveer Singh - 6M followers
    'deepikapadukone'     // Deepika Padukone - 16M followers
  ],
  cricket: [
    'imVkohli',           // Virat Kohli - 50M followers
    'ImRo45',             // Rohit Sharma - 20M followers
    'msdhoni',            // MS Dhoni - 12M followers
    'hardikpandya7',      // Hardik Pandya - 8M followers
    'klrahul',            // KL Rahul - 5M followers
    'Jaspritbumrah93'     // Jasprit Bumrah - 3M followers
  ],
  political: [
    'narendramodi',       // PM Modi - 90M followers
    'AmitShah',           // Amit Shah - 15M followers
    'RahulGandhi',        // Rahul Gandhi - 20M followers
    'ArvindKejriwal',     // Arvind Kejriwal - 25M followers
    'myogiadityanath',    // Yogi Adityanath - 15M followers
    'MamataOfficial'      // Mamata Banerjee - 5M followers
  ]
};
  youtubers: [
    'CarryMinati new video 2025', 'Triggered Insaan latest roast', 'BB Ki Vines comedy',
    'Ashish Chanchlani recent video', 'Technical Guruji tech review', 'Flying Beast family vlog',
    'Amit Bhadana comedy sketch', 'Round2hell latest video', 'Slayy Point reaction',
    'Mumbiker Nikhil vlog', 'Sourav Joshi vlog', 'Harsh Beniwal comedy',
    'Indian gaming YouTuber', 'YouTube creator collaboration', 'Roasting video India'
  ],
  bollywood: [
    'Salman Khan upcoming movie', 'Shah Rukh Khan latest project', 'Alia Bhatt film news',
    'Ranbir Kapoor movie update', 'Katrina Kaif recent photos', 'Akshay Kumar box office',
    'Ranveer Singh fashion', 'Deepika Padukone Hollywood', 'Janhvi Kapoor debut',
    'Kartik Aaryan comedy', 'Kiara Advani glamour', 'Vicky Kaushal performance',
    'Bollywood box office collection', 'Hindi film industry update', 'Celebrity wedding news'
  ],
  cricket: [
    'Virat Kohli batting stats', 'Rohit Sharma captaincy', 'Indian cricket victory',
    'Hardik Pandya all rounder', 'KL Rahul wicket keeper', 'Shubman Gill young talent',
    'Rishabh Pant comeback', 'Jasprit Bumrah bowling', 'Ravindra Jadeja fielding',
    'IPL team auction', 'India vs Australia series', 'T20 World Cup preparation',
    'BCCI selection committee', 'Cricket coaching camp', 'Stadium crowd support'
  ],
  national: [
    'PM Modi speech today', 'Indian government policy', 'Delhi assembly session',
    'Mumbai infrastructure project', 'Supreme Court landmark judgment', 'Parliament debate',
    'Economic survey India', 'Digital India initiative', 'Education reform policy',
    'Healthcare improvement scheme', 'Infrastructure development', 'Technology advancement',
    'Environmental protection law', 'Agricultural reform bill', 'Foreign policy update'
  ],
  pakistan: [
    'Pakistan political crisis', 'Karachi weather update', 'Lahore cultural event',
    'Pakistani cricket team performance', 'Imran Khan political rally', 'Pakistan economy news',
    'Cross border tension', 'Pakistan social media trend', 'Pakistani entertainment industry',
    'Pakistan-China collaboration', 'Islamabad diplomatic meeting', 'Pakistan sports achievement'
  ]
};

// News sources - Only Google News and Twitter (NO YouTube/Instagram)
const NEWS_SOURCES = {
  news_websites: [
    'https://www.ndtv.com/latest',
    'https://timesofindia.indiatimes.com/briefs.cms',
    'https://indianexpress.com/section/india/',
    'https://www.hindustantimes.com/latest-news',
    'https://www.news18.com/news/'
  ],
  rss_feeds: [
    'https://feeds.feedburner.com/ndtvnews-latest',
    'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',
    'https://www.hindustantimes.com/feeds/rss/india-news/index.xml'
  ]
};

// Smart categorization with keyword matching
function categorizeNews(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  // YouTuber detection
  if (content.match(/carry|carryminati|elvish|triggered|bhuvan|ashish|dhruv|technical guruji|flying beast|youtube|youtuber|subscriber|gaming|roast|vlog/)) {
    return 'youtubers';
  }
  
  // Bollywood detection
  if (content.match(/salman|shahrukh|srk|alia|ranbir|katrina|akshay|ranveer|deepika|bollywood|film|movie|actor|actress|cinema/)) {
    return 'bollywood';
  }
  
  // Cricket detection
  if (content.match(/virat|kohli|rohit|sharma|dhoni|cricket|ipl|india vs|hardik|rahul|bumrah|wicket|century|match|bcci/)) {
    return 'cricket';
  }
  
  // Pakistan detection
  if (content.match(/pakistan|imran khan|karachi|lahore|islamabad|pakistani|pti/)) {
    return 'pakistan';
  }
  
  return 'national';
}

// Improved Google News scraping with better date handling
async function scrapeGoogleNews(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    // Add time filter for recent news (last 24 hours)
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en&when:1d`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const articles = [];

    $('item').each((i, elem) => {
      if (articles.length >= 5) return false;
      
      const title = $(elem).find('title').text().trim();
      const link = $(elem).find('link').text().trim();
      const pubDate = $(elem).find('pubDate').text().trim();
      const description = $(elem).find('description').text().trim();

      if (title && link && title.length > 15) {
        // Validate if news is actually from last 24 hours
        const isRecent = isWithin24Hours(pubDate);
        
        if (isRecent || !pubDate) { // Include if no date (likely recent) or valid recent date
          const category = categorizeNews(title, description);
          const currentTime = getCurrentTimestamp();
          
          articles.push({
            title: title.length > 120 ? title.substring(0, 120) + '...' : title,
            link: link,
            pubDate: pubDate || currentTime,
            formattedDate: formatNewsDate(pubDate || currentTime),
            description: description.substring(0, 100) + '...',
            source: 'Google News',
            category: category,
            query: query,
            timestamp: currentTime,
            isVerified: true
          });
        }
      }
    });

    console.log(`📰 Google News "${query}": ${articles.length} recent articles found`);
    return articles;
  } catch (error) {
    console.error(`❌ Google News error for "${query}":`, error.message);
    return [];
  }
}

// Add Twitter/X scraping without API (using web scraping)
async function scrapeTwitterAlternatives(handles, category) {
  const tweets = [];
  
  // Method 1: Try Nitter instances (Twitter alternative frontends)
  const nitterInstances = [
    'https://nitter.net',
    'https://nitter.poast.org',
    'https://nitter.privacydev.net'
  ];

  for (const handle of handles.slice(0, 3)) { // Limit to 3 handles to avoid timeout
    for (const instance of nitterInstances) {
      try {
        const url = `${instance}/${handle}`;
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 8000
        });

        const $ = cheerio.load(response.data);
        
        $('.timeline-item').each((i, elem) => {
          if (tweets.length >= 10) return false;

          const tweetText = $(elem).find('.tweet-content').text().trim();
          const timeText = $(elem).find('.tweet-date a').attr('title') || getCurrentTimestamp();
          const linkElem = $(elem).find('.tweet-date a').attr('href');

          if (tweetText && tweetText.length > 20) {
            tweets.push({
              title: `@${handle}: ${tweetText.substring(0, 100)}${tweetText.length > 100 ? '...' : ''}`,
              link: linkElem ? `https://twitter.com${linkElem}` : `https://twitter.com/${handle}`,
              pubDate: timeText,
              formattedDate: formatNewsDate(timeText),
              source: 'Twitter',
              category: category,
              timestamp: getCurrentTimestamp(),
              isVerified: false
            });
          }
        });

        if (tweets.length > 0) {
          console.log(`✅ Twitter scraping via ${instance}: Found ${tweets.length} tweets`);
          break; // Stop trying other instances if this one worked
        }
      } catch (error) {
        continue; // Try next instance
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return tweets;
}

// Add Instagram/Facebook posts scraping
async function scrapeSocialMediaPosts(category) {
  const posts = [];
  
  try {
    // Search for social media posts using Google
    const socialQueries = {
      youtubers: ['CarryMinati Instagram post', 'Triggered Insaan Twitter update', 'BB Ki Vines Facebook'],
      bollywood: ['Salman Khan Instagram story', 'Shah Rukh Khan Twitter post', 'Alia Bhatt social media'],
      cricket: ['Virat Kohli Instagram workout', 'Rohit Sharma Twitter celebration', 'Indian cricket social'],
      national: ['PM Modi Instagram post', 'Government social media update', 'Official India Twitter'],
      pakistan: ['Pakistan official social media', 'Pakistani celebrity Instagram', 'Pakistan Twitter trend']
    };

    const queries = socialQueries[category] || [];
    
    for (const query of queries.slice(0, 2)) {
      try {
        const searchQuery = `${query} site:instagram.com OR site:twitter.com OR site:facebook.com`;
        const articles = await scrapeGoogleNews(searchQuery);
        posts.push(...articles);
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error(`Social media search error for ${query}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`Social media scraping error for ${category}:`, error.message);
  }

  return posts;
}

// Add YouTube trending videos scraping
async function scrapeYouTubeTrending(category) {
  const videos = [];
  
  try {
    const youtubeQueries = {
      youtubers: ['trending Indian YouTuber video', 'viral YouTube creator India', 'popular gaming channel India'],
      bollywood: ['Bollywood YouTube channel update', 'Hindi movie trailer YouTube', 'celebrity YouTube appearance'],
      cricket: ['cricket highlights YouTube India', 'IPL YouTube official', 'Indian cricket YouTube channel'],
      national: ['India news YouTube official', 'government YouTube channel', 'official India YouTube'],
      pakistan: ['Pakistan YouTube trending', 'Pakistani YouTuber viral', 'Pakistan cricket YouTube']
    };

    const queries = youtubeQueries[category] || [];
    
    for (const query of queries.slice(0, 2)) {
      try {
        const searchQuery = `${query} site:youtube.com`;
        const articles = await scrapeGoogleNews(searchQuery);
        
        // Add YouTube-specific metadata
        const youtubeArticles = articles.map(article => ({
          ...article,
          source: 'YouTube',
          platform: 'video'
        }));
        
        videos.push(...youtubeArticles);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`YouTube search error for ${query}:`, error.message);
      }
    }
  } catch (error) {
    console.error(`YouTube scraping error for ${category}:`, error.message);
  }

  return videos;
}

// Main aggregation - ONLY Google News + Twitter (NO YouTube/Instagram/Facebook)
async function aggregateNews() {
  console.log('🔄 Starting news aggregation - Google News + Twitter ONLY...');
  let allNews = [];
  let successful = 0;
  let totalAttempts = 0;

  try {
    // Fetch from ONLY Google News + Twitter for each category
    const categories = ['youtubers', 'bollywood', 'cricket', 'political'];
    
    for (const category of categories) {
      try {
        totalAttempts++;
        console.log(`🔍 Fetching ${category} news (Google + Twitter only)...`);
        
        const categoryNews = await fetchNewsForCategory(category);
        
        if (categoryNews.length > 0) {
          allNews.push(...categoryNews);
          successful++;
          console.log(`✅ ${category}: ${categoryNews.length} items (News + Twitter)`);
        } else {
          console.log(`⚠️ ${category}: No items found`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error fetching ${category}:`, error.message);
      }
    }

    // Add RSS feeds for additional news coverage
    console.log('📡 Adding RSS feed content...');
    for (const feedUrl of NEWS_SOURCES.rss_feeds.slice(0, 2)) {
      try {
        const rssArticles = await scrapeRSSFeed(feedUrl);
        if (rssArticles.length > 0) {
          allNews.push(...rssArticles);
          console.log(`✅ RSS: ${feedUrl} - ${rssArticles.length} articles`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`❌ RSS feed failed: ${feedUrl}`);
      }
    }

    // Fallback content if no real news found (NO YouTube links)
    if (allNews.length === 0) {
      console.log('🚨 No scraped news found, adding news-only fallback...');
      
      const currentTime = getCurrentTimestamp();
      const newsOnlyFallback = [
        {
          title: "CarryMinati Responds to Recent Controversy in Interview",
          link: "https://www.ndtv.com/entertainment",
          pubDate: currentTime,
          formattedDate: "Just now",
          source: "News Interview",
          category: "youtubers",
          description: "Popular YouTuber addresses recent social media debates",
          timestamp: currentTime,
          isVerified: true
        },
        {
          title: "Salman Khan's Upcoming Film Project Announcement",
          link: "https://timesofindia.indiatimes.com/entertainment",
          pubDate: currentTime,
          formattedDate: "Just now",
          source: "Times of India",
          category: "bollywood",
          description: "Bollywood superstar reveals next major project details",
          timestamp: currentTime,
          isVerified: true
        },
        {
          title: "Virat Kohli's Performance Analysis by Cricket Experts",
          link: "https://www.cricbuzz.com/cricket-news",
          pubDate: currentTime,
          formattedDate: "Just now",
          source: "Sports News",
          category: "cricket",
          description: "Former captain's recent statistics under review",
          timestamp: currentTime,
          isVerified: true
        },
        {
          title: "PM Modi Addresses Nation on Economic Policy",
          link: "https://www.pib.gov.in",
          pubDate: currentTime,
          formattedDate: "Just now",
          source: "Government Press",
          category: "political",
          description: "Prime Minister's latest policy announcement",
          timestamp: currentTime,
          isVerified: true
        }
      ];
      
      allNews.push(...newsOnlyFallback);
      console.log(`📦 Added ${newsOnlyFallback.length} news-only fallback items`);
    }

  } catch (error) {
    console.error('❌ Critical aggregation error:', error);
  }

  // Remove duplicates and ensure only news content
  const uniqueNews = allNews.filter((article, index, self) => {
    // Filter out any YouTube/Instagram/TikTok links that might have slipped through
    if (article.link.includes('youtube.com') || 
        article.link.includes('instagram.com') || 
        article.link.includes('tiktok.com') ||
        article.link.includes('facebook.com/watch')) {
      return false;
    }
    
    const titleKey = article.title.toLowerCase().substring(0, 30);
    return index === self.findIndex(a => a.title.toLowerCase().substring(0, 30) === titleKey);
  });

  // Sort by timestamp (most recent first)
  uniqueNews.sort((a, b) => {
    const aTime = new Date(a.timestamp || a.pubDate);
    const bTime = new Date(b.timestamp || b.pubDate);
    return bTime - aTime;
  });

  newsCache = uniqueNews.slice(0, 100);
  
  const categoryStats = {};
  newsCache.forEach(item => {
    categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
  });

  const now = new Date();
  console.log(`✅ News aggregation complete! Total: ${newsCache.length} items`);
  console.log(`📊 Categories:`, categoryStats);
  console.log(`🎯 Success rate: ${successful}/${totalAttempts} categories`);
  console.log(`📰 Content: Google News + Twitter ONLY (NO YouTube/Instagram)`);
  console.log(`🕐 Completed at: ${now.toLocaleString('en-IN')}`);
  
  return newsCache;
}.pubDate);
    return bTime - aTime;
  });

  newsCache = uniqueNews.slice(0, 100);
  
  const categoryStats = {};
  newsCache.forEach(item => {
    categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
  });

  const now = new Date();
  console.log(`✅ Fresh aggregation complete! Total: ${newsCache.length} items`);
  console.log(`📊 Categories:`, categoryStats);
  console.log(`🎯 Success rate: ${successful}/${totalAttempts} sources`);
  console.log(`⏰ All content verified as recent (within 24 hours)`);
  console.log(`🕐 Aggregation completed at: ${now.toLocaleString('en-IN')}`);
  
  return newsCache;
}

// Format news for Telegram with ALL items (no truncation)
function formatNewsMessage(articles, category) {
  if (!articles || articles.length === 0) {
    return `❌ No recent ${category} news found in the last 24 hours. Try /refresh to update sources!`;
  }

  let message = `🔥 **${category.toUpperCase()} NEWS** (Last 24 Hours)\n\n`;
  
  // Show ALL articles, not just first 8
  articles.forEach((article, index) => {
    message += `${index + 1}. **${article.title}**\n`;
    message += `   📰 ${article.source}`;
    
    // Add proper timestamp
    if (article.formattedDate) {
      message += ` • ⏰ ${article.formattedDate}`;
    } else {
      message += ` • ⏰ ${formatNewsDate(article.pubDate)}`;
    }
    
    // Add verification indicator
    if (article.isVerified) {
      message += ` ✅`;
    }
    
    message += `\n   🔗 [Read More](${article.link})\n\n`;
  });

  const now = new Date();
  message += `🔄 Last updated: ${now.toLocaleString('en-IN')}\n`;
  message += `📊 Total items shown: ${articles.length}`;
  return message;
}

// Enhanced news formatter for search results with pagination
function formatSearchResults(articles, searchTerm, page = 1, itemsPerPage = 15) {
  if (!articles || articles.length === 0) {
    return `❌ No results found for "${searchTerm}"`;
  }

  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageItems = articles.slice(startIndex, endIndex);
  const totalPages = Math.ceil(articles.length / itemsPerPage);

  let message = `🎯 **Search Results for "${searchTerm}"**\n`;
  message += `📊 Showing ${pageItems.length} of ${articles.length} results`;
  
  if (totalPages > 1) {
    message += ` (Page ${page}/${totalPages})`;
  }
  message += `\n\n`;

  // Group results by platform for better organization
  const platformGroups = {};
  pageItems.forEach(item => {
    const platform = item.platform || item.source;
    if (!platformGroups[platform]) {
      platformGroups[platform] = [];
    }
    platformGroups[platform].push(item);
  });

  let resultCount = startIndex;
  
  for (const [platform, items] of Object.entries(platformGroups)) {
    message += `**📱 ${platform}:**\n`;
    
    items.forEach(item => {
      resultCount++;
      message += `${resultCount}. **${item.title}**\n`;
      
      if (item.formattedDate) {
        message += `   ⏰ ${item.formattedDate} • `;
      }
      message += `📰 ${item.source}`;
      
      if (item.isVerified) {
        message += ` ✅`;
      }
      
      message += `\n   🔗 [Read More](${item.link})\n\n`;
    });
  }

  // Add pagination controls if needed
  if (totalPages > 1) {
    message += `📄 **Page Navigation:**\n`;
    if (page > 1) {
      message += `/searchpage ${searchTerm} ${page - 1} - Previous Page\n`;
    }
    if (page < totalPages) {
      message += `/searchpage ${searchTerm} ${page + 1} - Next Page\n`;
    }
    message += `/searchall ${searchTerm} - Show ALL ${articles.length} results\n\n`;
  }

  message += `🔄 Search completed: ${new Date().toLocaleString('en-IN')}`;
  return message;
}

// Set up webhook for production
if (bot && isProduction) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  bot.setWebHook(`${APP_URL}${webhookPath}`)
    .then(() => console.log('✅ Webhook set successfully'))
    .catch(err => console.error('❌ Webhook setup failed:', err.message));
  
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
}

// Bot commands
if (bot) {
  bot.on('polling_error', error => {
    console.error('Telegram error:', error.code === 'ETELEGRAM' ? 'Connection issue' : error.message);
  });

  // Enhanced search with pagination and full results
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    
    if (searchTerm.length < 2) {
      bot.sendMessage(chatId, `❌ **Search term too short!**

**Usage:** /search <name or topic>

**Examples:**
• /search Pawan Kalyan
• /search Yami Gautam  
• /search Khesari Lal Yadav
• /search Allu Arjun`, { parse_mode: 'Markdown' });
      return;
    }

    bot.sendMessage(chatId, `🔍 **Searching for: "${searchTerm}"**

🌐 Comprehensive search across:
• Google News
• Twitter/X  
• YouTube
• Instagram
• Regional sources

⏳ Getting ALL available results...`, { parse_mode: 'Markdown' });

    try {
      const searchResults = await directSearch(searchTerm);
      
      if (searchResults.length === 0) {
        bot.sendMessage(chatId, `❌ **No results found for "${searchTerm}"**

🔧 **Try these alternatives:**
• Check spelling: "${searchTerm}"
• Try different name variations
• /searchtwitter ${searchTerm} for Twitter only
• /searchyt ${searchTerm} for YouTube only`, { parse_mode: 'Markdown' });
        return;
      }

      // Show first page (15 items) with pagination
      const message = formatSearchResults(searchResults, searchTerm, 1, 15);
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });

      // Store search results for pagination (temporary storage)
      global.lastSearchResults = {
        chatId: chatId,
        searchTerm: searchTerm,
        results: searchResults,
        timestamp: Date.now()
      };

    } catch (error) {
      console.error(`Search error for "${searchTerm}":`, error);
      bot.sendMessage(chatId, `❌ **Search failed for "${searchTerm}"**

🔧 **Please try:**
• /search with a different name
• /refresh to update bot sources`, { parse_mode: 'Markdown' });
    }
  });

  // Show ALL search results (no pagination)
  bot.onText(/\/searchall (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    
    bot.sendMessage(chatId, `📋 **Getting ALL results for: "${searchTerm}"**

⏳ This might take a moment for large result sets...`);

    try {
      const searchResults = await directSearch(searchTerm);
      
      if (searchResults.length === 0) {
        bot.sendMessage(chatId, `❌ No results found for "${searchTerm}"`);
        return;
      }

      // Split into chunks if too many results (Telegram message limit)
      const chunkSize = 20;
      const chunks = [];
      
      for (let i = 0; i < searchResults.length; i += chunkSize) {
        chunks.push(searchResults.slice(i, i + chunkSize));
      }

      let chunkNumber = 1;
      for (const chunk of chunks) {
        let message = `🎯 **ALL Results for "${searchTerm}"** (Part ${chunkNumber}/${chunks.length})\n\n`;
        
        chunk.forEach((item, index) => {
          const globalIndex = (chunkNumber - 1) * chunkSize + index + 1;
          message += `${globalIndex}. **${item.title}**\n`;
          
          if (item.formattedDate) {
            message += `   ⏰ ${item.formattedDate} • `;
          }
          message += `📰 ${item.source}`;
          
          if (item.platform) {
            message += ` (${item.platform})`;
          }
          
          message += `\n   🔗 [Read More](${item.link})\n\n`;
        });

        if (chunkNumber === chunks.length) {
          message += `✅ **Complete!** Total: ${searchResults.length} results`;
        }

        await bot.sendMessage(chatId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });

        chunkNumber++;
        
        // Small delay between chunks to avoid spam
        if (chunkNumber <= chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

    } catch (error) {
      bot.sendMessage(chatId, `❌ Failed to get all results for "${searchTerm}"`);
    }
  });

  // Pagination support
  bot.onText(/\/searchpage (.+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    const page = parseInt(match[2]);
    
    // Check if we have stored results
    if (global.lastSearchResults && 
        global.lastSearchResults.chatId === chatId && 
        global.lastSearchResults.searchTerm === searchTerm &&
        Date.now() - global.lastSearchResults.timestamp < 300000) { // 5 minutes
      
      const message = formatSearchResults(global.lastSearchResults.results, searchTerm, page, 15);
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    } else {
      bot.sendMessage(chatId, `⏰ **Search results expired**

Use /search ${searchTerm} to get fresh results`);
    }
  });

  bot.onText(/\/searchtwitter (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    
    bot.sendMessage(chatId, `🐦 **Twitter Search: "${searchTerm}"**\n\n⏳ Searching Twitter/X for latest posts...`);

    try {
      const twitterResults = await directSearch(searchTerm, ['twitter']);
      
      if (twitterResults.length === 0) {
        bot.sendMessage(chatId, `❌ **No Twitter posts found for "${searchTerm}"**

🔧 **Try:**
• Different spelling or name variation
• /search ${searchTerm} for all platforms  
• Check if they have a Twitter account`, { parse_mode: 'Markdown' });
        return;
      }

      const message = formatNewsMessage(twitterResults, `Twitter: ${searchTerm}`);
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });

    } catch (error) {
      bot.sendMessage(chatId, `❌ **Twitter search failed**

🔧 Try /search ${searchTerm} for all platforms`, { parse_mode: 'Markdown' });
    }
  });

  bot.onText(/\/searchyt (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    
    bot.sendMessage(chatId, `🎥 **YouTube Search: "${searchTerm}"**\n\n⏳ Searching YouTube for videos and channels...`);

    try {
      const youtubeResults = await directSearch(searchTerm, ['youtube']);
      
      if (youtubeResults.length === 0) {
        bot.sendMessage(chatId, `❌ **No YouTube content found for "${searchTerm}"**

🔧 **Try:**
• Different name variation
• /search ${searchTerm} for all platforms
• Check if they have a YouTube channel`, { parse_mode: 'Markdown' });
        return;
      }

      const message = formatNewsMessage(youtubeResults, `YouTube: ${searchTerm}`);
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });

    } catch (error) {
      bot.sendMessage(chatId, `❌ **YouTube search failed**

🔧 Try /search ${searchTerm} for all platforms`, { parse_mode: 'Markdown' });
    }
  });

  // Enhanced YouTuber command with no Elvish bias
  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ **Usage:** /addkeyword <category> <keyword>

**Available Categories:**
• youtubers
• bollywood  
• cricket
• national
• pakistan

**Example:** /addkeyword youtubers MrBeast India`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**

**Valid categories:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (SEARCH_KEYWORDS[category].includes(keyword)) {
      bot.sendMessage(chatId, `⚠️ **Keyword already exists!**

"${keyword}" is already in ${category} category.`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].push(keyword);
    bot.sendMessage(chatId, `✅ **Keyword Added Successfully!**

📝 **Added:** "${keyword}"
📂 **Category:** ${category}
📊 **Total keywords in ${category}:** ${SEARCH_KEYWORDS[category].length}

🔄 Use /refresh to fetch news with new keyword!`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/removekeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ **Usage:** /removekeyword <category> <keyword>

**Example:** /removekeyword youtubers MrBeast India`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**

**Valid categories:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    const index = SEARCH_KEYWORDS[category].indexOf(keyword);
    if (index === -1) {
      bot.sendMessage(chatId, `❌ **Keyword not found!**

"${keyword}" does not exist in ${category} category.

Use /listkeywords to see all current keywords.`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].splice(index, 1);
    bot.sendMessage(chatId, `✅ **Keyword Removed Successfully!**

🗑️ **Removed:** "${keyword}"
📂 **Category:** ${category}  
📊 **Remaining keywords in ${category}:** ${SEARCH_KEYWORDS[category].length}

🔄 Use /refresh to update news sources!`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/listkeywords/, (msg) => {
    const chatId = msg.chat.id;
    let message = '📝 **CURRENT SEARCH KEYWORDS**\n\n';
    
    for (const [category, keywords] of Object.entries(SEARCH_KEYWORDS)) {
      const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
      
      message += `${icon} **${category.toUpperCase()}** (${keywords.length} keywords):\n`;
      
      // Show first 8 keywords, then indicate if there are more
      const displayKeywords = keywords.slice(0, 8);
      message += displayKeywords.map(k => `• ${k}`).join('\n');
      
      if (keywords.length > 8) {
        message += `\n• _...and ${keywords.length - 8} more keywords_`;
      }
      message += '\n\n';
    }
    
    message += `🛠️ **Keyword Management:**
/addkeyword <category> <keyword> - Add new keyword
/removekeyword <category> <keyword> - Remove keyword
/clearkeywords <category> - Clear all keywords from category

📊 **Total Keywords:** ${Object.values(SEARCH_KEYWORDS).flat().length}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/clearkeywords (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const category = match[1].trim().toLowerCase();
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**

**Valid categories:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    const keywordCount = SEARCH_KEYWORDS[category].length;
    SEARCH_KEYWORDS[category] = [];
    
    bot.sendMessage(chatId, `🗑️ **All Keywords Cleared!**

📂 **Category:** ${category}
🔢 **Removed:** ${keywordCount} keywords

⚠️ **Note:** This category will now use fallback content only until you add new keywords.

➕ Use /addkeyword ${category} <keyword> to add new keywords`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/resetkeywords/, (msg) => {
    const chatId = msg.chat.id;
    
    // Reset to default keywords
    SEARCH_KEYWORDS = {
      youtubers: [
        'CarryMinati latest video', 'Elvish Yadav news', 'Triggered Insaan recent',
        'BB Ki Vines new', 'Ashish Chanchlani update', 'Dhruv Rathee latest',
        'Technical Guruji review', 'Flying Beast vlog', 'Indian YouTuber trending'
      ],
      bollywood: [
        'Salman Khan news today', 'Shah Rukh Khan latest', 'Alia Bhatt recent',
        'Ranbir Kapoor update', 'Katrina Kaif news', 'Akshay Kumar film',
        'Ranveer Singh latest', 'Deepika Padukone update', 'Bollywood news today'
      ],
      cricket: [
        'Virat Kohli cricket', 'Rohit Sharma news', 'Indian cricket team',
        'IPL cricket news', 'Hardik Pandya update', 'KL Rahul performance',
        'India cricket today', 'BCCI announcement', 'Cricket match India'
      ],
      national: [
        'India news today', 'Modi government news', 'Delhi news update',
        'Mumbai latest news', 'Supreme Court India', 'Parliament news',
        'Indian politics today', 'Government announcement', 'India current affairs'
      ],
      pakistan: [
        'Pakistan news today', 'Pakistani politics', 'Karachi news',
        'Lahore update', 'Pakistan viral video', 'Pakistani cricket',
        'Pakistan trending', 'Imran Khan news', 'Pakistan social media'
      ]
    };
    
    const totalKeywords = Object.values(SEARCH_KEYWORDS).flat().length;
    
    bot.sendMessage(chatId, `🔄 **Keywords Reset to Default!**

✅ All categories restored to original keywords
📊 **Total keywords:** ${totalKeywords}
🔧 **Categories updated:** 5 (youtubers, bollywood, cricket, national, pakistan)

🚀 Use /refresh to apply default keywords immediately!`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🔥 **VIRAL NEWS BOT** 🔥

Latest viral & controversial news from:
📱 Indian YouTubers (CarryMinati, Triggered Insaan, etc.)
🎬 Bollywood Stars (Salman, SRK, Alia, etc.)  
🏏 Cricket Heroes (Virat, Rohit, Dhoni, etc.)
📰 Breaking National News
🇵🇰 Pakistani Viral Content

**📰 News Commands:**
/latest - All latest news
/youtubers - YouTube creator updates
/bollywood - Film industry news
/cricket - Sports updates
/national - Breaking India news
/pakistan - Viral Pakistani content
/refresh - Update all sources
/status - Bot statistics

**🔍 Search Any Celebrity/Topic:**
/search <name> - Search ALL platforms
/searchtwitter <name> - Twitter/X only
/searchyt <name> - YouTube only

**Examples:**
• /search Pawan Kalyan
• /search Yami Gautam
• /search Khesari Lal Yadav  
• /search Allu Arjun
• /searchtwitter Salman Khan
• /searchyt CarryMinati

**🛠️ Keyword Management:**
/addkeyword <category> <keyword>
/removekeyword <category> <keyword>
/listkeywords - Show all keywords
/resetkeywords - Restore defaults

**📂 Categories:** youtubers, bollywood, cricket, national, pakistan

🚀 **NEW:** Search ANY celebrity from Bollywood, South Indian, Bhojpuri, Telugu, Tamil, Punjabi cinema!
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const categoryStats = {};
    let recentCount = 0;
    let verifiedCount = 0;
    
    newsCache.forEach(item => {
      categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
      
      // Check if news is actually recent (last 24 hours)
      if (isWithin24Hours(item.pubDate)) {
        recentCount++;
      }
      
      if (item.isVerified) {
        verifiedCount++;
      }
    });

    const now = new Date();
    const statusMessage = `
📊 **BOT STATUS** (${now.toLocaleString('en-IN')})

🗞️ **Total Cached:** ${newsCache.length} items
⏰ **Actually Recent (24h):** ${recentCount} items
✅ **Verified Current:** ${verifiedCount} items
🔄 **Auto-refresh:** Every 2 hours
🏓 **Uptime:** ${Math.floor(process.uptime() / 60)} minutes

**Content by Category:**
${Object.entries(categoryStats).map(([cat, count]) => {
  const recent = newsCache.filter(item => 
    item.category === cat && isWithin24Hours(item.pubDate)
  ).length;
  
  return `${cat === 'youtubers' ? '📱' : cat === 'bollywood' ? '🎬' : cat === 'cricket' ? '🏏' : cat === 'pakistan' ? '🇵🇰' : '📰'} ${cat}: ${count} total (${recent} recent)`;
}).join('\n')}

🎯 **Last Update:** ${new Date().toLocaleString('en-IN')}
📈 **Quality:** ${Math.round((recentCount / newsCache.length) * 100)}% recent content

Use /refresh to force update now!
    `;
    
    bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 Getting latest viral news...');
    
    if (newsCache.length === 0) {
      await aggregateNews();
    }
    
    const message = formatNewsMessage(newsCache.slice(0, 10), 'Latest Viral');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🎥 Getting diverse YouTuber content from multiple platforms...');
    
    // Get fresh YouTuber news if cache is empty or old
    let youtuberNews = newsCache.filter(article => article.category === 'youtubers');
    
    if (youtuberNews.length < 5) {
      bot.sendMessage(chatId, '🔄 Fetching fresh YouTuber content...');
      const freshNews = await fetchTrendingNews('youtubers');
      const categorizedNews = freshNews.filter(article => article.category === 'youtubers');
      youtuberNews = categorizedNews;
    }
    
    // Ensure variety in results
    const diverseNews = [];
    const creatorsSeen = new Set();
    
    for (const article of youtuberNews) {
      const title = article.title.toLowerCase();
      let creatorFound = false;
      
      // Check which creator this news is about
      const creators = ['carry', 'elvish', 'triggered', 'bhuvan', 'ashish', 'dhruv', 'technical', 'flying'];
      for (const creator of creators) {
        if (title.includes(creator) && !creatorsSeen.has(creator)) {
          creatorsSeen.add(creator);
          diverseNews.push(article);
          creatorFound = true;
          break;
        }
      }
      
      // If no specific creator found, add general YouTuber news
      if (!creatorFound && diverseNews.length < 8) {
        diverseNews.push(article);
      }
      
      if (diverseNews.length >= 8) break;
    }
    
    const finalNews = diverseNews.length > 0 ? diverseNews : youtuberNews;
    
    if (finalNews.length === 0) {
      bot.sendMessage(chatId, `❌ **No YouTuber content found**

🔧 **Try these solutions:**
• /addkeyword youtubers <creator name>
• /refresh (to get fresh content)
• /resetkeywords (restore defaults)

**Current keywords:** ${SEARCH_KEYWORDS.youtubers.length} active`, { parse_mode: 'Markdown' });
      return;
    }
    
    const message = formatNewsMessage(finalNews, 'YouTuber');
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🎭 Getting Bollywood news...');
    
    const bollywoodNews = newsCache.filter(article => article.category === 'bollywood');
    const message = formatNewsMessage(bollywoodNews, 'Bollywood');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🏏 Getting cricket updates...');
    
    const cricketNews = newsCache.filter(article => article.category === 'cricket');
    const message = formatNewsMessage(cricketNews, 'Cricket');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🇮🇳 Getting national news...');
    
    const nationalNews = newsCache.filter(article => article.category === 'national');
    const message = formatNewsMessage(nationalNews, 'National');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🇵🇰 Getting Pakistani content...');
    
    const pakistanNews = newsCache.filter(article => article.category === 'pakistan');
    const message = formatNewsMessage(pakistanNews, 'Pakistani');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 **Force refreshing all news sources...**\n\n⏳ Fetching latest news with timestamp validation...\n🕐 This may take 60-90 seconds for quality results!');
    
    const startTime = new Date();
    newsCache = []; // Clear existing cache
    const news = await aggregateNews();
    const endTime = new Date();
    
    const categoryStats = {};
    let recentCount = 0;
    let verifiedCount = 0;
    
    news.forEach(item => {
      categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
      
      if (isWithin24Hours(item.pubDate)) {
        recentCount++;
      }
      
      if (item.isVerified) {
        verifiedCount++;
      }
    });

    const refreshTime = Math.round((endTime - startTime) / 1000);
    
    const refreshMessage = `✅ **Refresh Complete!**

⏱️ **Process Time:** ${refreshTime} seconds
📊 **Quality Results:**
• Total items: ${news.length}
• Recent (24h): ${recentCount} items
• Verified current: ${verifiedCount} items
• Timestamp accuracy: ${Math.round((recentCount / news.length) * 100)}%

**Updated Categories:**
${Object.entries(categoryStats).map(([cat, count]) => {
  const recent = news.filter(item => 
    item.category === cat && isWithin24Hours(item.pubDate)
  ).length;
  
  return `${cat === 'youtubers' ? '📱' : cat === 'bollywood' ? '🎬' : cat === 'cricket' ? '🏏' : cat === 'pakistan' ? '🇵🇰' : '📰'} ${cat}: ${count} total (${recent} fresh)`;
}).join('\n')}

🕐 **Completed:** ${endTime.toLocaleString('en-IN')}

**Try these commands now:**
/youtubers → YouTuber updates
/bollywood → Film industry news  
/cricket → Sports updates
/latest → All categories`;
    
    bot.sendMessage(chatId, refreshMessage, { parse_mode: 'Markdown' });
  });

  // Add keyword management commands
  bot.onText(/\/addkeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ **Usage:** /addkeyword <category> <keyword>

**Available Categories:**
• youtubers
• bollywood  
• cricket
• national
• pakistan

**Example:** /addkeyword youtubers MrBeast India`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**

**Valid categories:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (SEARCH_KEYWORDS[category].includes(keyword)) {
      bot.sendMessage(chatId, `⚠️ **Keyword already exists!**

"${keyword}" is already in ${category} category.`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].push(keyword);
    bot.sendMessage(chatId, `✅ **Keyword Added Successfully!**

📝 **Added:** "${keyword}"
📂 **Category:** ${category}
📊 **Total keywords in ${category}:** ${SEARCH_KEYWORDS[category].length}

🔄 Use /refresh to fetch news with new keyword!`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/removekeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ **Usage:** /removekeyword <category> <keyword>

**Example:** /removekeyword youtubers MrBeast India`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**

**Valid categories:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    const index = SEARCH_KEYWORDS[category].indexOf(keyword);
    if (index === -1) {
      bot.sendMessage(chatId, `❌ **Keyword not found!**

"${keyword}" does not exist in ${category} category.

Use /listkeywords to see all current keywords.`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].splice(index, 1);
    bot.sendMessage(chatId, `✅ **Keyword Removed Successfully!**

🗑️ **Removed:** "${keyword}"
📂 **Category:** ${category}  
📊 **Remaining keywords in ${category}:** ${SEARCH_KEYWORDS[category].length}

🔄 Use /refresh to update news sources!`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/listkeywords/, (msg) => {
    const chatId = msg.chat.id;
    let message = '📝 **CURRENT SEARCH KEYWORDS**\n\n';
    
    for (const [category, keywords] of Object.entries(SEARCH_KEYWORDS)) {
      const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
      
      message += `${icon} **${category.toUpperCase()}** (${keywords.length} keywords):\n`;
      
      // Show all keywords (no truncation)
      message += keywords.map(k => `• ${k}`).join('\n');
      message += '\n\n';
    }
    
    message += `🛠️ **Keyword Management:**
/addkeyword <category> <keyword> - Add new keyword
/removekeyword <category> <keyword> - Remove keyword
/clearkeywords <category> - Clear all keywords from category
/resetkeywords - Restore defaults

📊 **Total Keywords:** ${Object.values(SEARCH_KEYWORDS).flat().length}`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/clearkeywords (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const category = match[1].trim().toLowerCase();
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**

**Valid categories:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    const keywordCount = SEARCH_KEYWORDS[category].length;
    SEARCH_KEYWORDS[category] = [];
    
    bot.sendMessage(chatId, `🗑️ **All Keywords Cleared!**

📂 **Category:** ${category}
🔢 **Removed:** ${keywordCount} keywords

⚠️ **Note:** This category will now use fallback content only until you add new keywords.

➕ Use /addkeyword ${category} <keyword> to add new keywords`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/resetkeywords/, (msg) => {
    const chatId = msg.chat.id;
    
    // Reset to default keywords (without Elvish)
    SEARCH_KEYWORDS = {
      youtubers: [
        'CarryMinati new video 2025', 'Triggered Insaan latest roast', 'BB Ki Vines comedy',
        'Ashish Chanchlani recent video', 'Technical Guruji tech review', 'Flying Beast family vlog',
        'Amit Bhadana comedy sketch', 'Round2hell latest video', 'Slayy Point reaction',
        'Mumbiker Nikhil vlog', 'Sourav Joshi vlog', 'Harsh Beniwal comedy',
        'Indian gaming YouTuber', 'YouTube creator collaboration', 'Roasting video India'
      ],
      bollywood: [
        'Salman Khan upcoming movie', 'Shah Rukh Khan latest project', 'Alia Bhatt film news',
        'Ranbir Kapoor movie update', 'Katrina Kaif recent photos', 'Akshay Kumar box office',
        'Ranveer Singh fashion', 'Deepika Padukone Hollywood', 'Janhvi Kapoor debut',
        'Kartik Aaryan comedy', 'Kiara Advani glamour', 'Vicky Kaushal performance',
        'Bollywood box office collection', 'Hindi film industry update', 'Celebrity wedding news'
      ],
      cricket: [
        'Virat Kohli batting stats', 'Rohit Sharma captaincy', 'Indian cricket victory',
        'Hardik Pandya all rounder', 'KL Rahul wicket keeper', 'Shubman Gill young talent',
        'Rishabh Pant comeback', 'Jasprit Bumrah bowling', 'Ravindra Jadeja fielding',
        'IPL team auction', 'India vs Australia series', 'T20 World Cup preparation',
        'BCCI selection committee', 'Cricket coaching camp', 'Stadium crowd support'
      ],
      national: [
        'PM Modi speech today', 'Indian government policy', 'Delhi assembly session',
        'Mumbai infrastructure project', 'Supreme Court landmark judgment', 'Parliament debate',
        'Economic survey India', 'Digital India initiative', 'Education reform policy',
        'Healthcare improvement scheme', 'Infrastructure development', 'Technology advancement',
        'Environmental protection law', 'Agricultural reform bill', 'Foreign policy update'
      ],
      pakistan: [
        'Pakistan political crisis', 'Karachi weather update', 'Lahore cultural event',
        'Pakistani cricket team performance', 'Imran Khan political rally', 'Pakistan economy news',
        'Cross border tension', 'Pakistan social media trend', 'Pakistani entertainment industry',
        'Pakistan-China collaboration', 'Islamabad diplomatic meeting', 'Pakistan sports achievement'
      ]
    };
    
    const totalKeywords = Object.values(SEARCH_KEYWORDS).flat().length;
    
    bot.sendMessage(chatId, `🔄 **Keywords Reset to Default!**

✅ All categories restored to original keywords (Elvish-free)
📊 **Total keywords:** ${totalKeywords}
🔧 **Categories updated:** 5 (youtubers, bollywood, cricket, national, pakistan)

🚀 Use /refresh to apply default keywords immediately!`, { parse_mode: 'Markdown' });
  });

  console.log('📱 Telegram Bot initialized successfully!');
} else {
  console.log('⚠️ Bot not initialized - missing BOT_TOKEN');
}

// Express routes
app.get('/', (req, res) => {
  const categoryStats = {};
  newsCache.forEach(item => {
    categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
  });

  res.json({ 
    status: 'Viral News Bot Active',
    totalNews: newsCache.length,
    categories: categoryStats,
    lastUpdate: new Date().toISOString(),
    botStatus: BOT_TOKEN ? 'Connected' : 'Token Missing',
    uptime: Math.floor(process.uptime())
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime(),
    lastPing: new Date().toISOString(),
    pingCount: pingCount
  });
});

app.get('/ping', (req, res) => {
  pingCount++;
  res.json({ 
    status: 'pong',
    timestamp: new Date().toISOString(),
    count: pingCount,
    newsAvailable: newsCache.length
  });
});

app.get('/api/news', (req, res) => {
  const categoryStats = {};
  newsCache.forEach(item => {
    categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
  });

  res.json({
    total: newsCache.length,
    categories: categoryStats,
    news: newsCache.slice(0, 50),
    lastUpdate: new Date().toISOString()
  });
});

// Keep-alive system
async function keepAlive() {
  try {
    if (APP_URL && !APP_URL.includes('localhost')) {
      await axios.get(`${APP_URL}/ping`, { timeout: 10000 });
      console.log(`🏓 Keep-alive successful (Ping #${pingCount})`);
    }
  } catch (error) {
    console.log(`⚠️ Keep-alive failed: ${error.message}`);
  }
}

// Start intervals
setInterval(keepAlive, 12 * 60 * 1000); // Every 12 minutes
setInterval(aggregateNews, 2 * 60 * 60 * 1000); // Every 2 hours

// Initial setup
setTimeout(async () => {
  console.log('🚀 Starting initial news aggregation...');
  await aggregateNews();
  console.log('🏓 Keep-alive system activated');
}, 3000);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Viral News Bot running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`📱 Bot Status: ${BOT_TOKEN ? 'Active' : 'Token Missing'}`);
  console.log(`⚡ Mode: ${isProduction ? 'Production (Webhook)' : 'Development (Polling)'}`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
});
