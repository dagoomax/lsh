const fs = require('fs');
const path = require('path');
const { generateSetupID } = require('./src/homekit-uri');

function loadConfig() {
  let fileConfig = {};
  const configPath = path.join(__dirname, 'config.json');

  if (fs.existsSync(configPath)) {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  // Generate and persist a setupID if one doesn't exist yet
  if (!fileConfig.homekit?.setupID) {
    if (!fileConfig.homekit) fileConfig.homekit = {};
    fileConfig.homekit.setupID = generateSetupID();
    fs.writeFileSync(configPath, JSON.stringify(fileConfig, null, 2), 'utf8');
    console.log(`[Config] Generated HomeKit setupID: ${fileConfig.homekit.setupID}`);
  }

  return {
    // Pass through everything from config.json (language, smarttub, zway,
    // wirenboard, homey, broadlink, waveshare, mc6, roborock, dreame,
    // dirigera, tradfri, …) — curated keys below override with env-var and
    // default handling.
    ...fileConfig,
    mqtt: {
      host: process.env.VICTRON_MQTT_HOST || fileConfig.mqtt?.host || '192.168.1.100',
      port: parseInt(process.env.VICTRON_MQTT_PORT || fileConfig.mqtt?.port || 1883),
      portalId: process.env.VICTRON_PORTAL_ID || fileConfig.mqtt?.portalId || '',
    },
    vrm: {
      email:          process.env.VRM_EMAIL           || fileConfig.vrm?.email          || '',
      password:       process.env.VRM_PASSWORD        || fileConfig.vrm?.password       || '',
      apiToken:       process.env.VRM_API_TOKEN       || fileConfig.vrm?.apiToken       || '',
      installationId: process.env.VRM_INSTALLATION_ID || fileConfig.vrm?.installationId || '',
    },
    solaredge: {
      siteId: process.env.SOLAREDGE_SITE_ID || fileConfig.solaredge?.siteId || '',
      apiKey: process.env.SOLAREDGE_API_KEY || fileConfig.solaredge?.apiKey || '',
    },
    smartthings: {
      token:        process.env.SMARTTHINGS_TOKEN         || fileConfig.smartthings?.token        || '',
      clientId:     process.env.SMARTTHINGS_CLIENT_ID     || fileConfig.smartthings?.clientId     || '',
      clientSecret: process.env.SMARTTHINGS_CLIENT_SECRET || fileConfig.smartthings?.clientSecret || '',
      deviceIds:    fileConfig.smartthings?.deviceIds || [],
    },
    satel: {
      host:           fileConfig.satel?.host           || '',
      port:           fileConfig.satel?.port           || 7094,
      armCode:        fileConfig.satel?.armCode        || '',
      zones:          fileConfig.satel?.zones          || null,
      zoneCount:      fileConfig.satel?.zoneCount      || 32,
      zoneNames:      fileConfig.satel?.zoneNames      || {},
      partitions:     fileConfig.satel?.partitions     || [1],
      partitionNames: fileConfig.satel?.partitionNames || {},
      outputCount:    parseInt(fileConfig.satel?.outputCount) || 0,
      outputs:        fileConfig.satel?.outputs        || null,
      outputNames:    fileConfig.satel?.outputNames    || {},
    },
    // .trim() on host/apiKey/etc: a stray trailing newline copy-pasted into
    // the Settings UI (or config.json directly) makes these unusable as HTTP
    // header values — Node's https module throws a synchronous
    // "Invalid character in header content" TypeError before any request is
    // even sent, which otherwise looks identical to a bad/expired key.
    unifi: {
      host:     (process.env.UNIFI_HOST     || fileConfig.unifi?.host     || '').trim(),
      username: (process.env.UNIFI_USER     || fileConfig.unifi?.username || '').trim(),
      password: (process.env.UNIFI_PASS     || fileConfig.unifi?.password || '').trim(),
      apiKey:   (process.env.UNIFI_API_KEY  || fileConfig.unifi?.apiKey   || '').trim(),
    },
    // Separate product from UniFi Protect above — its own local "Developer
    // API" on a fixed port (12445) with its own Bearer token, even when
    // hosted on the same console.
    unifiAccess: {
      host:   (process.env.UNIFI_ACCESS_HOST    || fileConfig.unifiAccess?.host   || '').trim(),
      apiKey: (process.env.UNIFI_ACCESS_API_KEY || fileConfig.unifiAccess?.apiKey || '').trim(),
    },
    shelly: {
      devices: fileConfig.shelly?.devices || [],
    },
    loxone: {
      host:     process.env.LOXONE_HOST || fileConfig.loxone?.host     || '',
      port:     parseInt(fileConfig.loxone?.port     || 80),
      username: process.env.LOXONE_USER || fileConfig.loxone?.username || 'admin',
      password: process.env.LOXONE_PASS || fileConfig.loxone?.password || '',
    },
    sip: {
      // Browser softphone (registers to UniFi Talk / a SIP PBX) — passed through as-is
      ...fileConfig.sip,
      // Server-side doorbell intercom (SIP UAS in src/sip-server.js) — normalized defaults
      enabled:    fileConfig.sip?.enabled    || false,
      port:       parseInt(fileConfig.sip?.port || 5060),
      domain:     fileConfig.sip?.domain      || '',
      allowFrom:  fileConfig.sip?.allowFrom   || '',
      cameraName: fileConfig.sip?.cameraName  || '',
      doorRelay:  fileConfig.sip?.doorRelay ?? null,
      doorPulseMs:parseInt(fileConfig.sip?.doorPulseMs || 3000),
      autoAnswer: fileConfig.sip?.autoAnswer  || false,
    },
    cameras: fileConfig.cameras || [],
    reolink: { cameras: fileConfig.reolink?.cameras || [] },
    relays: fileConfig.relays || [
      { index: 0, name: 'Relay 1' },
      { index: 1, name: 'Relay 2' },
    ],
    server: {
      port: parseInt(process.env.SERVER_PORT || fileConfig.server?.port || 3000),
    },
    homekit: {
      pin: process.env.HOMEKIT_PIN || fileConfig.homekit?.pin || '031-45-154',
      port: parseInt(process.env.HOMEKIT_PORT || fileConfig.homekit?.port || 47128),
      username: fileConfig.homekit?.username || 'CC:22:3D:E3:CE:F6',
      setupID: fileConfig.homekit?.setupID || 'HEJX',
    },
    esphome: {
      devices: fileConfig.esphome?.devices || [],
    },
    lgthinq: fileConfig.lgthinq ? {
      country: fileConfig.lgthinq.country || 'US',
      lang:    fileConfig.lgthinq.lang    || 'en-US',
    } : undefined,
    smartbob: fileConfig.smartbob?.entities?.length ? {
      host:     fileConfig.smartbob.host     || 'localhost',
      port:     parseInt(fileConfig.smartbob.port) || 1883,
      name:     fileConfig.smartbob.name     || 'SmartBob',
      username: fileConfig.smartbob.username || '',
      password: fileConfig.smartbob.password || '',
      entities: fileConfig.smartbob.entities || [],
    } : undefined,
    knx: fileConfig.knx?.host ? {
      host:           fileConfig.knx.host,
      port:           parseInt(fileConfig.knx.port) || 3671,
      groupAddresses: fileConfig.knx.groupAddresses || [],
    } : undefined,
    ffmpegRtsp: {
      enabled:    !!(fileConfig.ffmpegRtsp?.enabled),
      basePort:   parseInt(fileConfig.ffmpegRtsp?.basePort   || 8554),
      ffmpegPath: fileConfig.ffmpegRtsp?.ffmpegPath || 'ffmpeg',
    },
    loxoneOut: fileConfig.loxoneOut?.host ? {
      host:     fileConfig.loxoneOut.host,
      port:     parseInt(fileConfig.loxoneOut.port) || 80,
      username: fileConfig.loxoneOut.username || 'admin',
      password: fileConfig.loxoneOut.password || '',
      mappings: fileConfig.loxoneOut.mappings || [],
    } : undefined,
    fibaro: fileConfig.fibaro?.host ? {
      host:     fileConfig.fibaro.host,
      port:     parseInt(fileConfig.fibaro.port) || 80,
      username: fileConfig.fibaro.username || 'admin',
      password: fileConfig.fibaro.password || '',
    } : undefined,
    somfy: (fileConfig.somfy?.host || fileConfig.somfy?.mode === 'cloud') ? {
      mode:         fileConfig.somfy.mode === 'cloud' ? 'cloud' : 'local',
      region:       fileConfig.somfy.region   || 'europe',
      host:         fileConfig.somfy.host     || '',
      port:         parseInt(fileConfig.somfy.port) || 8443,
      token:        fileConfig.somfy.token    || '',
      email:        fileConfig.somfy.email    || '',
      password:     fileConfig.somfy.password || '',
      devices:      fileConfig.somfy.devices  || [],
      pollInterval: parseInt(fileConfig.somfy.pollInterval) || 30,
    } : undefined,
    auxair: fileConfig.auxair?.email ? {
      region:       fileConfig.auxair.region       || 'eu',
      email:        fileConfig.auxair.email        || '',
      password:     fileConfig.auxair.password     || '',
      pollInterval: parseInt(fileConfig.auxair.pollInterval) || 30,
    } : undefined,
    denon: fileConfig.denon?.host ? {
      host:      fileConfig.denon.host,
      port:      parseInt(fileConfig.denon.port)      || 23,
      name:      fileConfig.denon.name                || '',
      maxVolume: parseInt(fileConfig.denon.maxVolume) || 80,
      inputs:    fileConfig.denon.inputs              || [],
    } : undefined,
    sonos: (fileConfig.sonos?.hosts?.length || fileConfig.sonos?.discover !== false) ? {
      hosts:        fileConfig.sonos?.hosts        || [],
      discover:     fileConfig.sonos?.discover     !== false,
      pollInterval: parseInt(fileConfig.sonos?.pollInterval) || 5,
    } : undefined,
    bayrol: fileConfig.bayrol?.username ? {
      poolName:     fileConfig.bayrol.poolName    || '',
      username:     fileConfig.bayrol.username    || '',
      password:     fileConfig.bayrol.password    || '',
      pollInterval: parseInt(fileConfig.bayrol.pollInterval) || 60,
      pools:        fileConfig.bayrol.pools       || [],
    } : undefined,
    suppla: fileConfig.suppla?.token ? {
      token:        fileConfig.suppla.token,
      server:       fileConfig.suppla.server       || 'https://cloud.supla.org',
      pollInterval: parseInt(fileConfig.suppla.pollInterval) || 30,
    } : undefined,
    arduino: fileConfig.arduino?.devices?.length ? {
      host:     fileConfig.arduino.host     || '',
      port:     parseInt(fileConfig.arduino.port) || 1883,
      username: fileConfig.arduino.username || '',
      password: fileConfig.arduino.password || '',
      devices:  fileConfig.arduino.devices  || [],
    } : undefined,
  };
}

module.exports = loadConfig;
