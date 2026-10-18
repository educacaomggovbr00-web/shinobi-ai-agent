#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "🍥 Starting Shinobi Codespaces Browser Bridge"
if ! command -v gh >/dev/null; then echo "GitHub CLI is missing"; exit 1; fi
if ! gh auth status >/dev/null 2>&1; then
  echo "Login to GitHub CLI first: gh auth login"
  exit 1
fi
need_install=0
for program in xdotool xclip scrot; do
  if ! command -v "$program" >/dev/null; then need_install=1; fi
done
if [ "$need_install" = 1 ]; then
  echo "Installing desktop control tools in Codespaces..."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xdotool xclip scrot
fi
export DISPLAY=:1
exec python3 -u bridge/bridge.py
