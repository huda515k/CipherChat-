const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  sessionKey: {
    type: String, // Encrypted session key (encrypted with receiver's public key)
    required: true
  },
  sharedSecret: {
    type: String, // ECDH shared secret (encrypted)
    required: true
  },
  establishedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sequenceNumber: {
    type: Number,
    default: 0
  }
});

// Compound index for session lookup
sessionSchema.index({ userId: 1, targetUserId: 1 }, { unique: true });

module.exports = mongoose.model('Session', sessionSchema);

