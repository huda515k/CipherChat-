import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import api from '../services/api';
import { encryptMessage, decryptMessage } from '../utils/messageEncryption';
import { encryptFile } from '../utils/fileEncryption';
import { getPrivateKey, getSessionKey } from '../utils/keyStorage';
import { performFullKeyExchange, respondToIncomingKeyExchange } from '../utils/keyExchange';
import './Chat.css';

// Auto-detect protocol based on current page protocol
const getSocketURL = () => {
  if (process.env.REACT_APP_SOCKET_URL) {
    return process.env.REACT_APP_SOCKET_URL;
  }
  // Use same protocol as the current page
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//localhost:5001`;
};
const SOCKET_URL = getSocketURL();

function Chat() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [socket, setSocket] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId') ? String(localStorage.getItem('userId')) : null;
  const username = localStorage.getItem('username');

  useEffect(() => {
    // Check for token and userId
    const token = localStorage.getItem('token');
    const currentUserId = localStorage.getItem('userId');
    
    if (!token || !currentUserId) {
      console.log('No auth data found, redirecting to login');
      navigate('/login', { replace: true });
      return;
    }

    // Initialize IndexedDB and verify private key exists
    const initializeAndVerify = async () => {
      try {
        const { initKeyStore } = await import('../utils/keyStorage');
        await initKeyStore();
        
        // Verify private key exists
        const { getPrivateKey } = await import('../utils/keyStorage');
        const userIdStr = String(currentUserId);
        try {
          await getPrivateKey(userIdStr, 'rsa');
          console.log('✅ Private key verified for user:', userIdStr);
        } catch (err) {
          console.error('❌ Private key not found for user:', userIdStr);
          console.error('Error:', err.message);
          alert('Private key not found. Please register again. Your keys may have been cleared.');
          localStorage.clear();
          navigate('/register', { replace: true });
          return;
        }
      } catch (error) {
        console.error('Failed to initialize key store:', error);
      }
    };
    
    initializeAndVerify();

    // Initialize socket connection with better config
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000
    });
    
    newSocket.on('connect', () => {
      console.log('🔌 Socket connected, ID:', newSocket.id);
      const userIdToJoin = String(currentUserId);
      console.log('🚪 Joining room for user:', userIdToJoin);
      newSocket.emit('join-room', userIdToJoin);
      console.log('✅ Join-room event emitted');
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error);
    });
    
    newSocket.on('disconnect', (reason) => {
      console.warn('⚠️ Socket disconnected:', reason);
    });
    
    setSocket(newSocket);
    
    // Initialize global callback storage for key exchange
    if (!window._keyExchangeCallbacks) {
      window._keyExchangeCallbacks = {};
    }

    // Listen for key exchange response
    newSocket.on('key-exchange-response', async (data) => {
      console.log('🔔 KEY EXCHANGE RESPONSE RECEIVED IN CHAT:', data);
      
      // Trigger the waiting promise resolver
      if (window._keyExchangeCallbacks && window._keyExchangeCallbacks[data.keyExchangeId]) {
        const callback = window._keyExchangeCallbacks[data.keyExchangeId];
        await callback(data);
      }
    });
    
    // Listen for incoming key exchange init (REMOVED DUPLICATE - handler is below at line 194)
    
    // Listen for new messages
    newSocket.on('new-message', async (data) => {
      console.log('New message received via socket:', data);
      // Reload messages if we're in a conversation with the sender
      const currentUserId = localStorage.getItem('userId');
      if (data.senderId && data.senderId !== currentUserId) {
        // Check if we're currently viewing this conversation
        const targetUserId = selectedUser?._id || selectedUser?.id;
        if (targetUserId && (targetUserId === data.senderId || targetUserId === data.receiverId)) {
          console.log('Reloading messages for current conversation');
          await loadMessages(targetUserId);
        } else {
          console.log('New message from different user, not reloading');
        }
      } else if (selectedUser?._id) {
        // Fallback: reload if we have a selected user
        await loadMessages(selectedUser._id);
      }
    });

    // Listen for new files
    newSocket.on('new-file', async (data) => {
      console.log('New file received via socket:', data);
      const targetUserId = selectedUser?._id || selectedUser?.id;
      if (targetUserId) {
        await loadMessages(targetUserId);
      }
    });

    // Listen for incoming key exchange requests
    newSocket.on('key-exchange-init', async (data) => {
      console.log('🔔🔔🔔 INCOMING KEY EXCHANGE REQUEST RECEIVED 🔔🔔🔔');
      console.log('Full data:', JSON.stringify(data, null, 2));
      console.log('Key exchange ID:', data.keyExchangeId);
      console.log('Initiator ID:', data.initiatorId);
      
      // IMPORTANT: Don't use the encrypted data from socket event - fetch it from server instead
      // Socket events might truncate large JSON strings. Always fetch from API.
      console.log('⚠️  Note: Ignoring encrypted data from socket event, will fetch from server API');
      
      // Use a separate async function to handle the response so errors don't break the socket listener
      (async () => {
        try {
          const currentUserIdStr = String(localStorage.getItem('userId'));
          console.log('Current user ID:', currentUserIdStr);
          console.log('Socket ID:', newSocket.id);
          console.log('Socket connected:', newSocket.connected);
          
          if (!currentUserIdStr || currentUserIdStr === 'null' || currentUserIdStr === 'undefined') {
            throw new Error('User ID not found in localStorage');
          }
          
          // Verify this key exchange is for us
          // The server should have already filtered, but double-check
          console.log('📥 Retrieving private key...');
          const rsaPrivateKey = await getPrivateKey(currentUserIdStr, 'rsa');
          console.log('✅ Private key retrieved for response');
          console.log('   Private key length:', rsaPrivateKey.length);
          
          console.log('📥 Retrieving public key...');
          const rsaPublicKeyResponse = await api.get(`/users/${currentUserIdStr}/public-key`);
          const rsaPublicKey = rsaPublicKeyResponse.data.publicKey;
          console.log('✅ Public key retrieved for response');
          console.log('   Public key length:', rsaPublicKey.length);
          
          // Create API call wrapper that supports both GET and POST
          const apiCallWrapper = {
            get: async (endpoint) => {
              if (endpoint.startsWith('/')) {
                return await api.get(endpoint);
              }
              return await api.get(`/${endpoint}`);
            },
            post: async (endpoint, data) => {
              if (endpoint.startsWith('/')) {
                return await api.post(endpoint, data);
              }
              return await api.post(`/${endpoint}`, data);
            }
          };
          
          console.log('🔄 Starting response to key exchange...');
          console.log('Calling respondToIncomingKeyExchange with:');
          console.log('  - userId:', currentUserIdStr);
          console.log('  - keyExchangeId:', data.keyExchangeId);
          console.log('  - rsaPrivateKey length:', rsaPrivateKey.length);
          console.log('  - rsaPublicKey length:', rsaPublicKey.length);
          console.log('  - NOTE: Will fetch encrypted data from server API (not socket event)');
          
          await respondToIncomingKeyExchange(
            currentUserIdStr,
            data.keyExchangeId,
            rsaPrivateKey,
            rsaPublicKey,
            apiCallWrapper
          );
          
          console.log('✅✅✅ Successfully responded to key exchange request ✅✅✅');
        } catch (error) {
          console.error('❌❌❌ ERROR RESPONDING TO KEY EXCHANGE ❌❌❌');
          console.error('Error type:', error.constructor.name);
          console.error('Error message:', error.message);
          console.error('Error stack:', error.stack);
          console.error('Full error:', error);
          
          // Don't show alert - it's too intrusive. Just log it.
          // The user will see the timeout error from the initiator
        }
      })();
    });

    // Listen for key exchange completion
    newSocket.on('key-exchange-complete', async (data) => {
      console.log('Key exchange completed:', data);
      // Reload messages if we're in that conversation
      if (selectedUser?._id) {
        await loadMessages(selectedUser._id);
      }
    });

    // POLLING FALLBACK: Check for pending key exchanges every 5 seconds
    // This ensures we respond even if the socket event doesn't reach us
    const checkPendingKeyExchanges = async () => {
      try {
        const currentUserIdStr = String(localStorage.getItem('userId'));
        if (!currentUserIdStr || currentUserIdStr === 'null' || currentUserIdStr === 'undefined') {
          return;
        }

        // Get all pending key exchanges where we are the responder
        const response = await api.get('/key-exchange/pending');
        const pendingExchanges = response.data.pendingExchanges || [];
        
        if (pendingExchanges.length > 0) {
          console.log(`🔍 Found ${pendingExchanges.length} pending key exchange(s), processing...`);
          
          for (const exchange of pendingExchanges) {
            console.log(`   Processing key exchange: ${exchange._id}`);
            console.log(`   Initiator: ${exchange.initiatorId}`);
            console.log(`   Status: ${exchange.status}`);
            
            // Process this key exchange
            try {
              // Skip if encryptedInit is missing or too short (corrupted)
              if (!exchange.encryptedInit || exchange.encryptedInit.length < 300) {
                console.log(`⚠️ Skipping corrupted key exchange ${exchange._id} (encryptedInit too short: ${exchange.encryptedInit?.length || 0} chars)`);
                continue;
              }
              
              const rsaPrivateKey = await getPrivateKey(currentUserIdStr, 'rsa');
              const rsaPublicKeyResponse = await api.get(`/users/${currentUserIdStr}/public-key`);
              const rsaPublicKey = rsaPublicKeyResponse.data.publicKey;
              
              const apiCallWrapper = {
                get: async (endpoint) => {
                  if (endpoint.startsWith('/')) {
                    return await api.get(endpoint);
                  }
                  return await api.get(`/${endpoint}`);
                },
                post: async (endpoint, data) => {
                  if (endpoint.startsWith('/')) {
                    return await api.post(endpoint, data);
                  }
                  return await api.post(`/${endpoint}`, data);
                }
              };
              
              await respondToIncomingKeyExchange(
                currentUserIdStr,
                exchange._id,
                rsaPrivateKey,
                rsaPublicKey,
                apiCallWrapper
              );
              
              console.log(`✅ Successfully responded to key exchange ${exchange._id} via polling`);
            } catch (error) {
              // Skip corrupted key exchanges silently
              if (error.message && (error.message.includes('too small') || error.message.includes('corrupted') || error.message.includes('truncation'))) {
                console.log(`⚠️ Skipping corrupted key exchange ${exchange._id}: ${error.message}`);
                continue;
              }
              console.error(`❌ Failed to respond to key exchange ${exchange._id}:`, error.message);
            }
          }
        }
      } catch (error) {
        // Silently fail - this is just a fallback mechanism
        if (error.response?.status !== 404) {
          console.error('Error checking pending key exchanges:', error.message);
        }
      }
    };
    
    // Check immediately, then every 2 seconds for faster response
    checkPendingKeyExchanges();
    const pendingCheckInterval = setInterval(checkPendingKeyExchanges, 2000);
    
    console.log('✅ Started polling for pending key exchanges (every 5 seconds)');

    // Load users and conversations
    loadUsers();
    loadConversations();
    
    // Cleanup interval on unmount
    return () => {
      clearInterval(pendingCheckInterval);
      newSocket.close();
    };

    return () => {
      newSocket.close();
    };
  }, [navigate]);

  useEffect(() => {
    if (selectedUser) {
      loadMessages(selectedUser._id);
      establishSession(selectedUser);
    }
  }, [selectedUser]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const loadUsers = async () => {
    // In a real app, you'd have an endpoint to list users
    // For now, we'll use search functionality
  };

  const loadConversations = async () => {
    try {
      const response = await api.get('/messages/conversations');
      setConversations(response.data);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const establishSession = async (targetUser) => {
    try {
      const targetUserId = targetUser._id || targetUser.id;
      if (!targetUserId) {
        throw new Error('Target user ID is missing');
      }
      
      // Ensure userId is a string
      const userIdStr = String(userId);
      const targetUserIdStr = String(targetUserId);
      
      // Check if session already exists (try both directions)
      try {
        await getSessionKey(userIdStr, targetUserIdStr);
        console.log('✅ Session already exists');
        return; // Session exists, no need to create
      } catch (err) {
        console.log('⚠️ No existing session, initiating key exchange...');
      }
      
      // Get RSA private key for key exchange
      const rsaPrivateKey = await getPrivateKey(userIdStr, 'rsa');
      
      // Get target user's public key
      const targetUserResponse = await api.get(`/users/${targetUserIdStr}/public-key`);
      const targetRSAPublicKey = targetUserResponse.data.publicKey;
      
      // Validate public key
      if (!targetRSAPublicKey || typeof targetRSAPublicKey !== 'string') {
        throw new Error(`Invalid public key received from server: ${typeof targetRSAPublicKey}`);
      }
      
      console.log('🚀 Initiating key exchange (10s timeout)...');
      
      // Create API call wrapper
      const apiCallWrapper = {
        get: async (endpoint) => await api.get(endpoint),
        post: async (endpoint, data) => await api.post(endpoint, data)
      };
      
      // Perform full key exchange with timeout
      const exchangePromise = performFullKeyExchange(
        userIdStr,
        targetUserIdStr,
        rsaPrivateKey,
        targetRSAPublicKey,
        apiCallWrapper,
        socket
      );
      
      // Add timeout wrapper (increased to 30s for reliability)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Key exchange timeout: Please try again')), 30000);
      });
      
      const result = await Promise.race([exchangePromise, timeoutPromise]);
      
      console.log('✅ Key exchange completed successfully!');
      console.log('✅ Session established for:', userIdStr, '->', targetUserIdStr);
    } catch (error) {
      console.error('❌ Error establishing session:', error);
      // Don't show alert if called in background - just log
      if (error.message.includes('timeout')) {
        console.warn('Key exchange timed out - user can retry by sending a message');
      }
      throw error; // Re-throw so caller can handle
    }
  };

  const loadMessages = async (targetUserId) => {
    if (!targetUserId) return;

    try {
      // Ensure userIds are strings
      const userIdStr = String(userId);
      const targetUserIdStr = String(targetUserId);
      
      const response = await api.get(`/messages/conversation/${targetUserIdStr}`);
      const encryptedMessages = response.data;

      // Ensure session exists before trying to decrypt
      try {
        await getSessionKey(userIdStr, targetUserIdStr);
      } catch (err) {
        console.log('No session found when loading messages, establishing...');
        // Try to establish session if we have the user info
        if (selectedUser) {
          await establishSession(selectedUser);
        }
      }

      // Decrypt messages
      const decryptedMessages = await Promise.all(
        encryptedMessages.map(async (msg) => {
          try {
            const isSent = String(msg.senderId) === userIdStr;
            const otherUserId = isSent ? String(msg.receiverId) : String(msg.senderId);
            
            // Ensure session exists for this conversation
            try {
              await getSessionKey(userIdStr, otherUserId);
            } catch (err) {
              console.log('No session for message decryption, establishing...');
              // Create a temporary user object to establish session
              const tempUser = { _id: otherUserId, id: otherUserId };
              await establishSession(tempUser);
            }
            
            const decrypted = await decryptMessage(userIdStr, otherUserId, {
              ciphertext: msg.ciphertext,
              iv: msg.iv,
              tag: msg.tag,
              nonce: msg.nonce,
              sequenceNumber: msg.sequenceNumber
            });

            return {
              ...msg,
              text: decrypted.text,
              decrypted: true,
              messageType: msg.messageType || 'text'
            };
          } catch (error) {
            console.error('Failed to decrypt message:', error);
            // Report decryption failure
            await api.post('/messages/decryption-failure', {
              messageId: msg._id,
              reason: error.message
            });
            
            return {
              ...msg,
              text: '[Failed to decrypt]',
              decrypted: false
            };
          }
        })
      );

      setMessages(decryptedMessages);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUser) return;

    setLoading(true);
    const messageText = newMessage.trim();
    setNewMessage(''); // Clear input immediately for better UX
    
    try {
      // Ensure userIds are strings
      const userIdStr = String(userId);
      const receiverIdStr = String(selectedUser._id || selectedUser.id);
      
      // Check if session exists (non-blocking check)
      let sessionExists = false;
      try {
        await getSessionKey(userIdStr, receiverIdStr);
        sessionExists = true;
      } catch (err) {
        console.log('No session found, establishing in background...');
        // Start key exchange in background (non-blocking)
        establishSession(selectedUser).catch(err => {
          console.error('Background key exchange failed:', err);
        });
        // Show user-friendly message
        alert('Establishing secure connection... Please try sending again in a moment.');
        setLoading(false);
        return;
      }

      // Encrypt message (only if session exists)
      const encrypted = await encryptMessage(userIdStr, receiverIdStr, messageText);
      
      console.log('Encrypted message data:', encrypted);
      console.log('Receiver ID:', selectedUser._id);

      // Validate all encrypted fields
      if (!encrypted.ciphertext || !encrypted.iv || !encrypted.tag || !encrypted.nonce || encrypted.sequenceNumber === undefined) {
        console.error('Encrypted data incomplete:', encrypted);
        throw new Error('Encryption failed - missing fields');
      }

      const messagePayload = {
        receiverId: receiverIdStr, // Already a string
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        nonce: encrypted.nonce,
        sequenceNumber: Number(encrypted.sequenceNumber) // Ensure it's a number
      };

      console.log('Sending message payload:', messagePayload);

      // Send to server
      const response = await api.post('/messages/send', messagePayload);

      console.log('Message sent successfully:', response.data);
      // Don't await - load messages in background for faster UX
      loadMessages(receiverIdStr).catch(err => console.error('Error loading messages:', err));
      loadConversations().catch(err => console.error('Error loading conversations:', err));
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error.response?.data?.error || error.message || 'Failed to send message';
      alert(`Failed to send message: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !selectedUser) return;

    setLoading(true);
    try {
      // Ensure userIds are strings
      const userIdStr = String(userId);
      const receiverIdStr = String(selectedUser._id || selectedUser.id);
      
      if (!receiverIdStr) {
        throw new Error('Receiver ID is missing');
      }
      
      // Ensure session is established before encrypting
      try {
        await getSessionKey(userIdStr, receiverIdStr);
      } catch (err) {
        console.log('No session found for file upload, establishing...');
        await establishSession(selectedUser);
      }

      console.log('Encrypting file:', file.name, 'Size:', file.size);

      // Encrypt file
      const encrypted = await encryptFile(userIdStr, receiverIdStr, file);

      console.log('File encrypted, chunks:', encrypted.chunks.length);
      console.log('Encrypted data:', {
        originalFilename: encrypted.originalFilename,
        mimeType: encrypted.mimeType,
        nonce: encrypted.nonce,
        chunksCount: encrypted.chunks.length
      });

      // Validate encrypted data before creating FormData
      if (!encrypted.nonce) {
        console.error('Encrypted data missing nonce:', encrypted);
        throw new Error('File encryption failed: nonce is missing');
      }
      if (!encrypted.originalFilename) {
        console.error('Encrypted data missing filename:', encrypted);
        throw new Error('File encryption failed: filename is missing');
      }
      if (!encrypted.chunks || encrypted.chunks.length === 0) {
        console.error('Encrypted data missing chunks:', encrypted);
        throw new Error('File encryption failed: no chunks generated');
      }

      // Create FormData with validated data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('receiverId', receiverIdStr);
      formData.append('originalFilename', String(encrypted.originalFilename));
      formData.append('mimeType', String(encrypted.mimeType || file.type || 'application/octet-stream'));
      formData.append('chunks', JSON.stringify(encrypted.chunks));
      formData.append('nonce', String(encrypted.nonce));

      // Log FormData contents for debugging
      console.log('=== FormData Validation ===');
      console.log('receiverId:', receiverIdStr, typeof receiverIdStr);
      console.log('originalFilename:', String(encrypted.originalFilename));
      console.log('mimeType:', String(encrypted.mimeType || file.type || 'application/octet-stream'));
      console.log('nonce:', String(encrypted.nonce), 'length:', String(encrypted.nonce).length);
      console.log('chunks count:', encrypted.chunks.length);
      console.log('file:', file.name, file.size, 'bytes', file.type);
      
      // Verify all fields are set
      const allFieldsSet = [
        receiverIdStr,
        String(encrypted.originalFilename),
        String(encrypted.mimeType || file.type || 'application/octet-stream'),
        String(encrypted.nonce),
        file
      ].every(field => field && field !== 'undefined' && field !== 'null');
      
      if (!allFieldsSet) {
        console.error('Some fields are invalid:', {
          receiverId: receiverIdStr,
          originalFilename: String(encrypted.originalFilename),
          mimeType: String(encrypted.mimeType || file.type || 'application/octet-stream'),
          nonce: String(encrypted.nonce),
          file: file ? 'present' : 'missing'
        });
        throw new Error('One or more required fields are invalid');
      }

      console.log('Uploading file to server...');
      console.log('Chunks JSON size:', JSON.stringify(encrypted.chunks).length, 'bytes');

      // Upload - axios will automatically handle FormData and set Content-Type with boundary
      let fileUploadResponse;
      try {
        fileUploadResponse = await api.post('/files/upload', formData);
        console.log('File uploaded successfully:', fileUploadResponse.data);
      } catch (uploadError) {
        console.error('Upload error details:', {
          status: uploadError.response?.status,
          statusText: uploadError.response?.statusText,
          data: uploadError.response?.data,
          message: uploadError.message
        });
        throw uploadError;
      }
      const fileId = fileUploadResponse.data.fileId;

      // Create a message to notify about the file
      const fileSizeKB = (file.size / 1024).toFixed(2);
      const fileSizeMB = file.size > 1024 * 1024 ? ` (${(file.size / (1024 * 1024)).toFixed(2)} MB)` : ` (${fileSizeKB} KB)`;
      const fileMessage = `📎 File: ${encrypted.originalFilename}${fileSizeMB}`;
      
      // Encrypt and send the file notification message
      const encryptedMessage = await encryptMessage(userIdStr, receiverIdStr, fileMessage);
      
      const messageResponse = await api.post('/messages/send', {
        receiverId: receiverIdStr,
        ciphertext: encryptedMessage.ciphertext,
        iv: encryptedMessage.iv,
        tag: encryptedMessage.tag,
        nonce: encryptedMessage.nonce,
        sequenceNumber: encryptedMessage.sequenceNumber,
        messageType: 'file'
      });

      console.log('File message sent:', messageResponse.data);
      
      // Reload messages to show the new file message
      await loadMessages(receiverIdStr);
      await loadConversations(); // Refresh conversations list
      
      // Also notify via socket (in case receiver is online)
      if (socket) {
        socket.emit('message-sent', {
          receiverId: receiverIdStr,
          messageId: messageResponse.data.messageId
        });
      }
      
      // Clear file input
      e.target.value = '';
    } catch (error) {
      console.error('Error uploading file:', error);
      console.error('Error details:', {
        response: error.response,
        request: error.request,
        message: error.message,
        code: error.code
      });
      
      let errorMessage = 'Failed to upload file';
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.message) {
        errorMessage = error.message;
      } else if (error.response?.status === 413) {
        errorMessage = 'File too large (max 200MB)';
      } else if (error.response?.status === 400) {
        errorMessage = error.response.data?.missingFields 
          ? `Missing fields: ${error.response.data.missingFields.join(', ')}`
          : 'Invalid file data';
      } else if (error.response?.status === 500) {
        errorMessage = 'Server error. Please try again.';
      }
      
      alert(`Failed to upload file: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSearchUser = async (username) => {
    try {
      const response = await api.get(`/users/search/${username}`);
      console.log('User search response:', response.data);
      // Ensure we have the user ID in the expected format
      const userData = {
        ...response.data,
        _id: response.data.id || response.data._id
      };
      setSelectedUser(userData);
    } catch (error) {
      console.error('User search error:', error);
      alert('User not found');
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  return (
    <div className="chat-container">
      <div className="chat-sidebar">
        <div className="chat-header">
          <h2>Secure Chat</h2>
          <div className="user-info">
            <span>{username}</span>
            <button onClick={handleLogout} className="logout-btn" title="Logout">Logout</button>
          </div>
        </div>
        <div className="user-search">
          <input
            type="text"
            placeholder="Search user..."
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSearchUser(e.target.value);
              }
            }}
          />
        </div>
        <div className="conversations-section">
          <div className="conversations-header">
            <h3>Chatting with: {username}</h3>
          </div>
          <div className="conversations-list">
            {conversations.length === 0 ? (
              <div className="no-conversations">
                <p>No conversations yet. Search for a user to start chatting!</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.userId}
                  className={`conversation-item ${selectedUser?._id === conv.userId ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedUser({
                      _id: conv.userId,
                      id: conv.userId,
                      username: conv.username
                    });
                  }}
                >
                  <div className="conversation-avatar-small">
                    {conv.username?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div className="conversation-details">
                    <div className="conversation-name-small">
                      {conv.username}
                      {conv.isOnline && <span className="online-dot"></span>}
                    </div>
                    <div className="conversation-time">
                      {conv.lastMessageTime 
                        ? new Date(conv.lastMessageTime).toLocaleDateString()
                        : ''}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="chat-main">
        {selectedUser ? (
          <>
            <div className="chat-conversation-header">
              <div className="conversation-header-content">
                <div className="conversation-avatar">
                  {selectedUser.username?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div className="conversation-info">
                  <div className="conversation-name">
                    {selectedUser.username}
                    <span className="online-indicator"></span>
                    <span className="online-status">Online</span>
                  </div>
                  <div className="conversation-handle">@{selectedUser.username}</div>
                </div>
              </div>
              <div className="conversation-actions">
                <button className="action-btn" title="Call">
                  📞
                </button>
                <button 
                  className="action-btn" 
                  title="View Profile"
                  onClick={() => setShowProfileModal(true)}
                >
                  View Profile
                </button>
                <button className="action-btn menu-btn" title="More options">
                  ⋮
                </button>
              </div>
            </div>
            <div className="messages-container">
              {messages.length === 0 && (
                <div className="no-messages">
                  <p>No messages yet. Start the conversation!</p>
                </div>
              )}
              {messages.map((msg, idx) => {
                const msgDate = new Date(msg.timestamp);
                const prevMsgDate = idx > 0 ? new Date(messages[idx - 1].timestamp) : null;
                const showDate = !prevMsgDate || 
                  msgDate.toDateString() !== prevMsgDate.toDateString();
                
                return (
                  <React.Fragment key={idx}>
                    {showDate && (
                      <div className="date-separator">
                        {msgDate.toLocaleDateString('en-US', { 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </div>
                    )}
                    <div
                      className={`message ${msg.senderId === userId ? 'sent' : 'received'} ${msg.messageType === 'file' ? 'file-message' : ''}`}
                    >
                      <div className="message-content">
                        {msg.messageType === 'file' ? (
                          <div className="file-message-content">
                            <span className="file-icon">📎</span>
                            <span className="file-text">{msg.decrypted ? msg.text : msg.text}</span>
                          </div>
                        ) : (
                          msg.decrypted ? msg.text : msg.text
                        )}
                      </div>
                      <div className="message-time">
                        {msgDate.toLocaleTimeString('en-US', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                        {msg.senderId === userId && (
                          <span className="message-status">✓</span>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSendMessage} className="message-input">
              <label className="file-upload-btn" title="Attach file">
                <input
                  type="file"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                />
                📎
              </label>
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                disabled={loading}
              />
              <button type="submit" disabled={loading || !newMessage.trim()}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="no-chat-selected">
            <p>Search for a user to start chatting</p>
          </div>
        )}
      </div>

      {/* Profile Modal */}
      {showProfileModal && selectedUser && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
            <div className="profile-modal-header">
              <h2>Profile</h2>
              <button 
                className="modal-close-btn"
                onClick={() => setShowProfileModal(false)}
              >
                ×
              </button>
            </div>
            <div className="profile-modal-content">
              <div className="profile-avatar-large">
                {selectedUser.username?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="profile-info">
                <h3>{selectedUser.username}</h3>
                <div className="profile-status">
                  <span className="online-indicator-large"></span>
                  <span className="status-text">Online</span>
                </div>
                <div className="profile-handle">@{selectedUser.username}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;

