// Load modules with fallback support
let axios;
let cheerio;

try {
  axios = require('axios');
  console.log('✅ Axios loaded successfully from node_modules');
} catch (error) {
  console.error('Failed to load axios from node_modules:', error.message);
  try {
    const { app } = require('electron');
    const path = require('path');
    const axiosPath = path.join(process.resourcesPath, 'axios');
    axios = require(axiosPath);
    console.log('✅ Axios loaded successfully from extraResources');
  } catch (fallbackError) {
    console.error('Failed to load axios from extraResources:', fallbackError.message);
    try {
      // Try loading from asar unpacked
      const path = require('path');
      const axiosPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'axios');
      axios = require(axiosPath);
      console.log('✅ Axios loaded successfully from asar unpacked');
    } catch (asarError) {
      console.error('Failed to load axios from asar unpacked:', asarError.message);
      try {
        // Try using Node.js built-in https module as fallback
        const https = require('https');
        const http = require('http');
        const { URL } = require('url');
        
        axios = {
          get: (url, options = {}) => {
            return new Promise((resolve, reject) => {
              const makeRequest = (targetUrl, redirectCount = 0) => {
                if (redirectCount > 5) {
                  reject(new Error('Too many redirects'));
                  return;
                }
                
                const urlObj = new URL(targetUrl);
                const protocol = urlObj.protocol === 'https:' ? https : http;
                
                const requestOptions = {
                  hostname: urlObj.hostname,
                  port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                  path: urlObj.pathname + urlObj.search,
                  method: 'GET',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate',
                    'Connection': 'keep-alive',
                    ...options.headers
                  }
                };
                
                const req = protocol.request(requestOptions, (res) => {
                  // Handle redirects
                  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectUrl = new URL(res.headers.location, targetUrl).href;
                    console.log(`🔄 Redirecting to: ${redirectUrl}`);
                    makeRequest(redirectUrl, redirectCount + 1);
                    return;
                  }
                  
                  let data = '';
                  
                  res.on('data', (chunk) => {
                    data += chunk;
                  });
                  
                  res.on('end', () => {
                    resolve({
                      status: res.statusCode,
                      data: data,
                      headers: res.headers
                    });
                  });
                });
                
                req.on('error', (err) => {
                  reject(err);
                });
                
                req.setTimeout(options.timeout || 15000, () => {
                  req.destroy();
                  reject(new Error('Request timeout'));
                });
                
                req.end();
              };
              
              makeRequest(url);
            });
          }
        };
        
        console.log('✅ Using Node.js built-in HTTP module as axios fallback');
      } catch (httpError) {
        console.error('Failed to create HTTP fallback:', httpError.message);
        // Mock axios for graceful degradation
        axios = {
          get: () => Promise.reject(new Error('Axios not available - using mock data'))
        };
        console.log('⚠️ Using mock axios');
      }
    }
  }
}

try {
  cheerio = require('cheerio');
  console.log('✅ Cheerio loaded successfully from node_modules');
} catch (error) {
  console.error('Failed to load cheerio from node_modules:', error.message);
  try {
    const { app } = require('electron');
    const path = require('path');
    const cheerioPath = path.join(process.resourcesPath, 'cheerio');
    cheerio = require(cheerioPath);
    console.log('✅ Cheerio loaded successfully from extraResources');
  } catch (fallbackError) {
    console.error('Failed to load cheerio from extraResources:', fallbackError.message);
    // Mock cheerio for graceful degradation
    cheerio = {
      load: (html) => {
        console.log('⚠️ Using mock cheerio - no HTML parsing available');
        return {
          find: (selector) => ({
            each: (callback) => {
              console.log(`⚠️ Mock cheerio: find('${selector}') called but no elements found`);
            }
          }),
          text: () => 'Mock data - cheerio not available'
        };
      }
    };
    
    // Create a proper $ function
    global.$ = cheerio.load('<div>Mock</div>');
    console.log('⚠️ Using mock cheerio');
  }
}

