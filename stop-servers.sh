#!/bin/bash

# Script to stop servers running on ports 5001 and 3002

echo "Stopping servers..."

# Stop server on port 5001
if lsof -ti:5001 > /dev/null 2>&1; then
    echo "Stopping server on port 5001..."
    lsof -ti:5001 | xargs kill -9 2>/dev/null || true
    sleep 1
    if lsof -ti:5001 > /dev/null 2>&1; then
        echo "⚠️  Some processes on port 5001 may still be running"
    else
        echo "✅ Port 5001 is now free"
    fi
else
    echo "✅ Port 5001 is already free"
fi

# Stop client on port 3002
if lsof -ti:3002 > /dev/null 2>&1; then
    echo "Stopping client on port 3002..."
    lsof -ti:3002 | xargs kill -9 2>/dev/null || true
    sleep 1
    if lsof -ti:3002 > /dev/null 2>&1; then
        echo "⚠️  Some processes on port 3002 may still be running"
    else
        echo "✅ Port 3002 is now free"
    fi
else
    echo "✅ Port 3002 is already free"
fi

echo ""
echo "Done!"

