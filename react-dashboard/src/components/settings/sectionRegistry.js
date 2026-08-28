// Full inventory of the vanilla Settings page's 57 sections, grouped by the
// same categories public/settings.html already uses (data-category), so the
// sidebar is a complete map of what Settings covers even though only a
// handful of sections are ported to React so far. Unported entries link out
// to the classic page instead of silently not existing.
//
// `component` is lazy-loaded (import()) so unported categories don't pull in
// component code that doesn't exist yet.
export const CATEGORIES = [
  // Unlike every other category here, "calendar" isn't one of the vanilla
  // page's 57 sections — Google Calendar/agenda is React-only, added
  // alongside the Wall Dashboard feature it feeds.
  { id: 'calendar', label: 'Calendar', sections: [
    { id: 'google-calendar', title: 'Google Calendar', ported: true },
  ] },
  { id: 'energy', label: 'Energy', sections: [
    { id: 'connection', title: 'MQTT & VRM Connection', ported: true },
    { id: 'energy-extra', title: 'MongoDB & SolarEdge', ported: true },
    { id: 'tariff', title: 'Electricity Tariff', ported: true },
  ] },
  { id: 'smarthome', label: 'Smart Home', sections: [
    { id: 'smartthings', title: 'Samsung SmartThings', ported: true },
    { id: 'smarthome-extra', title: 'Homey, Somfy, Landroid, Suppla, Fibaro', ported: true },
    { id: 'roborock', title: 'Roborock', ported: true },
    { id: 'dreame', title: 'Dreame', ported: true },
  ] },
  { id: 'cameras', label: 'Cameras', sections: [
    { id: 'cameras-extra', title: 'UniFi Protect & FFmpeg RTSP', ported: true },
    { id: 'aeotec', title: 'Aeotec 360', ported: true },
    { id: 'aidetect', title: 'AI Camera Detection', ported: true },
    { id: 'reolink', title: 'Reolink', ported: true },
    { id: 'mobotix', title: 'MOBOTIX', ported: true },
    { id: 'axis', title: 'Axis (VAPIX)', ported: true },
    { id: 'manualcams', title: 'Cameras', ported: true },
  ] },
  { id: 'climate', label: 'Climate & Appliances', sections: [
    { id: 'climate-extra', title: 'AuxAir, Bayrol, OpenWeather, Airly, ViCare, Thermomix', ported: true },
    { id: 'lgthinq', title: 'LG ThinQ', ported: true },
    { id: 'appliance-cloud', title: 'Home Connect & Miele@home', ported: true },
  ] },
  { id: 'lighting', label: 'Lighting', sections: [
    { id: 'lighting-extra', title: 'IKEA Dirigera & Tradfri', ported: true },
    { id: 'wled', title: 'WLED', ported: true },
    { id: 'shelly', title: 'Shelly', ported: true },
  ] },
  { id: 'media', label: 'Media', sections: [
    { id: 'media-all', title: 'Denon, Sony Bravia, Sonos', ported: true },
    { id: 'airplay', title: 'AirPlay Speakers', ported: true },
  ] },
  { id: 'controllers', label: 'Controllers & Buses', sections: [
    { id: 'loxone', title: 'Loxone Miniserver & Outbound Push', ported: true },
    { id: 'fibaroout', title: 'Fibaro Outbound Push', ported: true },
    { id: 'loxonexml', title: 'Loxone XML Templates', ported: true },
    { id: 'knx', title: 'KNX', ported: true },
    { id: 'boneio-grenton', title: 'BoneIO & Grenton', ported: true },
    { id: 'smartbob', title: 'SmartBob', ported: true },
    { id: 'arduino', title: 'Arduino MQTT', ported: true },
    { id: 'esphome', title: 'ESPHome', ported: true },
    { id: 'broadlink', title: 'BroadLink RM4', ported: true },
    { id: 'waveshare', title: 'Waveshare Modbus TCP', ported: true },
  ] },
  { id: 'security', label: 'Security', sections: [
    { id: 'satel', title: 'Satel INTEGRA', ported: true },
  ] },
  { id: 'communication', label: 'Communication', sections: [
    { id: 'sip', title: 'SIP Intercom', ported: true },
    { id: 'paging', title: 'Room-to-Room Paging', ported: true },
  ] },
  { id: 'system', label: 'System', sections: [
    { id: 'virtual', title: 'Virtual Devices', ported: true },
    { id: 'system-misc', title: 'Interface, Relays & Server', ported: true },
    { id: 'homekit', title: 'HomeKit', ported: true },
    { id: 'homeplan', title: 'Home Plan', ported: true },
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
