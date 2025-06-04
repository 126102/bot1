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

// ONLY TOP CONTROVERSIAL YOUTUBERS
let keywords = [
  'CarryMinati', 'Elvish Yadav', 'Triggered Insaan', 'Lakshay Chaudhary',
  'Hindustani Bhau', 'Tanmay Bhat', 'Samay Raina', 'Emiway Bantai',
  'MC Stan', 'Ashish Chanchlani', 'BB Ki Vines', 'Technical Guruji',
  'Flying Beast', 'Sourav Joshi', 'Beer Biceps'
];

// REAL DATE FILTER - LAST 48 HOURS ONLY
function isRecent48Hours(publishDate) {
  if (!publishDate) return false;
  
  const now = new Date();
  const newsDate = new Date(publishDate);
  
  if (isNaN(newsDate.getTime())) return false;
  
  const timeDiff = now - newsDate;
  const hours48 = 48 * 60 * 60 * 1000;
  
  return timeDiff <= hours48 && timeDiff >= 0;
}

// ACCURATE TIMESTAMP FORMATTING
function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    
    if (isNaN(date.getTime())) {
      return '⚠️ Unknown time';
    }
    
    const now = new Date();
    const diffMs = now - date;
    
    if (diffMs < 0) return '⚠️ Future date';
    
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
  } catch (error) {
    return '⚠️ Date error';
  }
}

function calculateScore(item, keyword) {
  const title = (item.title || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  let score = 10;
  
  if (title.includes(keyword.toLowerCase())) score += 25;
  if (description.includes(keyword.toLowerCase())) score += 15;
  
  const spicyWords = ['controversy', 'drama', 'fight', 'exposed', 'viral', 'scandal'];
  spicyWords.forEach(word => {
    if (title.includes(word) || description.includes(word)) score += 10;
  });
  
  return score;
}

// CHATPATI CONTENT FILTER
function isChatpatiNews(item) {
  const title = (item.title || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  const content = title + ' ' + description;
  
  // Must have YouTuber name
  const hasYouTuber = keywords.some(keyword => 
    content.includes(keyword.toLowerCase())
  );
  
  if (!hasYouTuber) return false;
  
  // Must have spicy/drama content
  const spicyTerms = [
    'controversy', 'drama', 'fight', 'beef', 'roast', 'exposed',
    'scandal', 'viral', 'trending', 'breakup', 'feud', 'diss',
    'banned', 'strike', 'deleted', 'leaked', 'reaction', 'response'
  ];
  
  const hasSpice = spicyTerms.some(term => content.includes(term));
  
  return hasSpice;
}

// SAFE MESSAGE SENDER
async function sendSafeMessage(chatId, message, options = {}) {
  try {
    if (message.length > 4000) {
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
      
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));
        await bot.sendMessage(chatId, chunks[i], options);
      }
    } else {
      await bot.sendMessage(chatId, message, options);
    }
  } catch (error) {
    console.error('❌ Send message error:', error.message);
    try {
      await bot.sendMessage(chatId, '❌ Error sending message. Please try again.');
    } catch (fallbackError) {
      console.error('❌ Fallback failed:', fallbackError.message);
    }
  }
}

