const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const SecurityLog = require('../models/SecurityLog');
const router = express.Router();

// Helper function to log security events
const logSecurityEvent = async (eventType, userId, ipAddress, userAgent, details = {}, severity = 'INFO') => {
  try {
    await SecurityLog.create({
      eventType,
      userId,
      ipAddress,
      userAgent,
      details,
      severity
    });
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
};

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, password, publicKey } = req.body;

    if (!username || !password || !publicKey) {
      return res.status(400).json({ error: 'Username, password, and publicKey are required' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      await logSecurityEvent('AUTH_ATTEMPT', null, req.ip, req.get('user-agent'), 
        { username, reason: 'User already exists' }, 'WARNING');
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = await User.create({
      username,
      passwordHash,
      publicKey
    });

    await logSecurityEvent('AUTH_SUCCESS', user._id, req.ip, req.get('user-agent'), 
      { username }, 'INFO');

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'default-secret-change-in-production',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    await logSecurityEvent('AUTH_FAILURE', null, req.ip, req.get('user-agent'), 
      { error: error.message }, 'ERROR');
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Find user
    const user = await User.findOne({ username });
    if (!user) {
      await logSecurityEvent('AUTH_FAILURE', null, req.ip, req.get('user-agent'), 
        { username, reason: 'User not found' }, 'WARNING');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      await logSecurityEvent('AUTH_FAILURE', user._id, req.ip, req.get('user-agent'), 
        { username, reason: 'Invalid password' }, 'WARNING');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    await logSecurityEvent('AUTH_SUCCESS', user._id, req.ip, req.get('user-agent'), 
      { username }, 'INFO');

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET || 'default-secret-change-in-production',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        publicKey: user.publicKey
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    await logSecurityEvent('AUTH_FAILURE', null, req.ip, req.get('user-agent'), 
      { error: error.message }, 'ERROR');
    res.status(500).json({ error: 'Login failed' });
  }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Get current user info
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

module.exports = { router, authenticateToken };

