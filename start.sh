#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "╔══════════════════════════════════════════╗"
echo "║     Victron Energy Dashboard – Start     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "✗  Node.js not found. Install it from https://nodejs.org (v18+)"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
echo "✓  Node.js $NODE_VER"

# Install / update dependencies if needed
if [ ! -d "$DIR/node_modules" ]; then
  echo "→  Installing dependencies…"
  npm install
  echo "✓  Dependencies installed"
else
  echo "✓  node_modules present"
fi

echo ""
echo "→  Starting server…"
echo ""

node server.js
