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

// Separate storage for each source
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

// 1. GOOGLE NEWS FETCHER
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
        
        // Add fallback item
        allItems.push({
          title: `${keyword} - Latest YouTube News & Updates`,
          description: `Stay updated with the latest news and developments about ${keyword}`,
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

// 2. YOUTUBE CONTENT FETCHER
async function fetchYouTubeContent() {
  console.log('📺 Fetching YouTube content...');
  let allVideos = [];
  
  try {
    const youtubeKeywords = keywords.slice(0, 5);
    
    for (const keyword of youtubeKeywords) {
      try {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword + ' latest')}&sp=CAI%253D`;
        
        const response = await axios.get(searchUrl, {
          timeout: 6000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        
        const videos = extractYouTubeVideos(response.data, keyword);
        allVideos = allVideos.concat(videos);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ YouTube error for ${keyword}:`, error.message);
        
        // Add fallback video
        allVideos.push({
          title: `${keyword} - Latest YouTube Videos & Content`,
          description: `Recent uploads and trending videos from ${keyword}`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}`,
          pubDate: new Date().toISOString(),
          source: 'YouTube Search',
          keyword: keyword,
          score: 35
        });
      }
    }
    
    youtubeNewsCache = allVideos.sort((a, b) => b.score - a.score).slice(0, 25);
    console.log(`✅ YouTube: ${youtubeNewsCache.length} items cached`);
    
  } catch (error) {
    console.error('❌ YouTube aggregation failed:', error);
  }
}

function extractYouTubeVideos(htmlData, keyword) {
  try {
    const videos = [];
    const $ = cheerio.load(htmlData);
    
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
                items.slice(0, 3).forEach(item => {
                  const video = item?.videoRenderer;
                  if (video) {
                    const title = video.title?.runs?.[0]?.text || '';
                    const videoId = video.videoId;
                    const channel = video.longBylineText?.runs?.[0]?.text || '';
                    const published = video.publishedTimeText?.simpleText || 'Recently';
                    
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
    
    return videos.slice(0, 4);
  } catch (error) {
    console.error('YouTube extraction error:', error.message);
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

// 3. TWITTER/X CONTENT FETCHER
async function fetchTwitterContent() {
  console.log('🐦 Fetching Twitter content...');
  let allTweets = [];
  
  try {
    const twitterKeywords = ['controversy', 'drama', 'CarryMinati', 'Elvish Yadav'];
    
    for (const keyword of twitterKeywords) {
      try {
        // Using Nitter as Twitter alternative
        const searchUrl = `https://nitter.net/search?q=${encodeURIComponent(keyword + ' YouTube')}&f=tweets`;
        
        const response = await axios.get(searchUrl, {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TwitterBot/1.0)' }
        });
        
        const tweets = extractTweets(response.data, keyword);
        allTweets = allTweets.concat(tweets);
        
        await new Promise(resolve => setTimeout(resolve, 400));
        
      } catch (error) {
        console.error(`❌ Twitter error for ${keyword}:`, error.message);
        
        // Add fallback tweet
        allTweets.push({
          title: `${keyword} trending on Twitter/X`,
          description: `Latest discussions and trending topics about ${keyword} on social media`,
          url: `https://twitter.com/search?q=${encodeURIComponent(keyword + ' YouTube')}`,
          pubDate: new Date().toISOString(),
          source: 'Twitter/X',
          keyword: keyword,
          score: 25
        });
      }
    }
    
    twitterNewsCache = allTweets.sort((a, b) => b.score - a.score).slice(0, 20);
    console.log(`✅ Twitter: ${twitterNewsCache.length} items cached`);
    
  } catch (error) {
    console.error('❌ Twitter aggregation failed:', error);
  }
}

