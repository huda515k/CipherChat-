const express = require('express');
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const Session = require('../models/Session');
const SecurityLog = require('../models/SecurityLog');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Send encrypted message
router.post('/send', async (req, res) => {
  try {
    const { receiverId, ciphertext, iv, tag, nonce, sequenceNumber, messageType } = req.body;

    // Check which fields are missing for better error messages
    const missingFields = [];
    if (!receiverId) missingFields.push('receiverId');
    if (!ciphertext) missingFields.push('ciphertext');
    if (!iv) missingFields.push('iv');
    if (!tag) missingFields.push('tag');
    if (!nonce) missingFields.push('nonce');
    if (sequenceNumber === undefined || sequenceNumber === null) missingFields.push('sequenceNumber');

    if (missingFields.length > 0) {
      console.error('Missing fields:', missingFields);
      console.error('Received body:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({ 
        error: 'Missing required fields',
        missingFields: missingFields
      });
    }

    // Check for replay attack (nonce must be unique)
    const existingMessage = await Message.findOne({ nonce });
    if (existingMessage) {
      await SecurityLog.create({
        eventType: 'REPLAY_ATTACK_DETECTED',
        userId: req.user.userId,
        targetUserId: receiverId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        details: { nonce, reason: 'Duplicate nonce detected' },
        severity: 'CRITICAL'
      });
      return res.status(400).json({ error: 'Replay attack detected: duplicate nonce' });
    }

    // Create message
    const message = await Message.create({
      senderId: req.user.userId,
      receiverId,
      ciphertext,
      iv,
      tag,
      nonce,
      sequenceNumber,
      messageType: messageType || 'text',
      timestamp: new Date()
    });

    // Update session sequence number
    await Session.findOneAndUpdate(
      { userId: req.user.userId, targetUserId: receiverId },
      { $inc: { sequenceNumber: 1 }, lastUsed: new Date() }
    );

    // Emit real-time message to receiver via Socket.io
    const io = req.app.get('io');
    if (io) {
      console.log(`Emitting new-message to user_${receiverId}`);
      io.to(`user_${receiverId}`).emit('new-message', {
        messageId: message._id,
        senderId: req.user.userId,
        receiverId: receiverId,
        timestamp: message.timestamp,
        messageType: message.messageType
      });
    } else {
      console.warn('Socket.io not available for message notification');
    }

    res.status(201).json({
      messageId: message._id,
      timestamp: message.timestamp
    });
  } catch (error) {
    console.error('Send message error:', error);
    if (error.code === 11000) {
      // Duplicate key error (nonce)
      await SecurityLog.create({
        eventType: 'REPLAY_ATTACK_DETECTED',
        userId: req.user.userId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        details: { error: 'Duplicate nonce', reason: error.message },
        severity: 'CRITICAL'
      });
      return res.status(400).json({ error: 'Replay attack detected' });
    }
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get messages between current user and another user
router.get('/conversation/:otherUserId', async (req, res) => {
  try {
    const { otherUserId } = req.params;
    const userId = req.user.userId;

    const messages = await Message.find({
      $or: [
        { senderId: userId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: userId }
      ]
    })
    .sort({ timestamp: 1 })
    .select('senderId receiverId ciphertext iv tag timestamp nonce sequenceNumber messageType')
    .lean();

    // Log metadata access
    await SecurityLog.create({
      eventType: 'METADATA_ACCESS',
      userId,
      targetUserId: otherUserId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { action: 'fetch_conversation', messageCount: messages.length },
      severity: 'INFO'
    });

    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get all conversations for current user
router.get('/conversations', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all unique users the current user has messaged with
    const conversations = await Message.aggregate([
      {
        $match: {
          $or: [
            { senderId: new mongoose.Types.ObjectId(userId) },
            { receiverId: new mongoose.Types.ObjectId(userId) }
          ]
        }
      },
      {
        $project: {
          otherUserId: {
            $cond: [
              { $eq: ['$senderId', new mongoose.Types.ObjectId(userId)] },
              '$receiverId',
              '$senderId'
            ]
          },
          lastMessageTime: '$timestamp'
        }
      },
      {
        $group: {
          _id: '$otherUserId',
          lastMessageTime: { $max: '$lastMessageTime' }
        }
      },
      {
        $sort: { lastMessageTime: -1 }
      }
    ]);

    // Get user details for each conversation
    const conversationList = await Promise.all(
      conversations.map(async (conv) => {
        const otherUser = await User.findById(conv._id).select('username _id lastLogin');
        if (!otherUser) return null;
        
        return {
          userId: otherUser._id,
          username: otherUser.username,
          lastMessageTime: conv.lastMessageTime,
          isOnline: otherUser.lastLogin && (Date.now() - new Date(otherUser.lastLogin).getTime() < 5 * 60 * 1000) // Online if last login < 5 min ago
        };
      })
    );

    // Filter out null values
    const validConversations = conversationList.filter(conv => conv !== null);

    res.json(validConversations);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Report decryption failure (for security logging)
router.post('/decryption-failure', async (req, res) => {
  try {
    const { messageId, reason } = req.body;

    await SecurityLog.create({
      eventType: 'MESSAGE_DECRYPTION_FAILED',
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { messageId, reason: reason || 'Unknown' },
      severity: 'ERROR'
    });

    res.json({ message: 'Decryption failure logged' });
  } catch (error) {
    console.error('Log decryption failure error:', error);
    res.status(500).json({ error: 'Failed to log decryption failure' });
  }
});

module.exports = router;

