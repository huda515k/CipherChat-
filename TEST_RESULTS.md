# Full Flow Test Results and Fixes

## Overview
This document describes the comprehensive test script created to test the complete E2EE messaging flow: Registration → Login → Key Exchange → Messaging, along with all fixes applied.

## Test Script Created
- **File**: `test-full-flow-puppeteer.js`
- **Type**: Puppeteer-based browser automation
- **Tests**: Complete end-to-end flow with 2 users

## Fixes Applied

### 1. Socket URL Auto-Detection (Chat.js)
**Issue**: Socket URL was hardcoded to HTTPS, causing connection failures when server runs on HTTP.

**Fix**: Added auto-detection based on current page protocol:
```javascript
const getSocketURL = () => {
  if (process.env.REACT_APP_SOCKET_URL) {
    return process.env.REACT_APP_SOCKET_URL;
  }
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//localhost:5001`;
};
```

**File**: `client/src/components/Chat.js`

### 2. API URL Auto-Detection (api.js)
**Issue**: API URL was hardcoded to HTTP, causing failures when client runs on HTTPS.

**Fix**: Added auto-detection based on current page protocol:
```javascript
const getAPIBaseURL = () => {
  if (process.env.REACT_APP_API_URL) {
    return process.env.REACT_APP_API_URL;
  }
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//localhost:5001/api`;
};
```

**File**: `client/src/services/api.js`

### 3. Test Script Improvements
- Fixed IndexedDB verification to work in browser context
- Improved error handling and screenshots
- Added better wait times for async operations
- Enhanced user search and selection logic
- Added comprehensive logging

**File**: `test-full-flow-puppeteer.js`

## How to Run the Test

### Prerequisites
1. MongoDB must be running
2. Install dependencies:
   ```bash
   npm install
   cd server && npm install && cd ..
   cd client && npm install && cd ..
   ```

### Option 1: Automated Test Runner
```bash
./run-test.sh
```
This script will:
- Check if servers are running
- Start servers if needed
- Run the full flow test
- Clean up on completion

### Option 2: Manual Test
1. Start the servers:
   ```bash
   # Terminal 1 - Server
   cd server
   npm start
   
   # Terminal 2 - Client
   cd client
   npm start
   ```

2. Run the test:
   ```bash
   npm run test-flow
   # or
   node test-full-flow-puppeteer.js
   ```

### Option 3: Manual Browser Testing
1. Open two browser windows (or one regular + one incognito)
2. Navigate to `http://localhost:3002` in both
3. In Browser 1:
   - Register as `testuser1` with password `testpass123`
   - After registration, search for `testuser2`
   - Send a message
4. In Browser 2:
   - Register as `testuser2` with password `testpass123`
   - After registration, search for `testuser1`
   - Send a message
5. Verify messages appear in both browsers

## Test Flow

The test script performs the following steps:

1. **Register User 1** (`testuser1_<timestamp>`)
   - Fills registration form
   - Verifies private key stored in IndexedDB
   - Confirms redirect to chat page

2. **Register User 2** (`testuser2_<timestamp>`)
   - Same process as User 1
   - Uses separate browser context

3. **Login User 1** (fresh login)
   - Clears IndexedDB
   - Logs in with credentials
   - Verifies private key exists

4. **Login User 2** (fresh login)
   - Same process as User 1

5. **User 1 searches for User 2**
   - Types username in search box
   - Selects user from results
   - Waits for key exchange to complete

6. **User 2 searches for User 1**
   - Same process

7. **User 1 sends message to User 2**
   - Types message
   - Sends message
   - Verifies message appears

8. **User 2 receives message**
   - Checks for received message
   - Verifies decryption

9. **User 2 sends message to User 1**
   - Same process

10. **User 1 receives message**
    - Verifies message received and decrypted

## Expected Results

✅ All steps should complete successfully
✅ Messages should be encrypted/decrypted properly
✅ Key exchange should complete automatically
✅ No errors in browser console
✅ No errors in server logs

## Troubleshooting

### Issue: Socket connection fails
**Solution**: Check if server is running on correct port and protocol. The fix above should handle HTTP/HTTPS automatically.

### Issue: Private key not found
**Solution**: 
- Clear browser IndexedDB: DevTools → Application → IndexedDB → E2EEKeyStore → Delete
- Re-register the user

### Issue: Key exchange times out
**Solution**:
- Check server logs for errors
- Verify both users are online (socket connected)
- Check browser console for errors
- Ensure MongoDB is running

### Issue: Messages not appearing
**Solution**:
- Verify key exchange completed (check console logs)
- Check if session key exists in IndexedDB
- Verify socket connection is active
- Check network tab for API errors

## Files Modified

1. `client/src/components/Chat.js` - Socket URL auto-detection
2. `client/src/services/api.js` - API URL auto-detection
3. `test-full-flow-puppeteer.js` - Comprehensive test script (new)
4. `run-test.sh` - Test runner script (new)
5. `package.json` - Added test script and dependencies

## Next Steps

1. Run the test script: `npm run test-flow`
2. Review any errors that occur
3. Fix any remaining issues
4. Verify all functionality works end-to-end

## Notes

- The test uses unique usernames with timestamps to avoid conflicts
- Browser contexts are isolated (simulating two different users)
- Screenshots are saved on errors for debugging
- The test keeps browser open for 10 seconds at the end for inspection

