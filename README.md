# Egyptian Exchange Stocks Desktop Application

A real-time desktop application for monitoring Egyptian Exchange stocks with live web data.

## Features

- 📊 **Real-time Data**: Automatically fetches live data from Egyptian Exchange website
- 🌐 **Web Scraping**: Directly fetches data from Egyptian Exchange website
- 🔍 **Search & Filter**: Search through stocks by any field
- 📈 **Visual Indicators**: Color-coded price changes (green for positive, red for negative)
- 📱 **Responsive Design**: Works on different screen sizes
- 🔄 **Auto-refresh**: Updates every 30 seconds automatically
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

### How It Works

1. **Web Scraping**: Uses `axios` to fetch HTML from Egyptian Exchange website
2. **HTML Parsing**: Uses `cheerio` to parse HTML and extract stock data
3. **Data Processing**: Converts scraped data to JSON format for the application
4. **Fallback**: If web scraping fails, shows mock data to keep app functional

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
└── README.md        # This file
```

## How It Works

1. **Web Scraping**: The application fetches data from Egyptian Exchange website
2. **HTML Parsing**: Uses `cheerio` library to parse HTML and extract stock data
3. **Real-time Updates**: Automatically refreshes data every 30 seconds
4. **IPC Communication**: Main process communicates with renderer process for data updates

## Data Source

The application fetches data directly from the Egyptian Exchange website:
- **URL**: http://41.33.162.236/egs4
- **Format**: HTML table with stock data
- **Columns**: Arabic column names supported (أقصى_سعر, أدنى_سعر, إغلاق, etc.)

## Customization

You can customize the application by modifying:
- `index.html`: UI layout and styling
- `main.js`: Data processing logic
- `package.json`: Dependencies and build configuration

## Troubleshooting

- **No data available**: Check your internet connection
- **Data not updating**: The website might be temporarily unavailable
- **Performance issues**: For large datasets, consider implementing pagination

## License

MIT License
