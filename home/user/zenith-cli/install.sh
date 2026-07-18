#!/usr/bin/env bash
# Zenith CLI Global Install Script
# Usage: curl -sSL https://... | bash
#   or:  bash install.sh

set -e

CLI_NAME="zenith-cli"
INSTALL_DIR="/opt/zenith-cli"
BIN_DIR="/usr/local/bin"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     ⚡  Zenith CLI Installer  ⚡       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Check for node
if ! command -v node &> /dev/null; then
  echo "✗ Node.js is required but not installed."
  echo "  Install it from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "✗ Node.js 18+ required (found $(node -v))"
  exit 1
fi

echo "✓ Node.js $(node -v) detected"

# Check for npm/pnpm
if command -v npm &> /dev/null; then
  PACKAGE_MANAGER="npm"
elif command -v pnpm &> /dev/null; then
  PACKAGE_MANAGER="pnpm"
else
  echo "✗ npm or pnpm required"
  exit 1
fi

echo "✓ $PACKAGE_MANAGER detected"
echo ""

# Determine install method
INSTALL_METHOD="local"
if [ "$EUID" -eq 0 ] || command -v sudo &> /dev/null; then
  INSTALL_METHOD="global"
fi

if [ "$INSTALL_METHOD" = "global" ]; then
  echo "Installing to $INSTALL_DIR (requires sudo)..."
  
  # Copy files
  sudo rm -rf "$INSTALL_DIR"
  sudo mkdir -p "$INSTALL_DIR"
  sudo cp -r "$(dirname "$0")/"* "$INSTALL_DIR/"
  
  # Install deps
  cd "$INSTALL_DIR"
  sudo $PACKAGE_MANAGER install --production --no-audit --no-fund
  
  # Build
  sudo $PACKAGE_MANAGER run build 2>/dev/null || true
  
  # Create symlinks
  sudo ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/zenith" 2>/dev/null || true
  sudo ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_DIR/zimg" 2>/dev/null || true
  
  echo ""
  echo "✓ Installed to $INSTALL_DIR"
  echo "✓ Symlinks created:"
  echo "    $BIN_DIR/zenith"
  echo "    $BIN_DIR/zimg"
else
  echo "Installing globally via $PACKAGE_MANAGER..."
  cd "$(dirname "$0")"
  
  if [ "$PACKAGE_MANAGER" = "npm" ]; then
    npm link 2>/dev/null || true
  else
    pnpm link --global 2>/dev/null || true
  fi
  
  echo ""
  echo "✓ Installed via $PACKAGE_MANAGER link"
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║          ✅ Installation Complete!    ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Quick Start:"
echo "    zenith \"a beautiful sunset\""
echo "    zenith providers list"
echo "    zenith config list"
echo "    zenith batch create prompts.txt"
echo "    zenith chat \"hello\""
echo ""
echo "  For providers that need tokens:"
echo "    zenith providers add gitee --token YOUR_TOKEN"
echo "    zenith providers add a4f --token YOUR_TOKEN"
echo ""