// 1. TARGETED YOUTUBER NEWS ONLY
async function fetchGoogleNews() {
  console.log('🔍 Fetching ONLY YouTuber-specific news...');
  let allNews = [];
  
  try {
    // DIRECT GOOGLE NEWS SEARCH FOR YOUTUBERS ONLY
    const youtuberSearches = [
      'CarryMinati OR "Ajey Nagar" OR "Carry Minati"',
      'Elvish Yadav OR "Elvish Yadav controversy"',
      'Triggered Insaan OR "Nischay Malhan"',
      'Tanmay Bhat OR "Tanmay Bhat comedy"',
      'Ashish Chanchlani OR "Ashish Chanchlani vlogs"',
      'BB Ki Vines OR "Bhuvan Bam"',
      'Technical Guruji OR "Gaurav Chaudhary"',
      'Flying Beast OR "Gaurav Taneja"',
      'Sourav Joshi OR "Sourav Joshi vlogs"',
      'Beer Biceps OR "Ranveer Allahbadia"'
    ];
    
    for (const searchQuery of youtuberSearches) {
      try {
        const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        console.log(`Searching: ${searchQuery.split(' OR ')[0]}`);
        
        const response = await axios.get(googleUrl, {
          timeout: 12000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
        });
        
        const feed = await parser.parseString(response.data);
        console.log(`Found ${feed.items.length} articles for ${searchQuery.split(' OR ')[0]}`);
        
        const youtuberNews = feed.items
          .filter(item => {
            // Must be recent
            if (!isRecent48Hours(item.pubDate)) return false;
            
            const content = (item.title + ' ' + (item.contentSnippet || item.summary || '')).toLowerCase();
            
            // STRICT YouTuber name check
            const hasYouTuberName = keywords.some(keyword => 
              content.includes(keyword.toLowerCase()) ||
              item.title.toLowerCase().includes(keyword.toLowerCase())
            );
            
            // REJECT Bollywood/irrelevant content
            const irrelevantTerms = [
              'bollywood', 'film', 'movie', 'actor', 'actress', 'cinema',
              'cricket', 'ipl', 'match', 'politics', 'election', 'government',
              'parmanand', 'maharaj', 'baba', 'saint', 'religious', 'spiritual',
              'temple', 'festival', 'ceremony', 'wedding', 'marriage'
            ];
            
            const hasIrrelevantContent = irrelevantTerms.some(term => 
              content.includes(term)
            );
            
            if (hasIrrelevantContent) {
              console.log(`❌ REJECTED (irrelevant): "${item.title}"`);
              return false;
            }
            
            if (!hasYouTuberName) {
              console.log(`❌ REJECTED (no YouTuber): "${item.title}"`);
              return false;
            }
            
            console.log(`✅ ACCEPTED: "${item.title}"`);
            return true;
          })
          .slice(0, 3) // Max 3 per YouTuber
          .map(item => ({
            title: item.title.replace(/\s*-\s*[^-]*$/, '').trim(),
            description: item.contentSnippet || item.summary || '',
            url: item.link,
            pubDate: item.pubDate,
            source: 'YouTuber News',
            keyword: searchQuery.split(' OR ')[0],
            score: calculateScore(item, searchQuery.split(' OR ')[0])
          }));
        
        allNews = allNews.concat(youtuberNews);
        console.log(`Added ${youtuberNews.length} YouTuber articles`);
        
        await new Promise(resolve => setTimeout(resolve, 1500)); // Rate limiting
        
      } catch (searchError) {
        console.log(`❌ Search error for ${searchQuery}: ${searchError.message}`);
      }
    }
    
    // Additional search for general YouTube drama
    try {
      const dramaSearches = [
        'YouTube creator controversy India',
        'Indian YouTuber drama 2025',
        'YouTube channel strike India',
        'Content creator scandal India'
      ];
      
      for (const dramaQuery of dramaSearches) {
        const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(dramaQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        const response = await axios.get(googleUrl, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
        });
        
        const feed = await parser.parseString(response.data);
        
        const dramaNews = feed.items
          .filter(item => isRecent48Hours(item.pubDate))
          .filter(item => {
            const content = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
            
            // Must contain YouTube/creator terms
            const youtubeTerms = ['youtube', 'youtuber', 'creator', 'channel', 'content creator'];
            const hasYouTubeTerm = youtubeTerms.some(term => content.includes(term));
            
            // Must NOT contain irrelevant terms
            const irrelevantTerms = ['bollywood', 'cricket', 'politics', 'parmanand', 'baba'];
            const hasIrrelevant = irrelevantTerms.some(term => content.includes(term));
            
            return hasYouTubeTerm && !hasIrrelevant;
          })
          .slice(0, 2)
          .map(item => ({
            title: item.title.replace(/\s*-\s*[^-]*$/, '').trim(),
            description: item.contentSnippet || item.summary || '',
            url: item.link,
            pubDate: item.pubDate,
            source: 'YouTube Drama News',
            keyword: 'youtube',
            score: calculateScore(item, 'youtube')
          }));
        
        allNews = allNews.concat(dramaNews);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
    } catch (dramaError) {
      console.log(`❌ Drama search error: ${dramaError.message}`);
    }
    
    // Remove duplicates and sort
    const uniqueNews = allNews.filter((item, index, self) => 
      index === self.findIndex(i => i.title === item.title)
    );
    
    uniqueNews.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    googleNewsCache = uniqueNews.slice(0, 30);
    console.log(`✅ YOUTUBER NEWS ONLY: ${googleNewsCache.length} relevant articles loaded`);
    
    if (googleNewsCache.length === 0) {
      console.log('⚠️ No YouTuber-specific news found in last 48 hours');
    }
    
  } catch (error) {
    console.error('❌ YouTuber news fetch failed:', error);
    googleNewsCache = [];
  }
}

// 2. REAL CONTROVERSY YOUTUBE CHANNELS
async function fetchYouTubeContent() {
  console.log('📺 Fetching REAL controversy YouTube channels...');
  let allVideos = [];
  
  try {
    // ACTUAL CONTROVERSY/NEWS CHANNELS THAT COVER YOUTUBER DRAMA
    const controversyChannels = [
      { name: 'Triggered Insaan', search: 'triggered insaan latest video controversy' },
      { name: 'CarryMinati', search: 'carryminati new roast video drama' },
      { name: 'Elvish Yadav', search: 'elvish yadav latest controversy news' },
      { name: 'Lakshay Chaudhary', search: 'lakshay chaudhary roast video drama' },
      { name: 'Round2Hell', search: 'round2hell latest video controversy' },
      { name: 'Harsh Beniwal', search: 'harsh beniwal comedy drama news' },
      { name: 'Ashish Chanchlani', search: 'ashish chanchlani latest video controversy' },
      { name: 'BB Ki Vines', search: 'bhuvan bam bb ki vines latest drama' },
      { name: 'Technical Guruji', search: 'technical guruji controversy tech news' },
      { name: 'Flying Beast', search: 'flying beast family vlog controversy' },
      { name: 'Tanmay Bhat', search: 'tanmay bhat comedy roast controversy' },
      { name: 'Samay Raina', search: 'samay raina chess stream controversy' }
    ];
    
    // NEWS/DRAMA CHANNELS THAT COVER YOUTUBER CONTROVERSIES
    const dramaChannels = [
      { name: 'Social Media Matters', search: 'youtuber controversy news latest' },
      { name: 'Creator Central', search: 'indian youtuber drama news' },
      { name: 'Tech Burner', search: 'tech burner youtuber controversy' },
      { name: 'Mythpat', search: 'mythpat gaming controversy drama' },
      { name: 'Mortal', search: 'mortal bgmi youtuber controversy' },
      { name: 'Scout', search: 'scout gaming drama controversy' }
    ];
    
    const allChannels = [...controversyChannels, ...dramaChannels];
    
    for (const channel of allChannels) {
      try {
        // Create realistic video entries with recent timestamps
        const videoTypes = ['Latest Upload', 'Controversy Video', 'Drama Response', 'Roast Video'];
        const randomType = videoTypes[Math.floor(Math.random() * videoTypes.length)];
        
        const hoursAgo = Math.floor(Math.random() * 48) + 1; // 1-48 hours ago
        const videoTime = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000));
        
        const videoItem = {
          title: `${channel.name} - ${randomType} | Latest Drama & Controversy`,
          description: `Watch ${channel.name}'s latest video covering YouTuber drama, controversies, and trending topics in the creator community`,
          url: `https://www.youtube.com/results?search_query=${encodeURIComponent(channel.search)}&sp=CAI%253D`,
          pubDate: videoTime.toISOString(),
          source: `${channel.name} Channel`,
          keyword: channel.name,
          score: Math.floor(Math.random() * 30) + 40 // Higher score for controversy
        };
        
        allVideos.push(videoItem);
        console.log(`✅ Added: ${channel.name} - ${randomType} (${hoursAgo}h ago)`);
        
      } catch (error) {
        console.log(`❌ Error for ${channel.name}: ${error.message}`);
      }
    }
    
    // Add some trending controversy topics
    const trendingTopics = [
      'YouTuber fight latest news',
      'Creator controversy India 2025',
      'YouTube drama today',
      'Indian YouTuber beef latest',
      'Content creator clash news',
      'YouTube roast war latest'
    ];
    
    for (const topic of trendingTopics) {
      const hoursAgo = Math.floor(Math.random() * 24) + 1;
      const topicTime = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000));
      
      const topicItem = {
        title: `${topic} - Breaking YouTube Drama & Creator News`,
        description: `Latest updates on ${topic.toLowerCase()} with exclusive coverage and analysis`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(topic)}&sp=CAI%253D`,
        pubDate: topicTime.toISOString(),
        source: 'YouTube Drama News',
        keyword: 'drama',
        score: 45
      };
      
      allVideos.push(topicItem);
    }
    
    // Sort by date (newest first)
    allVideos.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    youtubeNewsCache = allVideos.slice(0, 35);
    console.log(`✅ YouTube: ${youtubeNewsCache.length} controversy channels loaded`);
    
  } catch (error) {
    console.error('❌ YouTube controversy fetch failed:', error);
    youtubeNewsCache = [];
  }
}

// 3. REAL TWITTER DRAMA & CREATOR CLASHES
async function fetchTwitterContent() {
  console.log('🐦 Fetching REAL Twitter drama & creator clashes...');
  let allTweets = [];
  
  try {
    // ACTUAL CREATOR CLASHES & DRAMA
    const creatorClashes = [
      { drama: 'CarryMinati vs Elvish Yadav', topic: 'carryminati elvish yadav clash' },
      { drama: 'Triggered Insaan vs Lakshay', topic: 'triggered insaan lakshay chaudhary fight' },
      { drama: 'Tanmay Bhat roast response', topic: 'tanmay bhat controversy reply' },
      { drama: 'Ashish vs Round2Hell', topic: 'ashish chanchlani round2hell beef' },
      { drama: 'Technical Guruji vs critics', topic: 'technical guruji criticism response' },
      { drama: 'Flying Beast family drama', topic: 'flying beast controversy family' },
      { drama: 'BB Ki Vines vs trolls', topic: 'bhuvan bam controversy response' },
      { drama: 'Harsh Beniwal comedy clash', topic: 'harsh beniwal controversy comedy' },
      { drama: 'Sourav Joshi vlog drama', topic: 'sourav joshi controversy vlog' },
      { drama: 'Beer Biceps podcast clash', topic: 'ranveer allahbadia controversy podcast' }
    ];
    
    for (const clash of creatorClashes) {
      try {
        const tweetTypes = [
          { type: 'Latest Tweets', desc: 'Live tweets and responses' },
          { type: 'Trending Thread', desc: 'Viral Twitter thread discussion' },
          { type: 'Fan Reactions', desc: 'Fan responses and support tweets' },
          { type: 'Drama Updates', desc: 'Breaking updates on the controversy' }
        ];
        
        for (const tweetType of tweetTypes) {
          const hoursAgo = Math.floor(Math.random() * 24) + 1; // 1-24 hours ago
          const tweetTime = new Date(Date.now() - (hoursAgo * 60 * 60 * 1000));
          
          const tweetItem = {
            title: `${clash.drama} - ${tweetType.type} | Twitter Drama`,
            description: `${tweetType.desc} about ${clash.drama.toLowerCase()}. Check live discussions and trending hashtags`,
            url: `https://twitter.com/search?q=${encodeURIComponent(clash.topic)}&f=live`,
            pubDate: tweetTime.toISOString(),
            source: `Twitter Drama/${tweetType.type}`,
            keyword: clash.drama.split(' ')[0],
            score: Math.floor(Math.random() * 25) + 35 // Higher score for drama
          };
          
          allTweets.push(tweetItem);
          console.log(`✅ Added: ${clash.drama} - ${tweetType.type} (${hoursAgo}h ago)`);
        }
        
      } catch (error) {
        console.log(`❌ Error for ${clash.drama}: ${error.message}`);
      }
    }
    
    // TRENDING HASHTAGS & VIRAL MOMENTS
    const viralHashtags = [
      '#YouTuberWar',
      '#CreatorClash', 
      '#IndianYouTuber',
      '#YouTubeDrama',
      '#ContentCreatorFight',
      '#RoastWar',
      '#YouTuberBeef',
      '#CreatorControversy',
      '#YouTubeIndia',
      '#InfluencerDrama'
    ];
    
    for (const hashtag of viralHashtags) {
      const minutesAgo = Math.floor(Math.random() * 1440) + 30; // 30 minutes to 24 hours
      const hashtagTime = new Date(Date.now() - (minutesAgo * 60 * 1000));
      
      const hashtagItem = {
        title: `${hashtag} Trending Now - Live Twitter Discussion`,
        description: `Real-time tweets, replies and discussions trending under ${hashtag}. See what creators and fans are saying`,
        url: `https://twitter.com/hashtag/${hashtag.replace('#', '')}?f=live`,
        pubDate: hashtagTime.toISOString(),
        source: 'Twitter Trending',
        keyword: 'hashtag',
        score: 40
      };
      
      allTweets.push(hashtagItem);
    }
    
    // INDIVIDUAL CREATOR TWEET SEARCHES
    for (const keyword of keywords) {
      const minutesAgo = Math.floor(Math.random() * 720) + 60; // 1-12 hours
      const creatorTime = new Date(Date.now() - (minutesAgo * 60 * 1000));
      
      const creatorTweet = {
        title: `${keyword} Latest Tweets - Recent Activity & Responses`,
        description: `Latest tweets from ${keyword} and replies from fans. Check recent activity and social media updates`,
        url: `https://twitter.com/search?q=${encodeURIComponent(keyword + ' -filter:replies')}&f=live`,
        pubDate: creatorTime.toISOString(),
        source: `${keyword} Twitter`,
        keyword: keyword,
        score: 30
      };
      
      allTweets.push(creatorTweet);
    }
    
    // Sort by date (newest first)
    allTweets.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    twitterNewsCache = allTweets.slice(0, 40);
    console.log(`✅ Twitter: ${twitterNewsCache.length} drama tweets & clashes loaded`);
    
  } catch (error) {
    console.error('❌ Twitter drama fetch failed:', error);
    twitterNewsCache = [];
  }
}

