// Full inventory of the vanilla Settings page's 57 sections, grouped by the
// same categories public/settings.html already uses (data-category), so the
// sidebar is a complete map of what Settings covers even though only a
// handful of sections are ported to React so far. Unported entries link out
// to the classic page instead of silently not existing.
//
// `component` is lazy-loaded (import()) so unported categories don't pull in
// component code that doesn't exist yet.
export const CATEGORIES = [
  { id: 'energy', label: 'Energy', sections: [
    { id: 'connection', title: 'MQTT & VRM Connection', ported: true },
    { id: 'mongo', title: 'MongoDB Storage' },
    { id: 'solaredge', title: 'SolarEdge' },
  ] },
  { id: 'smarthome', label: 'Smart Home', sections: [
    { id: 'smartthings', title: 'Samsung SmartThings', ported: true },
    { id: 'homey', title: 'Homey' },
    { id: 'somfy', title: 'Somfy TaHoma' },
    { id: 'roborock', title: 'Roborock' },
    { id: 'landroid', title: 'Worx Landroid / Kress / Landxcape' },
    { id: 'suppla', title: 'Suppla' },
    { id: 'dreame', title: 'Dreame' },
    { id: 'fibaro', title: 'Fibaro Home Center' },
  ] },
  { id: 'cameras', label: 'Cameras', sections: [
    { id: 'unifi', title: 'UniFi Protect' },
    { id: 'aeotec', title: 'Aeotec 360' },
    { id: 'aidetect', title: 'AI Camera Detection' },
    { id: 'reolink', title: 'Reolink', ported: true },
    { id: 'mobotix', title: 'MOBOTIX' },
    { id: 'axis', title: 'Axis (VAPIX)' },
    { id: 'manualcams', title: 'Cameras', ported: true },
    { id: 'ffmpegrtsp', title: 'FFmpeg RTSP Proxy' },
  ] },
  { id: 'climate', label: 'Climate & Appliances', sections: [
    { id: 'auxair', title: 'AuxAir' },
    { id: 'bayrol', title: 'Bayrol Pool Manager' },
    { id: 'lgthinq', title: 'LG ThinQ' },
    { id: 'homeconnect', title: 'Home Connect' },
    { id: 'miele', title: 'Miele@home' },
    { id: 'openweather', title: 'OpenWeatherMap' },
    { id: 'vicare', title: 'Viessmann ViCare' },
    { id: 'thermomix', title: 'Thermomix / Cookidoo' },
  ] },
  { id: 'lighting', label: 'Lighting', sections: [
    { id: 'dirigera', title: 'IKEA Dirigera' },
    { id: 'tradfri', title: 'IKEA Tradfri' },
    { id: 'wled', title: 'WLED' },
    { id: 'shelly', title: 'Shelly' },
  ] },
  { id: 'media', label: 'Media', sections: [
    { id: 'denon', title: 'Denon AVR' },
    { id: 'bravia', title: 'Sony Bravia TV' },
    { id: 'sonos', title: 'Sonos' },
  ] },
  { id: 'controllers', label: 'Controllers & Buses', sections: [
    { id: 'loxone', title: 'Loxone Miniserver' },
    { id: 'loxoneout', title: 'Loxone Outbound Push' },
    { id: 'fibaroout', title: 'Fibaro Outbound Push' },
    { id: 'loxonexml', title: 'Loxone XML Templates' },
    { id: 'knx', title: 'KNX' },
    { id: 'boneio', title: 'BoneIO' },
    { id: 'grenton', title: 'Grenton' },
    { id: 'smartbob', title: 'SmartBob' },
    { id: 'arduino', title: 'Arduino MQTT' },
    { id: 'esphome', title: 'ESPHome' },
    { id: 'broadlink', title: 'BroadLink RM4' },
    { id: 'waveshare', title: 'Waveshare Modbus TCP' },
  ] },
  { id: 'security', label: 'Security', sections: [
    { id: 'satel', title: 'Satel INTEGRA' },
  ] },
  { id: 'communication', label: 'Communication', sections: [
    { id: 'sip', title: 'SIP Intercom' },
  ] },
  { id: 'system', label: 'System', sections: [
    { id: 'virtual', title: 'Virtual Devices' },
    { id: 'interface', title: 'Interface' },
    { id: 'relays', title: 'Relays' },
    { id: 'homekit', title: 'HomeKit' },
    { id: 'server', title: 'Server' },
    { id: 'homeplan', title: 'Home Plan' },
    { id: 'security-auth', title: 'Security & Authentication', ported: true },
    { id: 'backup', title: 'Backup & Restore', ported: true },
  ] },
]

export function findSection(id) {
  for (const cat of CATEGORIES) {
    const s = cat.sections.find(s => s.id === id)
    if (s) return { ...s, category: cat.id, categoryLabel: cat.label }
  }
  return null
}

export const FIRST_PORTED_ID = 'connection'