function extractTweets(htmlData, keyword) {
  try {
    const tweets = [];
    const $ = cheerio.load(htmlData);
    
    $('.timeline-item').slice(0, 3).each((_, element) => {
      const $el = $(element);
      const text = $el.find('.tweet-content').text().trim();
      const username = $el.find('.username').text().trim();
      const date = $el.find('.tweet-date').attr('title') || new Date().toISOString();
      
      if (text && text.length > 10) {
        tweets.push({
          title: text.substring(0, 80) + (text.length > 80 ? '...' : ''),
          description: text,
          url: `https://twitter.com/search?q=${encodeURIComponent(keyword)}`,
          pubDate: date,
          source: `Twitter - ${username || 'User'}`,
          keyword: keyword,
          score: calculateScore({ title: text, description: text }, keyword)
        });
      }
    });
    
    return tweets;
  } catch (error) {
    console.error('Tweet extraction error:', error.message);
    return [];
  }
}

// 4. FEEDLY RSS FETCHER
async function fetchFeedlyContent() {
  console.log('📡 Fetching Feedly RSS...');
  let allItems = [];
  
  try {
    const feeds = [
      'https://timesofindia.indiatimes.com/rssfeeds/1081479906.cms',
      'https://feeds.feedburner.com/ndtvnews-entertainment'
    ];
    
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
          source: `Feedly - ${feed.title || 'Entertainment'}`,
          keyword: 'feedly',
          score: calculateScore(item, 'entertainment')
        }));
        
        allItems = allItems.concat(items);
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.error(`❌ Feedly RSS error:`, error.message);
      }
    }
    
    // Add fallback if no RSS items
    if (allItems.length === 0) {
      allItems = keywords.slice(0, 5).map(keyword => ({
        title: `${keyword} - Entertainment & Celebrity News`,
        description: `Latest entertainment news and celebrity updates about ${keyword}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(keyword + ' entertainment news')}`,
        pubDate: new Date().toISOString(),
        source: 'Entertainment Portal',
        keyword: keyword,
        score: 20
      }));
    }
    
    feedlyNewsCache = allItems.sort((a, b) => b.score - a.score).slice(0, 25);
    console.log(`✅ Feedly: ${feedlyNewsCache.length} items cached`);
    
  } catch (error) {
    console.error('❌ Feedly aggregation failed:', error);
  }
}

