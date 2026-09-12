#!/usr/bin/env bash
#
# Installs and starts LSH on a fresh Debian/Ubuntu-family Linux box (the
# same kind of setup as the "casablanca" production install) — run this ON
# THE TARGET MACHINE, either directly at its console or over SSH:
#
#   ssh you@newbox 'bash -s' < scripts/install-linux.sh
#
# or, once you have a shell on the box:
#
#   curl -fsSL https://raw.githubusercontent.com/dagoomax/lsh/main/scripts/install-linux.sh | bash
#
# What it does:
#   1. Installs Node.js 20.x (via NodeSource, only if missing or too old)
#      and build tools (python3, gcc/g++/make) needed by native deps like
#      node-pty (the embedded terminal feature) — apt-based distros only.
#   2. Clones or updates the LSH repo under ~/lsh
#   3. Runs npm install (react-dashboard/dist is committed, so no on-device
#      build step is needed)
#   4. Creates config.json from config.example.json if one doesn't exist yet
#   5. Installs PM2, starts LSH under it via the repo's ecosystem.config.js,
#      and registers a systemd service (`pm2 startup`) so it survives a
#      reboot — the Linux equivalent of Termux:Boot on the Android installer
#      (scripts/install-android-termux.sh)
#
# Safe to re-run: pulls latest instead of re-cloning, won't overwrite an
# existing config.json, and pm2 start/reload is idempotent.
#
# Env vars (all optional):
#   REPO_URL    - git remote to clone (default: dagoomax/lsh on GitHub)
#   INSTALL_DIR - where to put it (default: $HOME/lsh)
#   NODE_MAJOR  - Node.js major version to install if needed (default: 20,
#                 matching the version this app is actually run on in prod)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/dagoomax/lsh.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/lsh}"
NODE_MAJOR="${NODE_MAJOR:-20}"

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$1"; }

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script only supports apt-based Linux (Debian/Ubuntu/Raspberry Pi OS)." >&2
  echo "On another distro, install Node.js ${NODE_MAJOR}.x + build tools (python3, gcc, g++, make)" >&2
  echo "yourself, then run steps 2-5 from this script's header comment by hand." >&2
  exit 1
fi

NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  if [ "$CURRENT_MAJOR" -ge "$NODE_MAJOR" ]; then
    NEED_NODE=0
    log "Node.js v$(node -v | tr -d v) already installed — skipping"
  else
    warn "Node.js v$(node -v | tr -d v) is older than v${NODE_MAJOR} — will upgrade"
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  log "Installing Node.js ${NODE_MAJOR}.x (NodeSource) + build tools"
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg python3 make g++ git
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  log "Ensuring build tools + git are present"
  sudo apt-get update -y
  sudo apt-get install -y python3 make g++ git
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Existing checkout found at $INSTALL_DIR — pulling latest"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "Cloning $REPO_URL into $INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

log "Installing npm dependencies"
npm install --no-audit --no-fund

if [ ! -f config.json ]; then
  log "No config.json found — seeding one from config.example.json"
  cp config.example.json config.json
  warn "Edit $INSTALL_DIR/config.json before relying on this — at minimum set server.port and any platform sections you want active."
else
  log "config.json already exists — leaving it untouched"
fi

mkdir -p logs persist

log "Installing PM2 process manager"
sudo npm install -g pm2

log "Starting LSH under PM2 (ecosystem.config.js)"
if pm2 describe lsh >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js
else
  pm2 start ecosystem.config.js
fi
pm2 save

log "Registering PM2 as a systemd service (so LSH restarts on reboot)"
STARTUP_CMD="$(pm2 startup systemd -u "$(whoami)" --hp "$HOME" 2>/dev/null | tail -1)"
if [[ "$STARTUP_CMD" == sudo* ]]; then
  if eval "$STARTUP_CMD"; then
    pm2 save
  else
    warn "Couldn't run the pm2 startup command automatically (needs sudo)."
    warn "Run this yourself once to survive reboots: $STARTUP_CMD"
  fi
else
  warn "pm2 startup didn't return the expected sudo command — run 'pm2 startup' yourself and follow its instructions."
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
PORT="$(node -e "try{console.log(require('./config.json').server?.port||3000)}catch(e){console.log(3000)}")"

log "Done."
echo "LSH is running under PM2 in $INSTALL_DIR"
echo "Dashboard: http://${IP:-<this-machine-ip>}:${PORT}/react/"
echo
echo "Next steps:"
echo "  - Visit the dashboard above and go through first-run setup (creates the admin account)"
echo "  - Edit $INSTALL_DIR/config.json to enable the platforms you actually have, then: pm2 restart lsh"
echo "  - pm2 logs lsh   /   pm2 status   for day-to-day management"
