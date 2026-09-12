#!/usr/bin/env node
'use strict';

// Toggles config.json's top-level `installerMode` flag — deliberately a
// filesystem-only switch (see README's "installerMode" section), not exposed
// anywhere in the web UI. It's what makes granting the per-user flows/
// claudeCode/terminal permission flags in Settings -> Security require
// filesystem access to the box LSH runs on, not just a browser session.
//
// Usage:
//   node scripts/installer-mode.js on       (alias: enable)
//   node scripts/installer-mode.js off      (alias: disable)
//   node scripts/installer-mode.js status
//
// Takes effect immediately — installerMode is read fresh from config.json on
// every request (see requireInstallerMode in src/api-routes.js), no restart
// needed either way.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`No config.json found at ${CONFIG_PATH} — copy config.example.json first.`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

const cmd = (process.argv[2] || '').toLowerCase();
const cfg = readConfig();

switch (cmd) {
  case 'on':
  case 'enable':
    cfg.installerMode = true;
    writeConfig(cfg);
    console.log('[InstallerMode] Enabled — permission checkboxes in Settings → Security are now editable, no restart needed.');
    console.log("Remember to turn it back off when you're done: node scripts/installer-mode.js off");
    break;

  case 'off':
  case 'disable':
    delete cfg.installerMode;
    writeConfig(cfg);
    console.log('[InstallerMode] Disabled.');
    break;

  case 'status':
    console.log(`installerMode is currently: ${cfg.installerMode === true ? 'ON' : 'off'}`);
    break;

  default:
    console.error('Usage: node scripts/installer-mode.js on|off|status');
    process.exit(1);
}
