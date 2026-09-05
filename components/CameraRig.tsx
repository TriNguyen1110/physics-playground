"use client"

import * as THREE from "three"
import { useEffect, useRef } from "react"
import { useFrame, useThree } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib"
import type { ModuleId } from "@/components/modules/types"

// projectiles: re-tuned again — the previous preset (position [-6,10,34],
// target [14,4,0]) put the launch point/ground/wall ~36 units from the
// camera, which combined with the old fog far=70 and low-emissive ground
// material made everything read as flat black (the "empty canvas" bug: not
// a missing mesh, a visibility/framing one). This preset sits closer
// (~26 units to the resting ball at origin) and lower, looking slightly
// down the launch direction so the ground plane fills the lower half of
// frame and the wall (default wall_distance=12) sits clearly inside it.
// Verified live at both the slider defaults (speed 20/angle 45/gravity
// 9.81, apex ~10m/range ~41m) and the reported bug params (speed 27.5/angle
// 71/gravity 9, apex ~37.5m/range ~52m) — ground+wall+ball all visible at
// rest and through flight in both cases; very steep/fast slider extremes
// can still carry the ball above the top of frame mid-flight, which is an
// acceptable, much lesser issue than the previous "nothing renders at all".
const CAMERA_PRESETS: Record<ModuleId, { position: Vec3; target: Vec3 }> = {
  light: { position: [0, 3.2, 7.5], target: [0, 0.6, 0] },
  projectiles: { position: [-2, 10, 24], target: [8, 4, 0] },
  fields: { position: [0, 6, 6.5], target: [0, 0, 0] },
}

type Vec3 = [number, number, number]

// projectiles' preset sits ~27 units from its target (see the comment above),
// light/fields sit within ~10 — cap free-orbit zoom-out per module so panning
// out on the small modules can't fly off into the empty void, while
// projectiles still has room to pull back and see the whole range.
const MAX_ORBIT_DISTANCE: Record<ModuleId, number> = {
  light: 18,
  projectiles: 70,
  fields: 18,
}
const MIN_ORBIT_DISTANCE = 1.5

/** Eases the camera between per-module presets on module switch (the
 * "landing shot"), then hands off to drei's OrbitControls for free
 * look/pan/zoom once the user actually grabs the mouse. The eased lerp only
 * fights OrbitControls while `userTookOver` is false — the moment the user
 * drags/zooms/pans, this effect stops touching camera.position/lookAt for
 * the rest of that module's visit, and OrbitControls owns the camera
 * outright. Switching modules resets the flag so the next module still gets
 * its own eased preset transition before free-look re-engages. */
export function CameraRig({ module }: { module: ModuleId }) {
  const { camera } = useThree()
  const target = useRef(new THREE.Vector3(...CAMERA_PRESETS[module].position))
  const lookTarget = useRef(new THREE.Vector3(...CAMERA_PRESETS[module].target))
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const userTookOver = useRef(false)

  useEffect(() => {
    userTookOver.current = false
  }, [module])

  useFrame((_, delta) => {
    const preset = CAMERA_PRESETS[module]
    target.current.set(...preset.position)
    lookTarget.current.set(...preset.target)

    if (userTookOver.current) return // OrbitControls owns the camera now

    const damp = 1 - Math.exp(-delta * 2.2)
    camera.position.lerp(target.current, damp)

    const currentLook = new THREE.Vector3()
    camera.getWorldDirection(currentLook)
    const desiredLook = lookTarget.current.clone().sub(camera.position).normalize()
    const blended = currentLook.lerp(desiredLook, damp)
    camera.lookAt(camera.position.clone().add(blended))

    // Ride OrbitControls' target along with the eased look-at point so the
    // instant the user grabs the mouse, orbiting starts from wherever the
    // camera was already looking instead of snapping to a stale target.
    controlsRef.current?.target.copy(lookTarget.current)
  })

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enableZoom
      enablePan
      enableRotate
      minDistance={MIN_ORBIT_DISTANCE}
      maxDistance={MAX_ORBIT_DISTANCE[module]}
      maxPolarAngle={Math.PI * 0.49}
      onStart={() => {
        userTookOver.current = true
      }}
    />
  )
}
