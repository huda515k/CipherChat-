import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import './Login.css';

function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', {
        username,
        password
      });

      if (response.data && response.data.token) {
        const userId = String(response.data.user.id);
        
        // Store authentication data
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('userId', userId);
        localStorage.setItem('username', response.data.user.username);

        // Verify private key exists before redirecting
        try {
          const { initKeyStore, getPrivateKey } = await import('../utils/keyStorage');
          await initKeyStore();
          await getPrivateKey(userId, 'rsa');
          console.log('✅ Private key verified for user:', userId);
        } catch (err) {
          console.error('❌ Private key not found for user:', userId);
          setError('Private key not found. Please register again.');
          return;
        }

        // Force a page reload to ensure state is properly set
        // This ensures the Chat component sees the token
        window.location.href = '/chat';
      } else {
        setError('Invalid response from server');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>Secure E2EE Messaging</h1>
        <h2>Login</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
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
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
        <p>
          Don't have an account? <a href="/register">Register</a>
        </p>
      </div>
    </div>
  );
}

export default Login;

