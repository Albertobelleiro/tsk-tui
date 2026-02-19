#!/bin/bash
set -euo pipefail

# tsk installer — downloads the latest release binary

REPO="Albertobelleiro/tsk-tui"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$OS" in
  darwin) OS="darwin" ;;
  linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY="tsk-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"

echo "Downloading tsk for ${OS}-${ARCH}..."
curl -fsSL "$URL" -o /tmp/tsk
chmod +x /tmp/tsk

echo "Installing to ${INSTALL_DIR}/tsk..."
sudo mv /tmp/tsk "${INSTALL_DIR}/tsk"

echo "tsk installed successfully! Run 'tsk' to get started."
