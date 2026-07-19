// Clean SVG icon components — Homey-style outline, 24×24 viewBox

const s = (color = 'currentColor', size = 24) => ({
  width: size, height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: color,
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

// Somfy "my" favourite — the rounded "my" button from a Somfy remote,
// in Somfy's signature golden-yellow brand colour.
export function MyIcon({ color = '#FFCE00', size = 20 }) {
  return (
    <svg width={size * 1.6} height={size} viewBox="0 0 32 20" fill="none">
      <rect x="1" y="1" width="30" height="18" rx="9" fill="none" stroke={color} strokeWidth="1.6"/>
      <text x="16" y="14.5" textAnchor="middle" fill={color} stroke="none"
        fontFamily="-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif"
        fontSize="11" fontWeight="700" letterSpacing="0.3">my</text>
    </svg>
  )
}

export function BulbIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M9 21h6M10 17.5h4"/>
      <path d="M12 3a6 6 0 0 1 6 6c0 2.5-1.4 4.7-3.5 5.9V17a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1-.5-.5v-2.1C7.4 13.7 6 11.5 6 9a6 6 0 0 1 6-6z"/>
    </svg>
  )
}

export function CeilingLightIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 2v3"/>
      <path d="M5 9h14l-2 8H7L5 9z"/>
      <path d="M9 17v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2"/>
    </svg>
  )
}

export function LedStripIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="9" width="20" height="6" rx="3"/>
      <circle cx="7"  cy="12" r="1.5" fill={color} stroke="none"/>
      <circle cx="12" cy="12" r="1.5" fill={color} stroke="none"/>
      <circle cx="17" cy="12" r="1.5" fill={color} stroke="none"/>
    </svg>
  )
}

export function WallSconceIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="9" y="2" width="6" height="3" rx="1"/>
      <path d="M12 5v2"/>
      <path d="M8 7h8c0 5-2 8-4 10H12c-2-2-4-5-4-10z"/>
      <path d="M9 21h6"/>
    </svg>
  )
}

export function ChandelierIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 2v3"/>
      <path d="M12 5c-4.5 0-7 2.5-7 6M12 5c4.5 0 7 2.5 7 6M12 5v5.5"/>
      <path d="M3.5 11h3M17.5 11h3"/>
      <path d="M5 11v-2.5M19 11v-2.5"/>
      <circle cx="12" cy="12.5" r="1.6"/>
    </svg>
  )
}

export function SpotlightIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M3 4h4M5 4v2"/>
      <circle cx="7.5" cy="8.5" r="3"/>
      <path d="M10 10.5 17 20M10.5 10 20 17"/>
    </svg>
  )
}

export function PendantLightIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 2v5"/>
      <path d="M6 13c0-3.3 2.7-6 6-6s6 2.7 6 6z"/>
      <path d="M12 16v.5"/>
      <path d="M8 18l-.7 1M16 18l.7 1M12 18.5V20"/>
    </svg>
  )
}

export function FloorLampIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M9 3h6l2 5H7l2-5z"/>
      <path d="M12 8v12"/>
      <path d="M8 20h8"/>
    </svg>
  )
}

export function DeskLampIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M4 20h8"/>
      <path d="M8 20l2-7 4.5-4.5"/>
      <circle cx="15.8" cy="7.2" r="2.6"/>
      <path d="M19 10l2 2M20 7.5h1.5"/>
    </svg>
  )
}

export function DimmerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="11" r="4"/>
      <path d="M12 3v2M12 17v2M4 11H2M22 11h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 16.4l-1.4 1.4M19.8 4.2l-1.4 1.4"/>
    </svg>
  )
}

export function PlugIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 22v-4"/>
      <path d="M7 6v4a5 5 0 0 0 10 0V6"/>
      <path d="M9 2v4M15 2v4"/>
    </svg>
  )
}

export function SwitchOutletIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 8V6M12 18v-2M8 12H6M18 12h-2"/>
    </svg>
  )
}

export function ThermometerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
    </svg>
  )
}

export function HumidityIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 2c0 0-7 7.5-7 12a7 7 0 0 0 14 0c0-4.5-7-12-7-12z"/>
    </svg>
  )
}

