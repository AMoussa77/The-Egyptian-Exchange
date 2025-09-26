const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

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
let tray = null;
let stockData = [];
let scraper;
let settings = {
    autoUpdate: true,
    minimizeToTray: true,
    closeToTray: true,
    windowBounds: {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined
    },
    marketOpenTime: {
        hour: 10,
        minute: 0
    },
    marketCloseTime: {
        hour: 14,
        minute: 30
    },
    playNotification: true,
    notificationVolume: 0.7,
    updateInterval: 30
};

// Settings file path - will be set when app is ready
let settingsPath;

// Load settings from file
function loadSettings() {
  try {
    if (settingsPath && fs.existsSync(settingsPath)) {
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
    if (settingsPath) {
      // Ensure the directory exists
      const settingsDir = path.dirname(settingsPath);
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('Settings saved to file');
    }
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
  
  // Handle minimize to tray
  mainWindow.on('minimize', (event) => {
    if (settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  
  // Handle close to tray
  mainWindow.on('close', (event) => {
    if (settings.closeToTray && !app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

<<<<<<< Updated upstream
=======
// Create widget window
function createWidgetWindow() {
  console.log('🔧 Creating widget window...');
  
  // Don't create if main window is destroyed
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log('🔧 Cannot create widget - main window is destroyed');
    return;
  }
  
  if (widgetWindow) {
    console.log('🔧 Destroying existing widget window');
    widgetWindow.destroy();
    widgetWindow = null;
  }
  
  const windowOptions = {
    width: 400,
    height: 300,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      hardwareAcceleration: false
    },
    icon: path.join(__dirname, 'assets/icon.png'),
    title: 'Egyptian Exchange Widget',
    autoHideMenuBar: true,
    center: true,
    show: false,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    closable: false,
    x: 100,
    y: 100,
    backgroundColor: '#1a1a2e'
  };
  
  console.log('🔧 Window options:', windowOptions);
  
  try {
    widgetWindow = new BrowserWindow(windowOptions);
    console.log('✅ Widget window created successfully');
  } catch (error) {
    console.error('❌ Error creating widget window:', error);
    return;
  }
  
  // Create clean widget HTML content
  const widgetHTML = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Egyptian Exchange Widget</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                background: #1a1a2e;
                color: white;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 14px;
                height: 100vh;
                width: 100vw;
                margin: 0;
                padding: 0;
                cursor: move;
                -webkit-app-region: drag;
                overflow: hidden;
                border-radius: 8px;
                border: 1px solid rgba(74, 144, 226, 0.2);
                user-select: none;
                position: relative;
                box-sizing: border-box;
            }
            
            /* Make the entire body draggable */
            body * {
                -webkit-app-region: drag;
                        }
            
            .widget-header {
                background: linear-gradient(135deg, #4a90e2, #357abd);
                padding: 8px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                -webkit-app-region: drag;
                border-radius: 6px 6px 0 0;
                box-sizing: border-box;
            }
            
            .widget-title {
                font-weight: 600;
                font-size: 14px;
                color: white;
            }
            
                        .widget-controls {
                            display: flex;
                gap: 8px;
                            -webkit-app-region: no-drag;
                        }
            
            .btn {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 28px;
                height: 28px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 12px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                -webkit-app-region: no-drag;
            }
            
            .btn:hover {
                background: rgba(255, 255, 255, 0.3);
                transform: scale(1.05);
            }
            
            .widget-content {
                padding: 10px;
                height: calc(100vh - 50px);
                overflow-y: auto;
                -webkit-app-region: no-drag;
                cursor: default;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
            }
            
            .loading {
                text-align: center;
                color: #9ca3af;
                padding: 20px;
                font-size: 13px;
                display: flex;
                align-items: center;
                justify-content: center;
                height: 100%;
            }
            
            .empty {
                text-align: center;
                color: #9ca3af;
                padding: 30px 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100%;
            }
            
            .empty-icon {
                font-size: 32px;
                margin-bottom: 10px;
            }
            
            table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
                margin: 0 auto;
                max-width: 100%;
            }
            
            #content {
                text-align: center;
            }
            
            #content > * {
                margin: 0 auto;
            }
            
            th {
                background: rgba(255, 255, 255, 0.05);
                padding: 8px;
                text-align: center;
                color: #9ca3af;
                font-weight: 500;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            
            td {
                padding: 10px 8px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                color: white;
                text-align: center;
            }
            
            tr:hover {
                background: rgba(255, 255, 255, 0.03);
            }
            
            .price-positive {
                color: #10b981;
            }
            
            .price-negative {
                color: #ef4444;
            }
            
            /* Custom scrollbar */
            ::-webkit-scrollbar {
                width: 6px;
            }
            
            ::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
            }
            
            ::-webkit-scrollbar-thumb {
                background: linear-gradient(45deg, #4a90e2, #357abd);
                border-radius: 3px;
            }
            
            ::-webkit-scrollbar-thumb:hover {
                background: linear-gradient(45deg, #5ba0f2, #4a8acd);
            }
        </style>
    </head>
    <body>
            <div class="widget-header">
                <div class="widget-title">📈 Egyptian Exchange</div>
                        <div class="widget-controls">
                            <button class="btn" onclick="refresh()" title="Refresh">🔄</button>
                            <button class="btn" onclick="closeWidget()" title="Close">✕</button>
                        </div>
            </div>
            <div class="widget-content" id="content">
            <div class="loading">
                <div>🔄 Loading stock data...</div>
            </div>
        </div>
        
        <script>
            const { ipcRenderer } = require('electron');
            
            function refresh() {
                console.log('🔄 Refreshing widget watchlist data...');
                        const content = document.getElementById('content');
                
                // Keep old data visible while refreshing
                const currentContent = content.innerHTML;
                
                // Only show loading if there's no current data
                if (!currentContent || currentContent.includes('No data available') || currentContent.includes('Error loading')) {
                    content.innerHTML = '<div class="loading"><div>🔄 Loading...</div></div>';
                }
                
                // Request watchlist data from main window instead of live data
                ipcRenderer.invoke('request-watchlist-data').then(result => {
                    if (result && result.success) {
                        console.log('✅ Widget watchlist data refreshed');
                        // The data will be sent via IPC event, no need to update content here
                    } else {
                        // Only show no data message if we don't have any current data
                        if (!currentContent || currentContent.includes('No data available') || currentContent.includes('Error loading')) {
                            content.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div>No watchlist data available</div></div>';
                        }
                    }
                }).catch(error => {
                    console.error('❌ Error refreshing watchlist:', error);
                    // Only show error if we don't have any current data
                    if (!currentContent || currentContent.includes('No data available') || currentContent.includes('Error loading')) {
                        content.innerHTML = '<div class="empty"><div class="empty-icon">❌</div><div>Error loading watchlist data</div></div>';
                    }
                });
            }
            
            function closeWidget() {
                console.log('🔧 Close button clicked - closing widget...');
                    ipcRenderer.invoke('close-widget-window').then(result => {
                    console.log('🔧 Close result:', result);
                        if (result.success) {
                        console.log('🔧 Widget close successful');
                            window.close();
                    } else {
                        console.log('🔧 Widget close failed:', result.error);
                        }
                    }).catch(error => {
                    console.error('❌ Error closing widget:', error);
                        window.close();
                    });
            }
            
            // Load data on startup
            window.addEventListener('load', () => {
                setTimeout(refresh, 100);
            });
            
            // Listen for data updates
            ipcRenderer.on('update-widget-table', (event, tableHTML) => {
                const content = document.getElementById('content');
                if (tableHTML) {
                    content.innerHTML = tableHTML;
                } else {
                    content.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div>No data available</div></div>';
                }
            });
            
            // Auto-refresh every 30 seconds
            setInterval(refresh, 30000);
        </script>
    </body>
    </html>
  `;
  
  try {
    widgetWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(widgetHTML)}`);
    console.log('✅ Widget HTML loaded');
  } catch (error) {
    console.error('❌ Error loading widget HTML:', error);
  }
  
  // Apply opacity from settings
  if (settings.widgetWindow && settings.widgetWindow.opacity) {
    widgetWindow.setOpacity(settings.widgetWindow.opacity);
  }
  
  // Handle window events
  widgetWindow.on('closed', () => {
    console.log('🔧 Widget window closed');
    widgetWindow = null;
  });
  
  widgetWindow.once('ready-to-show', () => {
    console.log('✅ Widget window ready');
  widgetWindow.show();
  widgetWindow.focus();
  
    // Send data after widget is ready
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        if (typeof sendWatchlistToWidget === 'function') {
          sendWatchlistToWidget();
        }
      `).catch(error => {
          console.error('Error sending initial data:', error);
        });
      }
    }, 500);
  });
  
  console.log('✅ Widget window created successfully');
}

// Update tray menu
function updateTrayMenu() {
  if (tray) {
    createTray(); // Recreate tray with updated menu
  }
}

>>>>>>> Stashed changes
// Create system tray
function createTray() {
  if (tray) {
    tray.destroy();
  }
  
  // Create a simple tray icon (using a data URL for a basic icon)
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  
  try {
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      // Create a simple 16x16 icon if no icon file exists
      icon = nativeImage.createEmpty();
    }
  } catch (error) {
    console.error('Error creating tray icon:', error);
    icon = nativeImage.createEmpty();
  }
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Egyptian Exchange',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Refresh Data',
      click: () => {
        refreshStockData();
      }
    },
    { type: 'separator' },
    {
<<<<<<< Updated upstream
=======
      label: 'Toggle Widget',
      click: () => {
        if (widgetWindow) {
          if (widgetWindow.isVisible()) {
            widgetWindow.hide();
            settings.widgetWindow.enabled = false;
          } else {
            widgetWindow.show();
            widgetWindow.focus();
            settings.widgetWindow.enabled = true;
          }
        } else {
          createWidgetWindow();
          settings.widgetWindow.enabled = true;
          setTimeout(() => {
            if (widgetWindow) {
              widgetWindow.show();
              widgetWindow.focus();
            }
          }, 500);
        }
        // Update settings checkbox in main window
        if (mainWindow) {
          mainWindow.webContents.send('update-widget-checkbox', settings.widgetWindow.enabled);
        }
      }
    },
    {
>>>>>>> Stashed changes
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          // Send a message to open settings
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        // Force quit even if closeToTray is enabled
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Egyptian Exchange Stocks');
  tray.setContextMenu(contextMenu);
  
  // Handle tray click
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

async function initializeWebScraper() {
  console.log('🚀 Initializing Egyptian Exchange web scraper...');
  
  scraper = new EgyptianExchangeScraper();
  
  // Update scraper with current market settings
  scraper.updateMarketSettings(settings);
  
  // Load initial data first, then start auto-updating
  try {
    console.log('📊 Loading initial stock data...');
    stockData = await scraper.fetchStockData(true); // Force real data on startup
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
      const data = await scraper.fetchStockData(true); // Force real data on manual refresh
      
      // If data is null, scraping was skipped because another request is in progress
      if (data === null) {
        console.log('⏳ Refresh skipped - scraping already in progress');
        return false; // Return false to indicate no update occurred
      }
      
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
  const success = await refreshStockData();
  return { data: stockData, success: success };
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

<<<<<<< Updated upstream
=======
// Widget window IPC handlers
ipcMain.handle('toggle-widget-window', () => {
  try {
    if (widgetWindow) {
      if (widgetWindow.isVisible()) {
        widgetWindow.hide();
        console.log('Widget window hidden');
        return { success: true, visible: false };
      } else {
        widgetWindow.show();
        widgetWindow.focus();
        console.log('Widget window shown');
        return { success: true, visible: true };
      }
    } else {
      createWidgetWindow();
      // Force show the widget after creation
      setTimeout(() => {
        if (widgetWindow) {
          widgetWindow.show();
          widgetWindow.focus();
          console.log('Widget window created and shown');
        }
      }, 500);
      return { success: true, visible: true };
    }
  } catch (error) {
    console.error('Error toggling widget window:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('hide-widget-window', () => {
  try {
    console.log('🔧 Hide widget window requested');
    if (widgetWindow) {
      widgetWindow.hide();
      console.log('Widget window hidden');
      return { success: true, visible: false };
    }
    return { success: true, visible: false };
  } catch (error) {
    console.error('❌ Error hiding widget window:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('close-widget-window', () => {
  try {
    console.log('🔧 Close widget window requested');
    if (widgetWindow) {
      widgetWindow.hide();
      console.log('Widget window hidden');
    }
    
    // Update settings to disabled
    if (settings.widgetWindow) {
      settings.widgetWindow.enabled = false;
      saveSettings(settings);
      console.log('🔧 Widget setting disabled and saved');
    }
    
    // Update checkbox in main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-widget-checkbox', false);
      console.log('🔧 Widget checkbox updated in main window');
    }
    
    return { success: true, visible: false };
  } catch (error) {
    console.error('❌ Error hiding widget window:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-widget-window', () => {
  try {
    createWidgetWindow();
    return { success: true };
  } catch (error) {
    console.error('Error creating widget window:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-watchlist-data', async () => {
  try {
    console.log('🔧 Getting watchlist data...');
    
    // Return empty array for now - we'll use a different approach
    console.log('📊 Returning empty array - will use IPC events instead');
    return [];
  } catch (error) {
    console.error('❌ Error getting watchlist data:', error);
    return [];
  }
});

// New IPC handler for main window to send watchlist data to widget
ipcMain.handle('send-watchlist-to-widget', (event, watchlistData) => {
  try {
    console.log('🔧 Received watchlist data from main window:', watchlistData);
    console.log('🔧 Widget window exists:', !!widgetWindow);
    console.log('🔧 Widget window destroyed:', widgetWindow ? widgetWindow.isDestroyed() : 'N/A');
    
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      console.log('🔧 Sending data to widget...');
      widgetWindow.webContents.send('watchlist-updated', watchlistData);
      return { success: true };
    } else {
      console.log('⚠️ Widget window not available or destroyed');
      return { success: false, error: 'Widget window not available' };
    }
  } catch (error) {
    console.error('❌ Error sending watchlist to widget:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for widget to request watchlist data
ipcMain.handle('request-watchlist-data', async () => {
  try {
    console.log('🔧 Widget requesting watchlist data...');
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Get watchlist table HTML from main window
      const tableHTML = await mainWindow.webContents.executeJavaScript(`
        const table = document.querySelector('#watchlistTable');
        if (table) {
          return table.outerHTML;
        }
        return null;
      `);
      
      if (tableHTML && widgetWindow && !widgetWindow.isDestroyed()) {
        // Process the table HTML to remove action column
        const processedHTML = await mainWindow.webContents.executeJavaScript(`
          (function() {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = \`${tableHTML.replace(/`/g, '\\`')}\`;
            
            const tables = tempDiv.querySelectorAll('table');
            tables.forEach(table => {
              const headerRow = table.querySelector('thead tr');
              if (headerRow) {
                const headerCells = Array.from(headerRow.querySelectorAll('th'));
                headerCells.forEach((th, index) => {
                  const text = th.textContent.trim().toLowerCase();
                  if (text === 'action' || text.includes('action')) {
                    th.remove();
                    // Remove corresponding data cells
                    const dataRows = table.querySelectorAll('tbody tr');
                    dataRows.forEach(row => {
                      const cells = Array.from(row.querySelectorAll('td'));
                      if (cells[index]) {
                        cells[index].remove();
                      }
                    });
                  }
                });
              }
            });
            
            return tempDiv.innerHTML;
          })();
        `);
        
        // Send processed table HTML to widget
        widgetWindow.webContents.send('update-widget-table', processedHTML);
        return { success: true };
      }
    }
    
    return { success: false, error: 'No watchlist data available' };
  } catch (error) {
    console.error('❌ Error getting watchlist data:', error);
    return { success: false, error: error.message };
  }
});

// New IPC handler for main window to send table HTML to widget (with action column removed)
ipcMain.handle('send-table-to-widget', async (event, tableHTML) => {
  try {
    console.log('🔧 Received table HTML from main window');
    console.log('🔧 Widget window exists:', !!widgetWindow);
    console.log('🔧 Widget window destroyed:', widgetWindow ? widgetWindow.isDestroyed() : 'N/A');
    
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      console.log('🔧 Processing table HTML to remove action column...');
      
      // Remove action column from table HTML using main window's JavaScript execution
      let processedHTML = tableHTML;
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // Use main window to execute JavaScript that removes action column
          processedHTML = await mainWindow.webContents.executeJavaScript(`
            (function() {
              const tempDiv = document.createElement('div');
              tempDiv.innerHTML = \`${tableHTML.replace(/`/g, '\\`')}\`;
              
              const tables = tempDiv.querySelectorAll('table');
              tables.forEach(table => {
                const headerRow = table.querySelector('thead tr');
                if (headerRow) {
                  const headerCells = Array.from(headerRow.querySelectorAll('th'));
                  headerCells.forEach((th, index) => {
                    const text = th.textContent.trim().toLowerCase();
                    if (text === 'action' || text.includes('action')) {
                      th.remove();
                      // Remove corresponding data cells
                      const dataRows = table.querySelectorAll('tbody tr');
                      dataRows.forEach(row => {
                        const cells = Array.from(row.querySelectorAll('td'));
                        if (cells[index]) {
                          cells[index].remove();
                        }
                      });
                    }
                  });
                }
              });
              
              return tempDiv.innerHTML;
            })();
          `);
          console.log('✅ Action column removed from table HTML');
        } else {
          console.log('⚠️ Main window not available, sending original HTML');
        }
      } catch (parseError) {
        console.log('⚠️ Could not process table HTML, sending as-is:', parseError.message);
        // If processing fails, send the original HTML
        processedHTML = tableHTML;
      }
      
      console.log('🔧 Sending processed table HTML to widget...');
      widgetWindow.webContents.send('update-widget-table', processedHTML);
      return { success: true };
    } else {
      console.log('⚠️ Widget window not available or destroyed');
      return { success: false, error: 'Widget window not available' };
    }
  } catch (error) {
    console.error('❌ Error sending table to widget:', error);
    return { success: false, error: error.message };
  }
});

