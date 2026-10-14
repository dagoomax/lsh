// Air conditioners on the dashboard — one view of an AC whatever the brand, for
// the tile (DeviceList) and the popup (AcPanel).
//
//   shared model  Daikin, Gree, Midea, MELCloud, Sensibo (src/ac-common.js on the
//                 server): power, mode 0 auto 1 cool 2 dry 3 fan 4 heat,
//                 targetTemp, fan 0–5, swing, temperature, outdoorTemp, humidity
//   AuxAir        pwr, ac_mode 1 cool 2 heat 3 dry 4 fan 5 auto, temp, envtemp,
//                 ac_mark 0 auto 1 low 2 med 3 high 4 turbo 5 mute
import { getLang } from './i18n'

export const MODES = ['auto', 'cool', 'dry', 'fan', 'heat']
export const MODE_COLOR = { auto: '#5e5ce6', cool: '#0a84ff', dry: '#30b0c7', fan: '#8e8e93', heat: '#ff9f0a' }

const AUX_MODES = ['cool', 'heat', 'dry', 'fan', 'auto'] // value = index + 1
const AUX_FANS = [0, 1, 2, 3, 4, 5]                       // auto, low, med, high, turbo, mute
const SHARED_FANS = ['auto', 'quiet', 'low', 'medium', 'high', 'turbo']
const AUX_FAN_KEYS = ['auto', 'low', 'medium', 'high', 'turbo', 'quiet']

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

// → null when the device isn't an AC; otherwise its state and how to command it
export function acView(device, readings) {
  const r = readings || device?.readings || {}
  const v = (p) => r[p]?.value
  const sensor = (p) => (device?.sensors || []).find((s) => s.path === p)
  const paths = new Set((device?.sensors || []).map((s) => s.path))

  if (paths.has('thermostatMode') && paths.has('mode') && paths.has('targetTemp') && paths.has('power')) {
    const t = sensor('targetTemp') || {}
    const on = v('power') === 1 || v('power') === true
    return {
      on, mode: MODES[num(v('mode')) ?? 0] || 'auto', modes: MODES,
      setTemp: num(v('targetTemp')), roomTemp: num(v('temperature')), outdoorTemp: num(v('outdoorTemp')), humidity: num(v('humidity')),
      fan: num(v('fan')), fans: SHARED_FANS, swing: paths.has('swing') ? v('swing') === 1 || v('swing') === true : null,
      online: v('online') == null ? true : v('online') === 1,
      min: t.min ?? 16, max: t.max ?? 30, step: t.step ?? 0.5,
      cmd: {
        power: (on) => ['power', on ? 1 : 0],
        mode: (m) => ['mode', MODES.indexOf(m)],
        temp: (c) => ['targetTemp', c],
        fan: (i) => ['fan', i],
        swing: (on) => ['swing', on ? 1 : 0],
      },
    }
  }
  if (device?.type === 'auxair') {
    const on = [1, true, '1', 'true'].includes(v('pwr'))
    const m = num(v('ac_mode'))
    const f = num(v('ac_mark'))
    return {
      on, mode: AUX_MODES[(m ?? 1) - 1] || 'cool', modes: AUX_MODES,
      setTemp: num(v('temp')), roomTemp: num(v('envtemp')), outdoorTemp: null, humidity: null,
      fan: f == null ? null : SHARED_FANS.indexOf(AUX_FAN_KEYS[f] ?? 'auto'), fans: SHARED_FANS, swing: null, online: true,
      min: 16, max: 30, step: 1,
      cmd: {
        power: (on) => ['pwr', on ? 1 : 0],
        mode: (key) => ['ac_mode', AUX_MODES.indexOf(key) + 1],
        temp: (c) => ['temp', c],
        fan: (i) => ['ac_mark', AUX_FANS[AUX_FAN_KEYS.indexOf(SHARED_FANS[i])] ?? 0],
        swing: null,
      },
    }
  }
  return null
}

// paths the AC panel already covers — the popup's generic controls skip them
export const AC_PATHS = new Set(['power', 'mode', 'modeName', 'targetTemp', 'fan', 'swing', 'pwr', 'ac_mode', 'temp', 'ac_mark',
  'thermostatMode', 'thermostatOperatingState', 'heatingSetpoint', 'coolingSetpoint'])

const fmt = (c) => (c == null ? '—' : `${Number.isInteger(c) ? c : c.toFixed(1)}°`)
export const fmtTemp = fmt

