/**
 * Custom Key Exchange Protocol
 * 
 * Protocol Flow:
 * 1. Alice generates ECDH key pair and sends public key to Bob
 * 2. Bob generates ECDH key pair, derives shared secret, signs it, and sends public key + signature to Alice
 * 3. Alice verifies signature, derives shared secret, signs it, and sends signature to Bob
 * 4. Both parties derive AES session key using HKDF
 * 5. Key confirmation: Both parties send encrypted "CONFIRMED" message
 */

import {
  generateECCKeyPair,
  deriveECDHSecret,
  deriveAESKey,
  encryptRSA,
  decryptRSA,
  signData,
  verifySignature,
  encryptAESGCM,
  decryptAESGCM,
  generateNonce,
  hashSHA256,
  importRSAPublicKey,
  importRSAPrivateKey,
  importECCPrivateKey,
  importECCPublicKey
} from './crypto';
import { storeSessionKey, getSessionKey, storeTempECDHKey, getTempECDHKey, clearTempECDHKey } from './keyStorage';

/**
 * Step 1: Initiate key exchange (Alice's side)
 */
export async function initiateKeyExchange(rsaPrivateKey, targetPublicKey) {
  try {
    // Generate ECDH key pair
    const ecdhKeyPair = await generateECCKeyPair();
    
    // Create key exchange message
    const message = {
      type: 'KEY_EXCHANGE_INIT',
      publicKey: ecdhKeyPair.publicKey,
      timestamp: Date.now(),
      nonce: generateNonce()
    };

    const messageString = JSON.stringify(message);
    
    // Sign the message
    const signature = await signData(rsaPrivateKey, messageString);
    
    // Encrypt with target's public key
    const encrypted = await encryptRSA(targetPublicKey, messageString);

    return {
      encrypted,
      signature,
      ecdhKeyPair // Keep for next step
    };
  } catch (error) {
    console.error('Error initiating key exchange:', error);
    throw error;
  }
}

/**
 * Step 2: Respond to key exchange (Bob's side)
 */
export async function respondToKeyExchange(
  rsaPrivateKey,
  rsaPublicKey,
  initiatorRSAPublicKey,
  encryptedInitMessage,
  signature
) {
  try {
    // Decrypt initiator's message
    const decrypted = await decryptRSA(rsaPrivateKey, encryptedInitMessage);
    const initMessage = JSON.parse(decrypted);

    // Verify signature to ensure authenticity and prevent MITM attacks
    const isValid = await verifySignature(
      initiatorRSAPublicKey,
      signature,
      decrypted
    );

    if (!isValid) {
      throw new Error('Invalid signature in key exchange initiation');
    }

    // Generate our ECDH key pair
    const ecdhKeyPair = await generateECCKeyPair();

    // Derive shared secret (already returns base64 string)
    const sharedSecret = await deriveECDHSecret(
      ecdhKeyPair.privateKey,
      initMessage.publicKey
    );

    // Create response message
    const responseMessage = {
      type: 'KEY_EXCHANGE_RESPONSE',
      publicKey: ecdhKeyPair.publicKey,
      sharedSecretHash: await hashSHA256(sharedSecret), // Send hash for verification
      timestamp: Date.now(),
      nonce: generateNonce()
    };

    const responseString = JSON.stringify(responseMessage);
    
    // Sign the response
    const responseSignature = await signData(rsaPrivateKey, responseString);
    
    // Encrypt with initiator's public key
    const encryptedResponse = await encryptRSA(initiatorRSAPublicKey, responseString);

    return {
      encrypted: encryptedResponse,
      signature: responseSignature,
      ecdhKeyPair,
      sharedSecret
    };
  } catch (error) {
    console.error('Error responding to key exchange:', error);
    throw error;
  }
}

/**
 * Step 3: Complete key exchange (Alice's side)
 */
export async function completeKeyExchange(
  rsaPrivateKey,
  initiatorECDHPrivateKey,
  encryptedResponse,
  responseSignature,
  responderRSAPublicKey
) {
  try {
    // Decrypt response
    const decrypted = await decryptRSA(rsaPrivateKey, encryptedResponse);
    const response = JSON.parse(decrypted);

    // Verify signature
    const isValid = await verifySignature(
      responderRSAPublicKey,
      responseSignature,
      decrypted
    );

    if (!isValid) {
      throw new Error('Invalid signature in key exchange response');
    }

    // Derive shared secret (already returns base64 string)
    const sharedSecret = await deriveECDHSecret(
      initiatorECDHPrivateKey,
      response.publicKey
    );

    // Verify shared secret hash
    const sharedSecretHash = await hashSHA256(sharedSecret);
    if (sharedSecretHash !== response.sharedSecretHash) {
      throw new Error('Shared secret verification failed');
    }

    // Derive AES session key using HKDF
    // Use shared secret hash as salt for consistency (both parties can derive the same salt)
    const salt = await hashSHA256(sharedSecret);
    const sessionKey = await deriveAESKey(sharedSecret, salt, 'E2EE_SESSION_KEY');

    // Key confirmation
    const confirmationMessage = {
      type: 'KEY_CONFIRMATION',
      message: 'CONFIRMED',
      timestamp: Date.now()
    };

    const confirmationString = JSON.stringify(confirmationMessage);
    const encryptedConfirmation = await encryptAESGCM(sessionKey, confirmationString);

    return {
      sharedSecret,
      sessionKey,
      confirmation: encryptedConfirmation
    };
  } catch (error) {
    console.error('Error completing key exchange:', error);
    throw error;
  }
}

