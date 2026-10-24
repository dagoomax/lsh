import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, ContactShadows, Html } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import * as THREE from 'three'
import { gt } from '../i18n'
import { MODEL_CATS, CAT_COLOR, extractSlots, assignDevices, isOn, stateText } from '../planModelDevices'

// Renders the user-imported floor-plan model (GLB or OBJ, uploaded from
// HomePlan's toolbar — see /api/plan-model/*) — in HomePlan as an alternative
// to the drawn board, and on the home view (HomeModel3D).
//
// Made to look like an architectural render rather than a grey mesh:
// filmic tone mapping, a studio environment for soft light and reflections
// (three's RoomEnvironment — generated locally, nothing fetched), a low sun
// with soft shadows, a contact shadow under the building, glowing bulbs and
// see-through glass. An OBJ without materials gets plaster walls.
//
// Camera presets fly to iso / top / front / side views around the model's
// bounding box; the section cut clips the model with a vertical plane (half
// by default) so the rooms can be seen from the side. Both are remembered.
// scale/rotation still come from HomePlan's alignment controls, for exports
// with another up-axis or facing.

const VIEWS = {
  iso:   [1, 0.85, 1],
  top:   [0, 1, 0.02], // a hair off vertical so north stays up (straight down has no defined heading)
  front: [0, 0.4, 1],
  side:  [1, 0.4, 0],
}
const load = (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

const PLASTER = new THREE.MeshStandardMaterial({ color: '#ebe6dc', roughness: 0.85, metalness: 0 })

// Shadows, glass, bulbs and markers; OBJ meshes without a material get plaster
function prepare(root, isObj) {
  root.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const out = mats.map((m) => {
      if (isObj && (!m || m.type === 'MeshPhongMaterial' && !m.map && m.color?.getHex() === 0xffffff)) return PLASTER.clone()
      const mm = m?.clone ? m.clone() : m
      const name = String(mm?.name || '').toLowerCase()
      if (name.startsWith('glass')) {
        Object.assign(mm, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false })
        o.castShadow = false
      } else if (name.startsWith('bulb')) {
        mm.emissive = new THREE.Color('#ffd9a0'); mm.emissiveIntensity = 2.2; o.castShadow = false
      } else if (name.startsWith('cat_')) {
        mm.emissive = mm.color?.clone() || new THREE.Color('#ffffff'); mm.emissiveIntensity = 0.55; o.castShadow = false
      } else if (name.startsWith('slab') || name.startsWith('floor') || name.startsWith('oak') || name.startsWith('tile')) {
        o.castShadow = false
      }
      if (mm && 'envMapIntensity' in mm) mm.envMapIntensity = 0.9
      return mm
    })
    o.material = Array.isArray(o.material) ? out : out[0]
  })
}

function GlbModel({ url }) {
  const { scene } = useGLTF(url)
  const obj = useMemo(() => { const s = scene.clone(true); prepare(s, false); return s }, [scene])
  // drop the parsed model (geometry, decoded textures) when the view closes —
  // the file stays in the HTTP cache, so reopening is quick
  useEffect(() => () => useGLTF.clear(url), [url])
  return <primitive object={obj} />
}
function ObjModel({ url }) {
  const raw = useLoader(OBJLoader, url)
  const obj = useMemo(() => { const s = raw.clone(true); prepare(s, true); return s }, [raw])
  return <primitive object={obj} />
}

// Studio lighting from RoomEnvironment — soft fill and reflections, no HDR download
function StudioEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.75
    return () => { scene.environment = null; env.dispose(); pmrem.dispose() }
  }, [gl, scene])
  return null
}