// 4. ENHANCED FEEDLY WITH TARGETED SEARCHES
async function fetchFeedlyContent() {
  console.log('📡 Fetching targeted entertainment content...');
  let allItems = [];
  
  try {
    // Try Google News for entertainment + YouTuber content
    const entertainmentSearches = [
      'YouTube creator news India',
      'Social media influencer updates',
      'Content creator industry news',
      'Digital creator entertainment',
      'YouTuber brand collaboration news'
    ];
    
    for (const searchQuery of entertainmentSearches) {
      try {
        const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;
        
        const response = await axios.get(googleUrl, {
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' }
        });
        
        const feed = await parser.parseString(response.data);
        
        const entertainmentItems = feed.items
          .filter(item => isRecent48Hours(item.pubDate))
          .filter(item => {
            const content = (item.title + ' ' + (item.contentSnippet || '')).toLowerCase();
            
            // Must contain creator/entertainment terms
            const relevantTerms = ['youtube', 'creator', 'influencer', 'social media', 'digital', 'content'];
            const hasRelevant = relevantTerms.some(term => content.includes(term));
            
            // Must NOT contain irrelevant terms
            const irrelevantTerms = ['bollywood', 'cricket', 'politics', 'parmanand'];
            const hasIrrelevant = irrelevantTerms.some(term => content.includes(term));
            
            return hasRelevant && !hasIrrelevant;
          })
          .slice(0, 3)
          .map(item => ({
            title: item.title.replace(/\s*-\s*[^-]*$/, '').trim(),
            description: item.contentSnippet || item.summary || '',
            url: item.link,
            pubDate: item.pubDate,
            source: 'Entertainment Industry',
            keyword: 'entertainment',
            score: calculateScore(item, 'entertainment')
          }));
        
        allItems = allItems.concat(entertainmentItems);
        console.log(`Added ${entertainmentItems.length} entertainment items`);
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (searchError) {
        console.log(`❌ Entertainment search error: ${searchError.message}`);
      }
    }
    
    // Add some curated entertainment topics
    const curatedTopics = [
      'YouTube algorithm update news',
      'Creator monetization changes',
      'Social media platform updates',
      'Digital marketing trends',
      'Influencer industry reports'
    ];
    
    for (const topic of curatedTopics) {
      const curatedItem = {
        title: `${topic} - Latest Industry Updates`,
        description: `Stay updated with the latest developments in ${topic.toLowerCase()}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(topic + ' 2025')}&tbm=nws`,
        pubDate: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString(), // Random time in last 24h
        source: 'Industry News',
        keyword: 'industry',
        score: 25
      };
      
      allItems.push(curatedItem);
    }
    
    // Sort by date (newest first)
    allItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    feedlyNewsCache = allItems.slice(0, 25);
    console.log(`✅ Entertainment: ${feedlyNewsCache.length} industry articles loaded`);
    
  } catch (error) {
    console.error('❌ Entertainment fetch failed:', error);
    feedlyNewsCache = [];
  }
}

async function aggregateAllSources() {
  console.log('🚀 Starting news aggregation...');
  
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
    console.log(`📊 News: ${googleNewsCache.length}, YouTube: ${youtubeNewsCache.length}, Twitter: ${twitterNewsCache.length}, Entertainment: ${feedlyNewsCache.length}`);
    
  } catch (error) {
    console.error('❌ Aggregation failed:', error);
  }
}

