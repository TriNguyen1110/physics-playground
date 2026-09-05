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
//
// "hub" is the new neutral starting shot (per Tri's repeated feedback: the
// camera should start from a main/overview position and go IN to a module,
// not hard-cut straight to a preset). It's a pulled-back, elevated vantage
// roughly centered over where all three module presets sit (light/fields
// near the origin, projectiles out along +X) so it reads as "looking at the
// whole shared splat room" rather than favoring any one module. It's the
// camera's actual position on page load (see app/page.tsx's initial
// `cameraView` state) and whatever "Home" returns to.
export type CameraView = ModuleId | "hub"

const CAMERA_PRESETS: Record<CameraView, { position: Vec3; target: Vec3 }> = {
  hub: { position: [4, 17, 36], target: [4, 2, 0] },
  light: { position: [0, 3.2, 7.5], target: [0, 0.6, 0] },
  projectiles: { position: [-2, 10, 24], target: [8, 4, 0] },
  fields: { position: [0, 6, 6.5], target: [0, 0, 0] },
}

type Vec3 = [number, number, number]

// projectiles' preset sits ~27 units from its target (see the comment above),
// light/fields sit within ~10, hub is pulled back further still — cap
// free-orbit zoom-out per view so panning out on the small modules can't fly
// off into the empty void, while projectiles/hub have room to pull back and
// see more of the room.
const MAX_ORBIT_DISTANCE: Record<CameraView, number> = {
  hub: 90,
  light: 18,
  projectiles: 70,
  fields: 18,
}
const MIN_ORBIT_DISTANCE = 1.5

// Hub<->module transitions should read as "traveling into/out of a room":
// slower than a plain module<->module tab switch, and arced upward at the
// midpoint (a little lift-and-descend) instead of a straight line, so it
// feels like pulling back/swooping in rather than a snap between two
// disconnected preset positions. Module<->module stays snappier/flatter —
// it's a smaller move (walking between two things already in view).
const HUB_TRANSITION_SECONDS = 2.2
const MODULE_TRANSITION_SECONDS = 1.0
const HUB_ARC_HEIGHT = 7

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Eases the camera between "views" — the hub overview or a per-module
 * preset — on switch (the "landing shot"/"room entry"), then hands off to
 * drei's OrbitControls for free look/pan/zoom once the user actually grabs
 * the mouse. The eased tween only fights OrbitControls while
 * `userTookOver` is false — the moment the user drags/zooms/pans, this
 * effect stops touching camera.position/lookAt for the rest of that view's
 * visit, and OrbitControls owns the camera outright. Switching views resets
 * the flag so the next view still gets its own eased transition before
 * free-look re-engages.
 *
 * Unlike the old plain exponential lerp, this runs an explicit timed tween
 * (start pos/look captured the instant `view` changes -> eased to the new
 * preset's pos/look) so the hub<->module case can be deliberately slower
 * and arced (see HUB_TRANSITION_SECONDS/HUB_ARC_HEIGHT above) to read as
 * "traveling into/out of a room" rather than a straight-line snap, while
 * module<->module stays a quicker, flatter move. */
export function CameraRig({ view }: { view: CameraView }) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const userTookOver = useRef(false)

  // Tween state: captured once per `view` change, then interpolated in
  // useFrame using elapsed wall-clock time (not a per-frame exponential
  // decay) so duration/arc are exact and tunable per transition type.
  const startPos = useRef(new THREE.Vector3(...CAMERA_PRESETS[view].position))
  const startLook = useRef(new THREE.Vector3(...CAMERA_PRESETS[view].target))
  const endPos = useRef(new THREE.Vector3(...CAMERA_PRESETS[view].position))
  const endLook = useRef(new THREE.Vector3(...CAMERA_PRESETS[view].target))
  const elapsed = useRef(0)
  const duration = useRef(MODULE_TRANSITION_SECONDS)
  const arcHeight = useRef(0)
  const prevView = useRef<CameraView>(view)

  useEffect(() => {
    userTookOver.current = false
    elapsed.current = 0

    const involvesHub = view === "hub" || prevView.current === "hub"
    duration.current = involvesHub ? HUB_TRANSITION_SECONDS : MODULE_TRANSITION_SECONDS
    arcHeight.current = involvesHub ? HUB_ARC_HEIGHT : 0

    // Start the tween from wherever the camera actually is right now (not
    // the previous preset), so rapid re-clicks don't jump.
    startPos.current.copy(camera.position)
    const currentLookDir = new THREE.Vector3()
    camera.getWorldDirection(currentLookDir)
    startLook.current.copy(camera.position).add(currentLookDir)

    endPos.current.set(...CAMERA_PRESETS[view].position)
    endLook.current.set(...CAMERA_PRESETS[view].target)

    prevView.current = view
  }, [view, camera])

  useFrame((_, delta) => {
    if (userTookOver.current) return // OrbitControls owns the camera now

    elapsed.current = Math.min(elapsed.current + delta, duration.current)
    const t = duration.current > 0 ? elapsed.current / duration.current : 1
    const eased = easeInOutCubic(t)

    const pos = startPos.current.clone().lerp(endPos.current, eased)
    // Lift-and-descend arc, peaking at the midpoint of the transition —
    // this is what makes a hub<->module move read as "approaching, then
    // entering" instead of a straight-line slide.
    pos.y += Math.sin(Math.PI * eased) * arcHeight.current
    camera.position.copy(pos)

    const look = startLook.current.clone().lerp(endLook.current, eased)
    camera.lookAt(look)

    // Ride OrbitControls' target along with the eased look-at point so the
    // instant the user grabs the mouse, orbiting starts from wherever the
    // camera was already looking instead of snapping to a stale target.
    controlsRef.current?.target.copy(endLook.current)
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
      maxDistance={MAX_ORBIT_DISTANCE[view]}
      maxPolarAngle={Math.PI * 0.49}
      onStart={() => {
        userTookOver.current = true
      }}
    />
  )
}
