"use client"

import * as THREE from "three"
import { useMemo } from "react"
import type { ScenarioState } from "@/lib/physics/types"

type FieldVector = NonNullable<ScenarioState["fieldVectors"]>[number]

/** Small instanced-ish arrow field, scaled by (clamped) magnitude, for the
 * `fields` module's field-line readout. */
export function FieldVectorRenderer({ vectors, color }: { vectors: FieldVector[]; color: string }) {
  const maxMag = useMemo(() => Math.max(...vectors.map((v) => v.magnitude), 1e-9), [vectors])

  return (
    <group>
      {vectors.map((v, i) => (
        <FieldArrow key={i} vector={v} scale={THREE.MathUtils.clamp(v.magnitude / maxMag, 0.15, 1)} color={color} />
      ))}
    </group>
  )
}

function FieldArrow({ vector, scale, color }: { vector: FieldVector; scale: number; color: string }) {
  const length = 0.35 + scale * 0.9
  const quaternion = useMemo(() => {
    const dirVec = new THREE.Vector3(...vector.direction).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec)
  }, [vector.direction])

  return (
    <group position={vector.origin} quaternion={quaternion}>
      <mesh position={[0, length / 2, 0]}>
        <cylinderGeometry args={[0.015, 0.015, length, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.75} toneMapped={false} />
      </mesh>
      <mesh position={[0, length + 0.06, 0]}>
        <coneGeometry args={[0.05, 0.14, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
      </mesh>
    </group>
  )
}
