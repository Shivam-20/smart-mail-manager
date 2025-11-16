#!/bin/bash

# SmartMail AI - Start Script
# ---------------------------
# This script starts the SmartMail AI server with MongoDB integration

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SERVER_PORT=3000
SERVER_SCRIPT="server-mongo.js"
LOG_FILE="server.log"

# Check for required commands
command -v node >/dev/null 2>&1 || { echo -e "${RED}Error: Node.js is not installed.${NC}"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Error: npm is not installed.${NC}"; exit 1; }
command -v mongod >/dev/null 2>&1 || { echo -e "${YELLOW}Warning: MongoDB is not installed or not in PATH. Make sure MongoDB is running.${NC}"; }

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found. Creating from .env.example...${NC}"
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}Created .env file from .env.example${NC}"
        echo -e "${YELLOW}Please update the .env file with your configuration and restart the server.${NC}"
        exit 1
    else
        echo -e "${RED}Error: .env.example not found. Please create a .env file with your configuration.${NC}"
        exit 1
    fi
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}Error: Failed to install dependencies.${NC}"
        exit 1
    fi
fi

# Check if MongoDB is running
if ! pgrep -x "mongod" > /dev/null; then
    echo -e "${YELLOW}Warning: MongoDB does not appear to be running. Please start MongoDB before continuing.${NC}"
    read -p "Would you like to attempt to start MongoDB? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Starting MongoDB...${NC}"
        sudo systemctl start mongod
        if [ $? -ne 0 ]; then
            echo -e "${RED}Failed to start MongoDB. Please start it manually.${NC}"
            exit 1
        fi
    else
        echo -e "${YELLOW}Continuing without MongoDB. The server may not work correctly.${NC}"
    fi
fi

# Start the server
echo -e "${GREEN}Starting SmartMail AI server...${NC}"
echo -e "Server URL: ${YELLOW}http://localhost:${SERVER_PORT}/dashboard${NC}"
echo -e "Press ${YELLOW}Ctrl+C${NC} to stop the server"
echo -e "Logs will be written to: ${YELLOW}${LOG_FILE}${NC}"
echo "----------------------------------------"

# Run the server
NODE_ENV=production PORT=${SERVER_PORT} node ${SERVER_SCRIPT} 2>&1 | tee -a ${LOG_FILE}