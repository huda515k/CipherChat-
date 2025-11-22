/**
 * MITM Attack Demonstration Script
 * 
 * This script demonstrates:
 * 1. How MITM attack works without digital signatures
 * 2. How digital signatures prevent MITM attacks
 * 
 * Usage: node attacks/mitm-attack.js
 */

const crypto = require('crypto');

console.log('='.repeat(60));
console.log('MITM ATTACK DEMONSTRATION');
console.log('='.repeat(60));
console.log();

// Simulate Alice and Bob
const alice = {
  name: 'Alice',
  rsaKeyPair: crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
};

const bob = {
  name: 'Bob',
  rsaKeyPair: crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
};

// Attacker (Mallory)
const mallory = {
  name: 'Mallory (Attacker)',
  rsaKeyPair: crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
};

console.log('SCENARIO 1: MITM Attack WITHOUT Digital Signatures');
console.log('-'.repeat(60));

// Step 1: Alice wants to send her public key to Bob
console.log('\n1. Alice generates her public key and wants to send it to Bob');
const alicePublicKey = alice.rsaKeyPair.publicKey;
console.log('   Alice\'s Public Key (first 50 chars):', alicePublicKey.substring(0, 50) + '...');

// Step 2: Mallory intercepts and replaces with her own
console.log('\n2. Mallory intercepts the communication');
console.log('   Mallory replaces Alice\'s public key with her own');
const malloryPublicKeyToBob = mallory.rsaKeyPair.publicKey;

// Step 3: Bob receives Mallory's key thinking it's Alice's
console.log('\n3. Bob receives what he thinks is Alice\'s public key');
console.log('   (But it\'s actually Mallory\'s key)');

// Step 4: Bob encrypts a message with Mallory's key
const message = 'Secret message from Bob to Alice';
console.log('\n4. Bob encrypts message:', message);
const encrypted = crypto.publicEncrypt(
  { key: malloryPublicKeyToBob, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
  Buffer.from(message)
);

// Step 5: Mallory intercepts and decrypts
console.log('\n5. Mallory intercepts the encrypted message');
const decryptedByMallory = crypto.privateDecrypt(
  { key: mallory.rsaKeyPair.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
  encrypted
);
console.log('   Mallory decrypts the message:', decryptedByMallory.toString());
console.log('   ✓ MITM ATTACK SUCCESSFUL - Mallory can read the message!');

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 2: MITM Attack PREVENTED with Digital Signatures');
console.log('-'.repeat(60));

// Step 1: Alice signs her public key
console.log('\n1. Alice signs her public key with her private key');
const signature = crypto.createSign('SHA256')
  .update(alicePublicKey)
  .sign(alice.rsaKeyPair.privateKey, 'base64');
console.log('   Signature generated:', signature.substring(0, 50) + '...');

// Step 2: Mallory tries to intercept
console.log('\n2. Mallory intercepts and tries to replace with her own key');
const malloryFakeSignature = crypto.createSign('SHA256')
  .update(malloryPublicKeyToBob)
  .sign(mallory.rsaKeyPair.privateKey, 'base64');

// Step 3: Bob verifies the signature
console.log('\n3. Bob verifies the signature using Alice\'s public key');
console.log('   (Bob has Alice\'s public key from a trusted source)');

// Bob verifies with Alice's real public key
const isValidAlice = crypto.createVerify('SHA256')
  .update(alicePublicKey)
  .verify(alice.rsaKeyPair.publicKey, signature, 'base64');

const isValidMallory = crypto.createVerify('SHA256')
  .update(malloryPublicKeyToBob)
  .verify(alice.rsaKeyPair.publicKey, malloryFakeSignature, 'base64');

console.log('   Verification of Alice\'s signed key:', isValidAlice ? '✓ VALID' : '✗ INVALID');
console.log('   Verification of Mallory\'s fake key:', isValidMallory ? '✓ VALID' : '✗ INVALID');

if (!isValidMallory) {
  console.log('   ✓ MITM ATTACK PREVENTED - Bob detects the fake key!');
}

console.log('\n' + '='.repeat(60));
console.log('CONCLUSION');
console.log('-'.repeat(60));
console.log('Without digital signatures: MITM attack is successful');
console.log('With digital signatures: MITM attack is prevented');
console.log('='.repeat(60));

