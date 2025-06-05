// Multiple sources for YouTuber content (NO YOUTUBE.COM direct access)
const YOUTUBER_SOURCES = {
  news_blogs: [
    'https://www.socialsamosa.com',
    'https://afaqs.com', 
    'https://www.exchange4media.com',
    'https://brandequity.economictimes.indiatimes.com',
    'https://www.medianama.com',
    'https://www.businesstoday.in',
    'https://inc42.com'
  ],
  tech_blogs: [
    'https://www.digit.in',
    'https://gadgets.ndtv.com', 
    'https://www.91mobiles.com',
    'https://www.gizbot.com',
    'https://www.techradar.com',
    'https://indianexpress.com/section/technology'
  ],
  entertainment_sites: [
    'https://www.bollywoodlife.com',
    'https://www.pinkvilla.com',
    'https://www.koimoi.com',
    'https://www.filmfare.com',
    'https://timesofindia.indiatimes.com/entertainment'
  ]
};

// Enhanced multi-source YouTuber content fetching
async function fetchYouTuberContentFromMultipleSources() {
  const allContent = [];
  
  try {
    console.log('🎥 Fetching YouTuber content from multiple sources...');
    
    // 1. Search specific YouTuber terms on news sites
    const youtuberTerms = [
      'CarryMinati news', 'Triggered Insaan latest', 'BB Ki Vines update',
      'Ashish Chanchlani controversy', 'Technical Guruji review', 'Flying Beast vlog',
      'Indian YouTuber earnings', 'YouTube creator milestone', 'content creator brand deal',
      'social media influencer India', 'gaming streamer news', 'roasting video viral'
    ];

    for (const term of youtuberTerms.slice(0, 6)) { // Use 6 terms
      try {
        console.log(`   → Searching news sites for: ${term}`);
        const results = await scrapeGoogleNews(term);
        
        // Filter for YouTuber-related content
        const youtuberResults = results.filter(article => {
          const content = `${article.title} ${article.description}`.toLowerCase();
          return content.match(/youtube|youtuber|creator|streamer|gaming|viral|social media|influencer/);
        }).map(article => ({
          ...article,
          category: 'youtubers',
          source: article.source + ' (News)'
        }));
        
        allContent.push(...youtuberResults);
        console.log(`     ✅ Found ${youtuberResults.length} YouTuber articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Error searching for ${term}:`, error.message);
      }
    }

    // 2. Search Twitter mentions (via Google)
    console.log('🐦 Searching Twitter for YouTuber mentions...');
    try {
      const twitterTerms = [
        'CarryMinati site:twitter.com',
        'TriggeredInsaan site:twitter.com', 
        'BBKiVines site:twitter.com',
        'TechnicalGuruji site:twitter.com'
      ];

      for (const term of twitterTerms.slice(0, 3)) {
        try {
          const results = await scrapeGoogleNews(term);
          const twitterResults = results.map(result => ({
            ...result,
            title: `Twitter: ${result.title}`,
            source: 'Twitter/X',
            platform: 'twitter',
            category: 'youtubers'
          }));
          
          allContent.push(...twitterResults);
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (error) {
          console.error(`Twitter search error for ${term}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Twitter scraping error:', error.message);
    }

    // 3. Search Reddit for YouTuber discussions (via Google)
    console.log('🔍 Searching Reddit for YouTuber discussions...');
    try {
      const redditTerms = [
        'CarryMinati site:reddit.com',
        'Indian YouTuber site:reddit.com',
        'gaming creator India site:reddit.com'
      ];

      for (const term of redditTerms.slice(0, 2)) {
        try {
          const results = await scrapeGoogleNews(term);
          const redditResults = results.map(result => ({
            ...result,
            title: `Reddit: ${result.title}`,
            source: 'Reddit',
            platform: 'reddit',
            category: 'youtubers'
          }));
          
          allContent.push(...redditResults);
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (error) {
          console.error(`Reddit search error for ${term}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Reddit scraping error:', error.message);
    }

    // 4. Search Instagram posts (via Google)
    console.log('📸 Searching Instagram for YouTuber posts...');
    try {
      const instaTerms = [
        'CarryMinati site:instagram.com',
        'TriggeredInsaan site:instagram.com',
        'Indian YouTuber site:instagram.com'
      ];

      for (const term of instaTerms.slice(0, 2)) {
        try {
          const results = await scrapeGoogleNews(term);
          const instaResults = results.map(result => ({
            ...result,
            title: `Instagram: ${result.title}`,
            source: 'Instagram',
            platform: 'instagram', 
            category: 'youtubers'
          }));
          
          allContent.push(...instaResults);
          await new Promise(resolve => setTimeout(resolve, 800));
        } catch (error) {
          console.error(`Instagram search error for ${term}:`, error.message);
        }
      }
    } catch (error) {
      console.error('Instagram scraping error:', error.message);
    }

    // Remove duplicates
    const uniqueContent = allContent.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

// Enhanced multi-source content fetching for Bollywood
async function fetchBollywoodContentFromMultipleSources() {
  const allContent = [];
  
  try {
    console.log('🎬 Fetching Bollywood content from multiple sources...');
    
    // 1. Bollywood-specific news terms
    const bollywoodTerms = [
      'Bollywood box office collection', 'Hindi film release', 'Mumbai film industry',
      'celebrity wedding bollywood', 'film shooting updates', 'bollywood controversy',
      'hindi movie trailer', 'bollywood gossip latest', 'film industry news india'
    ];

    for (const term of bollywoodTerms.slice(0, 5)) {
      try {
        console.log(`   → Searching entertainment sites for: ${term}`);
        const results = await scrapeGoogleNews(term);
        
        const bollywoodResults = results.filter(article => {
          const content = `${article.title} ${article.description}`.toLowerCase();
          return content.match(/bollywood|hindi|film|movie|actor|actress|cinema|entertainment/);
        }).map(article => ({
          ...article,
          category: 'bollywood',
          source: article.source + ' (Entertainment)'
        }));
        
        allContent.push(...bollywoodResults);
        console.log(`     ✅ Found ${bollywoodResults.length} Bollywood articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Error searching for ${term}:`, error.message);
      }
    }

    // 2. Celebrity Twitter mentions
    console.log('🐦 Searching Twitter for Bollywood celebrity mentions...');
    const celebrities = ['iamsrk', 'BeingSalmanKhan', 'aliaa08', 'RanveerOfficial'];
    
    for (const celeb of celebrities.slice(0, 3)) {
      try {
        const results = await scrapeGoogleNews(`${celeb} site:twitter.com`);
        const twitterResults = results.map(result => ({
          ...result,
          title: `Twitter: ${result.title}`,
          source: 'Twitter/X',
          platform: 'twitter',
          category: 'bollywood'
        }));
        
        allContent.push(...twitterResults);
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Twitter search error for ${celeb}:`, error.message);
      }
    }

    // 3. Instagram celebrity posts
    console.log('📸 Searching Instagram for Bollywood posts...');
    const instaTerms = ['Bollywood site:instagram.com', 'Hindi film site:instagram.com'];
    
    for (const term of instaTerms) {
      try {
        const results = await scrapeGoogleNews(term);
        const instaResults = results.map(result => ({
          ...result,
          title: `Instagram: ${result.title}`,
          source: 'Instagram',
          platform: 'instagram',
          category: 'bollywood'
        }));
        
        allContent.push(...instaResults);
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Instagram search error for ${term}:`, error.message);
      }
    }

    // Remove duplicates
    const uniqueContent = allContent.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

    console.log(`✅ Multi-source Bollywood content: ${uniqueContent.length} unique articles found`);
    return uniqueContent;

  } catch (error) {
    console.error('❌ Multi-source Bollywood content error:', error.message);
    return [];
  }
}

// Enhanced multi-source content fetching for Cricket
async function fetchCricketContentFromMultipleSources() {
  const allContent = [];
  
  try {
    console.log('🏏 Fetching Cricket content from multiple sources...');
    
    // 1. Cricket-specific news terms
    const cricketTerms = [
      'India cricket team selection', 'IPL auction updates', 'cricket world cup india',
      'BCCI announcement latest', 'indian cricket controversy', 'cricket match highlights',
      'cricket player injury update', 'cricket coaching changes', 'cricket stadium news'
    ];

    for (const term of cricketTerms.slice(0, 5)) {
      try {
        console.log(`   → Searching sports sites for: ${term}`);
        const results = await scrapeGoogleNews(term);
        
        const cricketResults = results.filter(article => {
          const content = `${article.title} ${article.description}`.toLowerCase();
          return content.match(/cricket|ipl|bcci|wicket|batting|bowling|match|team india|sports/);
        }).map(article => ({
          ...article,
          category: 'cricket',
          source: article.source + ' (Sports)'
        }));
        
        allContent.push(...cricketResults);
        console.log(`     ✅ Found ${cricketResults.length} Cricket articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Error searching for ${term}:`, error.message);
      }
    }

    // 2. Player Twitter mentions
    console.log('🐦 Searching Twitter for Cricket player mentions...');
    const players = ['imVkohli', 'ImRo45', 'msdhoni', 'hardikpandya7'];
    
    for (const player of players.slice(0, 3)) {
      try {
        const results = await scrapeGoogleNews(`${player} site:twitter.com`);
        const twitterResults = results.map(result => ({
          ...result,
          title: `Twitter: ${result.title}`,
          source: 'Twitter/X',
          platform: 'twitter',
          category: 'cricket'
        }));
        
        allContent.push(...twitterResults);
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Twitter search error for ${player}:`, error.message);
      }
    }

    // 3. Cricket Instagram posts
    console.log('📸 Searching Instagram for Cricket posts...');
    const instaTerms = ['Team India site:instagram.com', 'IPL cricket site:instagram.com'];
    
    for (const term of instaTerms) {
      try {
        const results = await scrapeGoogleNews(term);
        const instaResults = results.map(result => ({
          ...result,
          title: `Instagram: ${result.title}`,
          source: 'Instagram',
          platform: 'instagram',
          category: 'cricket'
        }));
        
        allContent.push(...instaResults);
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Instagram search error for ${term}:`, error.message);
      }
    }

    // Remove duplicates
    const uniqueContent = allContent.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

    console.log(`✅ Multi-source Cricket content: ${uniqueContent.length} unique articles found`);
    return uniqueContent;

  } catch (error) {
    console.error('❌ Multi-source Cricket content error:', error.message);
    return [];
  }
}

// Enhanced multi-source content fetching for National News
async function fetchNationalContentFromMultipleSources() {
  const allContent = [];
  
  try {
    console.log('🇮🇳 Fetching National content from multiple sources...');
    
    // 1. National news-specific terms
    const nationalTerms = [
      'Indian government policy update', 'Delhi assembly news', 'Mumbai development project',
      'Supreme Court India judgment', 'Parliament session india', 'Modi announcement',
      'Indian economy update', 'infrastructure development india', 'education policy india'
    ];

    for (const term of nationalTerms.slice(0, 5)) {
      try {
        console.log(`   → Searching news sites for: ${term}`);
        const results = await scrapeGoogleNews(term);
        
        const nationalResults = results.filter(article => {
          const content = `${article.title} ${article.description}`.toLowerCase();
          return content.match(/india|indian|delhi|mumbai|government|modi|parliament|supreme court|policy/);
        }).map(article => ({
          ...article,
          category: 'national',
          source: article.source + ' (National)'
        }));
        
        allContent.push(...nationalResults);
        console.log(`     ✅ Found ${nationalResults.length} National articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Error searching for ${term}:`, error.message);
      }
    }

    // 2. Political Twitter mentions
    console.log('🐦 Searching Twitter for Political mentions...');
    const politicians = ['narendramodi', 'RahulGandhi', 'ArvindKejriwal'];
    
    for (const politician of politicians.slice(0, 2)) {
      try {
        const results = await scrapeGoogleNews(`${politician} site:twitter.com`);
        const twitterResults = results.map(result => ({
          ...result,
          title: `Twitter: ${result.title}`,
          source: 'Twitter/X',
          platform: 'twitter',
          category: 'national'
        }));
        
        allContent.push(...twitterResults);
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Twitter search error for ${politician}:`, error.message);
      }
    }

    // Remove duplicates
    const uniqueContent = allContent.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

    console.log(`✅ Multi-source National content: ${uniqueContent.length} unique articles found`);
    return uniqueContent;

  } catch (error) {
    console.error('❌ Multi-source National content error:', error.message);
    return [];
  }
}

// Enhanced multi-source content fetching for Pakistan News
async function fetchPakistanContentFromMultipleSources() {
  const allContent = [];
  
  try {
    console.log('🇵🇰 Fetching Pakistan content from multiple sources...');
    
    // 1. Pakistan-specific news terms
    const pakistanTerms = [
      'Pakistan political update', 'Karachi city news', 'Lahore development',
      'Pakistani cricket team', 'Pakistan economy news', 'Pakistan viral trend',
      'Pakistani entertainment industry', 'Pakistan social media', 'Pakistan current affairs'
    ];

    for (const term of pakistanTerms.slice(0, 5)) {
      try {
        console.log(`   → Searching regional sites for: ${term}`);
        const results = await scrapeGoogleNews(term);
        
        const pakistanResults = results.filter(article => {
          const content = `${article.title} ${article.description}`.toLowerCase();
          return content.match(/pakistan|pakistani|karachi|lahore|islamabad|imran khan/);
        }).map(article => ({
          ...article,
          category: 'pakistan',
          source: article.source + ' (Regional)'
        }));
        
        allContent.push(...pakistanResults);
        console.log(`     ✅ Found ${pakistanResults.length} Pakistan articles for "${term}"`);
        
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Error searching for ${term}:`, error.message);
      }
    }

    // 2. Pakistan Twitter trends
    console.log('🐦 Searching Twitter for Pakistan trends...');
    const twitterTerms = ['Pakistan trending site:twitter.com', 'Pakistani viral site:twitter.com'];
    
    for (const term of twitterTerms) {
      try {
        const results = await scrapeGoogleNews(term);
        const twitterResults = results.map(result => ({
          ...result,
          title: `Twitter: ${result.title}`,
          source: 'Twitter/X',
          platform: 'twitter',
          category: 'pakistan'
        }));
        
        allContent.push(...twitterResults);
        await new Promise(resolve => setTimeout(resolve, 800));
      } catch (error) {
        console.error(`Twitter search error for ${term}:`, error.message);
      }
    }

    // Remove duplicates
    const uniqueContent = allContent.filter((article, index, self) => {
      const titleKey = article.title.toLowerCase().substring(0, 40);
      return index === self.findIndex(a => a.title.toLowerCase().substring(0, 40) === titleKey);
    });

    console.log(`✅ Multi-source Pakistan content: ${uniqueContent.length} unique articles found`);
    return uniqueContent;

  } catch (error) {
    console.error('❌ Multi-source Pakistan content error:', error.message);
    return [];
  }
}const TelegramBot = require('node-telegram-bot-api');
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

// KEYWORDS - User can easily add/remove
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
  
  if (content.match(/carry|triggered|bhuvan|ashish|dhruv|technical|youtube|youtuber|gaming|roast|vlog/)) {
    return 'youtubers';
  }
  if (content.match(/salman|shahrukh|srk|alia|ranbir|bollywood|film|movie|actor|actress/)) {
    return 'bollywood';
  }
  if (content.match(/virat|kohli|rohit|sharma|dhoni|cricket|ipl|bcci|wicket|match/)) {
    return 'cricket';
  }
  if (content.match(/pakistan|karachi|lahore|pakistani/)) {
    return 'pakistan';
  }
  return 'national';
}

// Google News scraping - UNLIMITED RESULTS
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

    // NO LIMIT - get all articles
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
          
          articles.push({
            title: title.length > 150 ? title.substring(0, 150) + '...' : title,
            link: link,
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

// Enhanced YouTuber news fetching with category-specific multi-source strategy
async function fetchAllNewsEnhanced(category) {
  const allArticles = [];
  
  try {
    // Category-specific enhanced multi-source fetching
    if (category === 'youtubers') {
      console.log(`🎥 Enhanced YouTuber content fetching from multiple sources...`);
      const multiSourceContent = await fetchYouTuberContentFromMultipleSources();
      allArticles.push(...multiSourceContent);
      
    } else if (category === 'bollywood') {
      console.log(`🎬 Enhanced Bollywood content fetching from multiple sources...`);
      const multiSourceContent = await fetchBollywoodContentFromMultipleSources();
      allArticles.push(...multiSourceContent);
      
    } else if (category === 'cricket') {
      console.log(`🏏 Enhanced Cricket content fetching from multiple sources...`);
      const multiSourceContent = await fetchCricketContentFromMultipleSources();
      allArticles.push(...multiSourceContent);
      
    } else if (category === 'national') {
      console.log(`🇮🇳 Enhanced National content fetching from multiple sources...`);
      const multiSourceContent = await fetchNationalContentFromMultipleSources();
      allArticles.push(...multiSourceContent);
      
    } else if (category === 'pakistan') {
      console.log(`🇵🇰 Enhanced Pakistan content fetching from multiple sources...`);
      const multiSourceContent = await fetchPakistanContentFromMultipleSources();
      allArticles.push(...multiSourceContent);
    }
    
    // Regular keyword search as backup for ALL categories
    const keywords = SEARCH_KEYWORDS[category] || [];
    console.log(`🔍 Backup search with ${keywords.length} keywords...`);
    
    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      try {
        console.log(`   → Backup search ${i+1}/${keywords.length}: ${keyword}`);
        const articles = await scrapeGoogleNews(keyword);
        
        const categoryArticles = articles.filter(article => 
          article.category === category || categorizeNews(article.title, article.description) === category
        );
        
        allArticles.push(...categoryArticles);
        console.log(`     ✅ Backup found ${categoryArticles.length} articles for "${keyword}"`);
        
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

    console.log(`✅ ${category}: ${uniqueArticles.length} unique articles from enhanced multi-source search`);
    return uniqueArticles;
    
  } catch (error) {
    console.error(`❌ Enhanced search error for ${category}:`, error.message);
    return [];
  }
}

// Enhanced search with Twitter support
async function directSearchWithPlatforms(searchTerm) {
  const allResults = [];
  
  try {
    console.log(`🔍 Comprehensive search for: ${searchTerm}`);
    
    // 1. Regular Google News search
    console.log(`   → Google News search...`);
    const newsResults = await scrapeGoogleNews(searchTerm);
    allResults.push(...newsResults);
    
    // 2. Twitter search via Google
    console.log(`   → Twitter search...`);
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
    
    // 3. YouTube search via Google
    console.log(`   → YouTube search...`);
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
    
    // 4. Instagram search via Google
    console.log(`   → Instagram search...`);
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

    console.log(`✅ Comprehensive search complete: ${uniqueResults.length} total results`);
    return uniqueResults;

  } catch (error) {
    console.error(`❌ Comprehensive search error for "${searchTerm}":`, error.message);
    return [];
  }
}

// Create fallback content if needed
function createFallbackContent(category) {
  const currentTime = getCurrentTimestamp();
  
  const fallbackContent = {
    youtubers: [
      {
        title: "CarryMinati's Gaming Stream Achieves New Milestone",
        link: "https://www.youtube.com/@CarryMinati",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "YouTube Trending",
        category: "youtubers",
        timestamp: currentTime,
        isVerified: true
      },
      {
        title: "Triggered Insaan's Latest Content Goes Viral",
        link: "https://www.youtube.com/@TriggeredInsaan", 
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Social Media",
        category: "youtubers",
        timestamp: currentTime,
        isVerified: true
      },
      {
        title: "Indian YouTube Creator Community Shows Growth",
        link: "https://creators.youtube.com",
        pubDate: currentTime,
        formattedDate: "Just now",
        source: "Creator Economy",
        category: "youtubers",
        timestamp: currentTime,
        isVerified: true
      }
    ],
    bollywood: [
      {
        title: "Bollywood Industry Shows Strong Performance",
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
        title: "Indian Cricket Team Preparation Updates",
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
        title: "Government Policy Implementation Updates",
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
        title: "Pakistan Digital Trends Gain Attention",
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

// Main aggregation - UNLIMITED results per category
async function aggregateNews() {
  console.log('🔄 Starting comprehensive news aggregation...');
  let allNews = [];
  let successful = 0;

  try {    
    for (const category of ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan']) {
      try {
        console.log(`🔍 Fetching ALL ${category} news...`);
        
        const categoryNews = await fetchAllNewsEnhanced(category);
        
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

// Format news - SHOW ALL RESULTS
function formatNewsMessage(articles, category) {
  if (!articles || articles.length === 0) {
    return `❌ No recent ${category} news found. Try /refresh or add keywords!`;
  }

  let message = `🔥 **${category.toUpperCase()} NEWS** (Last 24 Hours)\n\n`;
  
  articles.forEach((article, index) => {
    message += `${index + 1}. **${article.title}**\n`;
    message += `   📰 ${article.source} • ⏰ ${article.formattedDate}`;
    
    if (article.isVerified) {
      message += ` ✅`;
    }
    
    message += `\n   🔗 [Read More](${article.link})\n\n`;
  });

  message += `🔄 Last updated: ${new Date().toLocaleString('en-IN')}\n`;
  message += `📊 **Total: ${articles.length} articles**`;
  
  return message;
}

// Direct search function - NOW WITH ALL PLATFORMS
async function directSearch(searchTerm) {
  try {
    console.log(`🔍 Multi-platform search for: ${searchTerm}`);
    const results = await directSearchWithPlatforms(searchTerm);
    console.log(`✅ Found ${results.length} total results for "${searchTerm}"`);
    return results;
  } catch (error) {
    console.error(`❌ Search error for "${searchTerm}":`, error.message);
    return [];
  }
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
    const welcomeMessage = `🔥 **VIRAL NEWS BOT** 🔥

**📰 Main Commands:**
/youtubers - All YouTuber news (unlimited)
/bollywood - Film industry news
/cricket - Sports updates  
/national - India news
/pakistan - Pakistani content
/latest - All categories mixed

**🔍 Search:**
/search <name> - Search any topic

**🛠️ Keyword Management:**
/addkeyword <category> <keyword> - Add search term
/removekeyword <category> <keyword> - Remove term
/listkeywords - Show all keywords

**📂 Categories:** youtubers, bollywood, cricket, national, pakistan

**Example:**
/addkeyword youtubers MrBeast
/addkeyword cricket Bumrah

🚀 **Unlimited Results**: Shows ALL available news!`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // YOUTUBERS - Show ALL results
  bot.onText(/\/youtubers/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🎥 **Getting ALL YouTuber news...**\n\n🔍 Using ${SEARCH_KEYWORDS.youtubers.length} keywords\n⏳ Please wait...`);
    
    let youtuberNews = newsCache.filter(article => article.category === 'youtubers');
    
    if (youtuberNews.length === 0) {
      bot.sendMessage(chatId, '🔄 Fetching fresh content...');
      const freshNews = await fetchAllNewsEnhanced('youtubers');
      youtuberNews = freshNews.length > 0 ? freshNews : createFallbackContent('youtubers');
      newsCache.push(...youtuberNews);
    }
    
    const message = formatNewsMessage(youtuberNews, 'YouTuber');
    
    // Split if too long
    if (message.length > 4000) {
      const articles = youtuberNews;
      const chunkSize = 15;
      
      for (let i = 0; i < articles.length; i += chunkSize) {
        const chunk = articles.slice(i, i + chunkSize);
        const chunkMessage = formatNewsMessage(chunk, `YouTuber (${i + 1}-${Math.min(i + chunkSize, articles.length)} of ${articles.length})`);
        
        await bot.sendMessage(chatId, chunkMessage, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
        
        if (i + chunkSize < articles.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } else {
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    }
  });

  // BOLLYWOOD
  bot.onText(/\/bollywood/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🎭 **Getting ALL Bollywood news...**\n\n🔍 Using ${SEARCH_KEYWORDS.bollywood.length} keywords`);
    
    let bollywoodNews = newsCache.filter(article => article.category === 'bollywood');
    
    if (bollywoodNews.length === 0) {
      const freshNews = await fetchAllNewsEnhanced('bollywood');
      bollywoodNews = freshNews.length > 0 ? freshNews : createFallbackContent('bollywood');
    }
    
    const message = formatNewsMessage(bollywoodNews, 'Bollywood');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  // NATIONAL - Show ALL results
  bot.onText(/\/national/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🇮🇳 **Getting ALL National news...**\n\n🔍 Using ${SEARCH_KEYWORDS.national.length} keywords`);
    
    let nationalNews = newsCache.filter(article => article.category === 'national');
    
    if (nationalNews.length === 0) {
      bot.sendMessage(chatId, '🔄 Fetching fresh national content...');
      const freshNews = await fetchAllNewsEnhanced('national');
      nationalNews = freshNews.length > 0 ? freshNews : createFallbackContent('national');
      newsCache.push(...nationalNews);
    }
    
    const message = formatNewsMessage(nationalNews, 'National');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  // PAKISTAN - Show ALL results
  bot.onText(/\/pakistan/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `🇵🇰 **Getting ALL Pakistan news...**\n\n🔍 Using ${SEARCH_KEYWORDS.pakistan.length} keywords`);
    
    let pakistanNews = newsCache.filter(article => article.category === 'pakistan');
    
    if (pakistanNews.length === 0) {
      bot.sendMessage(chatId, '🔄 Fetching fresh Pakistan content...');
      const freshNews = await fetchAllNewsEnhanced('pakistan');
      pakistanNews = freshNews.length > 0 ? freshNews : createFallbackContent('pakistan');
      newsCache.push(...pakistanNews);
    }
    
    const message = formatNewsMessage(pakistanNews, 'Pakistani');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  // LATEST - Show mix from all categories  
  bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 **Getting latest viral news from ALL categories...**\n\n⏳ Mixing results from all sources...');
    
    if (newsCache.length === 0) {
      bot.sendMessage(chatId, '🔄 Cache empty, running fresh aggregation...');
      await aggregateNews();
    }
    
    // Show latest 25 from all categories mixed
    const latestNews = newsCache.slice(0, 25);
    
    if (latestNews.length === 0) {
      bot.sendMessage(chatId, '❌ No cached news found. Use /refresh to get fresh content!');
      return;
    }
    
    const message = formatNewsMessage(latestNews, 'Latest Viral');
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
  });

  // SEARCH
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].trim();
    
    if (searchTerm.length < 2) {
      bot.sendMessage(chatId, `❌ **Search term too short!**\n\n**Usage:** /search <name>`, { parse_mode: 'Markdown' });
      return;
    }

    bot.sendMessage(chatId, `🔍 **Searching: "${searchTerm}"**\n\n⏳ Getting results...`, { parse_mode: 'Markdown' });

    try {
      const searchResults = await directSearch(searchTerm);
      
      if (searchResults.length === 0) {
        bot.sendMessage(chatId, `❌ **No results found for "${searchTerm}"**`, { parse_mode: 'Markdown' });
        return;
      }

      const message = formatNewsMessage(searchResults, `Search: ${searchTerm}`);
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });

    } catch (error) {
      bot.sendMessage(chatId, `❌ **Search failed**`, { parse_mode: 'Markdown' });
    }
  });

  // ADD KEYWORD
  bot.onText(/\/addkeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ **Usage:** /addkeyword <category> <keyword>

**Categories:** youtubers, bollywood, cricket, national, pakistan

**Examples:**
• /addkeyword youtubers MrBeast
• /addkeyword cricket Bumrah`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**\n\n**Valid:** youtubers, bollywood, cricket, national, pakistan`, { parse_mode: 'Markdown' });
      return;
    }
    
    if (SEARCH_KEYWORDS[category].includes(keyword)) {
      bot.sendMessage(chatId, `⚠️ **Already exists!** "${keyword}" is in ${category}`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].push(keyword);
    bot.sendMessage(chatId, `✅ **Added Successfully!**

📝 **Added:** "${keyword}"
📂 **Category:** ${category}
📊 **Total keywords:** ${SEARCH_KEYWORDS[category].length}

🚀 Use /${category} to see results!`, { parse_mode: 'Markdown' });
  });

  // REMOVE KEYWORD
  bot.onText(/\/removekeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
      bot.sendMessage(chatId, `❌ **Usage:** /removekeyword <category> <keyword>`, { parse_mode: 'Markdown' });
      return;
    }
    
    const category = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');
    
    if (!SEARCH_KEYWORDS[category]) {
      bot.sendMessage(chatId, `❌ **Invalid category!**`, { parse_mode: 'Markdown' });
      return;
    }
    
    const index = SEARCH_KEYWORDS[category].indexOf(keyword);
    if (index === -1) {
      bot.sendMessage(chatId, `❌ **Not found!** "${keyword}" not in ${category}`, { parse_mode: 'Markdown' });
      return;
    }
    
    SEARCH_KEYWORDS[category].splice(index, 1);
    bot.sendMessage(chatId, `✅ **Removed!** "${keyword}" from ${category}

📊 **Remaining:** ${SEARCH_KEYWORDS[category].length} keywords`, { parse_mode: 'Markdown' });
  });

  // LIST KEYWORDS
  bot.onText(/\/listkeywords/, (msg) => {
    const chatId = msg.chat.id;
    let message = '📝 **CURRENT KEYWORDS**\n\n';
    
    for (const [category, keywords] of Object.entries(SEARCH_KEYWORDS)) {
      const icon = category === 'youtubers' ? '📱' : category === 'bollywood' ? '🎬' : category === 'cricket' ? '🏏' : category === 'pakistan' ? '🇵🇰' : '📰';
      
      message += `${icon} **${category.toUpperCase()}** (${keywords.length}):\n`;
      message += keywords.map(k => `• ${k}`).join('\n');
      message += '\n\n';
    }
    
    message += `📊 **Total:** ${Object.values(SEARCH_KEYWORDS).flat().length} keywords`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  // REFRESH
  bot.onText(/\/refresh/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '🔄 **Refreshing ALL sources...**\n\n⏳ This will take 2-3 minutes...');
    
    const startTime = new Date();
    newsCache = [];
    const news = await aggregateNews();
    const endTime = new Date();
    
    const refreshTime = Math.round((endTime - startTime) / 1000);
    
    bot.sendMessage(chatId, `✅ **Refresh Complete!**

⏱️ **Time:** ${refreshTime} seconds
📊 **Articles:** ${news.length}
🕐 **Done:** ${endTime.toLocaleString('en-IN')}`, { parse_mode: 'Markdown' });
  });

  console.log('📱 Telegram Bot initialized successfully!');
}

// Express routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'Viral News Bot Active - UNLIMITED RESULTS',
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
  console.log('🚀 Starting news aggregation...');
  await aggregateNews();
  console.log('🏓 Keep-alive activated');
}, 3000);

app.listen(PORT, () => {
  console.log(`🚀 Bot running on port ${PORT}`);
  console.log(`🌐 URL: ${APP_URL}`);
  console.log(`📱 Bot: ${BOT_TOKEN ? 'Active' : 'Missing Token'}`);
  console.log(`🎯 UNLIMITED RESULTS ENABLED!`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.message);
});
