const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const chokidar = require('chokidar');
const { exec } = require('child_process');

// Windows COM automation for Excel
let Excel;
try {
    Excel = require('node-ole');
} catch (error) {
    console.log('node-ole not available, COM automation disabled');
}

let mainWindow;
let stockData = [];
let watcher;
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

  // Watch for Excel file changes
  watchExcelFile();
  
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

function watchExcelFile() {
  const excelPath = path.join(__dirname, 'Stocks.xlsx');
  
  watcher = chokidar.watch(excelPath, {
    persistent: true,
    ignoreInitial: false
  });

  watcher.on('change', () => {
    console.log('Excel file changed, reloading data...');
    loadStockData();
  });

  watcher.on('add', () => {
    console.log('Excel file added, loading data...');
    loadStockData();
  });

  // Load initial data with query refresh
  loadStockDataWithRefresh();
}

async function refreshExcelQueries() {
  const excelPath = path.join(__dirname, 'Stocks.xlsx');
  
  // Try node-ole first
  if (Excel) {
    try {
      console.log('Refreshing Excel queries using node-ole...');
      
      // Create Excel application object using node-ole
      const excelApp = Excel.CreateObject('Excel.Application');
      excelApp.Visible = false; // Run in background
      excelApp.DisplayAlerts = false; // Suppress alerts
      
      // Open the workbook
      const workbook = excelApp.Workbooks.Open(excelPath);
      
      // Refresh all data connections
      workbook.RefreshAll();
      
      // Wait a moment for refresh to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Save the workbook
      workbook.Save();
      
      // Close workbook and Excel
      workbook.Close();
      excelApp.Quit();
      
      console.log('Excel queries refreshed successfully using node-ole');
      return true;
    } catch (error) {
      console.error('Error with node-ole:', error);
    }
  }
  
  // Fallback to PowerShell COM automation
  try {
    console.log('Refreshing Excel queries using PowerShell...');
    
    const psScript = `
      $excel = New-Object -ComObject Excel.Application
      $excel.Visible = $false
      $excel.DisplayAlerts = $false
      $workbook = $excel.Workbooks.Open("${excelPath.replace(/\\/g, '\\\\')}")
      $workbook.RefreshAll()
      Start-Sleep -Seconds 2
      $workbook.Save()
      $workbook.Close()
      $excel.Quit()
      [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
    `;
    
    await new Promise((resolve, reject) => {
      exec(`powershell -Command "${psScript}"`, (error, stdout, stderr) => {
        if (error) {
          console.error('PowerShell error:', error);
          reject(error);
        } else {
          console.log('Excel queries refreshed successfully using PowerShell');
          resolve();
        }
      });
    });
    
    return true;
  } catch (error) {
    console.error('Error refreshing Excel queries:', error);
    return false;
  }
}

function loadStockData() {
  try {
    const excelPath = path.join(__dirname, 'Stocks.xlsx');
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0]; // Use first sheet
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    if (jsonData.length > 1) {
      const headers = jsonData[0];
      const dataRows = jsonData.slice(1);
      
      stockData = dataRows.map(row => {
        const stock = {};
        headers.forEach((header, index) => {
          stock[header] = row[index] || '';
        });
        return stock;
      }).filter(stock => stock[headers[0]]); // Filter out empty rows
      
      console.log(`Loaded ${stockData.length} stocks`);
      
      // Send updated data to renderer
      if (mainWindow) {
        mainWindow.webContents.send('stock-data-updated', stockData);
      }
    }
  } catch (error) {
    console.error('Error loading Excel file:', error);
    if (mainWindow) {
      mainWindow.webContents.send('stock-data-error', error.message);
    }
  }
}

async function loadStockDataWithRefresh() {
  try {
    // First refresh Excel queries
    const refreshSuccess = await refreshExcelQueries();
    if (refreshSuccess) {
      console.log('Excel queries refreshed, loading updated data...');
    } else {
      console.log('Skipping query refresh, loading current data...');
    }
    
    // Then load the data
    loadStockData();
  } catch (error) {
    console.error('Error in loadStockDataWithRefresh:', error);
    // Fallback to regular load
    loadStockData();
  }
}

// IPC handlers
ipcMain.handle('get-stock-data', () => {
  return stockData;
});

ipcMain.handle('refresh-data', () => {
  loadStockData();
  return stockData;
});

ipcMain.handle('refresh-queries-and-data', async () => {
  await loadStockDataWithRefresh();
  return stockData;
});

ipcMain.handle('refresh-queries-only', async () => {
  const success = await refreshExcelQueries();
  return { success, message: success ? 'Queries refreshed successfully' : 'Failed to refresh queries' };
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
          version: '1.0.1',
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
        const mockInfo = { version: '1.0.1' };
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
  if (watcher) {
    watcher.close();
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
  if (watcher) {
    watcher.close();
  }
});
