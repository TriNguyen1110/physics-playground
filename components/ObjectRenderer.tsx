"use client"

import * as THREE from "three"
import { useMemo } from "react"
import { Line } from "@react-three/drei"
import type { SceneObject, Vec3 } from "@/lib/physics/types"

/** Generic renderer for a single SceneObject — switches on `kind`, never
 * hardcodes per-module meshes. All three modules share this. */
export function ObjectRenderer({ object }: { object: SceneObject }) {
  switch (object.kind) {
    case "sphere":
      return <SphereObject object={object} />
    case "box":
      return <BoxObject object={object} />
    case "ray":
      return <RayObject object={object} />
    case "arrow":
      return <ArrowObject object={object} />
    case "custom":
    default:
      return <CustomObject object={object} />
  }
}

// Beaker-by-Thix look: near-black bodies that *glow* their module color
// rather than bright surfaces lit by a bright environment.
//
// Segment count bumped 32->48 and emissiveIntensity brought down from 1.6
// so the scene's real lights (ambient/directional/point, see Scene.tsx)
// can still paint a visible specular highlight + shaded terminator across
// the surface — at emissiveIntensity 1.6 the glow alone was washing out
// that shading, which is what made spheres read as flat glowing discs
// instead of 3D volumes from some camera angles. A second, larger
// back-side shell in the object's own color (translucent, additive-ish
// via low opacity) adds a cheap fresnel/rim-light cue around the visible
// silhouette edge, the classic trick for making a small emissive sphere
// look like a lit volume rather than a flat sprite.
function SphereObject({ object }: { object: SceneObject }) {
  const radius = object.radius ?? 0.3
  return (
    <group position={object.position}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[radius, 48, 48]} />
        <meshPhysicalMaterial
          color="#0d0e12"
          emissive={object.color}
          emissiveIntensity={0.9}
          roughness={0.25}
          metalness={0.5}
          clearcoat={0.5}
          clearcoatRoughness={0.3}
          toneMapped={false}
        />
      </mesh>
      <mesh scale={1.08}>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshBasicMaterial
          color={object.color}
          transparent
          opacity={0.16}
          side={THREE.BackSide}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

function BoxObject({ object }: { object: SceneObject }) {
  // A box with no explicit size is almost always a ground/interface/wall
  // marker plane in this app's three modules — default to a slab with
  // enough Y-thickness (0.08->0.3) that its top/side faces both catch
  // light distinctly at typical camera angles, reading as a real 3D slab
  // rather than a flat, paper-thin panel.
  const size = (object.meta?.size as Vec3) ?? [6, 0.3, 6]
  return (
    <mesh position={object.position} receiveShadow castShadow>
      <boxGeometry args={size} />
      {/* emissiveIntensity bumped 0.15->0.4 and base color lifted slightly
          (#12131a->#1c1e29): at 0.15 the ground/wall slabs were only a hair
          brighter than the near-black void+fog they sit in front of, so at
          the projectiles camera's longer draw distance they read as flat
          black instead of visible geometry (see CameraRig.tsx notes on the
          projectiles preset). Still dark/cold per the Beaker-by-Thix look,
          just no longer indistinguishable from empty space. */}
      <meshStandardMaterial color="#1c1e29" emissive={object.color} emissiveIntensity={0.4} roughness={0.75} metalness={0.25} />
    </mesh>
  )
}

/** `ray` objects repurpose `velocity` as a unit direction; `meta.length`
 * controls how far the line/beam is drawn. */
function RayObject({ object }: { object: SceneObject }) {
  const dir = object.velocity ?? [0, -1, 0]
  // lib/physics/light.ts places its incident ray's source exactly 4 units
  // from the hit point and doesn't set meta.length; default to that so the
  // incident beam terminates right at the interface.
  const length = (object.meta?.length as number) ?? 4
  const points = useMemo<[Vec3, Vec3]>(() => {
    const end: Vec3 = [
      object.position[0] + dir[0] * length,
      object.position[1] + dir[1] * length,
      object.position[2] + dir[2] * length,
    ]
    return [object.position, end]
  }, [object.position, dir, length])

  return <Line points={points} color={object.color} lineWidth={2.5} toneMapped={false} transparent opacity={0.95} />
}

function ArrowObject({ object }: { object: SceneObject }) {
  const dir = object.velocity ?? [0, 1, 0]
  const length = (object.meta?.length as number) ?? 1
  const { quaternion, shaftLength } = useMemo(() => {
    const dirVec = new THREE.Vector3(...dir).normalize()
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec)
    return { quaternion: q, shaftLength: Math.max(length - 0.25, 0.05) }
  }, [dir, length])

  return (
    <group position={object.position} quaternion={quaternion}>
      <mesh position={[0, shaftLength / 2, 0]}>
        <cylinderGeometry args={[0.03, 0.03, shaftLength, 8]} />
        <meshBasicMaterial color={object.color} toneMapped={false} />
      </mesh>
      <mesh position={[0, shaftLength + 0.1, 0]}>
        <coneGeometry args={[0.08, 0.25, 12]} />
        <meshBasicMaterial color={object.color} toneMapped={false} />
      </mesh>
    </group>
  )
}

function CustomObject({ object }: { object: SceneObject }) {
  const radius = object.radius ?? 0.3
  return (
    <mesh position={object.position}>
      <icosahedronGeometry args={[radius, 0]} />
      <meshStandardMaterial color={object.color} wireframe />
    </mesh>
  )
}
