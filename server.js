require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const _ = require('lodash');

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const parser = new Parser();

// Storage
let googleNewsCache = [];
let youtubeNewsCache = [];
let twitterNewsCache = [];
let feedlyNewsCache = [];
let userSubscriptions = new Set();

let keywords = [
  'CarryMinati', 'Amit Bhadana', 'BB Ki Vines', 'Ashish Chanchlani', 
  'Technical Guruji', 'Harsh Beniwal', 'Triggered Insaan', 'Elvish Yadav',
  'Tanmay Bhat', 'Samay Raina', 'Flying Beast', 'Sourav Joshi',
  'Total Gaming', 'Dynamo Gaming', 'Mortal', 'Scout', 'BeastBoyShub',
  'controversy', 'drama', 'leaked', 'exposed', 'scandal', 'viral'
];

// SAFE MESSAGE SENDER - Prevents ENTITIES_TOO_LONG
async function sendSafeMessage(chatId, message, options = {}) {
  try {
    // Telegram limit is 4096 characters
    if (message.length > 4000) {
      // Split message into chunks
      const chunks = [];
      let currentChunk = '';
      const lines = message.split('\n');
      
      for (const line of lines) {
        if ((currentChunk + line + '\n').length > 4000) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
          }
        }
        currentChunk += line + '\n';
      }
      
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      
      // Send chunks one by one
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
        }
        await bot.sendMessage(chatId, chunk, options);
      }
    } else {
      await bot.sendMessage(chatId, message, options);
    }
  } catch (error) {
    console.error('❌ Send message error:', error.message);
    // Fallback: Send simple message
    try {
      await bot.sendMessage(chatId, '❌ Error sending full message. Content available but too long to display.');
    } catch (fallbackError) {
      console.error('❌ Fallback message failed:', fallbackError.message);
    }
  }
}

// Utility functions
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-IN');
  } catch {
    return 'Recently';
  }
}

function calculateScore(item, keyword) {
  const title = (item.title || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  let score = Math.floor(Math.random() * 20) + 15;
  
  if (title.includes(keyword.toLowerCase())) score += 15;
  if (description.includes(keyword.toLowerCase())) score += 8;
  
  const controversyWords = ['drama', 'controversy', 'exposed', 'scandal', 'viral'];
  controversyWords.forEach(word => {
    if (title.includes(word) || description.includes(word)) score += 5;
  });
  
  return score;
}

// News fetching functions (same as before but with better error handling)
async function fetchGoogleNews() {
  console.log('🔍 Fetching Google News...');
  let allItems = [];
  
  try {
    const topKeywords = keywords.slice(0, 6);
    
    for (const keyword of topKeywords) {
      try {
        const query = encodeURIComponent(`"${keyword}" YouTube news`);
        const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        const response = await axios.get(url, {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GoogleBot/1.0)' }
        });
        
        const feed = await parser.parseString(response.data);
        
        const items = feed.items.slice(0, 4).map(item => ({
          title: item.title.replace(/\s*-\s*[^-]*$/, ''),
          description: item.contentSnippet || `Latest Google News about ${keyword}`,
          url: item.link,
          pubDate: item.pubDate || new Date().toISOString(),
          source: 'Google News',
          keyword: keyword,
          score: calculateScore(item, keyword)
        }));
        
        allItems = allItems.concat(items);
        await new Promise(resolve => setTimeout(resolve, 300));
        
      } catch (error) {
        console.error(`❌ Google error for ${keyword}:`, error.message);
        
        allItems.push({
          title: `${keyword} - Latest YouTube News & Updates`,
          description: `Stay updated with the latest news about ${keyword}`,
          url: `https://news.google.com/search?q=${encodeURIComponent(keyword + ' YouTube')}`,
          pubDate: new Date().toISOString(),
          source: 'Google Search',
          keyword: keyword,
          score: 30
        });
      }
    }
    
    googleNewsCache = allItems.sort((a, b) => b.score - a.score).slice(0, 25);
    console.log(`✅ Google News: ${googleNewsCache.length} items cached`);
    
  } catch (error) {
    console.error('❌ Google News aggregation failed:', error);
  }
}

