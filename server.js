const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Bot configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const FEEDLY_ACCESS_TOKEN = process.env.FEEDLY_ACCESS_TOKEN;

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

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
    userPreferences: {}
};

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

// Fetch news from Feedly with strict keyword matching
async function fetchFeedlyNews(keywords, section = null) {
    try {
        const headers = {
            'Authorization': `Bearer ${FEEDLY_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        };

        // Search for articles using Feedly search API
        const searchQuery = keywords.join(' OR ');
        const searchUrl = `${FEEDLY_BASE_URL}/search/feeds`;
        
        const searchParams = {
            query: searchQuery,
            count: 50,
            locale: 'en'
        };

        const searchResponse = await axios.get(searchUrl, {
            headers,
            params: searchParams
        });

        // Get stream entries
        const streamUrl = `${FEEDLY_BASE_URL}/streams/contents`;
        const streamParams = {
            streamId: 'user/' + await getUserId() + '/category/global.all',
            count: 100,
            ranked: 'newest'
        };

        const streamResponse = await axios.get(streamUrl, {
            headers,
            params: streamParams
        });

        const entries = streamResponse.data.items || [];

        // Filter entries for strict keyword matching
        const filteredEntries = entries.filter(entry => {
            const title = (entry.title || '').toLowerCase();
            const summary = (entry.summary?.content || '').toLowerCase();
            const content = title + ' ' + summary;

            return keywords.some(keyword => {
                const keywordLower = keyword.toLowerCase();
                // Strict matching - check for whole word matches
                const regex = new RegExp(`\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                return regex.test(content);
            });
        });

        return filteredEntries.slice(0, 10); // Limit to 10 results
    } catch (error) {
        console.error('Feedly API Error:', error.response?.data || error.message);
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
        return 'user/default';
    }
}

// Format news articles for Telegram
function formatNewsArticles(articles, section) {
    if (!articles || articles.length === 0) {
        return `📰 No news found for ${section} section with your keywords.`;
    }

    let message = `📰 *${section.toUpperCase()} NEWS*\n\n`;
    
    articles.forEach((article, index) => {
        const title = article.title || 'No title';
        const url = article.alternate?.[0]?.href || article.originId || '#';
        const published = article.published ? new Date(article.published).toLocaleString() : 'Unknown time';
        const source = article.origin?.title || 'Unknown source';

        message += `${index + 1}. *${title}*\n`;
        message += `🔗 [Read More](${url})\n`;
        message += `📅 ${published}\n`;
        message += `📺 Source: ${source}\n\n`;
    });

    return message;
}

