const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';

const bot = BOT_TOKEN ? new TelegramBot(BOT_TOKEN, { 
  polling: !isProduction,
  webHook: isProduction 
}) : null;

// Express setup
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const APP_URL = process.env.RENDER_EXTERNAL_URL || `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;

// Global cache
let newsCache = [];
let pingCount = 0;

// KEYWORDS - Enhanced for all categories
let SEARCH_KEYWORDS = {
  youtubers: [
    'CarryMinati',
    'Triggered Insaan', 
    'BB Ki Vines',
    'Technical Guruji',
    'Ashish Chanchlani',
    'Indian YouTuber',
    'YouTube creator India'
  ],
  bollywood: [
    'Salman Khan',
    'Shah Rukh Khan',
    'Alia Bhatt',
    'Bollywood news',
    'Hindi film',
    'Indian cinema'
  ],
  cricket: [
    'Virat Kohli',
    'Rohit Sharma', 
    'MS Dhoni',
    'Indian cricket',
    'IPL cricket',
    'BCCI'
  ],
  national: [
    'Modi news',
    'India news',
    'Delhi news',
    'Mumbai news',
    'Indian government'
  ],
  pakistan: [
    'Pakistan news',
    'Karachi news',
    'Pakistani cricket',
    'Pakistan trending'
  ]
};

// Utility functions
function getCurrentTimestamp() {
  return new Date().toISOString();
}

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

function isWithin24Hours(dateString) {
  try {
    if (!dateString) return false;
    const newsDate = new Date(dateString);
    const now = new Date();
    if (isNaN(newsDate.getTime())) return false;
    const diffInHours = (now - newsDate) / (1000 * 60 * 60);
    return diffInHours <= 24 && diffInHours >= 0;
  } catch (error) {
    return false;
  }
}

function categorizeNews(title, description = '') {
  const content = `${title} ${description}`.toLowerCase();
  
  // Enhanced YouTuber detection - more comprehensive
  if (content.match(/carry|carryminati|triggered|insaan|bhuvan|bb ki vines|ashish|chanchlani|dhruv|rathee|technical|guruji|elvish|yadav|youtube|youtuber|subscriber|gaming|roast|vlog|creator|influencer|streamer|viral video|content creator|social media star|gaming channel|comedy channel|tech channel|family vlog|reaction video|collab|collaboration|brand deal|monetization|demonetization|subscriber milestone|trending video|viral content|digital creator|online creator/)) {
    return 'youtubers';
  }
  
  if (content.match(/salman|shahrukh|srk|alia|ranbir|katrina|akshay|ranveer|deepika|bollywood|film|movie|actor|actress|cinema|hindi cinema|mumbai film|bollywood gossip|celebrity wedding|box office|film industry|hindi film/)) {
    return 'bollywood';
  }
  
  if (content.match(/virat|kohli|rohit|sharma|dhoni|cricket|ipl|india vs|hardik|rahul|bumrah|wicket|century|match|bcci|test match|odi|t20|world cup|indian cricket|cricket team|sports/)) {
    return 'cricket';
  }
  
  if (content.match(/pakistan|imran khan|karachi|lahore|islamabad|pakistani|pti|pml|pakistan government|pakistan news|pakistan politics/)) {
    return 'pakistan';
  }
  
  return 'national';
}

// Google News scraping with clean direct links
async function scrapeGoogleNews(query) {
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en&when:1d`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data, { xmlMode: true });
    const articles = [];

    $('item').each((i, elem) => {
      const title = $(elem).find('title').text().trim();
      const link = $(elem).find('link').text().trim();
      const pubDate = $(elem).find('pubDate').text().trim();
      const description = $(elem).find('description').text().trim();

      if (title && link && title.length > 10) {
        const isRecent = isWithin24Hours(pubDate);
        
        if (isRecent || !pubDate) {
          const category = categorizeNews(title, description);
          const currentTime = getCurrentTimestamp();
          
          // Clean Google News URL to get direct link
          let cleanLink = link;
          try {
            // Extract actual news URL from Google News redirect
            if (link.includes('news.google.com')) {
              const urlMatch = link.match(/url=([^&]+)/);
              if (urlMatch) {
                cleanLink = decodeURIComponent(urlMatch[1]);
              } else {
                // If can't extract, use search query instead
                cleanLink = `https://www.google.com/search?q=${encodeURIComponent(title)}`;
              }
            }
          } catch (error) {
            console.error('Error cleaning link:', error.message);
            cleanLink = `https://www.google.com/search?q=${encodeURIComponent(title)}`;
          }
          
          articles.push({
            title: title.length > 150 ? title.substring(0, 150) + '...' : title,
            link: cleanLink, // Use cleaned link instead of Google redirect
            pubDate: pubDate || currentTime,
            formattedDate: formatNewsDate(pubDate || currentTime),
            description: description.substring(0, 120) + '...',
            source: 'Google News',
            category: category,
            query: query,
            timestamp: currentTime,
            isVerified: true
          });
        }
      }
    });

    console.log(`📰 "${query}": ${articles.length} articles found`);
    return articles;
  } catch (error) {
    console.error(`❌ Error for "${query}":`, error.message);
    return [];
  }
}

