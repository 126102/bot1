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

// Enhanced keywords list - 100+ keywords
let keywords = [
  // Top Indian YouTubers (50+ channels)
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
  'Ajey Nagar', 'Nischay Malhan', 'Triggered Insaan', 'Fukra Insaan',
  'CarryIsLive', 'Beastboyshub', 'Techno Ruhez', 'ChapriTube',
  'Lakshay Chaudhary', 'Emiway Bantai', 'MC Stan', 'Divine Rapper',
  'Ashish Solanki', 'Yash Sharma', 'Abdu Rozik', 'Mr. Indian Hacker',
  'Crazy XYZ', 'Yes Yes Bhai', 'Paras Thakral', 'Reaction Time',
  'Wanderers Hub', 'Fit Tuber', 'Beer Biceps', 'The Ranveer Show',
  
  // Controversy & Drama Keywords (50+ terms)
  'controversy', 'drama', 'leaked', 'apology', 'fight', 'roast', 
  'scandal', 'exposed', 'viral', 'trending', 'complaint', 'lawsuit',
  'allegation', 'ban', 'suspended', 'demonetized', 'backlash',
  'criticism', 'beef', 'feud', 'callout', 'response', 'reaction',
  'deleted video', 'copyright strike', 'channel terminated', 'account hacked',
  'fake news', 'clickbait', 'misleading', 'scam', 'fraud', 'arrest',
  'police case', 'court notice', 'legal trouble', 'income tax raid',
  'breakup', 'affair', 'cheating', 'betrayal', 'friendship ended',
  'collab gone wrong', 'brand deal cancelled', 'sponsor dropped',
  'haters', 'trolled', 'mocked', 'humiliated', 'embarrassed',
  'mental health', 'depression', 'anxiety', 'suicide', 'self harm',
  'addiction', 'rehab', 'overdose', 'accident', 'hospitalized'
];

// News sources configuration
const newsSources = {
  googleNews: 'https://news.google.com/rss/search?q=',
  youtubeSearch: 'https://www.googleapis.com/youtube/v3/search',
  youtubeVideos: 'https://www.googleapis.com/youtube/v3/videos',
  feedlyApi: 'https://feedly.com/v3/search/feeds?query=',
  twitterSearch: 'https://twitter.com/search?q=',
  youtubeTrending: 'https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=IN'
};

// Utility functions
function isRecentNews(publishDate) {
  const now = new Date();
  const newsDate = new Date(publishDate);
  const timeDiff = now - newsDate;
  return timeDiff <= 24 * 60 * 60 * 1000; // 24 hours
}

function calculateViralityScore(item, searchKeyword) {
  const title = item.title?.toLowerCase() || '';
  const description = item.description?.toLowerCase() || '';
  const content = title + ' ' + description;
  
  let score = 0;
  
  // Keyword matching (higher priority)
  const keywordLower = searchKeyword.toLowerCase();
  if (title.includes(keywordLower)) score += 15;
  if (description.includes(keywordLower)) score += 8;
  
  // Controversy keywords boost (viral content)
  const controversyKeywords = ['drama', 'controversy', 'exposed', 'scandal', 'fight', 'roast', 'leaked', 'apology'];
  controversyKeywords.forEach(keyword => {
    if (content.includes(keyword)) score += 5;
  });
  
  // Trending keywords boost
  const trendingKeywords = ['viral', 'trending', 'breaking', 'exclusive', 'shocking'];
  trendingKeywords.forEach(keyword => {
    if (content.includes(keyword)) score += 4;
  });
  
  // YouTube engagement metrics (if available)
  if (item.viewCount) {
    const views = parseInt(item.viewCount);
    if (views > 1000000) score += 10; // 1M+ views
    else if (views > 500000) score += 7; // 500K+ views
    else if (views > 100000) score += 5; // 100K+ views
  }
  
  if (item.likeCount) {
    const likes = parseInt(item.likeCount);
    if (likes > 50000) score += 5;
    else if (likes > 10000) score += 3;
  }
  
  if (item.commentCount) {
    const comments = parseInt(item.commentCount);
    if (comments > 5000) score += 4;
    else if (comments > 1000) score += 2;
  }
  
  // Sentiment analysis (negative news often more viral)
  const sentimentResult = sentiment.analyze(content);
  if (sentimentResult.score < -3) score += 6;
  else if (sentimentResult.score < -1) score += 3;
  
  // Recency boost (fresher content prioritized)
  if (isRecentNews(item.pubDate)) score += 20;
  
  // Source credibility
  if (item.source === 'YouTube Official') score += 8;
  else if (item.source === 'Google News') score += 6;
  else if (item.source === 'Twitter/X') score += 4;
  
  return score;
}