// Test IPC handler
ipcMain.handle('test-widget-communication', () => {
  try {
    console.log('🧪 Testing widget communication...');
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('test-message', { message: 'Hello from main process!', timestamp: Date.now() });
      console.log('🧪 Test message sent to widget');
      return { success: true };
    }
    return { success: false, error: 'Widget window not available' };
  } catch (error) {
    console.error('❌ Error testing widget communication:', error);
    return { success: false, error: error.message };
  }
});

// Create test widget handler
ipcMain.handle('create-test-widget', () => {
  try {
    console.log('🔧 Creating test widget...');
    createWidgetWindow();
    return { success: true };
  } catch (error) {
    console.error('❌ Error creating test widget:', error);
    return { success: false, error: error.message };
  }
});

// Refresh widget table handler - simplified approach
ipcMain.handle('refresh-widget-table', async () => {
  try {
    console.log('🔧 Refreshing widget table...');
    
    // Always create a simple table from stock data (no action column)
    console.log('🔧 Creating widget table from stock data (no action column)');
    if (stockData && stockData.length > 0) {
      let fallbackHTML = '<table style="width: 100%; border-collapse: collapse; font-size: 12px; color: white; direction: rtl;">' +
        '<thead>' +
          '<tr style="background: rgba(255, 255, 255, 0.05); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">' +
            '<th style="padding: 8px; text-align: right; color: #9ca3af; font-weight: 500;">اسم السهم</th>' +
            '<th style="padding: 8px; text-align: center; color: #9ca3af; font-weight: 500;">اخر سعر</th>' +
            '<th style="padding: 8px; text-align: center; color: #9ca3af; font-weight: 500;">التغير %</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>';
      
      stockData.slice(0, 10).forEach(stock => {
        const symbol = stock['الإسم_المختصر'] || stock['Short Name'] || 'Unknown';
        const price = stock['أخر_سعر'] || stock['Last Price'] || 'N/A';
        const change = stock['%التغيير'] || stock['Changes %'] || 0;
        
        let formattedPrice = price;
        if (price !== 'N/A' && !isNaN(parseFloat(price))) {
          formattedPrice = 'EGP ' + parseFloat(price).toFixed(2);
        }
        
        let changeText = change + '%';
        let changeColor = '#9ca3af';
        if (change > 0) {
          changeText = '+' + change + '%';
          changeColor = '#10b981';
        } else if (change < 0) {
          changeColor = '#ef4444';
        }
        
        fallbackHTML += '<tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background 0.2s;" onmouseover="this.style.background=\'rgba(255, 255, 255, 0.03)\'" onmouseout="this.style.background=\'transparent\'">' +
          '<td style="padding: 8px; text-align: right; color: #ffffff; font-weight: 600;">' + symbol + '</td>' +
          '<td style="padding: 8px; text-align: center; color: #ffffff; font-weight: 600;">' + formattedPrice + '</td>' +
          '<td style="padding: 8px; text-align: center; color: ' + changeColor + '; font-weight: 500;">' + changeText + '</td>' +
        '</tr>';
      });
      
      fallbackHTML += '</tbody></table>';
      
      console.log('📊 Created widget table with', stockData.length, 'stocks (no action column)');
      return fallbackHTML;
    }
    return null;
  } catch (error) {
    console.error('❌ Error refreshing widget table:', error);
    return null;
  }
});

