import { useEffect, useRef, useState } from 'react'
import { resolveIcon, CAT_ICON_COMPONENT } from './Icons'
import { gt } from '../i18n'
import { EDIT_EMOJI } from '../emoji'

// Isometric home plan — rooms from config.homePlan (Settings → Home Plan),
// falling back to an automatic grid of the rooms assigned to devices.
// Pure CSS 3D: the board is tilted, labels and device chips are
// counter-rotated ("billboarded") so they stay upright and readable.

const CELL = 83 // px per grid unit (at zoom 1)

// American floor notation; localized via gt() (pl: piwnica / parter / pierwsze piętro)
const FLOOR_ORDER = ['cellar', 'floor1', 'floor2']
const FLOOR_FALLBACK = { cellar: 'Cellar', floor1: '1st Floor', floor2: '2nd Floor' }
const floorOf = (r) => r.floor || 'floor1'

// ── Decorative furniture / appliances, generated per room ──
// Deterministic pseudo-random: seeded by room name, so every render (and
// every client) shows the same arrangement without any persistence.
const ROOM_THEMES = [
  { match: /salon|living|wohn|sofa/i,        items: ['🛋', '📺', '🪴', '🧸'] },
  { match: /sypial|bed|schlaf|dormitor/i,    items: ['🛏', '🪞', '🪑'] },
  { match: /kuch|kitchen|küche|cocina/i,     items: ['🍳', '🧊', '🍽️'] },
  { match: /łazien|lazien|bath|bad|baño/i,   items: ['🛁', '🚽', '🧺'] },
  { match: /garaż|garaz|garage/i,            items: ['🚗', '🧰', '🚲'] },
  { match: /ogród|ogrod|garden|garten/i,     items: ['🌳', '🌷', '⛱'] },
  { match: /energ/i,                         items: ['🔋', '⚡', '🧯'] },
  { match: /entrance|wejści|wejsci|hall|korytarz|flur/i, items: ['🚪', '🧥', '🪞'] },
]
const GENERIC_ITEMS = ['🪑', '🪴', '🖼', '📚', '🕰️', '🧺']

const decorCache = new Map()
function roomDecorations(room) {
  const cacheKey = `${room.name}|${room.w}x${room.d}`
  const hit = decorCache.get(cacheKey)
  if (hit) return hit
  const items = computeDecorations(room)
  decorCache.set(cacheKey, items)
  return items
}

function computeDecorations(room) {
  let h = 2166136261
  for (const c of room.name) h = (h ^ c.charCodeAt(0)) * 16777619 >>> 0
  const rand = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 2 ** 32 }
  const theme = ROOM_THEMES.find((t) => t.match.test(room.name))
  const pool = theme ? theme.items : GENERIC_ITEMS
  const count = Math.min(pool.length, 2 + Math.floor(rand() * 2) + Math.floor(room.w * room.d / 20))
  const items = []
  for (let i = 0; i < count; i++) {
    items.push({
      emoji: pool[Math.floor(rand() * pool.length)],
      x: 0.12 + rand() * 0.74,
      y: 0.28 + rand() * 0.6,
    })
  }
  return items
}

const isOn = (d) => {
  const v = d.readings?.switch?.value
  return v === 1 || v === true || v === 'on'
}

// Persist a dragged chip position ({planX, planY} fractions), PIN-gated
async function saveChipPos(deviceKey, x, y) {
  return saveChipPlacement(deviceKey, { planX: x, planY: y })
}

async function saveChipPlacement(deviceKey, patch) {
  let pin = sessionStorage.getItem('lsh-edit-pin') || ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`/api/device/${encodeURIComponent(deviceKey)}/customize`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, pin }),
    })
    if (res.status === 403) {
      const entered = window.prompt(gt('pin_prompt', 'Enter edit PIN'))
      if (entered == null) return false
      pin = entered.trim()
      sessionStorage.setItem('lsh-edit-pin', pin)
      continue
    }
    const d = await res.json().catch(() => ({}))
    return !!d.success
  }
  return false
}

