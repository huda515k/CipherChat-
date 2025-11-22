# Setup Guide

## Quick Start

### 1. Prerequisites Check
```bash
# Check Node.js version (should be 16+)
node --version

# Check npm version
npm --version

# Check if MongoDB is installed
mongod --version
```

### 2. Install Dependencies
```bash
# Install all dependencies
npm run install-all

# Or manually:
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 3. Start MongoDB
```bash
# On macOS (if installed via Homebrew)
brew services start mongodb-community

# On Linux
sudo systemctl start mongod

# Or run directly
mongod --dbpath /path/to/data/directory
```

### 4. Configure Environment Variables

#### Server Configuration
Create `server/.env`:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/e2ee_messaging
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
CLIENT_URL=http://localhost:3000
NODE_ENV=development
```

#### Client Configuration (Optional)
Create `client/.env`:
```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_SOCKET_URL=http://localhost:5000
```

### 5. Start the Application

#### Option 1: Run Both Together
```bash
npm run dev
```

#### Option 2: Run Separately
```bash
# Terminal 1 - Server
cd server
npm start

# Terminal 2 - Client
cd client
npm start
```

### 6. Access the Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Health Check**: http://localhost:5000/api/health

## Testing the System

### 1. Register Users
1. Open http://localhost:3000/register
2. Register User 1 (e.g., "alice")
3. Open a new incognito window
4. Register User 2 (e.g., "bob")

### 2. Test Key Exchange
1. Login as User 1
2. Search for User 2
3. System automatically establishes key exchange
4. Check server logs for key exchange events

### 3. Test Encrypted Messaging
1. User 1 sends a message to User 2
2. Message is encrypted client-side
3. Only ciphertext is sent to server
4. User 2 receives and decrypts message

### 4. Test File Sharing
1. User 1 uploads a file
2. File is encrypted and chunked
3. Encrypted chunks stored on server
4. User 2 downloads and decrypts file

### 5. Test Attack Demonstrations
```bash
# MITM Attack Demo
node attacks/mitm-attack.js

# Replay Attack Demo
node attacks/replay-attack.js
```

## Troubleshooting

### MongoDB Connection Error
```
Error: MongoDB connection error
```
**Solution**: 
- Ensure MongoDB is running: `mongod`
- Check connection string in `server/.env`
- Verify MongoDB is accessible on port 27017

### Port Already in Use
```
Error: Port 5000 already in use
```
**Solution**:
- Change PORT in `server/.env`
- Or kill process using port: `lsof -ti:5000 | xargs kill`

### Module Not Found
```
Error: Cannot find module 'xxx'
```
**Solution**:
- Run `npm install` in the respective directory
- Check `package.json` for correct dependencies

### IndexedDB Not Available
```
Error: IndexedDB not supported
```
**Solution**:
- Use a modern browser (Chrome, Firefox, Safari, Edge)
- Ensure browser allows IndexedDB
- Check browser console for errors

### CORS Errors
```
Error: CORS policy blocked
```
**Solution**:
- Check `CLIENT_URL` in `server/.env` matches frontend URL
- Verify CORS configuration in `server/index.js`

### Key Generation Fails
```
Error: Key generation failed
```
**Solution**:
- Ensure browser supports Web Crypto API
- Check browser console for detailed errors
- Try refreshing the page

## Development Tips

### Viewing Security Logs
```bash
# Access logs via API (requires authentication)
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:5000/api/logs
```

### Database Inspection
```bash
# Connect to MongoDB
mongo

# Use database
use e2ee_messaging

# View collections
show collections

# View users
db.users.find()

# View messages (ciphertext only)
db.messages.find()
```

### Testing with Multiple Browsers
1. Open Chrome - Login as User 1
2. Open Firefox - Login as User 2
3. Test messaging between browsers

### Clearing Data
```javascript
// In browser console
indexedDB.deleteDatabase('E2EEKeyStore');
localStorage.clear();
```

## Production Deployment

### Security Checklist
- [ ] Change `JWT_SECRET` to strong random value
- [ ] Use HTTPS (not HTTP)
- [ ] Set `NODE_ENV=production`
- [ ] Enable MongoDB authentication
- [ ] Configure proper CORS origins
- [ ] Set up rate limiting
- [ ] Enable Helmet security headers
- [ ] Use environment variables for secrets
- [ ] Set up monitoring and logging
- [ ] Regular security audits

### Deployment Options
1. **Heroku**: Easy deployment for both client and server
2. **AWS**: EC2 for server, S3 for static files
3. **DigitalOcean**: Droplet for full stack
4. **Docker**: Containerize application

## Additional Resources

- [Web Crypto API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [React Documentation](https://reactjs.org/docs/)
- [Express.js Documentation](https://expressjs.com/)

## Support

For issues or questions:
1. Check the README.md
2. Review THREAT_MODELING.md
3. Check server logs
4. Check browser console
5. Review attack demonstration scripts

