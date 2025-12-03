const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for development
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'https://localhost:3000',
      'https://localhost:3001',
      'https://localhost:3002',
      process.env.CLIENT_URL
    ].filter(Boolean);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));
app.use(morgan('combined'));

// Rate limiting - Disabled for development, enable in production
if (process.env.NODE_ENV === 'production') {
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // limit each IP to 1000 requests per windowMs
  });

  // Apply rate limiting to most routes, but exclude key-exchange polling and health check
  app.use('/api/', (req, res, next) => {
    // Exclude key-exchange GET requests from rate limiting (polling)
    if (req.path.startsWith('/key-exchange/') && req.method === 'GET') {
      return next();
    }
    // Exclude health check
    if (req.path === '/health') {
      return next();
    }
    limiter(req, res, next);
  });
} else {
  // Development: No rate limiting
  console.log('Rate limiting disabled for development');
}

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/e2ee_messaging', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/users', require('./routes/users'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/files', require('./routes/files'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/key-exchange', require('./routes/keyExchange'));

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Secure E2EE Messaging API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      messages: '/api/messages',
      files: '/api/files',
      logs: '/api/logs',
      keyExchange: '/api/key-exchange'
    },
    frontend: process.env.CLIENT_URL || 'http://localhost:3002'
  });
});

// API root endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Secure E2EE Messaging API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        me: 'GET /api/auth/me'
      },
      users: {
        search: 'GET /api/users/search/:username',
        publicKey: 'GET /api/users/:userId/public-key'
      },
      messages: {
        send: 'POST /api/messages/send',
        conversation: 'GET /api/messages/conversation/:otherUserId',
        decryptionFailure: 'POST /api/messages/decryption-failure'
      },
      files: {
        upload: 'POST /api/files/upload',
        download: 'GET /api/files/download/:fileId',
        metadata: 'GET /api/files/:fileId'
      },
      keyExchange: {
        initiate: 'POST /api/key-exchange/initiate',
        complete: 'POST /api/key-exchange/complete'
      },
      logs: {
        all: 'GET /api/logs',
        byEvent: 'GET /api/logs/event/:eventType'
      }
    },
    documentation: 'See README.md for detailed API documentation'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Try to use HTTPS if certificates exist, otherwise fall back to HTTP
let server;
const certPath = path.join(__dirname, 'certs', 'cert.pem');
const keyPath = path.join(__dirname, 'certs', 'key.pem');

try {
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const options = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    server = https.createServer(options, app);
    server.listen(PORT, () => {
      console.log(`HTTPS Server running on port ${PORT}`);
    });
  } else {
    throw new Error('Certificates not found, using HTTP');
  }
} catch (error) {
  console.warn('HTTPS setup failed, using HTTP:', error.message);
  server = app.listen(PORT, () => {
    console.log(`HTTP Server running on port ${PORT}`);
  });
}

// Socket.io setup for real-time messaging
const io = require('socket.io')(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'https://localhost:3000',
        'https://localhost:3001',
        'https://localhost:3002',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
        'https://127.0.0.1:3000',
        'https://127.0.0.1:3001',
        'https://127.0.0.1:3002'
      ];
      
      if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
        callback(null, true);
      } else {
        callback(null, true); // Allow all for development, restrict in production
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  transports: ['websocket', 'polling'], // Try both
  pingTimeout: 60000,
  pingInterval: 25000
});

// Store user socket mappings
const userSockets = new Map(); // userId -> socketId

io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);

  socket.on('join-room', (userId) => {
    const userIdStr = String(userId);
    // FIX: Use underscore to match backend routes
    const roomName = `user_${userIdStr}`;
    socket.join(roomName);
    console.log(`✅ User ${userIdStr} joined room ${roomName}`);
    
    // Store mapping
    userSockets.set(userIdStr, socket.id);
    socket.userId = userIdStr; // Store on socket for later use
    
    console.log(`👤 User ${userIdStr} joined room: ${roomName}`);
    console.log(`   Socket ID: ${socket.id}`);
    console.log(`   Active users: ${userSockets.size}`);
    
    // Verify room membership
    const socketsInRoom = io.sockets.adapter.rooms.get(roomName);
    console.log(`   Total sockets in room: ${socketsInRoom ? socketsInRoom.size : 0}`);
  });
  
  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
    if (socket.userId) {
      userSockets.delete(socket.userId);
      console.log('👤 User', socket.userId, 'removed. Active users:', userSockets.size);
    }
  });

  socket.on('message-sent', (data) => {
    console.log('Message sent event received:', data);
    // Forward to receiver if needed - FIX: Use underscore to match join-room
    if (data.receiverId) {
      io.to(`user_${data.receiverId}`).emit('new-message', {
        messageId: data.messageId,
        senderId: data.senderId
      });
    }
  });
});

// Export io for use in routes
app.set('io', io);

module.exports = app;

