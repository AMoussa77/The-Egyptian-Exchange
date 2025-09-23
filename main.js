const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      hardwareAcceleration: false // Disable hardware acceleration to fix GPU errors
    },
    icon: path.join(__dirname, 'assets/icon.png'), // Optional icon
    title: 'Egyptian Exchange Stocks'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Watch for Excel file changes
  watchExcelFile();
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

// Fix GPU issues
app.commandLine.appendSwitch('--disable-gpu');
app.commandLine.appendSwitch('--disable-gpu-sandbox');
app.commandLine.appendSwitch('--disable-software-rasterizer');

app.whenReady().then(createWindow);

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
