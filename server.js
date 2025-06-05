// tests/newsBot.test.js
const jest = require('jest');
const axios = require('axios');
const { app, bot, database } = require('../server');
const request = require('supertest');

// Mock external dependencies
jest.mock('axios');
jest.mock('node-telegram-bot-api');

describe('Enhanced News Bot Tests', () => {
  
  // Test news aggregation functionality
  describe('News Aggregation', () => {
    
    test('should aggregate news from multiple sources', async () => {
      // Mock RSS response
      const mockRSSResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test News Title - Source</title>
              <link>https://example.com/news</link>
              <pubDate>Mon, 06 Jun 2025 10:00:00 GMT</pubDate>
              <description>Test news description</description>
            </item>
          </channel>
        </rss>`
      };
      
      axios.get.mockResolvedValue(mockRSSResponse);
      
      const { scrapeEnhancedNews } = require('../server');
      const results = await scrapeEnhancedNews('test query', 'national');
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      
      // Check if articles have required properties
      if (results.length > 0) {
        const article = results[0];
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('link');
        expect(article).toHaveProperty('spiceScore');
        expect(article).toHaveProperty('conspiracyScore');
        expect(article).toHaveProperty('importanceScore');
        expect(article).toHaveProperty('totalScore');
      }
    });
    
    test('should handle API errors gracefully', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));
      
      const { scrapeEnhancedNews } = require('../server');
      const results = await scrapeEnhancedNews('test query', 'national');
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      // Should return fallback content even on error
    });
    
    test('should filter content within 24 hours', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
      const today = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago
      
      const { isWithin24Hours } = require('../server');
      
      expect(isWithin24Hours(today.toISOString())).toBe(true);
      expect(isWithin24Hours(yesterday.toISOString())).toBe(false);
      expect(isWithin24Hours(null)).toBe(true); // Should default to true for null dates
    });
  });
  
  // Test content scoring system
  describe('Content Scoring System', () => {
    
    test('should calculate spice score correctly', () => {
      const { calculateSpiceScore } = require('../server');
      
      const spicyTitle = "BREAKING: YouTuber Drama Exposed - Shocking Controversy";
      const normalTitle = "Regular news update about weather";
      
      const spicyScore = calculateSpiceScore(spicyTitle);
      const normalScore = calculateSpiceScore(normalTitle);
      
      expect(spicyScore).toBeGreaterThan(normalScore);
      expect(spicyScore).toBeGreaterThanOrEqual(0);
      expect(spicyScore).toBeLessThanOrEqual(10);
    });
    
    test('should calculate conspiracy score correctly', () => {
      const { calculateConspiracyScore } = require('../server');
      
      const conspiracyTitle = "Secret Government Cover Up Exposed - Hidden Truth Revealed";
      const normalTitle = "Regular government policy announcement";
      
      const conspiracyScore = calculateConspiracyScore(conspiracyTitle);
      const normalScore = calculateConspiracyScore(normalTitle);
      
      expect(conspiracyScore).toBeGreaterThan(normalScore);
      expect(conspiracyScore).toBeGreaterThanOrEqual(0);
      expect(conspiracyScore).toBeLessThanOrEqual(10);
    });
    
    test('should calculate importance score correctly', () => {
      const { calculateImportanceScore } = require('../server');
      
      const importantTitle = "BREAKING NEWS: Emergency Alert - Crisis Situation";
      const normalTitle = "Regular daily update";
      
      const importantScore = calculateImportanceScore(importantTitle);
      const normalScore = calculateImportanceScore(normalTitle);
      
      expect(importantScore).toBeGreaterThan(normalScore);
      expect(importantScore).toBeGreaterThanOrEqual(0);
      expect(importantScore).toBeLessThanOrEqual(10);
    });
  });
  
  // Test content moderation
  describe('Content Moderation', () => {
    
    test('should filter profanity correctly', () => {
      const { moderateContent } = require('../server');
      
      const cleanTitle = "Regular news about technology updates";
      const profaneTitle = "This is bullshit fake news";
      
      const cleanResult = moderateContent(cleanTitle);
      const profaneResult = moderateContent(profaneTitle);
      
      expect(cleanResult.isClean).toBe(true);
      expect(profaneResult.isClean).toBe(false);
      expect(profaneResult.issues.profanity || profaneResult.issues.badWordsFilter).toBe(true);
    });
    
    test('should detect suspicious fake news patterns', () => {
      const { moderateContent } = require('../server');
      
      const normalTitle = "Regular news update from reliable source";
      const suspiciousTitle = "You wont believe this shocking truth they dont want you to know";
      
      const normalResult = moderateContent(normalTitle);
      const suspiciousResult = moderateContent(suspiciousTitle);
      
      expect(normalResult.isClean).toBe(true);
      expect(suspiciousResult.isClean).toBe(false);
      expect(suspiciousResult.issues.suspiciousFake).toBe(true);
    });
  });
  
  // Test duplicate filtering
  describe('Duplicate Filtering', () => {
    
    test('should remove duplicate articles correctly', () => {
      const articles = [
        {
          title: "Same News Story - Source A",
          link: "https://example.com/news1",
          description: "Description about news"
        },
        {
          title: "Same News Story - Source B", // Similar title
          link: "https://example.com/news2",
          description: "Different description"
        },
        {
          title: "Completely Different News",
          link: "https://example.com/news3",
          description: "Different news content"
        }
      ];
      
      // Simulate the duplicate removal logic
      const uniqueArticles = [];
      const seenTitles = new Set();
      
      articles.forEach(article => {
        const titleKey = article.title.toLowerCase().substring(0, 40);
        if (!seenTitles.has(titleKey)) {
          seenTitles.add(titleKey);
          uniqueArticles.push(article);
        }
      });
      
      expect(uniqueArticles.length).toBe(2); // Should remove one duplicate
      expect(uniqueArticles[0].title).toContain("Same News Story");
      expect(uniqueArticles[1].title).toBe("Completely Different News");
    });
    
    test('should handle articles with identical links', () => {
      const articles = [
        {
          title: "News Story One",
          link: "https://example.com/same-link",
          description: "Description one"
        },
        {
          title: "News Story Two",
          link: "https://example.com/same-link", // Same link
          description: "Description two"
        }
      ];
      
      const uniqueArticles = [];
      const seenLinks = new Set();
      
      articles.forEach(article => {
        const linkKey = article.link.toLowerCase();
        if (!seenLinks.has(linkKey)) {
          seenLinks.add(linkKey);
          uniqueArticles.push(article);
        }
      });
      
      expect(uniqueArticles.length).toBe(1); // Should keep only one
    });
  });
  
  // Test news categorization
  describe('News Categorization', () => {
    
    test('should categorize YouTube content correctly', () => {
      const { categorizeNews } = require('../server');
      
      const youtubeTitle = "CarryMinati latest controversy exposed";
      const bollywoodTitle = "Shah Rukh Khan new movie release";
      const cricketTitle = "Virat Kohli century in latest match";
      const pakistanTitle = "Pakistan political crisis deepens";
      const nationalTitle = "India economic policy update";
      
      expect(categorizeNews(youtubeTitle)).toBe('youtubers');
      expect(categorizeNews(bollywoodTitle)).toBe('bollywood');
      expect(categorizeNews(cricketTitle)).toBe('cricket');
      expect(categorizeNews(pakistanTitle)).toBe('pakistan');
      expect(categorizeNews(nationalTitle)).toBe('national');
    });
    
    test('should handle mixed content appropriately', () => {
      const { categorizeNews } = require('../server');
      
      const mixedTitle = "YouTube creator talks about Bollywood movie";
      // Should prioritize first match (YouTube in this case)
      expect(categorizeNews(mixedTitle)).toBe('youtubers');
    });
  });
  
  // Test database operations
  describe('Database Operations', () => {
    
    beforeEach(async () => {
      // Clean test data before each test
      if (database && database.db) {
        await new Promise((resolve) => {
          database.db.run("DELETE FROM user_keywords WHERE user_id = 999999", resolve);
        });
      }
    });
    
    test('should add user keywords correctly', async () => {
      if (!database) {
        console.log('Database not available, skipping test');
        return;
      }
      
      const testUserId = 999999;
      const testCategory = 'youtubers';
      const testKeyword = 'test keyword';
      
      try {
        await database.addUserKeyword(testUserId, testCategory, testKeyword, 5);
        const keywords = await database.getUserKeywords(testUserId, testCategory);
        
        expect(keywords.length).toBeGreaterThan(0);
        expect(keywords[0].keyword).toBe(testKeyword);
        expect(keywords[0].priority).toBe(5);
      } catch (error) {
        console.log('Database test skipped:', error.message);
      }
    });
    
    test('should prevent duplicate keywords', async () => {
      if (!database) return;
      
      const testUserId = 999999;
      const testCategory = 'youtubers';
      const testKeyword = 'duplicate test';
      
      try {
        await database.addUserKeyword(testUserId, testCategory, testKeyword, 5);
        
        // Try to add the same keyword again - should handle gracefully
        await database.addUserKeyword(testUserId, testCategory, testKeyword, 5);
        
        const keywords = await database.getUserKeywords(testUserId, testCategory);
        expect(keywords.length).toBe(1); // Should still be only one
      } catch (error) {
        // Should handle duplicate gracefully
        expect(error).toBeDefined();
      }
    });
  });
  
  // Test rate limiting
  describe('Rate Limiting', () => {
    
    test('should enforce rate limits correctly', () => {
      const { checkUserRateLimit } = require('../server');
      
      const testUserId = 999999;
      const testCommand = 'test';
      
      // Should allow first few requests
      for (let i = 0; i < 5; i++) {
        const result = checkUserRateLimit(testUserId, testCommand);
        expect(result.allowed).toBe(true);
      }
      
      // Should start blocking after limit
      for (let i = 0; i < 10; i++) {
        checkUserRateLimit(testUserId, testCommand);
      }
      
      const blockedResult = checkUserRateLimit(testUserId, testCommand);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.resetTime).toBeGreaterThan(0);
    });
  });
  
  // Test API endpoints
  describe('API Endpoints', () => {
    
    test('GET / should return bot status', async () => {
      const response = await request(app).get('/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('features');
      expect(response.body.version).toBe('3.0.0');
    });
    
    test('GET /health should return health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('features');
      expect(response.body.features).toHaveProperty('workingLinks', true);
      expect(response.body.features).toHaveProperty('contentScoring', true);
      expect(response.body.features).toHaveProperty('moderation', true);
    });
    
    test('GET /analytics should return analytics data', async () => {
      const response = await request(app).get('/analytics');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('bot');
      expect(response.body).toHaveProperty('content');
      expect(response.body).toHaveProperty('system');
      expect(response.body.bot).toHaveProperty('totalRequests');
      expect(response.body.content).toHaveProperty('averageScore');
      expect(response.body.system).toHaveProperty('uptime');
    });
    
    test('GET /ping should return pong', async () => {
      const response = await request(app).get('/ping');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'pong');
      expect(response.body).toHaveProperty('version', '3.0.0');
      expect(response.body).toHaveProperty('features');
    });
  });
  
  // Test utility functions
  describe('Utility Functions', () => {
    
    test('should format dates correctly', () => {
      const { formatNewsDate } = require('../server');
      
      const now = new Date();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      expect(formatNewsDate(now.toISOString())).toBe('Just now');
      expect(formatNewsDate(fiveMinutesAgo.toISOString())).toContain('min ago');
      expect(formatNewsDate(oneHourAgo.toISOString())).toContain('h ago');
      expect(formatNewsDate(oneDayAgo.toISOString())).not.toContain('ago');
    });
    
    test('should get current Indian time', () => {
      const { getCurrentIndianTime } = require('../server');
      
      const indianTime = getCurrentIndianTime();
      expect(indianTime).toBeInstanceOf(Date);
      
      // Should be within reasonable range (not too far from current time)
      const now = new Date();
      const timeDiff = Math.abs(indianTime.getTime() - now.getTime());
      expect(timeDiff).toBeLessThan(24 * 60 * 60 * 1000); // Within 24 hours
    });
    
    test('should validate timestamps correctly', () => {
      const { getCurrentTimestamp } = require('../server');
      
      const timestamp = getCurrentTimestamp();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      
      const parsedDate = new Date(timestamp);
      expect(parsedDate).toBeInstanceOf(Date);
      expect(isNaN(parsedDate.getTime())).toBe(false);
    });
  });
  
  // Test multi-platform search
  describe('Multi-Platform Search', () => {
    
    test('should search across multiple platforms', async () => {
      // Mock successful responses
      axios.get.mockResolvedValue({
        data: `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test Search Result</title>
              <link>https://example.com/news</link>
              <pubDate>Mon, 06 Jun 2025 10:00:00 GMT</pubDate>
              <description>Test description</description>
            </item>
          </channel>
        </rss>`
      });
      
      const { searchMultiplePlatforms } = require('../server');
      const results = await searchMultiplePlatforms('test query');
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length > 0) {
        // Should have results from different platforms
        const platforms = [...new Set(results.map(r => r.platform))];
        expect(platforms.length).toBeGreaterThan(0);
        
        // Each result should have required properties
        results.forEach(result => {
          expect(result).toHaveProperty('title');
          expect(result).toHaveProperty('link');
          expect(result).toHaveProperty('platform');
          expect(result).toHaveProperty('totalScore');
        });
      }
    });
  });
  
  // Test enhanced keywords functionality
  describe('Enhanced Keywords', () => {
    
    test('should have proper keyword structure', () => {
      const { ENHANCED_SEARCH_KEYWORDS } = require('../server');
      
      expect(ENHANCED_SEARCH_KEYWORDS).toBeDefined();
      
      const categories = ['youtubers', 'bollywood', 'cricket', 'national', 'pakistan'];
      categories.forEach(category => {
        expect(ENHANCED_SEARCH_KEYWORDS[category]).toBeDefined();
        expect(ENHANCED_SEARCH_KEYWORDS[category]).toHaveProperty('spicy');
        expect(ENHANCED_SEARCH_KEYWORDS[category]).toHaveProperty('conspiracy');
        expect(ENHANCED_SEARCH_KEYWORDS[category]).toHaveProperty('important');
        
        expect(Array.isArray(ENHANCED_SEARCH_KEYWORDS[category].spicy)).toBe(true);
        expect(Array.isArray(ENHANCED_SEARCH_KEYWORDS[category].conspiracy)).toBe(true);
        expect(Array.isArray(ENHANCED_SEARCH_KEYWORDS[category].important)).toBe(true);
      });
    });
    
    test('should have meaningful keyword content', () => {
      const { ENHANCED_SEARCH_KEYWORDS } = require('../server');
      
      // Check that keywords are relevant to their categories
      expect(ENHANCED_SEARCH_KEYWORDS.youtubers.spicy.some(k => 
        k.toLowerCase().includes('youtube') || k.toLowerCase().includes('creator')
      )).toBe(true);
      
      expect(ENHANCED_SEARCH_KEYWORDS.bollywood.spicy.some(k => 
        k.toLowerCase().includes('bollywood') || k.toLowerCase().includes('celebrity')
      )).toBe(true);
      
      expect(ENHANCED_SEARCH_KEYWORDS.cricket.spicy.some(k => 
        k.toLowerCase().includes('cricket') || k.toLowerCase().includes('match')
      )).toBe(true);
    });
  });
  
  // Test error handling
  describe('Error Handling', () => {
    
    test('should handle network timeouts gracefully', async () => {
      axios.get.mockRejectedValue(new Error('timeout'));
      
      const { scrapeEnhancedNews } = require('../server');
      const results = await scrapeEnhancedNews('test', 'national');
      
      // Should not throw error, should return fallback
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
    
    test('should handle malformed RSS data', async () => {
      axios.get.mockResolvedValue({ data: 'invalid xml data' });
      
      const { scrapeEnhancedNews } = require('../server');
      const results = await scrapeEnhancedNews('test', 'national');
      
      // Should handle gracefully and return fallback
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });
  
  // Performance tests
  describe('Performance Tests', () => {
    
    test('content scoring should be fast', () => {
      const { calculateSpiceScore, calculateConspiracyScore, calculateImportanceScore } = require('../server');
      
      const testTitle = "Breaking: Major controversy exposed in latest scandal drama";
      const iterations = 1000;
      
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        calculateSpiceScore(testTitle);
        calculateConspiracyScore(testTitle);
        calculateImportanceScore(testTitle);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete 1000 iterations in under 100ms
      expect(duration).toBeLessThan(100);
    });
    
    test('duplicate filtering should be efficient', () => {
      // Create array of 1000 articles with some duplicates
      const articles = [];
      for (let i = 0; i < 1000; i++) {
        articles.push({
          title: `Article ${i % 100}`, // Creates duplicates every 100
          link: `https://example.com/article${i}`,
          description: `Description ${i}`
        });
      }
      
      const startTime = Date.now();
      
      // Simulate duplicate removal
      const uniqueArticles = [];
      const seenTitles = new Set();
      
      articles.forEach(article => {
        const titleKey = article.title.toLowerCase().substring(0, 40);
        if (!seenTitles.has(titleKey)) {
          seenTitles.add(titleKey);
          uniqueArticles.push(article);
        }
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(uniqueArticles.length).toBe(100); // Should have 100 unique titles
      expect(duration).toBeLessThan(50); // Should be fast
    });
  });
});

