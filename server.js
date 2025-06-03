require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const Sentiment = require('sentiment');
const _ = require('lodash');

const app = express();
const PORT = process.env.PORT || 3000;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const parser = new Parser();
const sentiment = new Sentiment();

// In-memory storage
let newsCache = [];
let userSubscriptions = new Set();
let keywords = [
  // Top Indian YouTubers
  'CarryMinati', 'Amit Bhadana', 'BB Ki Vines', 'Ashish Chanchlani', 
  'Technical Guruji', 'Harsh Beniwal', 'Round2Hell', 'Triggered Insaan',
  'Sourav Joshi', 'Flying Beast', 'Dynamo Gaming', 'Total Gaming',
  'Techno Gamerz', 'Live Insaan', 'Ujjwal Chaurasia', 'Mythpat',
  'Tanmay Bhat', 'Samay Raina', 'Hindustani Bhau', 'Lakshay Chaudhary',
  'Elvish Yadav', 'Fukra Insaan', 'Bhuvan Bam', 'Gaurav Chaudhary',
  'Sandeep Maheshwari', 'Khan Sir', 'Dilraj Singh', 'Desi Gamers',
  'Mortal', 'Scout', 'Jonathan Gaming', 'Rawknee', 'Slayy Point',
  'The Viral Fever', 'AIB', 'FilterCopy', 'Dice Media', 'MostlySane',
  'Mumbiker Nikhil', 'Nikhil Sharma', 'Prajakta Koli', 'Komal Pandey',
  
  // Controversy keywords
  'controversy', 'drama', 'leaked', 'apology', 'fight', 'roast', 
  'scandal', 'exposed', 'viral', 'trending', 'complaint', 'lawsuit',
  'allegation', 'ban', 'suspended', 'demonetized', 'backlash',
  'criticism', 'beef', 'feud', 'callout', 'response', 'reaction'
];

// News sources configuration
const newsSources = {
  googleNews: 'https://news.google.com/rss/search?q=',
  youtubeRss: 'https://www.youtube.com/feeds/videos.xml?channel_id=',
  redditRss: 'https://www.reddit.com/r/IndianYouTubers+youtubedrama+indiangaming.json'
};

// Utility functions
function isRecentNews(publishDate) {
  const now = new Date();
  const newsDate = new Date(publishDate);
  const timeDiff = now - newsDate;
  return timeDiff <= 24 * 60 * 60 * 1000; // 24 hours
}

function calculateRelevanceScore(item, searchKeyword) {
  const title = item.title?.toLowerCase() || '';
  const description = item.description?.toLowerCase() || '';
  const content = title + ' ' + description;
  
  let score = 0;
  
  // Keyword matching
  const keywordLower = searchKeyword.toLowerCase();
  if (title.includes(keywordLower)) score += 10;
  if (description.includes(keywordLower)) score += 5;
  
  // Controversy keywords boost
  const controversyKeywords = ['drama', 'controversy', 'exposed', 'scandal', 'fight'];
  controversyKeywords.forEach(keyword => {
    if (content.includes(keyword)) score += 3;
  });
  
  // Sentiment analysis
  const sentimentResult = sentiment.analyze(content);
  if (sentimentResult.score < -2) score += 5;
  
  // Recency boost
  if (isRecentNews(item.pubDate)) score += 15;
  
  return score;
}

function removeDuplicates(newsItems) {
  return _.uniqBy(newsItems, item => 
    item.title.toLowerCase().replace(/[^\w\s]/gi, '').trim()
  );
}

// News fetching functions
async function fetchGoogleNews(keyword) {
  try {
    const query = encodeURIComponent(`"${keyword}" Indian YouTuber`);
    const url = `${newsSources.googleNews}${query}&hl=en-IN&gl=IN&ceid=IN:en`;
    
    const feed = await parser.parseURL(url);
    return feed.items.map(item => ({
      title: item.title,
      description: item.contentSnippet || item.content,
      url: item.link,
      pubDate: item.pubDate,
      source: 'Google News',
      keyword: keyword,
      score: calculateRelevanceScore(item, keyword)
    }));
  } catch (error) {
    console.error(`Error fetching Google News for ${keyword}:`, error.message);
    return [];
  }
}

