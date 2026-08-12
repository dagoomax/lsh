'use strict';

const platformStatus = require('./platform-status');
const { PersistentClient, ReceiverController, DefaultMediaApp, Result } = require('@foxxmd/chromecast-client');

// Google Home / Nest speakers and displays (and any other Chromecast-built-in
// device) over the local Cast v2 protocol — no Google account or cloud
// involved. Static host list rather than mDNS auto-discovery, matching the
// rest of LSH's camera/relay integrations (find the IP via the Google Home
// app: device settings → Wi-Fi info, or your router's DHCP client list).
//
// Volume/mute are genuine absolute sets (unlike the Android TV Remote
// protocol, Cast's ReceiverController.setVolume() takes a real 0-1 level).
// Media transport (play/pause/stop) only works while something is actively
// cast to the device — `DefaultMediaApp.join` (not `launchAndJoin`) is used
// throughout so LSH never launches the default media receiver app itself,
// which would interrupt whatever's already showing (cast media, Assistant
// routines, ambient photos, ...).
class GoogleHomeClient {
  constructor(config, store, sensorRegistry) {
    this._config  = config;
    this._store   = store;
    this._registry = sensorRegistry;
    this._devices  = {}; // host → { deviceKey, client, receiver }
    this._timer    = null;
  }

  async start() {
    const cfg = this._config.googlehome;
    const list = cfg?.devices || [];
    if (!list.length) return;

    for (const dev of list) {
      await this._initDevice(dev).catch((err) =>
        console.error(`[GoogleHome] Init failed for ${dev.host}: ${err.message}`));
    }

    if (!Object.keys(this._devices).length) return;

    platformStatus.set('googlehome', true);
    const ms = Math.max(cfg.pollInterval || 10, 5) * 1000;
    this._timer = setInterval(() => this._pollAll(), ms);
    this._pollAll();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    for (const d of Object.values(this._devices)) {
      try { d.receiver.dispose(); } catch { /* already gone */ }
      try { d.client.close(); } catch { /* already gone */ }
    }
  }

  async _initDevice({ host, name }) {
    const deviceKey = `googlehome/${host.replace(/\./g, '_')}`;
    const client = new PersistentClient({ host });
    await client.connect();
    const receiver = ReceiverController.createReceiver({ client });

    this._devices[host] = { deviceKey, client, receiver };

    this._registry.registerDevice({
      key:    deviceKey,
      label:  name || `Google Home ${host}`,
      type:   'googlehome',
      icon:   '🔊',
      homekit: [],
      sensors: [
        { path: 'volume', label: 'Volume', unit: '%', controllable: true, type: 'range', min: 0, max: 100, writeCmd: 'setVolume', capabilityId: 'volume' },
        { path: 'mute',   label: 'Mute',   format: 'on-off', controllable: true, type: 'toggle', writeOn: 'on', writeOff: 'off', capabilityId: 'mute' },
        { path: 'play',  label: 'Play',  type: 'trigger', controllable: true, capabilityId: 'play',  writeOn: 'press' },
        { path: 'pause', label: 'Pause', type: 'trigger', controllable: true, capabilityId: 'pause', writeOn: 'press' },
        { path: 'stop',  label: 'Stop',  type: 'trigger', controllable: true, capabilityId: 'stop',  writeOn: 'press' },
        { path: 'playbackState', label: 'Playback', type: 'label' },
        { path: 'nowPlaying',    label: 'Now Playing', type: 'label' },
      ],
      _writeCapability: (capId, command, args) => this._executeCommand(host, capId, command, args),
    });

    client.on('error', (err) => console.error(`[GoogleHome] ${name || host}: ${err.message}`));
  }

  async _pollAll() {
    await Promise.all(Object.keys(this._devices).map((host) => this._poll(host)));
  }

  async _poll(host) {
    const d = this._devices[host];
    if (!d) return;
    const k = d.deviceKey;
    try {
      const status = (await d.receiver.getStatus()).unwrapAndThrow();
      if (status.volume) {
        this._store.update(`${k}/volume`, Math.round((status.volume.level ?? 0) * 100));
        this._store.update(`${k}/mute`, status.volume.muted ? 1 : 0);
      }

      const media = await this._joinMedia(host);
      if (media) {
        const s = (await media.getStatus()).unwrapAndThrow();
        this._store.update(`${k}/playbackState`, (s.playerState || 'IDLE').toLowerCase());
        const title = s.media?.metadata?.title || s.media?.contentId || '';
        this._store.update(`${k}/nowPlaying`, title);
        media.dispose();
      } else {
        this._store.update(`${k}/playbackState`, 'idle');
        this._store.update(`${k}/nowPlaying`, '');
      }

      platformStatus.set('googlehome', true);
    } catch (err) {
      console.error(`[GoogleHome] Poll failed for ${host}: ${err.message}`);
    }
  }

  // Attaches to an in-progress media session without launching anything.
  // Returns null (not an error) when nothing is currently cast.
  async _joinMedia(host) {
    const d = this._devices[host];
    const result = await DefaultMediaApp.join({ client: d.client });
    const unwrapped = Result.unwrapWithErr(result);
    return unwrapped.isOk ? unwrapped.value : null;
  }

  async _executeCommand(host, capId, command, args) {
    const d = this._devices[host];
    if (!d) return;
    try {
      switch (capId) {
        case 'volume':
          (await d.receiver.setVolume({ level: Math.max(0, Math.min(100, args?.[0] ?? 20)) / 100 })).unwrapAndThrow();
          break;
        case 'mute':
          (await d.receiver.setVolume({ mute: command === 'on' })).unwrapAndThrow();
          break;
        case 'play': case 'pause': case 'stop': {
          const media = await this._joinMedia(host);
          if (media) {
            await media[capId]();
            media.dispose();
          }
          break;
        }
      }
      setTimeout(() => this._poll(host), 1000);
    } catch (err) {
      console.error(`[GoogleHome] Command failed (${capId}) for ${host}: ${err.message}`);
    }
  }
}

module.exports = GoogleHomeClient;
