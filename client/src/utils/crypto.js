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

// Helper function to validate and clean base64 string
function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  // Remove whitespace
  const cleaned = str.trim().replace(/\s/g, '');
  // Base64 regex: only A-Z, a-z, 0-9, +, /, and = for padding
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  // Length must be multiple of 4 (after padding)
  return base64Regex.test(cleaned) && cleaned.length % 4 === 0 && cleaned.length > 0;
}

// Convert Base64 to ArrayBuffer
export function base64ToArrayBuffer(base64) {
  if (!base64) {
    throw new Error('Base64 string is required');
  }
  
  // Ensure it's a string
  let base64Str = String(base64);
  
  // Remove whitespace and newlines
  base64Str = base64Str.trim().replace(/\s/g, '').replace(/\n/g, '');
  
  // Validate base64 format
  if (!isValidBase64(base64Str)) {
    throw new Error(`Invalid base64 format: The string contains invalid characters. Input preview: ${base64Str.substring(0, 50)}...`);
  }
  
  try {
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (error) {
    throw new Error(`Failed to decode base64: ${error.message}. Input preview: ${base64Str.substring(0, 50)}...`);
  }
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
 * Note: We generate the key with RSA-OAEP for encryption, but the same key material
 * can be imported with RSA-PSS algorithm for signing
 */
export async function generateRSAKeyPair() {
  try {
    // Generate RSA key pair for encryption (RSA-OAEP)
    // The same key material can be imported with RSA-PSS for signing
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true, // extractable - allows us to export and re-import with different algorithm
      ['encrypt', 'decrypt'] // Only encryption usages for generation
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
 * Import RSA public key from Base64 (for encryption)
 */
export async function importRSAPublicKey(base64Key) {
  try {
    // Ensure base64Key is a string
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error('RSA public key must be a valid base64 string');
    }
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
    throw new Error(`Failed to import RSA public key: ${error.message}`);
  }
}

/**
 * Import RSA public key from Base64 (for signature verification)
 */
export async function importRSAPublicKeyForVerification(base64Key) {
  try {
    // Ensure base64Key is a string
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error('RSA public key must be a valid base64 string');
    }
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'spki',
      keyData,
      {
        name: 'RSA-PSS',
        hash: 'SHA-256'
      },
      false,
      ['verify']
    );
  } catch (error) {
    console.error('Error importing RSA public key for verification:', error);
    throw new Error(`Failed to import RSA public key for verification: ${error.message}`);
  }
}

/**
 * Import RSA private key from Base64 (for decryption)
 */
export async function importRSAPrivateKey(base64Key) {
  try {
    // Ensure base64Key is a string
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error('RSA private key must be a valid base64 string');
    }
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
    throw new Error(`Failed to import RSA private key: ${error.message}`);
  }
}

/**
 * Import RSA private key from Base64 (for signing)
 */
export async function importRSAPrivateKeyForSigning(base64Key) {
  try {
    // Ensure base64Key is a string
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error('RSA private key must be a valid base64 string');
    }
    const keyData = base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'pkcs8',
      keyData,
      {
        name: 'RSA-PSS',
        hash: 'SHA-256'
      },
      false,
      ['sign']
    );
  } catch (error) {
    console.error('Error importing RSA private key for signing:', error);
    throw new Error(`Failed to import RSA private key for signing: ${error.message}`);
  }
}

/**
 * Import ECC public key from Base64
 */
export async function importECCPublicKey(base64Key) {
  try {
    // Ensure base64Key is a string
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error('ECC public key must be a valid base64 string');
    }
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
    throw new Error(`Failed to import ECC public key: ${error.message}`);
  }
}

/**
 * Import ECC private key from Base64
 */
export async function importECCPrivateKey(base64Key) {
  try {
    // Ensure base64Key is a string
    if (!base64Key || typeof base64Key !== 'string') {
      throw new Error('ECC private key must be a valid base64 string');
    }
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
    throw new Error(`Failed to import ECC private key: ${error.message}`);
  }
}

/**
 * Encrypt data with RSA-OAEP
 */
export async function encryptRSA(publicKey, data) {
  try {
    // Validate inputs
    if (!publicKey) {
      throw new Error('Public key is required but was null or undefined');
    }
    if (typeof publicKey !== 'string') {
      throw new Error(`Public key must be a base64 string, got type: ${typeof publicKey}`);
    }
    if (publicKey.trim().length === 0) {
      throw new Error('Public key is empty');
    }
    
    if (!data) {
      throw new Error('Data to encrypt is required but was null or undefined');
    }
    if (typeof data !== 'string') {
      throw new Error(`Data to encrypt must be a string, got type: ${typeof data}`);
    }
    
    // RSA-OAEP with 2048-bit key and SHA-256 can encrypt max ~214 bytes
    // Check if data is too large
    const dataBuffer = stringToArrayBuffer(data);
    const maxSize = 214; // Safe limit for 2048-bit RSA-OAEP with SHA-256
    
    if (dataBuffer.length > maxSize) {
      throw new Error(`Data too large for RSA encryption: ${dataBuffer.length} bytes (max: ${maxSize} bytes)`);
    }
    
    console.log('Encrypting with RSA:', {
      publicKeyLength: publicKey.length,
      publicKeyPreview: publicKey.substring(0, 50) + '...',
      dataLength: data.length,
      dataPreview: data.substring(0, 100) + (data.length > 100 ? '...' : '')
    });
    
    // Import the public key
    const key = await importRSAPublicKey(publicKey);
    
    // Encrypt
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
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    const errorMessage = error.message || error.toString() || 'Unknown error';
    throw new Error(`Failed to encrypt with RSA: ${errorMessage}`);
  }
}

