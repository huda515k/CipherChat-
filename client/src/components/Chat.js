import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import api from '../services/api';
import { encryptMessage, decryptMessage } from '../utils/messageEncryption';
import { encryptFile } from '../utils/fileEncryption';
import { getPrivateKey, getSessionKey } from '../utils/keyStorage';
import { performFullKeyExchange, respondToIncomingKeyExchange } from '../utils/keyExchange';
import './Chat.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5001';

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
  const userId = localStorage.getItem('userId');
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

    // Initialize socket connection
    const newSocket = io(SOCKET_URL);
    newSocket.emit('join-room', currentUserId);
    setSocket(newSocket);

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
      console.log('Incoming key exchange request:', data);
      try {
        const rsaPrivateKey = await getPrivateKey(currentUserId, 'rsa');
        const rsaPublicKey = await api.get(`/users/${currentUserId}/public-key`);
        
        await respondToIncomingKeyExchange(
          currentUserId,
          data.keyExchangeId,
          rsaPrivateKey,
          rsaPublicKey.data.publicKey,
          (endpoint, data) => api.post(endpoint, data)
        );
        
        console.log('Responded to key exchange request');
      } catch (error) {
        console.error('Error responding to key exchange:', error);
      }
    });

    // Listen for key exchange completion
    newSocket.on('key-exchange-complete', async (data) => {
      console.log('Key exchange completed:', data);
      // Reload messages if we're in that conversation
      if (selectedUser?._id) {
        await loadMessages(selectedUser._id);
      }
    });

    // Load users and conversations
    loadUsers();
    loadConversations();

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
      
      // Check if session already exists (try both directions)
      try {
        await getSessionKey(userId, targetUserId);
        console.log('Session already exists');
        return; // Session exists, no need to create
      } catch (err) {
        console.log('No existing session, initiating full key exchange...');
      }
      
      // Get RSA private key for key exchange
      const rsaPrivateKey = await getPrivateKey(userId, 'rsa');
      
      // Get target user's public key
      const targetUserResponse = await api.get(`/users/${targetUserId}/public-key`);
      const targetRSAPublicKey = targetUserResponse.data.publicKey;
      
      console.log('Initiating full ECDH key exchange protocol...');
      
      // Perform full key exchange
      const result = await performFullKeyExchange(
        userId,
        targetUserId,
        rsaPrivateKey,
        targetRSAPublicKey,
        (endpoint, data) => api.post(endpoint, data),
        socket
      );
      
      console.log('Key exchange completed successfully!');
      console.log('Session established for:', userId, '->', targetUserId);
    } catch (error) {
      console.error('Error establishing session:', error);
      alert(`Failed to establish secure session: ${error.message}. Please try again.`);
    }
  };

  const loadMessages = async (targetUserId) => {
    if (!targetUserId) return;

    try {
      const response = await api.get(`/messages/conversation/${targetUserId}`);
      const encryptedMessages = response.data;

      // Ensure session exists before trying to decrypt
      try {
        await getSessionKey(userId, targetUserId);
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
            const isSent = msg.senderId === userId;
            const otherUserId = isSent ? msg.receiverId : msg.senderId;
            
            // Ensure session exists for this conversation
            try {
              await getSessionKey(userId, otherUserId);
            } catch (err) {
              console.log('No session for message decryption, establishing...');
              // Create a temporary user object to establish session
              const tempUser = { _id: otherUserId, id: otherUserId };
              await establishSession(tempUser);
            }
            
            const decrypted = await decryptMessage(userId, otherUserId, {
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
    try {
      // Ensure session is established before sending
      try {
        await getSessionKey(userId, selectedUser._id);
      } catch (err) {
        console.log('No session found, establishing...');
        await establishSession(selectedUser);
      }

      // Encrypt message
      const encrypted = await encryptMessage(userId, selectedUser._id, newMessage);
      
      console.log('Encrypted message data:', encrypted);
      console.log('Receiver ID:', selectedUser._id);

      // Prepare message payload
      // Handle both _id and id formats
      const receiverId = selectedUser._id || selectedUser.id;
      
      if (!receiverId) {
        console.error('Selected user:', selectedUser);
        throw new Error('Receiver ID is missing. Selected user: ' + JSON.stringify(selectedUser));
      }

      // Validate all encrypted fields
      if (!encrypted.ciphertext || !encrypted.iv || !encrypted.tag || !encrypted.nonce || encrypted.sequenceNumber === undefined) {
        console.error('Encrypted data incomplete:', encrypted);
        throw new Error('Encryption failed - missing fields');
      }

      const messagePayload = {
        receiverId: String(receiverId), // Ensure it's a string
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
      setNewMessage('');
      await loadMessages(selectedUser._id);
      await loadConversations(); // Refresh conversations list
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
      // Ensure session is established before encrypting
      try {
        await getSessionKey(userId, selectedUser._id);
      } catch (err) {
        console.log('No session found for file upload, establishing...');
        await establishSession(selectedUser);
      }

      // Get receiver ID
      const receiverId = selectedUser._id || selectedUser.id;
      if (!receiverId) {
        throw new Error('Receiver ID is missing');
      }

      console.log('Encrypting file:', file.name, 'Size:', file.size);

      // Encrypt file
      const encrypted = await encryptFile(userId, receiverId, file);

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
      formData.append('receiverId', String(receiverId));
      formData.append('originalFilename', String(encrypted.originalFilename));
      formData.append('mimeType', String(encrypted.mimeType || file.type || 'application/octet-stream'));
      formData.append('chunks', JSON.stringify(encrypted.chunks));
      formData.append('nonce', String(encrypted.nonce));

      // Log FormData contents for debugging
      console.log('=== FormData Validation ===');
      console.log('receiverId:', String(receiverId), typeof receiverId);
      console.log('originalFilename:', String(encrypted.originalFilename));
      console.log('mimeType:', String(encrypted.mimeType || file.type || 'application/octet-stream'));
      console.log('nonce:', String(encrypted.nonce), 'length:', String(encrypted.nonce).length);
      console.log('chunks count:', encrypted.chunks.length);
      console.log('file:', file.name, file.size, 'bytes', file.type);
      
      // Verify all fields are set
      const allFieldsSet = [
        String(receiverId),
        String(encrypted.originalFilename),
        String(encrypted.mimeType || file.type || 'application/octet-stream'),
        String(encrypted.nonce),
        file
      ].every(field => field && field !== 'undefined' && field !== 'null');
      
      if (!allFieldsSet) {
        console.error('Some fields are invalid:', {
          receiverId: String(receiverId),
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
      const encryptedMessage = await encryptMessage(userId, receiverId, fileMessage);
      
      const messageResponse = await api.post('/messages/send', {
        receiverId: String(receiverId),
        ciphertext: encryptedMessage.ciphertext,
        iv: encryptedMessage.iv,
        tag: encryptedMessage.tag,
        nonce: encryptedMessage.nonce,
        sequenceNumber: encryptedMessage.sequenceNumber,
        messageType: 'file'
      });

      console.log('File message sent:', messageResponse.data);
      
      // Reload messages to show the new file message
      await loadMessages(receiverId);
      await loadConversations(); // Refresh conversations list
      
      // Also notify via socket (in case receiver is online)
      if (socket) {
        socket.emit('message-sent', {
          receiverId: String(receiverId),
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

