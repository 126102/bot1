# 🔥 Enhanced Viral News Bot v3.0

**Advanced Telegram News Bot with Content Scoring, Webhooks, Moderation & Analytics - Perfect for YouTube News Channels**

## 🚀 Key Features

### ✅ **All Your Requested Features Implemented:**
- **🌐 Webhooks** instead of polling (faster, efficient, saves bandwidth)
- **🧪 Unit Tests** with Jest (comprehensive test coverage)
- **🛡️ Content Moderation** (filters profanity, slurs, fake news)
- **📊 Content Scoring System** (Spice, Conspiracy, Importance levels)
- **⚡ Rate Limiting** (prevents abuse)

### 🎯 **Perfect for YouTube News Channels:**
- **🌶️ Spicy Content Focus** - Drama, controversies, exposés
- **🕵️ Conspiracy Content** - Hidden truths, secrets, cover-ups
- **⚡ Breaking News** - Important, urgent, crisis content
- **📱 Multi-Platform** - News, Twitter, Instagram, YouTube
- **🔗 Working Links** - Direct, verified, non-broken URLs

### 📊 **Advanced Scoring System:**
- **Spice Score (1-10):** Drama, controversy, fights, scandals
- **Conspiracy Score (1-10):** Secrets, exposés, hidden agendas
- **Importance Score (1-10):** Breaking news, urgent updates
- **Total Score:** Combined score for ranking content

## 🛠️ **Installation & Setup**

### **1. Prerequisites**
```bash
# Node.js 14+ required
node --version

# Create project directory
mkdir enhanced-news-bot
cd enhanced-news-bot
```

### **2. Install Dependencies**
```bash
# Install all dependencies
npm install

# Or install manually:
npm install node-telegram-bot-api axios cheerio express express-rate-limit winston sqlite3 bad-words dotenv helmet cors compression

# Dev dependencies
npm install --save-dev jest supertest nodemon eslint @babel/preset-env babel-jest
```

### **3. Environment Setup**
Create `.env` file:
```env
# Required
BOT_TOKEN=your_telegram_bot_token_here
NODE_ENV=production

# Optional (for Render deployment)
RENDER_EXTERNAL_URL=https://your-app.onrender.com
RENDER_SERVICE_NAME=your-service-name
PORT=3000

# Database (optional - uses SQLite by default)
DATABASE_URL=sqlite:./enhanced_news_bot.db

# Logging
LOG_LEVEL=info
```

### **4. Get Telegram Bot Token**
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`
3. Choose bot name and username
4. Copy the token to `.env` file

### **5. Webhook Setup (Production)**
The bot automatically sets up webhooks when `NODE_ENV=production`:

```javascript
// Webhook URL format:
https://your-domain.com/webhook/YOUR_BOT_TOKEN
```

For **Render.com** deployment:
1. Connect your GitHub repo
2. Set environment variables
3. Deploy - webhooks configure automatically

## 🔧 **Usage Commands**

### **📰 Main News Commands:**
```
/youtubers - Spicy YouTuber drama & conspiracy
/bollywood - Celebrity scandals & secrets  
/cricket - Sports controversies & match fixing
/national - Political drama & government exposés
/pakistan - Pakistani conspiracy & crisis content
/latest - Top-scored content from all categories
```

### **🔍 Advanced Search:**
```
/search <term> - Multi-platform scored search
/spicy <term> - High controversy content only (6+ spice score)
/conspiracy <term> - Conspiracy-focused search (5+ conspiracy score)
```

### **🛠️ Management:**
```
/addkeyword <category> <keyword> - Add custom keywords
/listkeywords - Show all your keywords
/mystats - Your usage statistics  
/settings - Bot configuration info
/refresh - Force refresh all sources (rate limited)
```

### **📊 Example Commands:**
```
/addkeyword youtubers CarryMinati controversy
/addkeyword bollywood nepotism scandal
/spicy Elvish Yadav drama
/conspiracy Bollywood illuminati
/search YouTube algorithm manipulation
```

## 🧪 **Testing**

### **Run All Tests:**
```bash
# Run complete test suite
npm test

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### **Test Categories:**
- ✅ News aggregation functionality
- ✅ Content scoring system  
- ✅ Content moderation filters
- ✅ Duplicate removal logic
- ✅ Database operations
- ✅ Rate limiting enforcement
- ✅ API endpoints
- ✅ Error handling
- ✅ Performance tests

