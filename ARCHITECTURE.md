# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (React)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   UI Layer   │  │  Crypto Utils │  │  Key Storage  │     │
│  │  (Components)│  │  (Web Crypto)│  │  (IndexedDB)  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                 │
│                   ┌────────▼────────┐                        │
│                   │   API Service   │                        │
│                   │     (Axios)     │                        │
│                   └────────┬────────┘                        │
└────────────────────────────┼─────────────────────────────────┘
                              │ HTTPS
                              │
┌─────────────────────────────▼─────────────────────────────────┐
│                    Server (Node.js/Express)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Routes     │  │  Middleware  │  │   Socket.io  │     │
│  │  (REST API)  │  │  (Auth/CORS) │  │  (Real-time) │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            │                                 │
│                   ┌────────▼────────┐                        │
│                   │   MongoDB       │                        │
│                   │  (Metadata)     │                        │
│                   └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Component Architecture

### Client-Side Components

#### 1. Authentication Components
- **Login.js**: User login interface
- **Register.js**: User registration with key generation

#### 2. Messaging Components
- **Chat.js**: Main chat interface
  - User search
  - Conversations list (all users you've messaged)
  - Message display with timestamps
  - File upload (all file types, up to 200MB)
  - Real-time updates via Socket.io
  - Profile modal (WhatsApp/Instagram style)
  - Online status indicators

#### 3. Cryptographic Utilities
- **crypto.js**: Web Crypto API wrappers
  - RSA key generation/encryption
  - ECC key generation
  - AES-GCM encryption/decryption
  - Digital signatures
  - Key derivation (HKDF)

- **keyStorage.js**: IndexedDB key management
  - Private key storage
  - Session key storage
  - Sequence number tracking

- **keyExchange.js**: Full key exchange protocol
  - ECDH key exchange (P-256)
  - RSA-PSS digital signatures
  - RSA-OAEP encryption for key exchange messages
  - HKDF session key derivation
  - Key confirmation with AES-GCM
  - Temporary ECDH key storage during exchange
  - Server message forwarding support

- **messageEncryption.js**: Message encryption
  - AES-GCM encryption
  - Replay protection
  - Timestamp verification

- **fileEncryption.js**: File encryption
  - Chunked encryption (256KB chunks)
  - File decryption
  - Blob creation
  - Original filename and MIME type preservation

#### 4. Services
- **api.js**: Axios-based API client
  - Request/response interceptors
  - Token management
  - Error handling

### Server-Side Components

#### 1. Models (MongoDB)
- **User**: User accounts and public keys
- **Message**: Encrypted messages (ciphertext only)
- **File**: Encrypted file metadata and chunks
- **Session**: Key exchange sessions
- **KeyExchange**: Key exchange state and messages
- **SecurityLog**: Security audit trail

#### 2. Routes
- **auth.js**: Authentication endpoints
  - POST /register
  - POST /login
  - GET /me

- **users.js**: User management
  - GET /search/:username
  - GET /:userId/public-key

- **messages.js**: Message handling
  - POST /send
  - GET /conversation/:otherUserId
  - GET /conversations (get all conversations)
  - POST /decryption-failure

- **files.js**: File handling
  - POST /upload
  - GET /download/:fileId
  - GET /:fileId

- **keyExchange.js**: Key exchange (full protocol)
  - POST /initiate (Step 1: Alice initiates)
  - POST /respond (Step 2: Bob responds)
  - POST /complete (Step 3: Alice completes)
  - GET /pending (get pending key exchanges)
  - GET /:keyExchangeId (get key exchange details)

- **logs.js**: Security logs
  - GET /
  - GET /event/:eventType

#### 3. Middleware
- **Helmet**: Security headers
- **CORS**: Cross-origin resource sharing
- **Rate Limiting**: Request throttling
- **Authentication**: JWT verification
- **Morgan**: HTTP request logging

## Data Flow

### Registration Flow
```
User → Register Component
  → Generate RSA Key Pair (Client)
  → Hash Password (Client)
  → Send (username, passwordHash, publicKey) to Server
  → Store Private Key in IndexedDB (Client)
  → Server stores (username, passwordHash, publicKey)
```

### Key Exchange Flow (Full Protocol)
```
Alice (Initiator):
  1. Generate ECDH Key Pair (P-256)
  2. Create key exchange message with ECDH public key
  3. Sign message with RSA-PSS private key
  4. Encrypt message with Bob's RSA-OAEP public key
  5. Send to Server → Server forwards to Bob

Bob (Responder):
  1. Receive encrypted initiation message
  2. Decrypt with RSA-OAEP private key
  3. Verify Alice's RSA-PSS signature
  4. Generate ECDH Key Pair (P-256)
  5. Derive shared secret using ECDH
  6. Create response with ECDH public key + shared secret hash
  7. Sign response with RSA-PSS private key
  8. Encrypt response with Alice's RSA-OAEP public key
  9. Send to Server → Server forwards to Alice

Alice (Completes):
  1. Receive encrypted response message
  2. Decrypt with RSA-OAEP private key
  3. Verify Bob's RSA-PSS signature
  4. Derive shared secret using ECDH
  5. Verify shared secret hash matches
  6. Derive AES session key using HKDF (SHA-256)
  7. Encrypt key confirmation with AES-GCM
  8. Send confirmation to Server → Server forwards to Bob

Bob (Finalizes):
  1. Receive encrypted confirmation
  2. Derive AES session key using HKDF (same as Alice)
  3. Decrypt and verify confirmation message
  4. Store session key in IndexedDB

Both parties now have established secure session!
```

### Message Sending Flow
```
User → Type Message
  → Get Session Key from IndexedDB
  → Encrypt with AES-256-GCM
  → Generate Nonce
  → Get Sequence Number
  → Send (ciphertext, iv, tag, nonce, sequenceNumber) to Server
  → Server stores ciphertext
  → Server notifies receiver via Socket.io
  → Receiver decrypts client-side
```

### File Sharing Flow
```
User → Select File (any type, up to 200MB)
  → Read File as ArrayBuffer
  → Split into 256KB Chunks
  → Encrypt each Chunk with AES-256-GCM
  → Generate unique nonce per file
  → Create chunks metadata (IV, tag, ciphertext per chunk)
  → Upload encrypted file + chunks metadata to Server
  → Server stores encrypted file and metadata
  → Server sends file notification message
  → Receiver receives notification via Socket.io
  → Receiver downloads encrypted file
  → Decrypt chunks client-side using session key
  → Reassemble file
  → Download decrypted file with original filename and MIME type
```

## Security Architecture

### Encryption Layers
1. **Transport Layer**: HTTPS/TLS
2. **Application Layer**: End-to-End Encryption
   - RSA for key exchange
   - AES-GCM for messages/files

### Key Management
- **Private Keys**: IndexedDB (client-only)
- **Public Keys**: MongoDB (server)
- **Session Keys**: IndexedDB (encrypted)
- **Shared Secrets**: IndexedDB (encrypted)

### Attack Mitigation
- **MITM**: Digital signatures in key exchange
- **Replay**: Nonces, timestamps, sequence numbers
- **Tampering**: AES-GCM authentication tags
- **Spoofing**: JWT tokens, password hashing
- **DoS**: Rate limiting, input validation

## Database Schema

### Users Collection
```javascript
{
  _id: ObjectId,
  username: String (unique),
  passwordHash: String (bcrypt),
  publicKey: String (Base64),
  createdAt: Date,
  lastLogin: Date
}
```

### Messages Collection
```javascript
{
  _id: ObjectId,
  senderId: ObjectId,
  receiverId: ObjectId,
  ciphertext: String (Base64),
  iv: String (Base64),
  tag: String (Base64),
  nonce: String (unique),
  sequenceNumber: Number,
  timestamp: Date,
  messageType: String ('text' | 'file')
}
```

### Files Collection
```javascript
{
  _id: ObjectId,
  senderId: ObjectId,
  receiverId: ObjectId,
  originalFilename: String,
  encryptedFilename: String,
  filePath: String,
  fileSize: Number,
  mimeType: String,
  chunks: [{
    chunkIndex: Number,
    ciphertext: String,
    iv: String,
    tag: String
  }],
  nonce: String (unique),
  timestamp: Date
}
```

### Sessions Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId,
  targetUserId: ObjectId,
  sessionKey: String (encrypted),
  sharedSecret: String (encrypted),
  establishedAt: Date,
  lastUsed: Date,
  isActive: Boolean,
  sequenceNumber: Number
}
```

### SecurityLogs Collection
```javascript
{
  _id: ObjectId,
  eventType: String,
  userId: ObjectId,
  targetUserId: ObjectId,
  ipAddress: String,
  userAgent: String,
  details: Object,
  timestamp: Date,
  severity: String ('INFO' | 'WARNING' | 'ERROR' | 'CRITICAL')
}
```

## Network Architecture

### Communication Protocols
- **HTTP/HTTPS**: REST API communication
- **WebSocket (Socket.io)**: Real-time messaging
- **TLS**: Transport layer security

### API Endpoints
```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