export function MotionIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="9" r="2.5"/>
      <path d="M6.5 17A7 7 0 0 1 5 12"/>
      <path d="M17.5 17A7 7 0 0 0 19 12"/>
      <path d="M3.5 20A11 11 0 0 1 2 12"/>
      <path d="M22 12a11 11 0 0 1-1.5 8"/>
    </svg>
  )
}

export function PresenceIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="7" r="4"/>
      <path d="M5.5 21a8.5 8.5 0 0 1 13 0"/>
      <circle cx="19" cy="8" r="2"/>
    </svg>
  )
}

export function DoorIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <path d="M9 2l0 20"/>
      <circle cx="7" cy="12" r="1" fill={color} stroke="none"/>
    </svg>
  )
}

export function CameraIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M23 7l-7 5 7 5V7z"/>
      <rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>
  )
}

export function WashingMachineIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="2" width="20" height="20" rx="2"/>
      <circle cx="12" cy="13" r="5"/>
      <path d="M7 6h2M11 6h.01"/>
      <path d="M9.5 11.5c1-1 2.5-1.2 3.5-.5"/>
    </svg>
  )
}

export function DryerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="2" width="20" height="20" rx="2"/>
      <circle cx="12" cy="13" r="5"/>
      <path d="M7 6h2M11 6h.01"/>
      <path d="M12 8v2M9 11a3 3 0 0 1 3 0"/>
    </svg>
  )
}

export function ShowerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M4 4a3 3 0 0 1 6 0v8h7a1 1 0 0 0 1-1V5"/>
      <path d="M10 12v6"/>
      <path d="M7 19h6"/>
      <circle cx="13" cy="16" r="1" fill={color} stroke="none"/>
      <circle cx="16" cy="14" r="1" fill={color} stroke="none"/>
      <circle cx="16" cy="18" r="1" fill={color} stroke="none"/>
      <circle cx="19" cy="16" r="1" fill={color} stroke="none"/>
    </svg>
  )
}

export function ThermostatIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="6" y="2" width="12" height="14" rx="6"/>
      <path d="M9 8h6M9 5h4"/>
      <path d="M12 16v5"/>
      <path d="M9 20h6"/>
    </svg>
  )
}

export function ValveIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M2 12h20"/>
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 4v4M12 16v4M10 6l-2-2M14 6l2-2"/>
    </svg>
  )
}

export function RemoteIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="7" y="2" width="10" height="20" rx="5"/>
      <circle cx="12" cy="8"  r="1.5" fill={color} stroke="none"/>
      <circle cx="12" cy="13" r="1"   fill={color} stroke="none"/>
      <path d="M10 17h4" strokeWidth="1.5"/>
    </svg>
  )
}

export function ShelfIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="3"  width="20" height="3" rx="1"/>
      <rect x="2" y="11" width="20" height="3" rx="1"/>
      <rect x="2" y="19" width="20" height="2" rx="1"/>
      <path d="M7 6v5M17 6v5M12 14v5"/>
    </svg>
  )
}

export function PhoneIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="5" y="2" width="14" height="20" rx="3"/>
      <path d="M12 18h.01"/>
      <path d="M9 6h6"/>
    </svg>
  )
}

export function GardenIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 22V12"/>
      <path d="M12 12C12 12 7 10 5 6c3 0 5.5 1 7 4"/>
      <path d="M12 12c0 0 5-2 7-6-3 0-5.5 1-7 4"/>
      <path d="M12 16c0 0-4-1-5-4 2.5 0 4 1 5 2.5"/>
    </svg>
  )
}

export function SecurityIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 3L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7l-8-4z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  )
}

export function SensorIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="12" r="2" fill={color} stroke="none"/>
      <path d="M4.9 4.9a10 10 0 0 0 0 14.2"/>
      <path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4"/>
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4"/>
    </svg>
  )
}

export function SolarPanelIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <path d="M2 9h20M2 14h20M8 4v16M16 4v16"/>
    </svg>
  )
}

export function BatteryIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="7" width="18" height="10" rx="2"/>
      <path d="M22 11v2" strokeWidth="2.5"/>
      <path d="M6 11v2M9 11v2M12 11v2" strokeWidth="2"/>
    </svg>
  )
}