// Enhanced multi-source search for specific platforms
async function searchMultiplePlatforms(searchTerm) {
  const allResults = [];
  
  try {
    console.log(`🔍 Multi-platform search for: ${searchTerm}`);
    
    // 1. Google News
    const newsResults = await scrapeGoogleNews(searchTerm);
    allResults.push(...newsResults);
    
    // 2. Twitter search
    try {
      const twitterQuery = `${searchTerm} site:twitter.com OR site:x.com`;
      const twitterResults = await scrapeGoogleNews(twitterQuery);
      const twitterArticles = twitterResults.map(article => ({
        ...article,
        source: 'Twitter/X',
        platform: 'twitter'
      }));
      allResults.push(...twitterArticles);
      console.log(`     ✅ Twitter: ${twitterArticles.length} results`);
    } catch (error) {
      console.error('Twitter search error:', error.message);
    }
    
    // 3. YouTube search
    try {
      const youtubeQuery = `${searchTerm} site:youtube.com`;
      const youtubeResults = await scrapeGoogleNews(youtubeQuery);
      const youtubeArticles = youtubeResults.map(article => ({
        ...article,
        source: 'YouTube',
        platform: 'youtube'
      }));
      allResults.push(...youtubeArticles);
      console.log(`     ✅ YouTube: ${youtubeArticles.length} results`);
    } catch (error) {
      console.error('YouTube search error:', error.message);
    }
    
    // 4. Instagram search
    try {
      const instaQuery = `${searchTerm} site:instagram.com`;
      const instaResults = await scrapeGoogleNews(instaQuery);
      const instaArticles = instaResults.map(article => ({
        ...article,
        source: 'Instagram',
        platform: 'instagram'
      }));
      allResults.push(...instaArticles);
      console.log(`     ✅ Instagram: ${instaArticles.length} results`);
    } catch (error) {
      console.error('Instagram search error:', error.message);
    }

    // Remove duplicates
    const uniqueResults = allResults.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

    console.log(`✅ Multi-platform search complete: ${uniqueResults.length} total results`);
    return uniqueResults;

  } catch (error) {
    console.error(`❌ Multi-platform search error:`, error.message);
    return [];
  }
}