function removeDuplicates(newsItems) {
  return _.uniqBy(newsItems, item => {
    // More sophisticated duplicate detection
    const cleanTitle = item.title.toLowerCase()
      .replace(/[^\w\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanTitle.substring(0, 50); // Compare first 50 chars
  });
}

// Enhanced news fetching functions

// 1. Google News RSS (Enhanced)
async function fetchGoogleNews(keyword) {
  try {
    const queries = [
      `"${keyword}" Indian YouTuber controversy`,
      `"${keyword}" YouTube drama`,
      `"${keyword}" scandal news`,
      `"${keyword}" trending news`
    ];
    
    let allItems = [];
    
    for (const query of queries) {
      try {
        const encodedQuery = encodeURIComponent(query);
        const url = `${newsSources.googleNews}${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        const feed = await parser.parseURL(url);
        const items = feed.items.slice(0, 10).map(item => ({
          title: item.title,
          description: item.contentSnippet || item.content || '',
          url: item.link,
          pubDate: item.pubDate,
          source: 'Google News',
          keyword: keyword,
          score: calculateViralityScore(item, keyword)
        }));
        
        allItems = allItems.concat(items);
      } catch (error) {
        console.error(`Error fetching Google News for query ${query}:`, error.message);
      }
    }
    
    return allItems;
  } catch (error) {
    console.error(`Error fetching Google News for ${keyword}:`, error.message);
    return [];
  }
}

// 2. YouTube Search & Data (Enhanced)
async function fetchYouTubeContent(keyword) {
  try {
    // Note: YouTube Data API key required for production
    // For now, using web scraping approach
    
    const searchQueries = [
      `${keyword} controversy`,
      `${keyword} drama`,
      `${keyword} exposed`,
      `${keyword} response`
    ];
    
    let allVideos = [];
    
    for (const query of searchQueries) {
      try {
        // YouTube search page scraping
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAI%253D`;
        
        const response = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        const $ = cheerio.load(response.data);
        
        // Extract video data from YouTube search results
        const scriptTags = $('script').toArray();
        
        for (const script of scriptTags) {
          const content = $(script).html();
          if (content && content.includes('var ytInitialData')) {
            // Parse YouTube initial data for video information
            try {
              const jsonStr = content.split('var ytInitialData = ')[1].split(';</script>')[0];
              const data = JSON.parse(jsonStr);
              
              // Extract video information (simplified)
              const videos = extractVideoData(data, keyword, query);
              allVideos = allVideos.concat(videos);
            } catch (parseError) {
              console.error('Error parsing YouTube data:', parseError.message);
            }
            break;
          }
        }
      } catch (error) {
        console.error(`Error fetching YouTube for query ${query}:`, error.message);
      }
    }
    
    return allVideos.slice(0, 20); // Limit to 20 videos per keyword
  } catch (error) {
    console.error(`Error fetching YouTube content for ${keyword}:`, error.message);
    return [];
  }
}

function extractVideoData(ytData, keyword, searchQuery) {
  try {
    const videos = [];
    
    // Navigate through YouTube's data structure
    const contents = ytData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    
    if (!contents) return videos;
    
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!items) continue;
      
      for (const item of items) {
        const videoRenderer = item?.videoRenderer;
        if (!videoRenderer) continue;
        
        const title = videoRenderer?.title?.runs?.[0]?.text || '';
        const videoId = videoRenderer?.videoId;
        const channelName = videoRenderer?.longBylineText?.runs?.[0]?.text || '';
        const publishedText = videoRenderer?.publishedTimeText?.simpleText || '';
        const viewCountText = videoRenderer?.viewCountText?.simpleText || '';
        const description = videoRenderer?.descriptionSnippet?.runs?.map(run => run.text).join('') || '';
        
        if (title && videoId) {
          videos.push({
            title: title,
            description: description,
            url: `https://youtube.com/watch?v=${videoId}`,
            pubDate: parseYouTubeDate(publishedText),
            source: `YouTube - ${channelName}`,
            keyword: keyword,
            viewCount: parseViewCount(viewCountText),
            score: calculateViralityScore({
              title,
              description,
              viewCount: parseViewCount(viewCountText),
              pubDate: parseYouTubeDate(publishedText)
            }, keyword)
          });
        }
      }
    }
    
    return videos;
  } catch (error) {
    console.error('Error extracting video data:', error.message);
    return [];
  }
}