ipcMain.handle('show-widget-window', () => {
  try {
    console.log('🔧 Show widget window requested');
    if (widgetWindow) {
      console.log('🔧 Showing existing widget window');
      widgetWindow.show();
      widgetWindow.focus();
      return { success: true };
    } else {
      console.log('🔧 Creating new widget window');
      createWidgetWindow();
      return { success: true };
    }
  } catch (error) {
    console.error('❌ Error showing widget window:', error);
    return { success: false, error: error.message };
  }
});


>>>>>>> Stashed changes
// Install update handler removed - users download manually from GitHub

    ipcMain.handle('get-settings', () => {
        return settings;
    });

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Handle open-settings event from tray
ipcMain.on('open-settings', () => {
  // This will be handled by the renderer process
});

ipcMain.handle('update-settings', (event, newSettings) => {
  settings = { ...settings, ...newSettings };
  
  // Save settings to file
  saveSettings();
  
  // If auto-update setting changed, check for updates if enabled
  if (newSettings.autoUpdate !== undefined) {
    checkForUpdatesIfEnabled();
  }
  
  // If market time settings changed, restart market time checking and update scraper
  if (newSettings.marketOpenTime !== undefined || newSettings.marketCloseTime !== undefined) {
    stopMarketTimeChecking();
    startMarketTimeChecking();
    
    // Update scraper with new market settings
    if (scraper) {
      scraper.updateMarketSettings(settings);
    }
  }
  
  // If update interval changed, update scraper interval
  if (newSettings.updateInterval !== undefined) {
    if (scraper) {
      scraper.setUpdateInterval(newSettings.updateInterval * 1000); // Convert seconds to milliseconds
      console.log(`⏰ Update interval changed to ${newSettings.updateInterval} seconds`);
    }
  }
  
  return settings;
});

