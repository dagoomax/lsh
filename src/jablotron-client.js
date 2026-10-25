'use strict';

// Jablotron JA-100 / JA-100+ (JA-10xK/KR/KRY with a LAN communicator) — LSH
// is the alarm receiving centre (ARC) the panel reports to over SIA DC-09.
// Same receiver as Ajax (src/ajax-client.js, src/sia-dc09.js): one device
// per object number (jablotron/<account>) with the overall mode, a mode per
// named section (area<n>), alarms (intrusion, fire, flood, gas, panic,
// tamper, power, battery), online and the last event.
//
// In F-Link (service mode, usually the installer): Parameters → ARC — a
// channel with protocol SIA DC-09 (IP), LSH's IP and port, the object
// number, optionally an AES key, and a periodic test. Read-only: arming
// from LSH would need the panel's JA-121T bus interface or the MyJABLOTRON
// cloud, neither used here.
//
// config.jablotron = { port: 12129, accounts: [{ account, name, key,
//   pingMinutes, zones: { '3': 'Hall PIR' }, areas: { '1': 'Dom', '2': 'Garaż' } }] }

const AjaxClient = require('./ajax-client');

class JablotronClient extends AjaxClient {
  constructor(config, store, sensorRegistry) {
    super(config, store, sensorRegistry, AjaxClient.PROVIDERS.jablotron);
  }
}

module.exports = JablotronClient;
