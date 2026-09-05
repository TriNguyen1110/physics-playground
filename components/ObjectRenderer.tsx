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
function SphereObject({ object }: { object: SceneObject }) {
  const radius = object.radius ?? 0.3
  return (
    <mesh position={object.position} castShadow receiveShadow>
      <sphereGeometry args={[radius, 32, 32]} />
      <meshStandardMaterial
        color="#0a0a0d"
        emissive={object.color}
        emissiveIntensity={1.6}
        roughness={0.3}
        metalness={0.4}
        toneMapped={false}
      />
    </mesh>
  )
}

function BoxObject({ object }: { object: SceneObject }) {
  // A box with no explicit size is almost always a ground/interface/wall
  // marker plane in this app's three modules — default to a flat slab
  // rather than a 1x1x1 cube.
  const size = (object.meta?.size as Vec3) ?? [6, 0.08, 6]
  return (
    <mesh position={object.position} receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#12131a" emissive={object.color} emissiveIntensity={0.15} roughness={0.9} metalness={0.1} />
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