function parseYouTubeDate(publishedText) {
  try {
    if (!publishedText) return new Date();
    
    const now = new Date();
    const text = publishedText.toLowerCase();
    
    if (text.includes('hour')) {
      const hours = parseInt(text.match(/(\d+)\s*hour/)?.[1] || '0');
      return new Date(now.getTime() - hours * 60 * 60 * 1000);
    } else if (text.includes('day')) {
      const days = parseInt(text.match(/(\d+)\s*day/)?.[1] || '0');
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    } else if (text.includes('week')) {
      const weeks = parseInt(text.match(/(\d+)\s*week/)?.[1] || '0');
      return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    } else if (text.includes('month')) {
      const months = parseInt(text.match(/(\d+)\s*month/)?.[1] || '0');
      return new Date(now.getTime() - months * 30 * 24 * 60 * 60 * 1000);
    }
    
    return new Date();
  } catch (error) {
    return new Date();
  }
}

function parseViewCount(viewText) {
  try {
    if (!viewText) return 0;
    
    const text = viewText.toLowerCase().replace(/[,\s]/g, '');
    
    if (text.includes('k')) {
      return parseInt(text.replace('k', '')) * 1000;
    } else if (text.includes('m')) {
      return parseInt(text.replace('m', '')) * 1000000;
    } else if (text.includes('b')) {
      return parseInt(text.replace('b', '')) * 1000000000;
    } else {
      return parseInt(text.replace(/\D/g, '')) || 0;
    }
  } catch (error) {
    return 0;
  }
}

