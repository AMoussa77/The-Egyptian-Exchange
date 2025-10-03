#!/usr/bin/env node

/**
 * Egyptian Exchange News Manager
 * 
 * This script helps you manage news for the Egyptian Exchange app.
 * You can add, edit, and publish news updates that will appear in the app.
 * 
 * Usage:
 *   node news-manager.js add "Title" "Content" "category"
 *   node news-manager.js list
 *   node news-manager.js publish
 */

const fs = require('fs');
const path = require('path');

const NEWS_FILE = path.join(__dirname, 'news.json');
const EXAMPLE_FILE = path.join(__dirname, 'news-example.json');

// Initialize news file if it doesn't exist
function initNewsFile() {
    if (!fs.existsSync(NEWS_FILE)) {
        if (fs.existsSync(EXAMPLE_FILE)) {
            fs.copyFileSync(EXAMPLE_FILE, NEWS_FILE);
            console.log('✅ Initialized news.json from example file');
        } else {
            const initialNews = {
                news: []
            };
            fs.writeFileSync(NEWS_FILE, JSON.stringify(initialNews, null, 2));
            console.log('✅ Created empty news.json file');
        }
    }
}

// Load news from file
function loadNews() {
    try {
        const data = fs.readFileSync(NEWS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Error loading news:', error.message);
        return { news: [] };
    }
}

// Save news to file
function saveNews(newsData) {
    try {
        fs.writeFileSync(NEWS_FILE, JSON.stringify(newsData, null, 2));
        console.log('✅ News saved successfully');
        return true;
    } catch (error) {
        console.error('❌ Error saving news:', error.message);
        return false;
    }
}

// Generate unique ID
function generateId() {
    return 'news-' + Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Add new news item
function addNews(title, content, category = 'general') {
    const newsData = loadNews();
    
    const newItem = {
        id: generateId(),
        title: title,
        content: content,
        category: category.toLowerCase(),
        date: new Date().toISOString(),
        source: 'Egyptian Exchange Team',
        isNew: true
    };
    
    // Add to beginning of array (newest first)
    newsData.news.unshift(newItem);
    
    if (saveNews(newsData)) {
        console.log('📰 News added successfully!');
        console.log(`   Title: ${title}`);
        console.log(`   Category: ${category}`);
        console.log(`   ID: ${newItem.id}`);
    }
}

// List all news
function listNews() {
    const newsData = loadNews();
    
    if (newsData.news.length === 0) {
        console.log('📰 No news items found');
        return;
    }
    
    console.log(`📰 Found ${newsData.news.length} news items:\n`);
    
    newsData.news.forEach((item, index) => {
        const date = new Date(item.date).toLocaleDateString();
        const isNew = item.isNew ? ' [NEW]' : '';
        console.log(`${index + 1}. ${item.title}${isNew}`);
        console.log(`   Category: ${item.category} | Date: ${date} | ID: ${item.id}`);
        console.log(`   Content: ${item.content.substring(0, 100)}${item.content.length > 100 ? '...' : ''}`);
        console.log('');
    });
}

// Remove news item by ID
function removeNews(id) {
    const newsData = loadNews();
    const initialLength = newsData.news.length;
    
    newsData.news = newsData.news.filter(item => item.id !== id);
    
    if (newsData.news.length < initialLength) {
        if (saveNews(newsData)) {
            console.log(`✅ News item ${id} removed successfully`);
        }
    } else {
        console.log(`❌ News item ${id} not found`);
    }
}

// Mark all news as read (not new)
function markAllRead() {
    const newsData = loadNews();
    
    newsData.news.forEach(item => {
        item.isNew = false;
    });
    
    if (saveNews(newsData)) {
        console.log('✅ All news marked as read');
    }
}

// Show help
function showHelp() {
    console.log(`
📰 Egyptian Exchange News Manager

Usage:
  node news-manager.js <command> [options]

Commands:
  add <title> <content> [category]  Add a new news item
  list                              List all news items
  remove <id>                       Remove news item by ID
  read                              Mark all news as read
  help                              Show this help message

Categories:
  - breaking    Red border, high priority
  - important   Orange border, medium priority  
  - update      Blue border, app updates
  - general     Default styling

Examples:
  node news-manager.js add "Market Update" "EGX30 reaches new high" "important"
  node news-manager.js add "App Update" "Version 1.1 released with new features" "update"
  node news-manager.js list
  node news-manager.js remove news-abc123
  node news-manager.js read

Note: After adding news, users will see notifications in the app automatically.
The app checks for new news every 5 minutes.
`);
}

// Main function
function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        showHelp();
        return;
    }
    
    // Initialize news file
    initNewsFile();
    
    const command = args[0].toLowerCase();
    
    switch (command) {
        case 'add':
            if (args.length < 3) {
                console.log('❌ Usage: node news-manager.js add <title> <content> [category]');
                return;
            }
            addNews(args[1], args[2], args[3] || 'general');
            break;
            
        case 'list':
            listNews();
            break;
            
        case 'remove':
            if (args.length < 2) {
                console.log('❌ Usage: node news-manager.js remove <id>');
                return;
            }
            removeNews(args[1]);
            break;
            
        case 'read':
            markAllRead();
            break;
            
        case 'help':
        case '--help':
        case '-h':
            showHelp();
            break;
            
        default:
            console.log(`❌ Unknown command: ${command}`);
            showHelp();
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = {
    addNews,
    listNews,
    removeNews,
    markAllRead,
    loadNews,
    saveNews
};