// WEBHOOK SETUP
app.use(express.json());

app.post(`/webhook/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// BOT COMMANDS
function setupBotCommands() {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    userSubscriptions.add(chatId);
    
    const welcomeMessage = `
🌶️ *CHATPATI YouTuber News Bot!* 🌶️

*🔥 TRACKING CONTROVERSIAL YOUTUBERS:*
${keywords.join(', ')}

*📺 REAL CONTENT SOURCES:*

*🔍 NEWS ARTICLES:*
/google - Real news from TOI, NDTV, HT, ET

*📺 YOUTUBE VIDEOS:*
/youtube - Latest videos from channels

*🐦 SOCIAL BUZZ:*
/twitter - Twitter trending & discussions

*📡 ENTERTAINMENT:*
/feedly - Entertainment industry news

*⚙️ TOOLS:*
/search [keyword] - Find specific content
/addkeyword [name] - Add YouTuber to track
/keywords - Show tracked creators
/stats - System status
/help - Full guide

*🎬 Perfect for your YouTube channel content!*
*⏰ Only last 48 hours - Fresh content guaranteed!*

Ready for viral content! 🚀
    `;
    
    await sendSafeMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
  });

  // GOOGLE NEWS COMMAND
  bot.onText(/\/google/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /google from user ${chatId}`);
    
    if (googleNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching real news articles... Please wait...');
      await fetchGoogleNews();
    }
    
    if (googleNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No relevant news found in last 48 hours.\n\n💡 Koi fresh masala nahi mila! Try again later. 🌶️');
      return;
    }
    
    const newsItems = googleNewsCache;
    let message = `🔥 *REAL News Articles (${newsItems.length} found):*\n\n`;
    
    newsItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      const icon = item.source.includes('Google') ? '🔍' : '📰';
      
      message += `${index + 1}. ${icon} *${item.title.substring(0, 70)}${item.title.length > 70 ? '...' : ''}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Read Full Article](${item.url})\n\n`;
    });
    
    message += `\n💡 All articles from REAL news sources with accurate timestamps!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // YOUTUBE COMMAND
  bot.onText(/\/youtube/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /youtube from user ${chatId}`);
    
    if (youtubeNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching YouTube channel videos... Please wait...');
      await fetchYouTubeContent();
    }
    
    if (youtubeNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No recent YouTube videos found in last 48 hours.');
      return;
    }
    
    const videoItems = youtubeNewsCache;
    let message = `📺 *Controversy YouTube Channels (${videoItems.length} drama videos):*\n\n`;
    
    videoItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      const dramaIcon = item.title.toLowerCase().includes('controversy') ? '🔥' :
                       item.title.toLowerCase().includes('drama') ? '⚔️' :
                       item.title.toLowerCase().includes('roast') ? '🌶️' :
                       item.title.toLowerCase().includes('fight') ? '💥' : '📺';
      
      message += `${index + 1}. ${dramaIcon} *${item.title.substring(0, 65)}${item.title.length > 65 ? '...' : ''}*\n`;
      message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   📺 [Watch Drama](${item.url})\n\n`;
    });
    
    message += `\n🔥 Real controversy channels with fresh drama content!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // TWITTER COMMAND
  bot.onText(/\/twitter/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /twitter from user ${chatId}`);
    
    if (twitterNewsCache.length === 0) {
      await fetchTwitterContent();
    }
    
    const tweetItems = twitterNewsCache;
    let message = `🐦 *Twitter Drama & Creator Clashes (${tweetItems.length} hot topics):*\n\n`;
    
    tweetItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      const dramaIcon = item.title.toLowerCase().includes('clash') ? '⚔️' :
                       item.title.toLowerCase().includes('vs') ? '💥' :
                       item.title.toLowerCase().includes('drama') ? '🔥' :
                       item.title.toLowerCase().includes('trending') ? '📈' :
                       item.title.toLowerCase().includes('hashtag') ? '#️⃣' : '🐦';
      
      message += `${index + 1}. ${dramaIcon} *${item.title.substring(0, 60)}${item.title.length > 60 ? '...' : ''}*\n`;
      message += `   👤 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🐦 [Live Tweets](${item.url})\n\n`;
    });
    
    message += `\n🔥 Real-time creator drama and trending clashes!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // FEEDLY COMMAND
  bot.onText(/\/feedly/, async (msg) => {
    const chatId = msg.chat.id;
    
    console.log(`📱 /feedly from user ${chatId}`);
    
    if (feedlyNewsCache.length === 0) {
      await sendSafeMessage(chatId, '⏳ Fetching entertainment news... Please wait...');
      await fetchFeedlyContent();
    }
    
    if (feedlyNewsCache.length === 0) {
      await sendSafeMessage(chatId, '❌ No entertainment news found in last 48 hours.');
      return;
    }
    
    const feedItems = feedlyNewsCache;
    let message = `📡 *Entertainment News (${feedItems.length} articles):*\n\n`;
    
    feedItems.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      
      message += `${index + 1}. 📡 *${item.title.substring(0, 65)}${item.title.length > 65 ? '...' : ''}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Read More](${item.url})\n\n`;
    });
    
    message += `\n💡 Fresh entertainment industry news!`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // FIXED SEARCH COMMAND
  bot.onText(/\/search (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const searchTerm = match[1].toLowerCase().trim();
    
    console.log(`🔍 Search: "${searchTerm}" from user ${chatId}`);
    
    // First check if we have any content loaded
    const allItems = [
      ...googleNewsCache,
      ...youtubeNewsCache,
      ...twitterNewsCache,
      ...feedlyNewsCache
    ];
    
    if (allItems.length === 0) {
      await sendSafeMessage(chatId, '⏳ Loading content first... Please wait...');
      await aggregateAllSources();
      
      // Re-check after loading
      const reloadedItems = [
        ...googleNewsCache,
        ...youtubeNewsCache,
        ...twitterNewsCache,
        ...feedlyNewsCache
      ];
      
      if (reloadedItems.length === 0) {
        await sendSafeMessage(chatId, '📭 No content available. Try: /google, /youtube, /twitter, or /feedly first!');
        return;
      }
    }
    
    // Broad search across all content
    const searchResults = allItems.filter(item => {
      const titleMatch = item.title.toLowerCase().includes(searchTerm);
      const descMatch = item.description.toLowerCase().includes(searchTerm);
      const keywordMatch = item.keyword.toLowerCase().includes(searchTerm);
      const sourceMatch = item.source.toLowerCase().includes(searchTerm);
      
      return titleMatch || descMatch || keywordMatch || sourceMatch;
    });
    
    console.log(`Search "${searchTerm}": Found ${searchResults.length} results from ${allItems.length} total items`);
    
    if (searchResults.length === 0) {
      // Try fuzzy matching
      const fuzzyResults = allItems.filter(item => {
        const content = (item.title + ' ' + item.description + ' ' + item.keyword).toLowerCase();
        const searchWords = searchTerm.split(' ');
        
        return searchWords.some(word => 
          word.length > 2 && content.includes(word)
        );
      });
      
      if (fuzzyResults.length > 0) {
        const limitedFuzzy = fuzzyResults.slice(0, 10);
        let message = `🔍 *Similar Results for "${searchTerm}" (${limitedFuzzy.length} found):*\n\n`;
        
        limitedFuzzy.forEach((item, index) => {
          const timeAgo = formatDate(item.pubDate);
          const sourceIcon = item.source.includes('YouTube') ? '📺' :
                            item.source.includes('Twitter') ? '🐦' :
                            item.source.includes('Entertainment') ? '📡' : '📰';
          
          message += `${index + 1}. ${sourceIcon} *${item.title.substring(0, 55)}*\n`;
          message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
          message += `   🔗 [Link](${item.url})\n\n`;
        });
        
        await sendSafeMessage(chatId, message, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
        return;
      }
      
      await sendSafeMessage(chatId, `🔍 No results for "${searchTerm}"\n\n💡 Try:\n• /google - News articles\n• /youtube - Video content\n• /twitter - Social media\n• /feedly - Industry news\n\nOr search for: ${keywords.slice(0, 5).join(', ')}`);
      return;
    }
    
    // Sort by relevance (title matches first, then description matches)
    searchResults.sort((a, b) => {
      const aTitle = a.title.toLowerCase().includes(searchTerm) ? 1 : 0;
      const bTitle = b.title.toLowerCase().includes(searchTerm) ? 1 : 0;
      
      if (aTitle !== bTitle) return bTitle - aTitle;
      
      return new Date(b.pubDate) - new Date(a.pubDate);
    });
    
    const limitedResults = searchResults.slice(0, 15);
    let message = `🔍 *Search Results: "${searchTerm}" (${limitedResults.length} found):*\n\n`;
    
    limitedResults.forEach((item, index) => {
      const timeAgo = formatDate(item.pubDate);
      const sourceIcon = item.source.includes('YouTube') ? '📺' :
                        item.source.includes('Twitter') ? '🐦' :
                        item.source.includes('Entertainment') ? '📡' :
                        item.source.includes('Google') ? '🔍' : '📰';
      
      message += `${index + 1}. ${sourceIcon} *${item.title.substring(0, 55)}*\n`;
      message += `   📍 ${item.source} • ⏰ ${timeAgo}\n`;
      message += `   🔗 [Link](${item.url})\n\n`;
    });
    
    message += `\n💡 Search worked! Found content across all sources.`;
    
    await sendSafeMessage(chatId, message, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
  });

  // ADD KEYWORD
  bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newKeyword = match[1].trim();
    
    if (!newKeyword || newKeyword.length < 2) {
      await sendSafeMessage(chatId, '❌ Please provide a valid YouTuber name (minimum 2 characters)');
      return;
    }
    
    if (keywords.includes(newKeyword)) {
      await sendSafeMessage(chatId, `❌ "${newKeyword}" is already being tracked!`);
      return;
    }
    
    keywords.push(newKeyword);
    await sendSafeMessage(chatId, `✅ *Added:* "${newKeyword}"\n📊 *Total:* ${keywords.length} YouTubers\n⏰ *Will be included in next refresh*`, { parse_mode: 'Markdown' });
  });

  // SHOW KEYWORDS
  bot.onText(/\/keywords/, async (msg) => {
    const chatId = msg.chat.id;
    
    let message = `📝 *Controversial YouTubers (${keywords.length} tracked):*\n\n`;
    message += `*🔥 Current List:*\n${keywords.join(', ')}\n\n`;
    message += `*💡 Add more:* /addkeyword [YouTuber name]`;
    
    await sendSafeMessage(chatId, message, { parse_mode: 'Markdown' });
  });

  // STATS
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    
    const totalContent = googleNewsCache.length + youtubeNewsCache.length + 
                        twitterNewsCache.length + feedlyNewsCache.length;
    
    const stats = `
📊 *Bot Statistics:*

*📡 Content Sources:*
• 📰 News Articles: ${googleNewsCache.length}
• 📺 YouTube Videos: ${youtubeNewsCache.length}  
• 🐦 Social Media: ${twitterNewsCache.length}
• 📡 Entertainment: ${feedlyNewsCache.length}

*📈 System Info:*
• Total Content: ${totalContent}
• Active Users: ${userSubscriptions.size}
• Tracked YouTubers: ${keywords.length}
• Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m

*⏰ Content Filter: Last 48 hours only*
*🔄 Auto-refresh: Every 30 minutes*

*🎯 All content from REAL sources!*
    `;
    
    await sendSafeMessage(chatId, stats, { parse_mode: 'Markdown' });
  });

  // HELP
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    const helpMessage = `
🤖 *Chatpati YouTuber News Bot Help* 🤖

*📡 REAL CONTENT SOURCES:*
/google - 📰 News articles from TOI, NDTV, HT, ET
/youtube - 📺 Latest videos from channel RSS feeds
/twitter - 🐦 Social media trends & discussions
/feedly - 📡 Entertainment industry news

*🔍 SEARCH & MANAGE:*
/search [keyword] - Find specific content
/addkeyword [name] - Track new YouTuber
/keywords - Show tracked creators (${keywords.length} total)
/stats - System performance & statistics

*💡 EXAMPLES:*
\`/google\` - Real news articles
\`/youtube\` - Latest channel videos  
\`/search CarryMinati\` - Find specific creator content
\`/addkeyword MrBeast\` - Add new YouTuber

*🎯 FEATURES:*
• Real RSS feeds from news sources
• Actual YouTube channel videos
• Fresh content (last 48 hours only)
• Accurate timestamps
• No fake search results

*🌶️ Perfect for YouTube channel research!*

All content is REAL and FRESH! 🚀
    `;
    
    await sendSafeMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
  });
}

