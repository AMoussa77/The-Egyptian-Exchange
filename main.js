const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Load modules with fallback support
let axios;
let cheerio;

try {
  axios = require('axios');
  console.log('✅ Axios loaded successfully in main.js');
} catch (error) {
  console.error('Failed to load axios in main.js:', error.message);
  // Mock axios for graceful degradation
  axios = {
    get: () => Promise.reject(new Error('Axios not available'))
  };
  console.log('⚠️ Using mock axios in main.js');
}

try {
  cheerio = require('cheerio');
  console.log('✅ Cheerio loaded successfully in main.js');
} catch (error) {
  console.error('Failed to load cheerio in main.js:', error.message);
  // Mock cheerio for graceful degradation
  cheerio = {
    load: () => ({
      find: () => ({ each: () => {} }),
      text: () => ''
    })
  };
  console.log('⚠️ Using mock cheerio in main.js');
}

const { exec } = require('child_process');

// Load web scraper with fallback support
let EgyptianExchangeScraper;
try {
  EgyptianExchangeScraper = require('./webScraper');
} catch (error) {
  console.error('Failed to load webScraper:', error);
  // Create a mock scraper for graceful degradation
  EgyptianExchangeScraper = class MockScraper {
    constructor() {
      this.isRunning = false;
    }
    
    async fetchStockData() {
      console.log('⚠️ Web scraper not available, returning mock data');
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
        }
      ];
    }
    
    startAutoUpdate(callback) {
      console.log('⚠️ Mock scraper: Auto-update disabled');
      this.isRunning = true;
      // Load initial mock data
      this.fetchStockData().then(callback);
    }
    
    stopAutoUpdate() {
      this.isRunning = false;
      console.log('⏹️ Mock scraper stopped');
    }
  };
}

let mainWindow;
let stockData = [];
let scraper;
let settings = {
    autoUpdate: true,
    windowBounds: {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined
    }
};

// Settings file path
const settingsPath = path.join(__dirname, 'settings.json');

// Load settings from file
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const loadedSettings = JSON.parse(data);
      // Merge with defaults to ensure all properties exist
      settings = { ...settings, ...loadedSettings };
      console.log('Settings loaded from file');
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Save settings to file
function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('Settings saved to file');
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Simple update checker configuration
const GITHUB_REPO = 'AMoussa77/The-Egyptian-Exchange';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const DOWNLOAD_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

// Function to compare semantic versions
function compareVersions(version1, version2) {
  const v1parts = version1.split('.').map(Number);
  const v2parts = version2.split('.').map(Number);
  
  // Ensure both arrays have the same length
  while (v1parts.length < v2parts.length) v1parts.push(0);
  while (v2parts.length < v1parts.length) v2parts.push(0);
  
  for (let i = 0; i < v1parts.length; i++) {
    if (v1parts[i] > v2parts[i]) return 1;
    if (v1parts[i] < v2parts[i]) return -1;
  }
  
  return 0; // versions are equal
}

console.log('🚀 Simple update checker enabled');
console.log('📋 Current version:', app.getVersion());
console.log('🔗 GitHub repo:', GITHUB_REPO);

// Check for updates on app start if auto-update is enabled
setTimeout(() => {
  if (settings.autoUpdate) {
    console.log('🔍 Checking for updates on startup...');
    checkForUpdates();
  }
}, 5000); // Check after 5 seconds to let the app fully load

