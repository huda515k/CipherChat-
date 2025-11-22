const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

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

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Socket.io setup for real-time messaging
const io = require('socket.io')(server, {
  cors: {
    origin: process.env.CLIENT_URL || ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'],
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined their room: user-${userId}`);
  });

  socket.on('message-sent', (data) => {
    console.log('Message sent event received:', data);
    // Forward to receiver if needed
    if (data.receiverId) {
      io.to(`user-${data.receiverId}`).emit('new-message', {
        messageId: data.messageId,
        senderId: data.senderId
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Export io for use in routes
app.set('io', io);

module.exports = app;