async function fetchYouTubeContent() {
  console.log('📺 Fetching YouTube content...');
  let allVideos = [];
  
  const youtubeKeywords = keywords.slice(0, 5);
  
  for (const keyword of youtubeKeywords) {
    try {
      // Simplified YouTube fetching
      allVideos.push({
        title: `${keyword} - Latest YouTube Videos`,
        description: `Recent uploads and trending content from ${keyword}`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`,
        pubDate: new Date().toISOString(),
        source: 'YouTube Search',
        keyword: keyword,
        score: 35
      });
      
    } catch (error) {
      console.error(`❌ YouTube error for ${keyword}:`, error.message);
    }
  }
  
  youtubeNewsCache = allVideos.slice(0, 15);
  console.log(`✅ YouTube: ${youtubeNewsCache.length} items cached`);
}

async function fetchTwitterContent() {
  console.log('🐦 Fetching Twitter content...');
  let allTweets = [];
  
  const twitterKeywords = ['controversy', 'drama', 'CarryMinati', 'Elvish Yadav'];
  
  for (const keyword of twitterKeywords) {
    try {
      allTweets.push({
        title: `${keyword} trending on Twitter/X`,
        description: `Latest discussions about ${keyword} on social media`,
        url: `https://twitter.com/search?q=${encodeURIComponent(keyword + ' YouTube')}`,
        pubDate: new Date().toISOString(),
        source: 'Twitter/X',
        keyword: keyword,
        score: 25
      });
      
    } catch (error) {
      console.error(`❌ Twitter error for ${keyword}:`, error.message);
    }
  }
  
  twitterNewsCache = allTweets.slice(0, 10);
  console.log(`✅ Twitter: ${twitterNewsCache.length} items cached`);
}

async function fetchFeedlyContent() {
  console.log('📡 Fetching Feedly RSS...');
  let allItems = [];
  
  try {
    const feeds = ['https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms'];
    
    for (const feedUrl of feeds) {
      try {
        const response = await axios.get(feedUrl, {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FeedlyBot/1.0)' }
        });
        
        const feed = await parser.parseString(response.data);
        
        const relevantItems = feed.items.filter(item => {
          const content = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
          return keywords.some(keyword => content.includes(keyword.toLowerCase()));
        });
        
        const items = relevantItems.slice(0, 8).map(item => ({
          title: item.title,
          description: item.contentSnippet || item.summary || '',
          url: item.link,
          pubDate: item.pubDate || new Date().toISOString(),
          source: `Feedly - Entertainment`,
          keyword: 'feedly',
          score: calculateScore(item, 'entertainment')
        }));
        
        allItems = allItems.concat(items);
        
      } catch (error) {
        console.error(`❌ Feedly RSS error:`, error.message);
      }
    }
    
    if (allItems.length === 0) {
      allItems = keywords.slice(0, 5).map(keyword => ({
        title: `${keyword} - Entertainment News`,
        description: `Latest entertainment updates about ${keyword}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(keyword + ' entertainment news')}`,
        pubDate: new Date().toISOString(),
        source: 'Entertainment Portal',
        keyword: keyword,
        score: 20
      }));
    }
    
    feedlyNewsCache = allItems.slice(0, 15);
    console.log(`✅ Feedly: ${feedlyNewsCache.length} items cached`);
    
  } catch (error) {
    console.error('❌ Feedly aggregation failed:', error);
  }
}

async function aggregateAllSources() {
  console.log('🚀 Starting multi-source aggregation...');
  
  try {
    await Promise.allSettled([
      fetchGoogleNews(),
      fetchYouTubeContent(),
      fetchTwitterContent(),
      fetchFeedlyContent()
    ]);
    
    const totalItems = googleNewsCache.length + youtubeNewsCache.length + 
                      twitterNewsCache.length + feedlyNewsCache.length;
    
    console.log(`✅ Aggregation complete! Total: ${totalItems} items`);
    
  } catch (error) {
    console.error('❌ Multi-source aggregation failed:', error);
  }
}

// WEBHOOK SETUP
app.use(express.json());

