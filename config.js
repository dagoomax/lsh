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
      token:     process.env.SMARTTHINGS_TOKEN || fileConfig.smartthings?.token || '',
      deviceIds: fileConfig.smartthings?.deviceIds || [],
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
    },
    unifi: {
      host:     process.env.UNIFI_HOST     || fileConfig.unifi?.host     || '',
      username: process.env.UNIFI_USER     || fileConfig.unifi?.username || '',
      password: process.env.UNIFI_PASS     || fileConfig.unifi?.password || '',
      apiKey:   process.env.UNIFI_API_KEY  || fileConfig.unifi?.apiKey   || '',
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
    cameras: fileConfig.cameras || [],
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
  };
}

module.exports = loadConfig;