// Puts the model on the ground at the origin, reports its size, applies the cut
function Placed({ model, onBounds, onSlots, cut, cutPos }) {
  const wrap = useRef()
  const inner = useRef()
  const { gl } = useThree()
  const [box, setBox] = useState(null)
  const scale = model.scale ?? 1
  const rotation = useMemo(() => [((model.rotationX ?? 0) * Math.PI) / 180, ((model.rotationY ?? 0) * Math.PI) / 180, 0], [model.rotationX, model.rotationY])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), [])

  useEffect(() => {
    if (!wrap.current || !inner.current) return
    wrap.current.position.set(0, 0, 0)
    wrap.current.updateMatrixWorld(true)
    const b = new THREE.Box3().setFromObject(inner.current)
    if (b.isEmpty()) return
    const c = b.getCenter(new THREE.Vector3())
    wrap.current.position.set(-c.x, -b.min.y, -c.z)
    wrap.current.updateMatrixWorld(true)
    const placed = new THREE.Box3().setFromObject(inner.current)
    setBox(placed)
    onBounds(placed)
    onSlots?.(extractSlots(inner.current))
  }, [model.url, scale, rotation]) // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = useThree((s) => s.invalidate)
  // vertical section plane across the long axis: keeps x < position
  useEffect(() => {
    gl.localClippingEnabled = true
    if (!inner.current) return
    if (box) plane.constant = THREE.MathUtils.lerp(box.min.x, box.max.x, cutPos)
    inner.current.traverse((o) => {
      if (!o.isMesh) return
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        m.clippingPlanes = cut ? [plane] : []
        m.clipShadows = true
        if (m.userData.side0 == null) m.userData.side0 = m.side
        m.side = cut ? THREE.DoubleSide : m.userData.side0 // cut walls show their inner face
        m.needsUpdate = true
      }
    })
    invalidate()
  }, [cut, cutPos, box, gl, plane, invalidate])

  return (
    <group ref={wrap}>
      <group ref={inner} scale={scale} rotation={rotation}>
        {model.format === 'obj' ? <ObjModel url={model.url} /> : <GlbModel url={model.url} />}
      </group>
    </group>
  )
}

// Sun with a shadow frustum fitted to the model
function Sun({ box, mapSize = 2048 }) {
  const ref = useRef()
  useEffect(() => {
    const l = ref.current
    if (!l || !box) return
    const size = box.getSize(new THREE.Vector3())
    const r = Math.max(size.x, size.z) * 0.75 + 1
    l.position.set(r * 0.9, Math.max(size.y * 4, r * 1.3), r * 0.6)
    l.target.position.set(0, 0, 0)
    l.target.updateMatrixWorld()
    Object.assign(l.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.1, far: r * 6 })
    l.shadow.camera.updateProjectionMatrix()
  }, [box])
  return <directionalLight ref={ref} castShadow intensity={2.2} color="#fff4e2"
    shadow-mapSize={[mapSize, mapSize]} shadow-bias={-0.0004} shadow-normalBias={0.02} shadow-radius={4} />
}

