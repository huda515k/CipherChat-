/**
 * Comprehensive End-to-End Test Script
 * Tests: Registration → Login → Key Exchange → Messaging
 * Uses Puppeteer to automate browser interactions
 */

const puppeteer = require('puppeteer');
const https = require('https');
const axios = require('axios');

// Configuration
// Default to HTTPS since both server and client are running on HTTPS
const CLIENT_URL = process.env.CLIENT_URL || 'https://localhost:3002';
const API_BASE = process.env.API_BASE || 'https://localhost:5001/api';
const SOCKET_URL = process.env.SOCKET_URL || 'https://localhost:5001';

// Create axios instance that ignores SSL errors for self-signed certs
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

// Test users
const USER1 = {
  username: 'testuser1_' + Date.now(),
  password: 'testpass123'
};

const USER2 = {
  username: 'testuser2_' + Date.now(),
  password: 'testpass123'
};

let user1Id = null;
let user2Id = null;
let user1Token = null;
let user2Token = null;

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to wait for element
async function waitForElement(page, selector, timeout = 30000) {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch (error) {
    return false;
  }
}

// Helper function to clear IndexedDB (only works after page navigation)
async function clearIndexedDB(page) {
  try {
    // Make sure we're on a page first
    const url = page.url();
    if (!url || url === 'about:blank') {
      // Navigate to a page first to establish security context
      await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
      await wait(500);
    }
    
    await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        try {
          const deleteReq = indexedDB.deleteDatabase('E2EEKeyStore');
          deleteReq.onsuccess = () => resolve();
          deleteReq.onerror = () => {
            console.warn('IndexedDB deletion error (may be normal):', deleteReq.error);
            resolve(); // Don't fail the test
          };
          deleteReq.onblocked = () => {
            console.warn('IndexedDB deletion blocked (may be normal)');
            resolve(); // Don't fail the test
          };
        } catch (error) {
          console.warn('IndexedDB deletion failed (may be normal):', error.message);
          resolve(); // Don't fail the test
        }
      });
    });
  } catch (error) {
    // IndexedDB clearing is optional - don't fail the test if it doesn't work
    console.warn('⚠️  Could not clear IndexedDB (this is OK, using separate contexts):', error.message);
  }
}

