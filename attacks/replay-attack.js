/**
 * Replay Attack Demonstration Script
 * 
 * This script demonstrates:
 * 1. How replay attacks work
 * 2. How nonces, timestamps, and sequence numbers prevent replay attacks
 * 
 * Usage: node attacks/replay-attack.js
 */

console.log('='.repeat(60));
console.log('REPLAY ATTACK DEMONSTRATION');
console.log('='.repeat(60));
console.log();

// Simulate message structure
class Message {
  constructor(sender, receiver, content, timestamp, nonce, sequenceNumber) {
    this.sender = sender;
    this.receiver = receiver;
    this.content = content;
    this.timestamp = timestamp;
    this.nonce = nonce;
    this.sequenceNumber = sequenceNumber;
  }
}

// Store of seen nonces and sequence numbers
const seenNonces = new Set();
const lastSequenceNumbers = new Map();
const MESSAGE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

console.log('SCENARIO 1: Replay Attack WITHOUT Protection');
console.log('-'.repeat(60));

// Original message
const originalMessage = new Message(
  'Alice',
  'Bob',
  'Transfer $1000 to account 12345',
  Date.now(),
  'nonce-123',
  1
);

console.log('\n1. Alice sends a legitimate message:');
console.log('   Content:', originalMessage.content);
console.log('   Timestamp:', new Date(originalMessage.timestamp).toISOString());
console.log('   Nonce:', originalMessage.nonce);
console.log('   Sequence Number:', originalMessage.sequenceNumber);

// Attacker intercepts and replays
console.log('\n2. Attacker intercepts and stores the message');
console.log('   (Later, attacker replays the same message)');

const replayedMessage = {
  ...originalMessage,
  timestamp: Date.now() // Same message, new timestamp
};

console.log('\n3. Attacker replays the message:');
console.log('   Content:', replayedMessage.content);
console.log('   Timestamp:', new Date(replayedMessage.timestamp).toISOString());
console.log('   Nonce:', replayedMessage.nonce);
console.log('   Sequence Number:', replayedMessage.sequenceNumber);

console.log('\n   ✗ REPLAY ATTACK SUCCESSFUL - Bob processes the duplicate transaction!');

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 2: Replay Attack PREVENTED with Nonces');
console.log('-'.repeat(60));

function verifyNonce(nonce) {
  if (seenNonces.has(nonce)) {
    return { valid: false, reason: 'Duplicate nonce detected' };
  }
  seenNonces.add(nonce);
  return { valid: true };
}

// First message with nonce
const message1 = new Message(
  'Alice',
  'Bob',
  'Transfer $1000 to account 12345',
  Date.now(),
  'unique-nonce-abc123',
  1
);

console.log('\n1. Alice sends message with unique nonce:');
console.log('   Nonce:', message1.nonce);

const verify1 = verifyNonce(message1.nonce);
console.log('   Verification:', verify1.valid ? '✓ VALID' : `✗ INVALID - ${verify1.reason}`);

// Replay attempt
console.log('\n2. Attacker tries to replay the same message:');
const verify2 = verifyNonce(message1.nonce);
console.log('   Verification:', verify2.valid ? '✓ VALID' : `✗ INVALID - ${verify2.reason}`);

if (!verify2.valid) {
  console.log('   ✓ REPLAY ATTACK PREVENTED - Duplicate nonce detected!');
}

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 3: Replay Attack PREVENTED with Timestamps');
console.log('-'.repeat(60));

function verifyTimestamp(timestamp) {
  const now = Date.now();
  const age = now - timestamp;
  
  if (age < 0) {
    return { valid: false, reason: 'Future timestamp' };
  }
  
  if (age > MESSAGE_MAX_AGE) {
    return { valid: false, reason: `Message too old (${Math.floor(age / 1000)}s)` };
  }
  
  return { valid: true };
}

// Fresh message
const freshMessage = new Message(
  'Alice',
  'Bob',
  'Transfer $1000',
  Date.now(),
  'nonce-fresh',
  1
);

