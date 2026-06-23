import { useRef, useState, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text, Grid } from '@react-three/drei'
import * as THREE from 'three'

const ROOMS = [
  { id: 'living',   label: 'Living Room',  x: -3,   z: -2,   w: 4,   d: 3,   h: 0.3,  color: '#1a1a2e', icon: '🛋️'  },
  { id: 'kitchen',  label: 'Kitchen',      x:  1.5, z: -2,   w: 2.5, d: 3,   h: 0.3,  color: '#1a2a1a', icon: '🍳'  },
  { id: 'master',   label: 'Master Suite', x: -3,   z:  2,   w: 3,   d: 2.5, h: 0.3,  color: '#1a1a2e', icon: '🛏️'  },
  { id: 'bedroom2', label: 'Bedroom 2',    x:  0.5, z:  2,   w: 2.5, d: 2.5, h: 0.3,  color: '#1a1a2e', icon: '🛏️'  },
  { id: 'bathroom', label: 'Bathroom',     x:  3.5, z:  2,   w: 1.5, d: 2.5, h: 0.3,  color: '#1a2a2a', icon: '🚿'  },
  { id: 'garage',   label: 'Garage',       x:  3.5, z: -0.5, w: 1.5, d: 2,   h: 0.3,  color: '#1e1a14', icon: '🚗'  },
  { id: 'garden',   label: 'Garden',       x: -3,   z:  5,   w: 8,   d: 2,   h: 0.05, color: '#0d1a0d', icon: '🌿'  },
]

const GOLD = new THREE.Color('#D4AF37')
const GOLD_DIM = new THREE.Color('#5a4a10')
const WALL_COLOR = new THREE.Color('#1e1e30')

function SensorDot({ position, color, delay = 0 }) {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 2 + delay)
      ref.current.scale.setScalar(s)
    }
  })
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
    </mesh>
  )
}

function RoomMesh({ room, isSelected, onSelect }) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef()
  const edgesRef = useRef()

  useFrame(() => {
    if (!meshRef.current) return
    const targetScale = isSelected ? 1.08 : hovered ? 1.05 : 1
    meshRef.current.scale.lerp(new THREE.Vector3(targetScale, 1, targetScale), 0.1)
  })

  const edgesGeo = useMemo(() => {
    const geo = new THREE.BoxGeometry(room.w, room.h, room.d)
    return new THREE.EdgesGeometry(geo)
  }, [room.w, room.h, room.d])

  const emissiveIntensity = isSelected ? 0.18 : hovered ? 0.08 : 0

  // Wall segments
  const walls = useMemo(() => {
    const t = 0.06
    const wh = 0.5
    return [
      // front
      { pos: [0, wh / 2, room.d / 2],  size: [room.w, wh, t] },
      // back
      { pos: [0, wh / 2, -room.d / 2], size: [room.w, wh, t] },
      // left
      { pos: [-room.w / 2, wh / 2, 0], size: [t, wh, room.d] },
      // right
      { pos: [room.w / 2, wh / 2, 0],  size: [t, wh, room.d] },
    ]
  }, [room.w, room.d])

  return (
    <group position={[room.x, 0, room.z]}>
      {/* Floor slab */}
      <mesh
        ref={meshRef}
        position={[0, room.h / 2, 0]}
        onClick={() => onSelect(room)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[room.w, room.h, room.d]} />
        <meshStandardMaterial
          color={room.color}
          metalness={0.3}
          roughness={0.6}
          emissive="#D4AF37"
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>

      {/* Gold edges */}
      <lineSegments ref={edgesRef} position={[0, room.h / 2, 0]}>
        <primitive object={edgesGeo} attach="geometry" />
        <lineBasicMaterial color={isSelected ? '#D4AF37' : '#5a4a10'} linewidth={1} transparent opacity={isSelected ? 1 : 0.6} />
      </lineSegments>

      {/* Walls */}
      {walls.map((w, i) => (
        <mesh key={i} position={w.pos}>
          <boxGeometry args={w.size} />
          <meshStandardMaterial color={WALL_COLOR} metalness={0.5} roughness={0.5} />
        </mesh>
      ))}

      {/* Label */}
      <Text
        position={[0, room.h + 0.55, 0]}
        fontSize={0.22}
        color="#D4AF37"
        anchorX="center"
        anchorY="middle"
        font="https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff"
        billboard
      >
        {`${room.icon} ${room.label}`}
      </Text>

      {/* Sensor dots */}
      <SensorDot position={[-room.w * 0.3, room.h + 0.04, -room.d * 0.2]} color="#3DBA6E" delay={0} />
      <SensorDot position={[ room.w * 0.2, room.h + 0.04,  room.d * 0.2]} color="#4A9EFF" delay={1} />
      {isSelected && (
        <SensorDot position={[0, room.h + 0.04, 0]} color="#D4AF37" delay={0.5} />
      )}
    </group>
  )
}

function Scene({ sensors, selectedRoom, onRoomSelect }) {
  return (
    <>
      <color attach="background" args={['#07070f']} />
      <fog attach="fog" args={['#07070f', 18, 35]} />

      <ambientLight intensity={0.35} />
      <directionalLight
        position={[6, 10, 4]}
        intensity={1.5}
        color="#fff8f0"
        castShadow
      />
      <pointLight position={[0, 8, 0]} intensity={0.5} color="#D4AF37" />
      <pointLight position={[-5, 4, -4]} intensity={0.3} color="#4A9EFF" />

      {/* Floor grid */}
      <Grid
        args={[20, 20]}
        position={[0, 0, 0]}
        cellSize={1}
        cellThickness={0.3}
        cellColor="#1a1a2a"
        sectionSize={5}
        sectionThickness={0.6}
        sectionColor="#D4AF37"
        fadeDistance={22}
        fadeStrength={2}
        infiniteGrid
      />

      {/* Base floor plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[20, 16]} />
        <meshStandardMaterial color="#09090f" roughness={0.9} metalness={0.05} />
      </mesh>

      {ROOMS.map(room => (
        <RoomMesh
          key={room.id}
          room={room}
          isSelected={selectedRoom?.id === room.id}
          onSelect={onRoomSelect}
        />
      ))}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.5}
        minDistance={5}
        maxDistance={22}
        autoRotate
        autoRotateSpeed={0.3}
      />
    </>
  )
}

export default function FloorPlan3D({ sensors, selectedRoom, onRoomSelect }) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 12, 8], fov: 45 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        shadows
      >
        <Scene sensors={sensors} selectedRoom={selectedRoom} onRoomSelect={onRoomSelect} />
      </Canvas>

      {/* Overlay hint */}
      <div style={{
        position: 'absolute',
        bottom: 16, left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 16px',
        background: 'rgba(7,7,15,0.7)',
        border: '1px solid rgba(212,175,55,0.15)',
        borderRadius: 20,
        fontSize: 11,
        color: 'var(--muted)',
        letterSpacing: '0.05em',
        pointerEvents: 'none',
        backdropFilter: 'blur(8px)',
      }}>
        Click a room to inspect · Drag to rotate · Scroll to zoom
      </div>
    </div>
  )
}