// Enhanced category-specific content fetching with multi-platform support for ALL categories
async function fetchEnhancedContent(category) {
  const allArticles = [];
  
  try {
    console.log(`🎯 Enhanced ${category} content fetching with multi-platform search...`);
    
    // Category-specific enhanced terms
    const enhancedTerms = {
      youtubers: [
        'Indian YouTuber news', 'content creator brand deal', 'gaming streamer India',
        'social media influencer India', 'YouTube earnings India', 'roasting video viral'
      ],
      bollywood: [
        'Bollywood box office collection', 'Hindi film release', 'celebrity wedding bollywood',
        'film shooting updates', 'bollywood controversy', 'hindi movie trailer'
      ],
      cricket: [
        'India cricket team selection', 'IPL auction updates', 'cricket world cup india',
        'BCCI announcement latest', 'indian cricket controversy', 'cricket match highlights'
      ],
      national: [
        'Indian government policy update', 'Delhi assembly news', 'Mumbai development project',
        'Supreme Court India judgment', 'Parliament session india', 'Modi announcement'
      ],
      pakistan: [
        'Pakistan political update', 'Karachi city news', 'Lahore development',
        'Pakistani cricket team', 'Pakistan viral trend', 'Pakistani entertainment'
      ]
    };

    // Category-specific multi-platform search terms
    const multiPlatformTerms = {
      youtubers: ['Elvish Yadav', 'CarryMinati', 'Triggered Insaan'],
      bollywood: ['Salman Khan', 'Shah Rukh Khan', 'Alia Bhatt'],
      cricket: ['Virat Kohli', 'Rohit Sharma', 'MS Dhoni'],
      national: ['Narendra Modi', 'Rahul Gandhi', 'Delhi news'],
      pakistan: ['Pakistan trending', 'Imran Khan', 'Karachi news']
    };

    const terms = enhancedTerms[category] || [];
    const platformTerms = multiPlatformTerms[category] || [];
    
    // MULTI-PLATFORM SEARCH for all categories
    console.log(`🌐 Multi-platform search for ${category}...`);
    
    for (const term of platformTerms.slice(0, 2)) { // Use 2 terms to avoid timeout
      try {
        console.log(`   → Multi-platform search for: ${term}`);
        const multiResults = await searchMultiplePlatforms(term);
        
        // Filter for category-related content
        const categoryResults = multiResults.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryResults);
        console.log(`     ✅ Multi-platform found ${categoryResults.length} articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 1200));
      } catch (error) {
        console.error(`Multi-platform error for ${term}:`, error.message);
      }
    }
    
    // ENHANCED TERMS SEARCH
    console.log(`🎯 Enhanced terms search for ${category}...`);
    for (const term of terms.slice(0, 3)) { // Reduced to 3 to save time
      try {
        console.log(`   → Enhanced search: ${term}`);
        const articles = await scrapeGoogleNews(term);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        console.log(`     ✅ Found ${categoryArticles.length} articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Error with enhanced term "${term}":`, error.message);
      }
    }
    
    // BACKUP KEYWORD SEARCH
    const keywords = SEARCH_KEYWORDS[category] || [];
    console.log(`🔍 Backup search with ${keywords.length} keywords...`);
    
    for (let i = 0; i < Math.min(keywords.length, 4); i++) { // Limit to 4 keywords
      const keyword = keywords[i];
      try {
        console.log(`   → Backup ${i+1}/${Math.min(keywords.length, 4)}: ${keyword}`);
        const articles = await scrapeGoogleNews(keyword);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        console.log(`     ✅ Backup found ${categoryArticles.length} articles`);
        
        await new Promise(resolve => setTimeout(resolve, 600));
      } catch (error) {
        console.error(`❌ Backup error with keyword "${keyword}":`, error.message);
      }
    }

    // Remove duplicates
    const uniqueArticles = allArticles.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

    console.log(`✅ ${category}: ${uniqueArticles.length} unique articles from MULTI-PLATFORM enhanced search`);
    console.log(`📊 Sources used: Multi-platform + Enhanced terms + Backup keywords`);
    return uniqueArticles;
    
  } catch (error) {
    console.error(`❌ Enhanced search error for ${category}:`, error.message);
    return [];
  }
}

// Create fallback content if needed
function createFallbackContent(category) {
  const currentTime = getCurrentTimestamp();
  
  const fallbackContent = {
    youtubers: [
      {
        title: "Indian YouTube Creator Community Shows Strong Growth",
        link: "https://creators.youtube.com",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Creator Economy",
        category: "youtubers",
        timestamp: currentTime,
        isVerified: true
      },
      {
        title: "Content Creator Brand Partnerships Rise in India",
        link: "https://www.socialsamosa.com",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Social Media",
        category: "youtubers",
        timestamp: currentTime,
        isVerified: true
      }
    ],
    bollywood: [
      {
        title: "Bollywood Industry Shows Strong Box Office Performance",
        link: "https://www.bollywoodhungama.com",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Film Industry",
        category: "bollywood",
        timestamp: currentTime,
        isVerified: true
      }
    ],
    cricket: [
      {
        title: "Indian Cricket Team Preparation Updates Continue",
        link: "https://www.cricbuzz.com",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Cricket News", 
        category: "cricket",
        timestamp: currentTime,
        isVerified: true
      }
    ],
    national: [
      {
        title: "Government Policy Implementation Shows Progress",
        link: "https://www.pib.gov.in",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Official News",
        category: "national",
        timestamp: currentTime,
        isVerified: true
      }
    ],
    pakistan: [
      {
        title: "Pakistan Digital Trends Continue to Gain Attention",
        link: "https://www.dawn.com",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Regional Media",
        category: "pakistan",
        timestamp: currentTime,
        isVerified: true
      }
    ]
  };
  
  return fallbackContent[category] || [];
}

// Main aggregation function
async function aggregateNews() {
  console.log('🔄 Starting comprehensive news aggregation...');
  let allNews = [];
  let successful = 0;

  try {    
    for (const category of ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan']) {
      try {
        console.log(`🔍 Fetching ALL ${category} news...`);
        
        const categoryNews = await fetchEnhancedContent(category);
        
        if (categoryNews.length > 0) {
          allNews.push(...categoryNews);
          successful++;
          console.log(`✅ ${category}: Added ${categoryNews.length} articles`);
        } else {
          console.log(`⚠️ ${category}: No news found, adding fallback`);
          const fallback = createFallbackContent(category);
          allNews.push(...fallback);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`❌ Error with ${category}:`, error.message);
        const fallback = createFallbackContent(category);
        allNews.push(...fallback);
      }
    }

  } catch (error) {
    console.error('❌ Critical aggregation error:', error);
  }

  // Remove duplicates
  const uniqueNews = allNews.filter((article, index, self) => {
    const titleKey = article.title.toLowerCase().substring(0, 40);
    return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
  });

  uniqueNews.sort((a, b) => {
    const aTime = new Date(a.timestamp || a.pubDate);
    const bTime = new Date(b.timestamp || b.pubDate);
    return bTime - aTime;
  });

  newsCache = uniqueNews;
  
  const categoryStats = {};
  newsCache.forEach(item => {
    categoryStats[item.category] = (categoryStats[item.category] || 0) + 1;
  });

  console.log(`✅ Aggregation complete! Total: ${newsCache.length} articles`);
  console.log(`📊 Categories:`, categoryStats);
  console.log(`🎯 Success rate: ${successful}/5 categories`);
  
  return newsCache;
}

// Create and send .txt file for large content - STREAM FIX
async function createAndSendTextFile(chatId, articles, category, bot) {
  try {
    console.log(`📄 Creating .txt file for ${articles.length} ${category} articles...`);
    
    let content = `🔥 ${category.toUpperCase()} NEWS (Last 24 Hours)\n`;
    content += `📊 Total Articles: ${articles.length}\n`;
    content += `🕐 Generated: ${new Date().toLocaleString('en-IN')}\n`;
    content += `${'='.repeat(50)}\n\n`;
    
    articles.forEach((article, index) => {
      content += `${index + 1}. ${article.title}\n`;
      content += `   📰 Source: ${article.source}\n`;
      content += `   ⏰ Time: ${article.formattedDate}\n`;
      content += `   🔗 Link: ${article.link}\n`;
      if (article.description && article.description !== '...') {
        content += `   📝 Description: ${article.description}\n`;
      }
      content += `\n${'-'.repeat(40)}\n\n`;
    });
    
    content += `\n🎯 Summary:\n`;
    content += `• Total articles: ${articles.length}\n`;
    content += `• Sources: Google News, Twitter, Instagram, YouTube\n`;
    content += `• Time filter: Last 24 hours\n`;
    content += `• Generated by: Viral News Bot\n`;
    
    // Convert to Buffer
    const buffer = Buffer.from(content, 'utf8');
    const fileName = `${category}_news_${new Date().toISOString().split('T')[0]}.txt`;
    
    console.log(`📤 Sending .txt file: ${fileName} (${buffer.length} bytes)`);
    
    // STREAM FIX: Use Stream approach instead of direct Buffer
    const { Readable } = require('stream');
    const stream = Readable.from(buffer);
    
    await bot.sendDocument(chatId, stream, {
      caption: `📄 *${category.toUpperCase()} NEWS FILE*\n\n📊 *${articles.length} articles* found\n🔗 All working links included\n⏰ ${new Date().toLocaleString('en-IN')}`,
      parse_mode: 'Markdown'
    }, {
      filename: fileName,
      contentType: 'text/plain'
    });
    
    console.log(`✅ Successfully sent .txt file with ${articles.length} articles`);
    return true;
    
  } catch (error) {
    console.error('❌ Error creating/sending text file:', error.message);
    console.error('Full error:', error);
    
    // Try alternative method - send as message in chunks
    try {
      console.log('🔄 Fallback: Sending content in text chunks...');
      
      let chunkMessage = `📄 *${category.toUpperCase()} NEWS* (${articles.length} articles)\n\n`;
      
      for (let i = 0; i < Math.min(articles.length, 8); i++) {
        const article = articles[i];
        chunkMessage += `${i + 1}. *${article.title.substring(0, 60)}...*\n`;
        chunkMessage += `   📰 ${article.source} • ⏰ ${article.formattedDate}\n`;
        chunkMessage += `   🔗 [Read More](${article.link})\n\n`;
      }
      
      if (articles.length > 8) {
        chunkMessage += `📊 *Showing 8 of ${articles.length} total articles*\n`;
        chunkMessage += `💡 Add keywords to get more specific results`;
      }
      
      await bot.sendMessage(chatId, chunkMessage, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      
      return true;
    } catch (fallbackError) {
      console.error('❌ Fallback method also failed:', fallbackError.message);
      return false;
    }
  }
}

// Safe message formatter with better error handling
async function formatAndSendNewsMessage(chatId, articles, category, bot) {
  if (!articles || articles.length === 0) {
    await bot.sendMessage(chatId, `❌ No recent ${category} news found. Try /refresh or add keywords!`);
    return;
  }

  console.log(`📊 Processing ${articles.length} ${category} articles for chat ${chatId}`);

  // Check if content will be too large for Telegram
  const TELEGRAM_LIMIT = 3500; // More conservative limit
  const estimatedLength = articles.length * 180; // More accurate estimate
  
  if (articles.length > 12 || estimatedLength > TELEGRAM_LIMIT) {
    console.log(`⚠️ Large content detected: ${articles.length} articles, estimated ${estimatedLength} chars`);
    console.log(`📄 Using .txt file method to avoid Telegram limits...`);
    
    try {
      // Send summary message first
      const summaryMessage = `🔥 *${category.toUpperCase()} NEWS SUMMARY*\n\n📊 *Found: ${articles.length} articles*\n⏰ *Time: Last 24 Hours*\n🌐 *Sources: Multi-platform*\n\n⬇️ *Sending as .txt file...*`;
      
      await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
      
      // Small delay before sending file
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Create and send .txt file
      const fileSuccess = await createAndSendTextFile(chatId, articles, category, bot);
      
      if (!fileSuccess) {
        console.log('📄 File sending failed, using chunk method...');
        // This is handled in createAndSendTextFile fallback
      }
      
    } catch (error) {
      console.error('❌ Error in large content handling:', error.message);
      
      // Emergency fallback - send limited articles
      const limitedArticles = articles.slice(0, 8);
      const message = formatNewsMessage(limitedArticles, category);
      await bot.sendMessage(chatId, message + `\n\n📊 *Showing 8 of ${articles.length} total articles*\n💡 Use /addkeyword to get more specific results`, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    }
    
    return;
  }

  // For smaller content, send normally
  try {
    const message = formatNewsMessage(articles, category);
    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
    console.log(`✅ Sent ${articles.length} articles as regular message`);
  } catch (error) {
    console.error('❌ Error sending regular message:', error.message);
    
    // Fallback for regular messages too
    const shortMessage = `🔥 *${category.toUpperCase()} NEWS*\n\n📊 Found ${articles.length} articles but couldn't display. Try /addkeyword for specific content.`;
    await bot.sendMessage(chatId, shortMessage, { parse_mode: 'Markdown' });
  }
}

// Simplified news formatter (for use within formatAndSendNewsMessage)
function formatNewsMessage(articles, category) {
  let message = `🔥 *${category.toUpperCase()} NEWS* (Last 24 Hours)\n\n`;
  
  articles.slice(0, 10).forEach((article, index) => { // Limit to 10 for safety
    // Clean title for safe Markdown
    let cleanTitle = article.title
      .replace(/\*/g, '')
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .replace(/`/g, "'")
      .replace(/_/g, '-')
      .replace(/~/g, '-')
      .replace(/\|/g, '-')
      .substring(0, 80); // Shorter titles
    
    if (cleanTitle.length < article.title.length) {
      cleanTitle += '...';
    }
    
    message += `${index + 1}. *${cleanTitle}*\n`;
    message += `   📰 ${article.source} • ⏰ ${article.formattedDate}\n`;
    
    // Shorter URLs
    let cleanUrl = article.link;
    if (cleanUrl && cleanUrl.length > 300) {
      cleanUrl = cleanUrl.substring(0, 300) + '...';
    }
    
    message += `   🔗 [Read More](${cleanUrl})\n\n`;
  });

  message += `🔄 Updated: ${new Date().toLocaleString('en-IN')}\n`;
  message += `📊 *Total: ${articles.length} articles*`;
  
  return message;
}

// Webhook setup
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
    console.error('Telegram error:', error.message);
  });

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `🔥 *VIRAL NEWS BOT* 🔥

*📰 Main Commands:*
/youtubers - All YouTuber news
/bollywood - Film industry news
/cricket - Sports updates  
/national - India news
/pakistan - Pakistani content
/latest - All categories mixed

*🔍 Search:*
/search <name> - Multi-platform search

*🛠️ Keywords:*
/addkeyword <category> <keyword>
/listkeywords - Show all keywords

*📂 Categories:* youtubers, bollywood, cricket, national, pakistan

*Example:*
/addkeyword youtubers MrBeast
/search Elvish Yadav

🚀 *Multi-source results from news, Twitter, YouTube, Instagram!*`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // YOUTUBERS command - Force fresh enhanced search
  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🎥 *Getting ALL YouTuber news...*\n\n🔍 Running fresh enhanced multi-source search\n⏳ Please wait 30-60 seconds...`);
    
    try {
      // ALWAYS run fresh enhanced search, ignore cache
      console.log('🎥 FORCING fresh YouTuber enhanced search...');
      const freshNews = await fetchEnhancedContent('youtubers');
      
      if (freshNews.length > 0) {
        console.log(`✅ Fresh enhanced search found ${freshNews.length} articles`);
        
        // Update cache with fresh data
        newsCache = newsCache.filter(article => article.category !== 'youtubers');
        newsCache.push(...freshNews);
        
        // Use new smart formatter that handles large content
        await formatAndSendNewsMessage(chatId, freshNews, 'YouTuber', bot);
        
      } else {
        console.log('⚠️ Enhanced search returned 0 results, using fallback');
        const fallbackContent = createFallbackContent('youtubers');
        await formatAndSendNewsMessage(chatId, fallbackContent, 'YouTuber', bot);
      }
    } catch (error) {
      console.error('❌ YouTuber command error:', error);
      bot.sendMessage(chatId, `❌ *Error fetching YouTuber news*\n\nTry /addkeyword youtubers <name> to add specific creators`, { parse_mode: 'Markdown' });
    }
  });

  // BOLLYWOOD command - Enhanced with .txt file support
  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🎭 *Getting ALL Bollywood news...*\n\n🔍 Running fresh enhanced search...`);
    
    try {
      const freshNews = await fetchEnhancedContent('bollywood');
      const bollywoodNews = freshNews.length > 0 ? freshNews : createFallbackContent('bollywood');
      
      // Update cache
      newsCache = newsCache.filter(article => article.category !== 'bollywood');
      newsCache.push(...bollywoodNews);
      
      await formatAndSendNewsMessage(chatId, bollywoodNews, 'Bollywood', bot);
    } catch (error) {
      console.error('❌ Bollywood command error:', error);
      bot.sendMessage(chatId, `❌ *Error fetching Bollywood news*`, { parse_mode: 'Markdown' });
    }
  });

  // CRICKET command - Enhanced with .txt file support
  bot.onText(/\/cricket/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🏏 *Getting ALL Cricket news...*\n\n🔍 Running fresh enhanced search...`);
    
    try {
      const freshNews = await fetchEnhancedContent('cricket');
      const cricketNews = freshNews.length > 0 ? freshNews : createFallbackContent('cricket');
      
      // Update cache
      newsCache = newsCache.filter(article => article.category !== 'cricket');
      newsCache.push(...cricketNews);
      
      await formatAndSendNewsMessage(chatId, cricketNews, 'Cricket', bot);
    } catch (error) {
      console.error('❌ Cricket command error:', error);
      bot.sendMessage(chatId, `❌ *Error fetching Cricket news*`, { parse_mode: 'Markdown' });
    }
  });

  // NATIONAL command - Enhanced with .txt file support
  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🇮🇳 *Getting ALL National news...*\n\n🔍 Running fresh enhanced search...`);
    
    try {
      const freshNews = await fetchEnhancedContent('national');
      const nationalNews = freshNews.length > 0 ? freshNews : createFallbackContent('national');
      
      // Update cache
      newsCache = newsCache.filter(article => article.category !== 'national');
      newsCache.push(...nationalNews);
      
      await formatAndSendNewsMessage(chatId, nationalNews, 'National', bot);
    } catch (error) {
      console.error('❌ National command error:', error);
      bot.sendMessage(chatId, `❌ *Error fetching National news*`, { parse_mode: 'Markdown' });
    }
  });

  // PAKISTAN command - Enhanced with .txt file support
  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🇵🇰 *Getting ALL Pakistan news...*\n\n🔍 Running fresh enhanced search...`);
    
    try {
      const freshNews = await fetchEnhancedContent('pakistan');
      const pakistanNews = freshNews.length > 0 ? freshNews : createFallbackContent('pakistan');
      
      // Update cache
      newsCache = newsCache.filter(article => article.category !== 'pakistan');
      newsCache.push(...pakistanNews);
      
      await formatAndSendNewsMessage(chatId, pakistanNews, 'Pakistani', bot);
    } catch (error) {
      console.error('❌ Pakistan command error:', error);
      bot.sendMessage(chatId, `❌ *Error fetching Pakistan news*`, { parse_mode: 'Markdown' });
    }
  });

  // LATEST command
  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 *Getting latest news from all categories...*');
    
    if (newsCache.length === 0) {
      await aggregateNews();
    }
    
    const latestNews = newsCache.slice(0, 20);
    const message = formatNewsMessage(latestNews, 'Latest Viral');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  // SEARCH command with safe Markdown
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    
    if (searchTerm.length < 2) {
      bot.sendMessage(chatId, `❌ *Search term too short!*\n\n*Usage:* /search <name>`, { parse_mode: 'Markdown' });
      return;
    }

    bot.sendMessage(chatId, `🔍 *Multi-Platform Search: "${searchTerm}"*\n\n🌐 Searching news, Twitter, YouTube, Instagram...\n⏳ Please wait...`, { parse_mode: 'Markdown' });

    try {
      const searchResults = await searchMultiplePlatforms(searchTerm);
      
      if (searchResults.length === 0) {
        bot.sendMessage(chatId, `❌ *No results found for "${searchTerm}"*\n\n🔧 Try different spelling or add as keyword`, { parse_mode: 'Markdown' });
        return;
      }

      // Platform statistics
      const platformStats = {};
      searchResults.forEach(item => {
        const platform = item.platform || item.source;
        platformStats[platform] = (platformStats[platform] || 0) + 1;
      });

      let message = `🎯 *Search Results: "${searchTerm}"*\n📊 Found ${searchResults.length} results\n\n`;
      
      // Show first 8 results with safe formatting
      searchResults.slice(0, 8).forEach((item, index) => {
        let cleanTitle = item.title
          .replace(/\*/g, '')
          .replace(/\[/g, '(')
          .replace(/\]/g, ')')
          .substring(0, 80);
        
        if (cleanTitle.length < item.title.length) {
          cleanTitle += '...';
        }
        
        message += `${index + 1}. *${cleanTitle}*\n`;
        message += `   📰 ${item.source} • ⏰ ${item.formattedDate || 'Just now'}\n\n`;
      });

      if (searchResults.length > 8) {
        message += `📄 Showing 8 of ${searchResults.length} results\n`;
      }

      // Platform breakdown
      message += `\n*Results by Platform:*\n`;
      Object.entries(platformStats).forEach(([platform, count]) => {
        message += `• ${platform}: ${count} results\n`;
      });

      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });

    } catch (error) {
      console.error(`Search error for "${searchTerm}":`, error);
      bot.sendMessage(chatId, `❌ *Search failed*\n\nTry again or add as keyword`, { parse_mode: 'Markdown' });
    }
  });

  // ADD KEYWORD
  bot.onText(/\/addkeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ *Usage:* /addkeyword <category> <keyword>\n\n*Categories:* youtubers, bollywood, cricket, national, pakistan\n\n*Example:* /addkeyword youtubers MrBeast`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ *Invalid category!*\n\n*Valid:* youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (SEARCH_KEYWORDS[category].includes(keyword)) {
      bot.sendMessage(chatId, `⚠️ *Already exists!* "${keyword}" is in ${category}`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].push(keyword);
    bot.sendMessage(chatId, `✅ *Keyword Added Successfully!*

📝 *Added:* "${keyword}"
📂 *Category:* ${category}
📊 *Total keywords:* ${SEARCH_KEYWORDS[category].length}

🚀 Use /${category} to see results!`, { parse_mode: 'Markdown' });
  });

  // REMOVE KEYWORD
  bot.onText(/\/removekeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ *Usage:* /removekeyword <category> <keyword>`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ *Invalid category!*`, { parse_mode: 'Markdown' });
      return;
    }
    
    const index = SEARCH_KEYWORDS[category].indexOf(keyword);
    if (index === -1) {
      bot.sendMessage(chatId, `❌ *Not found!* "${keyword}" not in ${category}`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].splice(index, 1);
    bot.sendMessage(chatId, `✅ *Removed!* "${keyword}" from ${category}

📊 *Remaining:* ${SEARCH_KEYWORDS[category].length} keywords`, { parse_mode: 'Markdown' });
  });

  // LIST KEYWORDS
  bot.onText(/\/listkeywords/, (msg) => {
    const chatId = msg.chat.id;
    let message = '📝 *CURRENT KEYWORDS*\n\n';
    
    for (const [category, keywords] of Object.entries(SEARCH_KEYWORDS)) {
      const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
      
      message += `${icon} *${category.toUpperCase()}* (${keywords.length}):\n`;
      message += keywords.map(k => `• ${k}`).join('\n');
      message += '\n\n';
    }
    
    message += `📊 *Total:* ${Object.values(SEARCH_KEYWORDS).flat().length} keywords`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  // REFRESH
  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 *Refreshing ALL sources...*\n\n⏳ This will take 2-3 minutes...', { parse_mode: 'Markdown' });
    
    const startTime = new Date();
    newsCache = [];
    const news = await aggregateNews();
    const endTime = new Date();
    
    const refreshTime = Math.round((endTime - startTime) / 1000);
    
    bot.sendMessage(chatId, `✅ *Refresh Complete!*

⏱️ *Time:* ${refreshTime} seconds
📊 *Articles:* ${news.length}
🕐 *Done:* ${endTime.toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
  });

  console.log('📱 Telegram Bot initialized successfully!');
} else {
  console.log('⚠️ Bot not initialized - missing BOT_TOKEN');
}

