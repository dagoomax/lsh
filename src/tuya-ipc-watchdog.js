'use strict';

const { execFile } = require('child_process');
const path = require('path');
const platformStatus = require('./platform-status');

/**
 * Watches the Tuya cloud login that tuya-ipc-terminal (the RTSP relay behind
 * the Tuya doorbell camera) depends on. The session silently expires every
 * few days, and the relay keeps accepting RTSP connections while delivering
 * no video — so mediamtx flaps, snapshots fail and HomeKit shows nothing,
 * with no error anywhere in LSH itself.
 *
 * Runs `tuya-ipc-terminal auth test` at startup and every intervalHours and
 * exposes the result as a HomeKit contact sensor (Open = login expired), so
 * the Home app can push a notification, plus a dashboard warning toast and
 * a platform badge.
 *
 * config.tuyaIpc: { dir, region, email, intervalHours? = 24 }
 *
 * Fixing it needs the account owner: in `dir`, run
 * `./tuya-ipc-terminal auth refresh <region> <email>`, scan the QR in the
 * Smart Life app, then `pm2 restart tuya-ipc`.
 */
const KEY = 'tuya-ipc/login';

class TuyaIpcWatchdog {
  constructor(config, store, sensorRegistry, automation) {
    this._cfg        = config.tuyaIpc;
    this._store      = store;
    this._registry   = sensorRegistry;
    this._automation = automation;
    this._timer      = null;
  }

  async start() {
    const { dir, region, email } = this._cfg;
    if (!dir || !region || !email) {
      console.error('[TuyaIPC] config.tuyaIpc needs dir, region and email — watchdog disabled');
      return;
    }
    this._registry.registerDevice({
      key:   KEY,
      label: 'Tuya login',
      icon:  '🔑',
      color: 'orange',
      sensors: [
        { path: 'expired',    name: 'Login expired', label: 'Login expired', format: 'on-off', homekit: 'contact' },
        { path: 'status',     name: 'Status',        label: 'Status',        format: 'string', raw: true },
        { path: 'last_check', name: 'Last check',    label: 'Last check',    format: 'string', raw: true },
      ],
      homekit: ['contact'],
    });
    platformStatus.set('tuya-ipc', false);

    this.check();
    const hours = Number(this._cfg.intervalHours) || 24;
    this._timer = setInterval(() => this.check(), hours * 3600_000);
    console.log(`[TuyaIPC] Login watchdog started — checking every ${hours} h`);
  }

  stop() {
    clearInterval(this._timer);
  }

  check() {
    const { dir, region, email } = this._cfg;
    const bin = path.join(dir, 'tuya-ipc-terminal');
    execFile(bin, ['auth', 'test', region, email], { cwd: dir, timeout: 60_000 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr || ''}`;
      this._store.update(`${KEY}/last_check`, new Date().toISOString());

      // Only an explicit "invalid session" answer from the Tuya cloud counts
      // as expired — a network blip or missing binary must not raise the alarm.
      const expired = /invalid|USER_SESSION_LOSS|Not login/i.test(out);
      const valid   = !expired && /Session is valid/i.test(out);

      if (valid) {
        if (this._store.get(`${KEY}/expired`) === 1) console.log('[TuyaIPC] Login valid again');
        this._store.update(`${KEY}/expired`, 0);
        this._store.update(`${KEY}/status`, 'Valid');
        platformStatus.set('tuya-ipc', true);
      } else if (expired) {
        this._store.update(`${KEY}/expired`, 1);
        this._store.update(`${KEY}/status`, 'Expired');
        platformStatus.set('tuya-ipc', false);
        const msg = 'Tuya camera login expired — the Tuya cameras have no video. On the LSH server run: '
          + `cd ${dir} && ./tuya-ipc-terminal auth refresh ${region} ${email}, scan the QR in Smart Life, `
          + 'then pm2 restart tuya-ipc';
        if (this._automation) this._automation.notify('warning', msg, 'tuya-ipc');
        else console.warn(`[TuyaIPC] ${msg}`);
      } else {
        this._store.update(`${KEY}/status`, 'Check failed');
        console.error(`[TuyaIPC] Login check failed: ${err?.message || out.trim().split('\n').pop()}`);
      }
    });
  }
}

module.exports = TuyaIpcWatchdog;