### **Example Test Output:**
```bash
 PASS  tests/newsBot.test.js
  Enhanced News Bot Tests
    ✓ should aggregate news from multiple sources
    ✓ should calculate spice score correctly  
    ✓ should filter profanity correctly
    ✓ should remove duplicate articles
    ✓ should categorize content properly
    ✓ should enforce rate limits

Test Suites: 1 passed, 1 total
Tests: 25 passed, 25 total
Coverage: 85%+ on critical functions
```

## 📊 **Content Scoring Examples**

### **🌶️ High Spice Content (8-10):**
- "YouTuber EXPOSED in Major Scandal"
- "Bollywood Affair Controversy Erupts"  
- "Cricket Match Fixing Drama Unfolds"

### **🕵️ High Conspiracy (7-10):**
- "Government Cover-up Revealed"
- "Secret YouTube Algorithm Exposed"
- "Hidden Truth Behind Celebrity Death"

### **⚡ High Importance (8-10):**
- "BREAKING: Emergency Declared"
- "URGENT: Major Policy Change"
- "ALERT: Crisis Situation Develops"

## 🛡️ **Content Moderation**

### **Automatically Filters:**
- ❌ Profanity and slurs
- ❌ Obvious fake news patterns
- ❌ Spam content
- ❌ Content older than 24 hours
- ❌ Duplicate articles
- ❌ Suspicious clickbait

### **Moderation Example:**
```javascript
Input: "You won't believe this bullshit fake news"
Output: 🚫 Filtered (profanity + suspicious pattern)

Input: "Breaking: Political scandal exposed"  
Output: ✅ Approved (spice: 7, importance: 8)
```

## 🚀 **Deployment**

### **Render.com (Recommended):**
1. Fork this repository
2. Connect to Render.com
3. Set environment variables:
   - `BOT_TOKEN=your_token`
   - `NODE_ENV=production`
4. Deploy - webhooks auto-configure

### **Heroku:**
```bash
# Install Heroku CLI
heroku create your-bot-name
heroku config:set BOT_TOKEN=your_token
heroku config:set NODE_ENV=production
git push heroku main
```

### **VPS/Server:**
```bash
# Using PM2
npm install -g pm2
pm2 start server.js --name "news-bot"
pm2 save
pm2 startup
```

## 📈 **Monitoring & Analytics**

### **Built-in Endpoints:**
```
GET / - Bot status and statistics
GET /health - Health check for monitoring  
GET /analytics - Detailed analytics data
GET /ping - Simple ping/pong test
```

### **Analytics Data:**
- 📊 Total requests & success rate
- ⏱️ Average response times
- 🌶️ Content score distributions  
- 👥 Active users & rate limits
- 💾 Memory usage & performance
- 📱 Command usage statistics

### **Example Analytics:**
```json
{
  "bot": {
    "totalRequests": 1250,
    "successRate": "94.2%",
    "averageResponseTime": "2.3s"
  },
  "content": {
    "totalArticles": 1840,
    "averageScore": "16.7/30",
    "spicyCount": 420,
    "conspiracyCount": 180
  }
}
```

## 🎬 **YouTube Channel Integration**

### **Perfect Content for Your Channel:**
1. **High-Score Articles** (20+ total score) = Viral potential
2. **Spicy Drama** (7+ spice) = High engagement  
3. **Conspiracy Content** (6+ conspiracy) = Click magnets
4. **Breaking News** (8+ importance) = Trending topics
5. **Multi-Platform Coverage** = Comprehensive stories