// Command handlers
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    data.stats.totalQueries++;
    await saveData(data);

    const welcomeMessage = `
🤖 *Welcome to Feedly News Bot!*

This bot fetches fresh news from Feedly Pro with strict keyword matching.

*Available Sections:*
📺 youtuber - YouTube related news
🎬 movies - Movie news and updates  
🇮🇳 national - National news
🇵🇰 pakistan - Pakistan related news
🏏 cricket - Cricket news and scores
💻 tech - Technology news
🎭 entertainment - Entertainment news
🔥 latest - All sections combined

*Commands:*
/addkeyword [section] [keyword] - Add keyword to section
/removekeyword [section] [keyword] - Remove keyword
/listkeywords - Show all keywords by section
/getnews [section] - Fetch fresh news for section
/stats - Show bot statistics  
/clearkeywords [section] - Clear all keywords from section
/help - Show this help message

*Example:*
\`/addkeyword cricket virat kohli\`
\`/getnews cricket\`
\`/removekeyword cricket virat kohli\`

Start by adding keywords to your preferred sections! 🚀
    `;

    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    data.stats.totalQueries++;
    await saveData(data);

    const helpMessage = `
🆘 *HELP - Feedly News Bot Commands*

*Keyword Management:*
📝 \`/addkeyword [section] [keyword]\` - Add keyword
❌ \`/removekeyword [section] [keyword]\` - Remove keyword  
📋 \`/listkeywords\` - List all keywords
🗑️ \`/clearkeywords [section]\` - Clear section keywords

*News Fetching:*
📰 \`/getnews [section]\` - Get news for section
📰 \`/getnews latest\` - Get news from all sections

*Information:*
📊 \`/stats\` - Bot statistics
🆘 \`/help\` - This help message

*Available Sections:*
youtuber, movies, national, pakistan, cricket, tech, entertainment

*Examples:*
\`/addkeyword cricket "india vs pakistan"\`
\`/addkeyword youtuber "mr beast"\`
\`/getnews cricket\`
\`/removekeyword movies "bollywood"\`
\`/clearkeywords tech\`

*Note:* Keywords are matched strictly (exact word matching).
    `;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/addkeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        bot.sendMessage(chatId, '❌ Usage: /addkeyword [section] [keyword]\nExample: /addkeyword cricket "virat kohli"');
        return;
    }

    const section = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ').replace(/"/g, '');

    if (!getSections().includes(section) && section !== 'latest') {
        bot.sendMessage(chatId, `❌ Invalid section. Available: ${getSections().join(', ')}`);
        return;
    }

    if (section === 'latest') {
        bot.sendMessage(chatId, '❌ Cannot add keywords to "latest" section. Use specific sections only.');
        return;
    }

    const data = await loadData();
    
    if (!data.keywords[section]) {
        data.keywords[section] = [];
    }

    if (!data.keywords[section].includes(keyword)) {
        data.keywords[section].push(keyword);
        data.stats.keywordsAdded++;
        data.stats.lastUpdated = new Date().toISOString();
        await saveData(data);
        
        bot.sendMessage(chatId, `✅ Added keyword "${keyword}" to ${section} section.\nTotal keywords in ${section}: ${data.keywords[section].length}`);
    } else {
        bot.sendMessage(chatId, `⚠️ Keyword "${keyword}" already exists in ${section} section.`);
    }
});

bot.onText(/\/removekeyword (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].trim();
    const parts = input.split(' ');
    
    if (parts.length < 2) {
        bot.sendMessage(chatId, '❌ Usage: /removekeyword [section] [keyword]\nExample: /removekeyword cricket "virat kohli"');
        return;
    }

    const section = parts[0].toLowerCase();
    const keyword = parts.slice(1).join(' ').replace(/"/g, '');

    if (!getSections().includes(section)) {
        bot.sendMessage(chatId, `❌ Invalid section. Available: ${getSections().filter(s => s !== 'latest').join(', ')}`);
        return;
    }

    const data = await loadData();
    
    if (!data.keywords[section]) {
        bot.sendMessage(chatId, `❌ No keywords found in ${section} section.`);
        return;
    }

    const index = data.keywords[section].indexOf(keyword);
    if (index > -1) {
        data.keywords[section].splice(index, 1);
        data.stats.keywordsRemoved++;
        data.stats.lastUpdated = new Date().toISOString();
        await saveData(data);
        
        bot.sendMessage(chatId, `✅ Removed keyword "${keyword}" from ${section} section.\nRemaining keywords: ${data.keywords[section].length}`);
    } else {
        bot.sendMessage(chatId, `❌ Keyword "${keyword}" not found in ${section} section.`);
    }
});

bot.onText(/\/listkeywords/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    data.stats.totalQueries++;
    await saveData(data);

    let message = '📋 *KEYWORDS BY SECTION*\n\n';
    
    const sections = getSections().filter(s => s !== 'latest');
    let hasKeywords = false;

    sections.forEach(section => {
        const keywords = data.keywords[section] || [];
        if (keywords.length > 0) {
            hasKeywords = true;
            message += `*${section.toUpperCase()}* (${keywords.length}):\n`;
            keywords.forEach((keyword, index) => {
                message += `  ${index + 1}. ${keyword}\n`;
            });
            message += '\n';
        }
    });

    if (!hasKeywords) {
        message += '❌ No keywords added yet.\n\nUse /addkeyword [section] [keyword] to add keywords.';
    }

    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/clearkeywords (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const section = match[1].trim().toLowerCase();

    if (!getSections().includes(section) || section === 'latest') {
        bot.sendMessage(chatId, `❌ Invalid section. Available: ${getSections().filter(s => s !== 'latest').join(', ')}`);
        return;
    }

    const data = await loadData();
    const keywordCount = data.keywords[section] ? data.keywords[section].length : 0;
    
    data.keywords[section] = [];
    data.stats.keywordsRemoved += keywordCount;
    data.stats.lastUpdated = new Date().toISOString();
    await saveData(data);

    bot.sendMessage(chatId, `🗑️ Cleared all ${keywordCount} keywords from ${section} section.`);
});