export function GridPowerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
    </svg>
  )
}

export function SignalIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M2 20h20"/>
      <path d="M5 18v-3M9 18v-6M13 18v-9M17 18v-12M21 18v-15"/>
    </svg>
  )
}

export function PowerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
      <path d="M12 2v10"/>
    </svg>
  )
}

export function HomeIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
      <path d="M9 21V12h6v9"/>
    </svg>
  )
}

// ── Energy-flow icons ────────────────────────────────────────────────────────

export function SunIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>
    </svg>
  )
}

export function PylonIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 3 7.5 21M12 3l4.5 18"/>
      <path d="M4.5 8.5h15"/>
      <path d="M7 14.5h10"/>
      <path d="m9.1 14.5 7.4 6.5M14.9 14.5 7.5 21"/>
    </svg>
  )
}

export function BatteryCellIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="7.5" y="4.5" width="9" height="17" rx="2"/>
      <path d="M10 2h4"/>
      <path d="m12.9 9.5-2.4 3.2h3l-2.4 3.2"/>
    </svg>
  )
}

export function BoltIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" fill={color} stroke="none"/>
    </svg>
  )
}

export function RouterIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="13" width="20" height="7" rx="2"/>
      <path d="M6 17h.01M10 17h.01"/>
      <path d="M12 13V9"/>
      <path d="M8 9a6 6 0 0 1 8 0"/>
      <path d="M5.5 6.5a9 9 0 0 1 13 0"/>
    </svg>
  )
}

export function InverterIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="6" width="20" height="12" rx="3"/>
      <path d="M7 12h2l2-3 2 6 2-3h2"/>
    </svg>
  )
}

export function RelayIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M3 12h6M15 12h6"/>
      <path d="M12 4v4M12 16v4"/>
    </svg>
  )
}

export function ShutterIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="3" width="20" height="18" rx="2"/>
      <path d="M2 7h20M2 11h20M2 15h20"/>
      <path d="M12 3v18"/>
    </svg>
  )
}

export function PoolIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M2 12c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0"/>
      <path d="M2 17c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0"/>
      <path d="M9 5l1.5 3M15 5l-1.5 3"/>
      <path d="M7.5 8h9"/>
    </svg>
  )
}

export function AirCondIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="6" width="20" height="8" rx="3"/>
      <path d="M6 14v2M10 14v3M14 14v2M18 14v3"/>
      <path d="M7 9h10"/>
      <circle cx="17" cy="9" r="1" fill={color} stroke="none"/>
    </svg>
  )
}

export function FibaroIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <circle cx="12" cy="12" r="9"/>
      <path d="M9 8h6M9 12h4M9 16h5"/>
    </svg>
  )
}

export function DenonIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2" y="7" width="20" height="10" rx="2"/>
      <circle cx="7"  cy="12" r="2"/>
      <circle cx="7"  cy="12" r="0.8" fill={color} stroke="none"/>
      <path d="M12 9.5h6M12 12h6M12 14.5h4"/>
    </svg>
  )
}

export function SpeakerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="3" y="3" width="18" height="18" rx="4"/>
      <circle cx="12" cy="13" r="3.5"/>
      <circle cx="12" cy="13" r="1" fill={color} stroke="none"/>
      <circle cx="12" cy="6" r="1" fill={color} stroke="none"/>
    </svg>
  )
}

export function SuplaIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M12 3a9 9 0 100 18A9 9 0 0012 3z" strokeWidth="1.5"/>
      <path d="M8.5 12h7M12 8.5v7" strokeLinecap="round" strokeWidth="2"/>
    </svg>
  )
}

export function ArduinoIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="4" y="7" width="16" height="10" rx="2"/>
      <path d="M4 10H2M4 14H2M20 10h2M20 14h2" strokeLinecap="round"/>
      <path d="M9 12h2M13 12h2" strokeLinecap="round"/>
      <circle cx="8" cy="12" r="1.2" fill={color} stroke="none"/>
    </svg>
  )
}

