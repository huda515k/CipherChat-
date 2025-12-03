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
  importECCPublicKey,
  arrayBufferToBase64,
  base64ToArrayBuffer
} from './crypto';
import { storeSessionKey, getSessionKey, storeTempECDHKey, getTempECDHKey, clearTempECDHKey } from './keyStorage';

/**
 * Hybrid encryption: Encrypt large data with AES, then encrypt AES key with RSA
 */
async function hybridEncrypt(rsaPublicKey, data) {
  // Generate a random AES key for this encryption
  const aesKey = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256
    },
    true, // extractable
    ['encrypt']
  );

  // Generate random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt data with AES
  const dataBuffer = new TextEncoder().encode(data);
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    aesKey,
    dataBuffer
  );

  // Export AES key and encrypt it with RSA
  const exportedAESKey = await window.crypto.subtle.exportKey('raw', aesKey);
  const aesKeyBase64 = arrayBufferToBase64(exportedAESKey);
  
  // Encrypt AES key with RSA (this is small enough)
  const encryptedAESKey = await encryptRSA(rsaPublicKey, aesKeyBase64);

  // Get authentication tag (last 16 bytes of encrypted data)
  const tag = new Uint8Array(encrypted).slice(-16);
  const ciphertext = new Uint8Array(encrypted).slice(0, -16);

  const result = {
    encryptedData: arrayBufferToBase64(ciphertext),
    encryptedKey: encryptedAESKey,
    iv: arrayBufferToBase64(iv),
    tag: arrayBufferToBase64(tag)
  };
  
  // Validate the encryptedKey before returning
  console.log('🔐 Hybrid encryption result:');
  console.log('   encryptedKey length:', result.encryptedKey.length);
  console.log('   encryptedKey preview:', result.encryptedKey.substring(0, 50));
  
  // Verify encryptedKey decodes to 256 bytes
  try {
    const testBuffer = base64ToArrayBuffer(result.encryptedKey);
    if (testBuffer.byteLength !== 256) {
      console.error(`❌ CRITICAL: encryptedKey is wrong size! ${testBuffer.byteLength} bytes instead of 256`);
      throw new Error(`Generated encryptedKey is wrong size: ${testBuffer.byteLength} bytes (expected 256)`);
    }
    console.log('   ✅ encryptedKey size correct (256 bytes)');
  } catch (e) {
    console.error('❌ Failed to validate encryptedKey:', e.message);
    throw e;
  }
  
  return result;
}

/**
 * Validate and repair encryptedKey if possible
 */
function validateAndRepairEncryptedKey(encryptedData) {
  console.log('🔍 Validating encrypted data...');
  
  if (!encryptedData || typeof encryptedData !== 'object') {
    throw new Error('Invalid encrypted data structure');
  }
  
  const { encryptedKey, encryptedData: data, iv, tag } = encryptedData;
  
  // Check all required fields exist
  if (!encryptedKey || !data || !iv || !tag) {
    const missing = [];
    if (!encryptedKey) missing.push('encryptedKey');
    if (!data) missing.push('encryptedData');
    if (!iv) missing.push('iv');
    if (!tag) missing.push('tag');
    throw new Error(`Missing fields: ${missing.join(', ')}`);
  }
  
  // Validate encryptedKey
  let cleanKey = String(encryptedKey).trim().replace(/\s/g, '');
  
  console.log('   Original encryptedKey length:', encryptedKey.length);
  console.log('   Cleaned encryptedKey length:', cleanKey.length);
  
  // RSA-OAEP 2048-bit produces 256 bytes = 344 base64 chars
  if (cleanKey.length < 300) {
    console.error('❌ CRITICAL: encryptedKey is too short!');
    console.error('   Length:', cleanKey.length);
    console.error('   Expected: ~344');
    throw new Error(`encryptedKey is corrupted (${cleanKey.length} chars, expected ~344). This is a MongoDB storage issue - the data was truncated when saved to the database. You need to update your MongoDB schema to prevent truncation.`);
  }
  
  // Validate base64
  if (!/^[A-Za-z0-9+/=]+$/.test(cleanKey)) {
    throw new Error('encryptedKey contains invalid base64 characters');
  }
  
  // Test decode will be done in async context with proper import
  
  console.log('   ✅ encryptedKey validated successfully');
  
  return {
    encryptedKey: cleanKey,
    encryptedData: String(data).trim().replace(/\s/g, ''),
    iv: String(iv).trim().replace(/\s/g, ''),
    tag: String(tag).trim().replace(/\s/g, '')
  };
}

/**
 * Hybrid decryption: Decrypt RSA-encrypted AES key, then decrypt data with AES
 */
