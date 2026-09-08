import { Suspense } from 'react'
import { Canvas, useLoader } from '@react-three/fiber'
import { OrbitControls, useGLTF, Bounds, Center } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { gt } from '../i18n'

// Renders a user-imported floor-plan model (GLB or OBJ, uploaded from
// HomePlan's toolbar — see /api/plan-model/*) as an alternative to the
// hand-drawn isometric board. `<Bounds fit clip observe>` auto-frames
// whatever comes in regardless of its native scale/origin; scale/rotation
// are still exposed (see HomePlan's alignment controls) for the common case
// of a CAD/scan export using a different up-axis or facing direction than
// this scene's Y-up convention.

function GlbModel({ url, scale, rotation }) {
  const { scene } = useGLTF(url)
  return <primitive object={scene} scale={scale} rotation={rotation} />
}

function ObjModel({ url, scale, rotation }) {
  const obj = useLoader(OBJLoader, url)
  return <primitive object={obj} scale={scale} rotation={rotation} />
}

function Loading() {
  return (
    <mesh>
      <sphereGeometry args={[0.001]} />
    </mesh>
  )
}

export default function PlanModelViewer({ model }) {
  if (!model?.url) return null
  const scale = model.scale ?? 1
  const rotation = [
    ((model.rotationX ?? 0) * Math.PI) / 180,
    ((model.rotationY ?? 0) * Math.PI) / 180,
    0,
  ]

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [6, 6, 6], fov: 45 }} gl={{ antialias: true }} dpr={[1, 2]}>
        <color attach="background" args={['#07070f']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[6, 10, 4]} intensity={1.2} color="#fff8f0" />
        <directionalLight position={[-6, 4, -4]} intensity={0.4} color="#4A9EFF" />
        <Suspense fallback={<Loading />}>
          <Bounds fit clip observe margin={1.2}>
            <Center>
              {model.format === 'obj'
                ? <ObjModel url={model.url} scale={scale} rotation={rotation} />
                : <GlbModel url={model.url} scale={scale} rotation={rotation} />}
            </Center>
          </Bounds>
        </Suspense>
        <OrbitControls enableDamping dampingFactor={0.08} />
      </Canvas>
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        padding: '5px 14px', background: 'rgba(7,7,15,0.7)', border: '1px solid var(--border)',
        borderRadius: 20, fontSize: 11, color: 'var(--text3)', pointerEvents: 'none', backdropFilter: 'blur(8px)',
      }}>
        {gt('plan_model_hint', 'Drag to rotate · Scroll to zoom')}
      </div>
    </div>
  )
}
