'use strict';

// Embedded interactive Linux terminal: a real PTY (node-pty) streamed over a
// dedicated Socket.IO namespace ('/terminal'). This is strictly more
// powerful than the Claude Code chat (src/claude-code-client.js) — a full,
// uncontained shell as whatever OS user runs the LSH process, not read/write
// confined to this repo — so every gate that feature has applies here too,
// plus two more:
//
//   1. Off by default at the config level (`terminal.enabled` in
//      config.json) — a second, filesystem-only switch on top of the
//      per-user permission flag below, same "needs box access, not just a
//      browser session" reasoning as installerMode.
//   2. No API-token bearer path. requirePermission() in api-routes.js treats
//      a valid API token as admin-equivalent for flows/claudeCode because
//      those tokens are "deliberately handed out by an admin" for
//      machine-to-machine use (Loxone exports, home-automation callbacks).
//      A leaked token like that must never be able to open an interactive
//      shell, so this namespace only accepts a real logged-in admin session
//      (the lsh-session cookie), checked fresh on every connection.
//
// Still LAN/localhost-only (isLocalRequest, reused from claude-code-client)
// and gated behind the 'terminal' permission flag (installer-mode-granted,
// same as 'flows'/'claudeCode' — see src/auth.js and requirePermission in
// api-routes.js).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isLocalRequest } = require('./claude-code-client');

const REPO_ROOT = path.join(__dirname, '..');

function readTerminalConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config.json'), 'utf8'));
  } catch { /* no config.json yet */ }
  return { enabled: !!fileConfig.terminal?.enabled };
}

function attachTerminalNamespace(io, auth) {
  const nsp = io.of('/terminal');

  nsp.use((socket, next) => {
    if (!auth) return next(new Error('Auth not configured'));
    if (!readTerminalConfig().enabled) {
      return next(new Error('Terminal is disabled — set "terminal": { "enabled": true } in config.json'));
    }

    const cookieHeader = socket.handshake.headers.cookie || '';
    const payload = auth.verifyFromCookieHeader(cookieHeader);
    if (!payload) return next(new Error('Unauthorized'));
    if (payload.role !== 'admin') return next(new Error('Admin access required'));
    if (!auth.hasPermission(payload.id, 'terminal')) {
      return next(new Error("Missing 'terminal' permission — ask an admin with installer mode enabled to grant it in Settings → Security"));
    }
    if (!isLocalRequest(socket.request)) {
      return next(new Error('Terminal is only reachable from localhost/LAN, not over remote access'));
    }

    socket.user = payload;
    next();
  });

  nsp.on('connection', (socket) => {
    let pty;
    try {
      // Required lazily, and only reached after every gate above passes, so
      // a box without node-pty's native binding built still serves the rest
      // of the app untouched — this is the only place that ever loads it.
      const nodePty = require('node-pty');
      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
      pty = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: os.homedir(),
        env: process.env,
      });
    } catch (err) {
      socket.emit('terminal:error', `Failed to start shell: ${err.message}`);
      socket.disconnect(true);
      return;
    }

    console.log(`[Terminal] Session started for "${socket.user.username}" (pid ${pty.pid})`);

    pty.onData((data) => socket.emit('terminal:data', data));
    pty.onExit(({ exitCode }) => {
      socket.emit('terminal:exit', exitCode);
      socket.disconnect(true);
    });

    socket.on('terminal:input', (data) => {
      if (typeof data === 'string') pty.write(data);
    });

    socket.on('terminal:resize', ({ cols, rows } = {}) => {
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
        try { pty.resize(cols, rows); } catch { /* pty already exited */ }
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Terminal] Session ended for "${socket.user.username}" (pid ${pty.pid})`);
      try { pty.kill(); } catch { /* already gone */ }
    });
  });
}

module.exports = { attachTerminalNamespace, readTerminalConfig, isLocalRequest };