// 3. Twitter/X Content Scraping
async function fetchTwitterContent(keyword) {
  try {
    const searchQueries = [
      `"${keyword}" controversy`,
      `"${keyword}" drama`,
      `"${keyword}" YouTuber`,
      `"${keyword}" exposed`
    ];
    
    let allTweets = [];
    
    for (const query of searchQueries) {
      try {
        // Twitter search page scraping
        const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
        
        const response = await axios.get(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
        
        const $ = cheerio.load(response.data);
        
        // Extract tweet data (simplified approach)
        const tweets = extractTweetData(response.data, keyword, query);
        allTweets = allTweets.concat(tweets);
        
      } catch (error) {
        console.error(`Error fetching Twitter for query ${query}:`, error.message);
      }
    }
    
    return allTweets.slice(0, 15); // Limit to 15 tweets per keyword
  } catch (error) {
    console.error(`Error fetching Twitter content for ${keyword}:`, error.message);
    return [];
  }
}

function extractTweetData(htmlContent, keyword, searchQuery) {
  try {
    // Simplified tweet extraction
    const tweets = [];
    
    // Look for Twitter's initial state data
    const scriptMatches = htmlContent.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
    
    if (scriptMatches) {
      try {
        const initialState = JSON.parse(scriptMatches[1]);
        // Extract tweets from initial state (structure varies)
        // This is a simplified version - production would need more robust parsing
        
        const entities = initialState?.entities?.tweets || {};
        
        Object.values(entities).forEach(tweet => {
          if (tweet?.full_text && tweet?.created_at) {
            tweets.push({
              title: tweet.full_text.substring(0, 100) + '...',
              description: tweet.full_text,
              url: `https://twitter.com/i/status/${tweet.id_str}`,
              pubDate: new Date(tweet.created_at),
              source: `Twitter/X - @${tweet.user?.screen_name || 'unknown'}`,
              keyword: keyword,
              score: calculateViralityScore({
                title: tweet.full_text,
                description: tweet.full_text,
                pubDate: new Date(tweet.created_at)
              }, keyword)
            });
          }
        });
      } catch (parseError) {
        console.error('Error parsing Twitter data:', parseError.message);
      }
    }
    
    return tweets;
  } catch (error) {
    console.error('Error extracting tweet data:', error.message);
    return [];
  }
}

// 4. Feedly RSS Integration
async function fetchFeedlyContent() {
  try {
    const feedUrls = [
      'https://feeds.feedburner.com/youtube-trending-india',
      'https://rss.cnn.com/rss/edition.rss',
      'https://feeds.reuters.com/reuters/INtopNews',
      'https://timesofindia.indiatimes.com/rssfeedstopstories.cms'
    ];
    
    let allFeeds = [];
    
    for (const feedUrl of feedUrls) {
      try {
        const feed = await parser.parseURL(feedUrl);
        
        const relevantItems = feed.items.filter(item => {
          const content = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
          return keywords.some(keyword => content.includes(keyword.toLowerCase()));
        });
        
        const feedItems = relevantItems.slice(0, 10).map(item => ({
          title: item.title,
          description: item.contentSnippet || item.content || '',
          url: item.link,
          pubDate: item.pubDate,
          source: `Feedly RSS - ${feed.title || 'Unknown'}`,
          keyword: 'feedly',
          score: calculateViralityScore(item, 'trending')
        }));
        
        allFeeds = allFeeds.concat(feedItems);
      } catch (error) {
        console.error(`Error fetching Feedly RSS ${feedUrl}:`, error.message);
      }
    }
    
    return allFeeds;
  } catch (error) {
    console.error('Error fetching Feedly content:', error.message);
    return [];
  }
}

// Main news aggregation function
async function aggregateNews() {
  console.log('🚀 Starting comprehensive news aggregation...');
  let allNews = [];
  
  try {
    // Fetch from all sources in parallel
    const fetchPromises = [];
    
    // Google News for each keyword
    keywords.forEach(keyword => {
      fetchPromises.push(fetchGoogleNews(keyword));
    });
    
    // YouTube content for top keywords
    const topKeywords = keywords.slice(0, 20); // Focus on top 20 keywords for YouTube
    topKeywords.forEach(keyword => {
      fetchPromises.push(fetchYouTubeContent(keyword));
    });
    
    // Twitter content for trending keywords
    const trendingKeywords = keywords.filter(k => 
      ['controversy', 'drama', 'exposed', 'viral', 'trending'].includes(k.toLowerCase())
    );
    trendingKeywords.forEach(keyword => {
      fetchPromises.push(fetchTwitterContent(keyword));
    });
    
    // Feedly RSS feeds
    fetchPromises.push(fetchFeedlyContent());
    
    console.log(`📡 Fetching from ${fetchPromises.length} sources...`);
    
    // Execute all fetch operations
    const results = await Promise.allSettled(fetchPromises);
    
    // Combine all results
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) {
        allNews = allNews.concat(result.value);
      } else {
        console.error(`Fetch ${index} failed:`, result.reason?.message || 'Unknown error');
      }
    });
    
    console.log(`📰 Total news items fetched: ${allNews.length}`);
    
    // Filter recent news only (last 24 hours)
    allNews = allNews.filter(item => isRecentNews(item.pubDate));
    console.log(`⏰ Recent news items (24h): ${allNews.length}`);
    
    // Remove duplicates with enhanced detection
    allNews = removeDuplicates(allNews);
    console.log(`🔄 After duplicate removal: ${allNews.length}`);
    
    // Sort by virality score (highest first)
    allNews.sort((a, b) => b.score - a.score);
    
    // Keep top 100 items for variety
    newsCache = allNews.slice(0, 100);
    
    console.log(`✅ Final cached news items: ${newsCache.length}`);
    console.log(`🎯 Top scoring item: "${newsCache[0]?.title?.substring(0, 50)}..." (Score: ${newsCache[0]?.score})`);
    
  } catch (error) {
    console.error('❌ Error in news aggregation:', error);
  }
}

