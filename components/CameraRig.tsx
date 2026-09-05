"use client"

import * as THREE from "three"
import { useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import type { ModuleId } from "@/components/modules/types"

// projectiles: pulled back/widened from the original [-2,4,11]->[2,1,0] preset.
// At the *default* slider values (speed 20, angle 45, gravity 9.81) the
// closed-form apex height is ~10.2m and range ~40.8m (see
// lib/physics/projectiles.ts) — the original preset only framed a ~12m-wide
// patch around the origin, so the ball flew out of the camera's FOV almost
// immediately after launch and looked like it never rendered at all. This
// preset frames roughly x:[-3,31], y:[-13,21] at the default fov=45, which
// covers the default arc (and the wall at wall_distance=12) with room to
// spare. Scene.tsx's fog far distance was bumped 30->70 alongside this so
// the launch point (~36 units from this camera) isn't faded into the void
// background before the ball even gets going.
const CAMERA_PRESETS: Record<ModuleId, { position: Vec3; target: Vec3 }> = {
  light: { position: [0, 3.2, 7.5], target: [0, 0.6, 0] },
  projectiles: { position: [-6, 10, 34], target: [14, 4, 0] },
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
