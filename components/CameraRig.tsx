"use client"

import * as THREE from "three"
import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import type { ModuleId } from "@/components/modules/types"

const CAMERA_PRESETS: Record<ModuleId, { position: Vec3; target: Vec3 }> = {
  light: { position: [0, 3.2, 7.5], target: [0, 0.6, 0] },
  projectiles: { position: [-2, 4, 11], target: [2, 1, 0] },
  fields: { position: [0, 6, 6.5], target: [0, 0, 0] },
}

type Vec3 = [number, number, number]

/** Eases the camera between per-module presets instead of jump-cutting on
 * module switch. Purely imperative — no React re-render per frame. */
export function CameraRig({ module }: { module: ModuleId }) {
  const { camera } = useThree()
  const target = useRef(new THREE.Vector3(...CAMERA_PRESETS[module].target))
  const lookTarget = useRef(new THREE.Vector3(...CAMERA_PRESETS[module].target))

  useFrame((_, delta) => {
    const preset = CAMERA_PRESETS[module]
    target.current.set(...preset.position)
    lookTarget.current.set(...preset.target)

    const damp = 1 - Math.exp(-delta * 2.2)
    camera.position.lerp(target.current, damp)

    const currentLook = new THREE.Vector3()
    camera.getWorldDirection(currentLook)
    const desiredLook = lookTarget.current.clone().sub(camera.position).normalize()
    const blended = currentLook.lerp(desiredLook, damp)
    camera.lookAt(camera.position.clone().add(blended))
  })

  return null
}
