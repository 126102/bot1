# 🚀 Deployment Guide - Enhanced Viral News Bot v3.0

Complete step-by-step guide to deploy your news bot on different platforms.

## 📋 Pre-Deployment Checklist

### ✅ **Before You Deploy:**
- [ ] Bot token obtained from @BotFather
- [ ] Code tested locally with `npm test`
- [ ] Environment variables configured
- [ ] Database schema verified
- [ ] All dependencies installed
- [ ] Git repository created

### 📱 **Get Your Bot Token:**
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`
3. Choose bot name: `YourNewsBot`
4. Choose username: `your_news_bot`
5. Copy the token (format: `123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
6. Save it securely - you'll need it for deployment

---

## 🌟 **Option 1: Render.com (Recommended)**

**Why Render.com?**
- ✅ **Free tier available**
- ✅ **Automatic HTTPS/SSL**
- ✅ **Zero-config deployment**
- ✅ **Built-in environment variables**
- ✅ **Automatic webhook setup**

### **Step 1: Prepare Repository**
```bash
# Clone or fork the repository
git clone https://github.com/your-username/enhanced-viral-news-bot.git
cd enhanced-viral-news-bot

# Push to your GitHub repository
git remote add origin https://github.com/your-username/enhanced-viral-news-bot.git
git push -u origin main
```

### **Step 2: Create Render Service**
1. Go to [render.com](https://render.com)
2. Sign up/login with GitHub
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repository
5. Configure settings:
   - **Name:** `enhanced-news-bot`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** `Free` (or paid for better performance)

### **Step 3: Set Environment Variables**
In Render dashboard, go to **Environment** tab and add:

```env
BOT_TOKEN=your_actual_bot_token_here
NODE_ENV=production
```

### **Step 4: Deploy**
1. Click **"Create Web Service"**
2. Wait for build to complete (3-5 minutes)
3. Copy your app URL: `https://enhanced-news-bot-xyz.onrender.com`
4. Bot will automatically set webhook URL

### **Step 5: Test Deployment**
```bash
# Check health endpoint
curl https://your-app.onrender.com/health

# Test bot by messaging it on Telegram
# Try: /start, /youtubers, /spicy news
```

**🎉 Your bot is now live with webhooks!**

---

## 🟣 **Option 2: Heroku**

**Good for:** Established apps, add-ons ecosystem

### **Step 1: Install Heroku CLI**
```bash
# macOS
brew tap heroku/brew && brew install heroku

# Windows (download from heroku.com)
# Linux
sudo snap install --classic heroku
```

### **Step 2: Login and Create App**
```bash
# Login to Heroku
heroku login

# Create new app
heroku create enhanced-news-bot-123

# Add buildpack for Node.js
heroku buildpacks:add heroku/nodejs
```

### **Step 3: Configure Environment**
```bash
# Set bot token
heroku config:set BOT_TOKEN=your_bot_token_here

# Set production mode
heroku config:set NODE_ENV=production

# Set app URL (replace with your actual URL)
heroku config:set HEROKU_APP_NAME=enhanced-news-bot-123
```

### **Step 4: Deploy Code**
```bash
# Add Heroku remote
heroku git:remote -a enhanced-news-bot-123

# Deploy
git push heroku main

# Check logs
heroku logs --tail
```

### **Step 5: Scale and Test**
```bash
# Ensure at least 1 dyno is running
heroku ps:scale web=1

# Open app
heroku open

# Test health endpoint
curl https://enhanced-news-bot-123.herokuapp.com/health
```

---

## 🖥️ **Option 3: VPS/Server (Advanced)**

**Good for:** Full control, custom configurations

### **Step 1: Server Setup (Ubuntu 20.04+)**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Install Git
sudo apt install git -y
```

### **Step 2: Deploy Application**
```bash
# Clone repository
git clone https://github.com/your-username/enhanced-viral-news-bot.git
cd enhanced-viral-news-bot

# Install dependencies
npm install --production

# Create environment file
cp .env.example .env
nano .env  # Edit with your settings
```

### **Step 3: Configure Environment**
```bash
# Edit .env file
BOT_TOKEN=your_bot_token_here
NODE_ENV=production
APP_URL=https://your-domain.com
PORT=3000
```

### **Step 4: Start with PM2**
```bash
# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'enhanced-news-bot',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_file: 'logs/pm2-combined.log',
    time: true
  }]
};
EOF

# Start application
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### **Step 5: Setup Reverse Proxy (Nginx)**
```bash
# Install Nginx
sudo apt install nginx -y

# Create configuration
sudo cat > /etc/nginx/sites-available/news-bot << EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/news-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### **Step 6: Setup SSL (Let's Encrypt)**
```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

---

## 🐳 **Option 4: Docker (All Platforms)**

**Good for:** Containerized deployments, consistent environments

### **Step 1: Create Dockerfile**
```dockerfile
# Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["npm", "start"]
```

### **Step 2: Create docker-compose.yml**
```yaml
# docker-compose.yml
version: '3.8'

services:
  news-bot:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BOT_TOKEN=${BOT_TOKEN}
      - NODE_ENV=production
      - APP_URL=${APP_URL}
    volumes:
      - ./logs:/app/logs
      - ./enhanced_news_bot.db:/app/enhanced_news_bot.db
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  logs:
  database:
```

### **Step 3: Deploy with Docker**
```bash
# Create environment file
echo "BOT_TOKEN=your_bot_token_here" > .env
echo "APP_URL=https://your-domain.com" >> .env

# Build and run
docker-compose up -d

# Check logs
docker-compose logs -f

# Check health
curl http://local
