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

// WEBHOOK METHOD - NO MORE 409 CONFLICTS!
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
const parser = new Parser();

// Storage
let newsCache = [];
let userSubscriptions = new Set();
let keywords = [
  'CarryMinati', 'Amit Bhadana', 'BB Ki Vines', 'Ashish Chanchlani', 
  'Technical Guruji', 'Round2Hell', 'Harsh Beniwal', 'Total Gaming',
  'Triggered Insaan', 'Live Insaan', 'Fukra Insaan', 'Slayy Point',
  'Tanmay Bhat', 'Samay Raina', 'Dynamo Gaming', 'Mortal', 'Scout',
  'Flying Beast', 'Sourav Joshi', 'Mumbiker Nikhil', 'Prajakta Koli',
  'Elvish Yadav', 'Lakshay Chaudhary', 'Hindustani Bhau', 'BeastBoyShub',
  'Mythpat', 'Techno Gamerz', 'Jonathan Gaming', 'Rawknee', 'MostlySane',
  'Bhuvan Bam', 'Khan Sir', 'Sandeep Maheshwari', 'Emiway Bantai',
  'controversy', 'drama', 'leaked', 'exposed', 'scandal', 'fight',
  'roast', 'beef', 'backlash', 'apology', 'response', 'banned'
];

// Utility functions
function isRecentNews(publishDate) {
  const now = new Date();
  const newsDate = new Date(publishDate);
  const timeDiff = now - newsDate;
  return timeDiff <= 24 * 60 * 60 * 1000;
}

function calculateScore(item, keyword) {
  const title = (item.title || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  let score = 0;
  
  if (title.includes(keyword.toLowerCase())) score += 10;
  if (description.includes(keyword.toLowerCase())) score += 5;
  
  const controversyWords = ['drama', 'controversy', 'exposed', 'scandal'];
  controversyWords.forEach(word => {
    if (title.includes(word) || description.includes(word)) score += 3;
  });
  
  if (isRecentNews(item.pubDate)) score += 15;
  return score;
}

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

// News fetching functions (same as before)
async function fetchGoogleNews(keyword) {
  try {
    const searches = [
      `"${keyword}" YouTube controversy`,
      `"${keyword}" drama scandal`,
      `"${keyword}" latest news`,
      `${keyword} YouTuber news India`
    ];
    
    let allItems = [];
    
    for (const search of searches) {
      try {
        const query = encodeURIComponent(search);
        const url = `https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        const response = await axios.get(url, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
        });
        
        const feed = await parser.parseString(response.data);
        
        const items = feed.items.slice(0, 8).map(item => ({
          title: item.title.replace(/\s*-\s*[^-]*$/, ''),
          description: item.contentSnippet || item.summary || '',
          url: item.link,
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          source: 'Google News',
          keyword: keyword,
          score: calculateScore(item, keyword)
        }));
        
        allItems = allItems.concat(items);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Google News error for ${search}:`, error.message);
      }
    }
    
    return allItems;
  } catch (error) {
    console.error(`Google News error for ${keyword}:`, error.message);
    return [];
  }
}

