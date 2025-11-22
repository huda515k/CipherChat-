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
  encryptedInit: String,
  initSignature: String,
  initiatorECDHPublicKey: String,
  // Step 2: Respond
  encryptedResponse: String,
  responseSignature: String,
  responderECDHPublicKey: String,
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
    default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
  }
});

// Compound index for efficient queries
keyExchangeSchema.index({ initiatorId: 1, responderId: 1, status: 1 });
keyExchangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('KeyExchange', keyExchangeSchema);

