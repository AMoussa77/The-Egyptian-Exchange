const { app, BrowserWindow, ipcMain } = require('electron');
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
// Enable auto-updater in production (packaged) mode or when forced
if (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true') {
  autoUpdater.autoDownload = false; // Manual download control
  autoUpdater.autoInstallOnAppQuit = true;
  
  console.log('🚀 Auto-updater enabled');
  console.log('📦 App is packaged:', app.isPackaged);
  console.log('🔧 Environment:', process.env.ENABLE_AUTO_UPDATER);
  console.log('📋 Current version:', app.getVersion());
  
  // Force enable auto-updater for testing
  if (process.env.ENABLE_AUTO_UPDATER === 'true') {
    console.log('🧪 Testing mode: Forcing auto-updater to work');
    // Set the feed URL to force update checking
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'AMoussa77',
      repo: 'The-Egyptian-Exchange'
    });
  }
} else {
  console.log('🧪 Development mode: Auto-updater disabled for automatic checks');
  console.log('💡 Manual update checks will work with simulated updates');
  console.log('💡 To enable real auto-updater, set ENABLE_AUTO_UPDATER=true');
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
    autoHideMenuBar: true // Hide the menu bar
  };
  
  // Add position if saved
  if (settings.windowBounds.x !== undefined && settings.windowBounds.y !== undefined) {
    windowOptions.x = settings.windowBounds.x;
    windowOptions.y = settings.windowBounds.y;
  }
  
  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Initialize web scraper after window is ready
  mainWindow.webContents.once('dom-ready', async () => {
    await initializeWebScraper();
    
    // Send a signal to the UI that data is ready
    mainWindow.webContents.send('data-ready');
  });
  
  // Save window bounds when window is moved or resized
  mainWindow.on('moved', () => {
    const bounds = mainWindow.getBounds();
    settings.windowBounds.x = bounds.x;
    settings.windowBounds.y = bounds.y;
    saveSettings();
  });
  
  mainWindow.on('resized', () => {
    const bounds = mainWindow.getBounds();
    settings.windowBounds.width = bounds.width;
    settings.windowBounds.height = bounds.height;
    saveSettings();
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
    
    // Send initial data to renderer
    if (mainWindow) {
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
  if (mainWindow) {
    mainWindow.webContents.send('update-checking');
  }
});

autoUpdater.on('update-available', (info) => {
  console.log('✅ Update available!');
  console.log('📋 Version:', info.version);
  console.log('📝 Release notes:', info.releaseNotes);
  console.log('📦 Release date:', info.releaseDate);
  if (mainWindow) {
    mainWindow.webContents.send('update-available', info);
  }
});

autoUpdater.on('update-not-available', (info) => {
  console.log('ℹ️ No updates available');
  console.log('📋 Info:', info);
  if (mainWindow) {
    mainWindow.webContents.send('update-not-available', info);
  }
});

autoUpdater.on('error', (err) => {
  console.error('Error in auto-updater:', err);
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

// Function to check for updates (always works for manual checks)
function checkForUpdatesManual() {
  if (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true') {
    console.log('🔍 Manual update check triggered');
    return autoUpdater.checkForUpdates();
  } else {
    console.log('🧪 Development mode: Simulating update check');
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('🔍 Simulated update check completed');
        // Simulate finding an update
        const mockUpdateInfo = {
          version: '0.6.1',
          releaseNotes: 'Test update for development - Egyptian Exchange Stocks',
          releaseDate: new Date().toISOString()
        };
        
        console.log('✅ Simulated update available:', mockUpdateInfo);
        if (mainWindow) {
          mainWindow.webContents.send('update-available', mockUpdateInfo);
        }
        
        resolve({ updateInfo: mockUpdateInfo });
      }, 2000);
    });
  }
}

// Auto-updater IPC handlers
ipcMain.handle('check-for-updates', () => {
  console.log('Manual check for updates triggered');
  return checkForUpdatesManual();
});

ipcMain.handle('download-update', () => {
  console.log('Download update triggered');
  if (app.isPackaged || process.env.ENABLE_AUTO_UPDATER === 'true') {
    return autoUpdater.downloadUpdate();
  } else {
    console.log('🧪 Development mode: Simulating download');
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('✅ Simulated download completed');
        const mockInfo = { version: '0.6.1' };
        if (mainWindow) {
          mainWindow.webContents.send('update-downloaded', mockInfo);
        }
        resolve();
      }, 3000);
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