console.log('\n1. Alice sends a fresh message:');
console.log('   Timestamp:', new Date(freshMessage.timestamp).toISOString());

const verifyFresh = verifyTimestamp(freshMessage.timestamp);
console.log('   Verification:', verifyFresh.valid ? '✓ VALID' : `✗ INVALID - ${verifyFresh.reason}`);

// Old replayed message
const oldMessage = new Message(
  'Alice',
  'Bob',
  'Transfer $1000',
  Date.now() - (10 * 60 * 1000), // 10 minutes ago
  'nonce-old',
  1
);

console.log('\n2. Attacker tries to replay an old message:');
console.log('   Timestamp:', new Date(oldMessage.timestamp).toISOString());

const verifyOld = verifyTimestamp(oldMessage.timestamp);
console.log('   Verification:', verifyOld.valid ? '✓ VALID' : `✗ INVALID - ${verifyOld.reason}`);

if (!verifyOld.valid) {
  console.log('   ✓ REPLAY ATTACK PREVENTED - Message too old!');
}

console.log('\n' + '='.repeat(60));
console.log('SCENARIO 4: Replay Attack PREVENTED with Sequence Numbers');
console.log('-'.repeat(60));

function verifySequenceNumber(sender, receiver, sequenceNumber) {
  const key = `${sender}_${receiver}`;
  const lastSeq = lastSequenceNumbers.get(key) || 0;
  
  if (sequenceNumber <= lastSeq) {
    return { valid: false, reason: `Sequence number ${sequenceNumber} <= last seen ${lastSeq}` };
  }
  
  lastSequenceNumbers.set(key, sequenceNumber);
  return { valid: true };
}

// Messages in sequence
const msg1 = new Message('Alice', 'Bob', 'Message 1', Date.now(), 'nonce-1', 1);
const msg2 = new Message('Alice', 'Bob', 'Message 2', Date.now(), 'nonce-2', 2);
const msg3 = new Message('Alice', 'Bob', 'Message 3', Date.now(), 'nonce-3', 3);

console.log('\n1. Alice sends messages in sequence:');
console.log('   Message 1, Sequence:', msg1.sequenceNumber);
const v1 = verifySequenceNumber(msg1.sender, msg1.receiver, msg1.sequenceNumber);
console.log('   Verification:', v1.valid ? '✓ VALID' : `✗ INVALID - ${v1.reason}`);

console.log('   Message 2, Sequence:', msg2.sequenceNumber);
const v2 = verifySequenceNumber(msg2.sender, msg2.receiver, msg2.sequenceNumber);
console.log('   Verification:', v2.valid ? '✓ VALID' : `✗ INVALID - ${v2.reason}`);

console.log('   Message 3, Sequence:', msg3.sequenceNumber);
const v3 = verifySequenceNumber(msg3.sender, msg3.receiver, msg3.sequenceNumber);
console.log('   Verification:', v3.valid ? '✓ VALID' : `✗ INVALID - ${v3.reason}`);

// Replay attempt
console.log('\n2. Attacker tries to replay message 2:');
const vReplay = verifySequenceNumber(msg2.sender, msg2.receiver, msg2.sequenceNumber);
console.log('   Verification:', vReplay.valid ? '✓ VALID' : `✗ INVALID - ${vReplay.reason}`);

if (!vReplay.valid) {
  console.log('   ✓ REPLAY ATTACK PREVENTED - Sequence number already seen!');
}

console.log('\n' + '='.repeat(60));
console.log('CONCLUSION');
console.log('-'.repeat(60));
console.log('Protection mechanisms:');
console.log('  1. Nonces: Prevent duplicate message processing');
console.log('  2. Timestamps: Prevent replay of old messages');
console.log('  3. Sequence Numbers: Ensure message order and detect duplicates');
console.log('  4. Combined: All three provide comprehensive replay protection');
console.log('='.repeat(60));