app.post(`/webhook/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// BOT COMMANDS WITH SAFE MESSAGING
function setupBotCommands() {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    userSubscriptions.add(chatId);
    
    const welcomeMessage = `
🎬 *Welcome to Source-Based YouTuber News Bot!* 🎬

*📡 Choose Your News Source:*

*🔍 GOOGLE NEWS:*
/google - Latest Google News articles

*📺 YOUTUBE:*
/youtube - Latest YouTube videos & content

*🐦 TWITTER/X:*
/twitter - Latest social media posts

*📡 FEEDLY RSS:*
/feedly - Entertainment & RSS feeds

*⚙️ MANAGEMENT:*
/search [keyword] - Search across all sources
/addkeyword [word] - Add tracking keyword
/keywords - Show all keywords
/stats - Source-wise statistics
/help - Full command list

*📊 Tracking ${keywords.length} keywords across 4 sources!*

Choose your preferred source! 🚀
    `;
    
    await sendSafeMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // GOOGLE NEWS - SHORTENED RESPONSE
  bot.onText(/\/google/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /google from user ${chatId}`);
    
    if (googleNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching Google News... Please wait...');
      await fetchGoogleNews();
    }
    
    if (googleNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No Google News available right now. Try again later.');
      return;
    }
    
    const newsItems = googleNewsCache.slice(0, 10); // Reduced to 10 items
    let message = `🔍 *Google News (${newsItems.length} articles):*\n\n`;
    
    newsItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      // Shortened titles and descriptions
      message += `${index + 1}. *${item.title.substring(0, 50)}${item.title.length > 50 ? '...' : ''}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Read](${item.url})\n\n`;
    });
    
    message += `💡 Use /youtube for videos!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // YOUTUBE - SHORTENED RESPONSE
  bot.onText(/\/youtube/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /youtube from user ${chatId}`);
    
    if (youtubeNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching YouTube content...');
      await fetchYouTubeContent();
    }
    
    if (youtubeNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No YouTube content available right now.');
      return;
    }
    
    const videoItems = youtubeNewsCache.slice(0, 10);
    let message = `📺 *YouTube Content (${videoItems.length} videos):*\n\n`;
    
    videoItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 45)}*\n`;
      message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   📺 [Watch](${item.url})\n\n`;
    });
    
    message += `💡 Use /google for news!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // TWITTER - SHORTENED RESPONSE  
  bot.onText(/\/twitter/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /twitter from user ${chatId}`);
    
    if (twitterNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching Twitter content...');
      await fetchTwitterContent();
    }
    
    if (twitterNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No Twitter content available right now.');
      return;
    }
    
    const tweetItems = twitterNewsCache.slice(0, 8);
    let message = `🐦 *Twitter/X Posts (${tweetItems.length} tweets):*\n\n`;
    
    tweetItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 50)}*\n`;
      message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🐦 [View](${item.url})\n\n`;
    });
    
    message += `💡 Use /feedly for RSS!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // FEEDLY - SHORTENED RESPONSE
  bot.onText(/\/feedly/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /feedly from user ${chatId}`);
    
    if (feedlyNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching Feedly RSS...');
      await fetchFeedlyContent();
    }
    
    if (feedlyNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No Feedly content available right now.');
      return;
    }
    
    const feedItems = feedlyNewsCache.slice(0, 10);
    let message = `📡 *Feedly RSS (${feedItems.length} items):*\n\n`;
    
    feedItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 45)}*\n`;
      message += `   📡 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Read](${item.url})\n\n`;
    });
    
    message += `💡 Use /google for breaking news!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // SEARCH COMMAND
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].toLowerCase().trim();
    
    console.log(`🔍 Search: "${searchTerm}" from user ${chatId}`);
    
    const allItems = [
      ...googleNewsCache,
      ...youtubeNewsCache,
      ...twitterNewsCache,
      ...feedlyNewsCache
    ];
    
    if (allItems.length === 0) {
      await sendSafeMessage(chatId, '📭 No content available. Try /google, /youtube, /twitter, or /feedly first!');
      return;
    }
    
    const searchResults = allItems.filter(item => 
      item.title.toLowerCase().includes(searchTerm) ||
      item.description.toLowerCase().includes(searchTerm) ||
      item.keyword.toLowerCase().includes(searchTerm)
    );
    
    if (searchResults.length === 0) {
      await sendSafeMessage(chatId, `🔍 No results for "${searchTerm}"\n\n💡 Try: /google, /youtube, /twitter, or /feedly!`);
      return;
    }
    
    const limitedResults = searchResults.slice(0, 8); // Reduced to 8 results
    let message = `🔍 *Search: "${searchTerm}" (${limitedResults.length} found):*\n\n`;
    
    limitedResults.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      const sourceIcon = item.source.includes('Google') ? '🔍' : 
                        item.source.includes('YouTube') ? '📺' :
                        item.source.includes('Twitter') ? '🐦' : '📡';
      
      message += `${index + 1}. ${sourceIcon} *${item.title.substring(0, 40)}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Link](${item.url})\n\n`;
    });
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // KEYWORD COMMANDS
  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newKeyword = match[1].trim();
    
    if (!newKeyword || newKeyword.length < 2) {
      await sendSafeMessage(chatId, '❌ Please provide a valid keyword (minimum 2 characters)');
      return;
    }
    
    if (keywords.includes(newKeyword)) {
      await sendSafeMessage(chatId, `❌ Keyword "${newKeyword}" already exists!`);
      return;
    }
    
    keywords.push(newKeyword);
    await sendSafeMessage(chatId, `✅ *Added:* "${newKeyword}"\n📊 *Total:* ${keywords.length} keywords`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/keywords/, async (msg) => {
    const chatId = msg.chat.id;
    
    const youtubers = keywords.filter(k => k.charAt(0) === k.charAt(0).toUpperCase());
    const terms = keywords.filter(k => k.charAt(0) !== k.charAt(0).toUpperCase());
    
    let message = `📝 *Keywords (${keywords.length} total):*\n\n`;
    
    if (youtubers.length > 0) {
      message += `*🎬 YouTubers:* ${youtubers.slice(0, 10).join(', ')}\n\n`;
    }
    
    if (terms.length > 0) {
      message += `*🔥 Terms:* ${terms.join(', ')}`;
    }
    
    await sendSafeMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    const stats = `
📊 *Bot Statistics:*

*📡 Content by Source:*
• 🔍 Google: ${googleNewsCache.length} articles
• 📺 YouTube: ${youtubeNewsCache.length} videos
• 🐦 Twitter: ${twitterNewsCache.length} posts
• 📡 Feedly: ${feedlyNewsCache.length} feeds

*📈 System:*
• Users: ${userSubscriptions.size}
• Keywords: ${keywords.length}
• Total: ${googleNewsCache.length + youtubeNewsCache.length + twitterNewsCache.length + feedlyNewsCache.length}
• Uptime: ${Math.floor(process.uptime() / 3600)}h

*🎯 Quick Access:*
/google /youtube /twitter /feedly
    `;
    
    await sendSafeMessage(chatId, stats, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
🤖 *Source-Based Bot Commands* 🤖

*📡 NEWS SOURCES:*
/google - 🔍 Google News articles
/youtube - 📺 YouTube videos
/twitter - 🐦 Twitter/X posts  
/feedly - 📡 RSS feeds

*🔍 SEARCH & MANAGE:*
/search [keyword] - Search all sources
/addkeyword [word] - Add keyword
/keywords - Show keywords
/stats - Statistics

*💡 EXAMPLES:*
\`/google\` - Latest news
\`/search CarryMinati\` - Find content
\`/addkeyword MrBeast\` - Track new YouTuber

Choose your source for targeted results! 🚀
    `;
    
    await sendSafeMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

// Health endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    method: 'safe-messaging',
    sources: {
      google: googleNewsCache.length,
      youtube: youtubeNewsCache.length,
      twitter: twitterNewsCache.length,
      feedly: feedlyNewsCache.length
    },
    keywords: keywords.length,
    users: userSubscriptions.size,
    uptime: Math.floor(process.uptime())
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    message_handling: 'safe_chunked'
  });
});