### **Content Strategy Tips:**
```
🎯 Focus on articles with total score 18+
🌶️ Prioritize spicy drama for thumbnails
🕵️ Use conspiracy content for intrigue
⚡ Cover breaking news for timing
📱 Cross-reference social media buzz
```

### **Daily Workflow:**
1. **Morning:** `/refresh` for latest content
2. **Filter:** Use `/spicy` and `/conspiracy` commands  
3. **Research:** Check highest-scored articles
4. **Create:** Use top stories for video scripts
5. **Track:** Monitor `/mystats` for trending patterns

## 🛠️ **Advanced Configuration**

### **Custom Keywords for Better Results:**
```bash
# Add spicy YouTuber keywords
/addkeyword youtubers "MrBeast controversy"
/addkeyword youtubers "PewDiePie drama"
/addkeyword youtubers "creator exposed"

# Add Bollywood scandal keywords  
/addkeyword bollywood "casting couch scandal"
/addkeyword bollywood "celebrity affair exposed"
/addkeyword bollywood "Bollywood mafia revealed"

# Add conspiracy keywords
/addkeyword national "government cover up"
/addkeyword national "political conspiracy"
/addkeyword national "election manipulation"
```

### **Rate Limiting Configuration:**
- **10 requests per hour** per command per user
- **Refresh limited** to prevent abuse
- **Search commands** have separate limits
- **Rate reset** every hour automatically

### **Database Schema:**
```sql
-- User keywords with priority
user_keywords: user_id, category, keyword, priority

-- User preferences  
user_preferences: user_id, spicy_level, conspiracy_mode

-- News cache with scores
news_cache: title, url, spice_score, conspiracy_score, importance_score

-- Analytics tracking
bot_analytics: user_id, command, response_time, success
```

## 🔧 **Development**

### **Local Development:**
```bash
# Clone repository
git clone https://github.com/your-username/enhanced-viral-news-bot.git
cd enhanced-viral-news-bot

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your bot token

# Run in development mode (polling)
npm run dev

# Run tests
npm test
```

### **Project Structure:**
```
enhanced-viral-news-bot/
├── server.js                 # Main bot code
├── tests/
│   └── newsBot.test.js       # Unit tests
├── logs/                     # Log files
│   ├── error.log
│   └── combined.log
├── coverage/                 # Test coverage reports
├── enhanced_news_bot.db      # SQLite database
├── package.json              # Dependencies
├── .env                      # Environment variables
└── README.md                 # This file
```

### **Adding New Features:**
1. **Add function** in server.js
2. **Write tests** in tests/newsBot.test.js
3. **Update documentation** in README.md
4. **Test thoroughly** with `npm test`
5. **Deploy and monitor**

## 🚨 **Troubleshooting**

### **Common Issues:**

#### **Bot Not Responding:**
```bash
# Check bot token
echo $BOT_TOKEN

# Check webhook status  
curl https://api.telegram.org/bot$BOT_TOKEN/getWebhookInfo

# Check logs
npm run logs
```

#### **No News Results:**
```bash
# Check internet connection
curl -I https://news.google.com

# Verify RSS feeds accessible
curl "https://news.google.com/rss/search?q=test&hl=en-IN"

# Check rate limiting
# Wait 15 minutes and try again
```

#### **Database Errors:**
```bash
# Check database file permissions
ls -la enhanced_news_bot.db

# Reset database (WARNING: loses data)
rm enhanced_news_bot.db
# Restart bot to recreate tables
```

#### **Webhook Issues:**
```bash
# Delete existing webhook
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/deleteWebhook"

# Set new webhook manually
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/setWebhook?url=https://your-domain.com/webhook/$BOT_TOKEN"
```

### **Performance Issues:**
```bash
# Check memory usage
curl http://localhost:3000/analytics

# Monitor logs
tail -f logs/combined.log

# Check database size
ls -lh enhanced_news_bot.db

# Clean up old data (auto-cleanup runs every 30 min)
# Manual cleanup if needed:
sqlite3 enhanced_news_bot.db "DELETE FROM news_cache WHERE created_at < datetime('now', '-7 days')"
```

## 📊 **API Documentation**

