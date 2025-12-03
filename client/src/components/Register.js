import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { generateRSAKeyPair } from '../utils/crypto';
import { initKeyStore, storePrivateKey } from '../utils/keyStorage';
import './Login.css';

function Register() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);

    try {
      // Initialize key store
      await initKeyStore();

      // Generate RSA key pair
      const keyPair = await generateRSAKeyPair();

      // Validate keys are strings
      if (!keyPair.privateKey || typeof keyPair.privateKey !== 'string') {
        throw new Error('Failed to generate valid private key');
      }
      if (!keyPair.publicKey || typeof keyPair.publicKey !== 'string') {
        throw new Error('Failed to generate valid public key');
      }

      // Register user with public key first
      const response = await api.post('/auth/register', {
        username,
        password,
        publicKey: keyPair.publicKey
      });

      // Store private key with actual user ID (ensure userId is string)
      const userId = String(response.data.user.id);
      
      // Store private key and verify it was stored
      console.log('Storing private key for user:', userId);
      await storePrivateKey(userId, 'rsa', keyPair.privateKey);
      
      // Wait a bit for IndexedDB to commit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify the key was stored correctly
      const { getPrivateKey, getAllStoredKeys } = await import('../utils/keyStorage');
      const verifyKey = await getPrivateKey(userId, 'rsa');
      if (!verifyKey || verifyKey !== keyPair.privateKey) {
        // Debug: list all keys
        const allKeys = await getAllStoredKeys();
        console.error('All stored keys:', allKeys);
        throw new Error('Failed to verify private key storage');
      }
      console.log('✅ Private key stored and verified for user:', userId);
      
      // List all keys for debugging
      const allKeys = await getAllStoredKeys();
      console.log('All keys in IndexedDB:', allKeys);

      localStorage.setItem('token', response.data.token);
      localStorage.setItem('userId', userId);
      localStorage.setItem('username', response.data.user.username);

      // Force navigation to ensure state is set
      window.location.href = '/chat';
    } catch (err) {
      console.error('Registration error:', err);
      console.error('Error response:', err.response);
      console.error('Error message:', err.message);
      
      // Show specific error message from server
      let errorMessage = 'Registration failed';
      if (err.response?.data?.error) {
        errorMessage = err.response.data.error;
      } else if (err.message) {
        errorMessage = err.message;
      } else if (err.response?.status === 400) {
        errorMessage = 'Invalid registration data. Please check your input.';
      } else if (err.response?.status === 500) {
        errorMessage = 'Server error. Please try again later.';
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Secure E2EE Messaging</h1>
        <h2>Register</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Registering...' : 'Register'}
          </button>
        </form>
        <p>
          Already have an account? <a href="/login">Login</a>
        </p>
      </div>
    </div>
  );
}

export default Register;