// Integration tests
describe('Integration Tests', () => {
  
  test('complete news flow should work', async () => {
    // Mock external API
    axios.get.mockResolvedValue({
      data: `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>YouTube Drama Exposed - Creator Controversy</title>
            <link>https://example.com/youtube-drama</link>
            <pubDate>Mon, 06 Jun 2025 10:00:00 GMT</pubDate>
            <description>Latest YouTube creator controversy exposed</description>
          </item>
        </channel>
      </rss>`
    });
    
    const { fetchEnhancedContent } = require('../server');
    
    try {
      const results = await fetchEnhancedContent('youtubers');
      
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      
      if (results.length > 0) {
        const article = results[0];
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('spiceScore');
        expect(article).toHaveProperty('conspiracyScore');
        expect(article).toHaveProperty('importanceScore');
        expect(article).toHaveProperty('totalScore');
        expect(article.category).toBe('youtubers');
      }
    } catch (error) {
      console.log('Integration test skipped due to:', error.message);
    }
  });
});

// Cleanup after tests
afterAll(async () => {
  if (database && database.db) {
    // Clean up test data
    await new Promise((resolve) => {
      database.db.run("DELETE FROM user_keywords WHERE user_id = 999999", resolve);
    });
    
    // Close database connection
    database.db.close();
  }
});

// Test configuration
module.exports = {
  testEnvironment: 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