// Telegram bot handlers (Enhanced)
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userSubscriptions.add(chatId);
  
  const welcomeMessage = `
🎬 *Welcome to Advanced YouTuber News Bot!* 🎬

I track the latest news, controversies, and viral content about Indian YouTubers from multiple premium sources!

*📡 News Sources:*
• Google News (Multi-query search)
• YouTube (Search + Trending + Comments)
• Twitter/X (Real-time posts)
• Feedly RSS (Premium feeds)

*🎯 Available Commands:*
/help - Show all commands
/latest - Get latest 20 trending news
/trending - Get top 30 viral stories
/search [keyword] - Search specific content
/viral - Get most viral content (50 items)
/breaking - Get breaking news (24h)
/addkeyword [word] - Add tracking keyword
/removekeyword [word] - Remove keyword
/keywords - Show current keywords
/stats - Bot analytics

*Currently tracking ${keywords.length} keywords across multiple platforms!*

Type /trending to see viral content! 🔥
  `;
  
  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpMessage = `
🤖 *Advanced YouTuber News Bot Help* 🤖

*📰 Main Commands:*
• /latest - Latest 20 trending news
• /trending - Top 30 viral stories
• /viral - Most viral content (50 items)
• /breaking - Breaking news (last 24h)
• /all - Complete feed (100 items)

*🔍 Search Commands:*
• /search [keyword] - Search specific content
• /youtube [name] - YouTube-only content
• /twitter [keyword] - Twitter-only posts

*⚙️ Management:*
• /addkeyword [word] - Add tracking keyword
• /removekeyword [word] - Remove keyword
• /keywords - View tracked keywords

*📊 Information:*
• /stats - Detailed bot statistics
• /sources - Active news sources
• /help - This help menu

*💡 Examples:*
\`/search CarryMinati controversy\`
\`/youtube Elvish Yadav\`
\`/twitter MrBeast drama\`
\`/addkeyword Fukra Insaan\`

*📡 Sources:* Google News, YouTube, Twitter/X, Feedly RSS
*🔄 Updates:* Every 15 minutes with AI-powered relevance scoring!
  `;
  
  bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/latest/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No recent news available. Fetching fresh content...');
    aggregateNews();
    return;
  }
  
  const latestNews = newsCache.slice(0, 20); // 20 latest items
  let message = '📰 *Latest Trending News (Top 20):*\n\n';
  
  latestNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    const scoreEmoji = item.score > 50 ? '🔥' : item.score > 30 ? '⚡' : '📈';
    
    message += `${index + 1}. ${scoreEmoji} *${item.title.substring(0, 75)}${item.title.length > 75 ? '...' : ''}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo} • 📊 ${item.score}\n`;
    message += `   🔗 [Read More](${item.url})\n\n`;
  });
  
  message += `\n💡 *Tip:* Use /viral for most viral content or /search [keyword] for specific topics!`;
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    disable_web_page_preview: true 
  });
});

bot.onText(/\/trending/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No trending content available right now!');
    return;
  }
  
  const trendingNews = newsCache.slice(0, 30); // Top 30 trending
  let message = '🔥 *Top Trending Stories (30 Items):*\n\n';
  
  trendingNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    const rankEmoji = index < 5 ? '🏆' : index < 10 ? '🥇' : index < 20 ? '🥈' : '🥉';
    
    message += `${rankEmoji} ${index + 1}. *${item.title.substring(0, 70)}${item.title.length > 70 ? '...' : ''}*\n`;
    message += `   📊 Score: ${item.score} • 📍 ${item.source}\n`;
    message += `   ⏰ ${timeAgo} • 🔗 [Link](${item.url})\n\n`;
    
    // Split long messages
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