async function hybridDecrypt(rsaPrivateKey, encryptedData) {
  try {
    console.log('🔐 Starting hybrid decryption...');
    console.log('   encryptedKey length:', encryptedData.encryptedKey?.length || 0);
    console.log('   encryptedKey preview:', encryptedData.encryptedKey?.substring(0, 50) || 'N/A');
    console.log('   encryptedData length:', encryptedData.encryptedData?.length || 0);
    
    // Early validation - if encryptedKey is too short, it's corrupted
    if (!encryptedData.encryptedKey || encryptedData.encryptedKey.length < 300) {
      throw new Error(`Corrupted data: encryptedKey too short (${encryptedData.encryptedKey?.length || 0} chars, expected >= 300)`);
    }
    console.log('   iv length:', encryptedData.iv?.length || 0);
    console.log('   tag length:', encryptedData.tag?.length || 0);
    
    // Validate all required fields
    if (!encryptedData.encryptedKey || !encryptedData.encryptedData || !encryptedData.iv || !encryptedData.tag) {
      throw new Error(`Missing required fields in hybrid encrypted data. Has: ${Object.keys(encryptedData).join(', ')}`);
    }
    
    // Decrypt AES key with RSA
    console.log('🔑 Step 1: Decrypting AES key with RSA...');
    console.log('   encryptedKey type:', typeof encryptedData.encryptedKey);
    console.log('   encryptedKey length:', encryptedData.encryptedKey?.length || 0);
    console.log('   encryptedKey preview:', encryptedData.encryptedKey?.substring(0, 100) || 'N/A');
    
    // Validate encryptedKey is a non-empty string
    if (!encryptedData.encryptedKey || typeof encryptedData.encryptedKey !== 'string' || encryptedData.encryptedKey.trim().length === 0) {
      throw new Error(`Invalid encryptedKey: must be a non-empty base64 string. Got: ${typeof encryptedData.encryptedKey}, length: ${encryptedData.encryptedKey?.length || 0}`);
    }
    
    // Clean the key - remove all whitespace, newlines, and ensure it's a single line
    let cleanedKey = encryptedData.encryptedKey.trim();
    cleanedKey = cleanedKey.replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, '');
    
    console.log('   After cleaning:');
    console.log('   Original length:', encryptedData.encryptedKey.length);
    console.log('   Cleaned length:', cleanedKey.length);
    
    // CRITICAL: Validate the cleaned key length before attempting decryption
    // RSA-OAEP with 2048-bit keys produces 256 bytes = 344 base64 characters (with padding)
    // Minimum should be around 340 characters for valid RSA-OAEP encrypted data
    if (cleanedKey.length < 300) {
      console.error('❌ CRITICAL: encryptedKey is too short after cleaning!');
      console.error('   Original length:', encryptedData.encryptedKey.length);
      console.error('   Cleaned length:', cleanedKey.length);
      console.error('   Expected: ~344 characters for 256-byte RSA-OAEP');
      console.error('   Original value (first 200):', encryptedData.encryptedKey.substring(0, 200));
      console.error('   Original value (last 200):', encryptedData.encryptedKey.substring(Math.max(0, encryptedData.encryptedKey.length - 200)));
      throw new Error(`encryptedKey is too short after cleaning: ${cleanedKey.length} chars (expected ~344). Original: ${encryptedData.encryptedKey.length} chars. This suggests severe data corruption or truncation.`);
    }
    
    // Validate it's valid base64
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    if (!base64Regex.test(cleanedKey)) {
      const invalidChars = cleanedKey.match(/[^A-Za-z0-9+/=]/g);
      console.error('❌ Invalid base64 characters found:', invalidChars?.slice(0, 10));
      throw new Error(`encryptedKey contains invalid base64 characters after cleaning. Invalid chars: ${invalidChars?.slice(0, 10).join(', ') || 'unknown'}`);
    }
    
    // Decode base64 to check actual byte length
    try {
      const testBuffer = base64ToArrayBuffer(cleanedKey);
      console.log('   Decoded byte length:', testBuffer.byteLength);
      if (testBuffer.byteLength !== 256) {
        console.error(`❌ CRITICAL: Decoded encryptedKey is wrong size!`);
        console.error(`   Expected: 256 bytes (RSA-OAEP 2048-bit)`);
        console.error(`   Got: ${testBuffer.byteLength} bytes`);
        if (testBuffer.byteLength < 256) {
          throw new Error(`encryptedKey decodes to ${testBuffer.byteLength} bytes, which is too small for RSA-OAEP decryption (expected 256 bytes). This indicates data truncation or corruption.`);
        } else {
          throw new Error(`encryptedKey decodes to ${testBuffer.byteLength} bytes, which is larger than expected (256 bytes). This indicates data corruption.`);
        }
      }
      console.log('   ✅ encryptedKey size correct (256 bytes)');
    } catch (decodeError) {
      if (decodeError.message.includes('too small') || decodeError.message.includes('truncation')) {
        throw decodeError;
      }
      console.error('   ⚠️ Failed to decode base64 (will try anyway):', decodeError.message);
    }
    console.log('   Length difference:', encryptedData.encryptedKey.length - cleanedKey.length);
    
    // Check minimum length (RSA-OAEP 2048-bit encrypted data should be exactly 344 base64 chars for 256 bytes)
    if (cleanedKey.length < 300) {
      throw new Error(`encryptedKey is too short after cleaning (${cleanedKey.length} chars). Expected at least 300 chars (ideally 344) for RSA-OAEP 2048-bit. This suggests the key was corrupted or truncated.`);
    }
    
    // Check if it looks like base64 (basic validation)
    const base64Pattern = /^[A-Za-z0-9+/=]+$/;
    if (!base64Pattern.test(cleanedKey)) {
      const invalidChars = cleanedKey.match(/[^A-Za-z0-9+/=]/g);
      console.error('   Invalid characters found:', invalidChars);
      throw new Error(`encryptedKey does not appear to be valid base64. Invalid characters found. Preview: ${cleanedKey.substring(0, 50)}`);
    }
    
    const trimmedKey = cleanedKey;
    
    // Validate base64 decodes to exactly 256 bytes (RSA-OAEP 2048-bit requirement)
    let testBuffer;
    try {
      testBuffer = base64ToArrayBuffer(trimmedKey);
      console.log('   ✅ Base64 validation passed');
      console.log('   Decoded buffer length:', testBuffer.byteLength, 'bytes');
      
      if (testBuffer.byteLength !== 256) {
        console.error(`❌ Buffer size mismatch! Expected 256 bytes, got ${testBuffer.byteLength} bytes`);
        console.error('   This means the encryptedKey was corrupted or truncated');
        console.error('   encryptedKey length (base64):', trimmedKey.length);
        console.error('   encryptedKey first 100:', trimmedKey.substring(0, 100));
        console.error('   encryptedKey last 100:', trimmedKey.substring(trimmedKey.length - 100));
        throw new Error(`encryptedKey decodes to ${testBuffer.byteLength} bytes, but RSA-OAEP 2048-bit requires exactly 256 bytes. This indicates corrupted or invalid data.`);
      }
      console.log('   ✅ Buffer size validation passed (256 bytes)');
    } catch (base64Error) {
      console.error('❌ Base64 validation failed:', base64Error.message);
      console.error('   encryptedKey length:', trimmedKey.length);
      console.error('   encryptedKey preview:', trimmedKey.substring(0, 200));
      throw new Error(`encryptedKey validation failed: ${base64Error.message}`);
    }
    
    // Double-check: verify the buffer is exactly what we'll decrypt
    if (testBuffer.byteLength !== 256) {
      throw new Error(`CRITICAL: Buffer size is ${testBuffer.byteLength} bytes, not 256! Data is corrupted.`);
    }
    
    let aesKeyBase64;
    try {
      console.log('   🔐 Attempting RSA decryption...');
      console.log('   Using private key length:', rsaPrivateKey.length);
      console.log('   Encrypted data buffer size:', testBuffer.byteLength, 'bytes');
      
      aesKeyBase64 = await decryptRSA(rsaPrivateKey, trimmedKey);
      console.log('✅ AES key decrypted successfully, length:', aesKeyBase64.length);
      
      // Validate decrypted AES key is correct size (32 bytes = 256 bits)
      const aesKeyBuffer = base64ToArrayBuffer(aesKeyBase64);
      if (aesKeyBuffer.byteLength !== 32) {
        throw new Error(`Decrypted AES key is wrong size: ${aesKeyBuffer.byteLength} bytes (expected 32 bytes)`);
      }
      console.log('   ✅ Decrypted AES key size correct (32 bytes)');
    } catch (rsaError) {
      console.error('❌❌❌ RSA DECRYPTION FAILED ❌❌❌');
      console.error('   Error name:', rsaError.name);
      console.error('   Error message:', rsaError.message);
      console.error('   Error type:', rsaError.constructor.name);
      console.error('   encryptedKey type:', typeof encryptedData.encryptedKey);
      console.error('   encryptedKey length (base64):', trimmedKey.length);
      console.error('   encryptedKey decodes to:', testBuffer.byteLength, 'bytes');
      console.error('   encryptedKey first 200 chars:', trimmedKey.substring(0, 200));
      console.error('   encryptedKey last 50 chars:', trimmedKey.substring(trimmedKey.length - 50));
      console.error('   Private key length:', rsaPrivateKey.length);
      console.error('   Private key preview:', rsaPrivateKey.substring(0, 50));
      
      // Check if it's a key mismatch issue
      if (rsaError.message.includes('operation-specific') || rsaError.message.includes('too small')) {
        throw new Error(`RSA decryption failed: The encryptedKey cannot be decrypted with this private key. This might indicate: 1) Wrong private key being used, 2) Data corruption, or 3) Key mismatch. encryptedKey length: ${trimmedKey.length}, decodes to: ${testBuffer.byteLength} bytes`);
      }
      
      // Re-throw with more context
      throw rsaError;
    }
    
    console.log('🔑 Step 2: Converting AES key to buffer...');
    const aesKeyBuffer = base64ToArrayBuffer(aesKeyBase64);
    console.log('   AES key buffer length:', aesKeyBuffer.byteLength);

    // Import AES key
    console.log('🔑 Step 3: Importing AES key...');
    const aesKey = await window.crypto.subtle.importKey(
      'raw',
      aesKeyBuffer,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['decrypt']
    );
    console.log('✅ AES key imported');

    // Decrypt data with AES
    console.log('🔐 Step 4: Decrypting data with AES...');
    const iv = base64ToArrayBuffer(encryptedData.iv);
    const tag = base64ToArrayBuffer(encryptedData.tag);
    const ciphertext = base64ToArrayBuffer(encryptedData.encryptedData);
    
    console.log('   IV length:', iv.byteLength);
    console.log('   Tag length:', tag.byteLength);
    console.log('   Ciphertext length:', ciphertext.byteLength);

    // Combine ciphertext and tag
    const encrypted = new Uint8Array(ciphertext.length + tag.length);
    encrypted.set(ciphertext, 0);
    encrypted.set(tag, ciphertext.length);

    const decrypted = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      aesKey,
      encrypted
    );

    console.log('✅✅✅ Hybrid decryption successful ✅✅✅');
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('❌❌❌ Hybrid decryption failed ❌❌❌');
    console.error('   Error:', error.message);
    console.error('   Error stack:', error.stack);
    throw error;
  }
}