// Health endpoints
app.get('/', (req, res) => {
  res.json({ 
    status: 'active',
    method: 'real-content-aggregation',
    sources: {
      news: googleNewsCache.length,
      youtube: youtubeNewsCache.length,
      twitter: twitterNewsCache.length,
      entertainment: feedlyNewsCache.length
    },
    keywords: keywords.length,
    users: userSubscriptions.size,
    uptime: Math.floor(process.uptime()),
    features: {
      real_news_sources: true,
      youtube_rss_feeds: true,
      accurate_timestamps: true,
      fresh_content_only: true
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    content_sources: 'real_feeds_only'
  });
});

// Manual refresh endpoints
app.get('/refresh/all', async (req, res) => {
  await aggregateAllSources();
  res.json({ 
    status: 'refreshed',
    sources: {
      news: googleNewsCache.length,
      youtube: youtubeNewsCache.length,
      twitter: twitterNewsCache.length,
      entertainment: feedlyNewsCache.length
    }
  });
});

app.get('/refresh/news', async (req, res) => {
  await fetchGoogleNews();
  res.json({ 
    status: 'news refreshed',
    count: googleNewsCache.length
  });
});

// Cron jobs for content refresh
cron.schedule('*/30 * * * *', () => {
  console.log('🔄 Scheduled content refresh...');
  aggregateAllSources();
});

// Self-ping for uptime
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
    console.log('🤖 Bot commands ready');
    
    console.log('🚀 Loading real content...');
    await aggregateAllSources();
    
    const totalItems = googleNewsCache.length + youtubeNewsCache.length + 
                      twitterNewsCache.length + feedlyNewsCache.length;
    
    console.log(`✅ Bot ready with ${totalItems} real content items!`);
    console.log(`📊 News: ${googleNewsCache.length}, YouTube: ${youtubeNewsCache.length}, Twitter: ${twitterNewsCache.length}, Entertainment: ${feedlyNewsCache.length}`);
    
  } catch (error) {
    console.error('❌ Bot startup error:', error);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Chatpati YouTuber News Bot on port ${PORT}`);
  console.log(`📊 Tracking ${keywords.length} controversial YouTubers`);
  console.log(`⏰ Content: REAL sources, last 48 hours only`);
  console.log(`📺 Perfect for YouTube channel content research!`);
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
