'use strict';

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const platformStatus = require('./platform-status');

const execFileP = promisify(execFile);

// Memory { total, used } in bytes. On Linux os.freemem() counts reclaimable
// page cache as "used", overstating usage badly (a box can read ~100% while
// most RAM is actually available) — so prefer /proc/meminfo's MemAvailable,
// which is what `free`/pm2 report. Fall back to os.* elsewhere.
function memoryUsage() {
  const total = os.totalmem();
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const avail = info.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    if (avail) {
      const availableBytes = Number(avail[1]) * 1024;
      return { total, used: total - availableBytes };
    }
  } catch { /* not Linux / unreadable — fall through */ }
  return { total, used: total - os.freemem() };
}

/**
 * Host system metrics — CPU load, memory, and per-mount disk usage of the
 * machine LSH itself runs on (so on each deployment it reports that box's
 * own numbers). No external service; reads Node's `os` module plus `df` for
 * disks. Follows the standard integration-client shape.
 *
 * cfg = config.systemMetrics, an optional object:
 *   { pollInterval?: seconds (default 10, min 2),
 *     name?: device label (default the hostname),
 *     disks?: string[] of mount points to report (default ['/']) }
 * Enabled by default; set config.systemMetrics to false to disable.
 */
const DEFAULT_POLL_S = 10;
const MIN_POLL_S     = 2;
const BYTES_PER_GB   = 1024 * 1024 * 1024;

function slugForMount(mount) {
  const s = String(mount).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'root';
}

// Aggregate busy/total CPU ticks across all cores (os.cpus() is cumulative
// since boot, so a percentage needs the delta between two samples).
function cpuTotals() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}

class SystemMetricsClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._timer    = null;
    this._prevCpu  = cpuTotals();
    this._key      = 'system/host';
  }

  async start() {
    const cfg = (this._config.systemMetrics && typeof this._config.systemMetrics === 'object')
      ? this._config.systemMetrics : {};
    if (this._config.systemMetrics === false) return;

    this._disks = Array.isArray(cfg.disks) && cfg.disks.length ? cfg.disks : ['/'];

    const diskSensors = [];
    for (const mount of this._disks) {
      const slug = slugForMount(mount);
      diskSensors.push(
        { path: `disk_${slug}_percent`, name: `Disk ${mount} Used`, type: 'number', unit: '%',  precision: 0 },
        { path: `disk_${slug}_free`,    name: `Disk ${mount} Free`, type: 'number', unit: 'GB', precision: 1 },
        { path: `disk_${slug}_total`,   name: `Disk ${mount} Size`, type: 'number', unit: 'GB', precision: 1 },
      );
    }

    this._registry.registerDevice({
      key: this._key,
      label: cfg.name || os.hostname(),
      type: 'system',
      icon: '🖥️',
      sensors: [
        { path: 'cpu',       name: 'CPU',        type: 'number', unit: '%',  precision: 0 },
        { path: 'load1',     name: 'Load (1m)',  type: 'number', precision: 2 },
        { path: 'memPercent',name: 'Memory',     type: 'number', unit: '%',  precision: 0 },
        { path: 'memUsed',   name: 'Memory Used',type: 'number', unit: 'GB', precision: 2 },
        { path: 'memTotal',  name: 'Memory Size',type: 'number', unit: 'GB', precision: 2 },
        { path: 'uptime',    name: 'Uptime',     type: 'number', unit: 's' },
        ...diskSensors,
      ],
    });

    const interval = Math.max(Number(cfg.pollInterval) || DEFAULT_POLL_S, MIN_POLL_S) * 1000;
    this._timer = setInterval(() => this._poll().catch((err) => {
      console.error(`[SystemMetrics] Poll error: ${err.message}`);
    }), interval);
    await this._poll().catch((err) => console.error(`[SystemMetrics] Initial poll failed: ${err.message}`));
    console.log(`[SystemMetrics] Started — ${os.hostname()}, disks [${this._disks.join(', ')}], every ${interval / 1000}s`);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async _poll() {
    const k = this._key;

    // CPU % from the delta since the previous sample.
    const cur = cpuTotals();
    const dTotal = cur.total - this._prevCpu.total;
    const dIdle  = cur.idle  - this._prevCpu.idle;
    this._prevCpu = cur;
    const cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : 0;
    this._store.update(`${k}/cpu`, cpuPct);

    this._store.update(`${k}/load1`, os.loadavg()[0]);

    const { total, used } = memoryUsage();
    this._store.update(`${k}/memPercent`, total > 0 ? (used / total) * 100 : 0);
    this._store.update(`${k}/memUsed`,  used / BYTES_PER_GB);
    this._store.update(`${k}/memTotal`, total / BYTES_PER_GB);

    this._store.update(`${k}/uptime`, os.uptime());

    for (const mount of this._disks) {
      const slug = slugForMount(mount);
      try {
        // -k = 1024-byte blocks, -P = POSIX single-line output (portable
        // across macOS and Linux). Last line holds the numbers.
        const { stdout } = await execFileP('df', ['-kP', mount]);
        const line = stdout.trim().split('\n').pop().split(/\s+/);
        // filesystem, 1024-blocks, used, available, capacity%, mounted-on
        const totalKb = Number(line[1]);
        const usedKb  = Number(line[2]);
        const availKb = Number(line[3]);
        const pct     = Number(String(line[4]).replace('%', ''));
        if (Number.isFinite(pct))     this._store.update(`${k}/disk_${slug}_percent`, pct);
        if (Number.isFinite(availKb)) this._store.update(`${k}/disk_${slug}_free`,  (availKb * 1024) / BYTES_PER_GB);
        if (Number.isFinite(totalKb)) this._store.update(`${k}/disk_${slug}_total`, (totalKb * 1024) / BYTES_PER_GB);
        void usedKb;
      } catch (err) {
        console.error(`[SystemMetrics] df ${mount} failed: ${err.message}`);
      }
    }

    platformStatus.set('systemMetrics', true);
  }
}

module.exports = SystemMetricsClient;