/**
 * Step 1: Initiate key exchange (Alice's side)
 */
export async function initiateKeyExchange(rsaPrivateKey, targetPublicKey) {
  try {
    // Ensure keys are strings
    if (typeof rsaPrivateKey !== 'string') {
      throw new Error('RSA private key must be a base64 string');
    }
    if (typeof targetPublicKey !== 'string') {
      throw new Error('Target public key must be a base64 string');
    }
    
    // Generate ECDH key pair
    const ecdhKeyPair = await generateECCKeyPair();
    
    // Create key exchange message
    // Note: RSA-OAEP can only encrypt ~214 bytes, so we keep the message minimal
    const message = {
      type: 'KEY_EXCHANGE_INIT',
      publicKey: ecdhKeyPair.publicKey,
      timestamp: Date.now(),
      nonce: generateNonce()
    };

    const messageString = JSON.stringify(message);
    
    // Sign the message
    const signature = await signData(rsaPrivateKey, messageString);
    
    // ALWAYS use hybrid encryption for reliability and to avoid size issues
    console.log('Using hybrid encryption for key exchange init');
    const hybrid = await hybridEncrypt(targetPublicKey, messageString);
    
    // Validate encryptedKey before stringifying
    if (!hybrid.encryptedKey || hybrid.encryptedKey.length < 300) {
      throw new Error(`Generated encryptedKey is too short: ${hybrid.encryptedKey?.length || 0} chars`);
    }
    
    // Stringify and verify it can be parsed back
    let encrypted = JSON.stringify(hybrid);
    const verify = JSON.parse(encrypted);
    if (verify.encryptedKey.length !== hybrid.encryptedKey.length) {
      throw new Error(`encryptedKey corrupted during JSON stringify!`);
    }
    
    console.log('✅ Init encrypted and validated');

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
    // Ensure keys are strings
    if (typeof rsaPrivateKey !== 'string') {
      throw new Error('RSA private key must be a base64 string');
    }
    if (typeof initiatorRSAPublicKey !== 'string') {
      throw new Error('Initiator RSA public key must be a base64 string');
    }
    
    // Decrypt initiator's message (check if it's hybrid encrypted)
    let decrypted;
    
    // Ensure it's a string
    if (typeof encryptedInitMessage !== 'string') {
      encryptedInitMessage = String(encryptedInitMessage);
    }
    
    // Trim whitespace
    const trimmedMessage = encryptedInitMessage.trim();
    console.log('🔍 Analyzing encrypted message:');
    console.log('   Type:', typeof encryptedInitMessage);
    console.log('   Length:', trimmedMessage.length);
    console.log('   First 100 chars:', trimmedMessage.substring(0, 100));
    console.log('   Starts with {?', trimmedMessage.startsWith('{'));
    
    // Check if it's a JSON string (hybrid encryption) by looking at first character
    const isJsonString = trimmedMessage.startsWith('{');
    
    if (isJsonString) {
      console.log('📦 Detected JSON format - attempting hybrid decryption...');
      try {
        // Try parsing as JSON (hybrid encryption)
        const hybridData = JSON.parse(trimmedMessage);
        console.log('✅ JSON parsed successfully');
        console.log('   Has encryptedKey?', !!hybridData.encryptedKey);
        console.log('   Has encryptedData?', !!hybridData.encryptedData);
        console.log('   Has iv?', !!hybridData.iv);
        console.log('   Has tag?', !!hybridData.tag);
        console.log('   All keys:', Object.keys(hybridData));
        
        // Validate and clean the hybrid data - CRITICAL: Clean all base64 strings
        if (!hybridData.encryptedKey || typeof hybridData.encryptedKey !== 'string') {
          throw new Error(`Invalid encryptedKey in hybrid data: ${typeof hybridData.encryptedKey}`);
        }
        if (!hybridData.encryptedData || typeof hybridData.encryptedData !== 'string') {
          throw new Error(`Invalid encryptedData in hybrid data: ${typeof hybridData.encryptedData}`);
        }
        if (!hybridData.iv || typeof hybridData.iv !== 'string') {
          throw new Error(`Invalid iv in hybrid data: ${typeof hybridData.iv}`);
        }
        if (!hybridData.tag || typeof hybridData.tag !== 'string') {
          throw new Error(`Invalid tag in hybrid data: ${typeof hybridData.tag}`);
        }
        
        // CRITICAL: Clean all base64 strings - remove any whitespace/newlines that might have been added
        // Also handle case where MongoDB might have stored it as an object
        let encryptedKeyStr = hybridData.encryptedKey;
        if (typeof encryptedKeyStr !== 'string') {
          console.log('⚠️ encryptedKey is not a string, converting...');
          encryptedKeyStr = String(encryptedKeyStr);
        }
        
        // CRITICAL: Validate encryptedKey length BEFORE cleaning
        const originalEncryptedKeyLength = encryptedKeyStr.length;
        console.log('   Original encryptedKey length:', originalEncryptedKeyLength);
        if (originalEncryptedKeyLength < 300) {
          console.error('❌ CRITICAL: encryptedKey is too short BEFORE cleaning!');
          console.error('   Length:', originalEncryptedKeyLength);
          console.error('   First 200 chars:', encryptedKeyStr.substring(0, 200));
          console.error('   Last 200 chars:', encryptedKeyStr.substring(Math.max(0, encryptedKeyStr.length - 200)));
          throw new Error(`encryptedKey is too short (${originalEncryptedKeyLength} chars) before cleaning. Data was truncated in MongoDB or during transmission. Expected ~344 chars for 256-byte RSA-OAEP.`);
        }
        
        // Clean whitespace but preserve the actual base64 characters
        encryptedKeyStr = encryptedKeyStr.trim().replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, '');
        
        // Validate after cleaning
        if (encryptedKeyStr.length < 300) {
          console.error('❌ CRITICAL: encryptedKey is too short AFTER cleaning!');
          console.error('   Original length:', originalEncryptedKeyLength);
          console.error('   Cleaned length:', encryptedKeyStr.length);
          console.error('   Difference:', originalEncryptedKeyLength - encryptedKeyStr.length);
          throw new Error(`encryptedKey is too short (${encryptedKeyStr.length} chars) after cleaning. Original was ${originalEncryptedKeyLength} chars. This indicates severe data corruption.`);
        }
        
        // Validate it decodes to 256 bytes - use the actual base64ToArrayBuffer function
        try {
          const { base64ToArrayBuffer } = await import('./crypto');
          const testDecode = base64ToArrayBuffer(encryptedKeyStr);
          if (testDecode.byteLength !== 256) {
            console.error(`❌ encryptedKey decodes to wrong size: ${testDecode.byteLength} bytes (expected 256)`);
            console.error(`   Base64 length: ${encryptedKeyStr.length} chars`);
            console.error(`   First 100 chars: ${encryptedKeyStr.substring(0, 100)}`);
            console.error(`   Last 100 chars: ${encryptedKeyStr.substring(encryptedKeyStr.length - 100)}`);
            throw new Error(`encryptedKey decodes to ${testDecode.byteLength} bytes, not 256. Data is corrupted or truncated. Base64 length: ${encryptedKeyStr.length} chars.`);
          }
          console.log('   ✅ encryptedKey validates: decodes to 256 bytes');
        } catch (decodeError) {
          if (decodeError.message.includes('truncated') || decodeError.message.includes('256') || decodeError.message.includes('corrupted')) {
            throw decodeError;
          }
          console.error('   ⚠️ Decode validation warning:', decodeError.message);
        }
        
        let encryptedDataStr = hybridData.encryptedData;
        if (typeof encryptedDataStr !== 'string') {
          encryptedDataStr = String(encryptedDataStr);
        }
        
        let ivStr = hybridData.iv;
        if (typeof ivStr !== 'string') {
          ivStr = String(ivStr);
        }
        
        let tagStr = hybridData.tag;
        if (typeof tagStr !== 'string') {
          tagStr = String(tagStr);
        }
        
        // Use cleaned data for all fields
        const cleanedHybridData = {
          encryptedKey: encryptedKeyStr,
          encryptedData: encryptedDataStr.trim().replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, ''),
          iv: ivStr.trim().replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, ''),
          tag: tagStr.trim().replace(/\s/g, '').replace(/\n/g, '').replace(/\r/g, '')
        };
        
        // Log the encryptedKey details before decryption
        console.log('   encryptedKey type (original):', typeof hybridData.encryptedKey);
        console.log('   encryptedKey type (cleaned):', typeof cleanedHybridData.encryptedKey);
        console.log('   encryptedKey length (original):', hybridData.encryptedKey.length);
        console.log('   encryptedKey length (cleaned):', cleanedHybridData.encryptedKey.length);
        console.log('   Length difference:', hybridData.encryptedKey.length - cleanedHybridData.encryptedKey.length);
        console.log('   encryptedKey preview:', cleanedHybridData.encryptedKey.substring(0, 100));
        console.log('   encryptedKey last 50:', cleanedHybridData.encryptedKey.substring(cleanedHybridData.encryptedKey.length - 50));
        
        // Validate cleaned encryptedKey length BEFORE attempting decryption
        if (cleanedHybridData.encryptedKey.length < 300) {
          console.error('❌ CRITICAL: encryptedKey too short after cleaning!');
          console.error('   Original length:', hybridData.encryptedKey.length);
          console.error('   Cleaned length:', cleanedHybridData.encryptedKey.length);
          console.error('   Expected: ~344 characters for 256-byte RSA-OAEP');
          console.error('   Original value (first 200):', hybridData.encryptedKey.substring(0, 200));
          console.error('   Original value (last 200):', hybridData.encryptedKey.substring(Math.max(0, hybridData.encryptedKey.length - 200)));
          throw new Error(`encryptedKey is too short after cleaning: ${cleanedHybridData.encryptedKey.length} chars (expected ~344). Original: ${hybridData.encryptedKey.length} chars. This suggests data truncation or corruption. The encryptedKey may have been truncated when stored in MongoDB or transmitted.`);
        }
        
        // Validate it's valid base64
        const base64Test = /^[A-Za-z0-9+/=]+$/;
        if (!base64Test.test(cleanedHybridData.encryptedKey)) {
          const invalidChars = cleanedHybridData.encryptedKey.match(/[^A-Za-z0-9+/=]/g);
          console.error('❌ Invalid base64 characters found:', invalidChars?.slice(0, 10));
          throw new Error(`encryptedKey contains invalid base64 characters after cleaning. Invalid chars: ${invalidChars?.slice(0, 10).join(', ') || 'unknown'}`);
        }
        
        // CRITICAL: Validate the encryptedKey decodes to exactly 256 bytes BEFORE attempting RSA decryption
        try {
          const { base64ToArrayBuffer } = await import('./crypto');
          const testBuffer = base64ToArrayBuffer(cleanedHybridData.encryptedKey);
          if (testBuffer.byteLength !== 256) {
            console.error(`❌ CRITICAL: encryptedKey decodes to wrong size!`);
            console.error(`   Expected: 256 bytes (RSA-OAEP 2048-bit)`);
            console.error(`   Got: ${testBuffer.byteLength} bytes`);
            console.error(`   Base64 length: ${cleanedHybridData.encryptedKey.length} chars`);
            console.error(`   First 100 chars: ${cleanedHybridData.encryptedKey.substring(0, 100)}`);
            console.error(`   Last 100 chars: ${cleanedHybridData.encryptedKey.substring(cleanedHybridData.encryptedKey.length - 100)}`);
            throw new Error(`encryptedKey decodes to ${testBuffer.byteLength} bytes, but RSA-OAEP requires exactly 256 bytes. This indicates data truncation or corruption. The data may have been truncated when stored in MongoDB (String fields have size limits) or during transmission. Base64 length: ${cleanedHybridData.encryptedKey.length} chars.`);
          }
          console.log('   ✅ encryptedKey size validation passed (256 bytes)');
        } catch (sizeError) {
          if (sizeError.message.includes('truncation') || sizeError.message.includes('256 bytes') || sizeError.message.includes('corrupted')) {
            throw sizeError;
          }
          console.warn('   ⚠️ Size validation warning:', sizeError.message);
        }
        
        if (cleanedHybridData.encryptedKey && cleanedHybridData.encryptedData && cleanedHybridData.iv && cleanedHybridData.tag) {
          console.log('✅✅✅ All hybrid fields present and validated, using hybridDecrypt ✅✅✅');
          decrypted = await hybridDecrypt(rsaPrivateKey, cleanedHybridData);
          console.log('✅ Hybrid decryption successful');
        } else {
          // JSON but not hybrid format - this is an error, not a fallback case
          const missingFields = [];
          if (!hybridData.encryptedKey) missingFields.push('encryptedKey');
          if (!hybridData.encryptedData) missingFields.push('encryptedData');
          if (!hybridData.iv) missingFields.push('iv');
          if (!hybridData.tag) missingFields.push('tag');
          throw new Error(`JSON format detected but missing hybrid encryption fields: ${missingFields.join(', ')}. Available fields: ${Object.keys(hybridData).join(', ')}`);
        }
      } catch (parseError) {
        // If it's a JSON parse error, the message is malformed JSON
        if (parseError instanceof SyntaxError) {
          console.error('❌ JSON parse error:', parseError.message);
          throw new Error(`Failed to parse encrypted message as JSON: ${parseError.message}. Message preview: ${trimmedMessage.substring(0, 200)}`);
        }
        // If it's a decryption error from hybridDecrypt, re-throw it with context
        console.error('❌ Hybrid decryption error:', parseError.message);
        throw parseError;
      }
    } else {
      // Not JSON string, try direct RSA decryption
      console.log('✅ Not JSON format, using direct RSA decryption');
      decrypted = await decryptRSA(rsaPrivateKey, trimmedMessage);
    }
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
    // Note: RSA-OAEP can only encrypt ~214 bytes, so we keep the message minimal
    const responseMessage = {
      type: 'KEY_EXCHANGE_RESPONSE',
      publicKey: ecdhKeyPair.publicKey,
      sharedSecretHash: await hashSHA256(sharedSecret), // Send hash for verification
      timestamp: Date.now(),
      nonce: generateNonce()
    };

    const responseString = JSON.stringify(responseMessage);
    
    // Check message size - use hybrid encryption if too large
    const responseSize = new TextEncoder().encode(responseString).length;
    console.log('Key exchange response message size:', responseSize, 'bytes');
    
    // Sign the response
    const responseSignature = await signData(rsaPrivateKey, responseString);
    
    // ALWAYS use hybrid encryption for reliability
    console.log('Using hybrid encryption for key exchange response');
    const hybrid = await hybridEncrypt(initiatorRSAPublicKey, responseString);
    
    // Validate encryptedKey before stringifying
    if (!hybrid.encryptedKey || hybrid.encryptedKey.length < 300) {
      throw new Error(`Generated encryptedKey is too short: ${hybrid.encryptedKey?.length || 0} chars`);
    }
    
    // Stringify and verify it can be parsed back
    let encryptedResponse = JSON.stringify(hybrid);
    const verify = JSON.parse(encryptedResponse);
    if (verify.encryptedKey.length !== hybrid.encryptedKey.length) {
      throw new Error(`encryptedKey corrupted during JSON stringify!`);
    }
    
    console.log('✅ Response encrypted and validated');

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
  initiatorECDHPrivateKeyBase64,
  encryptedResponse,
  responseSignature,
  responderRSAPublicKey
) {
  try {
    // Ensure keys are strings
    if (typeof rsaPrivateKey !== 'string') {
      throw new Error('RSA private key must be a base64 string');
    }
    if (typeof initiatorECDHPrivateKeyBase64 !== 'string') {
      throw new Error('ECDH private key must be a base64 string');
    }
    if (typeof responderRSAPublicKey !== 'string') {
      throw new Error('Responder RSA public key must be a base64 string');
    }
    
    // Decrypt response (check if it's hybrid encrypted)
    let decrypted;
    
    // Check if it's a JSON string (hybrid encryption) by looking at first character
    const isJsonString = typeof encryptedResponse === 'string' && 
                         encryptedResponse.trim().startsWith('{');
    
    if (isJsonString) {
      try {
        // Try parsing as JSON (hybrid encryption)
        const hybridData = JSON.parse(encryptedResponse);
        if (hybridData.encryptedKey && hybridData.encryptedData && hybridData.iv && hybridData.tag) {
          console.log('✅ Detected hybrid encrypted response, decrypting...');
          decrypted = await hybridDecrypt(rsaPrivateKey, hybridData);
        } else {
          // JSON but not hybrid format, try direct RSA decryption
          console.log('⚠️ JSON format but not hybrid encryption, trying direct RSA decryption');
          decrypted = await decryptRSA(rsaPrivateKey, encryptedResponse);
        }
      } catch (parseError) {
        // JSON parse failed, try direct RSA decryption
        console.log('⚠️ Failed to parse as JSON, trying direct RSA decryption:', parseError.message);
        decrypted = await decryptRSA(rsaPrivateKey, encryptedResponse);
      }
    } else {
      // Not JSON string, try direct RSA decryption
      console.log('✅ Not JSON format, using direct RSA decryption');
      decrypted = await decryptRSA(rsaPrivateKey, encryptedResponse);
    }
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
      initiatorECDHPrivateKeyBase64,
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
    
    // Note: Session key is derived but not stored directly - we store the sharedSecret
    // and derive the session key on-demand using the same salt

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
/**
 * Enhanced polling that works with your API structure
 */
async function pollKeyExchange(keyExchangeId, apiCall) {
  try {
    // Try multiple methods to fetch data
    let response;
    
    // Method 1: Try apiCall.get if it exists
    if (apiCall && typeof apiCall.get === 'function') {
      console.log('   📡 Polling via apiCall.get...');
      response = await apiCall.get(`/key-exchange/${keyExchangeId}`);
      return response.data;
    }
    
    // Method 2: Try direct fetch with token from localStorage
    console.log('   📡 Polling via fetch...');
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    
    if (!token) {
      console.error('   ❌ No auth token found in localStorage');
      return null;
    }
    
    const apiBaseUrl = process.env.REACT_APP_API_URL || 
      (window.location.protocol === 'https:' ? 'https://localhost:5001/api' : 'http://localhost:5001/api');
    
    const fetchResponse = await fetch(`${apiBaseUrl}/key-exchange/${keyExchangeId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!fetchResponse.ok) {
      console.error(`   ❌ Fetch failed: ${fetchResponse.status} ${fetchResponse.statusText}`);
      return null;
    }
    
    const data = await fetchResponse.json();
    console.log('   ✅ Polling successful');
    return data;
    
  } catch (error) {
    console.error('   ⚠️ Polling error:', error.message);
    return null;
  }
}

/**
 * Test socket connection and emit a test event
 */
function testSocketConnection(socket, userId) {
  console.log('🔌 Testing socket connection...');
  console.log('   Socket exists:', !!socket);
  console.log('   Socket connected:', socket?.connected);
  console.log('   Socket id:', socket?.id);
  
  if (socket && socket.connected) {
    // Test emit
    socket.emit('test-ping', { userId, timestamp: Date.now() });
    console.log('   ✅ Test event emitted');
    
    // Check what events are registered
    console.log('   Registered events:', Object.keys(socket._callbacks || {}));
    
    return true;
  }
  
  console.warn('   ⚠️ Socket not ready for communication');
  return false;
}

/**
 * COMPREHENSIVE FIX: Key Exchange with Extensive Debugging
 * 
 * This version adds detailed logging to identify WHERE the timeout occurs
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
    console.log('🚀 Starting full key exchange protocol...');
    console.log('   User ID:', userId);
    console.log('   Target User ID:', targetUserId);
    console.log('   Socket connected:', socket?.connected);
    console.log('   Socket ID:', socket?.id);
    
    // Validate inputs
    if (typeof rsaPrivateKeyBase64 !== 'string') {
      throw new Error('RSA private key must be a base64 string');
    }
    if (typeof targetRSAPublicKeyBase64 !== 'string') {
      throw new Error('Target RSA public key must be a base64 string');
    }

    // Test socket connection
    const socketReady = testSocketConnection(socket, userId);

    // Step 1: Generate init message
    console.log('\n📤 STEP 1: Generating init message...');
    const init = await initiateKeyExchange(rsaPrivateKeyBase64, targetRSAPublicKeyBase64);
    console.log('✅ Init message generated');
    
    // Validate encrypted data
    const parsed = JSON.parse(init.encrypted);
    if (parsed.encryptedKey && parsed.encryptedKey.length < 300) {
      throw new Error(`Generated encryptedKey is too short: ${parsed.encryptedKey.length}`);
    }
    console.log('✅ Encrypted data validated');
    
    // Store ECDH key pair
    await storeTempECDHKey(userId, targetUserId, init.ecdhKeyPair, true);
    console.log('✅ ECDH key pair stored');

    // Step 2: Set up response handler BEFORE sending request
    console.log('\n👂 STEP 2: Setting up response listeners...');
    
    // Create a promise with an init method attached
    let keyExchangeIdForHandlers = null;
    let responseReceived = false;
    let pollInterval = null;
    let socketHandler = null;
    let timeout = null;
    
    // Response handler
    const handleResponse = async (data, source) => {
      if (responseReceived) {
        console.log(`   ⚠️ Duplicate response ignored (from ${source})`);
        return;
      }
      
      console.log('\n🎉🎉🎉 RESPONSE RECEIVED 🎉🎉🎉');
      console.log('Source:', source);
      console.log('Timestamp:', new Date().toISOString());
      console.log('Response keyExchangeId:', data.keyExchangeId);
      console.log('Expected keyExchangeId:', keyExchangeIdForHandlers);
      
      responseReceived = true;
      
      // Cleanup
      if (timeout) clearTimeout(timeout);
      if (pollInterval) clearInterval(pollInterval);
      if (socket && socketHandler) {
        socket.off('key-exchange-response', socketHandler);
      }

      try {
        console.log('\n🔐 STEP 3: Processing response...');
        
        // Get stored ECDH key pair
        const initiatorECDHKeyPair = await getTempECDHKey(userId, targetUserId, true);
        const initiatorECDHPrivateKeyBase64 = initiatorECDHKeyPair.privateKey;
        console.log('✅ Retrieved ECDH key pair');
        
        // Get target user's public key
        const targetUserResponse = await apiCall.get(`/users/${targetUserId}/public-key`);
        const responderRSAPublicKeyBase64 = targetUserResponse.data.publicKey;
        console.log('✅ Retrieved target public key');

        // Complete key exchange
        console.log('🔐 Completing key exchange...');
        const complete = await completeKeyExchange(
          rsaPrivateKeyBase64,
          initiatorECDHPrivateKeyBase64,
          data.encrypted,
          data.signature,
          responderRSAPublicKeyBase64
        );
        console.log('✅ Key exchange completed');

        // Store session
        await storeSessionKey(
          userId,
          targetUserId,
          '',
          complete.sharedSecret
        );
        console.log('✅ Session key stored');

        // Send confirmation
        console.log('📤 Sending confirmation...');
        await apiCall.post('/key-exchange/complete', {
          keyExchangeId: data.keyExchangeId,
          encryptedConfirmation: complete.confirmation.ciphertext,
          iv: complete.confirmation.iv,
          tag: complete.confirmation.tag
        });
        console.log('✅ Confirmation sent');

        // Cleanup
        await clearTempECDHKey(userId, targetUserId, true);
        console.log('✅ Temp keys cleaned up');

        console.log('\n═══════════════════════════════════════════════════════');
        console.log('✅✅✅ KEY EXCHANGE SUCCESSFUL ✅✅✅');
        console.log('═══════════════════════════════════════════════════════\n');
        
        resolvePromise({
          success: true,
          sharedSecret: complete.sharedSecret
        });
      } catch (error) {
        console.error('\n❌ ERROR processing response:', error);
        console.error('Error stack:', error.stack);
        rejectPromise(error);
      }
    };
    
    // Socket handler
    socketHandler = async (data) => {
      console.log('🔔 Socket event received');
      console.log('   Event data:', JSON.stringify(data, null, 2));
      console.log('   Response keyExchangeId:', data.keyExchangeId);
      console.log('   Expected keyExchangeId:', keyExchangeIdForHandlers);
      
      if (data.keyExchangeId === keyExchangeIdForHandlers && !responseReceived) {
        await handleResponse(data, 'socket');
      } else {
        console.log('   ⚠️ Event ignored (wrong ID or already received)');
      }
    };

    // Polling function
    const startPolling = () => {
      console.log('🔄 Starting polling (every 2s)...');
      let pollCount = 0;
      
      pollInterval = setInterval(async () => {
        if (responseReceived) {
          console.log('✅ Polling stopped (response received)');
          clearInterval(pollInterval);
          return;
        }

        pollCount++;
        console.log(`🔄 Poll #${pollCount} for exchange ${keyExchangeIdForHandlers}`);

        try {
          const result = await pollKeyExchange(keyExchangeIdForHandlers, apiCall);
          
          if (!result) {
            console.log('   ⚠️ No data returned from poll');
            return;
          }
          
          console.log('   📦 Poll result:', {
            hasKeyExchange: !!result.keyExchange,
            status: result.keyExchange?.status
          });
          
          if (result.keyExchange && result.keyExchange.status === 'RESPONDED' && !responseReceived) {
            console.log('   ✅ Response found via polling!');
            const exchange = result.keyExchange;
            await handleResponse({
              keyExchangeId: keyExchangeIdForHandlers,
              encrypted: exchange.encryptedResponse,
              signature: exchange.responseSignature,
              ecdhPublicKey: exchange.responderECDHPublicKey
            }, 'polling');
          }
        } catch (error) {
          console.error('   ❌ Poll error:', error.message);
        }
      }, 2000); // Poll every 2 seconds
    };

    // Timeout handler
    const startTimeout = () => {
      timeout = setTimeout(() => {
        if (!responseReceived) {
          console.error('\n❌❌❌ KEY EXCHANGE TIMEOUT ❌❌❌');
          console.error('Duration: 60 seconds');
          console.error('Key exchange ID:', keyExchangeIdForHandlers);
          console.error('Socket connected:', socket?.connected);
          console.error('Socket ID:', socket?.id);
          console.error('Target user ID:', targetUserId);
          console.error('───────────────────────────────────────────────────────');
          console.error('Possible causes:');
          console.error('1. Target user is not online');
          console.error('2. Socket connection issues');
          console.error('3. Server not emitting events properly');
          console.error('4. Database/API errors on server');
          console.error('═══════════════════════════════════════════════════════\n');
          
          // Cleanup
          if (pollInterval) clearInterval(pollInterval);
          if (socket && socketHandler) {
            socket.off('key-exchange-response', socketHandler);
          }
          
          rejectPromise(new Error('Key exchange timeout (60s). The other user may be offline or there may be connection issues. Please check that both users are online and try again.'));
        }
      }, 60000); // 60 seconds
    };

    // Create promise with resolve/reject exposed
    let resolvePromise, rejectPromise;
    const responsePromise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    
    // Attach init method to the promise object
    responsePromise.init = (exchangeId) => {
      keyExchangeIdForHandlers = exchangeId;
      console.log('✅ Response handlers initialized for:', keyExchangeIdForHandlers);
      
      // Register socket handler
      if (socket && socket.connected) {
        socket.on('key-exchange-response', socketHandler);
        console.log('✅ Socket listener registered');
      } else {
        console.warn('⚠️ Socket not available, relying on polling only');
      }
      
      startPolling();
      startTimeout();
    };

    // Step 3: Send init to server
    console.log('\n📤 STEP 2B: Sending init to server...');
    const initResponse = await apiCall.post('/key-exchange/initiate', {
      targetUserId,
      encrypted: init.encrypted,
      signature: init.signature,
      ecdhPublicKey: init.ecdhKeyPair.publicKey
    });

    const keyExchangeId = initResponse.data.keyExchangeId;
    console.log('✅ Key exchange initiated');
    console.log('   Key Exchange ID:', keyExchangeId);
    console.log('   Server response:', JSON.stringify(initResponse.data, null, 2));

    // Initialize handlers with the keyExchangeId (call the init function from the promise)
    if (typeof responsePromise.init === 'function') {
      responsePromise.init(keyExchangeId);
    } else {
      // Fallback: set up handlers directly
      console.log('⚠️ responsePromise.init not available, setting up handlers directly...');
      // The handlers should already be set up in the promise constructor
      // We just need to trigger them with the keyExchangeId
      // Since we can't modify the promise, we'll need to restructure
      throw new Error('Promise initialization pattern error - handlers not properly set up');
    }
    console.log('✅ Waiting for response...\n');

    // Wait for response
    return await responsePromise;

  } catch (error) {
    console.error('❌ Key exchange failed:', error);
    throw error;
  }
}

