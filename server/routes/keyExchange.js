const express = require('express');
const SecurityLog = require('../models/SecurityLog');
const Session = require('../models/Session');
const KeyExchange = require('../models/KeyExchange');
const User = require('../models/User');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Initiate key exchange (Step 1: Alice sends to Bob)
router.post('/initiate', async (req, res) => {
  try {
    const { targetUserId, encrypted, signature, ecdhPublicKey } = req.body;

    if (!targetUserId || !encrypted || !signature || !ecdhPublicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: 'Target user not found' });
    }

    // Store key exchange request
    const keyExchange = await KeyExchange.create({
      initiatorId: req.user.userId,
      responderId: targetUserId,
      encryptedInit: encrypted,
      initSignature: signature,
      initiatorECDHPublicKey: ecdhPublicKey,
      status: 'PENDING'
    });

    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_INITIATED',
      userId: req.user.userId,
      targetUserId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { keyExchangeId: keyExchange._id, action: 'initiate' },
      severity: 'INFO'
    });

    // Notify target user via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${targetUserId}`).emit('key-exchange-init', {
        keyExchangeId: keyExchange._id,
        initiatorId: req.user.userId,
        encrypted,
        signature,
        ecdhPublicKey
      });
    }

    res.json({ 
      message: 'Key exchange initiated',
      keyExchangeId: keyExchange._id
    });
  } catch (error) {
    console.error('Key exchange initiation error:', error);
    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_FAILED',
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { error: error.message },
      severity: 'ERROR'
    });
    res.status(500).json({ error: 'Failed to initiate key exchange' });
  }
});

// Respond to key exchange (Step 2: Bob responds to Alice)
router.post('/respond', async (req, res) => {
  try {
    const { keyExchangeId, encrypted, signature, ecdhPublicKey } = req.body;

    if (!keyExchangeId || !encrypted || !signature || !ecdhPublicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find key exchange request
    const keyExchange = await KeyExchange.findById(keyExchangeId);
    if (!keyExchange) {
      return res.status(404).json({ error: 'Key exchange not found' });
    }

    if (keyExchange.responderId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized to respond to this key exchange' });
    }

    if (keyExchange.status !== 'PENDING') {
      return res.status(400).json({ error: 'Key exchange already processed' });
    }

    // Update with response
    keyExchange.encryptedResponse = encrypted;
    keyExchange.responseSignature = signature;
    keyExchange.responderECDHPublicKey = ecdhPublicKey;
    keyExchange.status = 'RESPONDED';
    await keyExchange.save();

    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_RESPONDED',
      userId: req.user.userId,
      targetUserId: keyExchange.initiatorId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { keyExchangeId: keyExchange._id, action: 'respond' },
      severity: 'INFO'
    });

    // Notify initiator via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${keyExchange.initiatorId}`).emit('key-exchange-response', {
        keyExchangeId: keyExchange._id,
        encrypted,
        signature,
        ecdhPublicKey
      });
    }

    res.json({ 
      message: 'Key exchange response sent',
      keyExchangeId: keyExchange._id
    });
  } catch (error) {
    console.error('Key exchange response error:', error);
    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_FAILED',
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { error: error.message },
      severity: 'ERROR'
    });
    res.status(500).json({ error: 'Failed to respond to key exchange' });
  }
});

// Complete key exchange (Step 3: Alice completes and sends confirmation)
router.post('/complete', async (req, res) => {
  try {
    const { keyExchangeId, encryptedConfirmation, iv, tag } = req.body;

    if (!keyExchangeId || !encryptedConfirmation || !iv || !tag) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find key exchange
    const keyExchange = await KeyExchange.findById(keyExchangeId);
    if (!keyExchange) {
      return res.status(404).json({ error: 'Key exchange not found' });
    }

    if (keyExchange.initiatorId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized to complete this key exchange' });
    }

    if (keyExchange.status !== 'RESPONDED') {
      return res.status(400).json({ error: 'Key exchange not in correct state' });
    }

    // Update with confirmation
    keyExchange.encryptedConfirmation = encryptedConfirmation;
    keyExchange.confirmationIV = iv;
    keyExchange.confirmationTag = tag;
    keyExchange.status = 'COMPLETED';
    keyExchange.completedAt = new Date();
    await keyExchange.save();

    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_COMPLETED',
      userId: req.user.userId,
      targetUserId: keyExchange.responderId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { keyExchangeId: keyExchange._id, action: 'complete' },
      severity: 'INFO'
    });

    // Notify responder via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${keyExchange.responderId}`).emit('key-exchange-complete', {
        keyExchangeId: keyExchange._id,
        encryptedConfirmation,
        iv,
        tag
      });
    }

    res.json({ 
      message: 'Key exchange completed',
      keyExchangeId: keyExchange._id
    });
  } catch (error) {
    console.error('Key exchange completion error:', error);
    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_FAILED',
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { error: error.message },
      severity: 'ERROR'
    });
    res.status(500).json({ error: 'Failed to complete key exchange' });
  }
});

// Get pending key exchange requests
router.get('/pending', async (req, res) => {
  try {
    const pendingExchanges = await KeyExchange.find({
      responderId: req.user.userId,
      status: 'PENDING'
    }).populate('initiatorId', 'username');

    res.json({ pendingExchanges });
  } catch (error) {
    console.error('Error fetching pending exchanges:', error);
    res.status(500).json({ error: 'Failed to fetch pending exchanges' });
  }
});

// Get key exchange details
router.get('/:keyExchangeId', async (req, res) => {
  try {
    const keyExchange = await KeyExchange.findById(req.params.keyExchangeId);
    
    if (!keyExchange) {
      return res.status(404).json({ error: 'Key exchange not found' });
    }

    // Check authorization
    if (keyExchange.initiatorId.toString() !== req.user.userId.toString() &&
        keyExchange.responderId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({
      keyExchange: {
        _id: keyExchange._id,
        initiatorId: keyExchange.initiatorId,
        responderId: keyExchange.responderId,
        status: keyExchange.status,
        createdAt: keyExchange.createdAt,
        completedAt: keyExchange.completedAt,
        // Only return encrypted data, not decrypted
        encryptedInit: keyExchange.encryptedInit,
        initSignature: keyExchange.initSignature,
        initiatorECDHPublicKey: keyExchange.initiatorECDHPublicKey,
        encryptedResponse: keyExchange.encryptedResponse,
        responseSignature: keyExchange.responseSignature,
        responderECDHPublicKey: keyExchange.responderECDHPublicKey,
        encryptedConfirmation: keyExchange.encryptedConfirmation,
        confirmationIV: keyExchange.confirmationIV,
        confirmationTag: keyExchange.confirmationTag
      }
    });
  } catch (error) {
    console.error('Error fetching key exchange:', error);
    res.status(500).json({ error: 'Failed to fetch key exchange' });
  }
});

module.exports = router;