async function fetchRedditPosts() {
  try {
    const subreddits = ['IndianYouTubers', 'youtubedrama', 'indiangaming'];
    let allPosts = [];
    
    for (const subreddit of subreddits) {
      try {
        const response = await axios.get(`https://www.reddit.com/r/${subreddit}/new.json?limit=25`, {
          headers: { 'User-Agent': 'YoutuberNewsBot/1.0' }
        });
        
        const posts = response.data.data.children.map(post => ({
          title: post.data.title,
          description: post.data.selftext || '',
          url: `https://reddit.com${post.data.permalink}`,
          pubDate: new Date(post.data.created_utc * 1000),
          source: `Reddit r/${subreddit}`,
          keyword: 'reddit',
          score: post.data.score + post.data.num_comments
        }));
        
        allPosts = allPosts.concat(posts);
      } catch (error) {
        console.error(`Error fetching r/${subreddit}:`, error.message);
      }
    }
    
    return allPosts;
  } catch (error) {
    console.error('Error fetching Reddit posts:', error.message);
    return [];
  }
}

async function aggregateNews() {
  console.log('Starting news aggregation...');
  let allNews = [];
  
  // Fetch from multiple sources
  const fetchPromises = keywords.map(async keyword => {
    const googleNews = await fetchGoogleNews(keyword);
    return googleNews;
  });
  
  // Add Reddit posts
  const redditPosts = await fetchRedditPosts();
  
  try {
    const newsResults = await Promise.all(fetchPromises);
    allNews = newsResults.flat().concat(redditPosts);
    
    // Filter recent news only
    allNews = allNews.filter(item => isRecentNews(item.pubDate));
    
    // Remove duplicates
    allNews = removeDuplicates(allNews);
    
    // Sort by relevance score
    allNews.sort((a, b) => b.score - a.score);
    
    // Keep top 100 items
    newsCache = allNews.slice(0, 100);
    
    console.log(`Aggregated ${newsCache.length} news items`);
  } catch (error) {
    console.error('Error in news aggregation:', error);
  }
}

// Telegram bot handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSubscriptions.add(chatId);
  
  const welcomeMessage = `
🎬 *Welcome to YouTuber News Bot!* 🎬

I track the latest news, controversies, and trending topics about Indian YouTubers.

*Available Commands:*
/help - Show all commands
/latest - Get latest 10 news items
/trending - Get top trending stories
/search [keyword] - Search for specific news
/addkeyword [word] - Add new keyword to track
/removekeyword [word] - Remove keyword
/keywords - Show current keywords
/stats - Show bot statistics

*Currently tracking ${keywords.length} keywords and monitoring multiple sources!*

Type /latest to get started! 🚀
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
🤖 *YouTuber News Bot Help* 🤖

*Main Commands:*
• /latest - Get latest 10 news items
• /trending - Get top 20 trending stories
• /search [keyword] - Search specific news
• /all - Get latest 50 news items

*Keyword Management:*
• /addkeyword [word] - Add tracking keyword
• /removekeyword [word] - Remove keyword
• /keywords - View all tracked keywords

*Information:*
• /stats - Bot statistics
• /help - This help menu

*Examples:*
\`/search CarryMinati\`
\`/addkeyword MrBeast\`
\`/removekeyword drama\`

News updates every 20 minutes! 📰
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/latest/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No recent news available. Try again in a few minutes!');
    return;
  }
  
  const latestNews = newsCache.slice(0, 10);
  let message = '📰 *Latest YouTuber News:*\n\n';
  
  latestNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `${index + 1}. *${item.title.substring(0, 80)}${item.title.length > 80 ? '...' : ''}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
    message += `   🔗 [Read More](${item.url})\n\n`;
  });
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    disable_web_page_preview: true 
  });
});

bot.onText(/\/trending/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No trending news available right now!');
    return;
  }
  
  const trendingNews = newsCache.slice(0, 20);
  let message = '🔥 *Top Trending Stories:*\n\n';
  
  trendingNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `${index + 1}. *${item.title.substring(0, 70)}${item.title.length > 70 ? '...' : ''}*\n`;
    message += `   📊 Score: ${item.score} • 📍 ${item.source}\n`;
    message += `   ⏰ ${timeAgo} • 🔗 [Link](${item.url})\n\n`;
  });
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    disable_web_page_preview: true 
  });
});

