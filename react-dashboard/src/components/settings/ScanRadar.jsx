import { useState } from 'react'
import {
  PlugIcon, BulbIcon, SpeakerIcon, CameraIcon, BatteryIcon, RouterIcon, HomeIcon, ThermometerIcon,
  WashingMachineIcon, SecurityIcon, PhoneIcon, MonitorIcon, LedStripIcon,
} from '../Icons'

// Shared graphics for the scan tools (Settings → LAN scan, Bluetooth scan):
// the SVG radar in the hero and the line icons on the result tiles.

const R = 90 // radius of the radar field, in viewBox units
const SWEEP = Array.from({ length: 14 }, (_, k) => {
  const a1 = (-(k + 1) * 5 * Math.PI) / 180
  const a2 = (-k * 5 * Math.PI) / 180
  const p = (a) => `${(Math.cos(a) * R).toFixed(2)},${(Math.sin(a) * R).toFixed(2)}`
  return { d: `M0,0 L${p(a1)} A${R},${R} 0 0 1 ${p(a2)} Z`, o: 0.42 * (1 - k / 14) ** 1.7 }
})

// blips: [{ key, angle (rad), r (0–1 of the field), color, label, sub, self }]
// rings: [{ r (0–1), label }] — what the distance from the centre means
// mix:   [{ color, n, label }] — drawn as the outer ring
export default function ScanRadar({ blips = [], rings = [], mix = [], scanning = false, core = 'lan', selected, onPick }) {
  const [hover, setHover] = useState(null)
  const period = scanning ? 1.4 : 4.5
  const total = mix.reduce((a, m) => a + m.n, 0)
  let start = 0
  const tip = hover != null ? blips.find((b) => b.key === hover) : null
  return (
    <div className={`scan-radar${scanning ? ' scanning' : ''}`} style={{ '--T': `${period}s` }}>
      {/* the sweep and the blips restart together, so each blip flashes as the beam passes it */}
      <svg viewBox="-110 -110 220 220" key={`${scanning}-${blips.length}`} role="img" aria-hidden={!onPick}>
        <defs>
          <radialGradient id={`scan-bg-${core}`}>
            <stop offset="0" stopColor="var(--lan)" stopOpacity="0.30"/>
            <stop offset="0.6" stopColor="var(--lan)" stopOpacity="0.10"/>
            <stop offset="1" stopColor="var(--lan)" stopOpacity="0.03"/>
          </radialGradient>
        </defs>
        <circle r={R} fill={`url(#scan-bg-${core})`}/>
        <circle r="97" className="scan-ticks" pathLength="360"/>
        <circle r="97" className="scan-ticks major" pathLength="360"/>
        {total > 0
          ? mix.map((m) => {
              const len = (m.n / total) * 100
              const seg = <circle key={m.label} r="105" className="scan-mix" pathLength="100" stroke={m.color}
                strokeDasharray={`${Math.max(0.6, len - 1.2)} ${100 - Math.max(0.6, len - 1.2)}`} strokeDashoffset={-start - 0.6}><title>{`${m.label}: ${m.n}`}</title></circle>
              start += len
              return seg
            })
          : <circle r="105" className="scan-mix idle"/>}
        <circle r={R} className="scan-rim"/>
        {rings.map((g) => <circle key={g.r} r={g.r * R} className="scan-ring"/>)}
        <path className="scan-cross" d={`M${-R},0H${R}M0,${-R}V${R}`}/>
        <g className="scan-sweep">
          {SWEEP.map((s, k) => <path key={k} d={s.d} fill="var(--lan)" opacity={s.o}/>)}
          <line x2={R} className="scan-beam"/>
        </g>
        {rings.map((g) => g.label && (
          <text key={g.r} className="scan-ring-label" x="3" y={-g.r * R - 2.5}>{g.label}</text>
        ))}
        {scanning && <><circle r="20" className="scan-ping"/><circle r="20" className="scan-ping late"/></>}
        {blips.map((b) => {
          const x = Math.cos(b.angle) * b.r * R
          const y = Math.sin(b.angle) * b.r * R
          const turn = ((b.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)
          return (
            <g key={b.key} className={`scan-blip${b.self ? ' self' : ''}${selected === b.key ? ' sel' : ''}${onPick ? ' pick' : ''}`}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} style={{ color: b.color, '--d': turn.toFixed(3) }}
              onMouseEnter={() => setHover(b.key)} onMouseLeave={() => setHover(null)}
              onClick={onPick ? () => onPick(b.key) : undefined}>
              <circle r="9" className="scan-blip-hit"/>
              <circle r="4" className="scan-blip-halo"/>
              {(b.self || selected === b.key) && <circle r="6.5" className="scan-blip-ring"/>}
              <circle r="3.4" className="scan-blip-dot"/>
            </g>
          )
        })}
        <circle r="17" className="scan-core-glow"/>
        <circle r="13" className="scan-core"/>
        <g className="scan-core-icon" transform="translate(-9 -9) scale(0.75)">
          {core === 'ble'
            ? <path d="M7 7l10 10-5 5V2l5 5L7 17"/>
            : <><path d="M12 20h.01"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M1.6 9.3a15 15 0 0 1 20.8 0"/></>}
        </g>
      </svg>
      {tip && (
        <div className="scan-tip" style={{ left: `${50 + (Math.cos(tip.angle) * tip.r * R) / 2.2}%`, top: `${50 + (Math.sin(tip.angle) * tip.r * R) / 2.2}%` }}>
          <b>{tip.label}</b>{tip.sub && <span>{tip.sub}</span>}
        </div>
      )}
    </div>
  )
}

// ── Line icons ──────────────────────────────────────────────────────────────
const svg = (size) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' })
const mk = (children) => function Icon({ size = 24 }) { return <svg {...svg(size)}>{children}</svg> }

const ChipIcon = mk(<><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4" rx="0.5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></>)
const MusicIcon = mk(<><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></>)
const NodesIcon = mk(<><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.8 7.2 6.3 15.8M13.2 7.2l4.5 8.6M7.5 18h9"/></>)
const FlowIcon = mk(<><rect x="2" y="4" width="7" height="5" rx="1.5"/><rect x="15" y="15" width="7" height="5" rx="1.5"/><path d="M9 6.5h1.5a2 2 0 0 1 2 2v7a2 2 0 0 0 2 2H15"/></>)
const MessageIcon = mk(<><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/></>)
const LinkIcon = mk(<><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></>)
const PrinterIcon = mk(<><path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/></>)
const GlobeIcon = mk(<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>)
const QuestionIcon = mk(<><circle cx="12" cy="12" r="9"/><path d="M9.3 9.2a2.8 2.8 0 1 1 4.2 2.5c-.9.5-1.5 1.1-1.5 2.1M12 17h.01"/></>)
const VacuumIcon = mk(<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M17 6.5h.01"/></>)
const WatchIcon = mk(<><rect x="7" y="7" width="10" height="10" rx="3"/><path d="M9 7 9.6 3h4.8L15 7M9 17l.6 4h4.8l.6-4M12 10.5V12l1 1"/></>)
const LaptopIcon = mk(<><rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/></>)
const HubIcon = mk(<><rect x="3" y="8" width="18" height="9" rx="3"/><path d="M7 12.5h.01M11 12.5h.01M15 12.5h3M8 17v2M16 17v2"/></>)
const BluetoothIcon = mk(<path d="M7 7l10 10-5 5V2l5 5L7 17"/>)
const use = (C) => function Icon({ size = 24 }) { return <C size={size} color="currentColor"/> }

const KIND = {
  shelly: use(PlugIcon), iot: use(PlugIcon), hue: use(BulbIcon), wled: use(LedStripIcon), sonos: use(SpeakerIcon),
  esphome: ChipIcon, esp: ChipIcon, loxone: HubIcon, fibaro: HubIcon, homeassistant: HubIcon, homey: HubIcon, lsh: use(HomeIcon),
  cast: use(MonitorIcon), androidtv: use(MonitorIcon), samsung: use(MonitorIcon), airplay: MusicIcon, homekit: use(HomeIcon),
  matter: NodesIcon, nodered: FlowIcon, mqtt: MessageIcon, knx: LinkIcon, modbus: LinkIcon, camera: use(CameraIcon),
  printer: PrinterIcon, victron: use(BatteryIcon), apple: LaptopIcon, network: use(RouterIcon), web: GlobeIcon,
  climate: use(ThermometerIcon), appliance: use(WashingMachineIcon), vacuum: VacuumIcon, alarm: use(SecurityIcon),
  // Bluetooth groups
  personal: WatchIcon, phone: use(PhoneIcon), home: use(HomeIcon), chip: ChipIcon, other: BluetoothIcon,
}

export function KindIcon({ kind, size = 24 }) {
  const C = KIND[kind] || QuestionIcon
  return <C size={size}/>
}

export const ScanIcon = ({ spin }) => (
  <svg className={`scan-btn-icon${spin ? ' spin' : ''}`} {...svg(17)} strokeWidth="2.2"><path d="M12 12 19 5"/><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7.5A4.5 4.5 0 1 0 16.5 12"/></svg>
)

// The scan buttons' phrases start with an emoji ("🛰 Scan network"); the button draws its own icon instead.
export const plain = (s) => String(s).replace(/^[^\p{L}\p{N}]+/u, '')