// Manually placed furniture item — draggable, removable on hover
function DecorItem({ item, board, U, angle, mode3d, zoomScale = 1, onMove, onRemove }) {
  const [livePos, setLivePos] = useState(null)
  const drag = useRef(null)
  const x = livePos?.x ?? item.x
  const y = livePos?.y ?? item.y

  const onPointerDown = (e) => {
    if (e.target.closest('.plan-decor-x')) return
    e.preventDefault(); e.stopPropagation()
    drag.current = { sx: e.clientX, sy: e.clientY, x, y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dxs = (e.clientX - d.sx) / zoomScale
    const dys = (e.clientY - d.sy) / zoomScale
    if (!d.moved && Math.abs(dxs) + Math.abs(dys) < 5) return
    d.moved = true
    const rz = (angle * Math.PI) / 180
    const b = dys / (mode3d ? Math.cos((55 * Math.PI) / 180) : 1)
    const dx = dxs * Math.cos(rz) + b * Math.sin(rz)
    const dy = -dxs * Math.sin(rz) + b * Math.cos(rz)
    setLivePos({
      x: Math.min(0.97, Math.max(0.03, d.x + dx / (board.w * U))),
      y: Math.min(0.97, Math.max(0.03, d.y + dy / (board.d * U))),
    })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) { setLivePos(null); return }
    const p = livePos
    if (p) onMove(item.id, p.x, p.y)
    setLivePos(null)
  }

  return (
    <div className="plan-chip-pos plan-decor" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setLivePos(null) }}>
      <div className="plan-bill">
        <span className="plan-furn">{item.emoji}</span>
        <button className="plan-decor-x" onClick={() => onRemove(item.id)}>✕</button>
      </div>
    </div>
  )
}

// ── Camera field-of-view cone ──
// Rendered flat on the floor plane (not billboarded) under a camera chip.
// Direction/range live in plan space (camAngle deg, 0 = plan north, clockwise;
// camRange in grid cells) so the cone stays glued to the layout under any
// board rotation. Dragging the handle at the cone tip sets both at once.
const CAM_ICONS = ['📷', '📹', '🎥']
const isCamera = (d) =>
  d.camRange != null || d.camAngle != null || d.type === 'unifi' || CAM_ICONS.includes(d.customIcon)

function CamCone({ device, U, angle, mode3d, zoomScale = 1 }) {
  const [live, setLive] = useState(null)
  const drag = useRef(null)

  const dir   = live?.dir   ?? device.camAngle ?? 0
  const range = live?.range ?? device.camRange ?? 2.2
  const fov   = Math.min(170, Math.max(20, device.camFov ?? 70))
  const R     = range * U
  const rad   = (deg) => (deg * Math.PI) / 180
  const pt    = (deg, r) => [r * Math.sin(rad(deg)), -r * Math.cos(rad(deg))]
  const [x0, y0] = pt(dir - fov / 2, R)
  const [x1, y1] = pt(dir + fov / 2, R)
  const [hx, hy] = pt(dir, R)
  const gid = 'camg-' + device.key.replace(/[^a-zA-Z0-9]/g, '_')

  const onPointerDown = (e) => {
    e.preventDefault(); e.stopPropagation()
    drag.current = { sx: e.clientX, sy: e.clientY, hx, hy }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    // screen deltas → plan deltas: undo focus zoom, board rotation, tilt
    const dxs = (e.clientX - d.sx) / zoomScale
    const dys = (e.clientY - d.sy) / zoomScale
    const rz = rad(angle)
    const b = dys / (mode3d ? Math.cos(rad(55)) : 1)
    const dx = dxs * Math.cos(rz) + b * Math.sin(rz)
    const dy = -dxs * Math.sin(rz) + b * Math.cos(rz)
    const vx = d.hx + dx
    const vy = d.hy + dy
    const newDir = ((Math.atan2(vx, -vy) * 180) / Math.PI + 360) % 360
    const newRange = Math.min(12, Math.max(0.5, Math.hypot(vx, vy) / U))
    setLive({ dir: newDir, range: newRange })
  }
  const onPointerUp = async () => {
    if (!drag.current) return
    drag.current = null
    const p = live
    if (p) {
      const ok = await saveChipPlacement(device.key, {
        camAngle: +p.dir.toFixed(1),
        camRange: +p.range.toFixed(2),
      })
      if (ok) setLive(null)   // server broadcast takes over
    }
  }

  const pad = 12
  return (
    <svg className="plan-cam-cone"
      width={2 * (R + pad)} height={2 * (R + pad)}
      viewBox={`${-(R + pad)} ${-(R + pad)} ${2 * (R + pad)} ${2 * (R + pad)}`}
      style={{ position: 'absolute', left: `calc(50% - ${R + pad}px)`, top: `calc(50% - ${R + pad}px)` }}>
      <defs>
        <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx="0" cy="0" r={R}>
          <stop offset="0%"   stopColor="var(--accent)" stopOpacity="0.34"/>
          <stop offset="55%"  stopColor="var(--accent)" stopOpacity="0.16"/>
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03"/>
        </radialGradient>
      </defs>
      <path d={`M0,0 L${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} Z`}
        fill={`url(#${gid})`} stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.2"/>
      <line x1="0" y1="0" x2={hx} y2={hy} stroke="var(--accent)" strokeOpacity="0.3"
        strokeWidth="1" strokeDasharray="3 5"/>
      <circle className="plan-cam-handle" cx={hx} cy={hy} r="7"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setLive(null) }}/>
    </svg>
  )
}

