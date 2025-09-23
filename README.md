# Egyptian Exchange Stocks Desktop Application

A real-time desktop application for monitoring Egyptian Exchange stocks using Excel as a database.

## Features

- 📊 **Real-time Data**: Automatically monitors Excel file changes and updates the interface
- 🔄 **Excel Query Refresh**: Automatically refreshes Excel queries and data connections using COM automation
- 🔍 **Search & Filter**: Search through stocks by any field
- 📈 **Visual Indicators**: Color-coded price changes (green for positive, red for negative)
- 📱 **Responsive Design**: Works on different screen sizes
- 🔄 **Auto-refresh**: Updates every 30 seconds automatically with query refresh
- ⭐ **Watchlist**: Personal watchlist with persistent storage
- 📤 **Export**: Export filtered data to CSV
- 🎨 **Modern UI**: Beautiful, modern interface with smooth animations

## Column Mapping

- `أخر_سعر` = Last Price
- `%التغيير` = Changes %

## Installation

1. **Install Node.js** (if not already installed):
   - Download from [nodejs.org](https://nodejs.org/)
   - Install the LTS version

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run the Application**:
   ```bash
   npm start
   ```

## Excel Query Refresh (Windows Only)

The application includes automatic Excel query refresh using Windows COM automation:

- **Automatic**: Queries are refreshed automatically on startup and every 30 seconds
- **Manual**: Use the "🔄 Refresh" button to manually refresh queries and data
- **Requirements**: 
  - Windows operating system
  - Microsoft Excel installed
  - Excel file must have data connections/queries configured

### How It Works

1. **COM Automation**: Uses `winax` library to control Excel via COM
2. **Query Execution**: Calls `workbook.RefreshAll()` to refresh all data connections
3. **Data Update**: Saves the updated Excel file and reads the new data
4. **Fallback**: If COM automation fails, falls back to reading current Excel data

## Development Mode

To run in development mode with DevTools:
```bash
npm run dev
```

## Building for Distribution

To build the application for distribution:
```bash
npm run build
```

## File Structure

```
├── main.js          # Main Electron process
├── index.html       # User interface
├── package.json     # Dependencies and scripts
├── Stocks.xlsx      # Excel database file
└── README.md        # This file
```

## How It Works

1. **Excel Monitoring**: The application watches the `Stocks.xlsx` file for changes using `chokidar`
2. **Data Reading**: Uses `xlsx` library to read Excel data
3. **Real-time Updates**: Automatically refreshes when the Excel file is modified
4. **IPC Communication**: Main process communicates with renderer process for data updates

## Excel File Format

The application expects an Excel file (`Stocks.xlsx`) in the same directory with:
- First row as headers
- Data starting from the second row
- Arabic column names supported

## Customization

You can customize the application by modifying:
- `index.html`: UI layout and styling
- `main.js`: Data processing logic
- `package.json`: Dependencies and build configuration

## Troubleshooting

- **Excel file not found**: Ensure `Stocks.xlsx` is in the same directory as the application
- **Data not updating**: Check if the Excel file is not open in another application
- **Performance issues**: For large datasets, consider implementing pagination

## License

MIT License
