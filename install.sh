#!/bin/bash

set -e

echo "=============================================="
echo " Option Analytics Platform - Installation"
echo "=============================================="

# 1. Setup Environment Variables
echo ""
echo "[1/3] Setting up environment files..."

if [ ! -f backend/.env ]; then
    cp backend/.env.example backend/.env
    echo "  ✅ Created backend/.env"
else
    echo "  ⏭️  backend/.env already exists."
fi

if [ ! -f frontend/.env.local ]; then
    cp frontend/.env.example frontend/.env.local
    echo "  ✅ Created frontend/.env.local"
else
    echo "  ⏭️  frontend/.env.local already exists."
fi

# 2. Install Backend Dependencies
echo ""
echo "[2/3] Installing Backend Dependencies..."
if command -v poetry &> /dev/null; then
    cd backend
    poetry install
    cd ..
    echo "  ✅ Backend dependencies installed."
else
    echo "  ⚠️  Poetry is not installed. Skipping backend native install."
    echo "     (This is fine if you only plan to run via Docker)"
fi

# 3. Install Frontend Dependencies
echo ""
echo "[3/3] Installing Frontend Dependencies..."
if command -v npm &> /dev/null; then
    cd frontend
    npm install
    cd ..
    echo "  ✅ Frontend dependencies installed."
else
    echo "  ⚠️  npm is not installed. Skipping frontend native install."
    echo "     (This is fine if you only plan to run via Docker)"
fi

echo ""
echo "=============================================="
echo " Installation Complete! 🎉"
echo " Run ./start.sh to launch the platform."
echo "=============================================="
