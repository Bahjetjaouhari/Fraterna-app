#!/bin/sh

# ci_post_clone.sh - Xcode Cloud post-clone script for Fraterna
# This runs after the repo is cloned, before Xcode builds the project.
# It installs Node.js, builds the web assets, and syncs Capacitor.

set -e

echo "=== Starting ci_post_clone.sh ==="

# Install Node.js if not available
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
    brew install node@20 2>/dev/null || brew install node 2>/dev/null
    brew link node@20 --force 2>/dev/null || true
fi

echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"

# Navigate to the project root (two levels up from ios/App)
PROJECT_ROOT="$CI_PRIMARY_REPOSITORY_PATH"
if [ -z "$PROJECT_ROOT" ]; then
    # Fallback: derive from script location
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
fi

echo "Project root: $PROJECT_ROOT"

# Install npm dependencies
echo "=== Installing npm dependencies ==="
cd "$PROJECT_ROOT"
npm ci

# Build web assets
echo "=== Building web assets ==="
npm run build

# Sync Capacitor (copies web assets to ios/App/App/public)
echo "=== Syncing Capacitor ==="
npx cap sync ios

echo "=== ci_post_clone.sh completed successfully ==="