bot.onText(/\/getnews (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const section = match[1].trim().toLowerCase();

    if (!getSections().includes(section)) {
        bot.sendMessage(chatId, `❌ Invalid section. Available: ${getSections().join(', ')}`);
        return;
    }

    const data = await loadData();
    data.stats.totalQueries++;

    bot.sendMessage(chatId, '🔄 Fetching fresh news from Feedly... Please wait.');

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
                if (section === 'latest') {
                    allArticles = allArticles.concat(articles.map(article => ({...article, section: sec})));
                } else {
                    allArticles = articles;
                }
            }
        }

        if (section === 'latest') {
            // Sort by published date for latest
            allArticles.sort((a, b) => (b.published || 0) - (a.published || 0));
            allArticles = allArticles.slice(0, 15); // Limit to 15 for latest
        }

        await saveData(data);

        if (allArticles.length === 0) {
            const noNewsMessage = section === 'latest' 
                ? '📰 No news found across all sections. Add keywords first using /addkeyword command.'
                : `📰 No news found for ${section}. Try adding more keywords with /addkeyword ${section} [keyword]`;
            
            bot.sendMessage(chatId, noNewsMessage);
            return;
        }

        const formattedNews = formatNewsArticles(allArticles, section);
        
        // Split message if too long for Telegram
        if (formattedNews.length > 4096) {
            const chunks = formattedNews.match(/[\s\S]{1,4000}/g) || [];
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
            }
        } else {
            bot.sendMessage(chatId, formattedNews, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('Error fetching news:', error);
        bot.sendMessage(chatId, '❌ Error fetching news from Feedly. Please check your API token and try again.');
    }
});

bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const data = await loadData();
    data.stats.totalQueries++;
    await saveData(data);

    const totalKeywords = Object.values(data.keywords).reduce((sum, keywords) => sum + keywords.length, 0);
    const lastUpdated = data.stats.lastUpdated ? new Date(data.stats.lastUpdated).toLocaleString() : 'Never';

    const statsMessage = `
📊 *BOT STATISTICS*

🔢 Total Queries: ${data.stats.totalQueries}
➕ Keywords Added: ${data.stats.keywordsAdded}
➖ Keywords Removed: ${data.stats.keywordsRemoved}
📝 Total Active Keywords: ${totalKeywords}
⏰ Last Updated: ${lastUpdated}

*Keywords by Section:*
📺 YouTuber: ${data.keywords.youtuber?.length || 0}
🎬 Movies: ${data.keywords.movies?.length || 0}
🇮🇳 National: ${data.keywords.national?.length || 0}
🇵🇰 Pakistan: ${data.keywords.pakistan?.length || 0}
🏏 Cricket: ${data.keywords.cricket?.length || 0}
💻 Tech: ${data.keywords.tech?.length || 0}
🎭 Entertainment: ${data.keywords.entertainment?.length || 0}

Bot is running smoothly! 🚀
    `;

    bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

// Handle unknown commands
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text && text.startsWith('/') && !text.match(/\/(start|help|addkeyword|removekeyword|listkeywords|clearkeywords|getnews|stats)/)) {
        bot.sendMessage(chatId, '❌ Unknown command. Use /help to see available commands.');
    }
});

// Error handling
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Start message
console.log('🤖 Feedly Telegram Bot is starting...');
console.log('📡 Polling for messages...');

// Keep the process alive
process.on('SIGINT', () => {
    console.log('🛑 Bot stopped gracefully');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Bot terminated gracefully');
    process.exit(0);
});

module.exports = bot;