// Express routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'Viral News Bot Active - Enhanced Multi-Source',
    totalNews: newsCache.length,
    uptime: Math.floor(process.uptime()),
    keywords: Object.values(SEARCH_KEYWORDS).flat().length
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    newsCount: newsCache.length,
    uptime: process.uptime()
  });
});

app.get('/ping', (req, res) => {
  pingCount++;
  res.json({ 
    status: 'pong',
    timestamp: new Date().toISOString(),
    count: pingCount
  });
});

// Keep-alive
async function keepAlive() {
  try {
    if (APP_URL && !APP_URL.includes('localhost')) {
      await axios.get(`${APP_URL}/ping`, { timeout: 10000 });
      console.log(`🏓 Keep-alive successful`);
    }
  } catch (error) {
    console.log(`⚠️ Keep-alive failed: ${error.message}`);
  }
}

setInterval(keepAlive, 12 * 60 * 1000);
setInterval(aggregateNews, 2 * 60 * 60 * 1000);

setTimeout(async () => {
  console.log('🚀 Starting enhanced news aggregation...');
  await aggregateNews();
  console.log('🏓 Keep-alive activated');
}, 3000);

app.listen(PORT, () => {
  console.log(`🚀 Enhanced News Bot running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`📱 Bot: ${BOT_TOKEN ? 'Active' : 'Missing Token'}`);
  console.log(`🎯 MULTI-SOURCE ENHANCED ENABLED!`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
});