// Handle test notification sound request (now handled directly in renderer)
ipcMain.handle('test-notification-sound', () => {
  console.log('Testing notification sound...');
  playNotificationSound();
  return { success: true, message: 'Test sound played' };
});

// Market time checking and notification functionality
let marketTimeInterval = null;
let lastMarketState = null; // 'open', 'closed', or null

function checkMarketStatus() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;
    
    const openTime = settings.marketOpenTime.hour * 60 + settings.marketOpenTime.minute;
    const closeTime = settings.marketCloseTime.hour * 60 + settings.marketCloseTime.minute;
    
    let currentMarketState;
    if (currentTime >= openTime && currentTime < closeTime) {
        currentMarketState = 'open';
    } else {
        currentMarketState = 'closed';
    }
    
    // Only notify if state changed and notifications are enabled
    if (lastMarketState !== null && lastMarketState !== currentMarketState && settings.playNotification) {
        const message = currentMarketState === 'open' ? 'Market Open' : 'Market Closed';
        console.log(`🔔 Market state changed! Sending notification: ${message}`);
        showNotification(message);
        playNotificationSound();
    }
    
    lastMarketState = currentMarketState;
    
    // Send market status to renderer
    if (mainWindow) {
        mainWindow.webContents.send('market-status-updated', {
            status: currentMarketState,
            openTime: settings.marketOpenTime,
            closeTime: settings.marketCloseTime
        });
    }
}