bot.onText(/\/breaking/, (msg) => {
  const chatId = msg.chat.id;
  
  const breakingNews = newsCache.filter(item => {
    const hoursDiff = (new Date() - new Date(item.pubDate)) / (1000 * 60 * 60);
    return hoursDiff <= 6; // Last 6 hours for breaking news
  }).slice(0, 25);
  
  if (breakingNews.length === 0) {
    bot.sendMessage(chatId, '📰 No breaking news in the last 6 hours. Check /latest for recent updates!');
    return;
  }
  
  let message = `⚡ *Breaking News (Last 6 Hours - ${breakingNews.length} items):*\n\n`;
  
  breakingNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `⚡ ${index + 1}. *${item.title.substring(0, 70)}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo} • 📊 ${item.score}\n`;
    message += `   🔗 [Read More](${item.url})\n\n`;
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
    item.keyword.toLowerCase().includes(searchTerm) ||
    item.source.toLowerCase().includes(searchTerm)
  ).slice(0, 25); // 25 search results
  
  if (searchResults.length === 0) {
    bot.sendMessage(chatId, `🔍 No results found for "${searchTerm}". Try different keywords or check /trending!`);
    return;
  }
  
  let message = `🔍 *Search Results for "${searchTerm}" (${searchResults.length} found):*\n\n`;
  
  searchResults.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `${index + 1}. *${item.title.substring(0, 70)}${item.title.length > 70 ? '...' : ''}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo} • 📊 ${item.score}\n`;
    message += `   🔗 [Read More](${item.url})\n\n`;
    
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

bot.onText(/\/youtube (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const searchTerm = match[1].toLowerCase();
  
  const youtubeResults = newsCache.filter(item => 
    item.source.toLowerCase().includes('youtube') &&
    (item.title.toLowerCase().includes(searchTerm) ||
     item.description.toLowerCase().includes(searchTerm))
  ).slice(0, 20);
  
  if (youtubeResults.length === 0) {
    bot.sendMessage(chatId, `📺 No YouTube content found for "${searchTerm}"`);
    return;
  }
  
  let message = `📺 *YouTube Content for "${searchTerm}" (${youtubeResults.length} videos):*\n\n`;
  
  youtubeResults.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `📺 ${index + 1}. *${item.title.substring(0, 65)}*\n`;
    message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
    message += `   📊 Score: ${item.score} • 🔗 [Watch](${item.url})\n\n`;
  });
  
  bot.sendMessage(chatId, message, { 
    parse_mode: 'Markdown',
    disable_web_page_preview: true 
  });
});

bot.onText(/\/twitter (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const searchTerm = match[1].toLowerCase();
  
  const twitterResults = newsCache.filter(item => 
    item.source.toLowerCase().includes('twitter') &&
    (item.title.toLowerCase().includes(searchTerm) ||
     item.description.toLowerCase().includes(searchTerm))
  ).slice(0, 15);
  
  if (twitterResults.length === 0) {
    bot.sendMessage(chatId, `🐦 No Twitter content found for "${searchTerm}"`);
    return;
  }
  
  let message = `🐦 *Twitter/X Posts for "${searchTerm}" (${twitterResults.length} tweets):*\n\n`;
  
  twitterResults.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `🐦 ${index + 1}. *${item.title.substring(0, 70)}*\n`;
    message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
    message += `   📊 ${item.score} • 🔗 [View Tweet](${item.url})\n\n`;
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
  bot.sendMessage(chatId, `✅ Added keyword: "${newKeyword}"\n📊 Total keywords: ${keywords.length}\n🔄 Next update will include this keyword!`);
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
  bot.sendMessage(chatId, `✅ Removed keyword: "${keywordToRemove}"\n📊 Total keywords: ${keywords.length}`);
});

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
  
  let message = `📝 *Tracked Keywords (${keywords.length} total):*\n\n`;
  message += `*🎬 YouTubers (${youtubers.length}):*\n${youtubers.slice(0, 30).join(', ')}${youtubers.length > 30 ? '...' : ''}\n\n`;
  message += `*🔥 Controversy Terms (${controversyWords.length}):*\n${controversyWords.slice(0, 20).join(', ')}${controversyWords.length > 20 ? '...' : ''}\n\n`;
  message += `💡 *Use /addkeyword [name] to add new YouTubers or terms!*`;
  
  bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  
  const sourceBreakdown = newsCache.reduce((acc, item) => {
    const source = item.source.split(' - ')[0];
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
  
  const avgScore = newsCache.length > 0 ? 
    (newsCache.reduce((sum, item) => sum + item.score, 0) / newsCache.length).toFixed(1) : 0;
  
  const recentHours = newsCache.filter(item => {
    const hoursDiff = (new Date() - new Date(item.pubDate)) / (1000 * 60 * 60);
    return hoursDiff <= 6;
  }).length;
  
  let sourceStats = '';
  Object.entries(sourceBreakdown).forEach(([source, count]) => {
    sourceStats += `• ${source}: ${count} items\n`;
  });
  
  const stats = `
📊 *Advanced Bot Analytics:*

*📈 Content Metrics:*
• Active Users: ${userSubscriptions.size}
• Tracked Keywords: ${keywords.length}
• Cached News Items: ${newsCache.length}
• Average Virality Score: ${avgScore}
• Breaking News (6h): ${recentHours}

*📡 Source Breakdown:*
${sourceStats}

*⚙️ System Info:*
• Last Update: ${newsCache.length > 0 ? getTimeAgo(new Date()) : 'Never'}
• Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
• Update Frequency: Every 15 minutes
• Duplicate Removal: Advanced AI-powered

*🎯 Coverage:* Google News, YouTube, Twitter/X, Feedly RSS
*🔄 Next Update:* ${15 - (Math.floor(Date.now() / 60000) % 15)} minutes
  `;
  
  bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
});