async function fetchYouTubeContent(keyword) {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword + ' latest news')}&sp=CAI%253D`;
    
    const response = await axios.get(searchUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    const videos = [];
    const $ = cheerio.load(response.data);
    
    $('script').each((_, script) => {
      const content = $(script).html();
      if (content && content.includes('ytInitialData')) {
        try {
          const dataMatch = content.match(/var ytInitialData = ({.*?});/);
          if (dataMatch) {
            const data = JSON.parse(dataMatch[1]);
            const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
            
            if (contents) {
              contents.forEach(section => {
                const items = section?.itemSectionRenderer?.contents || [];
                items.forEach(item => {
                  const video = item?.videoRenderer;
                  if (video) {
                    const title = video.title?.runs?.[0]?.text || '';
                    const videoId = video.videoId;
                    const channel = video.longBylineText?.runs?.[0]?.text || '';
                    const published = video.publishedTimeText?.simpleText || '';
                    
                    if (title && videoId) {
                      videos.push({
                        title: title,
                        description: `${channel} • ${published}`,
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        pubDate: parseYouTubeDate(published),
                        source: `YouTube - ${channel}`,
                        keyword: keyword,
                        score: calculateScore({ title, description: title }, keyword)
                      });
                    }
                  }
                });
              });
            }
          }
        } catch (parseError) {
          // Continue without breaking
        }
        return false;
      }
    });
    
    return videos.slice(0, 10);
  } catch (error) {
    console.error(`YouTube error for ${keyword}:`, error.message);
    return [];
  }
}

function parseYouTubeDate(publishedText) {
  try {
    const now = new Date();
    const text = (publishedText || '').toLowerCase();
    
    if (text.includes('hour')) {
      const hours = parseInt(text.match(/(\d+)\s*hour/)?.[1] || '1');
      return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
    } else if (text.includes('day')) {
      const days = parseInt(text.match(/(\d+)\s*day/)?.[1] || '1');
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    } else if (text.includes('week')) {
      const weeks = parseInt(text.match(/(\d+)\s*week/)?.[1] || '1');
      return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    
    return now.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

async function fetchRSSFeeds() {
  const feeds = [
    'https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms'
  ];
  
  let allItems = [];
  
  for (const feedUrl of feeds) {
    try {
      const response = await axios.get(feedUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)' }
      });
      
      const feed = await parser.parseString(response.data);
      
      const relevantItems = feed.items.filter(item => {
        const content = ((item.title || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
        return keywords.some(keyword => content.includes(keyword.toLowerCase()));
      });
      
      const processedItems = relevantItems.slice(0, 5).map(item => ({
        title: item.title,
        description: item.contentSnippet || item.summary || '',
        url: item.link,
        pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
        source: `RSS - ${feed.title || 'News'}`,
        keyword: 'entertainment',
        score: calculateScore(item, 'entertainment')
      }));
      
      allItems = allItems.concat(processedItems);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`RSS error for ${feedUrl}:`, error.message);
    }
  }
  
  return allItems;
}

// Main aggregation function
async function aggregateNews() {
  console.log('🚀 Starting REAL news aggregation...');
  let allNews = [];
  
  try {
    const keywordBatches = _.chunk(keywords, 5);
    
    for (const batch of keywordBatches) {
      const batchPromises = [];
      
      batch.forEach(keyword => {
        batchPromises.push(fetchGoogleNews(keyword));
        if (batch.indexOf(keyword) < 3) {
          batchPromises.push(fetchYouTubeContent(keyword));
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allNews = allNews.concat(result.value);
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    const rssItems = await fetchRSSFeeds();
    allNews = allNews.concat(rssItems);
    
    console.log(`📰 Total items fetched: ${allNews.length}`);
    
    allNews = allNews.filter(item => isRecentNews(item.pubDate));
    console.log(`⏰ Recent items (24h): ${allNews.length}`);
    
    allNews = _.uniqBy(allNews, item => 
      item.title.toLowerCase().replace(/[^\w\s]/g, '').substring(0, 50)
    );
    console.log(`🔄 After deduplication: ${allNews.length}`);
    
    allNews.sort((a, b) => b.score - a.score);
    newsCache = allNews.slice(0, 100);
    
    console.log(`✅ Final cache: ${newsCache.length} items`);
    if (newsCache.length > 0) {
      console.log(`🎯 Top item: "${newsCache[0].title.substring(0, 50)}..."`);
    }
    
  } catch (error) {
    console.error('❌ Aggregation error:', error);
  }
}

// WEBHOOK SETUP - NO MORE CONFLICTS!
app.use(express.json());

// Webhook endpoint
app.post(`/webhook/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// TELEGRAM BOT COMMANDS
function setupBotCommands() {
  // Start command
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    userSubscriptions.add(chatId);
    
    const welcomeMessage = `
🎬 *Welcome to REAL YouTuber News Bot!* 🎬

*📡 Real Sources:*
• Google News (Live RSS)
• YouTube (Real videos & channels)  
• Major Indian news RSS feeds

*🎯 ALL WORKING COMMANDS:*
/latest - Latest 20 trending news
/trending - Top 30 viral stories
/all - Complete 100 news feed
/search [keyword] - Search specific content
/addkeyword [word] - Add new keyword
/removekeyword [word] - Remove keyword
/keywords - Show all keywords
/stats - Bot analytics
/help - Full command list

*📊 Currently tracking ${keywords.length} keywords!*

Try /latest for fresh news! 🔥
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // Latest news
  bot.onText(/\/latest/, (msg) => {
    const chatId = msg.chat.id;
    
    if (newsCache.length === 0) {
      bot.sendMessage(chatId, '📭 No recent news available. Fetching fresh content...');
      return;
    }
    
    const latestNews = newsCache.slice(0, 20);
    let message = '📰 *Latest Trending News (20 items):*\n\n';
    
    latestNews.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 70)}${item.title.length > 70 ? '...' : ''}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo} • 📊 ${item.score}\n`;
      message += `   🔗 [Read More](${item.url})\n\n`;
    });
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // Search command
  bot.onText(/\/search (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].toLowerCase().trim();
    
    if (newsCache.length === 0) {
      bot.sendMessage(chatId, '📭 No content to search. Please wait...');
      return;
    }
    
    const searchResults = newsCache.filter(item => 
      item.title.toLowerCase().includes(searchTerm) ||
      item.description.toLowerCase().includes(searchTerm) ||
      item.keyword.toLowerCase().includes(searchTerm) ||
      item.source.toLowerCase().includes(searchTerm)
    );
    
    if (searchResults.length === 0) {
      const availableKeywords = [...new Set(newsCache.map(item => item.keyword))].slice(0, 10);
      bot.sendMessage(chatId, `🔍 No results for "${searchTerm}"\n\n📝 *Try:* ${availableKeywords.join(', ')}\n\n📊 Total: ${newsCache.length} items`);
      return;
    }
    
    const limitedResults = searchResults.slice(0, 25);
    let message = `🔍 *Search: "${searchTerm}" (${limitedResults.length} found):*\n\n`;
    
    limitedResults.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 60)}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo} • 📊 ${item.score}\n`;
      message += `   🔗 [Link](${item.url})\n\n`;
    });
    
    if (message.length > 4000) {
      const firstHalf = message.substring(0, 4000);
      const lastNewline = firstHalf.lastIndexOf('\n\n');
      bot.sendMessage(chatId, firstHalf.substring(0, lastNewline), { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    } else {
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    }
  });

  // Add keyword
  bot.onText(/\/addkeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const newKeyword = match[1].trim();
    
    if (!newKeyword || newKeyword.length < 2) {
      bot.sendMessage(chatId, '❌ Please provide a valid keyword (minimum 2 characters)');
      return;
    }
    
    if (keywords.includes(newKeyword)) {
      bot.sendMessage(chatId, `❌ Keyword "${newKeyword}" already exists!\n\n📊 Total keywords: ${keywords.length}`);
      return;
    }
    
    keywords.push(newKeyword);
    bot.sendMessage(chatId, `✅ *Added keyword:* "${newKeyword}"\n📊 *Total keywords:* ${keywords.length}\n🔄 *Next update:* 15 minutes`, { parse_mode: 'Markdown' });
  });

  // Remove keyword
  bot.onText(/\/removekeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const keywordToRemove = match[1].trim();
    
    const index = keywords.indexOf(keywordToRemove);
    if (index === -1) {
      bot.sendMessage(chatId, `❌ Keyword "${keywordToRemove}" not found!`);
      return;
    }
    
    keywords.splice(index, 1);
    bot.sendMessage(chatId, `✅ *Removed keyword:* "${keywordToRemove}"\n📊 *Total keywords:* ${keywords.length}`, { parse_mode: 'Markdown' });
  });

  // Show keywords
  bot.onText(/\/keywords/, (msg) => {
    const chatId = msg.chat.id;
    
    const youtubers = keywords.filter(k => 
      k.charAt(0) === k.charAt(0).toUpperCase() && 
      !['Drama', 'Controversy', 'Exposed', 'Viral', 'Trending'].includes(k)
    );
    
    const controversyWords = keywords.filter(k => 
      k.charAt(0) !== k.charAt(0).toUpperCase() || 
      ['Drama', 'Controversy', 'Exposed', 'Viral', 'Trending'].includes(k)
    );
    
    let message = `📝 *All Keywords (${keywords.length} total):*\n\n`;
    
    if (youtubers.length > 0) {
      message += `*🎬 YouTubers (${youtubers.length}):*\n${youtubers.slice(0, 20).join(', ')}\n\n`;
    }
    
    if (controversyWords.length > 0) {
      message += `*🔥 Terms (${controversyWords.length}):*\n${controversyWords.join(', ')}`;
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  // Stats command
  bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    
    const sourceBreakdown = newsCache.reduce((acc, item) => {
      const source = item.source.split(' - ')[0];
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});
    
    let sourceStats = Object.entries(sourceBreakdown)
      .map(([source, count]) => `• ${source}: ${count}`)
      .join('\n');
    
    const stats = `