/**
 * Decrypt data with RSA-OAEP
 */
export async function decryptRSA(privateKey, encryptedData) {
  try {
    // Ensure privateKey is a string
    if (typeof privateKey !== 'string') {
      throw new Error('Private key must be a base64 string');
    }
    if (typeof encryptedData !== 'string') {
      throw new Error('Encrypted data must be a base64 string');
    }
    
    console.log('🔐 decryptRSA called:');
    console.log('   encryptedData length:', encryptedData.length);
    console.log('   encryptedData preview:', encryptedData.substring(0, 100));
    
    const key = await importRSAPrivateKey(privateKey);
    console.log('   ✅ Private key imported');
    
    const encryptedBuffer = base64ToArrayBuffer(encryptedData);
    console.log('   ✅ Base64 decoded, buffer length:', encryptedBuffer.byteLength);
    
    // Validate buffer size (RSA-OAEP 2048-bit should be exactly 256 bytes)
    if (encryptedBuffer.byteLength !== 256) {
      throw new Error(`Invalid encrypted data size: ${encryptedBuffer.byteLength} bytes. Expected exactly 256 bytes for RSA-OAEP 2048-bit.`);
    }
    
    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'RSA-OAEP'
      },
      key,
      encryptedBuffer
    );
    console.log('   ✅ RSA decryption successful, decrypted length:', decrypted.byteLength);
    return arrayBufferToString(decrypted);
  } catch (error) {
    console.error('❌ Error decrypting with RSA:', error);
    console.error('   Error name:', error.name);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    
    // Provide more specific error messages
    if (error.message.includes('too small') || error.message.includes('The provided data is too small')) {
      throw new Error(`RSA decryption failed: Encrypted data is too small (${encryptedData.length} chars). This usually means the data was corrupted or truncated.`);
    } else if (error.message.includes('Invalid base64')) {
      throw new Error(`RSA decryption failed: Invalid base64 format. Data preview: ${encryptedData.substring(0, 50)}`);
    } else if (error.name === 'OperationError') {
      throw new Error(`RSA decryption failed: ${error.message}. This could indicate corrupted data or wrong key.`);
    }
    
    throw new Error(`Failed to decrypt with RSA: ${error.message}`);
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
    // Ensure sharedSecret is a string
    if (!sharedSecret || typeof sharedSecret !== 'string') {
      throw new Error('Shared secret must be a valid base64 string');
    }
    
    const secretBuffer = base64ToArrayBuffer(sharedSecret);
    
    // Handle salt - can be base64 string or already a buffer
    let saltBuffer;
    if (!salt) {
      saltBuffer = new Uint8Array(32);
    } else if (typeof salt === 'string') {
      saltBuffer = base64ToArrayBuffer(salt);
    } else if (salt instanceof Uint8Array || salt instanceof ArrayBuffer) {
      saltBuffer = salt instanceof ArrayBuffer ? new Uint8Array(salt) : salt;
    } else {
      throw new Error('Salt must be a base64 string, Uint8Array, or ArrayBuffer');
    }
    
    const infoBuffer = info ? stringToArrayBuffer(info) : new Uint8Array(0);

    // Import the shared secret as a key
    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      secretBuffer,
      { name: 'HKDF' },
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
    throw new Error(`Failed to derive AES key: ${error.message}`);
  }
}

/**
 * Encrypt message with AES-256-GCM
 */
export async function encryptAESGCM(key, plaintext) {
  try {
    // Validate key
    if (!key || !(key instanceof CryptoKey)) {
      throw new Error('Key must be a CryptoKey object');
    }
    if (key.algorithm.name !== 'AES-GCM') {
      throw new Error('Key algorithm must be AES-GCM');
    }
    
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
    throw new Error(`Failed to encrypt with AES-GCM: ${error.message}`);
  }
}

/**
 * Decrypt message with AES-256-GCM
 */
export async function decryptAESGCM(key, ciphertext, iv, tag) {
  try {
    // Validate key
    if (!key || !(key instanceof CryptoKey)) {
      throw new Error('Key must be a CryptoKey object');
    }
    if (key.algorithm.name !== 'AES-GCM') {
      throw new Error('Key algorithm must be AES-GCM');
    }
    
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
    throw new Error(`Failed to decrypt with AES-GCM: ${error.message}`);
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
    // Ensure privateKey is a string
    if (typeof privateKey !== 'string') {
      throw new Error('Private key must be a base64 string');
    }
    if (typeof data !== 'string') {
      throw new Error('Data to sign must be a string');
    }
    
    const key = await importRSAPrivateKeyForSigning(privateKey);
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
    throw new Error(`Failed to sign data: ${error.message}`);
  }
}

/**
 * Verify signature with RSA-PSS
 */
export async function verifySignature(publicKey, signature, data) {
  try {
    const key = await importRSAPublicKeyForVerification(publicKey);
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