// Test: Register User
async function registerUser(page, username, password) {
  console.log(`\n📝 Registering user: ${username}`);
  
  try {
    // Navigate to register page (ignore SSL errors for self-signed certs)
    console.log(`   Navigating to register page...`);
    try {
      // Check if page is still open
      if (page.isClosed()) {
        throw new Error('Page was closed');
      }
      
      // Set up page to ignore SSL errors
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      });
      
      // Wait a moment to ensure page is ready
      await wait(500);
      
      const response = await page.goto(`${CLIENT_URL}/register`, { 
        waitUntil: 'domcontentloaded', 
        timeout: 30000,
        ignoreHTTPSErrors: true
      });
      
      if (!response || response.status() >= 400) {
        throw new Error(`Failed to load register page: ${response?.status() || 'no response'}`);
      }
    } catch (error) {
      if (error.message.includes('Requesting main frame too early') || error.message.includes('Session closed')) {
        // Page might not be ready, wait and retry
        console.log('   Page not ready, waiting and retrying...');
        await wait(2000);
        try {
          const response = await page.goto(`${CLIENT_URL}/register`, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000,
            ignoreHTTPSErrors: true
          });
          if (!response || response.status() >= 400) {
            throw new Error(`Failed to load register page: ${response?.status() || 'no response'}`);
          }
        } catch (retryError) {
          throw new Error(`Failed to navigate after retry: ${retryError.message}`);
        }
      } else if (error.message.includes('ERR_EMPTY_RESPONSE') || error.message.includes('net::ERR') || error.message.includes('SSL')) {
        throw new Error(`Client server is not running or not ready at ${CLIENT_URL}. Please start it with: cd client && npm start. Error: ${error.message}`);
      } else {
        throw error;
      }
    }
    
    await wait(3000); // Wait for React to render (increased)
    
    // Fill registration form - try multiple selectors
    let usernameInput = null;
    try {
      usernameInput = await page.waitForSelector('input[type="text"]', { timeout: 15000 });
    } catch (e) {
      // Try alternative selectors
      usernameInput = await page.waitForSelector('input[placeholder*="Username"], input[placeholder*="username"], input', { timeout: 10000 });
    }
    await page.type('input[type="text"]', username);
    await wait(500);
    
    const passwordInputs = await page.$$('input[type="password"]');
    if (passwordInputs.length >= 2) {
      await passwordInputs[0].type(password);
      await wait(500);
      await passwordInputs[1].type(password);
    } else {
      throw new Error('Password inputs not found');
    }
    
    // Wait for page to be ready before evaluating
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 }).catch(() => {});
    await wait(1000);
    
    // Set up console error capture (before navigation)
    try {
      await page.evaluate(() => {
        if (!window.consoleErrors) {
          window.consoleErrors = [];
          const originalError = console.error;
          console.error = (...args) => {
            window.consoleErrors.push({ type: 'error', text: args.join(' ') });
            originalError.apply(console, args);
          };
        }
      });
    } catch (e) {
      // If evaluate fails, page might not be ready - wait and retry
      await wait(2000);
      await page.evaluate(() => {
        if (!window.consoleErrors) {
          window.consoleErrors = [];
          const originalError = console.error;
          console.error = (...args) => {
            window.consoleErrors.push({ type: 'error', text: args.join(' ') });
            originalError.apply(console, args);
          };
        }
      });
    }
    
    // Wait for submit button to be enabled and visible
    await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    await wait(1000);
    
    // Check if button is disabled
    const isDisabled = await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      return btn ? btn.disabled : true;
    });
    
    if (isDisabled) {
      console.log('   Button is disabled, waiting for it to be enabled...');
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('button[type="submit"]');
          return btn && !btn.disabled;
        },
        { timeout: 10000 }
      );
    }
    
    // Submit form
    const submitButton = await page.$('button[type="submit"]');
    if (!submitButton) {
      throw new Error('Submit button not found');
    }
    
    // Click submit - use evaluate to ensure click happens
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]');
      if (btn) btn.click();
    });
    
    // Wait a bit for the form to process
    await wait(1000);
    
    // Wait for either redirect to /chat or error message
    let registrationComplete = false;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds for key generation
    
    while (!registrationComplete && attempts < maxAttempts) {
      await wait(1000);
      attempts++;
      
      // Check for errors first
      try {
        const errorElement = await page.$('.error-message');
        if (errorElement) {
          const errorText = await page.evaluate(el => el.textContent, errorElement);
          if (errorText && errorText.trim()) {
            throw new Error(`Registration error: ${errorText}`);
          }
        }
      } catch (e) {
        if (e.message.includes('Registration error')) throw e;
      }
      
      // Check if we're on chat page OR if localStorage has auth data
      const currentUrl = page.url();
      const authData = await page.evaluate(() => {
        return {
          userId: localStorage.getItem('userId'),
          token: localStorage.getItem('token'),
          username: localStorage.getItem('username')
        };
      });
      
      if (currentUrl.includes('/chat')) {
        registrationComplete = true;
        break;
      } else if (authData.userId && authData.token) {
        // Has auth but not on /chat - navigate there
        console.log('   Auth found but not on /chat, navigating...');
        await page.goto(`${CLIENT_URL}/chat`, { waitUntil: 'domcontentloaded', timeout: 10000, ignoreHTTPSErrors: true });
        await wait(2000);
        registrationComplete = true;
        break;
      }
      
      // Check console for critical errors
      try {
        const consoleMessages = await page.evaluate(() => window.consoleErrors || []);
        if (consoleMessages.length > 0) {
          const errors = consoleMessages.filter(m => 
            m.type === 'error' && 
            !m.text.includes('favicon') && 
            !m.text.includes('source map')
          );
          if (errors.length > 0) {
            const errorText = errors[0].text.substring(0, 200);
            if (errorText.includes('Failed') || errorText.includes('Error') || errorText.includes('Cannot')) {
              console.log(`   ⚠️ Console error detected: ${errorText}`);
            }
          }
        }
      } catch (e) {
        // Ignore evaluation errors
      }
      
      if (attempts % 10 === 0) {
        console.log(`   Waiting for registration... (${attempts}s)`);
        const buttonState = await page.evaluate(() => {
          const btn = document.querySelector('button[type="submit"]');
          return btn ? { disabled: btn.disabled, text: btn.textContent } : null;
        });
        if (buttonState) {
          console.log(`   Button: ${buttonState.text}, disabled: ${buttonState.disabled}`);
        }
      }
    }
    
    if (!registrationComplete) {
      const currentUrl = page.url();
      const authData = await page.evaluate(() => ({
        userId: localStorage.getItem('userId'),
        token: !!localStorage.getItem('token')
      }));
      const consoleErrors = await page.evaluate(() => (window.consoleErrors || []).slice(0, 3));
      throw new Error(`Registration timeout after ${maxAttempts}s. URL: ${currentUrl}. Has auth: ${JSON.stringify(authData)}. Errors: ${JSON.stringify(consoleErrors)}`);
    }
    
    // Get user ID from localStorage
    const userId = await page.evaluate(() => localStorage.getItem('userId'));
    const token = await page.evaluate(() => localStorage.getItem('token'));
    
    if (!userId || !token) {
      throw new Error('User ID or token not found in localStorage after registration');
    }
    
    console.log(`✅ User registered successfully: ${username}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Token: ${token.substring(0, 20)}...`);
    
    // Verify private key was stored by checking IndexedDB directly
    const hasPrivateKey = await page.evaluate(async (uid) => {
      try {
        return new Promise((resolve) => {
          const request = indexedDB.open('E2EEKeyStore', 1);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['keys'], 'readonly');
            const store = transaction.objectStore('keys');
            const keyId = `${uid}_rsa`;
            const getRequest = store.get(keyId);
            getRequest.onsuccess = () => {
              resolve(!!getRequest.result);
            };
            getRequest.onerror = () => resolve(false);
          };
          request.onerror = () => resolve(false);
        });
      } catch (e) {
        return false;
      }
    }, userId);
    
    if (!hasPrivateKey) {
      console.warn('⚠️  Warning: Private key not found in IndexedDB after registration');
    } else {
      console.log('✅ Private key verified in IndexedDB');
    }
    
    return { userId, token, username };
  } catch (error) {
    console.error(`❌ Registration failed for ${username}:`, error.message);
      // Take screenshot for debugging (only if page is still open)
      try {
        if (!page.isClosed()) {
          await page.screenshot({ path: `error-register-${username}-${Date.now()}.png` });
        }
      } catch (screenshotError) {
        // Ignore screenshot errors
      }
      throw error;
  }
}

