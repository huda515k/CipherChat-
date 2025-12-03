const express = require('express');
const User = require('../models/User');
const SecurityLog = require('../models/SecurityLog');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get user by username (for finding users to message)
router.get('/search/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log(`🔍 Searching for user: "${username}"`);
    
    // Try exact match first
    let user = await User.findOne({ username })
      .select('username publicKey _id')
      .lean();
    
    // If not found, try case-insensitive search
    if (!user) {
      console.log(`   Exact match not found, trying case-insensitive...`);
      user = await User.findOne({ 
        username: { $regex: new RegExp(`^${username}$`, 'i') }
      })
      .select('username publicKey _id')
      .lean();
    }
    
    // If still not found, list all users for debugging
    if (!user) {
      const allUsers = await User.find({}).select('username _id').lean();
      console.log(`   User not found. Available users:`, allUsers.map(u => u.username));
      return res.status(404).json({ 
        error: 'User not found',
        availableUsers: allUsers.map(u => u.username)
      });
    }
    
    console.log(`✅ Found user: ${user.username} (${user._id})`);

    // Log metadata access
    await SecurityLog.create({
      eventType: 'METADATA_ACCESS',
      userId: req.user.userId,
      targetUserId: user._id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { action: 'user_search', searchedUsername: username },
      severity: 'INFO'
    });

    res.json({
      id: user._id,
      username: user.username,
      publicKey: user.publicKey
    });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search user' });
  }
});

// Get public key of a user
router.get('/:userId/public-key', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('publicKey username').lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log metadata access
    await SecurityLog.create({
      eventType: 'METADATA_ACCESS',
      userId: req.user.userId,
      targetUserId: userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { action: 'public_key_fetch' },
      severity: 'INFO'
    });

    res.json({
      userId: user._id,
      username: user.username,
      publicKey: user.publicKey
    });
  } catch (error) {
    console.error('Public key fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch public key' });
  }
});

module.exports = router;

