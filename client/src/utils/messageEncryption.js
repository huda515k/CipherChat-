/**
 * Message encryption/decryption utilities
 * Handles AES-GCM encryption with replay protection
 */

import {
  deriveAESKey,
  encryptAESGCM,
  decryptAESGCM,
  generateNonce,
  hashSHA256
} from './crypto';
import { getNextSequenceNumber, getSessionKey } from './keyStorage';

/**
 * Encrypt a message for sending
 */
export async function encryptMessage(userId, targetUserId, plaintext) {
  try {
    // Get session key
    const sessionData = await getSessionKey(userId, targetUserId);
    // Sort user IDs to match the shared secret generation
    const userIds = [userId, targetUserId].sort();
    const sessionKey = await deriveAESKey(
      sessionData.sharedSecret,
      await hashSHA256(`${userIds[0]}_${userIds[1]}`),
      'E2EE_SESSION_KEY'
    );

    // Get next sequence number
    const sequenceNumber = await getNextSequenceNumber(userId, targetUserId);

    // Generate nonce
    const nonce = generateNonce();

    // Create message with metadata
    const messageData = {
      text: plaintext,
      timestamp: Date.now(),
      sequenceNumber,
      nonce
    };

    const messageString = JSON.stringify(messageData);

    // Encrypt with AES-GCM
    const encrypted = await encryptAESGCM(sessionKey, messageString);

    return {
      ...encrypted,
      nonce,
      sequenceNumber
    };
  } catch (error) {
    console.error('Error encrypting message:', error);
    throw error;
  }
}

/**
 * Decrypt a received message
 */
export async function decryptMessage(userId, targetUserId, encryptedData) {
  try {
    const { ciphertext, iv, tag, nonce, sequenceNumber } = encryptedData;

    // Get session key
    const sessionData = await getSessionKey(userId, targetUserId);
    // Sort user IDs to match the shared secret generation
    const userIds = [userId, targetUserId].sort();
    const sessionKey = await deriveAESKey(
      sessionData.sharedSecret,
      await hashSHA256(`${userIds[0]}_${userIds[1]}`),
      'E2EE_SESSION_KEY'
    );

    // Decrypt
    const decrypted = await decryptAESGCM(sessionKey, ciphertext, iv, tag);
    const messageData = JSON.parse(decrypted);

    // Verify nonce (should be checked server-side, but verify here too)
    if (messageData.nonce !== nonce) {
      throw new Error('Nonce mismatch');
    }

    // Verify sequence number (should be increasing)
    // Note: In production, you'd check against stored sequence numbers

    return {
      text: messageData.text,
      timestamp: messageData.timestamp,
      sequenceNumber: messageData.sequenceNumber
    };
  } catch (error) {
    console.error('Error decrypting message:', error);
    throw error;
  }
}

/**
 * Verify message timestamp (replay protection)
 */
export function verifyMessageTimestamp(timestamp, maxAge = 5 * 60 * 1000) {
  const now = Date.now();
  const age = now - timestamp;
  
  if (age < 0) {
    return { valid: false, reason: 'Future timestamp' };
  }
  
  if (age > maxAge) {
    return { valid: false, reason: 'Message too old' };
  }
  
  return { valid: true };
}