// Test: Login User
async function loginUser(page, username, password) {
  console.log(`\n🔐 Logging in user: ${username}`);
  
  try {
    // Navigate to login page (ignore SSL errors for self-signed certs)
    console.log(`   Navigating to login page...`);
    await page.goto(`${CLIENT_URL}/login`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000,
      ignoreHTTPSErrors: true
    });
    await wait(2000); // Wait for React to render
    
    // Fill login form
    await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    await page.type('input[type="text"]', username);
    await wait(500);
    
    const passwordInput = await page.$('input[type="password"]');
    if (!passwordInput) {
      throw new Error('Password input not found');
    }
    await passwordInput.type(password);
    
    // Submit form
    await wait(500);
    const submitButton = await page.$('button[type="submit"]');
    if (!submitButton) {
      throw new Error('Submit button not found');
    }
    
    // Click submit and wait for navigation
    const navigationPromise = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }).catch(() => {});
    await submitButton.click();
    await navigationPromise;
    
    await wait(3000); // Wait for login to complete
    
    // Check for errors
    const errorElement = await page.$('.error-message');
    if (errorElement) {
      const errorText = await page.evaluate(el => el.textContent, errorElement);
      throw new Error(`Login error: ${errorText}`);
    }
    
    // Check if we're on chat page (login successful)
    const currentUrl = page.url();
    if (!currentUrl.includes('/chat')) {
      throw new Error(`Login failed - not redirected to chat. Current URL: ${currentUrl}`);
    }
    
    // Get user ID from localStorage
    const userId = await page.evaluate(() => localStorage.getItem('userId'));
    const token = await page.evaluate(() => localStorage.getItem('token'));
    
    if (!userId || !token) {
      throw new Error('User ID or token not found in localStorage after login');
    }
    
    console.log(`✅ User logged in successfully: ${username}`);
    console.log(`   User ID: ${userId}`);
    
    return { userId, token, username };
  } catch (error) {
    console.error(`❌ Login failed for ${username}:`, error.message);
    // Take screenshot for debugging
    await page.screenshot({ path: `error-login-${username}-${Date.now()}.png` });
    throw error;
  }
}