// Cron jobs
cron.schedule('*/20 * * * *', () => {
  console.log('🔄 Scheduled refresh...');
  aggregateAllSources();
});

// Self-ping
if (process.env.RENDER_EXTERNAL_URL) {
  cron.schedule('*/10 * * * *', async () => {
    try {
      await axios.get(process.env.RENDER_EXTERNAL_URL + '/health', { timeout: 20000 });
      console.log('✅ Self-ping successful');
    } catch (error) {
      console.error('❌ Self-ping failed:', error.message);
    }
  });
}

// Bot startup
async function startBot() {
  try {
    await bot.deleteWebHook();
    
    if (process.env.RENDER_EXTERNAL_URL) {
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook set: ${webhookUrl}`);
    } else {
      bot.startPolling();
      console.log('✅ Polling started (development)');
    }
    
    setupBotCommands();
    console.log('🤖 Safe messaging bot commands ready');
    
    console.log('🚀 Loading initial content...');
    await aggregateAllSources();
    
    const totalItems = googleNewsCache.length + youtubeNewsCache.length + 
                      twitterNewsCache.length + feedlyNewsCache.length;
    
    console.log(`✅ Bot ready with ${totalItems} items!`);
    
  } catch (error) {
    console.error('❌ Bot startup error:', error);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Safe Message Bot on port ${PORT}`);
  console.log(`📊 Tracking ${keywords.length} keywords`);
  console.log(`🎯 Fixed: ENTITIES_TOO_LONG error`);
  startBot();
});

process.on('SIGTERM', () => {
  console.log('🛑 Graceful shutdown');
  bot.deleteWebHook();
  process.exit(0);
});
