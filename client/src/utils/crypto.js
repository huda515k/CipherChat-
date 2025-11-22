/**
 * Cryptographic utilities using Web Crypto API
 * All encryption/decryption happens client-side
 */

// Convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to ArrayBuffer
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Convert string to ArrayBuffer
function stringToArrayBuffer(str) {
  return new TextEncoder().encode(str).buffer;
}

// Convert ArrayBuffer to string
function arrayBufferToString(buffer) {
  return new TextDecoder().decode(buffer);
}

/**
 * Generate RSA key pair (2048 bits)
 */
export async function generateRSAKeyPair() {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true, // extractable
      ['encrypt', 'decrypt']
    );

    // Export keys
    const publicKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKey = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    return {
      publicKey: arrayBufferToBase64(publicKey),
      privateKey: arrayBufferToBase64(privateKey),
      keyPair // Keep the CryptoKey objects for use
    };
  } catch (error) {
    console.error('Error generating RSA key pair:', error);
    throw error;
  }
}

/**
 * Generate ECC key pair (P-256)
 */
export async function generateECCKeyPair() {
  try {
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      true, // extractable
      ['deriveBits', 'deriveKey']
    );

    // Export keys
    const publicKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privateKey = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    return {
      publicKey: arrayBufferToBase64(publicKey),
      privateKey: arrayBufferToBase64(privateKey),
      keyPair // Keep the CryptoKey objects for use
    };
  } catch (error) {
    console.error('Error generating ECC key pair:', error);
    throw error;
  }
}

/**
 * Import RSA public key from Base64
 */
export async function importRSAPublicKey(base64Key) {
  try {
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'spki',
      keyData,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      false,
      ['encrypt']
    );
  } catch (error) {
    console.error('Error importing RSA public key:', error);
    throw error;
  }
}

/**
 * Import RSA private key from Base64
 */
export async function importRSAPrivateKey(base64Key) {
  try {
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'RSA-OAEP',
        hash: 'SHA-256'
      },
      false,
      ['decrypt']
    );
  } catch (error) {
    console.error('Error importing RSA private key:', error);
    throw error;
  }
}

/**
 * Import ECC public key from Base64
 */
export async function importECCPublicKey(base64Key) {
  try {
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'spki',
      keyData,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      []
    );
  } catch (error) {
    console.error('Error importing ECC public key:', error);
    throw error;
  }
}

/**
 * Import ECC private key from Base64
 */
export async function importECCPrivateKey(base64Key) {
  try {
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'ECDH',
        namedCurve: 'P-256'
      },
      false,
      ['deriveBits', 'deriveKey']
    );
  } catch (error) {
    console.error('Error importing ECC private key:', error);
    throw error;
  }
}

/**
 * Encrypt data with RSA-OAEP
 */
export async function encryptRSA(publicKey, data) {
  try {
    const key = await importRSAPublicKey(publicKey);
    const dataBuffer = typeof data === 'string' ? stringToArrayBuffer(data) : data;
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'RSA-OAEP'
      },
      key,
      dataBuffer
    );
    return arrayBufferToBase64(encrypted);
  } catch (error) {
    console.error('Error encrypting with RSA:', error);
    throw error;
  }
}

/**
 * Decrypt data with RSA-OAEP
 */
export async function decryptRSA(privateKey, encryptedData) {
  try {
    const key = await importRSAPrivateKey(privateKey);
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'RSA-OAEP'
      },
      key,
      encryptedBuffer
    );
    return arrayBufferToString(decrypted);
  } catch (error) {
    console.error('Error decrypting with RSA:', error);
    throw error;
  }
}

/**
 * Derive shared secret using ECDH
 */
export async function deriveECDHSecret(privateKey, publicKey) {
  try {
    const privKey = await importECCPrivateKey(privateKey);
    const pubKey = await importECCPublicKey(publicKey);

    const sharedSecret = await window.crypto.subtle.deriveBits(
      {
        name: 'ECDH',
        public: pubKey
      },
      privKey,
      256
    );

    return arrayBufferToBase64(sharedSecret);
  } catch (error) {
    console.error('Error deriving ECDH secret:', error);
    throw error;
  }
}