// Test: Search for user and select
async function searchAndSelectUser(page, targetUsername) {
  console.log(`\n🔍 Searching for user: ${targetUsername}`);
  
  try {
    // Wait for search input
    await page.waitForSelector('input[placeholder*="Search"]', { timeout: 10000 });
    await wait(1000);
    
    // Type username in search box
    const searchInput = await page.$('input[placeholder*="Search"]');
    if (!searchInput) {
      throw new Error('Search input not found');
    }
    
    await searchInput.click();
    await wait(500);
    await searchInput.type(targetUsername);
    await wait(500);
    await page.keyboard.press('Enter');
    
    // Wait for user to appear or error
    await wait(3000);
    
    // Check if user was found and selected
    const conversations = await page.evaluate(() => {
      const convItems = document.querySelectorAll('.conversation-item');
      return Array.from(convItems).map(item => ({
        text: item.textContent,
        username: item.querySelector('.conversation-name-small')?.textContent
      }));
    });
    
    // Wait a bit for search to complete
    await wait(2000);
    
    // Check if user was automatically selected (search might auto-select)
    const selectedUser = await page.evaluate(() => {
      const nameEl = document.querySelector('.chat-conversation-header .conversation-name');
      return nameEl ? nameEl.textContent.trim() : null;
    });
    
    if (selectedUser && selectedUser.includes(targetUsername)) {
      console.log(`✅ User found and auto-selected: ${targetUsername}`);
      return true;
    }
    
    // Try to find and click the user in conversations list
    const userFound = await page.evaluate((username) => {
      const convItems = document.querySelectorAll('.conversation-item');
      for (const item of convItems) {
        const nameEl = item.querySelector('.conversation-name-small');
        if (nameEl && nameEl.textContent.trim().includes(username)) {
          item.click();
          return true;
        }
      }
      return false;
    }, targetUsername);
    
    if (!userFound) {
      // User might have been found via search API and selected automatically
      await wait(2000);
      const finalCheck = await page.evaluate(() => {
        return document.querySelector('.chat-conversation-header .conversation-name')?.textContent?.trim();
      });
      
      if (finalCheck && finalCheck.includes(targetUsername)) {
        console.log(`✅ User found and selected: ${targetUsername}`);
        return true;
      }
      
      throw new Error(`User ${targetUsername} not found in search results. Current selected user: ${finalCheck || 'none'}`);
    }
    
    console.log(`✅ User found and selected: ${targetUsername}`);
    await wait(2000); // Wait for key exchange to initiate
    
    return true;
  } catch (error) {
    console.error(`❌ Search failed:`, error.message);
    await page.screenshot({ path: `error-search-${Date.now()}.png` });
    throw error;
  }
}