// ── Icon resolver ─────────────────────────────────────────────────────────────
const LABEL_MAP = {
  kinkiet:               WallSconceIcon,
  ledy:                  LedStripIcon,
  ubikacja:              ShowerIcon,
  korytarz:              DoorIcon,
  entrance:              DoorIcon,
  wejście:               DoorIcon,
  edison:                BulbIcon,
  huebloom:              BulbIcon,
  'pólka':               ShelfIcon,
  pralka:                WashingMachineIcon,
  suszarka:              DryerIcon,
  żyrandol:              CeilingLightIcon,
  'zawórlidl':           ValveIcon,
  'cam 360':             CameraIcon,
  'ikea vindstyrka':     SensorIcon,
  'ikea motion sensor':  MotionIcon,
  'ikea remote control': RemoteIcon,
  'ikea dimmer switch':  DimmerIcon,
  'ikea bulb e27 ws 1':  BulbIcon,
  'bilresa dual button': RemoteIcon,
  'popp thermostat':     ThermostatIcon,
  'http temperature':    ThermometerIcon,
  'http switch':         SwitchOutletIcon,
  'solar charger':       SolarPanelIcon,
  'multi/quattro':       InverterIcon,
  battery:               BatteryIcon,
  iphone:                PhoneIcon,
  'ipad pro':            PhoneIcon,
  ogródek:               GardenIcon,
  komórka:               PhoneIcon,
  'czujnik ruchu':       MotionIcon,
  'okno rgbw':           LedStripIcon,
  fdsegr:                SwitchOutletIcon,
}

const TYPE_MAP = {
  vebus:        InverterIcon,
  battery:      BatteryIcon,
  solarcharger: SolarPanelIcon,
  smartthings:  HomeIcon,
  fibaro:       FibaroIcon,
  bayrol:       PoolIcon,
  somfy:        ShutterIcon,
  auxair:       AirCondIcon,
  sonos:        SpeakerIcon,
  denon:        DenonIcon,
  arduino:      ArduinoIcon,
  suppla:       SuplaIcon,
  smarttub:     SpaIcon,
  zway:         ZWaveIcon,
  wirenboard:   DinRailIcon,
  dreame:       RobotVacuumIcon,
  roborock:     RobotVacuumIcon,
  esphome:      ChipIcon,
  shelly:       PlugIcon,
  knx:          KnxBusIcon,
  loxone:       LoxoneIcon,
  lgthinq:      LgAppliianceIcon,
  homeconnect:  OvenIcon,
  miele:        OvenIcon,
  mc6:          ThermostatIcon,
  broadlink:    RemoteIcon,
  boneio:       DinRailIcon,
  waveshare:    RelayOutputIcon,
  homey:        HomeIcon,
  dirigera:     BulbIcon,
  tradfri:      BulbIcon,
}

function readingIcon(r = {}) {
  if (r.motion || r.presence)               return MotionIcon
  if (r.temperature || r.humidity)          return ThermometerIcon
  if (r.level != null || r.colorTemperature != null) return BulbIcon
  if (r.switch != null)                     return SwitchOutletIcon
  return null
}


// ── Individual device icons (stroke style matches the set above) ────────────

export function SpaIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-4z"/>
      <path d="M6 12v-1a2 2 0 0 1 4 0v1M14 12v-1a2 2 0 0 1 4 0v1"/>
      <path d="M7 8c0-1 .8-1.4.8-2.4S7 4.3 7 3.5M11 8c0-1 .8-1.4.8-2.4S11 4.3 11 3.5M15 8c0-1 .8-1.4.8-2.4S15 4.3 15 3.5"/>
    </svg>
  )
}

export function ZWaveIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M8 9h8l-8 6h8"/>
    </svg>
  )
}

export function DinRailIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <path d="M8 8v8M12 8v8M16 8v8"/>
      <path d="M4 12h2M18 12h2"/>
    </svg>
  )
}

export function RobotVacuumIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <circle cx="12" cy="12" r="3.5"/>
      <path d="M12 3v3M5.6 18.4l2.1-2.1M18.4 18.4l-2.1-2.1"/>
    </svg>
  )
}

export function ChipIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="7" width="10" height="10" rx="1.5"/>
      <path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3"/>
    </svg>
  )
}

export function KnxBusIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18"/>
      <circle cx="7" cy="12" r="2"/><circle cx="17" cy="12" r="2"/>
      <path d="M7 10V6h4M17 14v4h-4"/>
    </svg>
  )
}