bot.onText(/\/search (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const searchTerm = match[1].toLowerCase();
  
  const searchResults = newsCache.filter(item => 
    item.title.toLowerCase().includes(searchTerm) ||
    item.description.toLowerCase().includes(searchTerm) ||
    item.keyword.toLowerCase().includes(searchTerm)
  ).slice(0, 15);
  
  if (searchResults.length === 0) {
    bot.sendMessage(chatId, `🔍 No results found for "${searchTerm}"`);
    return;
  }
  
  let message = `🔍 *Search Results for "${searchTerm}":*\n\n`;
  
  searchResults.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `${index + 1}. *${item.title.substring(0, 70)}${item.title.length > 70 ? '...' : ''}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
    message += `   🔗 [Read More](${item.url})\n\n`;
  });
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    disable_web_page_preview: true 
  });
});

bot.onText(/\/addkeyword (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const newKeyword = match[1].trim();
  
  if (keywords.includes(newKeyword)) {
    bot.sendMessage(chatId, `❌ Keyword "${newKeyword}" already exists!`);
    return;
  }
  
  keywords.push(newKeyword);
  bot.sendMessage(chatId, `✅ Added keyword: "${newKeyword}"\nTotal keywords: ${keywords.length}`);
});

bot.onText(/\/removekeyword (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const keywordToRemove = match[1].trim();
  
  const index = keywords.indexOf(keywordToRemove);
  if (index === -1) {
    bot.sendMessage(chatId, `❌ Keyword "${keywordToRemove}" not found!`);
    return;
  }
  
  keywords.splice(index, 1);
  bot.sendMessage(chatId, `✅ Removed keyword: "${keywordToRemove}"\nTotal keywords: ${keywords.length}`);
});

bot.onText(/\/keywords/, (msg) => {
  const chatId = msg.chat.id;
  
  const youtubers = keywords.filter(k => 
    k.charAt(0) === k.charAt(0).toUpperCase() && !['drama', 'controversy'].includes(k.toLowerCase())
  );
  const controversyWords = keywords.filter(k => 
    k.charAt(0) !== k.charAt(0).toUpperCase() || ['drama', 'controversy'].includes(k.toLowerCase())
  );
  
  let message = `📝 *Tracked Keywords (${keywords.length} total):*\n\n`;
  message += `*YouTubers (${youtubers.length}):*\n${youtubers.join(', ')}\n\n`;
  message += `*Controversy Terms (${controversyWords.length}):*\n${controversyWords.join(', ')}`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  
  const stats = `
📊 *Bot Statistics:*

• Active Users: ${userSubscriptions.size}
• Tracked Keywords: ${keywords.length}
• Cached News Items: ${newsCache.length}
• Last Update: ${newsCache.length > 0 ? getTimeAgo(new Date()) : 'Never'}
• Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m

*Sources:* Google News, Reddit
*Update Frequency:* Every 20 minutes
  `;
  
  bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
});

bot.onText(/\/all/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No news available currently!');
    return;
  }
  
  const allNews = newsCache.slice(0, 50);
  let message = `📰 *All Recent News (${allNews.length} items):*\n\n`;
  
  allNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `${index + 1}. *${item.title.substring(0, 60)}${item.title.length > 60 ? '...' : ''}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo} • [Link](${item.url})\n\n`;
    
    // Split message if too long
    if (message.length > 4000) {
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      message = '';
    }
  });
  
  if (message.length > 0) {
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  }
});

// Utility function for time formatting
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Express server for health checks and preventing sleep
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    uptime: process.uptime(),
    newsItems: newsCache.length,
    lastUpdate: newsCache.length > 0 ? newsCache[0].pubDate : null
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Schedule news fetching every 20 minutes
cron.schedule('*/20 * * * *', () => {
  console.log('Running scheduled news aggregation...');
  aggregateNews();
});

// Initial news fetch
setTimeout(() => {
  aggregateNews();
}, 5000);

// Self-ping to prevent sleep (for free tier)
if (process.env.RENDER_EXTERNAL_URL) {
  cron.schedule('*/14 * * * *', async () => {
    try {
      await axios.get(process.env.RENDER_EXTERNAL_URL + '/health');
      console.log('Self-ping successful');
    } catch (error) {
      console.error('Self-ping failed:', error.message);
    }
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Telegram bot is active!');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});