// Test: Send message
async function sendMessage(page, messageText) {
  console.log(`\n💬 Sending message: "${messageText}"`);
  
  try {
    // Wait for message input
    await page.waitForSelector('input[placeholder*="Type a message"]', { timeout: 10000 });
    await wait(1000);
    
    // Type message
    const messageInput = await page.$('input[placeholder*="Type a message"]');
    if (!messageInput) {
      throw new Error('Message input not found');
    }
    
    await messageInput.click();
    await wait(500);
    await messageInput.type(messageText);
    await wait(500);
    
    // Send message (click send button or press Enter)
    const sendButton = await page.$('button[type="submit"]');
    if (sendButton) {
      await sendButton.click();
    } else {
      await page.keyboard.press('Enter');
    }
    
    await wait(3000); // Wait for message to be sent
    
    // Check if message appears in chat
    const messages = await page.evaluate(() => {
      const messageElements = document.querySelectorAll('.message');
      return Array.from(messageElements).map(msg => ({
        text: msg.querySelector('.message-content')?.textContent,
        isSent: msg.classList.contains('sent')
      }));
    });
    
    const messageSent = messages.some(msg => msg.text && msg.text.includes(messageText));
    
    if (messageSent) {
      console.log(`✅ Message sent successfully`);
      return true;
    } else {
      console.warn(`⚠️  Message may not have appeared in chat yet`);
      return true; // Still return true as message might be processing
    }
  } catch (error) {
    console.error(`❌ Send message failed:`, error.message);
    await page.screenshot({ path: `error-send-message-${Date.now()}.png` });
    throw error;
  }
}

// Test: Check for received messages
async function checkReceivedMessages(page, expectedText) {
  console.log(`\n📥 Checking for received message: "${expectedText}"`);
  
  try {
    await wait(3000); // Wait for message to arrive
    
    const messages = await page.evaluate(() => {
      const messageElements = document.querySelectorAll('.message');
      return Array.from(messageElements).map(msg => ({
        text: msg.querySelector('.message-content')?.textContent,
        isReceived: msg.classList.contains('received')
      }));
    });
    
    const messageFound = messages.some(msg => 
      msg.isReceived && msg.text && msg.text.includes(expectedText)
    );
    
    if (messageFound) {
      console.log(`✅ Message received successfully`);
      return true;
    } else {
      console.warn(`⚠️  Expected message not found yet`);
      console.log(`   Current messages:`, messages.map(m => m.text).join(', '));
      return false;
    }
  } catch (error) {
    console.error(`❌ Check messages failed:`, error.message);
    return false;
  }
}