function createWindow() {
  // Load settings first
  loadSettings();
  
  const windowOptions = {
    width: settings.windowBounds.width,
    height: settings.windowBounds.height,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      hardwareAcceleration: false // Disable hardware acceleration to fix GPU errors
    },
    icon: path.join(__dirname, 'assets/icon.png'), // Optional icon
    title: 'Egyptian Exchange Stocks',
    autoHideMenuBar: true, // Hide the menu bar
    center: true, // Center the window on screen
    show: false // Don't show until ready
  };
  
  // Add position if saved (and valid)
  if (settings.windowBounds.x !== undefined && settings.windowBounds.y !== undefined && 
      settings.windowBounds.x >= 0 && settings.windowBounds.y >= 0 &&
      settings.windowBounds.x < 4000 && settings.windowBounds.y < 4000) { // Reasonable bounds check
    windowOptions.x = settings.windowBounds.x;
    windowOptions.y = settings.windowBounds.y;
    windowOptions.center = false; // Don't center if we have a saved position
    console.log('📍 Restoring window position:', settings.windowBounds.x, settings.windowBounds.y);
  } else {
    console.log('📍 No valid saved position, centering window');
  }
  
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile('index.html');

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Initialize web scraper after window is ready
  mainWindow.webContents.once('dom-ready', async () => {
    await initializeWebScraper();
    
    // Send a signal to the UI that data is ready
    console.log('📡 Sending data-ready signal to UI');
    mainWindow.webContents.send('data-ready');
  });
  
  // Save window bounds when window is moved or resized
  mainWindow.on('moved', () => {
    const bounds = mainWindow.getBounds();
    if (bounds.x >= 0 && bounds.y >= 0 && bounds.x < 4000 && bounds.y < 4000) {
      settings.windowBounds.x = bounds.x;
      settings.windowBounds.y = bounds.y;
      console.log('📍 Window moved, saving position:', bounds.x, bounds.y);
      saveSettings();
    }
  });
  
  mainWindow.on('resized', () => {
    const bounds = mainWindow.getBounds();
    if (bounds.width > 400 && bounds.height > 300) { // Minimum reasonable size
      settings.windowBounds.width = bounds.width;
      settings.windowBounds.height = bounds.height;
      console.log('📍 Window resized, saving size:', bounds.width, bounds.height);
      saveSettings();
    }
  });
}

async function initializeWebScraper() {
  console.log('🚀 Initializing Egyptian Exchange web scraper...');
  
  scraper = new EgyptianExchangeScraper();
  
  // Load initial data first, then start auto-updating
  try {
    console.log('📊 Loading initial stock data...');
    stockData = await scraper.fetchStockData();
    console.log(`📊 Initial stock data loaded: ${stockData.length} stocks`);
    
    // Send initial data to renderer immediately
    if (mainWindow) {
      console.log('📡 Sending initial stock data to UI...');
      mainWindow.webContents.send('stock-data-updated', stockData);
    }
    } catch (error) {
    console.error('❌ Failed to load initial stock data:', error);
    stockData = [];
  }
  
  // Start auto-updating stock data from web
  scraper.startAutoUpdate((data) => {
    stockData = data;
    console.log(`📊 Updated stock data: ${data.length} stocks`);
    
    // Send updated data to renderer
    if (mainWindow) {
      mainWindow.webContents.send('stock-data-updated', stockData);
    }
  });
}

async function refreshStockData() {
  console.log('🔄 Refreshing stock data from Egyptian Exchange website...');
  
  try {
    if (scraper) {
      const data = await scraper.fetchStockData();
      stockData = data;
      
      // Send updated data to renderer
      if (mainWindow) {
        mainWindow.webContents.send('stock-data-updated', stockData);
      }
      
      console.log(`✅ Stock data refreshed: ${data.length} stocks`);
      return true;
    } else {
      console.error('❌ Web scraper not initialized');
      return false;
    }
  } catch (error) {
    console.error('❌ Error refreshing stock data:', error);
    return false;
  }
}

async function loadStockData() {
  console.log('📊 Loading stock data from web source...');
  return await refreshStockData();
}

// IPC handlers
ipcMain.handle('get-stock-data', () => {
  console.log('📤 Sending stock data to UI:', stockData ? stockData.length : 0, 'stocks');
  console.log('📤 Stock data type:', typeof stockData);
  console.log('📤 Is array:', Array.isArray(stockData));
  if (stockData && stockData.length > 0) {
    console.log('📤 Sample stock:', stockData[0]);
  }
  return stockData;
});

ipcMain.handle('refresh-data', () => {
  loadStockData();
  return stockData;
});

ipcMain.handle('refresh-queries-and-data', async () => {
  await refreshStockData();
  return stockData;
});

ipcMain.handle('refresh-queries-only', async () => {
  const success = await refreshStockData();
  return { success, message: success ? 'Stock data refreshed successfully' : 'Failed to refresh stock data' };
});

