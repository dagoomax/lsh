import { useRef, useMemo, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

// Low-poly procedural G-Wagen — built from primitives (no external asset),
// since a real branded 3D model isn't something to fetch from the internet.
// The boxy silhouette (flat panels, upright cabin) is what a G-Wagen is
// actually known for, so primitives read fairly honestly here. Surface
// "textures" (paint fleck, grille slats, tire tread, glass sheen) are drawn
// procedurally onto <canvas> and used as THREE.CanvasTexture maps — same
// reasoning: no external image assets, nothing to license or fetch.

const BODY_COLOR = '#1c1e24' // matte graphite
const ACCENT     = '#a371f7' // matches the EV theme color used elsewhere in the energy tab

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  draw(canvas.getContext('2d'), size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.needsUpdate = true
  return tex
}

// Metallic-fleck paint: base coat + speckle + faint brushed-panel streaks.
function makePaintTexture(base) {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 900; i++) {
      const light = Math.random() > 0.5
      ctx.fillStyle = light
        ? `rgba(255,255,255,${(Math.random() * 0.10).toFixed(3)})`
        : `rgba(0,0,0,${(Math.random() * 0.16).toFixed(3)})`
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1)
    }
    ctx.globalAlpha = 0.05
    ctx.strokeStyle = '#ffffff'
    for (let i = 0; i < 14; i++) {
      const y = Math.random() * s
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y + (Math.random() * 4 - 2)); ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
}

// Vertical grille slats.
function makeGrilleTexture() {
  return canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#0a0b0e'
    ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = '#3d4048'
    const slats = 9, gap = s / slats
    for (let i = 0; i < slats; i++) ctx.fillRect(i * gap + gap * 0.18, 0, gap * 0.64, s)
  })
}

// Diagonal tread blocks, wraps around the tire circumference.
function makeTireTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#131417'
    ctx.fillRect(0, 0, s, s)
    ctx.fillStyle = '#040405'
    const blocks = 20, w = s / blocks, shear = s * 0.22
    for (let i = 0; i < blocks; i++) {
      const x = i * w
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + w * 0.6, 0)
      ctx.lineTo(x + w * 0.6 - shear, s)
      ctx.lineTo(x - shear, s)
      ctx.closePath()
      ctx.fill()
    }
  })
}

// Tinted glass: subtle gradient + one soft diagonal reflection streak.
function makeGlassTexture() {
  return canvasTexture(64, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, s, s)
    grad.addColorStop(0, '#0c0f16')
    grad.addColorStop(0.5, '#04050a')
    grad.addColorStop(1, '#0c0f16')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, s, s)
    ctx.globalAlpha = 0.14
    ctx.strokeStyle = '#9fc2ff'
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(-10, s * 0.15); ctx.lineTo(s * 0.55, -10); ctx.stroke()
    ctx.globalAlpha = 1
  })
}

// Brushed dark metal (bumpers, roof rack, spare-wheel carrier).
function makeMetalTexture() {
  return canvasTexture(64, (ctx, s) => {
    ctx.fillStyle = '#24262c'
    ctx.fillRect(0, 0, s, s)
    ctx.globalAlpha = 0.15
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * s
      ctx.strokeStyle = Math.random() > 0.5 ? '#ffffff' : '#000000'
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
}

function useTextures() {
  const textures = useMemo(() => ({
    paint: makePaintTexture(BODY_COLOR),
    grille: makeGrilleTexture(),
    tire: makeTireTexture(),
    glass: makeGlassTexture(),
    metal: makeMetalTexture(),
  }), [])
  useEffect(() => () => Object.values(textures).forEach((t) => t.dispose()), [textures])
  return textures
}

function ChargePort({ charging }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    const pulse = charging ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 4) : 0
    ref.current.material.emissiveIntensity = charging ? 0.4 + pulse * 1.2 : 0.15
  })
  return (
    <mesh ref={ref} position={[0.82, 1.0, 0.3]}>
      <sphereGeometry args={[0.07, 12, 12]} />
      <meshStandardMaterial color={ACCENT} emissive={ACCENT} emissiveIntensity={0.15} />
    </mesh>
  )
}

