#!/bin/bash

# Full Flow Test Script
# This script tests: Registration -> Login -> Key Exchange -> Messaging

set -e

BASE_URL="https://localhost:5001/api"
SKIP_SSL="--insecure"  # For self-signed cert

echo "=========================================="
echo "FULL FLOW TEST - E2EE Messaging System"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Register User 1
echo -e "${YELLOW}Step 1: Registering User 1 (testuser1)...${NC}"
USER1_RESPONSE=$(curl -s $SKIP_SSL -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser1",
    "password": "password123",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890ABCDEF"
  }' || echo "ERROR")

if [[ "$USER1_RESPONSE" == *"ERROR"* ]] || [[ "$USER1_RESPONSE" == *"error"* ]]; then
  echo -e "${RED}❌ User 1 registration failed${NC}"
  echo "$USER1_RESPONSE"
  exit 1
fi

USER1_TOKEN=$(echo "$USER1_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
USER1_ID=$(echo "$USER1_RESPONSE" | grep -o '"_id":"[^"]*' | cut -d'"' -f4 || echo "$USER1_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$USER1_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get User 1 token${NC}"
  echo "Response: $USER1_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ User 1 registered${NC}"
echo "   Token: ${USER1_TOKEN:0:20}..."
echo "   ID: $USER1_ID"
echo ""

# Step 2: Register User 2
echo -e "${YELLOW}Step 2: Registering User 2 (testuser2)...${NC}"
USER2_RESPONSE=$(curl -s $SKIP_SSL -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser2",
    "password": "password123",
    "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA9876543210FEDCBA"
  }' || echo "ERROR")

if [[ "$USER2_RESPONSE" == *"ERROR"* ]] || [[ "$USER2_RESPONSE" == *"error"* ]]; then
  echo -e "${RED}❌ User 2 registration failed${NC}"
  echo "$USER2_RESPONSE"
  exit 1
fi

USER2_TOKEN=$(echo "$USER2_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
USER2_ID=$(echo "$USER2_RESPONSE" | grep -o '"_id":"[^"]*' | cut -d'"' -f4 || echo "$USER2_RESPONSE" | grep -o '"id":"[^"]*' | cut -d'"' -f4)

if [ -z "$USER2_TOKEN" ]; then
  echo -e "${RED}❌ Failed to get User 2 token${NC}"
  echo "Response: $USER2_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ User 2 registered${NC}"
echo "   Token: ${USER2_TOKEN:0:20}..."
echo "   ID: $USER2_ID"
echo ""

# Step 3: Login User 1
echo -e "${YELLOW}Step 3: Logging in User 1...${NC}"
LOGIN1_RESPONSE=$(curl -s $SKIP_SSL -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser1",
    "password": "password123"
  }' || echo "ERROR")

if [[ "$LOGIN1_RESPONSE" == *"ERROR"* ]] || [[ "$LOGIN1_RESPONSE" == *"error"* ]]; then
  echo -e "${RED}❌ User 1 login failed${NC}"
  echo "$LOGIN1_RESPONSE"
  exit 1
fi

LOGIN1_TOKEN=$(echo "$LOGIN1_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
echo -e "${GREEN}✅ User 1 logged in${NC}"
echo ""

# Step 4: Search for User 2
echo -e "${YELLOW}Step 4: User 1 searching for User 2...${NC}"
SEARCH_RESPONSE=$(curl -s $SKIP_SSL -X GET "$BASE_URL/users/search/testuser2" \
  -H "Authorization: Bearer $LOGIN1_TOKEN" || echo "ERROR")

if [[ "$SEARCH_RESPONSE" == *"ERROR"* ]] || [[ "$SEARCH_RESPONSE" == *"error"* ]] || [[ "$SEARCH_RESPONSE" == *"404"* ]]; then
  echo -e "${RED}❌ User search failed${NC}"
  echo "$SEARCH_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ User 2 found${NC}"
echo "   Response: $SEARCH_RESPONSE"
echo ""

# Step 5: Check server status
echo -e "${YELLOW}Step 5: Checking server status...${NC}"
HEALTH=$(curl -s $SKIP_SSL "$BASE_URL/health" || echo "ERROR")
if [[ "$HEALTH" == *"ERROR"* ]]; then
  echo -e "${RED}❌ Server health check failed${NC}"
else
  echo -e "${GREEN}✅ Server is healthy${NC}"
fi
echo ""

echo "=========================================="
echo -e "${GREEN}✅ BASIC FLOW TEST COMPLETE${NC}"
echo "=========================================="
echo ""
echo "Next steps (manual testing in browsers):"
echo "1. Open Browser 1 → https://localhost:3002"
echo "2. Register/Login as testuser1"
echo "3. Open Browser 2 → https://localhost:3002"
echo "4. Register/Login as testuser2"
echo "5. In Browser 1, search for 'testuser2'"
echo "6. Click to connect and establish key exchange"
echo "7. Send a message"
echo ""

