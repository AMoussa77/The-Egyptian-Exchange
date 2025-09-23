const { app, BrowserWindow, ipcMain } = require('electron');
const log = require('electron-log');
let autoUpdater;
try {
  // Try to load from normal node_modules first
  autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
  try {
    // If that fails, try to load from extraResources
    const updaterPath = path.join(process.resourcesPath, 'electron-updater');
    autoUpdater = require(updaterPath).autoUpdater;
  } catch (fallbackError) {
    console.error('Failed to load electron-updater:', fallbackError);
    // Create a mock autoUpdater for graceful degradation
    autoUpdater = {
      checkForUpdates: () => Promise.resolve(),
      checkForUpdatesAndNotify: () => Promise.resolve(),
      downloadUpdate: () => Promise.resolve(),
      quitAndInstall: () => {},
      setFeedURL: () => {},
      on: () => {},
      autoDownload: false,
      autoInstallOnAppQuit: false
    };
  }
}
const path = require('path');
const fs = require('fs');

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

// Configure auto-updater
// Always enable auto-updater, but with different behaviors for dev vs production
autoUpdater.autoDownload = false; // Manual download control
autoUpdater.autoInstallOnAppQuit = true;

// Set the feed URL for GitHub releases
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'AMoussa77',
  repo: 'The-Egyptian-Exchange'
});

// Configure electron-log for auto-updater debugging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('Auto-updater logger configured');

if (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true') {
  console.log('🚀 Auto-updater enabled');
  console.log('📦 App is packaged:', app.isPackaged);
  console.log('🔧 Environment:', process.env.ENABLE_AUTO_UPDATER);
  console.log('📋 Current version:', app.getVersion());
  console.log('🔗 GitHub repo: AMoussa77/The-Egyptian-Exchange');
  
  // Check for updates on app start in production mode
  if (app.isPackaged) {
    console.log('🏭 Production mode: Checking for updates on startup...');
    setTimeout(() => {
      checkForUpdatesOnStartup();
    }, 5000); // Check after 5 seconds to let the app fully load
  }
} else {
  console.log('🧪 Development mode: Auto-updater enabled for testing');
  console.log('💡 Real update checks will work with GitHub releases');
  console.log('📋 Current version:', app.getVersion());
  console.log('🔗 GitHub repo: AMoussa77/The-Egyptian-Exchange');
}

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

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Checking for updates...');
  console.log('🔗 GitHub repo: AMoussa77/The-Egyptian-Exchange');
  if (mainWindow) {
    mainWindow.webContents.send('update-checking');
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('✅ Update available!');
  console.log('📋 New version:', info.version);
  console.log('📋 Current version:', app.getVersion());
  console.log('📝 Release notes:', info.releaseNotes);
  console.log('📦 Release date:', info.releaseDate);
  console.log('🔗 GitHub release URL:', `https://github.com/AMoussa77/The-Egyptian-Exchange/releases/tag/${info.version}`);
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('ℹ️ No updates available');
  console.log('📋 Current version:', app.getVersion());
  console.log('📋 Latest version:', info?.version || 'Unknown');
  console.log('🔗 GitHub repo: https://github.com/AMoussa77/The-Egyptian-Exchange');
  if (mainWindow) {
    mainWindow.webContents.send('update-not-available', {
      ...info,
      currentVersion: app.getVersion(),
      message: 'You are using the latest version!'
    });
  }
});

autoUpdater.on('error', (err) => {
  console.error('❌ Error in auto-updater:', err);
  console.error('🔗 GitHub repo: AMoussa77/The-Egyptian-Exchange');
  console.error('💡 Make sure GitHub releases are properly configured');
  console.error('📦 App is packaged:', app.isPackaged);
  console.error('🔗 Feed URL configured for: AMoussa77/The-Egyptian-Exchange');
  console.error('📋 Current version:', app.getVersion());
  console.error('❌ Error details:', err.message, err.code);
  
  // Handle specific download errors
  if (err.message.includes('404') || err.message.includes('blockmap')) {
    console.error('🚨 Blockmap/File naming issue detected!');
    console.error('💡 This usually means the .exe and .exe.blockmap files have different names');
    console.error('💡 Check GitHub releases for consistent file naming');
  }
  
  if (mainWindow) {
    mainWindow.webContents.send('update-error', err.message);
  }
});