// Real devices on their slots: bulbs glow (and light the room) when the light
// is on, category pins follow the filter, labels open the device popup.
const MAX_LAMPS = 14
function DeviceLayer({ slots, placed: allPlaced, filter, compact, assign, onSlot, onOpen, cutX }) {
  const invalidate = useThree((s) => s.invalidate)
  // with the section on, whatever sits in the cut-away half has no label
  const kept = (s) => cutX == null || s.anchor.x <= cutX
  const placed = useMemo(() => allPlaced.filter((p) => kept(p.slot)), [allPlaced, cutX]) // eslint-disable-line react-hooks/exhaustive-deps
  const bySlot = useMemo(() => new Map(placed.map((p) => [p.slot.id, p])), [placed])
  const shown = (cat) => filter === 'All' || filter === cat

  useEffect(() => {
    for (const s of slots) {
      const vis = shown(s.cat)
      for (const m of s.markers) m.visible = vis
      if (!s.bulbs.length) continue
      const p = bySlot.get(s.id)
      const on = p && isOn(p.device)
      const level = Number(p?.device.readings?.level?.value ?? 100) / 100
      for (const mat of s.bulbs) {
        mat.emissive = new THREE.Color(on ? '#ffd29a' : '#2a2620')
        mat.emissiveIntensity = on ? 1.2 + 2.6 * Math.max(0.15, level) : p ? 0.15 : 0.4
      }
    }
    invalidate() // rendering is on demand — redraw with the new state
  }) // every render: device state, filter and placement all feed it

  const lamps = placed.filter((p) => p.slot.bulbs.length && isOn(p.device) && shown('Lighting')).slice(0, MAX_LAMPS)
  return (
    <>
      {lamps.map(({ slot, device }) => {
        const c = slot.box.getCenter(new THREE.Vector3())
        const level = Number(device.readings?.level?.value ?? 100) / 100
        return <pointLight key={slot.id} position={[c.x, c.y - 0.1, c.z]} color="#ffcf8f" intensity={3 + 9 * level} distance={5} decay={2} />
      })}
      {placed.filter((p) => shown(p.slot.cat)).map(({ slot, device }) => (
        <Html key={slot.id} position={slot.anchor} center zIndexRange={[20, 0]} style={{ pointerEvents: 'auto' }}>
          <button type="button" className="pmv-pin" data-on={isOn(device) || undefined} data-compact={compact || undefined}
            style={{ '--c': CAT_COLOR[slot.cat] }} title={`${device.label} ${stateText(device, gt)}`}
            onClick={(e) => { e.stopPropagation(); assign ? onSlot(slot) : onOpen?.(device.key) }}>
            <i />{!compact && <><span className="pmv-pin-name">{device.label}</span><span className="pmv-pin-val">{stateText(device, gt)}</span></>}
          </button>
        </Html>
      ))}
      {assign && slots.filter((s) => !bySlot.has(s.id) && shown(s.cat) && kept(s)).map((slot) => (
        <Html key={'free:' + slot.id} position={slot.anchor} center zIndexRange={[19, 0]} style={{ pointerEvents: 'auto' }}>
          <button type="button" className="pmv-pin pmv-pin-free" style={{ '--c': CAT_COLOR[slot.cat] }} title={slot.name}
            onClick={(e) => { e.stopPropagation(); onSlot(slot) }}>+</button>
        </Html>
      ))}
    </>
  )
}

// Flies the camera to a preset; any drag cancels the flight
function CameraRig({ box, view, flight, controls }) {
  const { camera, size: viewport, invalidate } = useThree()
  const goal = useRef(null)
  useEffect(() => {
    if (!box) return
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const radius = size.length() / 2
    // fit the bounding sphere into the narrower of the vertical / horizontal field of view
    const vfov = (camera.fov * Math.PI) / 180
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (viewport.width / Math.max(1, viewport.height)))
    const dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * (view === 'top' ? 0.72 : 0.62)
    const dir = new THREE.Vector3(...VIEWS[view]).normalize()
    goal.current = { pos: center.clone().addScaledVector(dir, dist), target: center.clone().setY(view === 'top' ? 0 : size.y * 0.3) }
    camera.near = Math.max(0.01, dist / 200); camera.far = dist * 20; camera.updateProjectionMatrix()
    invalidate()
  }, [box, view, flight, camera, viewport.width, viewport.height, invalidate])
  useFrame((_, dt) => {
    const g = goal.current
    const c = controls.current
    if (!g || !c) return
    const k = 1 - Math.pow(0.0015, dt)
    camera.position.lerp(g.pos, k)
    c.target.lerp(g.target, k)
    c.update()
    invalidate() // on-demand rendering: keep frames coming until the flight lands
    if (camera.position.distanceTo(g.pos) < 0.01 && c.target.distanceTo(g.target) < 0.01) {
      camera.position.copy(g.pos); c.target.copy(g.target); c.update()
      goal.current = null
    }
  })
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const stop = () => { goal.current = null }
    c.addEventListener('start', stop)
    return () => c.removeEventListener('start', stop)
  }, [controls])
  return null
}

async function saveBindings(bindings) {
  const res = await fetch('/api/plan-model/bindings', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bindings, pin: sessionStorage.getItem('lsh-edit-pin') || '' }),
  })
  const d = await res.json().catch(() => ({}))
  if (!d.success) throw new Error(d.error === 'PIN_REQUIRED' ? gt('pin_needed_plan', 'Edit PIN needed — unlock editing in the Plan view first') : d.error || `HTTP ${res.status}`)
  return d.model?.bindings || {}
}