/**
 * Step 4: Finalize key exchange (Bob's side)
 */
export async function finalizeKeyExchange(
  sessionKey,
  encryptedConfirmation
) {
  try {
    // Decrypt confirmation
    const decrypted = await decryptAESGCM(
      sessionKey,
      encryptedConfirmation.ciphertext,
      encryptedConfirmation.iv,
      encryptedConfirmation.tag
    );

    const confirmation = JSON.parse(decrypted);
    
    if (confirmation.message !== 'CONFIRMED') {
      throw new Error('Key confirmation failed');
    }

    return true;
  } catch (error) {
    console.error('Error finalizing key exchange:', error);
    throw error;
  }
}

/**
 * Complete key exchange protocol wrapper
 * Handles the full ECDH key exchange with digital signatures
 */
export async function performFullKeyExchange(
  userId,
  targetUserId,
  rsaPrivateKeyBase64,
  targetRSAPublicKeyBase64,
  apiCall,
  socket
) {
  try {
    console.log('Starting full key exchange protocol...');
    
    // Import keys
    const rsaPrivateKey = await importRSAPrivateKey(rsaPrivateKeyBase64);
    const targetRSAPublicKey = await importRSAPublicKey(targetRSAPublicKeyBase64);

    // Step 1: Initiate key exchange
    console.log('Step 1: Initiating key exchange...');
    const init = await initiateKeyExchange(rsaPrivateKey, targetRSAPublicKeyBase64);
    
    // Store ECDH key pair temporarily
    await storeTempECDHKey(userId, targetUserId, init.ecdhKeyPair, true);

    // Send to server
    const initResponse = await apiCall('/key-exchange/initiate', {
      targetUserId,
      encrypted: init.encrypted,
      signature: init.signature,
      ecdhPublicKey: init.ecdhKeyPair.publicKey
    });

    const keyExchangeId = initResponse.data.keyExchangeId;
    console.log('Key exchange initiated, ID:', keyExchangeId);

    // Step 2: Wait for response (via socket or polling)
    return new Promise((resolve, reject) => {
      let responseReceived = false;
      const timeout = setTimeout(() => {
        if (!responseReceived) {
          reject(new Error('Key exchange timeout: No response received'));
        }
      }, 30000); // 30 second timeout

      // Listen for response via socket
      const responseHandler = async (data) => {
        if (data.keyExchangeId === keyExchangeId) {
          responseReceived = true;
          clearTimeout(timeout);
          socket.off('key-exchange-response', responseHandler);

          try {
            console.log('Step 2: Received response, processing...');
            
            // Get stored ECDH key pair
            const initiatorECDHKeyPair = await getTempECDHKey(userId, targetUserId, true);
            const initiatorECDHPrivateKey = await importECCPrivateKey(initiatorECDHKeyPair.privateKey);
            
            // Get target user's public key for signature verification
            const targetUserResponse = await apiCall(`/users/${targetUserId}/public-key`);
            const responderRSAPublicKey = await importRSAPublicKey(targetUserResponse.data.publicKey);

            // Step 3: Complete key exchange
            const complete = await completeKeyExchange(
              rsaPrivateKey,
              initiatorECDHPrivateKey,
              data.encrypted,
              data.signature,
              targetRSAPublicKeyBase64
            );

            // Store session (sharedSecret is already base64 string)
            await storeSessionKey(
              userId,
              targetUserId,
              '', // Session key is derived, not stored directly
              complete.sharedSecret
            );

            // Send confirmation
            console.log('Step 3: Sending confirmation...');
            await apiCall('/key-exchange/complete', {
              keyExchangeId,
              encryptedConfirmation: complete.confirmation.ciphertext,
              iv: complete.confirmation.iv,
              tag: complete.confirmation.tag
            });

            // Clean up temporary keys
            await clearTempECDHKey(userId, targetUserId, true);

            console.log('Key exchange completed successfully!');
            resolve({
              success: true,
              sharedSecret: complete.sharedSecret
            });
          } catch (error) {
            console.error('Error completing key exchange:', error);
            reject(error);
          }
        }
      };

      socket.on('key-exchange-response', responseHandler);

      // Also poll as fallback
      const pollInterval = setInterval(async () => {
        try {
          const exchangeResponse = await apiCall(`/key-exchange/${keyExchangeId}`);
          if (exchangeResponse.data.keyExchange.status === 'RESPONDED' && !responseReceived) {
            responseReceived = true;
            clearInterval(pollInterval);
            clearTimeout(timeout);
            socket.off('key-exchange-response', responseHandler);
            
            // Process response
            const data = exchangeResponse.data.keyExchange;
            responseHandler({
              keyExchangeId,
              encrypted: data.encryptedResponse,
              signature: data.responseSignature,
              ecdhPublicKey: data.responderECDHPublicKey
            });
          }
        } catch (error) {
          // Ignore polling errors
        }
      }, 2000); // Poll every 2 seconds
    });
  } catch (error) {
    console.error('Key exchange failed:', error);
    throw error;
  }
}

