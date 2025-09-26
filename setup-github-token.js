const fs = require('fs');
const path = require('path');

console.log('🔐 GitHub Token Setup for Egyptian Exchange Stocks\n');

console.log('To get higher GitHub API rate limits, you can set up a GitHub token.\n');

console.log('📋 Steps to create a GitHub token:');
console.log('1. Go to https://github.com/settings/tokens');
console.log('2. Click "Generate new token" → "Generate new token (classic)"');
console.log('3. Give it a name like "Egyptian Exchange Update Check"');
console.log('4. Select "public_repo" scope (no other permissions needed)');
console.log('5. Click "Generate token"');
console.log('6. Copy the token (it starts with "ghp_")\n');

console.log('💡 Ways to set the token:');
console.log('');

console.log('Option 1 - Environment Variable (Recommended):');
console.log('  Windows: set GITHUB_TOKEN=your_token_here');
console.log('  Linux/Mac: export GITHUB_TOKEN=your_token_here');
console.log('');

console.log('Option 2 - Create .env file:');
console.log('  Create a file named ".env" in this directory with:');
console.log('  GITHUB_TOKEN=your_token_here');
console.log('');

console.log('Option 3 - Set in your system environment variables permanently');
console.log('');

console.log('🔍 Rate Limits:');
console.log('  Without token: 60 requests per hour');
console.log('  With token: 5,000 requests per hour');
console.log('');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  console.log('✅ Found .env file');
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('GITHUB_TOKEN=')) {
      console.log('✅ GITHUB_TOKEN found in .env file');
    } else {
      console.log('⚠️ GITHUB_TOKEN not found in .env file');
    }
  } catch (error) {
    console.log('❌ Error reading .env file:', error.message);
  }
} else {
  console.log('⚠️ No .env file found');
}

// Check environment variable
if (process.env.GITHUB_TOKEN) {
  console.log('✅ GITHUB_TOKEN found in environment variables');
  console.log('🔐 Token starts with:', process.env.GITHUB_TOKEN.substring(0, 10) + '...');
} else {
  console.log('⚠️ GITHUB_TOKEN not found in environment variables');
}

console.log('\n📝 After setting up the token, restart the application for it to take effect.');
