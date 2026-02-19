#!/bin/bash
set -euo pipefail

# tsk installer — downloads the latest release binary

REPO="Albertobelleiro/tsk-tui"
DEFAULT_SYSTEM_DIR="/usr/local/bin"
DEFAULT_USER_DIR="${HOME}/.local/bin"
INSTALL_DIR="${INSTALL_DIR:-}"
USE_SUDO=0

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
TMP_BIN="$(mktemp /tmp/tsk.XXXXXX)"

# Auto-select install dir if not explicitly provided:
# - Prefer /usr/local/bin when writable
# - Fall back to ~/.local/bin (no sudo)
if [[ -z "${INSTALL_DIR}" ]]; then
  if [[ -w "${DEFAULT_SYSTEM_DIR}" ]]; then
    INSTALL_DIR="${DEFAULT_SYSTEM_DIR}"
  else
    INSTALL_DIR="${DEFAULT_USER_DIR}"
  fi
fi

echo "Downloading tsk for ${OS}-${ARCH}..."
curl -fsSL "$URL" -o "${TMP_BIN}"
chmod +x "${TMP_BIN}"

if [[ ! -d "${INSTALL_DIR}" ]]; then
  if ! mkdir -p "${INSTALL_DIR}" 2>/dev/null; then
    if command -v sudo >/dev/null 2>&1; then
      USE_SUDO=1
      sudo mkdir -p "${INSTALL_DIR}"
    else
      echo "Cannot create ${INSTALL_DIR} (permission denied and sudo unavailable)."
      exit 1
    fi
  fi
fi

if [[ ! -w "${INSTALL_DIR}" ]]; then
  if command -v sudo >/dev/null 2>&1; then
    USE_SUDO=1
  else
    echo "Cannot write to ${INSTALL_DIR} (permission denied and sudo unavailable)."
    exit 1
  fi
fi

echo "Installing to ${INSTALL_DIR}/tsk..."
if [[ "${USE_SUDO}" -eq 1 ]]; then
  echo "Admin permissions required for ${INSTALL_DIR}."
  sudo mv "${TMP_BIN}" "${INSTALL_DIR}/tsk"
else
  mv "${TMP_BIN}" "${INSTALL_DIR}/tsk"
fi

echo "tsk installed successfully! Run 'tsk' to get started."
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  echo ""
  echo "Note: ${INSTALL_DIR} is not in your PATH."
  echo "Add this to your shell profile (~/.zshrc or ~/.bashrc):"
  echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
fi