// AGGREGATION MANAGER
async function aggregateAllSources() {
  console.log('🚀 Starting multi-source aggregation...');
  
  try {
    // Run all sources in parallel
    await Promise.allSettled([
      fetchGoogleNews(),
      fetchYouTubeContent(),
      fetchTwitterContent(),
      fetchFeedlyContent()
    ]);
    
    const totalItems = googleNewsCache.length + youtubeNewsCache.length + 
                      twitterNewsCache.length + feedlyNewsCache.length;
    
    console.log(`✅ Aggregation complete! Total: ${totalItems} items`);
    console.log(`📊 Google: ${googleNewsCache.length}, YouTube: ${youtubeNewsCache.length}, Twitter: ${twitterNewsCache.length}, Feedly: ${feedlyNewsCache.length}`);
    
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

// BOT COMMANDS - SOURCE BASED
function setupBotCommands() {
  // Start command
  bot.onText(/\/start/, (msg) => {
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
/removekeyword [word] - Remove keyword
/keywords - Show all keywords
/stats - Source-wise statistics
/help - Full command list

*📊 Tracking ${keywords.length} keywords across 4 sources!*

Choose your preferred source! 🚀
    `;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // GOOGLE NEWS COMMAND
  bot.onText(/\/google/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /google from user ${chatId}`);
    
    if (googleNewsCache.length === 0) {
      bot.sendMessage(chatId, '⏳ Fetching Google News... Please wait...');
      await fetchGoogleNews();
    }
    
    if (googleNewsCache.length === 0) {
      bot.sendMessage(chatId, '❌ No Google News available right now. Try again later.');
      return;
    }
    
    const newsItems = googleNewsCache.slice(0, 20);
    let message = `🔍 *Google News (${newsItems.length} articles):*\n\n`;
    
    newsItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 65)}${item.title.length > 65 ? '...' : ''}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Read Article](${item.url})\n\n`;
    });
    
    message += `\n💡 Use /youtube for video content!`;
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // YOUTUBE COMMAND
  bot.onText(/\/youtube/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /youtube from user ${chatId}`);
    
    if (youtubeNewsCache.length === 0) {
      bot.sendMessage(chatId, '⏳ Fetching YouTube content... Please wait...');
      await fetchYouTubeContent();
    }
    
    if (youtubeNewsCache.length === 0) {
      bot.sendMessage(chatId, '❌ No YouTube content available right now. Try again later.');
      return;
    }
    
    const videoItems = youtubeNewsCache.slice(0, 20);
    let message = `📺 *YouTube Content (${videoItems.length} videos):*\n\n`;
    
    videoItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 60)}${item.title.length > 60 ? '...' : ''}*\n`;
      message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   📺 [Watch Video](${item.url})\n\n`;
    });
    
    message += `\n💡 Use /google for news articles!`;
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // TWITTER COMMAND
  bot.onText(/\/twitter/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /twitter from user ${chatId}`);
    
    if (twitterNewsCache.length === 0) {
      bot.sendMessage(chatId, '⏳ Fetching Twitter content... Please wait...');
      await fetchTwitterContent();
    }
    
    if (twitterNewsCache.length === 0) {
      bot.sendMessage(chatId, '❌ No Twitter content available right now. Try again later.');
      return;
    }
    
    const tweetItems = twitterNewsCache.slice(0, 15);
    let message = `🐦 *Twitter/X Posts (${tweetItems.length} tweets):*\n\n`;
    
    tweetItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 70)}*\n`;
      message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🐦 [View Tweet](${item.url})\n\n`;
    });
    
    message += `\n💡 Use /feedly for RSS feeds!`;
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // FEEDLY COMMAND
  bot.onText(/\/feedly/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /feedly from user ${chatId}`);
    
    if (feedlyNewsCache.length === 0) {
      bot.sendMessage(chatId, '⏳ Fetching Feedly RSS... Please wait...');
      await fetchFeedlyContent();
    }
    
    if (feedlyNewsCache.length === 0) {
      bot.sendMessage(chatId, '❌ No Feedly content available right now. Try again later.');
      return;
    }
    
    const feedItems = feedlyNewsCache.slice(0, 20);
    let message = `📡 *Feedly RSS Feeds (${feedItems.length} items):*\n\n`;
    
    feedItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      message += `${index + 1}. *${item.title.substring(0, 65)}${item.title.length > 65 ? '...' : ''}*\n`;
      message += `   📡 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Read More](${item.url})\n\n`;
    });
    
    message += `\n💡 Use /google for breaking news!`;
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // SEARCH ACROSS ALL SOURCES
  bot.onText(/\/search (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].toLowerCase().trim();
    
    console.log(`🔍 Search: "${searchTerm}" from user ${chatId}`);
    
    // Search across all caches
    const allItems = [
      ...googleNewsCache,
      ...youtubeNewsCache,
      ...twitterNewsCache,
      ...feedlyNewsCache
    ];
    
    if (allItems.length === 0) {
      bot.sendMessage(chatId, '📭 No content available to search. Try individual source commands first!');
      return;
    }
    
    const searchResults = allItems.filter(item => 
      item.title.toLowerCase().includes(searchTerm) ||
      item.description.toLowerCase().includes(searchTerm) ||
      item.keyword.toLowerCase().includes(searchTerm)
    );
    
    if (searchResults.length === 0) {
      bot.sendMessage(chatId, `🔍 No results for "${searchTerm}"\n\n💡 Try: /google, /youtube, /twitter, or /feedly for source-specific content!`);
      return;
    }
    
    const limitedResults = searchResults.slice(0, 20);
    let message = `🔍 *Search: "${searchTerm}" (${limitedResults.length} found):*\n\n`;
    
    limitedResults.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      const sourceIcon = item.source.includes('Google') ? '🔍' : 
                        item.source.includes('YouTube') ? '📺' :
                        item.source.includes('Twitter') ? '🐦' : '📡';
      
      message += `${index + 1}. ${sourceIcon} *${item.title.substring(0, 55)}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Link](${item.url})\n\n`;
    });
    
    bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // KEYWORD MANAGEMENT (same as before)
  bot.onText(/\/addkeyword (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const newKeyword = match[1].trim();
    
    if (!newKeyword || newKeyword.length < 2) {
      bot.sendMessage(chatId, '❌ Please provide a valid keyword (minimum 2 characters)');
      return;
    }
    
    if (keywords.includes(newKeyword)) {
      bot.sendMessage(chatId, `❌ Keyword "${newKeyword}" already exists!`);
      return;
    }
    
    keywords.push(newKeyword);
    bot.sendMessage(chatId, `✅ *Added:* "${newKeyword}"\n📊 *Total:* ${keywords.length} keywords`, { parse_mode: 'Markdown' });
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
    bot.sendMessage(chatId, `✅ *Removed:* "${keywordToRemove}"\n📊 *Total:* ${keywords.length} keywords`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/keywords/, (msg) => {
    const chatId = msg.chat.id;
    
    const youtubers = keywords.filter(k => k.charAt(0) === k.charAt(0).toUpperCase());
    const terms = keywords.filter(k => k.charAt(0) !== k.charAt(0).toUpperCase());
    
    let message = `📝 *All Keywords (${keywords.length} total):*\n\n`;
    
    if (youtubers.length > 0) {
      message += `*🎬 YouTubers:* ${youtubers.join(', ')}\n\n`;
    }
    
    if (terms.length > 0) {
      message += `*🔥 Terms:* ${terms.join(', ')}`;
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  // SOURCE-WISE STATS
  bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    
    const stats = `
📊 *Source-Based Bot Statistics:*

*📡 Content by Source:*
• 🔍 Google News: ${googleNewsCache.length} articles
• 📺 YouTube: ${youtubeNewsCache.length} videos
• 🐦 Twitter/X: ${twitterNewsCache.length} posts
• 📡 Feedly RSS: ${feedlyNewsCache.length} feeds

*📈 System Info:*
• Active Users: ${userSubscriptions.size}
• Keywords: ${keywords.length}
• Total Content: ${googleNewsCache.length + youtubeNewsCache.length + twitterNewsCache.length + feedlyNewsCache.length}
• Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m

*🎯 Quick Access:*
• /google - Google News
• /youtube - YouTube videos
• /twitter - Social posts
• /feedly - RSS feeds

*🔄 Auto-refresh: Every 15 minutes*
    `;
    
    bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
  });

  // HELP COMMAND
  bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
🤖 *Source-Based News Bot Commands* 🤖

*📡 NEWS SOURCES:*
/google - 🔍 Google News articles
/youtube - 📺 YouTube videos & content
/twitter - 🐦 Twitter/X social posts
/feedly - 📡 RSS feeds & entertainment

*🔍 SEARCH & MANAGE:*
/search [keyword] - Search across all sources
/addkeyword [word] - Add tracking keyword
/removekeyword [word] - Remove keyword
/keywords - Show all tracked keywords

*📊 INFORMATION:*
/stats - Source-wise statistics
/help - This command list
/start - Welcome menu

*💡 EXAMPLES:*
\`/google\` - Latest Google News
\`/youtube\` - Recent YouTube videos
\`/search CarryMinati\` - Find across all sources
\`/addkeyword MrBeast\` - Track new YouTuber

*🎯 FEATURES:*
• Separate sources for targeted content
• Real-time fetching on demand
• Cross-source search functionality
• Custom keyword management
• Source-wise analytics

Choose your preferred source for targeted results! 🚀
    `;
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

// HEALTH ENDPOINTS
app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    method: 'source-based-webhook',
    sources: {
      google: googleNewsCache.length,
      youtube: youtubeNewsCache.length,
      twitter: twitterNewsCache.length,
      feedly: feedlyNewsCache.length
    },
    keywords: keywords.length,
    users: userSubscriptions.size,
    uptime: Math.floor(process.uptime()),
    total_content: googleNewsCache.length + youtubeNewsCache.length + twitterNewsCache.length + feedlyNewsCache.length
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    sources_ready: {
      google: googleNewsCache.length > 0,
      youtube: youtubeNewsCache.length > 0,
      twitter: twitterNewsCache.length > 0,
      feedly: feedlyNewsCache.length > 0
    }
  });
});