### **Health Check Endpoints:**
```http
GET /                 # Bot status & statistics
GET /health          # Health check (for monitoring)
GET /analytics       # Detailed analytics
GET /ping            # Simple ping test
```

### **Webhook Endpoint:**
```http
POST /webhook/{BOT_TOKEN}    # Telegram webhook (auto-configured)
```

### **Example API Response:**
```json
{
  "status": "Enhanced Viral News Bot v3.0",
  "version": "3.0.0",
  "features": [
    "Working Direct Links",
    "Content Scoring", 
    "Moderation",
    "Webhooks",
    "Analytics"
  ],
  "stats": {
    "totalNews": 1840,
    "averageScore": 16,
    "spicyContent": 420,
    "conspiracyContent": 180,
    "successRate": 94
  }
}
```

## 🎯 **Success Metrics**

### **Content Quality Indicators:**
- **High Spice Content:** 30%+ of articles with 7+ spice score
- **Conspiracy Content:** 15%+ with 6+ conspiracy score  
- **Fresh Content:** 100% articles within 24 hours
- **Working Links:** 95%+ direct, non-broken URLs
- **No Duplicates:** Advanced filtering removes 100% duplicates

### **Performance Targets:**
- **Response Time:** <3 seconds average
- **Uptime:** 99%+ availability
- **Success Rate:** 95%+ successful requests
- **Error Rate:** <5% failed operations

### **User Engagement:**
- **Commands/User:** Track via `/mystats`
- **Custom Keywords:** Monitor additions per category
- **Search Usage:** Track `/spicy` vs `/conspiracy` usage
- **Content Preferences:** Analyze most-requested categories

## 🔐 **Security Features**

### **Built-in Protection:**
- ✅ **Rate Limiting:** Prevents spam and abuse
- ✅ **Content Moderation:** Filters inappropriate content
- ✅ **Input Sanitization:** Prevents injection attacks
- ✅ **Error Handling:** Graceful failure management
- ✅ **Database Security:** Parameterized queries
- ✅ **Environment Variables:** Secure token storage

### **Best Practices:**
```bash
# Keep bot token secure
echo "BOT_TOKEN=your_token" >> .env
echo ".env" >> .gitignore

# Regular updates
npm audit
npm update

# Monitor logs for suspicious activity
grep "error\|failed\|blocked" logs/combined.log
```

## 📞 **Support & Contact**

### **Getting Help:**
1. **Check logs** first: `npm run logs`
2. **Run tests** to verify: `npm test`
3. **Check analytics** for issues: `curl localhost:3000/analytics`
4. **Review documentation** above
5. **Create GitHub issue** with details

### **Contributing:**
1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Write tests for new features
4. Ensure all tests pass: `npm test`
5. Submit pull request with description

### **Feature Requests:**
Open GitHub issue with:
- **Clear description** of desired feature
- **Use case** explanation
- **Expected behavior** details
- **Additional context** if needed

## 📝 **License**

MIT License - feel free to use for personal and commercial projects.

## 🎉 **Changelog**

### **v3.0.0 (Current)**
- ✅ **Webhooks** instead of polling
- ✅ **Unit tests** with Jest
- ✅ **Content moderation** system
- ✅ **Advanced scoring** (spice/conspiracy/importance)
- ✅ **Rate limiting** protection
- ✅ **Enhanced keywords** per category
- ✅ **Database integration** with SQLite
- ✅ **Analytics dashboard**
- ✅ **Performance optimization**

### **v2.0.0**
- 📱 Multi-platform search
- 🔗 Working link extraction
- 📊 Basic content scoring
- ⏰ 24-hour content filtering

### **v1.0.0**
- 🤖 Basic Telegram bot
- 📰 Google News RSS parsing
- 📂 Category-based search
- 🔄 Simple keyword management

---

**🔥 Ready to create viral YouTube content with the spiciest, most controversial news available!**

**🎬 Perfect for news channels focused on drama, conspiracy, and breaking stories!**

**⚡ Get started now and dominate the YouTube news space!**
