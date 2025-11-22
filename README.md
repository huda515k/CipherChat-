# Secure End-to-End Encrypted Messaging & File-Sharing System

A comprehensive Information Security project implementing end-to-end encryption (E2EE) for secure messaging and file sharing.

## Project Overview

This system provides:
- **End-to-End Encryption**: Messages and files are encrypted client-side and never exist in plaintext on the server
- **Hybrid Cryptography**: Combines RSA (asymmetric) and AES-GCM (symmetric) encryption
- **Custom Key Exchange Protocol**: ECDH-based key exchange with digital signatures
- **Replay Attack Protection**: Nonces, timestamps, and sequence numbers
- **MITM Attack Prevention**: Digital signatures in key exchange
- **Security Auditing**: Comprehensive logging of security events

## Architecture

### System Components

```
┌─────────────┐         ┌─────────────┐
│   Client    │◄───────►│   Server    │
│  (React)    │  HTTPS  │ (Node.js)   │
└─────────────┘         └─────────────┘
     │                        │
     │                        │
     ▼                        ▼
┌─────────────┐         ┌─────────────┐
│ IndexedDB   │         │  MongoDB    │
│ (Keys)      │         │ (Metadata)  │
└─────────────┘         └─────────────┘
```

### Key Exchange Protocol Flow

```
Alice                          Server                          Bob
  │                              │                              │
  │ 1. Generate ECDH Key Pair    │                              │
  │ 2. Sign with RSA Private Key │                              │
  │ 3. Encrypt with Bob's RSA    │                              │
  │─── Key Exchange Init ────────►│                              │
  │                              │─── Forward ─────────────────►│
  │                              │                              │
  │                              │ 1. Decrypt & Verify Sig      │
  │                              │ 2. Generate ECDH Key Pair    │
  │                              │ 3. Derive Shared Secret       │
  │                              │ 4. Sign & Encrypt Response    │
  │                              │◄── Key Exchange Response ────│
  │◄── Response ─────────────────│                              │
  │                              │                              │
  │ 1. Verify Signature          │                              │
  │ 2. Derive Shared Secret       │                              │
  │ 3. Verify Secret Hash        │                              │
  │ 4. Derive Session Key (HKDF) │                              │
  │ 5. Encrypt Confirmation      │                              │
  │─── Key Confirmation ─────────►│                              │
  │                              │─── Forward ─────────────────►│
  │                              │                              │
  │                              │ 1. Derive Session Key         │
  │                              │ 2. Verify Confirmation        │
  │                              │◄── Confirmed ─────────────│
  │◄── Confirmed ────────────────│                              │
  │                              │                              │
  │◄──────────────── Encrypted Messages ───────────────────────►│
```

## Technology Stack

### Frontend
- **React.js** - UI framework
- **Web Crypto API** - Cryptographic operations
- **IndexedDB** - Secure key storage
- **Socket.io Client** - Real-time messaging
- **Axios** - HTTP client

### Backend
- **Node.js + Express** - Server framework
- **MongoDB + Mongoose** - Database
- **Socket.io** - Real-time communication
- **bcrypt** - Password hashing
- **JWT** - Authentication tokens

## Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (running locally or connection string)
- npm or yarn

### Step 1: Clone Repository
```bash
git clone <repository-url>
cd InfoSec_Project
```

### Step 2: Install Dependencies
```bash
# Install root dependencies
npm install

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Step 3: Configure Environment
Create `.env` file in `server/` directory:
```env
PORT=5001
MONGODB_URI=mongodb://localhost:27017/e2ee_messaging
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
CLIENT_URL=http://localhost:3002
NODE_ENV=development
```

Create `.env` file in `client/` directory (optional):
```env
PORT=3002
REACT_APP_API_URL=http://localhost:5001/api
REACT_APP_SOCKET_URL=http://localhost:5001
```

### Step 4: Start MongoDB
```bash
# If using local MongoDB
mongod
```

### Step 5: Run Application
```bash
# From root directory
npm run dev

# Or run separately:
# Terminal 1 - Server
cd server
npm start