/**
 * Respond to incoming key exchange request
 */
/**
 * FIX 7: Add connection check helper
 */
export function checkKeyExchangeRequirements(socket) {
  const issues = [];
  
  if (!socket) {
    issues.push('Socket connection not available');
  } else if (!socket.connected) {
    issues.push('Socket not connected');
  }
  
  // Check IndexedDB
  if (!window.indexedDB) {
    issues.push('IndexedDB not available');
  }
  
  // Check crypto API
  if (!window.crypto || !window.crypto.subtle) {
    issues.push('Web Crypto API not available');
  }
  
  return {
    ready: issues.length === 0,
    issues
  };
}

/**
 * FIX 8: Add retry wrapper
 */
export async function performKeyExchangeWithRetry(
  userId,
  targetUserId,
  rsaPrivateKeyBase64,
  targetRSAPublicKeyBase64,
  apiCall,
  socket,
  maxRetries = 2
) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Key exchange attempt ${attempt}/${maxRetries}`);
      
      // Check requirements
      const check = checkKeyExchangeRequirements(socket);
      if (!check.ready) {
        console.warn('⚠️ Requirements not met:', check.issues);
        if (attempt < maxRetries) {
          console.log('   Waiting 2s before retry...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
      
      const result = await performFullKeyExchange(
        userId,
        targetUserId,
        rsaPrivateKeyBase64,
        targetRSAPublicKeyBase64,
        apiCall,
        socket
      );
      
      console.log(`✅ Key exchange succeeded on attempt ${attempt}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = attempt * 2000; // Progressive backoff
        console.log(`   Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(`Key exchange failed after ${maxRetries} attempts: ${lastError.message}`);
}

export async function respondToIncomingKeyExchange(
  userId,
  keyExchangeId,
  rsaPrivateKeyBase64,
  rsaPublicKeyBase64,
  apiCall
) {
  try {
    console.log('🔄🔄🔄 RESPONDING TO KEY EXCHANGE REQUEST 🔄🔄🔄');
    console.log('Key exchange ID:', keyExchangeId);
    console.log('User ID:', userId);
    
    // Ensure keys are strings
    if (typeof rsaPrivateKeyBase64 !== 'string') {
      throw new Error('RSA private key must be a base64 string');
    }
    if (typeof rsaPublicKeyBase64 !== 'string') {
      throw new Error('RSA public key must be a base64 string');
    }
    
    console.log('📥 Step 1: Fetching key exchange details from server...');
    // Get key exchange details
    const exchangeResponse = await apiCall.get(`/key-exchange/${keyExchangeId}`);
    const keyExchange = exchangeResponse.data.keyExchange;
    console.log('✅ Key exchange details retrieved');
    console.log('   Status:', keyExchange.status);
    console.log('   Initiator ID:', keyExchange.initiatorId);
    console.log('   Responder ID:', keyExchange.responderId);
    
    // Validate encryptedInit exists and is not empty
    if (!keyExchange.encryptedInit || typeof keyExchange.encryptedInit !== 'string' || keyExchange.encryptedInit.trim().length === 0) {
      throw new Error(`Invalid encryptedInit in key exchange: ${typeof keyExchange.encryptedInit}, length: ${keyExchange.encryptedInit?.length || 0}`);
    }
    
    console.log('   encryptedInit length:', keyExchange.encryptedInit.length);
    console.log('   encryptedInit preview:', keyExchange.encryptedInit.substring(0, 100));
    
    // Try to parse as JSON to validate structure
    let parsedInit = null;
    try {
      parsedInit = JSON.parse(keyExchange.encryptedInit);
      console.log('   ✅ encryptedInit is valid JSON (hybrid encryption)');
      if (parsedInit.encryptedKey) {
        console.log('   encryptedKey length:', parsedInit.encryptedKey.length);
        if (parsedInit.encryptedKey.length < 300) {
          console.error('   ❌ WARNING: encryptedKey seems too short!');
        }
      }
    } catch (e) {
      console.log('   ⚠️ encryptedInit is not JSON (direct RSA encryption)');
    }
    
    console.log('📥 Step 2: Fetching initiator public key...');
    // Get initiator's public key
    const initiatorUserResponse = await apiCall.get(`/users/${keyExchange.initiatorId}/public-key`);
    const initiatorRSAPublicKeyBase64 = initiatorUserResponse.data.publicKey;
    console.log('✅ Initiator public key retrieved');
    console.log('   Public key length:', initiatorRSAPublicKeyBase64.length);

    console.log('🔐 Step 3: Decrypting and processing key exchange...');
    console.log('   Encrypted init message length:', keyExchange.encryptedInit?.length || 0);
    console.log('   Signature length:', keyExchange.initSignature?.length || 0);
    console.log('   Encrypted init preview:', keyExchange.encryptedInit?.substring(0, 100) || 'N/A');
    console.log('   Is JSON string?', typeof keyExchange.encryptedInit === 'string' && keyExchange.encryptedInit.trim().startsWith('{'));
    
    // Ensure encryptedInit is a string (it might be stored as object in DB)
    let encryptedInitMessage = keyExchange.encryptedInit;
    if (typeof encryptedInitMessage !== 'string') {
      console.log('⚠️ encryptedInit is not a string, converting...');
      encryptedInitMessage = String(encryptedInitMessage);
    }
    
    // CRITICAL: Clean the encrypted message immediately after retrieval
    // MongoDB or JSON transport might add whitespace/newlines
    encryptedInitMessage = encryptedInitMessage.trim();
    console.log('   After initial trim, length:', encryptedInitMessage.length);
    
    // CRITICAL: Validate the encryptedInit before processing
    // If it's JSON, check if encryptedKey exists and is valid length
    try {
      const testParse = JSON.parse(encryptedInitMessage);
      if (testParse.encryptedKey) {
        console.log('   ✅ Is JSON with encryptedKey');
        console.log('   encryptedKey length:', testParse.encryptedKey.length);
        if (testParse.encryptedKey.length < 300) {
          throw new Error(`encryptedKey in stored data is too short: ${testParse.encryptedKey.length} chars. Data was truncated in MongoDB!`);
        }
        // DON'T re-stringify - just validate and pass the original string
        // Re-stringifying can corrupt the base64 data
        console.log('   ✅ encryptedKey validated (will be cleaned in respondToKeyExchange)');
      }
    } catch (parseError) {
      if (parseError.message.includes('too short') || parseError.message.includes('truncated')) {
        throw parseError;
      }
      // Not JSON or parse failed, that's OK
    }
    
    // Step 2: Respond to key exchange (pass base64 strings directly)
    const response = await respondToKeyExchange(
      rsaPrivateKeyBase64,
      rsaPublicKeyBase64,
      initiatorRSAPublicKeyBase64,
      encryptedInitMessage,
      keyExchange.initSignature
    );
    console.log('✅ Key exchange response generated');
    console.log('   Encrypted response length:', response.encrypted?.length || 0);
    console.log('   Response signature length:', response.signature?.length || 0);

    console.log('💾 Step 4: Storing ECDH key pair temporarily...');
    // Store ECDH key pair temporarily
    await storeTempECDHKey(userId, keyExchange.initiatorId, response.ecdhKeyPair, false);
    console.log('✅ ECDH key pair stored');

    console.log('📤 Step 5: Sending response to server...');
    // Send response to server
    const respondResult = await apiCall.post('/key-exchange/respond', {
      keyExchangeId,
      encrypted: response.encrypted,
      signature: response.signature,
      ecdhPublicKey: response.ecdhKeyPair.publicKey
    });
    console.log('✅✅✅ Key exchange response sent to server ✅✅✅');
    console.log('   Server response:', respondResult.data);
    
    // Note: Socket event is emitted by server automatically

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
            
            // Note: Session key is derived but not stored directly - we store the sharedSecret
            // and derive the session key on-demand using the same salt

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

      // Poll for confirmation
      const pollInterval = setInterval(async () => {
        if (confirmationReceived) {
          clearInterval(pollInterval);
          return;
        }
        try {
          let exchangeResponse;
          if (apiCall.get) {
            exchangeResponse = await apiCall.get(`/key-exchange/${keyExchangeId}`);
          } else {
            console.warn('Cannot poll - api object not available');
            return;
          }
          
          if (exchangeResponse && exchangeResponse.data && exchangeResponse.data.keyExchange) {
            const exchange = exchangeResponse.data.keyExchange;
            if (exchange.status === 'COMPLETED' && !confirmationReceived) {
              confirmationReceived = true;
              clearInterval(pollInterval);
              clearTimeout(timeout);
              
              await confirmationHandler({
                keyExchangeId,
                encryptedConfirmation: exchange.encryptedConfirmation,
                iv: exchange.confirmationIV,
                tag: exchange.confirmationTag
              });
            }
          }
        } catch (error) {
          console.error('Polling error (will retry):', error.message);
          // Continue polling
        }
      }, 2000);
    });
  } catch (error) {
    console.error('Error responding to key exchange:', error);
    throw error;
  }
}

