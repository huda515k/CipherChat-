# Complete Flow Testing Guide

## Pre-Testing Checklist
1. ✅ All servers running (Backend:5001, Frontend:3002, MongoDB:27017)
2. ✅ Clear browser data (IndexedDB) for fresh start
3. ✅ Use two different browsers (Safari + Chrome) or incognito

## Test Flow

### Step 1: Register User 1 (Safari)
1. Open https://localhost:3002 in Safari
2. Click "Register"
3. Username: `alice_test`
4. Password: `testpass123`
5. Confirm Password: `testpass123`
6. Click "Register"
7. **Check browser console (F12)** - Should see:
   - "Storing private key for user: [userId]"
   - "✅ Private key stored and verified"
   - "All keys in IndexedDB: [...]"
8. Should redirect to chat page

### Step 2: Register User 2 (Chrome/Incognito)
1. Open https://localhost:3002 in Chrome (or incognito)
2. Click "Register"
3. Username: `bob_test`
4. Password: `testpass123`
5. Confirm Password: `testpass123`
6. Click "Register"
7. **Check browser console** - Should see same verification messages
8. Should redirect to chat page

### Step 3: Establish Connection
1. In alice's browser, type "bob_test" in search box
2. Press Enter
3. Click on the user result
4. **Check browser console** - Should see:
   - "Starting full key exchange protocol..."
   - "Step 1: Initiating key exchange..."
   - "Key exchange initiated, ID: [id]"
   - "Step 2: Received response, processing..."
   - "Step 3: Sending confirmation..."
   - "✅ Key exchange completed successfully!"

### Step 4: Send Messages
1. Type a message in the input box
2. Press Enter or click Send
3. Message should appear in both browsers
4. Try sending from both users

### Step 5: File Upload
1. Click file upload button
2. Select a file
3. File should upload and appear in both browsers

## Expected Console Output

### Registration:
- "Storing private key for user: [userId]"
- "✅ Private key stored and verified for user: [userId]"
- "All keys in IndexedDB: [...]"

### Key Exchange:
- "Starting full key exchange protocol..."
- "Step 1: Initiating key exchange..."
- "Key exchange initiated, ID: [id]"
- "Step 2: Received response, processing..."
- "Step 3: Sending confirmation..."
- "✅ Key exchange completed successfully!"

### Message Sending:
- "Encrypted message data: {...}"
- "Message sent successfully"

## Troubleshooting

If key exchange fails:
1. Check browser console for errors
2. Verify private keys exist: DevTools → Application → IndexedDB → E2EEKeyStore
3. Check server logs: tail -f /tmp/server.log
4. Verify both users are online (socket connected)

If messages don't appear:
1. Check if key exchange completed
2. Verify session key exists in IndexedDB
3. Check network tab for API errors