// Device chip, absolutely positioned inside its room and draggable.
// Screen-space pointer deltas are mapped back into plan space by inverting
// the board rotation (rotateZ) and tilt (rotateX foreshortening).
// Dragging is clamped to the board, not the room, so a chip can roam the
// whole floor plan; the parent's onDropPos decides where it is persisted.
function PositionedChip({ device, room, origin = { x: 0, y: 0 }, board, U, angle, mode3d, zoomScale = 1, defaultPos, onOpen, onDropPos }) {
  const [livePos, setLivePos] = useState(null)
  const drag = useRef(null)

  const x = livePos?.x ?? device.planX ?? defaultPos.x
  const y = livePos?.y ?? device.planY ?? defaultPos.y
  const on = isOn(device)
  const IconComp = device.customIcon ? null : resolveIcon(device)

  const onPointerDown = (e) => {
    e.preventDefault(); e.stopPropagation()
    drag.current = { sx: e.clientX, sy: e.clientY, x, y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dxs = (e.clientX - d.sx) / zoomScale
    const dys = (e.clientY - d.sy) / zoomScale
    if (!d.moved && Math.abs(dxs) + Math.abs(dys) < 5) return
    d.moved = true
    const rz = (angle * Math.PI) / 180
    const b = dys / (mode3d ? Math.cos((55 * Math.PI) / 180) : 1) // undo tilt foreshortening
    const dx = dxs * Math.cos(rz) + b * Math.sin(rz)              // undo board rotation
    const dy = -dxs * Math.sin(rz) + b * Math.cos(rz)
    const bw = board?.w ?? room.w
    const bd = board?.d ?? room.d
    // clamp in board space, then map back to room-relative for rendering
    const bx = Math.min(0.98, Math.max(0.02, (origin.x + (d.x + dx / (room.w * U)) * room.w) / bw))
    const by = Math.min(0.98, Math.max(0.02, (origin.y + (d.y + dy / (room.d * U)) * room.d) / bd))
    setLivePos({ x: (bx * bw - origin.x) / room.w, y: (by * bd - origin.y) / room.d })
  }
  const onPointerUp = async () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) { setLivePos(null); onOpen?.(device.key); return }
    const p = livePos
    if (p) {
      const bw = board?.w ?? room.w
      const bd = board?.d ?? room.d
      const ok = onDropPos
        ? await onDropPos((origin.x + p.x * room.w) / bw, (origin.y + p.y * room.d) / bd, p)
        : await saveChipPos(device.key, p.x, p.y)
      if (ok) setLivePos(null) // server broadcast takes over
    }
  }

  return (
    <div className="plan-chip-pos" style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; setLivePos(null) }}>
      {isCamera(device) && (
        <CamCone device={device} U={U} angle={angle} mode3d={mode3d} zoomScale={zoomScale}/>
      )}
      <div className="plan-bill">
        <div className="plan-chip" data-on={String(on)} title={device.label} role="button">
          {device.customIcon
            ? <span style={{ fontSize: 28, lineHeight: 1 }}>{device.customIcon}</span>
            : <IconComp size={28} color={on ? 'var(--tile-on-ink)' : 'var(--text2)'}/>}
        </div>
      </div>
    </div>
  )
}

