#!/bin/bash

# Test Runner Script for E2EE Messaging System
# This script starts the servers and runs the full flow test

set -e

echo "=========================================="
echo "E2EE Messaging System - Full Flow Test"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if port is in use
check_port() {
    local port=$1
    if lsof -Pi :${port} -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Check if server is responding (tries both HTTP and HTTPS)
check_server() {
    local port=$1
    # Try HTTPS first (since server defaults to HTTPS if certs exist)
    if curl -k -s "https://localhost:${port}/api/health" > /dev/null 2>&1; then
        return 0
    # Fallback to HTTP
    elif curl -s "http://localhost:${port}/api/health" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Check if server is running
if check_server 5001; then
    echo -e "${GREEN}✅ Server is already running and responding${NC}"
    SERVER_STARTED_BY_SCRIPT=false
elif check_port 5001; then
    echo -e "${YELLOW}⚠️  Port 5001 is in use but health check failed${NC}"
    echo -e "${YELLOW}   Server may be running on HTTPS or still starting...${NC}"
    SERVER_STARTED_BY_SCRIPT=false
    # Wait a bit and check again (server might be starting)
    echo "Waiting for server to be ready..."
    for i in {1..10}; do
        if check_server 5001; then
            echo -e "${GREEN}✅ Server is now responding${NC}"
            break
        fi
        if [ $i -eq 10 ]; then
            echo -e "${YELLOW}⚠️  Health check still failing, but port is in use${NC}"
            echo -e "${YELLOW}   Assuming server is running (may be HTTPS)${NC}"
            echo -e "${YELLOW}   Continuing with test...${NC}"
        fi
        sleep 1
    done
else
    echo -e "${YELLOW}Starting server...${NC}"
    cd server
    npm start > /tmp/server.log 2>&1 &
    SERVER_PID=$!
    cd ..
    SERVER_STARTED_BY_SCRIPT=true
    
    # Wait for server to start
    echo "Waiting for server to start..."
    SERVER_STARTED=false
    for i in {1..30}; do
        if check_server 5001; then
            echo -e "${GREEN}✅ Server is running and responding${NC}"
            SERVER_STARTED=true
            break
        fi
        # Check if port is in use (server may have started but not ready yet)
        if check_port 5001; then
            echo -e "${YELLOW}   Server process detected on port 5001, waiting for health check... (${i}/30)${NC}"
        fi
        sleep 1
    done
    
    # If health check failed but port is in use, assume server is running
    if [ "$SERVER_STARTED" = false ]; then
        if check_port 5001; then
            echo -e "${YELLOW}⚠️  Health check failed but port 5001 is in use${NC}"
            echo "Server logs:"
            tail -20 /tmp/server.log 2>/dev/null || echo "No server logs found"
            echo ""
            echo -e "${YELLOW}Assuming server is running (may be HTTPS with cert issues)${NC}"
            echo -e "${YELLOW}Continuing with test...${NC}"
            SERVER_STARTED=true
        else
            echo -e "${RED}❌ Server failed to start${NC}"
            echo "Server logs:"
            tail -20 /tmp/server.log 2>/dev/null || echo "No server logs found"
            kill $SERVER_PID 2>/dev/null || true
            exit 1
        fi
    fi
fi

# Check if client is running (check for HTTP response, not API endpoint)
check_client() {
    if curl -s "http://localhost:3002" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Check if client is running
if check_client; then
    echo -e "${GREEN}✅ Client is already running${NC}"
    CLIENT_STARTED_BY_SCRIPT=false
elif check_port 3002; then
    echo -e "${YELLOW}⚠️  Port 3002 is in use but client is not responding${NC}"
    echo -e "${YELLOW}   Attempting to use existing client...${NC}"
    CLIENT_STARTED_BY_SCRIPT=false
    sleep 2
    if check_client; then
        echo -e "${GREEN}✅ Client is now responding${NC}"
    else
        echo -e "${YELLOW}⚠️  Client on port 3002 may still be starting up${NC}"
        echo -e "${YELLOW}   Continuing with test...${NC}"
    fi
else
    echo -e "${YELLOW}Starting client...${NC}"
    cd client
    BROWSER=none npm start > /tmp/client.log 2>&1 &
    CLIENT_PID=$!
    cd ..
    CLIENT_STARTED_BY_SCRIPT=true
    
    # Wait for client to start (React apps can take 30-60 seconds)
    echo "Waiting for client to start (this may take 30-60 seconds)..."
    CLIENT_READY=false
    for i in {1..90}; do
        if check_client; then
            echo -e "${GREEN}✅ Client is running and responding${NC}"
            CLIENT_READY=true
            break
        fi
        if [ $((i % 10)) -eq 0 ]; then
            echo "   Still waiting... (${i}/90 seconds)"
        fi
        sleep 1
    done
    
    if [ "$CLIENT_READY" = false ]; then
        echo -e "${RED}❌ Client failed to start after 90 seconds${NC}"
        echo "Client logs (last 20 lines):"
        tail -20 /tmp/client.log 2>/dev/null || echo "No logs found"
        echo ""
        echo -e "${YELLOW}You may need to start the client manually:${NC}"
        echo -e "${YELLOW}  cd client && npm start${NC}"
        echo ""
        echo -e "${YELLOW}Or check if there are errors in the client logs${NC}"
        kill $CLIENT_PID 2>/dev/null || true
        exit 1
    fi
    
    # Give it a few more seconds to fully initialize
    echo "Waiting for client to fully initialize..."
    sleep 5
fi

# Wait a bit for everything to be ready
sleep 3

# Run the test
echo ""
echo -e "${YELLOW}Running full flow test...${NC}"
echo ""

node test-full-flow-puppeteer.js

TEST_EXIT_CODE=$?

# Cleanup - only kill processes we started
if [ "$SERVER_STARTED_BY_SCRIPT" = true ] && [ ! -z "$SERVER_PID" ]; then
    echo "Stopping server..."
    kill $SERVER_PID 2>/dev/null || true
    # Also kill any node processes on port 5001 that we might have started
    lsof -ti:5001 | xargs kill 2>/dev/null || true
fi

if [ "$CLIENT_STARTED_BY_SCRIPT" = true ] && [ ! -z "$CLIENT_PID" ]; then
    echo "Stopping client..."
    kill $CLIENT_PID 2>/dev/null || true
    # Also kill any node processes on port 3002 that we might have started
    lsof -ti:3002 | xargs kill 2>/dev/null || true
fi

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}❌ Tests failed${NC}"
    exit 1
fi

