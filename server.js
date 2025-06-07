const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const FEEDLY_ACCESS_TOKEN = process.env.FEEDLY_ACCESS_TOKEN;

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Data storage
const DATA_FILE = path.join(__dirname, 'bot_data.json');

// Initialize data structure
const defaultData = {
    keywords: {
        youtuber: [],
        movies: [],
        national: [],
        pakistan: [],
        cricket: [],
        tech: [],
        entertainment: []
    },
    stats: {
        totalQueries: 0,
        keywordsAdded: 0,
        keywordsRemoved: 0,
        lastUpdated: null
    },
    rateLimitReset: null
};

// Rate limit handling
let isRateLimited = false;
let rateLimitResetTime = null;

// Load data from file
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        await saveData(defaultData);
        return defaultData;
    }
}

// Save data to file
async function saveData(data) {
    try {
        await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Feedly API configuration
const FEEDLY_BASE_URL = 'https://cloud.feedly.com/v3';

// Get available sections
function getSections() {
    return ['youtuber', 'movies', 'national', 'pakistan', 'cricket', 'tech', 'entertainment', 'latest'];
}

// Simple RSS feed search (backup when Feedly rate limited)
async function searchSimpleRSS(keywords) {
    try {
        // Use public RSS feeds as backup
        const feeds = [
            'https://feeds.bbci.co.uk/news/rss.xml',
            'https://rss.cnn.com/rss/edition.rss',
            'https://feeds.reuters.com/reuters/topNews'
        ];
        
        const articles = [];
        for (const feed of feeds.slice(0, 1)) { // Limit to 1 feed to avoid rate limits
            try {
                const response = await axios.get(feed, { timeout: 5000 });
                // Basic XML parsing for RSS
                const items = response.data.match(/<item>([\s\S]*?)<\/item>/g) || [];
                
                for (const item of items.slice(0, 5)) {
                    const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/, '$1');
                    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
                    const description = (item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/, '$1');
                    
                    const content = (title + ' ' + description).toLowerCase();
                    const hasKeyword = keywords.some(keyword => {
                        const keywordLower = keyword.toLowerCase();
                        const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                        return regex.test(content);
                    });
                    
                    if (hasKeyword) {
                        articles.push({
                            title: title,
                            alternate: [{ href: link }],
                            published: Date.now(),
                            origin: { title: 'RSS Feed' }
                        });
                    }
                }
            } catch (feedError) {
                console.log('RSS feed error:', feedError.message);
            }
        }
        
        return articles;
    } catch (error) {
        console.error('RSS search error:', error);
        return [];
    }
}

// Fetch news from Feedly with rate limit handling
async function fetchFeedlyNews(keywords, section = null) {
    try {
        // Check if rate limited
        if (isRateLimited && rateLimitResetTime && Date.now() < rateLimitResetTime) {
            console.log('Rate limited, using RSS backup...');
            return await searchSimpleRSS(keywords);
        }

        const headers = {
            'Authorization': `Bearer ${FEEDLY_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        };

        // Use simpler endpoint to avoid rate limits
        const streamUrl = `${FEEDLY_BASE_URL}/streams/contents`;
        const streamParams = {
            streamId: 'user/' + await getUserId() + '/category/global.all',
            count: 20, // Reduced count
            ranked: 'newest'
        };

        const streamResponse = await axios.get(streamUrl, {
            headers,
            params: streamParams,
            timeout: 10000
        });

        const entries = streamResponse.data.items || [];

        // Filter entries for strict keyword matching
        const filteredEntries = entries.filter(entry => {
            const title = (entry.title || '').toLowerCase();
            const summary = (entry.summary?.content || '').toLowerCase();
            const content = title + ' ' + summary;

            return keywords.some(keyword => {
                const keywordLower = keyword.toLowerCase();
                const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                return regex.test(content);
            });
        });

        // Reset rate limit flag on success
        isRateLimited = false;
        rateLimitResetTime = null;

        return filteredEntries.slice(0, 8); // Limit results
    } catch (error) {
        console.error('Feedly API Error:', error.response?.data || error.message);
        
        // Handle rate limit
        if (error.response?.status === 429) {
            isRateLimited = true;
            const resetIn = error.response.data?.errorMessage?.match(/reset in (\d+)s/)?.[1];
            if (resetIn) {
                rateLimitResetTime = Date.now() + (parseInt(resetIn) * 1000);
                console.log(`Rate limited for ${resetIn} seconds, switching to RSS backup`);
            }
            
            // Use RSS backup when rate limited
            return await searchSimpleRSS(keywords);
        }
        
        throw new Error('Failed to fetch news from Feedly');
    }
}

// Get Feedly user ID
async function getUserId() {
    try {
        const headers = {
            'Authorization': `Bearer ${FEEDLY_ACCESS_TOKEN}`
        };
        
        const response = await axios.get(`${FEEDLY_BASE_URL}/profile`, { headers });
        return response.data.id;
    } catch (error) {
        console.error('Error getting user ID:', error);
        return 'default';
    }
}

// Format news articles for Telegram
function formatNewsArticles(articles, section) {
    if (!articles || articles.length === 0) {
        return `📰 No news found for ${section} section.`;
    }

    let message = `📰 *${section.toUpperCase()} NEWS*\n\n`;
    
    articles.forEach((article, index) => {
        const title = article.title || 'No title';
        const url = article.alternate?.[0]?.href || '#';
        const source = article.origin?.title || 'Unknown';

        message += `${index + 1}. *${title}*\n`;
        message += `🔗 [Read](${url})\n`;
        message += `📺 ${source}\n\n`;
    });

    return message;
}

// Express routes
app.get('/', (req, res) => {
    res.json({
        status: 'Feedly Bot Running!',
        timestamp: new Date().toISOString(),
        rateLimited: isRateLimited
    });
});

// Simple Commands
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    data.stats.totalQueries++;
    await saveData(data);

    const welcomeMessage = `🤖 *Feedly News Bot*

*Quick Commands:*
/add [section] [keywords] - Add keywords
/remove [section] [keyword] - Remove keyword
/list - Show keywords
/clear [section] - Clear section
/get [section] - Get news
/help - Commands guide

*Sections:* youtuber, movies, national, pakistan, cricket, tech, entertainment, latest

*Examples:*
\`/add cricket virat kohli\`
\`/add cricket virat,kohli,rohit\` (multiple)
\`/get cricket\`
\`/get latest\` (all news)`;

    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `🆘 *Simple Commands*

*Add Keywords:*
/add cricket virat kohli
/add movies bollywood,hollywood
/add youtuber mr beast,pewdiepie

*Manage:*
/remove cricket virat
/list - Show all keywords
/clear cricket - Clear section

*Get News:*
/get cricket - Section news
/get latest - All news

*Info:*
/stats - Statistics
/help - This guide

*Sections:* youtuber, movies, national, pakistan, cricket, tech, entertainment`;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Add keywords (multiple support)
bot.onText(/\/add (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        bot.sendMessage(chatId, '❌ Usage: /add [section] [keywords]\n\nExamples:\n/add cricket virat kohli\n/add cricket virat,kohli,rohit');
        return;
    }

    const section = parts[0].toLowerCase();
    const keywordsInput = parts.slice(1).join(' ');

    if (!getSections().includes(section) || section === 'latest') {
        bot.sendMessage(chatId, `❌ Invalid section. Use: ${getSections().filter(s => s !== 'latest').join(', ')}`);
        return;
    }

    const data = await loadData();
    
    if (!data.keywords[section]) {
        data.keywords[section] = [];
    }

    // Parse multiple keywords
    let keywords = [];
    if (keywordsInput.includes(',')) {
        // Comma separated: virat,kohli,rohit
        keywords = keywordsInput.split(',').map(k => k.trim()).filter(k => k.length > 0);
    } else {
        // Space separated or single keyword
        keywords = [keywordsInput.trim()];
    }

    let addedCount = 0;
    let existingCount = 0;
    
    for (const keyword of keywords) {
        if (keyword && !data.keywords[section].includes(keyword)) {
            data.keywords[section].push(keyword);
            addedCount++;
            data.stats.keywordsAdded++;
        } else if (keyword) {
            existingCount++;
        }
    }

    data.stats.lastUpdated = new Date().toISOString();
    await saveData(data);
    
    let response = `✅ Added ${addedCount} keyword(s) to ${section}`;
    if (existingCount > 0) {
        response += `\n⚠️ ${existingCount} already existed`;
    }
    response += `\nTotal in ${section}: ${data.keywords[section].length}`;
    
    bot.sendMessage(chatId, response);
});

// Remove keyword
bot.onText(/\/remove (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        bot.sendMessage(chatId, '❌ Usage: /remove [section] [keyword]');
        return;
    }

    const section = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ');

    const data = await loadData();
    
    if (!data.keywords[section] || !data.keywords[section].includes(keyword)) {
        bot.sendMessage(chatId, `❌ Keyword "${keyword}" not found in ${section}`);
        return;
    }

    data.keywords[section] = data.keywords[section].filter(k => k !== keyword);
    data.stats.keywordsRemoved++;
    data.stats.lastUpdated = new Date().toISOString();
    await saveData(data);
    
    bot.sendMessage(chatId, `✅ Removed "${keyword}" from ${section}\nRemaining: ${data.keywords[section].length}`);
});

// List keywords
bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();

    let message = '📋 *Keywords*\n\n';
    const sections = getSections().filter(s => s !== 'latest');
    let hasKeywords = false;

    sections.forEach(section => {
        const keywords = data.keywords[section] || [];
        if (keywords.length > 0) {
            hasKeywords = true;
            message += `*${section}* (${keywords.length}):\n${keywords.join(', ')}\n\n`;
        }
    });

    if (!hasKeywords) {
        message += 'No keywords yet.\nUse: /add [section] [keywords]';
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Clear section
bot.onText(/\/clear (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const section = match[1].trim().toLowerCase();

    if (!getSections().includes(section) || section === 'latest') {
        bot.sendMessage(chatId, `❌ Invalid section`);
        return;
    }

    const data = await loadData();
    const count = data.keywords[section] ? data.keywords[section].length : 0;
    
    data.keywords[section] = [];
    data.stats.keywordsRemoved += count;
    await saveData(data);

    bot.sendMessage(chatId, `🗑️ Cleared ${count} keywords from ${section}`);
});

// Get news
bot.onText(/\/get (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const section = match[1].trim().toLowerCase();

    if (!getSections().includes(section)) {
        bot.sendMessage(chatId, `❌ Invalid section. Use: ${getSections().join(', ')}`);
        return;
    }

    const data = await loadData();
    data.stats.totalQueries++;

    // Rate limit warning
    if (isRateLimited) {
        bot.sendMessage(chatId, '⚠️ Feedly rate limited. Using backup RSS feeds...');
    } else {
        bot.sendMessage(chatId, '🔄 Fetching news...');
    }

    try {
        let allArticles = [];
        let sectionsToFetch = [];

        if (section === 'latest') {
            sectionsToFetch = getSections().filter(s => s !== 'latest');
        } else {
            sectionsToFetch = [section];
        }

        for (const sec of sectionsToFetch) {
            const keywords = data.keywords[sec] || [];
            if (keywords.length > 0) {
                const articles = await fetchFeedlyNews(keywords, sec);
                allArticles = allArticles.concat(articles);
            }
        }

        await saveData(data);

        if (allArticles.length === 0) {
            bot.sendMessage(chatId, `📰 No news found for ${section}.\nAdd keywords: /add ${section} [keywords]`);
            return;
        }

        const formattedNews = formatNewsArticles(allArticles, section);
        
        if (formattedNews.length > 4096) {
            const chunks = formattedNews.match(/[\s\S]{1,4000}/g) || [];
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } else {
            bot.sendMessage(chatId, formattedNews, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('Error fetching news:', error);
        bot.sendMessage(chatId, '❌ Error fetching news. Try again later.');
    }
});

// Stats
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();

    const totalKeywords = Object.values(data.keywords).reduce((sum, keywords) => sum + keywords.length, 0);
    const rateLimitStatus = isRateLimited ? '🔴 Rate Limited' : '🟢 Active';

    const statsMessage = `📊 *Bot Stats*

🔢 Queries: ${data.stats.totalQueries}
➕ Added: ${data.stats.keywordsAdded}
➖ Removed: ${data.stats.keywordsRemoved}
📝 Total Keywords: ${totalKeywords}
🔗 Feedly Status: ${rateLimitStatus}

*By Section:*
📺 YouTuber: ${data.keywords.youtuber?.length || 0}
🎬 Movies: ${data.keywords.movies?.length || 0}
🇮🇳 National: ${data.keywords.national?.length || 0}
🇵🇰 Pakistan: ${data.keywords.pakistan?.length || 0}
🏏 Cricket: ${data.keywords.cricket?.length || 0}
💻 Tech: ${data.keywords.tech?.length || 0}
🎭 Entertainment: ${data.keywords.entertainment?.length || 0}`;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

// Handle unknown commands
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.startsWith('/') && !text.match(/\/(start|help|add|remove|list|clear|get|stats)/)) {
        bot.sendMessage(chatId, '❌ Unknown command. Use /help');
    }
});

// Error handling
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log('🤖 Bot started successfully!');
    console.log('📡 Polling for messages...');
});

module.exports = { bot, app };
