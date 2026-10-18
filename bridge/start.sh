#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "🍥 Starting Shinobi Codespaces Browser Bridge"

# Older Codespaces may have been built before the GitHub CLI/desktop tools
# were added to the Dockerfile. Repair the existing Codespace in-place.
missing=()
for program in gh xdotool xclip scrot; do
  if ! command -v "$program" >/dev/null 2>&1; then
    missing+=("$program")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "Installing missing programs: ${missing[*]}"
  sudo apt-get update -qq
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing[@]}"
fi

# Codespaces may supply a repo-scoped GitHub token; gh accepts it via GH_TOKEN.
# Do not print the token, save it in files, or commit it.
if [[ -z "${GH_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is installed, but is not authenticated."
  echo "Run: gh auth login"
  echo "Then run: bash bridge/start.sh"
  exit 1
fi

export DISPLAY="${DISPLAY:-:1}"
echo "GitHub authentication found. Display: $DISPLAY"
echo "Starting browser command bridge. Leave this terminal open."
exec python3 -u bridge/bridge.py