autoUpdater.on('download-progress', (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
  log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
  console.log(log_message);
  if (mainWindow) {
    mainWindow.webContents.send('update-download-progress', progressObj);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded');
  if (mainWindow) {
    mainWindow.webContents.send('update-downloaded', info);
  }
});

// Function to check for updates based on settings
function checkForUpdatesIfEnabled() {
  if (settings.autoUpdate && (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true')) {
    console.log('🔍 Checking for updates (auto-update enabled)');
    autoUpdater.checkForUpdatesAndNotify();
  } else {
    console.log('⏸️ Auto-update disabled, skipping update check');
  }
}

// Function to check GitHub releases directly via API
async function checkGitHubReleasesDirectly() {
  console.log('🔗 Checking GitHub releases directly via API...');
  
  try {
    const https = require('https');
    const { URL } = require('url');
    
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        port: 443,
        path: '/repos/AMoussa77/The-Egyptian-Exchange/releases/latest',
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
            console.log('📦 Latest GitHub release:', release.tag_name);
            
            const currentVersion = app.getVersion();
            const latestVersion = release.tag_name.replace('v', '');
            
            console.log('📋 Current version:', currentVersion);
            console.log('📋 Latest version:', latestVersion);
            
            if (latestVersion !== currentVersion) {
              console.log('✅ New version available via GitHub API');
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
              console.log('ℹ️ No new version available via GitHub API');
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
        console.error('❌ GitHub API request failed:', err);
        reject(err);
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('GitHub API request timeout'));
      });
      
      req.end();
    });
  } catch (error) {
    console.error('❌ GitHub API fallback failed:', error);
    throw error;
  }
}

// Function to check for updates on startup (production mode only)
async function checkForUpdatesOnStartup() {
  console.log('🔍 Checking for updates on startup...');
  console.log('📋 Current version:', app.getVersion());
  console.log('🔗 Checking GitHub releases...');
  
  try {
    // Check if auto-updater is properly initialized
    if (!autoUpdater || typeof autoUpdater.checkForUpdates !== 'function') {
      console.error('❌ Auto-updater not properly initialized, using GitHub API fallback');
      const result = await checkGitHubReleasesDirectly();
      console.log('✅ Startup update check completed via GitHub API:', result);
      return;
    }
    
    // Use auto-updater for startup check
    console.log('🏭 Using auto-updater for startup check');
    const result = await autoUpdater.checkForUpdates();
    console.log('✅ Startup update check completed via auto-updater:', result);
    
  } catch (error) {
    console.error('❌ Startup update check failed:', error);
    console.error('❌ Error details:', error.message);
    
    // Try GitHub API fallback for startup check
    console.log('🔄 Trying GitHub API fallback for startup check');
    try {
      const githubResult = await checkGitHubReleasesDirectly();
      console.log('✅ Startup update check completed via GitHub API fallback:', githubResult);
    } catch (githubError) {
      console.error('❌ GitHub API fallback also failed for startup check:', githubError);
    }
  }
}

