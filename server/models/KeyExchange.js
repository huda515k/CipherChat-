const mongoose = require('mongoose');

const keyExchangeSchema = new mongoose.Schema({
  initiatorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  responderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'RESPONDED', 'COMPLETED', 'FAILED'],
    default: 'PENDING',
    index: true
  },
  // Step 1: Initiate
  // CRITICAL FIX: Use Mixed type to prevent truncation that occurs with String type
  encryptedInit: {
    type: mongoose.Schema.Types.Mixed, // Changed from String to prevent truncation
    required: true
  },
  initSignature: {
    type: mongoose.Schema.Types.Mixed // Changed from String
  },
  initiatorECDHPublicKey: {
    type: mongoose.Schema.Types.Mixed // Changed from String
  },
  // Step 2: Respond
  encryptedResponse: {
    type: mongoose.Schema.Types.Mixed // Changed from String to prevent truncation
  },
  responseSignature: {
    type: mongoose.Schema.Types.Mixed // Changed from String
  },
  responderECDHPublicKey: {
    type: mongoose.Schema.Types.Mixed // Changed from String
  },
  // Step 3: Complete
  encryptedConfirmation: String,
  confirmationIV: String,
  confirmationTag: String,
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  completedAt: Date,
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 60 * 1000) // 30 minutes (increased for debugging)
  }
});

// Compound index for efficient queries
keyExchangeSchema.index({ initiatorId: 1, responderId: 1, status: 1 });
keyExchangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('KeyExchange', keyExchangeSchema);

