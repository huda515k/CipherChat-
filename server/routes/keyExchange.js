const express = require('express');
const SecurityLog = require('../models/SecurityLog');
const Session = require('../models/Session');
const KeyExchange = require('../models/KeyExchange');
const User = require('../models/User');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Helper: Parse encrypted data safely (handles both string and object)
function parseEncryptedData(data) {
  if (!data) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data; // Return as-is if not JSON
    }
  }
  // Already an object (Mixed type)
  return data;
}

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

    console.log('🔵 KEY EXCHANGE INITIATED');
    console.log('   Initiator:', req.user.userId);
    console.log('   Target:', targetUserId);
    console.log('   Encrypted type:', typeof encrypted);
    console.log('   Encrypted length:', encrypted?.length || 0);
    
    // Parse encrypted data if it's a string (will be stored as Mixed type)
    const encryptedData = parseEncryptedData(encrypted);
    
    // Validate encryptedKey length BEFORE saving
    if (encryptedData && encryptedData.encryptedKey) {
      console.log('   encryptedKey length:', encryptedData.encryptedKey.length);
      if (encryptedData.encryptedKey.length < 300) {
        console.error('❌ encryptedKey too short before saving!');
        return res.status(400).json({ 
          error: 'Invalid encrypted data - encryptedKey too short' 
        });
      }
      console.log('✅ encryptedKey validated before save');
    }
    
    // Store key exchange request (Mixed type will store as object)
    const keyExchange = await KeyExchange.create({
      initiatorId: req.user.userId,
      responderId: targetUserId,
      encryptedInit: encryptedData, // Store as Mixed type (object)
      initSignature: signature,
      initiatorECDHPublicKey: ecdhPublicKey,
      status: 'PENDING'
    });
    
    // CRITICAL: Verify data after save
    const saved = await KeyExchange.findById(keyExchange._id);
    const savedEncrypted = parseEncryptedData(saved.encryptedInit);
    
    if (savedEncrypted && savedEncrypted.encryptedKey) {
      console.log('   Verified encryptedKey length after save:', savedEncrypted.encryptedKey.length);
      if (savedEncrypted.encryptedKey.length < 300) {
        console.error('❌ DATA TRUNCATED AFTER SAVE!');
        await KeyExchange.findByIdAndDelete(keyExchange._id);
        return res.status(500).json({ 
          error: 'Database truncated encrypted data. Schema needs to be updated.' 
        });
      }
      console.log('✅ encryptedKey verified after save');
    }
    
    console.log('✅ Key exchange saved:', keyExchange._id);

    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_INITIATED',
      userId: req.user.userId,
      targetUserId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { keyExchangeId: keyExchange._id, action: 'initiate' },
      severity: 'INFO'
    });

    // Notify target user via Socket.io IMMEDIATELY - FIX: Use underscore to match join-room
    const io = req.app.get('io');
    if (io) {
      const roomName = `user_${targetUserId}`;
      console.log(`📤📤📤 EMITTING KEY-EXCHANGE-INIT 📤📤📤`);
      console.log(`   Room: ${roomName}`);
      console.log(`   Key exchange ID: ${keyExchange._id}`);
      console.log(`   Initiator ID: ${req.user.userId}`);
      console.log(`   Target user ID: ${targetUserId}`);
      
      // Check if anyone is in the room
      const socketsInRoom = io.sockets.adapter.rooms.get(roomName);
      const socketCount = socketsInRoom ? socketsInRoom.size : 0;
      console.log(`   Sockets in room: ${socketCount}`);
      
      if (socketCount === 0) {
        console.warn(`⚠️ WARNING: No sockets in room ${roomName}! Responder is not connected!`);
        console.warn(`   Key exchange will be available via polling when responder connects`);
      }
      
      const eventData = {
        keyExchangeId: keyExchange._id.toString(),
        initiatorId: req.user.userId.toString(),
        encrypted,
        signature,
        ecdhPublicKey
      };
      
      // Emit to room (will be received when user connects)
      io.to(roomName).emit('key-exchange-init', eventData);
      console.log(`✅ Key exchange event emitted to ${roomName}`);
    } else {
      console.error('❌ Socket.io not available!');
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
    console.log('📥📥📥 KEY EXCHANGE RESPONSE RECEIVED 📥📥📥');
    console.log('   Request body:', JSON.stringify(req.body, null, 2));
    const { keyExchangeId, encrypted, signature, ecdhPublicKey } = req.body;

    if (!keyExchangeId || !encrypted || !signature || !ecdhPublicKey) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Find key exchange request
    const keyExchange = await KeyExchange.findById(keyExchangeId);
    if (!keyExchange) {
      return res.status(404).json({ error: 'Key exchange not found' });
    }
    
    // CRITICAL: Log the encryptedResponse details to debug truncation
    if (keyExchange.encryptedResponse) {
      console.log('📊 encryptedResponse details:');
      console.log('   Type:', typeof keyExchange.encryptedResponse);
      // Only access .length if it's a string
      if (typeof keyExchange.encryptedResponse === 'string') {
        console.log('   Length:', keyExchange.encryptedResponse.length);
        try {
          const parsed = JSON.parse(keyExchange.encryptedResponse);
          if (parsed.encryptedKey) {
            console.log('   encryptedKey length:', parsed.encryptedKey.length);
            console.log('   encryptedKey first 100:', parsed.encryptedKey.substring(0, 100));
            console.log('   encryptedKey last 100:', parsed.encryptedKey.substring(Math.max(0, parsed.encryptedKey.length - 100)));
          }
        } catch (e) {
          // Not JSON
        }
      } else {
        console.log('   encryptedResponse is an object (Mixed type)');
      }
    }

    if (keyExchange.responderId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: 'Not authorized to respond to this key exchange' });
    }

    if (keyExchange.status !== 'PENDING') {
      return res.status(400).json({ error: 'Key exchange already processed' });
    }

    // CRITICAL: Validate encrypted data before storing
    let encryptedKeyLength = 0;
    try {
      const parsed = JSON.parse(encrypted);
      if (parsed.encryptedKey && typeof parsed.encryptedKey === 'string') {
        encryptedKeyLength = parsed.encryptedKey.length;
        if (encryptedKeyLength < 300) {
          console.error(`❌ CRITICAL: encryptedKey is too short before storage!`);
          console.error(`   Length: ${encryptedKeyLength} (expected ~344)`);
          return res.status(400).json({ error: 'Invalid encrypted data: encryptedKey too short' });
        }
      }
    } catch (e) {
      // Not JSON, that's OK for direct RSA
    }
    
    // Parse encrypted data if it's a string (will be stored as Mixed type)
    const encryptedData = parseEncryptedData(encrypted);
    
    // Validate before saving
    if (encryptedData && encryptedData.encryptedKey) {
      console.log('   encryptedKey length:', encryptedData.encryptedKey.length);
      if (encryptedData.encryptedKey.length < 300) {
        console.error('❌ encryptedKey too short!');
        return res.status(400).json({ 
          error: 'Invalid encrypted data' 
        });
      }
      console.log('✅ encryptedKey validated before save');
    }
    
    // Update with response (Mixed type will store as object)
    keyExchange.encryptedResponse = encryptedData;
    keyExchange.responseSignature = signature;
    keyExchange.responderECDHPublicKey = ecdhPublicKey;
    keyExchange.status = 'RESPONDED';
    await keyExchange.save();
    
    // Verify after save (Mixed type is stored as object)
    const verified = await KeyExchange.findById(keyExchangeId);
    const verifiedEncrypted = parseEncryptedData(verified.encryptedResponse);
    
    if (verifiedEncrypted && verifiedEncrypted.encryptedKey) {
      console.log('   Verified encryptedKey after save:', verifiedEncrypted.encryptedKey.length);
      if (verifiedEncrypted.encryptedKey.length < 300) {
        console.error('❌ DATA TRUNCATED AFTER SAVE!');
        // Revert
        verified.status = 'PENDING';
        verified.encryptedResponse = undefined;
        verified.responseSignature = undefined;
        verified.responderECDHPublicKey = undefined;
        await verified.save();
        return res.status(500).json({ 
          error: 'Database truncated encrypted data. Please try again.' 
        });
      }
      console.log('✅ encryptedKey verified after save');
    }
    
    console.log('✅ Key exchange updated');

    await SecurityLog.create({
      eventType: 'KEY_EXCHANGE_RESPONDED',
      userId: req.user.userId,
      targetUserId: keyExchange.initiatorId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { keyExchangeId: keyExchange._id, action: 'respond' },
      severity: 'INFO'
    });

    // CRITICAL: Emit to BOTH users' socket rooms
    const io = req.app.get('io');
    if (io) {
      // Emit to initiator (they're waiting for this) - FIX: Use underscore to match join-room
      const initiatorRoom = `user_${keyExchange.initiatorId}`;
      console.log(`📤 Emitting key-exchange-response to room: ${initiatorRoom}`);
      console.log(`   Key exchange ID: ${keyExchange._id}`);
      console.log(`   Responder ID: ${req.user.userId}`);
      console.log(`   Initiator ID: ${keyExchange.initiatorId}`);
      
      // Use verified data (already parsed from Mixed type)
      // Convert to JSON string if it's an object (Mixed type)
      let encryptedForEmit = verifiedEncrypted;
      if (encryptedForEmit && typeof encryptedForEmit === 'object') {
        encryptedForEmit = JSON.stringify(encryptedForEmit);
      } else if (!encryptedForEmit && verified.encryptedResponse) {
        // Fallback: if verifiedEncrypted is null, use verified.encryptedResponse
        if (typeof verified.encryptedResponse === 'object') {
          encryptedForEmit = JSON.stringify(verified.encryptedResponse);
        } else {
          encryptedForEmit = verified.encryptedResponse;
        }
      }
      
      io.to(initiatorRoom).emit('key-exchange-response', {
        keyExchangeId: keyExchange._id.toString(),
        encrypted: encryptedForEmit, // Always a JSON string
        signature: verified.responseSignature,
        ecdhPublicKey: verified.responderECDHPublicKey
      });
      
      // Also emit to responder for confirmation
      io.to(`user_${req.user.userId}`).emit('key-exchange-update', {
        keyExchangeId: keyExchange._id.toString(),
        status: 'RESPONDED'
      });
      
      // Check if initiator is in the room
      const socketsInRoom = io.sockets.adapter.rooms.get(initiatorRoom);
      const socketCount = socketsInRoom ? socketsInRoom.size : 0;
      console.log(`   Sockets in room: ${socketCount}`);
      
      if (socketCount === 0) {
        console.warn(`⚠️ WARNING: No sockets in room ${initiatorRoom}! Initiator is not connected!`);
        console.warn(`   Key exchange response will be available via polling when initiator connects`);
      }
      
      // Emit to room (will be received when user connects)
      io.to(initiatorRoom).emit('key-exchange-response', {
        keyExchangeId: keyExchange._id.toString(),
        encrypted,
        signature,
        ecdhPublicKey
      });
      
      console.log(`✅ Key exchange response event emitted to ${initiatorRoom}`);
    } else {
      console.error('❌ Socket.io not available for response!');
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
      io.to(`user_${keyExchange.responderId}`).emit('key-exchange-complete', {
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

// Get pending key exchanges for current user (as responder)
// IMPORTANT: This route must come BEFORE /:keyExchangeId to avoid route conflicts
router.get('/pending', async (req, res) => {
  try {
    const pendingExchanges = await KeyExchange.find({
      responderId: req.user.userId,
      status: 'PENDING',
      expiresAt: { $gt: new Date() }
    })
    .select('_id initiatorId responderId status createdAt')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

    console.log(`📋 Found ${pendingExchanges.length} pending key exchanges for user ${req.user.userId}`);
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

    console.log(`📥 Retrieving key exchange ${req.params.keyExchangeId}`);
    
    // Parse encrypted data for response (handles Mixed type - already object or string)
    let encryptedInit = keyExchange.encryptedInit || null;
    let encryptedResponse = keyExchange.encryptedResponse || null;
    
    // Convert Mixed type (object) to JSON string for client
    try {
      if (encryptedInit) {
        if (typeof encryptedInit === 'object' && encryptedInit !== null) {
          encryptedInit = JSON.stringify(encryptedInit);
        } else if (typeof encryptedInit === 'string') {
          // Already a string, validate it
          try {
            const parsed = JSON.parse(encryptedInit);
            if (parsed && parsed.encryptedKey && typeof parsed.encryptedKey === 'string' && parsed.encryptedKey.length < 300) {
              console.error(`   ❌ WARNING: encryptedKey is too short!`);
              return res.status(500).json({ 
                error: 'Corrupted key exchange data detected.',
                details: { encryptedKeyLength: parsed.encryptedKey.length }
              });
            }
          } catch (e) {
            // Not JSON, that's OK - might be direct RSA encryption
          }
        }
      }
      
      if (encryptedResponse) {
        if (typeof encryptedResponse === 'object' && encryptedResponse !== null) {
          encryptedResponse = JSON.stringify(encryptedResponse);
        } else if (typeof encryptedResponse === 'string') {
          // Validate
          try {
            const parsed = JSON.parse(encryptedResponse);
            if (parsed && parsed.encryptedKey && typeof parsed.encryptedKey === 'string' && parsed.encryptedKey.length < 300) {
              console.error(`   ❌ WARNING: encryptedKey in response is too short!`);
              return res.status(500).json({ 
                error: 'Corrupted key exchange response data detected.',
                details: { encryptedKeyLength: parsed.encryptedKey.length }
              });
            }
          } catch (e) {
            // Not JSON, that's OK - might be direct RSA encryption
          }
        }
      }
    } catch (error) {
      console.error('Error processing encrypted data:', error);
      // Don't fail the request, just log the error
      // Return null values if we can't process them
      if (!encryptedInit || typeof encryptedInit !== 'string') {
        encryptedInit = null;
      }
      if (!encryptedResponse || typeof encryptedResponse !== 'string') {
        encryptedResponse = null;
      }
    }

    res.json({
      keyExchange: {
        _id: keyExchange._id,
        initiatorId: keyExchange.initiatorId,
        responderId: keyExchange.responderId,
        status: keyExchange.status,
        createdAt: keyExchange.createdAt,
        completedAt: keyExchange.completedAt,
        // Return as strings (client expects JSON strings)
        encryptedInit: encryptedInit,
        initSignature: keyExchange.initSignature,
        initiatorECDHPublicKey: keyExchange.initiatorECDHPublicKey,
        encryptedResponse: encryptedResponse,
        responseSignature: keyExchange.responseSignature,
        responderECDHPublicKey: keyExchange.responderECDHPublicKey,
        encryptedConfirmation: keyExchange.encryptedConfirmation,
        confirmationIV: keyExchange.confirmationIV,
        confirmationTag: keyExchange.confirmationTag
      }
    });
  } catch (error) {
    console.error('Error fetching key exchange:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch key exchange',
      details: error.message 
    });
  }
});

module.exports = router;

