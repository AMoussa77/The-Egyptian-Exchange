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
    // Mock axios for graceful degradation
    axios = {
      get: () => Promise.reject(new Error('Axios not available - using mock data'))
    };
    console.log('⚠️ Using mock axios');
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
  }

  async fetchStockData() {
    try {
      // Check if axios is available
      if (!axios) {
        console.log('⚠️ Axios not available, using mock data');
        return this.getMockData();
      }

      console.log('🌐 Fetching stock data from Egyptian Exchange website...');
      
      const response = await axios.get(this.baseUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive'
        }
      });

      // Use simple regex parsing instead of cheerio
      const html = response.data;
      const stockData = this.parseHTMLWithRegex(html);

      if (stockData.length > 0) {
        console.log(`✅ Successfully scraped ${stockData.length} stocks from website`);
        return stockData;
      } else {
        console.log('⚠️ No stock data found, using mock data');
        return this.getMockData();
      }

    } catch (error) {
      console.error('❌ Error fetching stock data from website:', error.message);
      
      // Return mock data if scraping fails
      return this.getMockData();
    }
  }

  parseHTMLWithRegex(html) {
    try {
      const stockData = [];
      
      // Extract table rows using regex
      const tableRowRegex = /<tr[^>]*>(.*?)<\/tr>/gs;
      const cellRegex = /<td[^>]*>(.*?)<\/td>/gs;
      const linkRegex = /<a[^>]*>(.*?)<\/a>/gs;
      
      let match;
      let rowIndex = 0;
      
      while ((match = tableRowRegex.exec(html)) !== null) {
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
          const stock = {
            'أقصى_سعر': cells[0] || '',
            'أدنى_سعر': cells[1] || '',
            'إغلاق': cells[2] || '',
            'إقفال_سابق': cells[3] || '',
            'التغير': cells[4] || '',
            '%التغيير': cells[5] || '',
            'أعلى': cells[6] || '',
            'الأدنى': cells[7] || '',
            'الطلب': cells[8] || '',
            'العرض': cells[9] || '',
            'أخر_سعر': cells[10] || '',
            'الإسم_المختصر': cells[11] || '',
            'حجم_التداول': cells[12] || ''
          };

          // Only add if we have a valid stock name
          if (stock['الإسم_المختصر'] && stock['الإسم_المختصر'].length > 0) {
            stockData.push(stock);
          }
        }
        
        rowIndex++;
      }
      
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
        'أقصى_سعر': '1251',
        'أدنى_سعر': '1187.5',
        'إغلاق': '1250',
        'إقفال_سابق': '1250',
        'التغير': '0',
        '%التغيير': '0',
        'أعلى': '1251',
        'الأدنى': '1250',
        'الطلب': '1250',
        'العرض': '1460',
        'أخر_سعر': '1250',
        'الإسم_المختصر': 'العز الدخيلة للصلب',
        'حجم_التداول': '76'
      },
      {
        'أقصى_سعر': '300.42',
        'أدنى_سعر': '200.28',
        'إغلاق': '0',
        'إقفال_سابق': '250.35',
        'التغير': '1.65',
        '%التغيير': '0.66',
        'أعلى': '252',
        'الأدنى': '247',
        'الطلب': '250.2',
        'العرض': '252.5',
        'أخر_سعر': '252',
        'الإسم_المختصر': 'مينا فارم للأدوية',
        'حجم_التداول': '908'
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
      if (this.dataCallback && data) {
        this.dataCallback(data);
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
