// Shared bootstrap for both matter-bridge.js and matter-client.js. Must be
// required before any other @matter/* module (matter.js locks its storage
// path and other environment config the first time its Node environment
// initializes — setting it twice, or setting it after ServerNode.create()/
// CommissioningController.start() has already run once, throws). Node's
// require() cache means this file's body only ever executes once even
// though both callers require it, so a bridge+controller setup sharing one
// process is safe.
//
// Both matter-bridge.js and matter-client.js pass their own `id` to
// ServerNode.create()/environment name, which matter.js uses as a
// subdirectory under this one shared base path — so they don't collide on
// disk despite sharing a base path.
const fs = require('fs');
const path = require('path');

const STORAGE_DIR = path.join(__dirname, '..', 'persist', 'matter');

// matter.js treats a lock as held while its pid is alive. After an unclean
// shutdown + reboot that pid is often reused by an unrelated boot service
// (seen: adbd on the UNO Q), which locks the bridge/controller out forever.
// On Linux, drop locks whose owner isn't a node process. This runs before
// this process takes any lock of its own.
function clearForeignLocks() {
  if (process.platform !== 'linux') return;
  let dirs;
  try { dirs = fs.readdirSync(STORAGE_DIR); } catch { return; }
  for (const d of dirs) {
    const lockPath = path.join(STORAGE_DIR, d, 'matter.lock');
    const pidPath  = path.join(STORAGE_DIR, d, 'matter.pid');
    if (!fs.existsSync(lockPath)) continue;
    let pid;
    try { pid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10); } catch { continue; }
    if (!pid || pid === process.pid) continue;
    let cmd;
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; } // gone — matter.js cleans it
    if (/node/.test(cmd)) continue;
    console.log(`[Matter] Clearing stale storage lock for ${d} (pid ${pid} is now ${cmd.split('\0')[0]})`);
    try { fs.unlinkSync(lockPath); fs.unlinkSync(pidPath); } catch {}
  }
}
clearForeignLocks();

require('@matter/nodejs/config').config.defaultStoragePath = STORAGE_DIR;

const { Logger, LogLevel } = require('@matter/main');
// matter.js's own logger is very chatty at its default DEBUG level and
// writes ANSI-colored multi-line output straight to stdout, which floods
// LSH's logs — lifecycle events LSH cares about are logged separately via
// plain console.log('[Matter] ...') calls in matter-bridge.js/matter-client.js.
Logger.level = LogLevel.WARN;

module.exports = {};