GET    /api/users/search/:username
GET    /api/users/:userId/public-key

POST   /api/messages/send
GET    /api/messages/conversation/:otherUserId
POST   /api/messages/decryption-failure

POST   /api/files/upload
GET    /api/files/download/:fileId
GET    /api/files/:fileId

POST   /api/key-exchange/initiate
POST   /api/key-exchange/respond
POST   /api/key-exchange/complete
GET    /api/key-exchange/pending
GET    /api/key-exchange/:keyExchangeId

GET    /api/messages/conversations

GET    /api/logs
GET    /api/logs/event/:eventType
```

## Deployment Architecture

### Development
```
Client (localhost:3002) ←→ Server (localhost:5001) ←→ MongoDB (localhost:27017)
```

### Production (Recommended)
```
┌─────────────┐
│   CDN/      │
│  Static     │  ← Client (React Build)
└─────────────┘

┌─────────────┐
│   Load      │
│  Balancer   │
└──────┬──────┘
       │
┌──────▼──────┐     ┌─────────────┐
│   Server    │────▶│   MongoDB   │
│  (Node.js)  │     │  (Replica   │
│             │     │   Set)      │
└─────────────┘     └─────────────┘
```

## Scalability Considerations

### Horizontal Scaling
- Stateless server design
- Session keys stored client-side
- MongoDB replica sets
- Load balancer for multiple servers

### Performance Optimization
- Database indexing on frequently queried fields
- Message pagination
- File chunking for large files
- Caching for public keys

### Security at Scale
- Distributed rate limiting
- Centralized logging
- Security event monitoring
- Regular key rotation