# Terminal 2 - Client
cd client
npm start
```

### Step 6: Access Application
- Frontend: http://localhost:3002
- Backend API: http://localhost:5001

## Usage

### 1. User Registration
1. Navigate to `/register`
2. Enter username and password
3. System generates RSA key pair automatically
4. Private key is stored locally in IndexedDB (never sent to server)

### 2. User Login
1. Navigate to `/login`
2. Enter credentials
3. System loads private key from IndexedDB

### 3. Start a Conversation
1. Search for a user by username
2. System automatically performs key exchange
3. Session key is established for encrypted communication

### 4. Send Encrypted Messages
1. Type message in chat interface
2. Message is encrypted client-side with AES-256-GCM
3. Only ciphertext, IV, and tag are sent to server
4. Receiver decrypts message client-side

### 5. Share Encrypted Files
1. Click file attachment button
2. File is encrypted and split into 256KB chunks
3. Encrypted chunks are uploaded to server (max 200MB)
4. Receiver downloads and decrypts file locally
5. All file types supported (images, videos, documents, etc.)

### 6. View Conversations
- All conversations appear in the left sidebar
- Click any conversation to open that chat
- Conversations list updates automatically

### 7. View User Profile
- Click "View Profile" button in chat header
- Modal displays username and online status
- Profile information shown in WhatsApp/Instagram style

## Security Features

### 1. End-to-End Encryption
- All encryption/decryption happens client-side
- Server only stores ciphertext
- Private keys never leave the client device

### 2. Key Exchange Protocol (Full Implementation)
- **ECDH P-256** for shared secret derivation
- **RSA-PSS** digital signatures for authenticity
- **RSA-OAEP** encryption for key exchange messages
- **HKDF (SHA-256)** for session key derivation
- **Key confirmation** messages with AES-GCM encryption
- **Server message forwarding** for key exchange
- **Real-time notifications** via Socket.io
- **MITM attack prevention** through signature verification

### 3. Replay Attack Protection
- **Nonces**: Unique identifier for each message
- **Timestamps**: Messages expire after 5 minutes
- **Sequence Numbers**: Ensure message order

### 4. MITM Attack Prevention
- Digital signatures in key exchange
- Public key verification
- Signature validation

### 5. Security Logging
All security events are logged:
- Authentication attempts
- Key exchange events
- Decryption failures
- Replay attack detections
- Invalid signatures
- Metadata access

## Attack Demonstrations

### MITM Attack Demo
```bash
node attacks/mitm-attack.js
```

This demonstrates:
- How MITM attacks work without signatures
- How digital signatures prevent MITM attacks

### Replay Attack Demo
```bash
node attacks/replay-attack.js
```

This demonstrates:
- How replay attacks work
- How nonces prevent replay attacks
- How timestamps prevent replay attacks
- How sequence numbers prevent replay attacks

## Project Structure

```
InfoSec_Project/
├── client/                 # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── utils/         # Crypto utilities
│   │   ├── services/      # API services
│   │   └── App.js
│   └── package.json
├── server/                 # Node.js backend
│   ├── models/           # MongoDB models
│   ├── routes/           # API routes
│   ├── uploads/          # Encrypted file storage
│   ├── index.js
│   └── package.json
├── attacks/              # Attack demonstration scripts
│   ├── mitm-attack.js
│   └── replay-attack.js
├── README.md
└── package.json
```

## Cryptographic Design

### Key Generation
- **RSA-2048**: For key exchange and digital signatures
- **ECDH P-256**: For shared secret derivation
- **AES-256-GCM**: For message and file encryption

### Encryption Flow
1. User generates RSA key pair on registration
2. Public key stored on server, private key in IndexedDB
3. Key exchange establishes shared secret via ECDH
4. Session key derived using HKDF
5. Messages encrypted with AES-256-GCM
6. Each message has unique IV and authentication tag

### Key Storage
- **Private Keys**: IndexedDB (client-side only)
- **Session Keys**: IndexedDB (encrypted)
- **Public Keys**: MongoDB (server)

## Threat Modeling (STRIDE)

### Spoofing
- **Threat**: Attacker impersonates legitimate user
- **Mitigation**: Password hashing (bcrypt), JWT tokens

### Tampering
- **Threat**: Message modification in transit
- **Mitigation**: AES-GCM authentication tags, digital signatures

### Repudiation
- **Threat**: User denies sending message
- **Mitigation**: Digital signatures, security logs

### Information Disclosure
- **Threat**: Unauthorized access to messages
- **Mitigation**: E2EE, private keys never leave client

### Denial of Service
- **Threat**: Server overload
- **Mitigation**: Rate limiting, input validation

### Elevation of Privilege
- **Threat**: Unauthorized access to admin functions
- **Mitigation**: Authentication middleware, role-based access

## Testing

### Manual Testing
1. Register two users
2. Establish key exchange
3. Send encrypted messages
4. Upload encrypted files
5. Verify decryption works
6. Test replay attack detection
7. Check security logs

### Attack Testing
1. Run MITM attack script
2. Run replay attack script
3. Verify protection mechanisms work

## Limitations & Future Improvements

### Current Limitations
- No message history persistence beyond current session
- No group messaging
- No key rotation
- No perfect forward secrecy
- Online status based on lastLogin (not real-time presence)

### Future Improvements
- Real-time presence detection
- Message history with pagination
- Implement group messaging
- Add key rotation mechanism
- Implement perfect forward secrecy
- Add two-factor authentication
- Add message deletion/editing
- Implement key backup/recovery
- Message read receipts
- Typing indicators

## Security Considerations

⚠️ **Important**: This is an educational project. For production use:
- Use established E2EE libraries (Signal Protocol, etc.)
- Implement proper key management
- Add perfect forward secrecy
- Implement key rotation
- Use certificate pinning
- Regular security audits
- Penetration testing

## Contributors

- [Team Member 1]
- [Team Member 2]
- [Team Member 3]

## License

This project is for educational purposes only.

## References

- Web Crypto API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
- AES-GCM: NIST SP 800-38D
- RSA-OAEP: PKCS #1 v2.1
- ECDH: NIST SP 800-56A
- HKDF: RFC 5869

