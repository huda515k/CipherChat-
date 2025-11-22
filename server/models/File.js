const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  originalFilename: {
    type: String,
    required: true
  },
  encryptedFilename: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileSize: {
    type: Number,
    required: true
  },
  mimeType: {
    type: String
  },
  chunks: [{
    chunkIndex: Number,
    ciphertext: String,
    iv: String,
    tag: String
  }],
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  nonce: {
    type: String,
    required: true,
    unique: true
  }
});

fileSchema.index({ senderId: 1, receiverId: 1, timestamp: -1 });
fileSchema.index({ nonce: 1 }, { unique: true });

module.exports = mongoose.model('File', fileSchema);