// AMG multi-spoke alloy: bigger wheel + bright rim ring + a red brake-caliper
// hint peeking through the spokes — the giveaway details vs. the base model's
// plain steel/painted wheels.
function Wheel({ x, z, tireMap }) {
  const sign = x > 0 ? 1 : -1
  return (
    <group>
      <mesh position={[x, 0.48, z]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.48, 0.48, 0.32, 24]} />
        <meshStandardMaterial map={tireMap} roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh position={[x + sign * 0.1, 0.48, z]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.32, 0.32, 0.05, 24]} />
        <meshStandardMaterial color="#c9ccd2" roughness={0.3} metalness={0.9} />
      </mesh>
      <mesh position={[x + sign * 0.12, 0.48, z]}>
        <boxGeometry args={[0.04, 0.2, 0.2]} />
        <meshStandardMaterial color="#c31f1f" roughness={0.5} />
      </mesh>
    </group>
  )
}

function GWagen({ charging }) {
  const group = useRef()
  const { paint, grille, tire, glass, metal } = useTextures()

  const paintProps = { map: paint, roughness: 0.45, metalness: 0.4 }

  // Proportions below follow the real W463 G-Class's public dimensions
  // (≈4.9m long, ≈1.93m wide, ≈1.97m tall, ≈2.89m wheelbase — length is
  // ~2.5× width, height ≈ width) scaled down to this scene's units.
  return (
    <group ref={group} position={[0, -0.4, 0]}>
      {/* chassis / lower body — full length, sets the flat-panel SUV stance */}
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[1.75, 0.62, 4.4]} />
        <meshStandardMaterial {...paintProps} />
      </mesh>

      {/* upright boxy cabin, set back to leave hood + rear deck exposed */}
      <mesh position={[0, 1.32, -0.2]} castShadow>
        <boxGeometry args={[1.62, 0.62, 2.6]} />
        <meshStandardMaterial {...paintProps} />
      </mesh>

      {/* window band (flat, dark tint — classic upright G-Wagen glasshouse) */}
      <mesh position={[0, 1.36, -0.2]}>
        <boxGeometry args={[1.64, 0.32, 2.65]} />
        <meshStandardMaterial map={glass} roughness={0.1} metalness={0.85} />
      </mesh>

      {/* AMG grille — vertical slats + a bright chrome surround, flanked by the
          round headlamps that even the AMG/EQ variants keep on this face */}
      <mesh position={[0, 0.9, 2.22]}>
        <boxGeometry args={[0.78, 0.46, 0.03]} />
        <meshStandardMaterial color="#d8dade" roughness={0.25} metalness={0.85} />
      </mesh>
      <mesh position={[0, 0.9, 2.23]}>
        <boxGeometry args={[0.7, 0.4, 0.04]} />
        <meshStandardMaterial map={grille} roughness={0.6} />
      </mesh>

      {/* AMG front badge (fender plate — not a reproduction of any logo) */}
      <mesh position={[0, 0.95, 2.05]}>
        <boxGeometry args={[0.16, 0.05, 0.01]} />
        <meshStandardMaterial color="#c9ccd2" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* AMG front air intakes flanking the lower bumper */}
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.55, 2.2]}>
          <boxGeometry args={[0.3, 0.14, 0.03]} />
          <meshStandardMaterial color="#0a0a0c" roughness={0.9} />
        </mesh>
      ))}

      {/* round headlamps */}
      {[-0.68, 0.68].map((x) => (
        <mesh key={x} position={[x, 0.85, 2.23]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.05, 16]} />
          <meshStandardMaterial color="#fff8e6" emissive="#fff8e6" emissiveIntensity={0.5} roughness={0.2} />
        </mesh>
      ))}

      {/* amber front indicator repeaters (fender-mounted) */}
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} position={[x, 0.78, 1.9]}>
          <boxGeometry args={[0.04, 0.06, 0.1]} />
          <meshStandardMaterial color="#ffb020" emissive="#ffb020" emissiveIntensity={0.6} />
        </mesh>
      ))}

      {/* black lower valance / skid plate, front and rear */}
      {[2.24, -2.33].map((z) => (
        <mesh key={z} position={[0, 0.52, z]}>
          <boxGeometry args={[1.6, 0.2, 0.06]} />
          <meshStandardMaterial color="#0b0c0e" roughness={0.85} />
        </mesh>
      ))}

      {/* body-colored flared wheel arches — AMG's more integrated "muscular"
          look, vs. the black plastic cladding on the base/Professional trim */}
      {[1.3, -1.3].map((z) => (
        <group key={z}>
          <mesh position={[-0.94, 0.78, z]} castShadow><boxGeometry args={[0.18, 0.38, 0.68]} /><meshStandardMaterial {...paintProps} /></mesh>
          <mesh position={[0.94, 0.78, z]} castShadow><boxGeometry args={[0.18, 0.38, 0.68]} /><meshStandardMaterial {...paintProps} /></mesh>
        </group>
      ))}

      {/* side steps / running boards */}
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 0.48, 0]}>
          <boxGeometry args={[0.1, 0.05, 2.3]} />
          <meshStandardMaterial color="#0b0c0e" roughness={0.8} />
        </mesh>
      ))}

      {/* boxy "safari" side mirrors on the A-pillars */}
      {[-0.86, 0.86].map((x) => (
        <mesh key={x} position={[x, 1.4, 1.0]}>
          <boxGeometry args={[0.1, 0.13, 0.2]} />
          <meshStandardMaterial color="#0b0c0e" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}

      {/* exposed door hinges — 2 per door edge, front + rear doors, both sides */}
      {[-0.83, 0.83].map((x) => (
        [0.5, -0.85].map((z) => (
          [1.15, 1.42].map((y) => (
            <mesh key={`${x}-${z}-${y}`} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.025, 0.025, 0.08, 8]} />
              <meshStandardMaterial map={metal} roughness={0.4} metalness={0.7} />
            </mesh>
          ))
        ))
      ))}

      {/* roof rack */}
      {[-0.9, -0.2, 0.5].map((z) => (
        <mesh key={z} position={[0, 1.66, z]}>
          <boxGeometry args={[1.5, 0.05, 0.05]} />
          <meshStandardMaterial map={metal} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[-0.72, 1.6, -0.2]}><boxGeometry args={[0.05, 0.12, 2.3]} /><meshStandardMaterial map={metal} metalness={0.6} /></mesh>
      <mesh position={[0.72, 1.6, -0.2]}><boxGeometry args={[0.05, 0.12, 2.3]} /><meshStandardMaterial map={metal} metalness={0.6} /></mesh>

      {/* rear-mounted spare wheel */}
      <mesh position={[0, 0.95, -2.36]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.18, 20]} />
        <meshStandardMaterial map={tire} roughness={0.9} />
      </mesh>

      {/* AMG quad exhaust tips — twin round outlets each side, the clearest
          rear giveaway that this is the G63 and not the base/EQ model */}
      {[-0.65, -0.48, 0.48, 0.65].map((x) => (
        <mesh key={x} position={[x, 0.45, -2.36]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.055, 0.055, 0.1, 16]} />
          <meshStandardMaterial color="#d8dade" roughness={0.2} metalness={0.9} />
        </mesh>
      ))}

      <Wheel x={-0.92} z={1.3}  tireMap={tire} />
      <Wheel x={0.92}  z={1.3}  tireMap={tire} />
      <Wheel x={-0.92} z={-1.3} tireMap={tire} />
      <Wheel x={0.92}  z={-1.3} tireMap={tire} />

      <ChargePort charging={charging} />
    </group>
  )
}

function Scene({ charging }) {
  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 3]} intensity={1.3} color="#fff8f0" />
      <pointLight position={[-3, 2, -3]} intensity={0.35} color={ACCENT} />
      <GWagen charging={charging} />
      <OrbitControls
        enableDamping dampingFactor={0.1}
        enablePan={false}
        minDistance={4.5} maxDistance={9}
        maxPolarAngle={Math.PI / 2.1}
        autoRotate autoRotateSpeed={1.1}
      />
    </>
  )
}

export default function GWagenModel3D({ charging = false, height = 190 }) {
  return (
    <div style={{ width: '100%', height, borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'grab' }}>
      <Canvas camera={{ position: [5, 2.3, 6.5], fov: 32 }} gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
        <Scene charging={charging} />
      </Canvas>
    </div>
  )
}