📊 *Bot Analytics:*

*📈 Content:*
• Total News: ${newsCache.length}/100
• Active Users: ${userSubscriptions.size}
• Keywords: ${keywords.length}

*📡 Sources:*
${sourceStats}

*⚙️ System:*
• Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
• Method: WebHook (No conflicts!)
• Status: ${newsCache.length > 0 ? 'Active' : 'Loading...'}
    `;
    
    bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
  });

  // Help command
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
🤖 *Complete Command List* 🤖

*📰 NEWS:*
/latest - Latest 20 news
/search [keyword] - Search content

*⚙️ MANAGE:*
/addkeyword [word] - Add keyword
/removekeyword [word] - Remove keyword
/keywords - Show all keywords

*📊 INFO:*
/stats - Bot statistics
/help - This menu

*🔍 Examples:*
/search CarryMinati
/addkeyword MrBeast
/removekeyword drama

All commands working with WebHook method! 🚀
    `;
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

// Health endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    method: 'webhook',
    newsItems: newsCache.length,
    keywords: keywords.length,
    users: userSubscriptions.size,
    uptime: Math.floor(process.uptime()),
    conflict_free: true
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    cache: newsCache.length,
    method: 'webhook'
  });
});

// Cron jobs
cron.schedule('*/15 * * * *', () => {
  console.log('🔄 Running scheduled aggregation...');
  aggregateNews();
});

// Set webhook and start
async function startBot() {
  try {
    // Clear any existing webhook
    await bot.deleteWebHook();
    
    if (process.env.RENDER_EXTERNAL_URL) {
      // Set webhook for production
      const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/webhook/${process.env.TELEGRAM_BOT_TOKEN}`;
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook set: ${webhookUrl}`);
    } else {
      // Use polling for local development
      bot.startPolling();
      console.log('✅ Polling started for development');
    }
    
    setupBotCommands();
    console.log('🤖 Bot commands initialized');
    
    // Initial news fetch
    setTimeout(() => {
      console.log('🚀 Starting initial news aggregation...');
      aggregateNews();
    }, 5000);
    
  } catch (error) {
    console.error('❌ Bot startup error:', error);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 WEBHOOK Bot running on port ${PORT}`);
  console.log(`📊 Tracking ${keywords.length} keywords`);
  console.log(`🎯 Method: WebHook (Conflict-free!)`);
  startBot();
});

process.on('SIGTERM', () => {
  console.log('🛑 Graceful shutdown');
  bot.deleteWebHook();
  process.exit(0);
});
