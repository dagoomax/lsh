'use strict';

// Which broker a general-purpose MQTT client should use when its own host is
// left blank: LSH's built-in broker when it's enabled (src/mqtt-broker.js),
// otherwise the main `config.mqtt` broker (usually the Cerbo GX).
// Victron itself always talks to config.mqtt — this is for everything else.
function sharedBroker(config) {
  const b = config.mqttBroker;
  if (b?.enabled) {
    return { host: '127.0.0.1', port: Number(b.port) || 1883,
      username: b.username || undefined, password: b.username ? (b.password || '') : undefined, builtIn: true };
  }
  const m = config.mqtt || {};
  if (!m.host) return null;
  return { host: m.host, port: Number(m.port) || 1883, username: m.username || undefined, password: m.password || undefined, builtIn: false };
}

const brokerUrl = (t) => `mqtt://${t.host}:${t.port}`;
const authOpts = (t) => (t?.username ? { username: t.username, password: t.password || '' } : {});

module.exports = { sharedBroker, brokerUrl, authOpts };
