'use strict';

const http           = require('http');
const dgram          = require('dgram');
const platformStatus = require('./platform-status');

const AV_CTRL = '/MediaRenderer/AVTransport/Control';
const RC_CTRL = '/MediaRenderer/RenderingControl/Control';
const AV_NS   = 'urn:schemas-upnp-org:service:AVTransport:1';
const RC_NS   = 'urn:schemas-upnp-org:service:RenderingControl:1';

class SonosClient {
  constructor(config, store, sensorRegistry) {
    this._config   = config;
    this._store    = store;
    this._registry = sensorRegistry;
    this._players  = {}; // host → { deviceKey, label }
    this._timer    = null;
  }

  async start() {
    const cfg   = this._config.sonos;
    const hosts  = [...(cfg.hosts || [])];

    if (cfg.discover !== false) {
      const discovered = await this._discover().catch(err => {
        console.error(`[Sonos] SSDP discovery error: ${err.message}`);
        return [];
      });
      for (const h of discovered) {
        if (!hosts.includes(h)) hosts.push(h);
      }
      if (discovered.length) {
        console.log(`[Sonos] Discovered: ${discovered.join(', ')}`);
      }
    }

    if (!hosts.length) {
      console.warn('[Sonos] No speakers found — configure hosts or enable discovery');
      return;
    }

    for (const host of hosts) {
      await this._initPlayer(host).catch(err =>
        console.error(`[Sonos] Init failed for ${host}: ${err.message}`)
      );
    }

    if (!Object.keys(this._players).length) return;

    platformStatus.set('sonos', true);
    const ms = Math.max((cfg.pollInterval || 5), 3) * 1000;
    this._timer = setInterval(() => this._pollAll(), ms);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  // ── SSDP Discovery ─────────────────────────────────────────────────────────

  _discover(timeout = 3000) {
    return new Promise(resolve => {
      let done   = false;
      const found = new Set();

      let socket;
      try { socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); }
      catch { resolve([]); return; }

      const finish = () => {
        if (done) return;
        done = true;
        try { socket.close(); } catch {}
        resolve([...found]);
      };

      const search = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 3',
        'ST: urn:schemas-upnp-org:device:ZonePlayer:1',
        '', '',
      ].join('\r\n');

      socket.on('error', () => finish());

      socket.bind(0, () => {
        socket.send(Buffer.from(search), 1900, '239.255.255.250', err => {
          if (err) finish();
        });
      });

      socket.on('message', (msg, rinfo) => {
        const text = msg.toString().toLowerCase();
        if ((text.includes('zoneplayer') || text.includes('rincon')) &&
            rinfo.address && rinfo.address !== '0.0.0.0') {
          found.add(rinfo.address);
        }
      });

      setTimeout(finish, timeout);
    });
  }

  // ── Player Initialisation ──────────────────────────────────────────────────

  async _initPlayer(host) {
    let label = host;
    try {
      const xml  = await this._getXml(host, '/xml/device_description.xml');
      const room = xml.match(/<roomName>([^<]+)<\/roomName>/i);
      const model = xml.match(/<modelName>([^<]+)<\/modelName>/i);
      label = room?.[1] || model?.[1] || host;
    } catch {}

    const deviceKey = `sonos/${host.replace(/\./g, '_')}`;
    this._players[host] = { deviceKey, label };

    const device = {
      key:    deviceKey,
      label,
      type:   'sonos',
      homekit: [],
      sensors: [
        {
          path: 'playing', label: 'Play', format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'play', writeOff: 'pause',
          capabilityId: 'playing',
        },
        {
          path: 'prev', label: 'Previous', type: 'trigger',
          controllable: true,
          writeOn: 'trigger', writeOff: null,
          capabilityId: 'prev',
        },
        {
          path: 'next', label: 'Next', type: 'trigger',
          controllable: true,
          writeOn: 'trigger', writeOff: null,
          capabilityId: 'next',
        },
        {
          path: 'volume', label: 'Volume', unit: '%',
          controllable: true, type: 'range',
          min: 0, max: 100, rangeFormat: 'percent',
          writeCmd: 'setVolume', capabilityId: 'volume',
        },
        {
          path: 'mute', label: 'Mute', format: 'on-off',
          controllable: true, type: 'toggle',
          writeOn: 'on', writeOff: 'off',
          capabilityId: 'mute',
        },
        { path: 'track',  label: 'Track',  type: 'label' },
        { path: 'artist', label: 'Artist', type: 'label' },
      ],
      _writeCapability: (capId, command, args) =>
        this._executeCommand(host, capId, command, args),
    };

    this._registry.registerDevice(device);
    await this._pollPlayer(host).catch(() => {});
    console.log(`[Sonos] Registered: ${label} (${host})`);
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  async _pollAll() {
    for (const host of Object.keys(this._players)) {
      this._pollPlayer(host).catch(err =>
        console.error(`[Sonos] Poll failed for ${host}: ${err.message}`)
      );
    }
  }

  async _pollPlayer(host) {
    const { deviceKey } = this._players[host];

    const [transport, vol, muteRes, position] = await Promise.all([
      this._soap(host, AV_CTRL, AV_NS, 'GetTransportInfo',
        '<InstanceID>0</InstanceID>'),
      this._soap(host, RC_CTRL, RC_NS, 'GetVolume',
        '<InstanceID>0</InstanceID><Channel>Master</Channel>'),
      this._soap(host, RC_CTRL, RC_NS, 'GetMute',
        '<InstanceID>0</InstanceID><Channel>Master</Channel>'),
      this._soap(host, AV_CTRL, AV_NS, 'GetPositionInfo',
        '<InstanceID>0</InstanceID>'),
    ]);

    const state = tag(transport, 'CurrentTransportState');
    const volVal = tag(vol, 'CurrentVolume');
    const muteVal = tag(muteRes, 'CurrentMute');

    this._store.update(`${deviceKey}/playing`, state === 'PLAYING' ? 1 : 0);
    if (volVal  != null) this._store.update(`${deviceKey}/volume`, parseInt(volVal, 10));
    if (muteVal != null) this._store.update(`${deviceKey}/mute`, muteVal === '1' ? 1 : 0);

    // Parse track info from DIDL-Lite in TrackMetaData (HTML-entity-encoded XML)
    const rawMeta = tag(position, 'TrackMetaData');
    if (rawMeta && rawMeta !== 'NOT_IMPLEMENTED' && rawMeta !== '') {
      const didl   = rawMeta
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      const title  = tag(didl, 'dc:title')   || tag(didl, 'title');
      const artist = tag(didl, 'dc:creator') || tag(didl, 'r:albumArtist') || tag(didl, 'upnp:artist');
      if (title  != null) this._store.update(`${deviceKey}/track`,  title);
      if (artist != null) this._store.update(`${deviceKey}/artist`, artist);
    }
  }

  // ── Command Dispatch ───────────────────────────────────────────────────────

  async _executeCommand(host, capId, command, args) {
    switch (capId) {
      case 'playing':
        if (command === 'play') {
          await this._soap(host, AV_CTRL, AV_NS, 'Play',
            '<InstanceID>0</InstanceID><Speed>1</Speed>');
        } else {
          await this._soap(host, AV_CTRL, AV_NS, 'Pause',
            '<InstanceID>0</InstanceID>');
        }
        break;
      case 'prev':
        await this._soap(host, AV_CTRL, AV_NS, 'Previous',
          '<InstanceID>0</InstanceID>');
        break;
      case 'next':
        await this._soap(host, AV_CTRL, AV_NS, 'Next',
          '<InstanceID>0</InstanceID>');
        break;
      case 'volume':
        await this._soap(host, RC_CTRL, RC_NS, 'SetVolume',
          `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>${Math.round(args?.[0] ?? 50)}</DesiredVolume>`);
        break;
      case 'mute':
        await this._soap(host, RC_CTRL, RC_NS, 'SetMute',
          `<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredMute>${command === 'on' ? 1 : 0}</DesiredMute>`);
        break;
    }
    setTimeout(() => this._pollPlayer(host).catch(() => {}), 700);
  }

  // ── SOAP / HTTP Helpers ────────────────────────────────────────────────────

  _soap(host, path, ns, action, body) {
    const envelope =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"` +
      ` s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      `<s:Body><u:${action} xmlns:u="${ns}">${body}</u:${action}></s:Body></s:Envelope>`;
    return this._post(host, path, envelope, `"${ns}#${action}"`);
  }

  _post(host, path, body, soapAction) {
    return new Promise((resolve, reject) => {
      const buf = Buffer.from(body, 'utf8');
      const req = http.request({
        hostname: host, port: 1400, path, method: 'POST',
        timeout: 8000,
        headers: {
          'Content-Type':   'text/xml; charset="utf-8"',
          'Content-Length': buf.length,
          SOAPACTION:       soapAction,
        },
      }, res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout (${host})`)); });
      req.write(buf);
      req.end();
    });
  }

  _getXml(host, path) {
    return new Promise((resolve, reject) => {
      const req = http.get({ hostname: host, port: 1400, path, timeout: 5000 }, res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
  }
}

function tag(xml, name) {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

module.exports = SonosClient;