// Function to check for updates (always works for manual checks)
function checkForUpdatesManual() {
  console.log('🔍 Manual update check triggered');
  console.log('📋 Current version:', app.getVersion());
  console.log('🔗 Checking GitHub releases...');
  
  // Force update check to work in development mode
  if (!app.isPackaged) {
    console.log('🧪 Development mode: Forcing update check');
    
    // Create a mock update check that simulates checking GitHub
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('✅ Simulated update check completed');
        
        // Simulate finding a newer version (since there's v0.6.2 on GitHub)
        const mockUpdateInfo = {
          version: '0.6.2',
          releaseNotes: 'Development mode simulation - Egyptian Exchange Stocks',
          releaseDate: new Date().toISOString()
        };
        
        console.log('✅ Simulated update available:', mockUpdateInfo);
        if (mainWindow) {
          mainWindow.webContents.send('update-available', mockUpdateInfo);
        }
        
        resolve({ updateInfo: mockUpdateInfo });
      }, 2000); // 2 second delay to simulate network request
    });
  }
  
  // Production mode - use real auto-updater
  console.log('🏭 Production mode: Using real auto-updater');
  console.log('🔗 Feed URL configured for: AMoussa77/The-Egyptian-Exchange');
  
  // In production mode, always try GitHub API first for reliability
  console.log('🏭 Production mode: Using GitHub API for reliable update checking');
  return checkGitHubReleasesDirectly().then((result) => {
    console.log('✅ Production update check completed via GitHub API:', result);
    return result;
  }).catch((error) => {
    console.error('❌ Production GitHub API check failed:', error);
    console.error('❌ Error details:', error.message);
    
    // Send error to UI
    if (mainWindow) {
      mainWindow.webContents.send('update-error', error.message);
    }
    
    // Fallback to auto-updater if GitHub API fails
    console.log('🔄 Trying auto-updater as fallback for production mode');
    if (!autoUpdater || typeof autoUpdater.checkForUpdates !== 'function') {
      console.error('❌ Auto-updater not available, providing error response');
      return Promise.resolve({
        updateInfo: null,
        message: 'Update check failed: ' + error.message
      });
    }
    
    return autoUpdater.checkForUpdates().then((result) => {
      console.log('✅ Auto-updater fallback successful:', result);
      return result;
    }).catch((autoUpdaterError) => {
      console.error('❌ Auto-updater fallback also failed:', autoUpdaterError);
      return Promise.resolve({
        updateInfo: null,
        message: 'Update check failed: ' + error.message
      });
    });
  });
}

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', async () => {
  console.log('Manual check for updates triggered');
  return checkForUpdatesManual();
});

ipcMain.handle('download-update', async () => {
  console.log('Download update triggered');
  log.info('Download update triggered');
  
  if (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true') {
    // Production mode - try auto-updater with timeout
    console.log('🏭 Production mode: Starting download via auto-updater');
    log.info('Production mode: Starting download via auto-updater');
    
    try {
      // Check if auto-updater is available
      if (!autoUpdater || typeof autoUpdater.downloadUpdate !== 'function') {
        const error = new Error('Auto-updater not available');
        log.error('Auto-updater not available:', error);
        throw error;
      }
      
      // Log current configuration
      log.info('Auto-updater configuration:', {
        feedURL: 'https://github.com/AMoussa77/The-Egyptian-Exchange/releases',
        currentVersion: app.getVersion(),
        isPackaged: app.isPackaged
      });
      
      // Add timeout to prevent hanging
      const downloadPromise = autoUpdater.downloadUpdate();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Download timeout after 60 seconds')), 60000)
      );
      
      await Promise.race([downloadPromise, timeoutPromise]);
      console.log('✅ Download completed via auto-updater');
      log.info('Download completed via auto-updater');
      
    } catch (error) {
      console.error('❌ Auto-updater download failed:', error);
      log.error('Auto-updater download failed:', error);
      
      // Check for specific error types
      if (error.message.includes('404')) {
        log.error('404 error detected - likely file naming issue');
        console.error('🚨 404 error - check file naming in GitHub release');
      } else if (error.message.includes('blockmap')) {
        log.error('Blockmap error detected - file mismatch');
        console.error('🚨 Blockmap error - .exe and .exe.blockmap names don\'t match');
      }
      
      // Send error to UI
      if (mainWindow) {
        mainWindow.webContents.send('update-error', 'Download failed: ' + error.message);
      }
      
      throw error;
    }
  } else {
    // Development mode - simulate download
    console.log('🧪 Development mode: Simulating download');
    return new Promise((resolve) => {
      // Simulate download progress
      let progress = 0;
      const interval = setInterval(() => {
        progress += 10;
        if (mainWindow) {
          mainWindow.webContents.send('update-download-progress', {
            percent: progress,
            bytesPerSecond: 1000000,
            transferred: progress * 1000000,
            total: 10000000
          });
        }
        
        if (progress >= 100) {
          clearInterval(interval);
          console.log('✅ Simulated download completed');
          const mockInfo = { version: '0.6.2' }; // Updated to 0.6.2
          if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', mockInfo);
          }
          resolve();
        }
      }, 200); // Update every 200ms for smooth progress
    });
  }
});

ipcMain.handle('install-update', () => {
  console.log('Install update triggered');
  if (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true') {
    autoUpdater.quitAndInstall();
  } else {
    console.log('🧪 Development mode: Simulating install');
    if (mainWindow) {
      mainWindow.webContents.send('update-installed');
    }
  }
});

ipcMain.handle('get-settings', () => {
  return settings;
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