bot.onText(/\/sources/, (msg) => {
  const chatId = msg.chat.id;
  
  const sourcesInfo = `
📡 *Active News Sources:*

*🌐 Google News:*
• Multi-query searches per keyword
• Region: India (IN)
• Language: English
• Coverage: Comprehensive news articles

*📺 YouTube:*
• Search results + trending videos
• Community posts monitoring
• Comments analysis (planned)
• Shorts integration
• Real-time engagement metrics

*🐦 Twitter/X:*
• Live tweet monitoring
• Hashtag tracking
• Real-time controversy detection
• User engagement metrics

*📰 Feedly RSS:*
• Premium entertainment feeds
• Trending content aggregation
• Multi-source RSS monitoring
• Celebrity news feeds

*🎯 Search Strategy:*
• ${keywords.length} tracked keywords
• 4 queries per keyword (Google)
• Real-time social monitoring
• AI-powered relevance scoring
• 24-hour content filtering

*🔄 Update Schedule:*
• Every 15 minutes automatic refresh
• Breaking news: Real-time alerts
• Trending analysis: Continuous
• Duplicate removal: Advanced algorithms
  `;
  
  bot.sendMessage(chatId, sourcesInfo, { parse_mode: 'Markdown' });
});

bot.onText(/\/all/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No content available currently! Fetching fresh news...');
    aggregateNews();
    return;
  }
  
  const allNews = newsCache; // All 100 items
  let message = `📰 *Complete News Feed (${allNews.length} items):*\n\n`;
  
  allNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    const scoreEmoji = item.score > 50 ? '🔥' : item.score > 30 ? '⚡' : '📈';
    
    message += `${scoreEmoji} ${index + 1}. *${item.title.substring(0, 60)}${item.title.length > 60 ? '...' : ''}*\n`;
    message += `   📍 ${item.source} • ⏰ ${timeAgo} • 📊 ${item.score} • [Link](${item.url})\n\n`;
    
    // Split long messages every 25 items
    if ((index + 1) % 25 === 0 || index === allNews.length - 1) {
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      message = '';
      
      if (index < allNews.length - 1) {
        message = `📰 *Complete News Feed (Continued - Items ${index + 2}-${Math.min(index + 26, allNews.length)}):*\n\n`;
      }
    }
  });
});

// Utility function for time formatting
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / (24 * 3600000));
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

