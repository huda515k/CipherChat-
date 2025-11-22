/**
 * Secure key storage using IndexedDB
 * Private keys are NEVER sent to the server
 */

const DB_NAME = 'E2EEKeyStore';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

let db = null;

/**
 * Initialize IndexedDB
 */
export function initKeyStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        objectStore.createIndex('userId', 'userId', { unique: false });
      }
    };
  });
}

/**
 * Store private key securely
 */
export async function storePrivateKey(userId, keyType, privateKey) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const keyData = {
      id: `${userId}_${keyType}`,
      userId,
      keyType,
      privateKey,
      timestamp: new Date().toISOString()
    };

    const request = store.put(keyData);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store private key'));
    };
  });
}

/**
 * Retrieve private key
 */
export async function getPrivateKey(userId, keyType) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(`${userId}_${keyType}`);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.privateKey);
      } else {
        reject(new Error('Private key not found'));
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to retrieve private key'));
    };
  });
}

/**
 * Store session key for a conversation
 */
export async function storeSessionKey(userId, targetUserId, sessionKey, sharedSecret) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const keyData = {
      id: `session_${userId}_${targetUserId}`,
      userId,
      targetUserId,
      sessionKey,
      sharedSecret,
      timestamp: new Date().toISOString()
    };

    const request = store.put(keyData);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store session key'));
    };
  });
}

/**
 * Retrieve session key for a conversation
 * Tries both directions since session might be stored either way
 */
export async function getSessionKey(userId, targetUserId) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    // Try both directions
    const key1 = `session_${userId}_${targetUserId}`;
    const key2 = `session_${targetUserId}_${userId}`;
    
    const request1 = store.get(key1);
    
    request1.onsuccess = () => {
      if (request1.result) {
        resolve({
          sessionKey: request1.result.sessionKey,
          sharedSecret: request1.result.sharedSecret
        });
      } else {
        // Try the reverse direction
        const request2 = store.get(key2);
        request2.onsuccess = () => {
          if (request2.result) {
            resolve({
              sessionKey: request2.result.sessionKey,
              sharedSecret: request2.result.sharedSecret
            });
          } else {
            reject(new Error('Session key not found'));
          }
        };
        request2.onerror = () => {
          reject(new Error('Failed to retrieve session key'));
        };
      }
    };

    request1.onerror = () => {
      reject(new Error('Failed to retrieve session key'));
    };
  });
}

/**
 * Store sequence number for replay protection
 */
export async function storeSequenceNumber(userId, targetUserId, sequenceNumber) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const keyData = {
      id: `seq_${userId}_${targetUserId}`,
      userId,
      targetUserId,
      sequenceNumber,
      timestamp: new Date().toISOString()
    };

    const request = store.put(keyData);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store sequence number'));
    };
  });
}

/**
 * Get and increment sequence number
 */
export async function getNextSequenceNumber(userId, targetUserId) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(`seq_${userId}_${targetUserId}`);

    request.onsuccess = () => {
      let currentSeq = 0;
      if (request.result) {
        currentSeq = request.result.sequenceNumber || 0;
      }
      
      const nextSeq = currentSeq + 1;
      const keyData = {
        id: `seq_${userId}_${targetUserId}`,
        userId,
        targetUserId,
        sequenceNumber: nextSeq,
        timestamp: new Date().toISOString()
      };

      const putRequest = store.put(keyData);
      putRequest.onsuccess = () => {
        resolve(nextSeq);
      };
      putRequest.onerror = () => {
        reject(new Error('Failed to update sequence number'));
      };
    };

    request.onerror = () => {
      reject(new Error('Failed to get sequence number'));
    };
  });
}

/**
 * Store temporary ECDH key pair during key exchange
 */
export async function storeTempECDHKey(userId, targetUserId, ecdhKeyPair, isInitiator) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const keyData = {
      id: `temp_ecdh_${userId}_${targetUserId}_${isInitiator ? 'init' : 'resp'}`,
      userId,
      targetUserId,
      ecdhKeyPair,
      isInitiator,
      timestamp: new Date().toISOString()
    };

    const request = store.put(keyData);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to store temporary ECDH key'));
    };
  });
}

/**
 * Retrieve temporary ECDH key pair
 */
export async function getTempECDHKey(userId, targetUserId, isInitiator) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(`temp_ecdh_${userId}_${targetUserId}_${isInitiator ? 'init' : 'resp'}`);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.ecdhKeyPair);
      } else {
        reject(new Error('Temporary ECDH key not found'));
      }
    };

    request.onerror = () => {
      reject(new Error('Failed to retrieve temporary ECDH key'));
    };
  });
}

/**
 * Clear temporary ECDH key
 */
export async function clearTempECDHKey(userId, targetUserId, isInitiator) {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(`temp_ecdh_${userId}_${targetUserId}_${isInitiator ? 'init' : 'resp'}`);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to clear temporary ECDH key'));
    };
  });
}

/**
 * Clear all keys (for logout)
 */
export async function clearKeyStore() {
  if (!db) {
    await initKeyStore();
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error('Failed to clear key store'));
    };
  });
}

