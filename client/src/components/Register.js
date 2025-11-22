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

      // Store private key locally (NEVER sent to server)
      await storePrivateKey('temp', 'rsa', keyPair.privateKey);

      // Register user with public key
      const response = await api.post('/auth/register', {
        username,
        password,
        publicKey: keyPair.publicKey
      });

      // Store private key with actual user ID
      const userId = response.data.user.id;
      await storePrivateKey(userId, 'rsa', keyPair.privateKey);

      localStorage.setItem('token', response.data.token);
      localStorage.setItem('userId', userId);
      localStorage.setItem('username', response.data.user.username);

      // Force navigation to ensure state is set
      window.location.href = '/chat';
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
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