class EgyptianExchangeScraper {
  constructor() {
    this.baseUrl = 'http://41.33.162.236/egs4';
    this.updateInterval = 30000; // 30 seconds
    this.isRunning = false;
    this.intervalId = null;
    this.dataCallback = null;
    this.isScraping = false; // Lock to prevent overlapping requests
    this.marketSettings = {
      marketOpenTime: { hour: 10, minute: 0 },
      marketCloseTime: { hour: 14, minute: 30 }
    };
  }

  // Check if market is currently open
  isMarketOpen() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;
    
    const openTime = this.marketSettings.marketOpenTime.hour * 60 + this.marketSettings.marketOpenTime.minute;
    const closeTime = this.marketSettings.marketCloseTime.hour * 60 + this.marketSettings.marketCloseTime.minute;
    
    return currentTime >= openTime && currentTime < closeTime;
  }

  // Update market settings from main process
  updateMarketSettings(settings) {
    this.marketSettings = {
      marketOpenTime: settings.marketOpenTime || this.marketSettings.marketOpenTime,
      marketCloseTime: settings.marketCloseTime || this.marketSettings.marketCloseTime
    };
    console.log('📊 Market settings updated:', this.marketSettings);
  }

  async fetchStockData(forceRealData = false) {
    // Check if already scraping
    if (this.isScraping) {
      console.log('⏳ Scraping already in progress, skipping request');
      return null; // Return null to indicate request was skipped
    }

    try {
      // Set scraping lock
      this.isScraping = true;
      console.log('🔒 Scraping lock acquired');

      // Check if market is open before scraping (unless forced)
      if (!forceRealData && !this.isMarketOpen()) {
        console.log('⏰ Market is closed, skipping data scraping');
        return this.getMockData();
      }

      // Check if axios is available
      if (!axios || typeof axios.get !== 'function') {
        console.log('⚠️ Axios not available or invalid, using mock data');
        console.log('Axios type:', typeof axios);
        return this.getMockData();
      }

      console.log('🌐 Fetching stock data from Egyptian Exchange website...');
      console.log('🌐 URL:', this.baseUrl);
      
      const response = await axios.get(this.baseUrl, {
        timeout: 15000, // Increased timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        }
      });

      console.log('📡 Response status:', response.status);
      console.log('📡 Response data length:', response.data ? response.data.length : 0);

      // Use simple regex parsing instead of cheerio
      const html = response.data;
      const stockData = this.parseHTMLWithRegex(html);

      if (stockData.length > 0) {
        console.log(`✅ Successfully scraped ${stockData.length} stocks from website`);
        return stockData;
      } else {
        console.log('⚠️ No stock data found in parsed HTML, using mock data');
        return this.getMockData();
      }

    } catch (error) {
      console.error('❌ Error fetching stock data from website:', error.message);
      console.error('❌ Error details:', error);
      
      // Return mock data if scraping fails
      return this.getMockData();
    } finally {
      // Always release the scraping lock
      this.isScraping = false;
      console.log('🔓 Scraping lock released');
    }
  }

  parseHTMLWithRegex(html) {
    try {
      const stockData = [];
      
      console.log('🔍 Parsing HTML with regex...');
      console.log('📄 HTML length:', html ? html.length : 0);
      
      // Extract table rows using regex
      const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
      const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
      
      let match;
      let rowIndex = 0;
      let totalRows = 0;
      
      while ((match = tableRowRegex.exec(html)) !== null) {
        totalRows++;
        if (rowIndex === 0) {
          rowIndex++;
          continue; // Skip header row
        }
        
        const rowContent = match[1];
        const cells = [];
        let cellMatch;
        
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          let cellText = cellMatch[1];
          
          // Remove HTML tags and clean up text
          cellText = cellText.replace(/<[^>]*>/g, '');
          cellText = cellText.replace(/&nbsp;/g, ' ');
          cellText = cellText.replace(/&amp;/g, '&');
          cellText = cellText.replace(/&lt;/g, '<');
          cellText = cellText.replace(/&gt;/g, '>');
          cellText = cellText.trim();
          
          cells.push(cellText);
        }
        
        if (cells.length >= 13) {
          // Helper function to convert string to number, keeping original if not numeric
          const parseNumeric = (value) => {
            if (!value || value === '') return '';
            const num = parseFloat(value);
            return isNaN(num) ? value : num;
          };

          const stock = {
            'أقصى_سعر': parseNumeric(cells[0]),
            'أدنى_سعر': parseNumeric(cells[1]),
            'إغلاق': parseNumeric(cells[2]),
            'إقفال_سابق': parseNumeric(cells[3]),
            'التغير': parseNumeric(cells[4]),
            '%التغيير': parseNumeric(cells[5]),
            'أعلى': parseNumeric(cells[6]),
            'الأدنى': parseNumeric(cells[7]),
            'الطلب': parseNumeric(cells[8]),
            'العرض': parseNumeric(cells[9]),
            'أخر_سعر': parseNumeric(cells[10]),
            'الإسم_المختصر': cells[11] || '', // Keep as string
            'حجم_التداول': parseNumeric(cells[12])
          };

          // Only add if we have a valid stock name
          if (stock['الإسم_المختصر'] && stock['الإسم_المختصر'].length > 0) {
            stockData.push(stock);
          }
        }
        
        rowIndex++;
      }
      
      console.log(`📊 Parsed ${totalRows} total rows, found ${stockData.length} valid stocks`);
      
      return stockData;
      
    } catch (error) {
      console.error('❌ Error parsing HTML with regex:', error.message);
      return [];
    }
  }

  getMockData() {
    console.log('📊 Returning mock data due to scraping error');
    return [
      {
        'أقصى_سعر': 1251,
        'أدنى_سعر': 1187.5,
        'إغلاق': 1250,
        'إقفال_سابق': 1250,
        'التغير': 0,
        '%التغيير': 0,
        'أعلى': 1251,
        'الأدنى': 1250,
        'الطلب': 1250,
        'العرض': 1460,
        'أخر_سعر': 1250,
        'الإسم_المختصر': 'العز الدخيلة للصلب',
        'حجم_التداول': 76
      },
      {
        'أقصى_سعر': 300.42,
        'أدنى_سعر': 200.28,
        'إغلاق': 0,
        'إقفال_سابق': 250.35,
        'التغير': 1.65,
        '%التغيير': 0.66,
        'أعلى': 252,
        'الأدنى': 247,
        'الطلب': 250.2,
        'العرض': 252.5,
        'أخر_سعر': 252,
        'الإسم_المختصر': 'مينا فارم للأدوية',
        'حجم_التداول': 908
      }
    ];
  }

  startAutoUpdate(callback) {
    if (this.isRunning) {
      console.log('⚠️ Auto-update already running');
      return;
    }

    this.dataCallback = callback;
    this.isRunning = true;

    console.log('🚀 Starting auto-update for Egyptian Exchange data...');
    
    // Fetch initial data
    this.fetchAndNotify();

    // Set up interval for periodic updates
    this.intervalId = setInterval(() => {
      this.fetchAndNotify();
    }, this.updateInterval);
  }

  async fetchAndNotify() {
    try {
      const data = await this.fetchStockData();
      
      // If data is null, scraping was skipped because another request is in progress
      if (data === null) {
        console.log('⏳ Skipping update - scraping already in progress');
        return;
      }
      
      // Only update with real data, don't overwrite with mock data during auto-updates
      if (this.dataCallback && data && data.length > 10) { // Real data has 300+ stocks, mock has 2
        this.dataCallback(data);
      } else if (this.isMarketOpen()) {
        // Only send mock data if market is open (shouldn't happen, but as fallback)
        this.dataCallback(data);
      } else {
        console.log('⏰ Market closed - keeping existing real data, not updating with mock data');
      }
    } catch (error) {
      console.error('❌ Error in fetchAndNotify:', error);
    }
  }

  stopAutoUpdate() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('⏹️ Auto-update stopped');
  }

  setUpdateInterval(interval) {
    this.updateInterval = interval;
    console.log(`⏰ Update interval set to ${interval}ms`);
  }
}

module.exports = EgyptianExchangeScraper;