// one line for the tile: "Cool · 24.5° → 22°"
export function acSummary(ac) {
  if (!ac.online) return acText('offline')
  if (!ac.on) return acText('off')
  const parts = [acText(ac.mode)]
  if (ac.roomTemp != null) parts.push(fmt(ac.roomTemp))
  if (ac.setTemp != null && ac.mode !== 'fan') parts.push(`→ ${fmt(ac.setTemp)}`)
  return parts.join(' · ')
}

const T = {
  en: { auto: 'Auto', cool: 'Cool', dry: 'Dry', fan: 'Fan', heat: 'Heat', quiet: 'Quiet', low: 'Low', medium: 'Medium', high: 'High', turbo: 'Turbo',
    off: 'Off', offline: 'Offline', on: 'On', power: 'Power', mode: 'Mode', fanSpeed: 'Fan speed', swing: 'Swing', room: 'Room', outdoor: 'Outdoor', humidity: 'Humidity', target: 'Set to', fanOnly: 'Fan only — no set temperature' },
  pl: { auto: 'Auto', cool: 'Chłodzenie', dry: 'Osuszanie', fan: 'Wentylator', heat: 'Grzanie', quiet: 'Cichy', low: 'Niski', medium: 'Średni', high: 'Wysoki', turbo: 'Turbo',
    off: 'Wył.', offline: 'Offline', on: 'Wł.', power: 'Zasilanie', mode: 'Tryb', fanSpeed: 'Nawiew', swing: 'Swing', room: 'W pokoju', outdoor: 'Na zewnątrz', humidity: 'Wilgotność', target: 'Ustaw', fanOnly: 'Tylko wentylator — bez temperatury zadanej' },
  de: { auto: 'Auto', cool: 'Kühlen', dry: 'Entfeuchten', fan: 'Lüften', heat: 'Heizen', quiet: 'Leise', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', turbo: 'Turbo',
    off: 'Aus', offline: 'Offline', on: 'An', power: 'Ein/Aus', mode: 'Modus', fanSpeed: 'Lüfterstufe', swing: 'Swing', room: 'Raum', outdoor: 'Außen', humidity: 'Luftfeuchte', target: 'Soll', fanOnly: 'Nur Lüften — keine Solltemperatur' },
  fr: { auto: 'Auto', cool: 'Froid', dry: 'Déshum.', fan: 'Ventil.', heat: 'Chaud', quiet: 'Silence', low: 'Faible', medium: 'Moyen', high: 'Fort', turbo: 'Turbo',
    off: 'Arrêt', offline: 'Hors ligne', on: 'Marche', power: 'Marche', mode: 'Mode', fanSpeed: 'Ventilation', swing: 'Oscillation', room: 'Pièce', outdoor: 'Extérieur', humidity: 'Humidité', target: 'Consigne', fanOnly: 'Ventilation seule — pas de consigne' },
  es: { auto: 'Auto', cool: 'Frío', dry: 'Deshum.', fan: 'Ventilar', heat: 'Calor', quiet: 'Silencio', low: 'Bajo', medium: 'Medio', high: 'Alto', turbo: 'Turbo',
    off: 'Apagado', offline: 'Sin conexión', on: 'Encendido', power: 'Encendido', mode: 'Modo', fanSpeed: 'Ventilador', swing: 'Oscilación', room: 'Estancia', outdoor: 'Exterior', humidity: 'Humedad', target: 'Consigna', fanOnly: 'Solo ventilador — sin consigna' },
  it: { auto: 'Auto', cool: 'Freddo', dry: 'Deumid.', fan: 'Ventola', heat: 'Caldo', quiet: 'Silenzioso', low: 'Bassa', medium: 'Media', high: 'Alta', turbo: 'Turbo',
    off: 'Spento', offline: 'Offline', on: 'Acceso', power: 'Accensione', mode: 'Modalità', fanSpeed: 'Ventola', swing: 'Swing', room: 'Stanza', outdoor: 'Esterno', humidity: 'Umidità', target: 'Imposta', fanOnly: 'Solo ventola — nessuna temperatura impostata' },
  uk: { auto: 'Авто', cool: 'Холод', dry: 'Осушення', fan: 'Вентилятор', heat: 'Тепло', quiet: 'Тихий', low: 'Низький', medium: 'Середній', high: 'Високий', turbo: 'Турбо',
    off: 'Вимк.', offline: 'Офлайн', on: 'Увімк.', power: 'Живлення', mode: 'Режим', fanSpeed: 'Обдув', swing: 'Гойдання', room: 'У кімнаті', outdoor: 'Надворі', humidity: 'Вологість', target: 'Задано', fanOnly: 'Лише вентилятор — без заданої температури' },
}
export function acText(key) { return (T[getLang()] || T.en)[key] || T.en[key] || key }