export function LoxoneIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2.5"/>
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill={color} stroke="none"/>
    </svg>
  )
}

export function LgAppliianceIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M9 8v8h4M15 8a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2"/>
    </svg>
  )
}

export function ShieldIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  )
}

export function RelayOutputIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
      <path d="M7 12h3M14 8.5L10 12M16 12h1"/>
      <path d="M14 5l1.5 2.5L14 10"/>
    </svg>
  )
}

// ── Home appliances (Home Connect / Miele / LG ThinQ) ────────────────────────

export function DishwasherIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="4" y="3" width="16" height="18" rx="2"/>
      <path d="M4 8h16"/>
      <circle cx="7" cy="5.5" r="0.9" fill={color} stroke="none"/>
      <path d="M16 5.5h2"/>
      <circle cx="12" cy="14.5" r="3.5"/>
      <path d="M12 11v7M8.5 14.5h7"/>
    </svg>
  )
}

export function OvenIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="4" y="3" width="16" height="18" rx="2"/>
      <path d="M4 8h16"/>
      <circle cx="7" cy="5.5" r="0.9" fill={color} stroke="none"/>
      <circle cx="10.5" cy="5.5" r="0.9" fill={color} stroke="none"/>
      <path d="M16 5.5h2"/>
      <rect x="7" y="11" width="10" height="7" rx="1"/>
      <path d="M9 13h6"/>
    </svg>
  )
}

export function CoffeeMakerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M5 3h14v4H5z"/>
      <path d="M9 7v2M15 7v2"/>
      <path d="M8 12h8v4a4 4 0 0 1-8 0v-4z"/>
      <path d="M16 12h2a2 2 0 0 1 0 4h-2"/>
      <path d="M5 21h14"/>
    </svg>
  )
}

export function FridgeIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="5" y="2.5" width="14" height="19" rx="2"/>
      <path d="M5 9.5h14"/>
      <path d="M8 5.5V7M8 12v3"/>
    </svg>
  )
}

export function HoodIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <path d="M10 3h4v5h-4z"/>
      <path d="M4 12l6-4h4l6 4z"/>
      <path d="M4 12h16v3H4z"/>
      <path d="M8 18v.5M12 18v2M16 18v.5"/>
    </svg>
  )
}

export function HobIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="2.5"/>
      <circle cx="15.5" cy="8.5" r="2"/>
      <circle cx="8.5" cy="15.5" r="2"/>
      <circle cx="15.5" cy="15.5" r="2.5"/>
    </svg>
  )
}

export function WineCoolerIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="5" y="2.5" width="14" height="19" rx="2"/>
      <path d="M5 7h14M5 11.5h14M5 16h14"/>
      <circle cx="9" cy="9.2" r="0.9" fill={color} stroke="none"/>
      <circle cx="12" cy="9.2" r="0.9" fill={color} stroke="none"/>
      <circle cx="9" cy="13.7" r="0.9" fill={color} stroke="none"/>
      <circle cx="15" cy="13.7" r="0.9" fill={color} stroke="none"/>
    </svg>
  )
}

export function MicrowaveIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="2.5" y="6" width="19" height="12" rx="2"/>
      <rect x="5.5" y="9" width="9" height="6" rx="1"/>
      <path d="M17.5 9v2M17.5 14h.01"/>
    </svg>
  )
}

// keyword → icon for appliance platforms; matches EN/PL/DE label fragments
const APPLIANCE_MATCHERS = [
  [/dishwash|zmywark|geschirr|spül/i,                DishwasherIcon],
  [/washer.?dryer|pralko.?susz/i,                    WashingMachineIcon],
  [/wash|pralk|wasch/i,                              WashingMachineIcon],
  [/dry|susz|trockner/i,                             DryerIcon],
  [/microwave|mikrofal|mikrowelle/i,                 MicrowaveIcon],
  [/oven|piekarnik|backofen|steam/i,                 OvenIcon],
  [/coffee|espresso|ekspres|kaffee/i,                CoffeeMakerIcon],
  [/wine|wino|wein/i,                                WineCoolerIcon],
  [/fridge|freez|refriger|lodówk|lodowk|zamrażar|kühl|cool/i, FridgeIcon],
  [/hood|okap|dunst/i,                               HoodIcon],
  [/hob|płyt|plyt|induction|kochfeld/i,              HobIcon],
  [/robot|vacuum|odkurzacz|saug/i,                   RobotVacuumIcon],
]

