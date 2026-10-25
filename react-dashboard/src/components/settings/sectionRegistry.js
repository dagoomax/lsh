// Settings sidebar: every section, grouped by what it's for. Order is the
// order shown — the house-wide basics first, then integrations by kind,
// then platforms LSH bridges to, then diagnostics tools.
//
// `keywords` feed the sidebar search (alongside the title and category) —
// list every brand / product a section configures, so searching for e.g.
// "Dyson" finds the section that holds it.
export const CATEGORIES = [
  { id: 'general', label: 'General', sections: [
    { id: 'system-misc', title: 'Interface, Relays & Server', keywords: ['language', 'theme', 'port', 'relays', 'server', 'interface'] },
    { id: 'security-auth', title: 'Security & Authentication', keywords: ['users', 'password', 'login', 'mcp', 'bot', 'bots', 'ai', 'claude', 'gemini', 'chatgpt', 'openai', 'oauth', 'token', 'api token'] },
    { id: 'backup', title: 'Backup & Restore', keywords: ['backup', 'restore', 'export', 'import', 'config'] },
    { id: 'mqtt-broker', title: 'MQTT Broker', keywords: ['mqtt', 'broker', 'mosquitto', 'aedes', 'tasmota', 'zigbee2mqtt', 'esp', 'button+'] },
    { id: 'modules', title: 'Integration Modules', keywords: ['install', 'github', 'plugins', 'update', 'modules'] },
  ] },
  { id: 'home', label: 'Home', sections: [
    { id: 'homeplan', title: 'Home Plan', keywords: ['floor plan', 'rooms', 'plan'] },
    { id: 'virtual', title: 'Virtual Devices', keywords: ['virtual', 'dummy', 'variable'] },
    { id: 'google-calendar', title: 'Google Calendar', keywords: ['calendar', 'agenda', 'events', 'google'] },
    { id: 'airbnb', title: 'Airbnb', keywords: ['airbnb', 'booking', 'vrbo', 'rental', 'wynajem', 'najem', 'guest', 'gość', 'reservation', 'rezerwacja', 'ical', 'check-in'] },
    { id: 'booking', title: 'Booking.com', keywords: ['booking', 'booking.com', 'extranet', 'rental', 'wynajem', 'najem', 'hotel', 'apartament', 'reservation', 'rezerwacja', 'ical', 'check-in'] },
    { id: 'vrbo', title: 'VRBO', keywords: ['vrbo', 'homeaway', 'expedia', 'rental', 'wynajem', 'najem', 'vacation', 'reservation', 'rezerwacja', 'ical', 'check-in'] },
    { id: 'tenant', title: 'Guest portal', keywords: ['guest', 'gość', 'tenant', 'najemca', 'portal', 'pin', 'door code', 'kod do drzwi', 'wifi', 'airbnb', 'booking', 'vrbo', 'check-in'] },
  ] },
  { id: 'energy', label: 'Energy', sections: [
    { id: 'connection', title: 'Victron (MQTT & VRM)', keywords: ['victron', 'venus', 'cerbo', 'mqtt', 'vrm', 'gx'] },
    { id: 'energy-extra', title: 'MongoDB & SolarEdge', keywords: ['mongodb', 'mongo', 'solaredge', 'database'] },
    { id: 'lsh-ble', title: 'LSH BLE', keywords: ['ble', 'smartshunt', 'smartsolar', 'instant readout', 'arduino'] },
    { id: 'home-batteries', title: 'Home Batteries & Power Stations', keywords: ['battery', 'zendure', 'solarflow', 'anker', 'solix', 'solarbank', 'ugreen', 'powerroam', 'power station', 'magazyn energii'] },
    { id: 'tariff', title: 'Electricity Tariff', keywords: ['tariff', 'price', 'tauron', 'dynamic pricing', 'kwh'] },
  ] },
  { id: 'climate', label: 'Climate & Water', sections: [
    { id: 'zehnder', title: 'Zehnder Ventilation', keywords: ['zehnder', 'rekuperacja', 'rekuperator', 'recuperation', 'heat recovery', 'mvhr', 'hrv', 'wtw', 'comfoair', 'comfoconnect', 'lan c', 'whr930', 'ca350', 'ventilation', 'wentylacja'] },
    { id: 'air-conditioners', title: 'Air Conditioners', keywords: ['air conditioner', 'ac', 'aircon', 'klimatyzacja', 'klimatyzator', 'daikin', 'gree', 'sinclair', 'cooper', 'hunter', 'tosot', 'midea', 'comfee', 'carrier', 'toshiba', 'electrolux', 'mitsubishi', 'melcloud', 'sensibo', 'fujitsu', 'panasonic'] },
    { id: 'lgthinq', title: 'LG ThinQ', keywords: ['lg', 'thinq', 'air conditioner', 'ac'] },
    { id: 'climate-extra', title: 'AuxAir, Dyson, ViCare & more', keywords: ['auxair', 'aux', 'air conditioner', 'ac', 'bayrol', 'pool', 'openweather', 'weather', 'airly', 'air quality', 'vicare', 'viessmann', 'vitodens', 'boiler', 'thermomix', 'dyson', 'purifier'] },
    { id: 'aquilo', title: 'Aquilo Tank Sensors', keywords: ['aquilo', 'tank', 'septic', 'szambo', 'rainwater', 'deszczówka', 'well', 'studnia', 'liquid level', 'poziom cieczy'] },
  ] },
  { id: 'appliances', label: 'Appliances & Robots', sections: [
    { id: 'appliance-cloud', title: 'Home Connect & Miele@home', keywords: ['bosch', 'siemens', 'neff', 'gaggenau', 'home connect', 'miele', 'dishwasher', 'washer', 'oven'] },
    { id: 'roborock', title: 'Roborock', keywords: ['roborock', 'vacuum', 'xiaomi'] },
    { id: 'dreame', title: 'Dreame', keywords: ['dreame', 'vacuum', 'mower'] },
    { id: 'karcher', title: 'Kärcher Home Robots', keywords: ['karcher', 'kärcher', 'vacuum'] },
    { id: 'ecovacs', title: 'Ecovacs Deebot', keywords: ['ecovacs', 'deebot', 'yeedi', 'vacuum', 'odkurzacz'] },
  ] },
  { id: 'lighting', label: 'Lighting & Switches', sections: [
    { id: 'shelly', title: 'Shelly', keywords: ['shelly', 'relay', 'dimmer'] },
    { id: 'techtoy', title: 'TechToy', keywords: ['techtoy', 'tech toy', 'tesla smart', 'bulb', 'żarówka', 'lamp', 'lampka', 'led strip', 'taśma led', 'christmas', 'choinka', 'plug', 'gniazdko', 'tuya'] },
    { id: 'tuya', title: 'Tuya / Smart Life', keywords: ['tuya', 'smart life', 'smartlife', 'tuyapi', 'plug', 'gniazdko', 'bulb', 'curtain', 'lsc', 'nedis', 'blitzwolf', 'gosund', 'moes', 'tesla', 'tesla smart', 'power strip', 'listwa', 'usb', 'zigbee hub', 'głowica', 'trv'] },
    { id: 'sonoff', title: 'Sonoff / eWeLink', keywords: ['sonoff', 'ewelink', 'itead', 'coolkit', 'diy', 'relay', 'plug', 'zigbee', 'przekaźnik'] },
    { id: 'lighting-extra', title: 'IKEA Dirigera & Tradfri', keywords: ['ikea', 'dirigera', 'tradfri'] },
    { id: 'wled', title: 'WLED', keywords: ['wled', 'led strip', 'esp32'] },
  ] },
  { id: 'security', label: 'Security & Access', sections: [
    { id: 'satel', title: 'Satel INTEGRA', keywords: ['satel', 'integra', 'alarm', 'ethm'] },
    { id: 'dsc', title: 'DSC PowerSeries Neo', keywords: ['dsc', 'neo', 'tl280', 'itv2', 'alarm', 'alarm panel'] },
    { id: 'ajax', title: 'Ajax', keywords: ['ajax', 'ajax systems', 'hub', 'alarm', 'alarm panel', 'sia', 'dc-09', 'monitoring station', 'alarm', 'czujka', 'centrala'] },
    { id: 'jablotron', title: 'Jablotron', keywords: ['jablotron', 'ja-100', 'ja100', 'ja-100+', 'f-link', 'alarm', 'alarm panel', 'sia', 'dc-09', 'arc', 'centrala', 'sekcja'] },
    { id: 'tedee', title: 'Tedee Smart Lock', keywords: ['tedee', 'lock', 'door', 'keypad', 'pin', 'zamek'] },
    { id: 'nuki', title: 'Nuki', keywords: ['nuki', 'smart lock', 'opener', 'lock', 'door', 'keypad', 'pin', 'zamek', 'domofon'] },
    { id: 'ttlock', title: 'TTLock', keywords: ['ttlock', 'sciener', 'lock', 'smart lock', 'gateway', 'passcode', 'pin', 'zamek', 'door'] },
  ] },
  { id: 'cameras', label: 'Cameras', sections: [
    { id: 'manualcams', title: 'Cameras', keywords: ['rtsp', 'onvif', 'camera', 'stream'] },
    { id: 'cameras-extra', title: 'UniFi Protect & FFmpeg RTSP', keywords: ['unifi', 'protect', 'ffmpeg', 'rtsp'] },
    { id: 'reolink', title: 'Reolink', keywords: ['reolink'] },
    { id: 'ezviz', title: 'EZVIZ', keywords: ['ezviz', 'hikvision', 'camera', 'doorbell', 'kamera', 'dzwonek'] },
    { id: 'mobotix', title: 'MOBOTIX', keywords: ['mobotix'] },
    { id: 'axis', title: 'Axis (VAPIX)', keywords: ['axis', 'vapix'] },
    { id: 'dahua', title: 'Dahua NVR & Cameras', keywords: ['dahua', 'nvr', 'dvr', 'imou', 'amcrest', 'lorex', 'dmss', 'rejestrator', 'kamera'] },
    { id: 'yale', title: 'Yale Doorbell Cameras', keywords: ['yale', 'doorbell', 'august'] },
    { id: 'aeotec', title: 'Aeotec 360', keywords: ['aeotec', '360'] },
    { id: 'aidetect', title: 'AI Camera Detection', keywords: ['ai', 'detection', 'person', 'object', 'yolo', 'motion'] },
  ] },
  { id: 'media', label: 'Media & Intercom', sections: [
    { id: 'media-all', title: 'Denon, Sony, Sonos & Google Home', keywords: ['denon', 'marantz', 'sony', 'bravia', 'tv', 'sonos', 'google home', 'chromecast', 'nest'] },
    { id: 'airplay', title: 'AirPlay Speakers', keywords: ['airplay', 'homepod', 'apple tv', 'speaker'] },
    { id: 'lgwebos', title: 'LG webOS TVs', keywords: ['lg', 'webos', 'tv', 'television', 'telewizor', 'remote'] },
    { id: 'spotify', title: 'Spotify', keywords: ['spotify', 'music', 'playlist', 'playback'] },
    { id: 'applemusic', title: 'Apple Music', keywords: ['apple music', 'musickit', 'music', 'itunes'] },
    { id: 'tidal', title: 'TIDAL', keywords: ['tidal', 'music', 'hifi', 'lossless', 'playlist'] },
    { id: 'announce', title: 'Announcements', keywords: ['announce', 'announcement', 'tts', 'speech', 'homepod', 'airplay', 'loxone notification', 'say'] },
    { id: 'sip', title: 'SIP Intercom', keywords: ['sip', 'intercom', 'doorbell', 'voip', 'phone'] },
    { id: 'paging', title: 'Room-to-Room Paging', keywords: ['paging', 'intercom', 'talk'] },
  ] },
  { id: 'platforms', label: 'Platforms & Hubs', sections: [
    { id: 'homekit', title: 'HomeKit', keywords: ['homekit', 'apple', 'siri', 'home app', 'pairing', 'qr'] },
    { id: 'matter', title: 'Matter & Thread', keywords: ['matter', 'thread', 'border router'] },
    { id: 'usb-radio', title: 'Z-Wave & Zigbee USB', keywords: ['z-wave', 'zwave', 'zigbee', 'usb', 'stick', 'dongle', 'aeotec', 'z-stick', 'z-stick 10 pro', 'z-wave.me', 'z-station', 'zst39', 'zbt', 'skyconnect', 'sonoff', 'zbdongle', 'conbee', 'coordinator', 'koordynator', 'parowanie', 'pairing', 'zwave-js', 'zigbee2mqtt'] },
    { id: 'homeassistant', title: 'Home Assistant', keywords: ['home assistant', 'hass', 'ha', 'mqtt discovery'] },
    { id: 'smartthings', title: 'Samsung SmartThings', keywords: ['samsung', 'smartthings'] },
    { id: 'smarthome-extra', title: 'Homey, Fibaro, Somfy & more', keywords: ['homey', 'athom', 'somfy', 'tahoma', 'landroid', 'worx', 'mower', 'suppla', 'supla', 'fibaro', 'home center', 'sinum', 'tech', 'tech sterowniki', 'eh-01', 'thermostat', 'vclu', 'virtual clu', 'grenton', 'mcp'] },
  ] },
  { id: 'controllers', label: 'Controllers & Buses', sections: [
    { id: 'loxone', title: 'Loxone Miniserver', keywords: ['loxone', 'miniserver', 'outbound', 'push', 'virtual input'] },
    { id: 'loxonexml', title: 'Loxone XML Templates', keywords: ['loxone', 'xml', 'template', 'virtual output'] },
    { id: 'fibaroout', title: 'Fibaro Outbound Push', keywords: ['fibaro', 'home center', 'global variables', 'push'] },
    { id: 'knx', title: 'KNX', keywords: ['knx', 'eib', 'group address'] },
    { id: 'boneio-grenton', title: 'BoneIO & Grenton', keywords: ['boneio', 'grenton', 'clu'] },
    { id: 'smartbob', title: 'SmartBob', keywords: ['smartbob'] },
    { id: 'arduino', title: 'Arduino MQTT', keywords: ['arduino', 'mqtt'] },
    { id: 'esphome', title: 'ESPHome', keywords: ['esphome', 'esp32', 'esp8266', 'sensy', 'sensy-one', 'mmwave', 'presence'] },
    { id: 'broadlink', title: 'BroadLink RM4', keywords: ['broadlink', 'ir', 'infrared', 'rf', 'remote'] },
    { id: 'waveshare', title: 'Waveshare Modbus TCP', keywords: ['waveshare', 'modbus', 'relay board'] },
  ] },
  { id: 'tools', label: 'Tools', sections: [
    { id: 'lan-scan', title: 'LAN scan', keywords: ['network', 'lan', 'scan', 'ip', 'devices', 'ports', 'mdns', 'bonjour', 'upnp', 'discover'] },
    { id: 'ble-scan', title: 'Bluetooth scan', keywords: ['ble', 'bluetooth', 'scan', 'bluez', 'devices nearby'] },
    { id: 'can-scan', title: 'CAN bus scan', keywords: ['can', 'canbus', 'can-fd', 'nmea 2000', 'n2k', 've.can', 'j1939', 'canopen', 'bms', 'pylontech', 'ventuno', 'socketcan', 'candump'] },
    { id: 'modbus-scan', title: 'Modbus scan', keywords: ['modbus', 'rtu', 'rs485', 'rs-485', 'tcp', '502', 'sunspec', 'energy meter', 'eastron', 'sdm', 'inverter', 'registers'] },
    { id: 'modbus-emu', title: 'Modbus emulator', keywords: ['modbus', 'emulator', 'slave', 'server', 'registers', 'rtu', 'rs485', 'sdm630', 'sdm120', 'plc', 'scada'] },
    { id: 'wiring', title: 'Wiring emulator', keywords: ['wiring', 'wire', 'emulator', 'assistant', 'diagram', 'fibaro', 'shelly', 'z-wave', 'relay', 'dimmer', 'shutter', 'install'] },
    { id: 'manuals', title: 'Device manuals', keywords: ['manual', 'manuals', 'pdf', 'wiring', 'fibaro', 'shelly', 'qubino', 'z-wave', 'installation'] },
  ] },
]

export function findSection(id) {
  for (const cat of CATEGORIES) {
    const s = cat.sections.find(s => s.id === id)
    if (s) return { ...s, category: cat.id, categoryLabel: cat.label }
  }
  return null
}

// Sidebar search: every word must appear in the title, a keyword or the
// category name — English or, with `translate`, the shown language
export function filterCategories(query, translate = (x) => x) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return CATEGORIES
  return CATEGORIES
    .map(cat => ({ ...cat, sections: cat.sections.filter(s => {
      const hay = [s.title, cat.label, translate(s.title), translate(cat.label), ...(s.keywords || [])].join(' ').toLowerCase()
      return words.every(w => hay.includes(w))
    }) }))
    .filter(cat => cat.sections.length)
}

export const FIRST_SECTION_ID = 'system-misc'
