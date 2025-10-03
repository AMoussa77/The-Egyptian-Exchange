const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { URL } = require('url');

// Load environment variables from .env file if it exists
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        if (!process.env[key.trim()]) {
          process.env[key.trim()] = value;
        }
      }
    });
    console.log('✅ Loaded environment variables from .env file');
  }
} catch (error) {
  console.log('⚠️ Could not load .env file:', error.message);
}

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
    load: (html) => ({
      find: () => ({ 
        each: () => {},
        first: () => ({ text: () => '' }),
        text: () => ''
      }),
      text: () => '',
      each: () => {}
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
let widgetWindow = null;
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
    updateInterval: 30,
    daysOff: {
        sunday: false,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: true,
        saturday: true
    },
    widgetWindow: {
        enabled: false,
        alwaysOnTop: false,
        transparent: true,
        opacity: 0.9
    }
};

// Settings file path - will be set when app is ready
let settingsPath;

// Load settings from file
function loadSettings() {
  try {
    if (settingsPath && fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const loadedSettings = JSON.parse(data);
      console.log('🔧 Loaded settings from file:', JSON.stringify(loadedSettings, null, 2));
      
      // Merge with defaults to ensure all properties exist
      settings = { ...settings, ...loadedSettings };
      
      // Ensure widgetWindow settings are properly merged
      if (loadedSettings.widgetWindow) {
        settings.widgetWindow = { ...settings.widgetWindow, ...loadedSettings.widgetWindow };
      }
      
      console.log('🔧 Final merged settings:', JSON.stringify(settings, null, 2));
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
      
      console.log('🔧 Saving settings to file:', JSON.stringify(settings, null, 2));
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

// GitHub token for authenticated requests (higher rate limits)
// You can set this as an environment variable: GITHUB_TOKEN=your_token_here
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;

// Simple cache to avoid too many requests
let lastUpdateCheck = 0;
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes

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
if (GITHUB_TOKEN) {
  console.log('🔐 GitHub token: Available (authenticated requests enabled)');
} else {
  console.log('⚠️ GitHub token: Not found (using unauthenticated requests - lower rate limit)');
  console.log('💡 Run "node setup-github-token.js" for setup instructions');
}

// Check for updates on app start if auto-update is enabled
setTimeout(() => {
  if (settings.autoUpdate) {
    console.log('🔍 Checking for updates on startup...');
    checkForUpdates().catch(error => {
      console.log('⚠️ Startup update check failed:', error.message);
      // Don't show error to user on startup, just log it
    });
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
  
  // Apply settings to the widget window
  if (settings.widgetWindow) {
    if (settings.widgetWindow.opacity) {
      widgetWindow.setOpacity(settings.widgetWindow.opacity);
    }
    if (settings.widgetWindow.alwaysOnTop !== undefined) {
      widgetWindow.setAlwaysOnTop(settings.widgetWindow.alwaysOnTop);
    }
    if (settings.widgetWindow.transparent) {
      widgetWindow.setBackgroundColor('#00000000');
    } else {
      widgetWindow.setBackgroundColor('#1a1a2e');
    }
    console.log('🔧 Widget created with settings:', {
      alwaysOnTop: settings.widgetWindow.alwaysOnTop,
      opacity: settings.widgetWindow.opacity,
      transparent: settings.widgetWindow.transparent
    });
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
        console.log('🔄 Quit requested from tray');
        // Force quit even if closeToTray is enabled
        app.isQuiting = true;
        
        // Stop all processes
        if (scraper) {
          scraper.stopAutoUpdate();
        }
        stopMarketTimeChecking();
        
        // Close all windows safely
        if (widgetWindow && !widgetWindow.isDestroyed()) {
          widgetWindow.destroy();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.destroy();
        }
        
        // Force quit after a short delay to ensure cleanup
        setTimeout(() => {
          app.exit(0);
        }, 100);
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stock-data-updated', stockData);
    }
    
    // Send watchlist updates to widget if enabled
    if (widgetWindow && !widgetWindow.isDestroyed() && settings.widgetWindow.enabled) {
      // Get watchlist from main window's localStorage
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript(`
            const watchlist = localStorage.getItem('egyptianStocksWatchlist');
            return watchlist ? JSON.parse(watchlist) : [];
          `).then(watchlistData => {
            if (widgetWindow && !widgetWindow.isDestroyed()) {
            widgetWindow.webContents.send('watchlist-updated', watchlistData);
            }
          }).catch(error => {
            console.error('Error getting watchlist data:', error);
          });
        }
      } catch (error) {
        console.error('Error sending watchlist to widget:', error);
      }
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stock-data-updated', stockData);
      }
      
      // Send watchlist updates to widget if enabled
      if (widgetWindow && !widgetWindow.isDestroyed() && settings.widgetWindow.enabled) {
        try {
          // Get watchlist data from main window's localStorage
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.executeJavaScript(`
              const watchlist = localStorage.getItem('egyptianStocksWatchlist');
              return watchlist ? JSON.parse(watchlist) : [];
            `).then(watchlistData => {
              if (widgetWindow && !widgetWindow.isDestroyed()) {
              widgetWindow.webContents.send('watchlist-updated', watchlistData);
              }
            }).catch(error => {
              console.error('Error getting watchlist data:', error);
            });
          }
        } catch (error) {
          console.error('Error sending watchlist to widget:', error);
        }
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
async function checkForUpdates(forceCheck = false) {
  const now = Date.now();
  
  // Check cache unless forced
  if (!forceCheck && (now - lastUpdateCheck) < UPDATE_CHECK_INTERVAL) {
    console.log('⏭️ Skipping update check - too soon since last check');
    return { updateInfo: null, message: 'Update check skipped - too soon since last check' };
  }
  
  console.log('🔍 Checking for updates...');
  lastUpdateCheck = now;
  
  return new Promise((resolve, reject) => {
    const url = new URL(GITHUB_API_URL);
    // Prepare headers with optional authentication
    const headers = {
      'User-Agent': 'Egyptian-Exchange-Stocks-App/1.0',
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    
    // Add authentication header if token is available
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `token ${GITHUB_TOKEN}`;
      console.log('🔐 Using GitHub token for authenticated request');
    } else {
      console.log('⚠️ No GitHub token found - using unauthenticated request (lower rate limit)');
    }
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'GET',
      headers: headers
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      // Check for HTTP error status codes
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error(`❌ HTTP error ${res.statusCode}: ${res.statusMessage}`);
        
        // Handle specific error cases
        if (res.statusCode === 401) {
          reject(new Error('GitHub authentication failed. Please check your token.'));
        } else if (res.statusCode === 403) {
          reject(new Error('GitHub API access denied. Rate limit exceeded or token invalid.'));
        } else if (res.statusCode === 404) {
          reject(new Error('Repository or release not found.'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
        return;
      }
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Check for rate limiting or other API errors
          if (res.statusCode === 403) {
            const errorData = JSON.parse(data);
            if (errorData.message && errorData.message.includes('rate limit')) {
              console.log('⚠️ GitHub API rate limit exceeded');
              if (mainWindow) {
                mainWindow.webContents.send('update-error', 'Update check temporarily unavailable due to rate limiting. Please try again later.');
              }
              resolve({ updateInfo: null, message: 'Rate limit exceeded. Please try again later.' });
              return;
            }
          }
          
          const release = JSON.parse(data);
          const currentVersion = app.getVersion();
          
          // Validate the release object and tag_name
          if (!release || typeof release !== 'object') {
            throw new Error('Invalid release data received from GitHub API');
          }
          
          if (!release.tag_name || typeof release.tag_name !== 'string') {
            console.log('⚠️ No valid tag_name found in release data');
            if (mainWindow) {
              mainWindow.webContents.send('update-error', 'No release information available');
            }
            resolve({ updateInfo: null, message: 'No release information available' });
            return;
          }
          
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
          console.error('❌ Raw response data:', data);
          const errorMessage = 'Failed to parse update information: ' + parseError.message;
          if (mainWindow) {
            mainWindow.webContents.send('update-error', errorMessage);
          }
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
    const result = await checkForUpdates(true); // Force check for manual requests
    console.log('✅ Manual update check completed:', result);
    return result;
  } catch (error) {
    console.error('❌ Manual update check failed:', error);
    const errorMessage = error.message || 'Unknown error occurred';
    if (mainWindow) {
      mainWindow.webContents.send('update-error', errorMessage);
    }
    return { 
      updateInfo: null, 
      message: 'Update check failed: ' + errorMessage,
      error: errorMessage
    };
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

// Exchange News Scraper for Mubasher.info
async function scrapeExchangeNews() {
  try {
    console.log('📰 Scraping exchange news from Mubasher.info...');
    
    // Check if cheerio is properly loaded
    if (!cheerio || typeof cheerio.load !== 'function') {
      console.warn('⚠️ Cheerio not available, returning fallback data');
      return getFallbackExchangeNews();
    }
    
    const response = await axios.get('https://www.mubasher.info/news/eg/now/announcements', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.7,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000
    });

    if (!response.data) {
      console.warn('⚠️ No response data received');
      return getFallbackExchangeNews();
    }

    console.log(`📄 Received HTML content: ${response.data.length} characters`);
    
    // Log a sample of the HTML to understand its structure
    const htmlSample = response.data.substring(0, 500);
    console.log('📄 HTML Sample:', htmlSample.replace(/\s+/g, ' ').trim());

    let $;
    try {
      $ = cheerio.load(response.data);
      
      // Test if Cheerio is working by trying a simple operation
      if (typeof $ !== 'function') {
        throw new Error('Cheerio load did not return a function');
      }
      
      // Test with a simple selector to ensure it's working
      const testResult = $('body');
      if (!testResult || typeof testResult.length === 'undefined') {
        throw new Error('Cheerio selectors not working properly');
      }
      
      console.log('✅ Cheerio loaded and working properly');
    } catch (cheerioError) {
      console.warn('⚠️ Cheerio load failed:', cheerioError.message);
      console.log('📰 Falling back to regex parsing...');
      const regexAnnouncements = parseAnnouncementsWithRegex(response.data);
      if (regexAnnouncements.length > 0) {
        return regexAnnouncements;
      }
      return getFallbackExchangeNews();
    }
    
    const announcements = [];

    // Parse the announcements from the page (using Mubasher.info specific selectors)
    $('.mi-announcement, .news-item, .announcement-item, article, .news-article').each((index, element) => {
      try {
        const $item = $(element);
        
        // Extract title
        let title = $item.find('h1, h2, h3, h4, .title, .headline').first().text().trim();
        if (!title) {
          title = $item.find('a').first().text().trim();
        }
        
        // Extract content/description
        let content = $item.find('p, .description, .summary, .content').first().text().trim();
        if (!content) {
          content = $item.text().trim().substring(0, 200);
        }
        
        // Extract date with Mubasher.info specific selectors
        let dateText = $item.find('.mi-announcement__date, .date, .time, time, .meta-date, .post-date').text().trim();
        let date = new Date();
        
        console.log('🔍 Found date text in Cheerio:', dateText);
        
        // If we found date text that matches our expected format, parse it
        if (dateText && !dateText.includes('مضت') && !dateText.includes('دقائق')) {
          // This is likely the actual date format like "1 أكتوبر 03:28 م"
          const extractedDate = extractDateFromText(dateText);
          if (extractedDate) {
            date = extractedDate;
            console.log('✅ Parsed date from Cheerio date element:', date);
          }
        } else {
          // Try to extract date from the full item text as fallback
          const fullItemText = $item.text();
          const extractedDate = extractDateFromText(fullItemText);
          if (extractedDate) {
            date = extractedDate;
            console.log('✅ Parsed date from full Cheerio item text:', date);
          } else {
            console.log('❌ No date found in Cheerio item, using current date');
          }
        }
        
        // Extract company code if available
        let company = '';
        const companyMatch = title.match(/\(([A-Z]+\.CA)\)/);
        if (companyMatch) {
          company = companyMatch[1];
        }
        
        if (title && title.length > 10) {
          announcements.push({
            id: `egx-${Date.now()}-${index}`,
            title: title,
            content: content || title,
            company: company || 'EGX',
            date: date.toISOString(),
            source: 'البورصة المصرية',
            category: company ? 'announcement' : 'official',
            isNew: true,
            url: 'https://www.mubasher.info/news/eg/now/announcements'
          });
        }
      } catch (itemError) {
        console.warn('Error parsing news item:', itemError);
      }
    });

    // If no announcements found with Cheerio, try regex parsing
    if (announcements.length === 0) {
      console.log('📰 No announcements found with selectors, trying regex parsing...');
      const regexAnnouncements = parseAnnouncementsWithRegex(response.data);
      announcements.push(...regexAnnouncements);
    }
    
    // If still no announcements, try alternative selectors
    if (announcements.length === 0) {
      $('div, article, section').each((index, element) => {
        const $item = $(element);
        const text = $item.text().trim();
        
        // Look for Egyptian Exchange patterns
        if (text.includes('البورصة المصرية') || text.includes('قرار لجنة القيد') || text.includes('.CA')) {
          const title = text.substring(0, 100).trim();
          if (title.length > 20) {
            announcements.push({
              id: `egx-fallback-${Date.now()}-${index}`,
              title: title,
              content: text.substring(0, 300).trim(),
              company: 'EGX',
              date: new Date().toISOString(),
              source: 'البورصة المصرية',
              category: 'announcement',
              isNew: true,
              url: 'https://www.mubasher.info/news/eg/now/announcements'
            });
          }
        }
      });
    }

    console.log(`📰 Scraped ${announcements.length} exchange announcements`);
    return announcements.slice(0, 25); // Limit to 25 most recent
    
  } catch (error) {
    console.error('❌ Error scraping exchange news:', error);
    return getFallbackExchangeNews();
  }
}

// Parse announcements using regex (fallback when Cheerio fails)
function parseAnnouncementsWithRegex(html) {
  try {
    console.log('📰 Parsing announcements with regex...');
    const announcements = [];
    
    // Remove HTML tags and decode entities for better text extraction
    const cleanHtml = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
      .replace(/&amp;/g, '&') // Decode ampersands
      .replace(/&lt;/g, '<') // Decode less than
      .replace(/&gt;/g, '>'); // Decode greater than
    
    // Enhanced patterns for Egyptian Exchange announcements
    const patterns = [
      // Pattern 1: Mubasher.info announcement structure with date
      /<span class="mi-announcement__date"[^>]*>([^<]*(?:\d{1,2}\s*أكتوبر\s*\d{1,2}:\d{2}\s*[صم])[^<]*)<\/span>[^<]*<[^>]*>([^<]*\([A-Z]+\.CA\)[^<]*)/gi,
      // Pattern 2: Company announcements with detailed structure
      /العنوان\s*:\s*([^<>]*\([A-Z]+\.CA\)[^<>]*قرار[^<>]*)/gi,
      // Pattern 3: Direct company announcements
      /([^<>]*\([A-Z]+\.CA\)[^<>]*قرار لجنة القيد[^<>]*)/gi,
      // Pattern 4: General Egyptian Exchange announcements
      /([^<>]*البورصة المصرية[^<>]*)/gi,
      // Pattern 5: Company codes with context
      /([^<>]{20,}?\([A-Z]{3,5}\.CA\)[^<>]{10,}?)/gi,
      // Pattern 6: Date-based announcements
      /(أكتوبر[^<>]*\([A-Z]+\.CA\)[^<>]*)/gi
    ];
    
    // Pattern to extract dates from Arabic text (matching Mubasher.info format)
    const datePatterns = [
      // Mubasher.info format: "1 أكتوبر 03:28 م" (day month time)
      /(\d{1,2})\s*(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s*(\d{1,2}):(\d{2})\s*(ص|م)/gi,
      // Arabic months with day and year
      /(\d{1,2})\s*(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)\s*(\d{4})/gi,
      // Date in format DD/MM/YYYY or DD-MM-YYYY
      /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g,
      // ISO date format
      /(\d{4})-(\d{1,2})-(\d{1,2})/g
    ];
    
    // Function to extract date from text (using working logic from test)
    function extractDateFromText(text) {
      const arabicMonths = {
        'يناير': 0, 'فبراير': 1, 'مارس': 2, 'أبريل': 3, 'مايو': 4, 'يونيو': 5,
        'يوليو': 6, 'أغسطس': 7, 'سبتمبر': 8, 'أكتوبر': 9, 'نوفمبر': 10, 'ديسمبر': 11
      };
      
      console.log('🔍 Extracting date from text:', text.substring(0, 200));
      
      for (const pattern of datePatterns) {
        // Create a new RegExp to use exec() for capture groups
        const regex = new RegExp(pattern.source, pattern.flags);
        const match = regex.exec(text);
        if (match) {
          console.log('📅 Found date match:', match);
          
          if (pattern.source.includes('ص|م')) {
            // Mubasher.info format: "1 أكتوبر 03:28 م"
            console.log('📅 Match groups:', match);
            const day = parseInt(match[1]);
            const month = arabicMonths[match[2]];
            const hour = parseInt(match[3]);
            const minute = parseInt(match[4]);
            const isPM = match[5] === 'م';
            
            console.log('📅 Parsed values:', { day, month, hour, minute, isPM });
            
            if (month !== undefined && day >= 1 && day <= 31) {
              // Use 2024 as the year since the news is from 2024
              const currentYear = 2024;
              let adjustedHour = hour;
              
              // Convert 12-hour to 24-hour format
              if (isPM && hour !== 12) {
                adjustedHour = hour + 12;
              } else if (!isPM && hour === 12) {
                adjustedHour = 0;
              }
              
              const date = new Date(currentYear, month, day, adjustedHour, minute);
              console.log('✅ Parsed Mubasher date:', date);
              return date;
            }
          } else if (pattern.source.includes('يناير|فبراير') && match[3] && match[3].length === 4) {
            // Arabic date format with year
            const day = parseInt(match[1]);
            const month = arabicMonths[match[2]];
            const year = parseInt(match[3]);
            if (month !== undefined && day >= 1 && day <= 31 && year >= 2020) {
              const date = new Date(year, month, day);
              console.log('✅ Parsed Arabic date with year:', date);
              return date;
            }
          } else if (pattern.source.includes('[\/\\-]')) {
            // DD/MM/YYYY or DD-MM-YYYY format
            const day = parseInt(match[1]);
            const month = parseInt(match[2]) - 1; // JavaScript months are 0-based
            const year = parseInt(match[3]);
            if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 2020) {
              const date = new Date(year, month, day);
              console.log('✅ Parsed numeric date:', date);
              return date;
            }
          } else {
            // ISO format YYYY-MM-DD
            const year = parseInt(match[1]);
            const month = parseInt(match[2]) - 1;
            const day = parseInt(match[3]);
            if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 2020) {
              const date = new Date(year, month, day);
              console.log('✅ Parsed ISO date:', date);
              return date;
            }
          }
        }
      }
      console.log('❌ No date found in text');
      return null;
    }
    
    const foundTitles = new Set(); // Avoid duplicates
    
    // Extract news items with dates and URLs from the actual HTML structure
    // Updated pattern to handle both relative time ("5 دقائق مضت") and absolute time ("1 أكتوبر 03:28 م")
    const newsItemPattern = /<span class="mi-announcement__date"[^>]*data-publish-date="([^"]*)"[^>]*>([^<]*)<\/span>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*(?:العنوان\s*:\s*)?[^<]*(?:\([A-Z]+\.CA\))?[^<]*)<\/a>/gi;
    let newsItemMatch;
    
    console.log('🔍 Looking for news items with dates...');
    
    while ((newsItemMatch = newsItemPattern.exec(cleanHtml)) !== null) {
      const isoDateText = newsItemMatch[1].trim(); // ISO date from data-publish-date
      const displayDateText = newsItemMatch[2].trim(); // Display date text
      const urlPath = newsItemMatch[3].trim();
      const titleText = newsItemMatch[4].trim();
      
      console.log(`📰 Found news item: "${titleText}" with date: "${displayDateText}" (ISO: ${isoDateText}) and URL: "${urlPath}"`);
      
      if (titleText.length > 10 && titleText.length < 300 && !foundTitles.has(titleText)) {
        foundTitles.add(titleText);
        
        // Handle date based on display format
        let newsDate;
        let useDisplayDate = false;
        
        // Check if display date is relative time (keep it as-is)
        if (displayDateText.includes('دقائق مضت') || displayDateText.includes('ساعة مضت') || 
            displayDateText.includes('يوم مضى') || displayDateText.includes('أسبوع مضى')) {
          // For relative time, use current time but mark to preserve display format
          newsDate = new Date();
          useDisplayDate = true;
          console.log(`📅 Preserving relative time format: "${displayDateText}"`);
        } else {
          // For absolute dates, use ISO date with timezone conversion
          try {
            newsDate = new Date(isoDateText);
            // Validate the date
            if (isNaN(newsDate.getTime())) {
              throw new Error('Invalid date');
            }
            console.log(`📅 Using ISO date: ${isoDateText} -> ${newsDate}`);
          } catch (error) {
            console.log(`⚠️ Failed to parse ISO date "${isoDateText}", trying display date`);
            // Fallback to extracting from display text
            const extractedDate = extractDateFromText(displayDateText);
            newsDate = extractedDate || new Date();
          }
        }
        
        // Extract company code
        const companyMatch = titleText.match(/\(([A-Z]{3,5}\.CA)\)/);
        const company = companyMatch ? companyMatch[1] : 'EGX';
        
        // Determine category
        let category = 'announcement';
        if (titleText.includes('قرار لجنة القيد')) {
          category = 'official';
        } else if (company === 'EGX') {
          category = 'general';
        }
        
        // Build full URL
        const fullUrl = urlPath.startsWith('http') ? urlPath : `https://www.mubasher.info${urlPath}`;
        
        announcements.push({
          id: `egx-direct-${announcements.length}-${Date.now()}`,
          title: titleText.length > 100 ? titleText.substring(0, 100) + '...' : titleText,
          content: titleText,
          company: company,
          date: newsDate.toISOString(),
          displayDate: useDisplayDate ? displayDateText : null, // Preserve original relative time
          source: 'البورصة المصرية',
          category: category,
          isNew: true,
          url: fullUrl
        });
      }
    }
    
    console.log(`📰 Found ${announcements.length} news items with direct extraction`);
    
    // If we found news items with direct extraction, return them
    if (announcements.length > 0) {
      return announcements.slice(0, 25); // Increased limit to show more news
    }
    
    patterns.forEach((pattern, patternIndex) => {
      const matches = cleanHtml.match(pattern);
      if (matches) {
        matches.forEach((match, index) => {
          // Clean the text more thoroughly
          let cleanText = match
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/^\s*العنوان\s*:\s*/, '') // Remove "العنوان:" prefix
            .trim();
          
          // Validate the text
          if (cleanText.length > 30 && cleanText.length < 300 && !foundTitles.has(cleanText)) {
            foundTitles.add(cleanText);
            
            // Extract company code
            const companyMatch = cleanText.match(/\(([A-Z]{3,5}\.CA)\)/);
            const company = companyMatch ? companyMatch[1] : 'EGX';
            
            // Try to extract date from the text or surrounding context
            let extractedDate = extractDateFromText(cleanText);
            if (!extractedDate) {
              // Try to find date in a larger context around this match
              const matchIndex = cleanHtml.indexOf(match);
              const contextStart = Math.max(0, matchIndex - 200);
              const contextEnd = Math.min(cleanHtml.length, matchIndex + match.length + 200);
              const context = cleanHtml.substring(contextStart, contextEnd);
              extractedDate = extractDateFromText(context);
            }
            
            // Use extracted date or default to today
            const newsDate = extractedDate || new Date();
            
            // Determine category based on content
            let category = 'announcement';
            if (cleanText.includes('قرار لجنة القيد')) {
              category = 'official';
            } else if (company === 'EGX') {
              category = 'general';
            }
            
            announcements.push({
              id: `egx-regex-${patternIndex}-${index}-${Date.now()}`,
              title: cleanText.length > 100 ? cleanText.substring(0, 100) + '...' : cleanText,
              content: cleanText,
              company: company,
              date: newsDate.toISOString(),
              source: 'البورصة المصرية',
              category: category,
              isNew: true,
              url: 'https://www.mubasher.info/news/eg/now/announcements'
            });
          }
        });
      }
    });
    
    // Remove duplicates and sort by relevance
    const uniqueAnnouncements = announcements
      .filter((item, index, self) => 
        index === self.findIndex(t => t.title === item.title)
      )
      .sort((a, b) => {
        // Prioritize official announcements
        if (a.category === 'official' && b.category !== 'official') return -1;
        if (b.category === 'official' && a.category !== 'official') return 1;
        // Then by company announcements
        if (a.company !== 'EGX' && b.company === 'EGX') return -1;
        if (b.company !== 'EGX' && a.company === 'EGX') return 1;
        return 0;
      });
    
    console.log(`📰 Regex parsing found ${uniqueAnnouncements.length} unique announcements`);
    return uniqueAnnouncements.slice(0, 15); // Limit to 15 most relevant
    
  } catch (error) {
    console.error('❌ Error in regex parsing:', error);
    return [];
  }
}

// Fallback exchange news data
function getFallbackExchangeNews() {
  console.log('📰 Using fallback exchange news data');
  
  // Create dates for the past few days to simulate real news
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  
  return [
    {
      id: 'egx-fallback-001',
      title: 'إعلانات البورصة المصرية - تحديث مباشر',
      content: 'يتم تحديث الإعلانات من موقع مباشر.إنفو. في حالة عدم توفر الاتصال أو حدوث خطأ تقني، يتم عرض البيانات المحفوظة مسبقاً. يرجى المحاولة مرة أخرى لاحقاً للحصول على أحدث الإعلانات.',
      company: 'EGX',
      date: today.toISOString(),
      source: 'البورصة المصرية',
      category: 'official',
      isNew: true,
      url: 'https://www.mubasher.info/news/eg/now/announcements'
    },
    {
      id: 'egx-fallback-002',
      title: 'خدمة الإعلانات متاحة',
      content: 'سيتم استئناف خدمة جلب الإعلانات المباشرة من البورصة المصرية قريباً. يمكنك الضغط على زر التحديث لإعادة المحاولة.',
      company: 'EGX',
      date: yesterday.toISOString(),
      source: 'النظام',
      category: 'announcement',
      isNew: false,
      url: 'https://www.mubasher.info/news/eg/now/announcements'
    }
  ];
}

// IPC handler for exchange news
ipcMain.handle('fetch-exchange-news', async () => {
  try {
    const news = await scrapeExchangeNews();
    return { success: true, data: news };
  } catch (error) {
    console.error('Error fetching exchange news:', error);
    return { success: false, error: error.message, data: [] };
  }
});

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
  console.log('🔧 Updating settings with:', JSON.stringify(newSettings, null, 2));
  settings = { ...settings, ...newSettings };
  console.log('🔧 Updated settings:', JSON.stringify(settings, null, 2));
  
  // Save settings to file
  saveSettings();
  
  // If auto-update setting changed, check for updates if enabled
  if (newSettings.autoUpdate !== undefined) {
    checkForUpdatesIfEnabled();
  }
  
  // If market time settings or days off changed, restart market time checking and update scraper
  if (newSettings.marketOpenTime !== undefined || newSettings.marketCloseTime !== undefined || newSettings.daysOff !== undefined) {
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
  
  // If widget window settings changed, update widget
  if (newSettings.widgetWindow !== undefined) {
    // Update existing widget properties if widget exists
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setAlwaysOnTop(newSettings.widgetWindow.alwaysOnTop);
      widgetWindow.setOpacity(newSettings.widgetWindow.opacity);
      // Set transparent background if enabled
      if (newSettings.widgetWindow.transparent) {
        widgetWindow.setBackgroundColor('#00000000');
      } else {
        widgetWindow.setBackgroundColor('#1a1a2e');
      }
      console.log('🔧 Widget properties updated:', {
        alwaysOnTop: newSettings.widgetWindow.alwaysOnTop,
        opacity: newSettings.widgetWindow.opacity,
        transparent: newSettings.widgetWindow.transparent
      });
    }
    
    // Handle widget enable/disable
    if (newSettings.widgetWindow.enabled) {
      if (!widgetWindow) {
        createWidgetWindow();
        // Force show the widget after creation
        setTimeout(() => {
          if (widgetWindow) {
            widgetWindow.show();
            widgetWindow.focus();
            console.log('Widget window created and shown from settings');
          }
        }, 500);
      } else {
        widgetWindow.show();
        widgetWindow.focus();
      }
    } else {
      if (widgetWindow) {
        widgetWindow.close();
        widgetWindow = null;
      }
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
    try {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;
        const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        
        // Check if today is a day off
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const todayName = dayNames[currentDay];
        const isDayOff = settings.daysOff && settings.daysOff[todayName] || false;
        
        const openTime = (settings.marketOpenTime && settings.marketOpenTime.hour * 60 + settings.marketOpenTime.minute) || (10 * 60); // Default 10:00 AM
        const closeTime = (settings.marketCloseTime && settings.marketCloseTime.hour * 60 + settings.marketCloseTime.minute) || (14 * 60 + 30); // Default 2:30 PM
        
        let currentMarketState;
        if (isDayOff) {
            currentMarketState = 'closed'; // Market is closed on days off
        } else if (currentTime >= openTime && currentTime < closeTime) {
            currentMarketState = 'open';
        } else {
            currentMarketState = 'closed';
        }
        
        console.log(`📊 Market status check: ${currentMarketState} (Day: ${todayName}, Time: ${currentHour}:${currentMinute.toString().padStart(2, '0')}, DayOff: ${isDayOff})`);
        
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
                openTime: settings.marketOpenTime || { hour: 10, minute: 0 },
                closeTime: settings.marketCloseTime || { hour: 14, minute: 30 },
                isDayOff: isDayOff,
                currentDay: todayName,
                daysOff: settings.daysOff || { friday: true, saturday: true }
            });
        }
    } catch (error) {
        console.error('❌ Error checking market status:', error);
        // Send error status to renderer
        if (mainWindow) {
            mainWindow.webContents.send('market-status-updated', {
                status: 'closed',
                openTime: settings.marketOpenTime || { hour: 10, minute: 0 },
                closeTime: settings.marketCloseTime || { hour: 14, minute: 30 },
                isDayOff: false,
                currentDay: 'error',
                daysOff: settings.daysOff || { friday: true, saturday: true }
            });
        }
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
    
    // Send initial status to ensure UI is updated
    if (mainWindow) {
        console.log('📊 Sending initial market status to UI...');
        checkMarketStatus();
    }
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
  
  // Ensure market status is updated after window is ready
  setTimeout(() => {
    if (mainWindow) {
      console.log('📊 Ensuring market status is updated...');
      checkMarketStatus();
    }
  }, 1000);
  
  // Show widget if enabled in settings
  setTimeout(() => {
    if (settings.widgetWindow && settings.widgetWindow.enabled && mainWindow && !mainWindow.isDestroyed()) {
      console.log('📊 Widget enabled in settings, creating widget window...');
      createWidgetWindow();
    }
  }, 2000);
  
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
