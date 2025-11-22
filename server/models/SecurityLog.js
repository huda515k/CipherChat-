const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'AUTH_ATTEMPT',
      'AUTH_SUCCESS',
      'AUTH_FAILURE',
      'KEY_EXCHANGE_INITIATED',
      'KEY_EXCHANGE_COMPLETED',
      'KEY_EXCHANGE_FAILED',
      'MESSAGE_DECRYPTION_FAILED',
      'REPLAY_ATTACK_DETECTED',
      'INVALID_SIGNATURE',
      'METADATA_ACCESS',
      'FILE_UPLOAD',
      'FILE_DOWNLOAD'
    ],
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  severity: {
    type: String,
    enum: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'],
    default: 'INFO'
  }
});

securityLogSchema.index({ eventType: 1, timestamp: -1 });
securityLogSchema.index({ userId: 1, timestamp: -1 });

module.exports = mongoose.model('SecurityLog', securityLogSchema);

