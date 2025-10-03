# 📰 Egyptian Exchange News System

The Egyptian Exchange app now includes a comprehensive news system that allows you to push news updates directly to your users. Here's how to use it:

## 🚀 Features

- **Real-time News Updates**: Users get notified when new news is available
- **Multiple News Sources**: Support for GitHub releases and custom JSON endpoints
- **Beautiful UI**: Modern, responsive news display with categories and styling
- **Automatic Notifications**: Visual and audio notifications for new news
- **Caching**: News is cached locally for offline viewing
- **Easy Management**: Simple tools to add, edit, and manage news

## 📋 How It Works

The app fetches news from multiple sources:

1. **GitHub Releases** (automatic): Your app releases are automatically shown as news
2. **Custom JSON Endpoint**: You can host a JSON file anywhere and the app will fetch from it
3. **Local Management**: Use the included news manager script

## 🛠️ Setting Up News

### Method 1: Using the News Manager Script (Recommended)

1. **Add a news item:**
   ```bash
   node news-manager.js add "Market Alert" "EGX30 reaches new high of 18,500 points" "important"
   ```

2. **List all news:**
   ```bash
   node news-manager.js list
   ```

3. **Remove a news item:**
   ```bash
   node news-manager.js remove news-abc123
   ```

4. **Mark all as read:**
   ```bash
   node news-manager.js read
   ```

### Method 2: Host Your Own JSON Endpoint

1. **Create a JSON file** with this structure:
   ```json
   {
     "news": [
       {
         "id": "unique-id",
         "title": "📈 Market Update",
         "content": "Your news content here...",
         "category": "important",
         "date": "2024-12-19T10:00:00Z",
         "source": "Your Source Name",
         "isNew": true
       }
     ]
   }
   ```

2. **Host it anywhere** (GitHub Pages, your website, etc.)

3. **Update the app configuration** in `index.html`:
   ```javascript
   const NEWS_SOURCES = {
     github: {
       url: 'https://api.github.com/repos/AMoussa77/The-Egyptian-Exchange/releases',
       type: 'github'
     },
     custom: {
       url: 'https://your-domain.com/api/news.json',
       type: 'json'
     }
   };
   ```

### Method 3: GitHub Releases (Automatic)

Your GitHub releases are automatically converted to news items. Just create releases in your repository and they'll appear in the news feed.

## 📝 News Categories

The system supports different news categories with unique styling:

- **`breaking`**: Red border, high priority (urgent market alerts)
- **`important`**: Orange border, medium priority (market updates)
- **`update`**: Blue border (app updates, new features)
- **`general`**: Default styling (regular news)

## 🎨 News Item Structure

Each news item should have:

```json
{
  "id": "unique-identifier",
  "title": "News Title with Emoji 📈",
  "content": "Full news content. Supports **bold**, *italic*, and `code` formatting.",
  "category": "important",
  "date": "2024-12-19T10:00:00Z",
  "source": "Source Name",
  "url": "https://optional-link.com",
  "isNew": true
}
```

## 🔔 Notifications

Users will receive notifications when:
- New news items are available
- The news tab shows a red dot indicator
- Audio notifications play (if enabled in settings)

## 📱 User Experience

- **News Tab**: Users can access news via the "📰 News" tab
- **Auto-refresh**: News updates every 5 minutes automatically
- **Manual Refresh**: Users can manually refresh with the refresh button
- **Offline Support**: Cached news is available offline
- **External Links**: News items can link to external sources

## 🚀 Quick Start Examples

### Add Breaking Market News
```bash
node news-manager.js add "🚨 BREAKING: EGX Trading Halted" "Trading has been temporarily suspended due to technical issues. Expected to resume at 2:00 PM." "breaking"
```

### Add App Update News
```bash
node news-manager.js add "📦 App Update v1.1" "New features include dark mode, improved performance, and bug fixes. Download from GitHub releases." "update"
```

### Add Market Analysis
```bash
node news-manager.js add "📊 Weekly Market Analysis" "Banking sector shows strong performance with 3.2% gains this week. Real estate and telecom also performing well." "general"
```

## 🔧 Advanced Configuration

### Custom Refresh Interval
Change the news refresh interval in `index.html`:
```javascript
const NEWS_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes (change as needed)
```

### Multiple News Sources
Add multiple JSON endpoints:
```javascript
const NEWS_SOURCES = {
  github: { url: 'github-api-url', type: 'github' },
  market: { url: 'your-market-news-api', type: 'json' },
  company: { url: 'your-company-news-api', type: 'json' }
};
```

## 📊 Best Practices

1. **Keep titles concise** but descriptive
2. **Use emojis** to make news more engaging
3. **Categorize appropriately** for proper styling
4. **Include dates** for chronological ordering
5. **Add external links** for more detailed information
6. **Test notifications** before publishing important news

## 🛠️ Troubleshooting

### News Not Showing
- Check internet connection
- Verify JSON format is correct
- Check browser console for errors
- Ensure news sources are accessible

### Notifications Not Working
- Check if notifications are enabled in settings
- Verify audio settings
- Check browser permissions

### Performance Issues
- Reduce news refresh interval
- Limit number of news items (recommended: 20-50)
- Optimize images in news content

## 📈 Future Enhancements

Potential improvements you could add:
- Rich text editor for news creation
- Image support in news items
- Push notifications via web APIs
- News analytics and read tracking
- RSS feed integration
- Social media integration

---

**Happy News Broadcasting! 📰✨**

Your users will now stay informed about market updates, app changes, and important announcements directly within the Egyptian Exchange app.
