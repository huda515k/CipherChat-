/**
 * File encryption/decryption utilities
 * Handles chunked file encryption with AES-GCM
 */

import {
  deriveAESKey,
  encryptAESGCM,
  decryptAESGCM,
  generateNonce,
  hashSHA256,
  arrayBufferToBase64,
  base64ToArrayBuffer
} from './crypto';
import { getSessionKey } from './keyStorage';

const CHUNK_SIZE = 256 * 1024; // 256KB chunks (larger chunks = fewer chunks = smaller JSON)

/**
 * Encrypt a file in chunks
 */
export async function encryptFile(userId, targetUserId, file) {
  try {
    // Get session key
    const sessionData = await getSessionKey(userId, targetUserId);
    // Sort user IDs to match the shared secret generation
    const userIds = [String(userId), String(targetUserId)].sort();
    const sessionKey = await deriveAESKey(
      sessionData.sharedSecret,
      await hashSHA256(`${userIds[0]}_${userIds[1]}`),
      'E2EE_SESSION_KEY'
    );

    // Generate file nonce
    const fileNonce = generateNonce();

    // Read file as ArrayBuffer
    const fileBuffer = await file.arrayBuffer();
    const chunks = [];
    const totalChunks = Math.ceil(fileBuffer.byteLength / CHUNK_SIZE);

    // Encrypt each chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileBuffer.byteLength);
      const chunk = fileBuffer.slice(start, end);
      
      // Convert chunk to string for encryption
      const chunkString = arrayBufferToBase64(chunk);
      
      // Encrypt chunk
      const encrypted = await encryptAESGCM(sessionKey, chunkString);
      
      chunks.push({
        chunkIndex: i,
        ...encrypted
      });
    }

    const result = {
      chunks,
      nonce: fileNonce,
      totalChunks,
      originalFilename: file.name || 'unnamed-file',
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size
    };

    console.log('File encryption result:', {
      chunksCount: result.chunks.length,
      nonce: result.nonce.substring(0, 20) + '...',
      filename: result.originalFilename,
      mimeType: result.mimeType
    });

    return result;
  } catch (error) {
    console.error('Error encrypting file:', error);
    throw error;
  }
}

/**
 * Decrypt a file from chunks
 */
export async function decryptFile(userId, targetUserId, encryptedChunks) {
  try {
    // Get session key
    const sessionData = await getSessionKey(userId, targetUserId);
    // Sort user IDs to match the shared secret generation
    const userIds = [String(userId), String(targetUserId)].sort();
    const sessionKey = await deriveAESKey(
      sessionData.sharedSecret,
      await hashSHA256(`${userIds[0]}_${userIds[1]}`),
      'E2EE_SESSION_KEY'
    );

    // Sort chunks by index
    const sortedChunks = encryptedChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    // Decrypt each chunk
    const decryptedChunks = [];
    for (const chunk of sortedChunks) {
      const decrypted = await decryptAESGCM(
        sessionKey,
        chunk.ciphertext,
        chunk.iv,
        chunk.tag
      );
      
      // Convert back to ArrayBuffer
      const chunkBuffer = base64ToArrayBuffer(decrypted);
      decryptedChunks.push(chunkBuffer);
    }

    // Combine chunks
    const totalLength = decryptedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combinedBuffer = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const chunk of decryptedChunks) {
      combinedBuffer.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }

    return combinedBuffer.buffer;
  } catch (error) {
    console.error('Error decrypting file:', error);
    throw error;
  }
}

/**
 * Create a Blob from decrypted file data
 */
export function createFileBlob(buffer, mimeType) {
  return new Blob([buffer], { type: mimeType });
}

/**
 * Download file
 */
export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