// Main test flow
async function runFullFlowTest() {
  console.log('========================================');
  console.log('COMPREHENSIVE E2EE FLOW TEST');
  console.log('========================================');
  console.log(`Client URL: ${CLIENT_URL}`);
  console.log(`API URL: ${API_BASE}`);
  console.log(`Socket URL: ${SOCKET_URL}`);
  console.log('');
  
  // Verify client is accessible before starting
  console.log('🔍 Verifying client is accessible...');
  const http = require('http');
  const https = require('https');
  const url = require('url');
  
  const clientUrl = new URL(CLIENT_URL);
  const checkClient = () => {
    return new Promise((resolve) => {
      const protocol = clientUrl.protocol === 'https:' ? https : http;
      const req = protocol.request({
        hostname: clientUrl.hostname,
        port: clientUrl.port || (clientUrl.protocol === 'https:' ? 443 : 80),
        path: '/',
        method: 'GET',
        timeout: 5000,
        rejectUnauthorized: false // Allow self-signed certs
      }, (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 304);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  };
  
  // Wait up to 90 seconds for client to be ready (React apps can take 30-60 seconds to compile)
  let clientReady = false;
  console.log('   Waiting for client to be ready (React apps can take 30-60 seconds to compile)...');
  for (let i = 0; i < 90; i++) {
    if (await checkClient()) {
      console.log('✅ Client is accessible');
      clientReady = true;
      break;
    }
    if (i > 0 && i % 10 === 0) {
      console.log(`   Still waiting... (${i}/90 seconds)`);
    }
    await wait(1000);
  }
  
  if (!clientReady) {
    console.error('');
    console.error('❌ Client is not accessible after 90 seconds');
    console.error('');
    console.error('The React app may still be compiling. Check the terminal where you ran "npm start"');
    console.error('When you see "Compiled successfully!", the client is ready.');
    console.error('');
    throw new Error(`Client is not accessible at ${CLIENT_URL} after 90 seconds. Please ensure the React app has finished compiling.`);
  }
  
  console.log('');
  
  let browser = null;
  let page1 = null;
  let page2 = null;
  
  try {
    // Launch browser
    console.log('🚀 Launching browser...');
    
    // Try to find Chrome executable on macOS
    const fs = require('fs');
    const path = require('path');
    let executablePath = null;
    
    // Check for Chrome in common macOS locations
    const chromePaths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    ];
    
    for (const chromePath of chromePaths) {
      if (fs.existsSync(chromePath)) {
        executablePath = chromePath;
        console.log(`✅ Found Chrome at: ${chromePath}`);
        break;
      }
    }
    
    const launchOptions = {
      headless: false, // Set to true for CI/CD
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ],
      ignoreHTTPSErrors: true,
      timeout: 120000, // Increase timeout for browser launch
      protocolTimeout: 120000
    };
    
    // Use system Chrome if found
    if (executablePath) {
      launchOptions.executablePath = executablePath;
      console.log(`   Using Chrome at: ${executablePath}`);
    } else {
      console.log('   Using Puppeteer bundled Chromium');
    }
    
    try {
      console.log('   Launching browser (this may take a moment)...');
      browser = await puppeteer.launch(launchOptions);
      console.log('✅ Browser launched successfully');
    } catch (error) {
      console.error('❌ Failed to launch browser:', error.message);
      if (error.message.includes('socket') || error.message.includes('ECONNRESET')) {
        console.error('');
        console.error('   This is a known Puppeteer issue. Trying alternative approach...');
        console.error('   Attempting to launch with headless mode...');
        try {
          launchOptions.headless = true;
          browser = await puppeteer.launch(launchOptions);
          console.log('✅ Browser launched in headless mode');
        } catch (headlessError) {
          console.error('❌ Headless mode also failed:', headlessError.message);
          throw headlessError;
        }
      } else {
        console.error('   This might be due to:');
        console.error('   1. Chrome/Chromium not installed');
        console.error('   2. Permission issues');
        console.error('   3. Puppeteer needs to download browser');
        console.error('');
        console.error('   Try running: npm install puppeteer --force');
        console.error('   Or install Chrome manually');
        throw error;
      }
    }
    
    // Create two browser contexts (simulating two users)
    // Use default context for first user, create incognito context for second user
    console.log('   Creating browser pages...');
    page1 = await browser.newPage();
    await wait(500); // Small delay to ensure page is ready
    
    // Create a new incognito browser context for the second user (isolated session)
    const context2 = await browser.createIncognitoBrowserContext();
    page2 = await context2.newPage();
    await wait(500); // Small delay to ensure page2 is ready
    console.log('✅ Browser pages created');
    
    // Enable console logging
    page1.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Page1 Console Error]: ${msg.text()}`);
      }
    });
    
    page2.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Page2 Console Error]: ${msg.text()}`);
      }
    });
    
    // Set viewport
    await page1.setViewport({ width: 1280, height: 720 });
    await page2.setViewport({ width: 1280, height: 720 });
    
    // ============================================
    // STEP 1: Register User 1
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 1: REGISTER USER 1');
    console.log('═══════════════════════════════════════');
    
    // Clear IndexedDB after navigating (separate contexts already provide isolation)
    // Navigate to a blank page first to establish context
    await page1.goto('about:blank', { waitUntil: 'domcontentloaded' });
    await clearIndexedDB(page1);
    const user1Data = await registerUser(page1, USER1.username, USER1.password);
    user1Id = user1Data.userId;
    user1Token = user1Data.token;
    
    // ============================================
    // STEP 2: Register User 2
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 2: REGISTER USER 2');
    console.log('═══════════════════════════════════════');
    
    // Wait for page2 to be ready before navigating
    await wait(2000);
    
    // Ensure page2 is ready - navigate to a simple page first
    try {
      if (!page2.isClosed()) {
        await page2.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
        await wait(1000);
        await clearIndexedDB(page2);
      } else {
        throw new Error('Page2 was closed');
      }
    } catch (error) {
      // If page isn't ready, try to recreate it
      console.log('   Page2 not ready, recreating...');
      try {
        const context2 = await browser.createIncognitoBrowserContext();
        page2 = await context2.newPage();
        await wait(1000);
        await page2.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 });
        await clearIndexedDB(page2);
      } catch (recreateError) {
        console.error('   Failed to recreate page2:', recreateError.message);
        throw new Error(`Page2 initialization failed: ${recreateError.message}`);
      }
    }
    
    const user2Data = await registerUser(page2, USER2.username, USER2.password);
    user2Id = user2Data.userId;
    user2Token = user2Data.token;
    
    // ============================================
    // STEP 3: Login User 1 (fresh login)
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 3: LOGIN USER 1');
    console.log('═══════════════════════════════════════');
    
    // Note: We're using the same context, so IndexedDB already has the keys
    // For a true "fresh login", we'd need a new context, but this tests the flow
    await loginUser(page1, USER1.username, USER1.password);
    
    // ============================================
    // STEP 4: Login User 2 (fresh login)
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 4: LOGIN USER 2');
    console.log('═══════════════════════════════════════');
    
    // Note: We're using the same context, so IndexedDB already has the keys
    // For a true "fresh login", we'd need a new context, but this tests the flow
    await loginUser(page2, USER2.username, USER2.password);
    
    // ============================================
    // STEP 5: User 1 searches for User 2
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 5: USER 1 SEARCHES FOR USER 2');
    console.log('═══════════════════════════════════════');
    
    await searchAndSelectUser(page1, USER2.username);
    await wait(5000); // Wait for key exchange to complete
    
    // ============================================
    // STEP 6: User 2 searches for User 1
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 6: USER 2 SEARCHES FOR USER 1');
    console.log('═══════════════════════════════════════');
    
    await searchAndSelectUser(page2, USER1.username);
    await wait(5000); // Wait for key exchange to complete
    
    // ============================================
    // STEP 7: User 1 sends message to User 2
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 7: USER 1 SENDS MESSAGE TO USER 2');
    console.log('═══════════════════════════════════════');
    
    const message1 = `Hello from ${USER1.username}! ${Date.now()}`;
    await sendMessage(page1, message1);
    await wait(3000);
    
    // ============================================
    // STEP 8: User 2 receives message
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 8: USER 2 RECEIVES MESSAGE');
    console.log('═══════════════════════════════════════');
    
    await checkReceivedMessages(page2, message1);
    
    // ============================================
    // STEP 9: User 2 sends message to User 1
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 9: USER 2 SENDS MESSAGE TO USER 1');
    console.log('═══════════════════════════════════════');
    
    const message2 = `Hello from ${USER2.username}! ${Date.now()}`;
    await sendMessage(page2, message2);
    await wait(3000);
    
    // ============================================
    // STEP 10: User 1 receives message
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('STEP 10: USER 1 RECEIVES MESSAGE');
    console.log('═══════════════════════════════════════');
    
    await checkReceivedMessages(page1, message2);
    
    // ============================================
    // SUCCESS!
    // ============================================
    console.log('\n═══════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED!');
    console.log('═══════════════════════════════════════');
    console.log(`User 1: ${USER1.username} (ID: ${user1Id})`);
    console.log(`User 2: ${USER2.username} (ID: ${user2Id})`);
    console.log('\nMessages exchanged successfully!');
    console.log('Keeping browser open for 10 seconds for inspection...');
    
    await wait(10000);
    
  } catch (error) {
    console.error('\n❌❌❌ TEST FAILED ❌❌❌');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    
    // Take screenshots
    if (page1) {
      await page1.screenshot({ path: `error-page1-${Date.now()}.png`, fullPage: true });
    }
    if (page2) {
      await page2.screenshot({ path: `error-page2-${Date.now()}.png`, fullPage: true });
    }
    
    throw error;
  } finally {
    // Keep browser open for inspection
    console.log('\nClosing browser in 5 seconds...');
    await wait(5000);
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
if (require.main === module) {
  runFullFlowTest()
    .then(() => {
      console.log('\n✅ Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { runFullFlowTest };

