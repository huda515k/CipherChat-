# Quick Start Guide - Running the Full Flow Test

## Issue: Port Already in Use

If you see the error `EADDRINUSE: address already in use :::5001`, it means a server is already running on that port.

## Solutions

### Option 1: Use Existing Server (Recommended)
The updated `run-test.sh` script will automatically detect if a server is already running and use it. Just run:

```bash
./run-test.sh
```

The script will:
- ✅ Check if server on port 5001 is already running and responding
- ✅ Use existing server if available
- ✅ Only start new servers if needed
- ✅ Clean up only processes it started

### Option 2: Stop Existing Servers
If you want to start fresh, stop existing servers first:

```bash
./stop-servers.sh
```

Then run the test:
```bash
./run-test.sh
```

### Option 3: Manual Server Management
If you prefer to manage servers manually:

**Terminal 1 - Server:**
```bash
cd server
npm start
```

**Terminal 2 - Client:**
```bash
cd client
npm start
```

**Terminal 3 - Run Test:**
```bash
npm run test-flow
```

## What the Test Does

1. ✅ Registers User 1
2. ✅ Registers User 2  
3. ✅ Logs in User 1
4. ✅ Logs in User 2
5. ✅ User 1 searches for User 2
6. ✅ User 2 searches for User 1
7. ✅ Establishes key exchange
8. ✅ User 1 sends message to User 2
9. ✅ User 2 receives and decrypts message
10. ✅ User 2 sends message to User 1
11. ✅ User 1 receives and decrypts message

## Troubleshooting

### Server not responding
```bash
# Check if server is running
curl http://localhost:5001/api/health

# Check what's using port 5001
lsof -i:5001

# Kill process on port 5001 (if needed)
lsof -ti:5001 | xargs kill
```

### Client not responding
```bash
# Check if client is running
curl http://localhost:3002

# Check what's using port 3002
lsof -i:3002

# Kill process on port 3002 (if needed)
lsof -ti:3002 | xargs kill
```

### MongoDB not running
Make sure MongoDB is running:
```bash
# Check MongoDB
mongosh --eval "db.adminCommand('ping')"

# Start MongoDB (if needed)
mongod
```

## Files Created

- `test-full-flow-puppeteer.js` - Main test script
- `run-test.sh` - Automated test runner (handles port conflicts)
- `stop-servers.sh` - Helper to stop servers on ports 5001/3002
- `TEST_RESULTS.md` - Detailed test documentation

## Next Steps

1. Make sure MongoDB is running
2. Run `./run-test.sh` (it will handle existing servers)
3. Watch the test execute in the browser windows
4. Check results and any error screenshots