function applianceIcon(label = '') {
  for (const [re, Icon] of APPLIANCE_MATCHERS) if (re.test(label)) return Icon
  return null
}

export function VenetianIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1.5"/>
      <path d="M4 7h16M4 11h16M4 15h16"/>
      <circle cx="12" cy="18.2" r="1" fill={color} stroke="none"/>
    </svg>
  )
}

export function AwningIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18"/>
      <path d="M3 6l2 6h14l2-6"/>
      <path d="M5 12v6M19 12v6"/>
      <path d="M8 12c0 1.2 1 2 2 2s2-.8 2-2c0 1.2 1 2 2 2s2-.8 2-2"/>
    </svg>
  )
}

// Named SVG icons pickable as a device icon (stored as customIcon "svg:<name>").
// Keys are persisted in device overrides — never rename, only add.
export const NAMED_ICONS = {
  bulb: BulbIcon,
  ceiling: CeilingLightIcon,
  pendant: PendantLightIcon,
  chandelier: ChandelierIcon,
  spot: SpotlightIcon,
  led: LedStripIcon,
  sconce: WallSconceIcon,
  'floor-lamp': FloorLampIcon,
  'desk-lamp': DeskLampIcon,
  dimmer: DimmerIcon,
}

export function resolveIcon(device) {
  // User-chosen override (set via the dashboard edit panel): either a named
  // SVG icon ("svg:<name>") or an emoji
  if (device.customIcon) {
    if (device.customIcon.startsWith('svg:')) {
      return NAMED_ICONS[device.customIcon.slice(4)] || HomeIcon
    }
    const emoji = device.customIcon
    const EmojiIcon = ({ size = 24 }) => (
      <span style={{ fontSize: Math.round(size * 0.86), lineHeight: 1, display: 'inline-block' }}>{emoji}</span>
    )
    return EmojiIcon
  }

  const custom = LABEL_MAP[device.label?.toLowerCase()]
  if (custom) return custom

  // Per-device specifics — kind and role, not just integration type
  if (device.type === 'satel') {
    const key = device.key || ''
    if (key.includes('/partition/')) return ShieldIcon
    if (key.includes('/output/'))    return RelayOutputIcon
    const hk = device.homekit || []
    if (hk.includes('motion'))  return MotionIcon
    if (hk.includes('contact')) return DoorIcon
    return SensorIcon
  }
  if (device.type === 'somfy') {
    // TaHoma lights / on-off modules register with a 'light' capability
    if ((device.sensors || []).some((s) => s.capabilityId === 'light')) return BulbIcon
    const l = (device.label || '').toLowerCase()
    if (/żaluzj|zaluzj|venetian|blind/.test(l))       return VenetianIcon
    if (/żagiel|zagiel|awning|screen|markiz/.test(l)) return AwningIcon
    return ShutterIcon
  }
  // appliance platforms: pick the icon from what the appliance is
  if (device.type === 'homeconnect' || device.type === 'miele' || device.type === 'lgthinq') {
    const a = applianceIcon(device.label)
    if (a) return a
  }

  return TYPE_MAP[device.type]
      || readingIcon(device.readings)
      || HomeIcon
}

export function ChartIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18"/><path d="m7 14 4-5 3 3 5-7"/>
    </svg>
  )
}

export function PlanIcon({ color = 'currentColor', size = 24 }) {
  return (
    <svg {...s(color, size)}>
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M3 12h8M11 3v9M11 12v9M16 12v4M11 16h10"/>
    </svg>
  )
}

export const CAT_ICON_COMPONENT = {
  All:      HomeIcon,
  Victron:  GridPowerIcon,
  Lighting: BulbIcon,
  Switches: SwitchOutletIcon,
  Climate:  ThermometerIcon,
  Media:    SpeakerIcon,
  Security: SecurityIcon,
  Sensors:  SensorIcon,
  Other:    RouterIcon,
  Plan:     PlanIcon,
  Graphs:   ChartIcon,
}
