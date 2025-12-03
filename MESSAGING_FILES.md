# Messaging System Files

## Core Messaging Files

### Client Side:
1. **`client/src/components/Chat.js`** - Main chat UI component
   - Handles message sending/receiving
   - Manages socket connections
   - Calls `establishSession()` before sending messages
   - **Issue**: Blocks message sending while waiting for key exchange

2. **`client/src/utils/messageEncryption.js`** - Message encryption/decryption
   - `encryptMessage()` - Encrypts messages with AES-GCM
   - `decryptMessage()` - Decrypts received messages
   - Uses session keys from keyStorage

3. **`client/src/utils/keyExchange.js`** - Key exchange protocol
   - `performFullKeyExchange()` - Initiates key exchange (60s timeout - TOO SLOW)
   - `respondToIncomingKeyExchange()` - Responds to key exchange requests
   - **Issue**: 60 second timeout, slow polling, blocking

4. **`client/src/utils/keyStorage.js`** - Key storage in IndexedDB
   - `getSessionKey()` - Retrieves session key
   - `storeSessionKey()` - Stores session key
   - `getNextSequenceNumber()` - Gets sequence number for messages

### Server Side:
5. **`server/routes/messages.js`** - Message API endpoints
   - `POST /messages/send` - Send encrypted message
   - `GET /messages/conversation/:userId` - Get conversation
   - Uses Socket.io for real-time delivery

6. **`server/routes/keyExchange.js`** - Key exchange API endpoints
   - `POST /key-exchange/initiate` - Start key exchange
   - `POST /key-exchange/respond` - Respond to key exchange
   - `POST /key-exchange/complete` - Complete key exchange

## Current Flow (SLOW):

1. User types message → clicks send
2. `handleSendMessage()` checks for session key
3. If no session → calls `establishSession()`
4. `establishSession()` → `performFullKeyExchange()` (60s timeout!)
5. Waits for key exchange to complete
6. Then encrypts and sends message

## Problems:
- Key exchange blocks message sending
- 60 second timeout is too long
- No message queue while key exchange happens
- Session check happens every time

## Solution:
- Reduce timeout to 10s
- Make key exchange non-blocking
- Queue messages while key exchange happens
- Better session caching
- Optimize polling frequency