export default function HomePlan({ devices, roomsMeta = {}, groupOf, onOpen }) {
  const [plan, setPlan] = useState(null)
  const [filter, setFilter] = useState(null) // device category, null = all
  const [floor, setFloor] = useState(() => localStorage.getItem('planFloor') || 'floor1')
  const [showAdd, setShowAdd] = useState(false)
  const [showFurniture, setShowFurniture] = useState(() => localStorage.getItem('planFurniture') !== '0')
  const [showAppliances, setShowAppliances] = useState(() => localStorage.getItem('planAppliances') !== '0')
  const toggleLayer = (key, setter) => setter((v) => {
    localStorage.setItem(key, v ? '0' : '1')
    return !v
  })
  const [zoom, setZoom] = useState(() => {
    const z = Number(localStorage.getItem('planZoom'))
    return z >= 0.5 && z <= 2.2 ? z : 1
  })
  const zoomBy = (f) => setZoom((z) => {
    const next = Math.min(2.2, Math.max(0.5, +(z * f).toFixed(2)))
    localStorage.setItem('planZoom', String(next))
    return next
  })
  const [angle, setAngle] = useState(() => {
    const a = Number(localStorage.getItem('planAngle'))
    return Number.isFinite(a) && a !== 0 ? a : -45
  })
  const [mode3d, setMode3d] = useState(() => localStorage.getItem('plan3d') !== '0')

  const rotate = (dir) => setAngle((a) => {
    const next = a + dir * 90
    localStorage.setItem('planAngle', String(next))
    return next
  })
  const toggle3d = () => setMode3d((m) => {
    localStorage.setItem('plan3d', m ? '0' : '1')
    return !m
  })

  // ── Room focus-zoom: click a room to fill the viewport with it ──
  // Rects are measured in screen space (so the 3D tilt/rotation is accounted
  // for) while un-zoomed, cached, and turned into a translate+scale on the
  // stage. Clicking the focused room again, Esc, or the back pill zooms out.
  const viewportRef = useRef(null)
  const stageRef    = useRef(null)
  const roomRefs    = useRef({})
  const rectCache   = useRef(null)
  const [focusRoom, setFocusRoom] = useState(null)
  const [focusT, setFocusT]       = useState(null)
  const unfocus = () => { setFocusRoom(null); setFocusT(null); rectCache.current = null }

  const focusOnRoom = (name) => {
    if (focusRoom === name) return unfocus()
    let c = rectCache.current
    if (!focusRoom || !c) {
      if (!viewportRef.current || !stageRef.current) return
      const rooms = {}
      for (const [n, el] of Object.entries(roomRefs.current)) {
        if (el) rooms[n] = el.getBoundingClientRect()
      }
      c = rectCache.current = {
        vp: viewportRef.current.getBoundingClientRect(),
        st: stageRef.current.getBoundingClientRect(),
        rooms,
      }
    }
    const r = c.rooms[name]
    if (!r || !r.width) return
    const s = Math.min(3.5, Math.max(1.15,
      Math.min((c.vp.width * 0.86) / r.width, (c.vp.height * 0.86) / r.height)))
    const scx = c.st.left + c.st.width / 2,  scy = c.st.top + c.st.height / 2
    const vcx = c.vp.left + c.vp.width / 2,  vcy = c.vp.top + c.vp.height / 2
    const rcx = r.left + r.width / 2,        rcy = r.top + r.height / 2
    setFocusT({ x: vcx - scx - s * (rcx - scx), y: vcy - scy - s * (rcy - scy), s })
    setFocusRoom(name)
  }

  useEffect(() => {           // any view change invalidates the measured rects
    unfocus()
  }, [floor, angle, mode3d, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusRoom) return
    const onKey = (e) => { if (e.key === 'Escape') unfocus() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusRoom]) // eslint-disable-line react-hooks/exhaustive-deps

  const [decor, setDecor] = useState({})
  useEffect(() => {
    fetch('/api/home-plan', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setPlan(d.plan || { rooms: [] }))
      .catch(() => setPlan({ rooms: [] }))
    fetch('/api/plan-decor', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setDecor(d.decor || {}))
      .catch(() => {})
  }, [])

  const decorOp = async (body) => {
    let pin = sessionStorage.getItem('lsh-edit-pin') || ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch('/api/plan-decor', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, pin }),
      })
      if (res.status === 403) {
        const entered = window.prompt(gt('pin_prompt', 'Enter edit PIN'))
        if (entered == null) return
        pin = entered.trim()
        sessionStorage.setItem('lsh-edit-pin', pin)
        continue
      }
      const d = await res.json().catch(() => ({}))
      if (d.success) setDecor(d.decor || {})
      return
    }
  }

  if (!plan) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text3)', fontSize: 13 }}>…</div>
  }

  let rooms = plan.rooms || []
  // No configured plan → auto-arrange the rooms devices are assigned to
  if (!rooms.length) {
    const names = [...new Set(devices.map((d) => d.room).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    rooms = names.map((name, i) => ({ name, x: (i % 3) * 5, y: Math.floor(i / 3) * 4.5, w: 4.5, d: 4 }))
  }

  if (!rooms.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', color: 'var(--text3)', fontSize: 13, lineHeight: 1.6 }}>
          {gt('plan_hint', 'Assign rooms to your devices (open a device → ✎), then optionally arrange them in Settings → Home Plan.')}
        </div>
      </div>
    )
  }

  const floorCfgs = plan.floors || {}
  let floors = FLOOR_ORDER.filter((f) => rooms.some((r) => floorOf(r) === f) || floorCfgs[f])
  // Single-picture homes: pin to the one floor that has content, no switcher
  if (plan.singleFloor && floors.length) {
    const main = FLOOR_ORDER.find((f) => floorCfgs[f]?.image) || floors[0]
    floors = [main]
  }
  const activeFloor = floors.includes(floor) ? floor : (floors.includes('floor1') ? 'floor1' : floors[0] || 'floor1')
  const floorRooms = rooms.filter((r) => floorOf(r) === activeFloor)
  const floorCfg = floorCfgs[activeFloor]

  const maxX = floorCfg ? floorCfg.w : Math.max(1, ...floorRooms.map((r) => r.x + r.w))
  const maxY = floorCfg ? floorCfg.h : Math.max(1, ...floorRooms.map((r) => r.y + r.d))
  const U = CELL * zoom

  // Devices placed directly on this floor's board (image mode)
  const freeDevs = devices.filter((d) => d.planFloor === activeFloor)
  const boardRoom = { name: '__board', w: maxX, d: maxY }
  const placeDevice = async (key) => {
    // stagger new placements so consecutive adds don't pile up on one spot
    const n = freeDevs.length
    await saveChipPlacement(key, {
      planFloor: activeFloor,
      planX: Math.min(0.92, 0.5 + (n % 6) * 0.05),
      planY: Math.min(0.92, 0.5 + Math.floor(n / 6) * 0.06),
    })
  }
  const unplaceDevice = async (key) => {
    await saveChipPlacement(key, { planFloor: '' })
  }

  // Chip dragged from inside a room: dropped within it → keep the room-relative
  // spot; dragged beyond it → promote to a free board placement on this floor.
  const dropRoomChip = (device, p, bx, by) => {
    if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
      return saveChipPlacement(device.key, { planX: p.x, planY: p.y })
    }
    return saveChipPlacement(device.key, { planFloor: activeFloor, planX: bx, planY: by })
  }
  // Board-level chip dropped back inside its assigned room → return it there.
  const dropBoardChip = (device, bx, by) => {
    const home = floorRooms.find((r) => r.name === device.room)
    if (home) {
      const rx = (bx * maxX - home.x) / home.w
      const ry = (by * maxY - home.y) / home.d
      if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) {
        return saveChipPlacement(device.key, { planFloor: '', planX: rx, planY: ry })
      }
    }
    return saveChipPlacement(device.key, { planX: bx, planY: by })
  }

  // Category filter — only categories that exist among room-assigned devices
  const roomDevices = devices.filter((d) => d.room)
  const cats = groupOf
    ? [...new Set(roomDevices.map(groupOf))].sort()
    : []
  const matches = (d) => !filter || (groupOf && groupOf(d) === filter)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="plan-filter-bar">
        {floors.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginRight: 10 }}>
            {floors.map((f) => (
              <button key={f} className="plan-filter-pill" data-active={String(activeFloor === f)}
                onClick={() => { setFloor(f); localStorage.setItem('planFloor', f) }}>
                {gt('floor_' + f, FLOOR_FALLBACK[f])}
              </button>
            ))}
          </div>
        )}
        {cats.length > 1 && (
          <>
            <button className="plan-filter-pill" data-active={String(filter == null)}
              onClick={() => setFilter(null)}>
              {gt('cat_all', 'All')}
            </button>
            {cats.map((c) => {
              const Icon = CAT_ICON_COMPONENT[c]
              return (
                <button key={c} className="plan-filter-pill" data-active={String(filter === c)}
                  onClick={() => setFilter(filter === c ? null : c)}>
                  {Icon && <Icon size={13} color="currentColor"/>}
                  {gt('cat_' + c.toLowerCase(), c)}
                </button>
              )
            })}
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, position: 'relative' }}>
          <button className="plan-filter-pill" data-active={String(showAdd)}
            onClick={() => setShowAdd((v) => !v)}>
            ＋ {gt('add_device', 'Add device')}
          </button>
          {showAdd && (
            <div className="plan-add-panel" onClick={(e) => e.stopPropagation()}>
              {freeDevs.length > 0 && (
                <>
                  <div className="plan-add-head">{gt('on_this_floor', 'On this floor')}</div>
                  {freeDevs.map((d) => (
                    <div key={d.key} className="plan-add-row">
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.customIcon || ''} {d.label}</span>
                      <button className="plan-add-x" title={gt('remove', 'Remove')}
                        onClick={() => unplaceDevice(d.key)}>✕</button>
                    </div>
                  ))}
                </>
              )}
              <div className="plan-add-head">{gt('furniture', 'Furniture')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '0 4px 6px' }}>
                {EDIT_EMOJI.map((e) => (
                  <button key={e} className="plan-add-emoji"
                    onClick={() => { decorOp({ op: 'add', floor: activeFloor, emoji: e }); setShowAdd(false) }}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="plan-add-head">{gt('add_device', 'Add device')}</div>
              <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                {devices
                  .filter((d) => d.planFloor !== activeFloor)
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((d) => (
                    <div key={d.key} className="plan-add-row plan-add-clickable"
                      onClick={() => { placeDevice(d.key); setShowAdd(false) }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.customIcon || ''} {d.label}</span>
                      <span style={{ color: 'var(--text3)', fontSize: 10 }}>{d.room || d.type}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
          <button className="plan-filter-pill" data-active={String(showFurniture)}
            onClick={() => toggleLayer('planFurniture', setShowFurniture)}>
            🪑 {gt('furniture', 'Furniture')}
          </button>
          <button className="plan-filter-pill" data-active={String(showAppliances)}
            onClick={() => toggleLayer('planAppliances', setShowAppliances)}>
            🔌 {gt('appliances', 'Appliances')}
          </button>
          <button className="plan-filter-pill" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">−</button>
          <button className="plan-filter-pill" onClick={() => zoomBy(1.25)} title="Zoom in">+</button>
          <button className="plan-filter-pill" onClick={() => rotate(-1)} title="Rotate left">↺</button>
          <button className="plan-filter-pill" onClick={() => rotate(1)} title="Rotate right">↻</button>
          <button className="plan-filter-pill" data-active={String(mode3d)} onClick={toggle3d}
            title="Isometric / flat">3D</button>
        </div>
      </div>
      <div className="plan-viewport" ref={viewportRef}
        style={{ position: 'relative', overflow: focusRoom ? 'hidden' : undefined }}>
      {focusRoom && (
        <button className="plan-filter-pill plan-zoom-back" onClick={unfocus}>
          ⤺ {roomsMeta[focusRoom]?.icon || '🏠'} {focusRoom}
        </button>
      )}
      <div className="plan-stage" ref={stageRef} style={{
        width: maxX * U, height: maxY * U,
        transform: focusT ? `translate(${focusT.x}px, ${focusT.y}px) scale(${focusT.s})` : 'none',
        // device chips counter-scale by this so they keep their screen size
        // when a room is focus-zoomed (rooms grow, icons don't)
        '--chip-inv': focusT ? 1 / focusT.s : 1,
      }}>
        <div className="plan-board" data-3d={String(mode3d)} data-img={String(!!floorCfg?.image)}
          data-zoomed={String(!!focusRoom)} style={{
          width: maxX * U, height: maxY * U,
          '--plan-rz': `${angle}deg`, '--plan-rx': mode3d ? '55deg' : '0deg',
          ...(floorCfg?.image ? {
            backgroundImage: `url(${floorCfg.image})`,
            backgroundSize: '100% 100%',
            borderRadius: 10,
            boxShadow: 'var(--shadow-2)',
          } : {}),
        }}>
          {floorRooms.map((room) => {
            const devs = devices.filter((d) => d.room === room.name && !d.planFloor && matches(d))
            const onCount = devs.filter(isOn).length
            return (
              <div key={room.name} className="plan-room" data-active={String(onCount > 0)}
                data-zoom-target={String(focusRoom === room.name)}
                ref={(el) => { if (el) roomRefs.current[room.name] = el; else delete roomRefs.current[room.name] }}
                onClick={(e) => {
                  if (e.target.closest('.plan-chip-pos')) return   // chip clicks open the device
                  focusOnRoom(room.name)
                }}
                style={{
                  left: room.x * U, top: room.y * U,
                  width: room.w * U, height: room.d * U,
                }}>
                <div className="plan-wall plan-wall-n"/>
                <div className="plan-wall plan-wall-s"/>
                <div className="plan-wall plan-wall-w"/>
                <div className="plan-wall plan-wall-e"/>
                <div className="plan-room-label-wrap">
                  <div className="plan-room-label">
                    <span style={{ fontSize: 13 }}>{roomsMeta[room.name]?.icon || '🏠'}</span>
                    <span>{room.name}</span>
                    {onCount > 0 && <span className="plan-on-badge">{onCount}</span>}
                  </div>
                </div>
                {showFurniture && (
                  <div className="plan-furniture">
                    {roomDecorations(room).map((f, i) => (
                      <div key={i} className="plan-furn-pos" style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%` }}>
                        <div className="plan-bill"><span className="plan-furn">{f.emoji}</span></div>
                      </div>
                    ))}
                  </div>
                )}
                {showAppliances && <div className="plan-devices">
                  {devs.map((d, i) => (
                    <PositionedChip key={d.key} device={d} room={room} U={U}
                      origin={{ x: room.x, y: room.y }} board={boardRoom}
                      angle={angle} mode3d={mode3d} zoomScale={focusT?.s || 1} onOpen={onOpen}
                      onDropPos={(bx, by, p) => dropRoomChip(d, p, bx, by)}
                      defaultPos={{
                        x: Math.min(0.9, 0.14 + (i % 4) * 0.24),
                        y: Math.min(0.88, 0.32 + Math.floor(i / 4) * 0.3),
                      }}/>
                  ))}
                </div>}
              </div>
            )
          })}
          {showFurniture && (decor[activeFloor] || []).map((item) => (
            <div key={item.id} className="plan-devices">
              <DecorItem item={item} board={boardRoom} U={U} angle={angle} mode3d={mode3d}
                zoomScale={focusT?.s || 1}
                onMove={(id, x, y) => decorOp({ op: 'move', id, x, y })}
                onRemove={(id) => decorOp({ op: 'remove', id })}/>
            </div>
          ))}
          {showAppliances && (() => {
            // chips saved on the exact same spot hide each other — fan out
            // duplicates so every deployed device stays visible and clickable
            const seen = new Map()
            return freeDevs.map((d) => {
              const k = `${(d.planX ?? 0.5).toFixed(2)}|${(d.planY ?? 0.5).toFixed(2)}`
              const n = seen.get(k) || 0
              seen.set(k, n + 1)
              const dev = n === 0 ? d : {
                ...d,
                planX: Math.min(0.98, (d.planX ?? 0.5) + 0.05 * n),
                planY: Math.min(0.98, (d.planY ?? 0.5) + 0.035 * n),
              }
              return (
                <div key={d.key} className="plan-devices">
                  <PositionedChip device={dev} room={boardRoom} board={boardRoom} U={U}
                    angle={angle} mode3d={mode3d} zoomScale={focusT?.s || 1} onOpen={onOpen}
                    onDropPos={(bx, by) => dropBoardChip(d, bx, by)}
                    defaultPos={{ x: 0.5, y: 0.5 }}/>
                </div>
              )
            })
          })()}
        </div>
      </div>
      </div>
    </div>
  )
}