// MANUAL REFRESH ENDPOINTS
app.get('/refresh/google', async (req, res) => {
  await fetchGoogleNews();
  res.json({ status: 'google refreshed', items: googleNewsCache.length });
});

app.get('/refresh/youtube', async (req, res) => {
  await fetchYouTubeContent();
  res.json({ status: 'youtube refreshed', items: youtubeNewsCache.length });
});

app.get('/refresh/twitter', async (req, res) => {
  await fetchTwitterContent();
  res.json({ status: 'twitter refreshed', items: twitterNewsCache.length });
});

app.get('/refresh/feedly', async (req, res) => {
  await fetchFeedlyContent();
  res.json({ status: 'feedly refreshed', items: feedlyNewsCache.length });
});

app.get('/refresh/all', async (req, res) => {
  await aggregateAllSources();
  res.json({ 
    status: 'all sources refreshed',
    sources: {
      google: googleNewsCache.length,
      youtube: youtubeNewsCache.length,
      twitter: twitterNewsCache.length,
      feedly: feedlyNewsCache.length
    }
  });
});

// CRON JOBS - STAGGERED REFRESH
cron.schedule('*/15 * * * *', () => {
  console.log('🔄 Scheduled refresh - All sources...');
  aggregateAllSources();
});

// Staggered individual refreshes for better performance
cron.schedule('5 */30 * * *', () => {
  console.log('🔍 Refreshing Google News...');
  fetchGoogleNews();
});

