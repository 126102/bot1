# 🏓 Keep-Alive System Setup

## ✅ Built-in Auto-Ping Features

Your bot now includes **multiple keep-alive mechanisms** to prevent sleep mode:

### 🔄 **Auto-Ping System:**
- **Self-ping** every **12 minutes** (before 15-min Render sleep)
- **External pings** every **25 minutes** to other services
- **Ping counter** tracks total pings for monitoring

### 📊 **Monitoring Endpoints:**
```
GET /ping        → Returns pong + ping count
GET /health      → Shows uptime + last ping time
GET /           → Full status including keep-alive info
```

## 🌐 **External Keep-Alive Services (Free)**

### **1. UptimeRobot (Recommended - Free)**
1. **Sign up:** [uptimerobot.com](https://uptimerobot.com)
2. **Add Monitor:**
   - Type: `HTTP(s)`
   - URL: `https://your-app.onrender.com/ping`
   - Interval: `5 minutes`
   - Name: `Viral News Bot`
3. **Save** - Free plan gives 50 monitors!

### **2. Freshping (Alternative)**
1. **Sign up:** [freshping.io](https://freshping.io)
2. **Create Check:**
   - URL: `https://your-app.onrender.com/health`
   - Interval: `1 minute`
   - Type: `Website`

### **3. StatusCake (Free tier)**
1. **Sign up:** [statuscake.com](https://statuscake.com)
2. **Add Test:**
   - URL: `https://your-app.onrender.com/ping`
   - Check Rate: `5 minutes`

## 🛠️ **Multiple Backup Methods**

### **Built-in Redundancy:**
```javascript
// Method 1: Self-ping (every 12 minutes)
setInterval(keepServerAlive, 12 * 60 * 1000);

// Method 2: External service ping (every 25 minutes)  
setInterval(externalPing, 25 * 60 * 1000);

// Method 3: News auto-refresh (every 2 hours)
setInterval(aggregateNews, 2 * 60 * 60 * 1000);
```

### **External Service Pings:**
The bot automatically pings these services to stay active:
- `https://httpbin.org/get`
- `https://api.github.com`
- `https://jsonplaceholder.typicode.com/posts/1`

## 📈 **Monitoring Your Bot's Uptime**

### **Check Status:**
```bash
# Quick status
curl https://your-app.onrender.com/ping

# Detailed health
curl https://your-app.onrender.com/health

# Full status
curl https://your-app.onrender.com/
```

### **Expected Response:**
```json
{
  "status": "pong",
  "timestamp": "2025-06-04T10:30:00.000Z", 
  "pingCount": 145,
  "uptime": 7200
}
```

## ⏰ **Ping Schedule**

| Action | Frequency | Purpose |
|--------|-----------|---------|
| Self-ping | 12 minutes | Prevent Render sleep |
| External ping | 25 minutes | Network activity |
| News refresh | 2 hours | Content update |
| UptimeRobot | 5 minutes | External monitoring |

## 🚨 **Troubleshooting**

### **Bot still going offline?**

**1. Check Render Logs:**
```
Look for: "🏓 Keep-alive ping successful"
```

**2. Verify External Monitoring:**
- UptimeRobot dashboard should show "Up"
- Check ping response times

**3. Manual Wake-up:**
```bash
# If bot is sleeping, ping it:
curl https://your-app.onrender.com/ping
```

### **Common Issues:**

**Issue:** Self-ping failing
**Solution:** Render URL detection might be wrong
```javascript
// Add this to environment variables:
RENDER_EXTERNAL_URL=https://your-actual-app-url.onrender.com
```

**Issue:** External services blocking pings
**Solution:** Bot automatically rotates between different ping targets

## 🎯 **Best Practice Setup**

### **Recommended Configuration:**
1. ✅ **Built-in auto-ping** (already included)
2. ✅ **UptimeRobot monitor** (5-minute checks)
3.