export default function PlanModelViewer({ model, autoRotate = false, transparent = false, showHint = true,
  devices = [], groupOf, onOpen, compact = false, onClose }) {
  const [spinning, setSpinning] = useState(autoRotate)
  const [view, setView] = useState(() => (VIEWS[load('planModelView', 'iso')] ? load('planModelView', 'iso') : 'iso'))
  const [flight, setFlight] = useState(0) // re-fly to the same preset
  const [cut, setCut] = useState(() => load('planModelCut', '1') === '1')
  const [cutPos, setCutPos] = useState(() => Number(load('planModelCutPos', '0.5')) || 0.5)
  const [box, setBox] = useState(null)
  const [slots, setSlots] = useState([])
  const [filter, setFilter] = useState(() => load('planModelFilter', 'All'))
  const [bindings, setBindings] = useState(model?.bindings || {})
  const [assign, setAssign] = useState(false)
  const [picking, setPicking] = useState(null) // slot being assigned
  const [err, setErr] = useState(null)
  const controls = useRef()
  useEffect(() => { setBindings(model?.bindings || {}) }, [model?.bindings])
  useEffect(() => { // Esc closes the picker first, then the full-screen view
    if (!onClose) return
    const onKey = (e) => { if (e.key === 'Escape') { if (picking) setPicking(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, picking])
  const { placed, unplaced } = useMemo(
    () => (groupOf && slots.length ? assignDevices(devices, slots, bindings, groupOf) : { placed: [], unplaced: [] }),
    [devices, slots, bindings, groupOf])
  if (!model?.url) return null

  const counts = Object.fromEntries(MODEL_CATS.map((c) => [c, placed.filter((p) => p.slot.cat === c).length]))
  const pickFilter = (c) => { setFilter(c); save('planModelFilter', c) }
  const bind = async (patch) => {
    setErr(null)
    try { setBindings(await saveBindings(patch)); setPicking(null) }
    catch (e) { setErr(e.message) }
  }
  const occupant = picking && placed.find((p) => p.slot.id === picking.id)

  // a chosen angle stays put — the idle spin would turn it away again
  const pickView = (v) => { setView(v); setFlight((f) => f + 1); save('planModelView', v); setSpinning(false) }
  const toggleCut = () => setCut((c) => { save('planModelCut', c ? '0' : '1'); return !c })
  const moveCut = (v) => { setCutPos(v); save('planModelCutPos', String(v)) }

  return (
    <div className="pmv" style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* only the idle spin needs a frame every vsync — otherwise draw on change */}
      <Canvas shadows="soft" camera={{ position: [8, 7, 8], fov: 40 }} dpr={compact ? [1, 1.5] : [1, 2]}
        frameloop={spinning ? 'always' : 'demand'}
        gl={{ antialias: true, alpha: transparent, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
        {!transparent && <color attach="background" args={['#0b0b12']} />}
        <StudioEnvironment />
        <hemisphereLight args={['#dfe9ff', '#3b3226', 0.35]} />
        <Sun box={box} mapSize={compact ? 1024 : 2048} />
        <Suspense fallback={null}>
          <Placed model={model} onBounds={setBox} onSlots={setSlots} cut={cut} cutPos={cutPos} />
          {slots.length > 0 && (
            <DeviceLayer slots={slots} placed={placed} filter={filter} compact={compact} assign={assign}
              onSlot={setPicking} onOpen={onOpen}
              cutX={cut && box ? THREE.MathUtils.lerp(box.min.x, box.max.x, cutPos) : null} />
          )}
          {box && <>
            {/* sun shadow on the ground — clipped with the model when the section is on */}
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.002, 0]} receiveShadow>
              <planeGeometry args={[box.getSize(new THREE.Vector3()).length() * 3, box.getSize(new THREE.Vector3()).length() * 3]} />
              <shadowMaterial transparent opacity={0.3} />
            </mesh>
            {/* soft ambient-occlusion-like contact shadow; it can't be clipped, so only for the whole model */}
            {!cut && (
              <ContactShadows position={[0, -0.005, 0]} scale={box.getSize(new THREE.Vector3()).length() * 1.2}
                opacity={0.45} blur={2.4} far={Math.max(0.5, box.max.y * 0.5)} resolution={compact ? 512 : 1024}
                frames={1} color="#1a1208" />
            )}
          </>}
        </Suspense>
        <CameraRig box={box} view={view} flight={flight} controls={controls} />
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08}
          autoRotate={spinning} autoRotateSpeed={0.5} maxPolarAngle={Math.PI * 0.495}
          onStart={() => setSpinning(false)} />
      </Canvas>

      {slots.length > 0 && groupOf && (
        <div className="pmv-filters" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" data-active={filter === 'All' || undefined} onClick={() => pickFilter('All')}>
            {gt('cat_all', 'All')} <b>{placed.length}</b>
          </button>
          {MODEL_CATS.filter((c) => counts[c] || slots.some((s) => s.cat === c && assign)).map((c) => (
            <button key={c} type="button" data-active={filter === c || undefined} style={{ '--c': CAT_COLOR[c] }} onClick={() => pickFilter(c)}>
              <i />{gt('cat_' + c.toLowerCase(), c)} <b>{counts[c]}</b>
            </button>
          ))}
          <button type="button" className="pmv-assign" data-active={assign || undefined}
            onClick={() => { setAssign((a) => !a); setPicking(null) }}>
            {assign ? gt('dash_edit_done', 'Done') : gt('plan_assign', 'Assign')}
          </button>
          {assign && unplaced.length > 0 && <span className="pmv-note">{gt('plan_unplaced', '{n} without a place').replace('{n}', unplaced.length)}</span>}
        </div>
      )}

      {picking && (
        <div className="pmv-picker" onPointerDown={(e) => e.stopPropagation()}>
          <div className="pmv-picker-head">
            <i style={{ background: CAT_COLOR[picking.cat] }} />
            <span>{picking.name.replace(/_/g, ' ')}</span>
            <button type="button" onClick={() => setPicking(null)} aria-label={gt('close', 'Close')}>✕</button>
          </div>
          {err && <div className="pmv-picker-err">{err}</div>}
          <div className="pmv-picker-list">
            {devices.filter((d) => groupOf(d) === picking.cat).map((d) => {
              const here = occupant?.device.key === d.key
              const elsewhere = !here && placed.find((p) => p.device.key === d.key)
              return (
                <button key={d.key} type="button" data-active={here || undefined} onClick={() => bind({ [d.key]: picking.id })}>
                  <span>{d.label}</span>
                  <small>{here ? '✓' : elsewhere ? elsewhere.slot.name.replace(/_/g, ' ') : bindings[d.key] === null ? gt('plan_hidden', 'hidden') : ''}</small>
                </button>
              )
            })}
          </div>
          {occupant && (
            <button type="button" className="pmv-picker-remove" onClick={() => bind({ [occupant.device.key]: null })}>
              {gt('plan_remove_dev', 'Remove from model')}
            </button>
          )}
        </div>
      )}

      <div className="pmv-bar" onPointerDown={(e) => e.stopPropagation()}>
        <div className="pmv-seg" role="group" aria-label={gt('plan_cam', 'Camera')}>
          {Object.keys(VIEWS).map((v) => (
            <button key={v} type="button" data-active={view === v || undefined} onClick={() => pickView(v)}>
              {gt('plan_cam_' + v, { iso: 'Iso', top: 'Top', front: 'Front', side: 'Side' }[v])}
            </button>
          ))}
        </div>
        <div className="pmv-cut">
          <button type="button" data-active={cut || undefined} onClick={toggleCut} title={gt('plan_cut_hint', 'Cut the model in half to look inside')}>
            ◧ {gt('plan_cut', 'Section')}
          </button>
          {cut && (
            <input type="range" min="0.05" max="0.95" step="0.01" value={cutPos} aria-label={gt('plan_cut', 'Section')}
              onChange={(e) => moveCut(Number(e.target.value))} />
          )}
        </div>
      </div>
      {onClose && (
        <button type="button" className="pmv-close" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}
          aria-label={gt('close', 'Close')}>✕ {gt('close', 'Close')}</button>
      )}
      {showHint && <div className="pmv-hint" data-with-close={onClose ? '' : undefined}>{gt('plan_model_hint', 'Drag to rotate · Scroll to zoom')}</div>}
    </div>
  )
}