/**
 * Derive AES key from shared secret using HKDF
 */
export async function deriveAESKey(sharedSecret, salt, info) {
  try {
    const secretBuffer = base64ToArrayBuffer(sharedSecret);
    const saltBuffer = salt ? base64ToArrayBuffer(salt) : new Uint8Array(32);
    const infoBuffer = info ? stringToArrayBuffer(info) : new Uint8Array(0);

    // Import the shared secret as a key
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      secretBuffer,
      'HKDF',
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive AES-GCM key using HKDF
    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: saltBuffer,
        info: infoBuffer
      },
      baseKey,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    return aesKey;
  } catch (error) {
    console.error('Error deriving AES key:', error);
    throw error;
  }
}

/**
 * Encrypt message with AES-256-GCM
 */
export async function encryptAESGCM(key, plaintext) {
  try {
    // Generate random IV (96 bits for GCM)
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    // Convert plaintext to ArrayBuffer
    const plaintextBuffer = stringToArrayBuffer(plaintext);

    // Encrypt
    const encrypted = await window.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      plaintextBuffer
    );

    // Extract authentication tag (last 16 bytes)
    const encryptedArray = new Uint8Array(encrypted);
    const tag = encryptedArray.slice(-16);
    const ciphertext = encryptedArray.slice(0, -16);

    return {
      ciphertext: arrayBufferToBase64(ciphertext),
      iv: arrayBufferToBase64(iv),
      tag: arrayBufferToBase64(tag)
    };
  } catch (error) {
    console.error('Error encrypting with AES-GCM:', error);
    throw error;
  }
}

/**
 * Decrypt message with AES-256-GCM
 */
export async function decryptAESGCM(key, ciphertext, iv, tag) {
  try {
    const ciphertextBuffer = base64ToArrayBuffer(ciphertext);
    const ivBuffer = base64ToArrayBuffer(iv);
    const tagBuffer = base64ToArrayBuffer(tag);

    // Combine ciphertext and tag
    const encryptedData = new Uint8Array(ciphertextBuffer.byteLength + tagBuffer.byteLength);
    encryptedData.set(new Uint8Array(ciphertextBuffer), 0);
    encryptedData.set(new Uint8Array(tagBuffer), ciphertextBuffer.byteLength);

    // Decrypt
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuffer
      },
      key,
      encryptedData
    );

    return arrayBufferToString(decrypted);
  } catch (error) {
    console.error('Error decrypting with AES-GCM:', error);
    throw error;
  }
}

/**
 * Generate random nonce
 */
export function generateNonce() {
  const nonce = window.crypto.getRandomValues(new Uint8Array(32));
  return arrayBufferToBase64(nonce);
}

/**
 * Sign data with RSA-PSS
 */
export async function signData(privateKey, data) {
  try {
    const key = await importRSAPrivateKey(privateKey);
    const dataBuffer = stringToArrayBuffer(data);
    
    const signature = await window.crypto.subtle.sign(
      {
        name: 'RSA-PSS',
        saltLength: 32
      },
      key,
      dataBuffer
    );

    return arrayBufferToBase64(signature);
  } catch (error) {
    console.error('Error signing data:', error);
    throw error;
  }
}

/**
 * Verify signature with RSA-PSS
 */
export async function verifySignature(publicKey, signature, data) {
  try {
    const key = await importRSAPublicKey(publicKey);
    const signatureBuffer = base64ToArrayBuffer(signature);
    const dataBuffer = stringToArrayBuffer(data);

    const isValid = await window.crypto.subtle.verify(
      {
        name: 'RSA-PSS',
        saltLength: 32
      },
      key,
      signatureBuffer,
      dataBuffer
    );

    return isValid;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}

/**
 * Hash data with SHA-256
 */
export async function hashSHA256(data) {
  try {
    const dataBuffer = stringToArrayBuffer(data);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', dataBuffer);
    return arrayBufferToBase64(hashBuffer);
  } catch (error) {
    console.error('Error hashing data:', error);
    throw error;
  }
}

