// Test script to verify the complete flow
const https = require('https');
const axios = require('axios');

const agent = new https.Agent({
  rejectUnauthorized: false
});

const API_BASE = 'https://localhost:5001/api';

async function testFlow() {
  console.log('=== Testing Complete Flow ===\n');
  
  try {
    // Test 1: Register User 1
    console.log('1. Registering User 1 (alice)...');
    const reg1 = await axios.post(`${API_BASE}/auth/register`, {
      username: 'alice',
      password: 'testpass123',
      publicKey: 'testkey1'
    }, { httpsAgent: agent });
    console.log('✅ User 1 registered:', reg1.data.user.id);
    const user1Token = reg1.data.token;
    const user1Id = reg1.data.user.id;
    
    // Test 2: Register User 2
    console.log('\n2. Registering User 2 (bob)...');
    const reg2 = await axios.post(`${API_BASE}/auth/register`, {
      username: 'bob',
      password: 'testpass123',
      publicKey: 'testkey2'
    }, { httpsAgent: agent });
    console.log('✅ User 2 registered:', reg2.data.user.id);
    const user2Token = reg2.data.token;
    const user2Id = reg2.data.user.id;
    
    // Test 3: Login User 1
    console.log('\n3. Logging in User 1...');
    const login1 = await axios.post(`${API_BASE}/auth/login`, {
      username: 'alice',
      password: 'testpass123'
    }, { httpsAgent: agent });
    console.log('✅ User 1 logged in');
    
    // Test 4: Login User 2
    console.log('\n4. Logging in User 2...');
    const login2 = await axios.post(`${API_BASE}/auth/login`, {
      username: 'bob',
      password: 'testpass123'
    }, { httpsAgent: agent });
    console.log('✅ User 2 logged in');
    
    // Test 5: Search for users
    console.log('\n5. User 1 searching for bob...');
    const search1 = await axios.get(`${API_BASE}/users/search/bob`, {
      headers: { Authorization: `Bearer ${user1Token}` },
      httpsAgent: agent
    });
    console.log('✅ User found:', search1.data.username);
    
    // Test 6: Get public keys
    console.log('\n6. Getting public keys...');
    const pubKey1 = await axios.get(`${API_BASE}/users/${user1Id}/public-key`, {
      headers: { Authorization: `Bearer ${user1Token}` },
      httpsAgent: agent
    });
    const pubKey2 = await axios.get(`${API_BASE}/users/${user2Id}/public-key`, {
      headers: { Authorization: `Bearer ${user2Token}` },
      httpsAgent: agent
    });
    console.log('✅ Public keys retrieved');
    
    console.log('\n=== All API Tests Passed ===');
    console.log('\nNext: Test in browser:');
    console.log('1. Open https://localhost:3002');
    console.log('2. Register alice (clear browser data first)');
    console.log('3. Register bob (in incognito)');
    console.log('4. Login both');
    console.log('5. Search and connect');
    console.log('6. Send messages');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

testFlow();