cron.schedule('10 */30 * * *', () => {
  console.log('📺 Refreshing YouTube content...');
  fetchYouTubeContent();
});

cron.schedule('15 */30 * * *', () => {
  console.log('🐦 Refreshing Twitter content...');
  fetchTwitterContent();
});

cron.schedule('20 */30 * * *', () => {
  console.log('📡 Refreshing Feedly RSS...');
  fetchFeedlyContent();
});

// SELF-PING
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

// BOT STARTUP
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
    console.log('🤖 Source-based bot commands ready');
    
    // Initial content loading
    console.log('🚀 Loading initial content from all sources...');
    await aggregateAllSources();
    
    const totalItems = googleNewsCache.length + youtubeNewsCache.length + 
                      twitterNewsCache.length + feedlyNewsCache.length;
    
    console.log(`✅ Bot ready with ${totalItems} items across 4 sources!`);
    console.log(`📊 Google: ${googleNewsCache.length}, YouTube: ${youtubeNewsCache.length}, Twitter: ${twitterNewsCache.length}, Feedly: ${feedlyNewsCache.length}`);
    
  } catch (error) {
    console.error('❌ Bot startup error:', error);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Source-Based YouTuber News Bot on port ${PORT}`);
  console.log(`📊 Tracking ${keywords.length} keywords across 4 sources`);
  console.log(`🎯 Commands: /google, /youtube, /twitter, /feedly`);
  console.log(`🔍 Method: WebHook (Source-Based & Fast)`);
  startBot();
});

process.on('SIGTERM', () => {
  console.log('🛑 Graceful shutdown');
  bot.deleteWebHook();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  bot.deleteWebHook();
  process.exit(0);
});