function showNotification(message) {
    // Show in-app notification
    if (mainWindow) {
        mainWindow.webContents.send('show-notification', message);
    }
    
    // Show OS-level notification
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: 'Egyptian Exchange Market',
            body: message,
            icon: path.join(__dirname, 'assets', 'icon.png'),
            sound: false // We handle sound separately
        });
        
        notification.show();
        
        // Auto-close after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);
    }
}

function playNotificationSound() {
  try {
    const soundPath = path.join(__dirname, 'assets', 'Bell Sound Effects.m4a');
    if (fs.existsSync(soundPath)) {
      console.log('Playing notification sound:', soundPath);
      // Use internal app audio - send to renderer process
      if (mainWindow) {
        mainWindow.webContents.send('play-audio', {
          filePath: soundPath,
          volume: settings.notificationVolume || 0.7
        });
      }
    } else {
      console.log('Notification sound file not found');
      // Fallback to beep sound
      if (mainWindow) {
        mainWindow.webContents.send('play-beep', {
          volume: settings.notificationVolume || 0.7
        });
      }
    }
  } catch (error) {
    console.log('Error playing notification sound:', error.message);
    // Fallback to beep sound
    if (mainWindow) {
      mainWindow.webContents.send('play-beep', {
        volume: settings.notificationVolume || 0.7
      });
    }
  }
}

function startMarketTimeChecking() {
    // Check immediately
    checkMarketStatus();
    
    // Then check every minute
    marketTimeInterval = setInterval(checkMarketStatus, 60000);
    console.log('Market time checking started');
}

function stopMarketTimeChecking() {
    if (marketTimeInterval) {
        clearInterval(marketTimeInterval);
        marketTimeInterval = null;
        console.log('Market time checking stopped');
    }
}

// Fix GPU issues
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');

// Single instance check
if (!gotTheLock) {
  console.log('🔒 Another instance is already running, quitting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window instead
    console.log('🔒 Second instance detected, focusing existing window...');
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Initialize settings path after app is ready
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  console.log('Settings path:', settingsPath);
  
  createWindow();
  createTray();
  
  // Start market time checking
  startMarketTimeChecking();
  
  // Check for updates after a short delay to allow window to load
  setTimeout(() => {
    checkForUpdatesIfEnabled();
  }, 2000);
});

app.on('window-all-closed', (event) => {
  if (scraper) {
    scraper.stopAutoUpdate();
  }
  
  // Don't quit the app if close to tray is enabled, unless explicitly quitting
  if (settings.closeToTray && !app.isQuiting) {
    event.preventDefault();
    return;
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
  stopMarketTimeChecking();
});
