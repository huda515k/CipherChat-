const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const File = require('../models/File');
const SecurityLog = require('../models/SecurityLog');
const { authenticateToken } = require('./auth');
const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'encrypted-' + uniqueSuffix);
  }
});

const upload = multer({
  storage,
  limits: { 
    fileSize: 200 * 1024 * 1024, // 200MB limit
    fieldSize: 200 * 1024 * 1024 // 200MB for form fields (chunks JSON)
  },
  preservePath: true
});

// Upload encrypted file
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('File upload request received');
    console.log('Request body keys:', Object.keys(req.body));
    console.log('Request body:', {
      receiverId: req.body.receiverId,
      originalFilename: req.body.originalFilename,
      mimeType: req.body.mimeType,
      nonce: req.body.nonce,
      hasChunks: !!req.body.chunks
    });
    console.log('Request file:', req.file ? {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    } : 'No file');

    // Get fields from body (multer puts text fields in req.body)
    const receiverId = req.body.receiverId;
    const originalFilename = req.body.originalFilename;
    const mimeType = req.body.mimeType;
    let chunks = req.body.chunks;
    const nonce = req.body.nonce;

    // Parse chunks if it's a string (from FormData)
    if (typeof chunks === 'string') {
      try {
        chunks = JSON.parse(chunks);
      } catch (e) {
        console.error('Error parsing chunks JSON:', e);
        return res.status(400).json({ error: 'Invalid chunks format' });
      }
    }

    // Check which fields are missing
    const missingFields = [];
    if (!receiverId || receiverId === 'undefined' || receiverId === 'null') {
      missingFields.push('receiverId');
    }
    if (!originalFilename || originalFilename === 'undefined' || originalFilename === 'null') {
      missingFields.push('originalFilename');
    }
    if (!req.file) {
      missingFields.push('file');
    }
    if (!nonce || nonce === 'undefined' || nonce === 'null' || nonce === '') {
      missingFields.push('nonce');
    }

    if (missingFields.length > 0) {
      console.error('Missing fields:', missingFields);
      console.error('Received body keys:', Object.keys(req.body));
      console.error('Body values:', {
        receiverId: receiverId || 'MISSING',
        originalFilename: originalFilename || 'MISSING',
        mimeType: mimeType || 'MISSING',
        nonce: nonce || 'MISSING',
        chunks: chunks ? 'PRESENT' : 'MISSING',
        file: req.file ? 'PRESENT' : 'MISSING'
      });
      return res.status(400).json({ 
        error: 'Missing required fields',
        missingFields: missingFields,
        receivedFields: Object.keys(req.body)
      });
    }

    // Check for replay attack
    const existingFile = await File.findOne({ nonce });
    if (existingFile) {
      await SecurityLog.create({
        eventType: 'REPLAY_ATTACK_DETECTED',
        userId: req.user.userId,
        targetUserId: receiverId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        details: { nonce, reason: 'Duplicate file nonce detected' },
        severity: 'CRITICAL'
      });
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Replay attack detected: duplicate nonce' });
    }

    // Convert receiverId to ObjectId if it's a string
    const receiverObjectId = mongoose.Types.ObjectId.isValid(receiverId) 
      ? new mongoose.Types.ObjectId(receiverId)
      : receiverId;
    const senderObjectId = mongoose.Types.ObjectId.isValid(req.user.userId)
      ? new mongoose.Types.ObjectId(req.user.userId)
      : req.user.userId;

    // Validate chunks structure
    let validChunks = [];
    if (Array.isArray(chunks)) {
      validChunks = chunks.map((chunk, index) => ({
        chunkIndex: chunk.chunkIndex !== undefined ? chunk.chunkIndex : index,
        ciphertext: chunk.ciphertext || '',
        iv: chunk.iv || '',
        tag: chunk.tag || ''
      }));
    }

    console.log('Creating file record with:', {
      senderId: senderObjectId,
      receiverId: receiverObjectId,
      originalFilename,
      chunksCount: validChunks.length,
      nonce: nonce.substring(0, 20) + '...'
    });

    const fileRecord = await File.create({
      senderId: senderObjectId,
      receiverId: receiverObjectId,
      originalFilename,
      encryptedFilename: req.file.filename,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: mimeType || 'application/octet-stream',
      chunks: validChunks,
      nonce,
      timestamp: new Date()
    });

    await SecurityLog.create({
      eventType: 'FILE_UPLOAD',
      userId: req.user.userId,
      targetUserId: receiverId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { fileId: fileRecord._id, filename: originalFilename, size: req.file.size },
      severity: 'INFO'
    });

    // Emit real-time notification to receiver
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${receiverId}`).emit('new-file', {
        fileId: fileRecord._id,
        senderId: req.user.userId,
        filename: originalFilename,
        timestamp: fileRecord.timestamp
      });
    }

    res.status(201).json({
      fileId: fileRecord._id,
      timestamp: fileRecord.timestamp
    });
  } catch (error) {
    console.error('File upload error:', error);
    console.error('Error stack:', error.stack);
    console.error('Request body keys:', Object.keys(req.body));
    console.error('Request file:', req.file ? {
      filename: req.file.filename,
      size: req.file.size,
      path: req.file.path
    } : 'No file');
    
    // Clean up uploaded file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error cleaning up file:', unlinkError);
      }
    }
    
    if (error.code === 11000) {
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
    const errorMessage = error.message || 'Failed to upload file';
    res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Download encrypted file
router.get('/download/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.userId;

    const fileRecord = await File.findById(fileId);
    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if user is sender or receiver
    if (fileRecord.senderId.toString() !== userId && 
        fileRecord.receiverId.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await SecurityLog.create({
      eventType: 'FILE_DOWNLOAD',
      userId,
      targetUserId: fileRecord.senderId.toString() === userId 
        ? fileRecord.receiverId 
        : fileRecord.senderId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      details: { fileId, filename: fileRecord.originalFilename },
      severity: 'INFO'
    });

    // Send encrypted file
    res.download(fileRecord.filePath, fileRecord.encryptedFilename, (err) => {
      if (err) {
        console.error('File download error:', err);
        res.status(500).json({ error: 'Failed to download file' });
      }
    });
  } catch (error) {
    console.error('Download file error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Get file metadata
router.get('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.userId;

    const fileRecord = await File.findById(fileId)
      .select('senderId receiverId originalFilename fileSize mimeType timestamp chunks')
      .lean();

    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if user is sender or receiver
    if (fileRecord.senderId.toString() !== userId && 
        fileRecord.receiverId.toString() !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
      fileId: fileRecord._id,
      originalFilename: fileRecord.originalFilename,
      fileSize: fileRecord.fileSize,
      mimeType: fileRecord.mimeType,
      timestamp: fileRecord.timestamp,
      chunks: fileRecord.chunks
    });
  } catch (error) {
    console.error('Get file metadata error:', error);
    res.status(500).json({ error: 'Failed to fetch file metadata' });
  }
});

module.exports = router;