/**
 * Respond to incoming key exchange request
 */
export async function respondToIncomingKeyExchange(
  userId,
  keyExchangeId,
  rsaPrivateKeyBase64,
  rsaPublicKeyBase64,
  apiCall
) {
  try {
    console.log('Responding to key exchange request:', keyExchangeId);
    
    // Get key exchange details
    const exchangeResponse = await apiCall(`/key-exchange/${keyExchangeId}`);
    const keyExchange = exchangeResponse.data.keyExchange;
    
    // Import keys
    const rsaPrivateKey = await importRSAPrivateKey(rsaPrivateKeyBase64);
    
    // Get initiator's public key
    const initiatorUserResponse = await apiCall(`/users/${keyExchange.initiatorId}/public-key`);
    const initiatorRSAPublicKey = await importRSAPublicKey(initiatorUserResponse.data.publicKey);

    // Step 2: Respond to key exchange
    const response = await respondToKeyExchange(
      rsaPrivateKey,
      rsaPublicKeyBase64,
      initiatorRSAPublicKey,
      keyExchange.encryptedInit,
      keyExchange.initSignature
    );

    // Store ECDH key pair temporarily
    await storeTempECDHKey(userId, keyExchange.initiatorId, response.ecdhKeyPair, false);

    // Send response to server
    await apiCall('/key-exchange/respond', {
      keyExchangeId,
      encrypted: response.encrypted,
      signature: response.signature,
      ecdhPublicKey: response.ecdhKeyPair.publicKey
    });

    console.log('Key exchange response sent');

    // Step 4: Wait for confirmation
    return new Promise((resolve, reject) => {
      let confirmationReceived = false;
      const timeout = setTimeout(() => {
        if (!confirmationReceived) {
          reject(new Error('Key exchange timeout: No confirmation received'));
        }
      }, 30000);

      const confirmationHandler = async (data) => {
        if (data.keyExchangeId === keyExchangeId) {
          confirmationReceived = true;
          clearTimeout(timeout);

          try {
            console.log('Step 4: Received confirmation, finalizing...');
            
            // Derive session key (same as initiator)
            // Use shared secret hash as salt for consistency (both parties can derive the same salt)
            const salt = await hashSHA256(response.sharedSecret);
            const sessionKey = await deriveAESKey(
              response.sharedSecret,
              salt,
              'E2EE_SESSION_KEY'
            );

            // Finalize key exchange
            await finalizeKeyExchange(sessionKey, {
              ciphertext: data.encryptedConfirmation,
              iv: data.iv,
              tag: data.tag
            });

            // Store session (sharedSecret is already base64 string)
            await storeSessionKey(
              userId,
              keyExchange.initiatorId,
              '',
              response.sharedSecret
            );

            // Clean up temporary keys
            await clearTempECDHKey(userId, keyExchange.initiatorId, false);

            console.log('Key exchange finalized successfully!');
            resolve({
              success: true,
              sharedSecret: response.sharedSecret
            });
          } catch (error) {
            console.error('Error finalizing key exchange:', error);
            reject(error);
          }
        }
      };

      // Listen for confirmation via socket (would need socket passed in)
      // For now, poll
      const pollInterval = setInterval(async () => {
        try {
          const exchangeResponse = await apiCall(`/key-exchange/${keyExchangeId}`);
          if (exchangeResponse.data.keyExchange.status === 'COMPLETED' && !confirmationReceived) {
            confirmationReceived = true;
            clearInterval(pollInterval);
            clearTimeout(timeout);
            
            const data = exchangeResponse.data.keyExchange;
            await confirmationHandler({
              keyExchangeId,
              encryptedConfirmation: data.encryptedConfirmation,
              iv: data.confirmationIV,
              tag: data.confirmationTag
            });
          }
        } catch (error) {
          // Ignore polling errors
        }
      }, 2000);
    });
  } catch (error) {
    console.error('Error responding to key exchange:', error);
    throw error;
  }
}

