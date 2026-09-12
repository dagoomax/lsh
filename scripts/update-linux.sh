#!/usr/bin/env bash
#
# Updates an existing LSH install in place and restarts it under PM2 — the
# repeatable version of the manual "git pull, npm install if needed, pm2
# restart" deploy flow. Companion to scripts/install-linux.sh (that one's
# for a brand-new box; this one's for a box already running LSH).
#
# Run this ON THE TARGET MACHINE, from inside the repo, either directly or
# over SSH:
#
#   ssh you@target-box 'bash -s' < scripts/update-linux.sh
#
# or, once you have a shell in the repo directory:
#
#   ./scripts/update-linux.sh
#
# What it does:
#   1. Discards local drift in package-lock.json (harmless npm-version
#      metadata churn — the same thing you'd otherwise `git stash` by hand
#      before every pull) — aborts instead if there's any OTHER uncommitted
#      change, rather than discarding real work.
#   2. git pull --ff-only
#   3. Runs npm install only if package.json actually changed in the pull —
#      skips the ~10s round-trip otherwise. react-dashboard is never touched
#      here: its dist/ output is committed, so nothing needs rebuilding on
#      the server.
#   4. Restarts (or starts, if not already running) the PM2 process, saves
#      the process list, and does a quick HTTP health check afterward.
#
# Env vars (all optional):
#   PM2_APP_NAME - name of the PM2 process to restart (default: lsh, per
#                  ecosystem.config.js — override if yours was started under
#                  a different name, e.g. "server")

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PM2_APP_NAME="${PM2_APP_NAME:-lsh}"

log()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$1"; }

log "Checking working tree"
# Known-harmless npm metadata churn (different npm versions regenerating
# lockfile fields like "libc") — discard it rather than letting it block
# the pull below. Never touches anything else.
git checkout -- package-lock.json 2>/dev/null || true

# Only tracked-file changes can conflict with a pull — untracked cruft
# (stray backups, local test files) is irrelevant to `git pull --ff-only`
# and shouldn't block a routine update.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Uncommitted changes to tracked files — aborting rather than risk discarding real work:" >&2
  git status --short >&2
  echo "Commit, stash, or discard them yourself, then re-run this script." >&2
  exit 1
fi

BEFORE_HASH="$(md5sum package.json 2>/dev/null || true)"

log "Pulling latest (git pull --ff-only)"
git pull --ff-only

AFTER_HASH="$(md5sum package.json 2>/dev/null || true)"

if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
  log "package.json changed — running npm install"
  npm install --no-audit --no-fund
else
  log "No dependency changes — skipping npm install"
fi

log "Restarting via PM2 ($PM2_APP_NAME)"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  warn "No PM2 process named '$PM2_APP_NAME' found — starting fresh via ecosystem.config.js"
  pm2 start ecosystem.config.js
fi
pm2 save

log "Waiting for the server to come back up"
sleep 6
PORT="$(node -e "try{console.log(require('./config.json').server?.port||3000)}catch(e){console.log(3000)}")"
if curl -fsS -o /dev/null "http://localhost:${PORT}/"; then
  log "Update complete — responding on port ${PORT}"
else
  warn "No response on port ${PORT} after restart — check: pm2 logs ${PM2_APP_NAME}"
  exit 1
fi