// Simple update system - no complex event handlers needed


// Simple update notification system - no complex event handlers needed

// Function to check for updates based on settings
function checkForUpdatesIfEnabled() {
  if (settings.autoUpdate) {
    console.log('🔍 Checking for updates (auto-update enabled)');
    checkForUpdates().catch(error => {
      console.error('❌ Update check failed:', error);
    });
  } else {
    console.log('⏸️ Auto-update disabled, skipping update check');
  }
}

// Simple function to check for updates via GitHub API
async function checkForUpdates() {
  console.log('🔍 Checking for updates...');
  
  return new Promise((resolve, reject) => {
    const url = new URL(GITHUB_API_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        'User-Agent': 'Egyptian-Exchange-Stocks-App',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const currentVersion = app.getVersion();
          const latestVersion = release.tag_name.replace('v', '');
          
          console.log('📋 Current version:', currentVersion);
          console.log('📋 Latest version:', latestVersion);
          
          // Compare versions properly
          const isNewerVersion = compareVersions(latestVersion, currentVersion) > 0;
          
          if (isNewerVersion) {
            console.log('✅ New version available!');
            const updateInfo = {
              version: latestVersion,
              releaseNotes: release.body || 'New version available',
              releaseDate: release.published_at
            };
            
            if (mainWindow) {
              mainWindow.webContents.send('update-available', updateInfo);
            }
            
            resolve({ updateInfo });
          } else {
            console.log('ℹ️ You are using the latest version');
            if (mainWindow) {
              mainWindow.webContents.send('update-not-available', {
                currentVersion: currentVersion,
                message: 'You are using the latest version!'
              });
            }
            resolve({ updateInfo: null });
          }
        } catch (parseError) {
          console.error('❌ Error parsing GitHub API response:', parseError);
          reject(parseError);
        }
      });
    });
    
    req.on('error', (err) => {
      console.error('❌ Update check failed:', err);
      reject(err);
    });
    
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Update check timeout'));
    });
    
    req.end();
  });
}

// Function to check for updates if enabled
function checkForUpdatesIfEnabled() {
  if (settings.autoUpdate) {
    console.log('🔍 Checking for updates (auto-update enabled)');
    checkForUpdates().catch(error => {
      console.error('❌ Update check failed:', error);
    });
  } else {
    console.log('⏸️ Auto-update disabled, skipping update check');
  }
}

// Function to check for updates manually
async function checkForUpdatesManual() {
  console.log('🔍 Manual update check triggered');
  console.log('📋 Current version:', app.getVersion());
  
  try {
    const result = await checkForUpdates();
    console.log('✅ Manual update check completed:', result);
    return result;
  } catch (error) {
    console.error('❌ Manual update check failed:', error);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', error.message);
    }
    return { updateInfo: null, message: 'Update check failed: ' + error.message };
  }
}

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', async () => {
  console.log('Manual check for updates triggered');
  return checkForUpdatesManual();
});

// IPC handler to open download page
ipcMain.handle('open-download-page', () => {
  try {
    console.log('Opening download page in browser...');
    shell.openExternal(DOWNLOAD_URL);
    return { success: true, message: 'Download page opened in browser' };
  } catch (error) {
    console.error('Error opening download page:', error);
    return { success: false, error: error.message };
  }
});

// Install update handler removed - users download manually from GitHub

    ipcMain.handle('get-settings', () => {
        return settings;
    });

    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });

ipcMain.handle('update-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  
  // Save settings to file
  saveSettings();
  
  // If auto-update setting changed, check for updates if enabled
  if (newSettings.autoUpdate !== undefined) {
    checkForUpdatesIfEnabled();
  }
  
  return settings;
});

// Fix GPU issues
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');

app.whenReady().then(() => {
  createWindow();
  
  // Check for updates after a short delay to allow window to load
  setTimeout(() => {
    checkForUpdatesIfEnabled();
  }, 2000);
});

app.on('window-all-closed', () => {
  if (scraper) {
    scraper.stopAutoUpdate();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (scraper) {
    scraper.stopAutoUpdate();
  }
});