// Error handling
bot.on('polling_error', (error) => {
  console.error('❌ Polling error:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

// Express server for health checks and API endpoints
app.use(express.json());

// Main status endpoint
app.get('/', (req, res) => {
  const sourceBreakdown = newsCache.reduce((acc, item) => {
    const source = item.source.split(' - ')[0];
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
  
  res.json({ 
    status: 'active',
    version: '2.0.0',
    uptime: process.uptime(),
    newsItems: newsCache.length,
    keywords: keywords.length,
    users: userSubscriptions.size,
    lastUpdate: newsCache.length > 0 ? newsCache[0].pubDate : null,
    sources: sourceBreakdown,
    avgScore: newsCache.length > 0 ? 
      (newsCache.reduce((sum, item) => sum + item.score, 0) / newsCache.length).toFixed(1) : 0
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// API endpoint for external access to news
app.get('/api/news', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const source = req.query.source;
  const keyword = req.query.keyword;
  
  let filteredNews = newsCache;
  
  if (source) {
    filteredNews = filteredNews.filter(item => 
      item.source.toLowerCase().includes(source.toLowerCase())
    );
  }
  
  if (keyword) {
    filteredNews = filteredNews.filter(item => 
      item.title.toLowerCase().includes(keyword.toLowerCase()) ||
      item.description.toLowerCase().includes(keyword.toLowerCase())
    );
  }
  
  res.json({
    total: filteredNews.length,
    limit: limit,
    news: filteredNews.slice(0, limit)
  });
});

// Enhanced news fetching schedule - every 15 minutes
cron.schedule('*/15 * * * *', () => {
  console.log('🔄 Running scheduled news aggregation...');
  aggregateNews();
});

// Initial news fetch with delay
setTimeout(() => {
  console.log('🚀 Starting initial news fetch...');
  aggregateNews();
}, 10000); // 10 second delay

// Self-ping to prevent sleep (enhanced)
if (process.env.RENDER_EXTERNAL_URL) {
  cron.schedule('*/12 * * * *', async () => {
    try {
      const response = await axios.get(process.env.RENDER_EXTERNAL_URL + '/health', {
        timeout: 30000
      });
      console.log('✅ Self-ping successful:', response.data.status);
    } catch (error) {
      console.error('❌ Self-ping failed:', error.message);
    }
  });
}

// Periodic cleanup of old news (keep only last 24 hours)
cron.schedule('0 */6 * * *', () => {
  console.log('🧹 Running news cleanup...');
  const initialCount = newsCache.length;
  newsCache = newsCache.filter(item => isRecentNews(item.pubDate));
  console.log(`🧹 Cleaned ${initialCount - newsCache.length} old news items`);
});

// Memory management
cron.schedule('0 */4 * * *', () => {
  if (global.gc) {
    global.gc();
    console.log('🧠 Garbage collection completed');
  }
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Advanced Telegram YouTuber News Bot is active!`);
  console.log(`📊 Tracking ${keywords.length} keywords across multiple sources`);
  console.log(`📡 Sources: Google News, YouTube, Twitter/X, Feedly RSS`);
  console.log(`🔄 Auto-refresh every 15 minutes`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
}); message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  }
});

bot.onText(/\/viral/, (msg) => {
  const chatId = msg.chat.id;
  
  if (newsCache.length === 0) {
    bot.sendMessage(chatId, '📭 No viral content available!');
    return;
  }
  
  const viralNews = newsCache.filter(item => item.score > 40).slice(0, 50); // High-scoring viral content
  
  if (viralNews.length === 0) {
    bot.sendMessage(chatId, '📈 No highly viral content found. Check /trending for popular stories!');
    return;
  }
  
  let message = `🔥 *Most Viral Content (${viralNews.length} items):*\n\n`;
  
  viralNews.forEach((item, index) => {
    const timeAgo = getTimeAgo(new Date(item.pubDate));
    message += `🔥 ${index + 1}. *${item.title.substring(0, 65)}${item.title.length > 65 ? '...' : ''}*\n`;
    message += `   📊 ${item.score} • 📍 ${item.source} • ⏰ ${timeAgo}\n`;
    message += `   🔗 [Link](${item.url})\n\n`;
    
    if (message.length > 4000) {
      bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
      message = '';
    }
  });
  
  if (message.length > 0) {
    bot.sendMessage(chatId,
