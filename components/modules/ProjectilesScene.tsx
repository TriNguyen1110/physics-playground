"use client"

import { memo, useRef, useState, type MutableRefObject } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { BallCollider, CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { PALETTE } from "@/components/palette"
import { step as projectilesStep } from "@/lib/physics/projectiles"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

// Ground + walls are scene-owned set pieces, not part of engine's step() —
// engine's projectiles.step() only returns the launch object + closed-form
// apex/range (see lib/physics/projectiles.ts). `wall_distance`/`wall_height`
// are extra keys on the same params object; step() simply ignores them.
const GROUND_Y = -0.15
// Half-height of the ground's own CuboidCollider/box below — kept as a
// named constant (not re-hardcoded at each use site) so the ground's
// actual top surface Y (GROUND_SURFACE_Y below) can never drift out of
// sync with the collider/mesh it's describing.
const GROUND_HALF_HEIGHT = 0.15
const GROUND_SURFACE_Y = GROUND_Y + GROUND_HALF_HEIGHT

// engine-09 gave the launch velocity a real Z-component whenever
// azimuth_deg != 0 (full 3D launch direction, not just the original X-Y
// plane) — the ground/obstacle colliders below were previously a thin strip
// in Z (+/-3m) sized only for the old azimuth=0 case where nothing ever
// moved off the X axis. Widened to a square so a sideways launch still has
// ground to land on and obstacles it can plausibly hit, matching the same
// range math (up to a few hundred meters at slider extremes) in every
// horizontal direction, not just +X.
const GROUND_HALF_EXTENT = 200

// Second, fixed-position obstacle (task: "multiple things to bounce off
// of"). Unlike `wall_distance`/`wall_height` this one isn't slider-driven —
// a hardcoded second wall further out, tinted cyan (this module's secondary
// accent) so it reads as visually distinct from the primary maroon wall.
const WALL2_DISTANCE_M = 24
const WALL2_HEIGHT_M = 2.2

// Third obstacle: a tilted ramp/platform near the launch point, angled so a
// low, fast shot deflects upward off it instead of just skimming the
// ground — a second kind of "aha" (deflection) distinct from the
// clears-vs-hits-wall one. Fixed position/tilt, not slider-driven.
const RAMP_DISTANCE_M = 6
const RAMP_TILT_DEG = 18
const RAMP_SIZE: [number, number, number] = [2.4, 0.25, 3]

/**
 * Owns the actual Rapier `<Physics>` world: feeds the launch
 * position/velocity from engine's step() into a real RigidBody on
 * (re)launch and lets Rapier's solver produce the bounce/trajectory. Live
 * readouts are read straight off the RigidBody so they match what the
 * solver actually produced, not the closed-form guess.
 *
 * Wrapped in `memo`: `onReadouts` fires from a `useFrame` tick (~10Hz) and
 * bubbles a `setState` up to the page, which re-renders this component's
 * parent with referentially-new (but value-identical) `paramsRef`/`onReadouts`
 * props. Without `memo`, that re-render reaches the ball's `<RigidBody>`
 * every ~100ms; @react-three/rapier doesn't value-memoize its own options,
 * so its internal effect re-fires on every one of those re-renders and
 * re-calls `setTranslation`/`setRotation`/`setLinvel` on the *live* dynamic
 * body — stomping the solver's own integration (resetting velocity back to
 * the original launch vector, fighting the ground contact) and corrupting
 * the render sync so the mesh never visibly appears. `memo` keeps this
 * subtree from re-rendering on every readout tick so the RigidBody is only
 * touched on an actual (re)launch.
 */
export const ProjectilesScene = memo(function ProjectilesScene({
  paramsRef,
  onReadouts,
}: {
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  // "resting" = ball sits visibly at the launch point, not yet fired — the
  // page loads into this state (and stays there after a module switch)
  // instead of auto-firing on mount, so there's always something to see
  // before the user ever touches Launch. "flying" = a real dynamic
  // RigidBody has been fired and is under Rapier's solver.
  const [phase, setPhase] = useState<"resting" | "flying">("resting")
  const [launchId, setLaunchId] = useState(0)
  const [initial, setInitial] = useState<ScenarioState>(() => projectilesStep(paramsRef.current, 0))
  // `_launchToken` is a scene-owned, non-slider key that ControlPanel's
  // "Launch" button bumps directly on `paramsRef.current` (same ref the
  // sliders write to) — this is the ONLY thing that (re)fires the ball.
  // Dragging a slider alone only updates the resting preview below, it
  // never fires by itself, so there's exactly one obvious control for
  // "make the ball go" and it can be clicked repeatedly.
  const lastLaunchToken = useRef<number>(paramsRef.current._launchToken ?? 0)
  const bodyRef = useRef<RapierRigidBody>(null)
  const frameCount = useRef(0)

  // While resting, keep the closed-form preview readouts live as sliders
  // move, so the readout panel isn't frozen before the first launch.
  useFrame(() => {
    if (phase !== "resting") return
    const next = projectilesStep(paramsRef.current, 0)
    setInitial(next)
    onReadouts(next.readouts)
  })

  // Explicit (re)launch: only fires when `_launchToken` changes, i.e. only
  // when the Launch button was clicked — captures whatever the sliders read
  // right now.
  useFrame(() => {
    const token = paramsRef.current._launchToken ?? 0
    if (token !== lastLaunchToken.current) {
      lastLaunchToken.current = token
      const next = projectilesStep(paramsRef.current, 0)
      setInitial(next)
      setLaunchId((id) => id + 1)
      setPhase("flying")
      onReadouts(next.readouts)
    }
  })

  // Live readout straight from Rapier's solver, throttled to ~10Hz — plenty
  // fast to look continuous, cheap enough not to matter.
  useFrame(() => {
    if (phase !== "flying") return
    frameCount.current += 1
    if (frameCount.current % 6 !== 0) return
    const body = bodyRef.current
    if (!body) return
    const p = body.translation()
    const v = body.linvel()
    const speed = Math.hypot(v.x, v.y, v.z)
    onReadouts([
      ...initial.readouts,
      { label: "live height (Rapier)", value: `${p.y.toFixed(2)} m` },
      { label: "live speed (Rapier)", value: `${speed.toFixed(2)} m/s` },
    ])
  })

  const projectile = initial.objects.find((o) => o.id === "projectile")
  const gravity = (projectile?.meta?.gravity as number) ?? paramsRef.current.gravity ?? 9.81
  const wallDistance = paramsRef.current.wall_distance ?? 8
  const wallHeight = paramsRef.current.wall_height ?? 0

  // engine-04: step() still returns a fixed radius:0.3 on the object itself
  // (see lib/physics/projectiles.ts) — radius_m only changes the drag
  // coefficient there. Scene reads meta.radius_m directly so a bigger
  // radius_m slider value is also a visibly bigger rendered/collider
  // sphere, independent of whether drag is on.
  const visualRadius = (projectile?.meta?.radius_m as number) ?? projectile?.radius ?? 0.3
  // Ball's actual launch/resting Y must sit exactly on the ground's real
  // top surface (GROUND_SURFACE_Y) plus the CURRENT radius, not a fixed
  // offset — step()'s own launchPosition.y (0.05) was tuned for the old
  // fixed radius:0.3 case and clips into the ground once radius_m is
  // dragged bigger (bug report: ball visibly sinks into the ground/ramp at
  // radius_m=0.51). Recomputed here from the live radius on every render so
  // it tracks the radius_m slider across its full [0.01, 1] range.
  const launchPosition: [number, number, number] = projectile
    ? [projectile.position[0], GROUND_SURFACE_Y + visualRadius, projectile.position[2]]
    : [0, GROUND_SURFACE_Y + visualRadius, 0]
  const massKg = (projectile?.meta?.mass_kg as number) ?? 1
  const dragEnabled = Boolean(projectile?.meta?.drag_enabled)
  // Read directly from step()'s own meta.drag_k (= DRAG_COEFFICIENT *
  // radius_m, already computed by lib/physics/projectiles.ts) instead of
  // duplicating that constant here — guarantees the real per-frame Rapier
  // force below uses the EXACT same coefficient as the closed-form
  // apex/range/terminal-velocity readout it's being checked against.
  const dragK = (projectile?.meta?.drag_k as number) ?? 0

  // Real per-frame linear drag on the flying Rapier body: F_drag = -k*v.
  // This is what makes the rendered trajectory actually track the
  // drag-adjusted readout instead of just trusting the closed-form numbers
  // while Rapier quietly simulates a vacuum. `addForce` only lasts one
  // physics step, so it's re-applied every frame for as long as the ball
  // is flying and drag is on.
  useFrame(() => {
    if (phase !== "flying") return
    if (!dragEnabled || dragK <= 0) return
    const body = bodyRef.current
    if (!body) return
    const v = body.linvel()
    body.addForce({ x: -dragK * v.x, y: -dragK * v.y, z: -dragK * v.z }, true)
  })

  return (
    <Physics gravity={[0, -gravity, 0]}>
      <RigidBody type="fixed" colliders={false} position={[0, GROUND_Y, 0]}>
        {/* Half-extent 200m in x AND z (was 3m in z): sliders reach
            speed=60/angle=45/gravity=1, whose closed-form range is in the
            hundreds of meters — a ground that only spans +/-25m (the
            original size) is flown past well before the ball ever descends
            back to y=0, so it never re-contacts the ground and just
            free-falls forever. Even the *default* params (speed 20, angle
            45, gravity 9.81 -> range ~40.8m) already exceeded the old
            +/-25m half-width. Squared off in z (was a 3m-wide strip) so a
            nonzero azimuth_deg launch — which now has a real Z velocity
            component (see lib/physics/projectiles.ts engine-09) — still has
            ground to land on off the original X axis instead of free-falling
            past the strip's edge. */}
        <CuboidCollider
          args={[GROUND_HALF_EXTENT, GROUND_HALF_HEIGHT, GROUND_HALF_EXTENT]}
          restitution={0.55}
          friction={0.4}
        />
        <ObjectRenderer
          object={{
            id: "ground",
            kind: "box",
            position: [0, 0, 0],
            // Locked palette: silver-tinted, neutral structure.
            color: PALETTE.silver,
            meta: { size: [GROUND_HALF_EXTENT * 2, 0.3, GROUND_HALF_EXTENT * 2] },
          }}
        />
      </RigidBody>

      {wallHeight > 0 && (
        <RigidBody
          key={`wall-${launchId}`}
          type="fixed"
          colliders={false}
          position={[wallDistance, wallHeight / 2, 0]}
        >
          {/* z half-extent widened 1.5->4 for the same azimuth reason as the
              ground above — a sideways launch can still clear/hit this wall
              instead of missing it out-of-plane no matter what az is. */}
          <CuboidCollider args={[0.2, wallHeight / 2, 4]} restitution={0.55} friction={0.4} />
          <ObjectRenderer
            object={{
              id: "wall",
              kind: "box",
              position: [0, 0, 0],
              // Locked palette: maroon is this module's accent glow.
              color: PALETTE.maroon,
              meta: { size: [0.4, wallHeight, 8] },
            }}
          />
        </RigidBody>
      )}

      {/* Second obstacle: fixed-position (not slider-driven) second wall
          further downrange, tinted cyan (this module's secondary accent) so
          it reads as visually distinct from the primary maroon wall — a
          fast enough shot that clears wall 1 now has a second thing to
          clear or hit, instead of open field after the first wall. */}
      <RigidBody type="fixed" colliders={false} position={[WALL2_DISTANCE_M, WALL2_HEIGHT_M / 2, 0]}>
        <CuboidCollider args={[0.2, WALL2_HEIGHT_M / 2, 4]} restitution={0.55} friction={0.4} />
        <ObjectRenderer
          object={{
            id: "wall2",
            kind: "box",
            position: [0, 0, 0],
            color: PALETTE.cyan,
            meta: { size: [0.4, WALL2_HEIGHT_M, 8] },
          }}
        />
      </RigidBody>

      {/* Third obstacle: a fixed, tilted ramp/platform close to the launch
          point — a low, fast shot can clip it and get deflected upward
          instead of just skimming the ground, a distinct "aha" from
          clearing/hitting a vertical wall. Rotated about Z so its face
          tilts toward the incoming ball. */}
      <RigidBody
        type="fixed"
        colliders={false}
        position={[RAMP_DISTANCE_M, 0.3, 0]}
        rotation={[0, 0, THREE.MathUtils.degToRad(RAMP_TILT_DEG)]}
      >
        <CuboidCollider args={[RAMP_SIZE[0] / 2, RAMP_SIZE[1] / 2, RAMP_SIZE[2] / 2]} restitution={0.6} friction={0.3} />
        <ObjectRenderer
          object={{
            id: "ramp",
            kind: "box",
            position: [0, 0, 0],
            // White (not silver, to avoid blending into the same-hued ground
            // plane right next to it) so it reads as a distinct structure.
            color: PALETTE.white,
            meta: { size: RAMP_SIZE },
          }}
        />
      </RigidBody>

      {/* Resting: a fixed body sitting visibly at the launch point before
          the user has ever clicked Launch (or right after a slider change,
          since dragging alone no longer fires the ball). */}
      {projectile && phase === "resting" && (
        <RigidBody key={`rest-${launchId}`} type="fixed" colliders={false} position={launchPosition}>
          <BallCollider args={[visualRadius]} />
          <ObjectRenderer object={{ ...projectile, radius: visualRadius, color: PALETTE.white, position: [0, 0, 0] }} />
        </RigidBody>
      )}

      {projectile && phase === "flying" && (
        <RigidBody
          key={`ball-${launchId}`}
          ref={bodyRef}
          type="dynamic"
          colliders={false}
          position={launchPosition}
          linearVelocity={projectile.velocity}
          mass={massKg}
          ccd
        >
          <BallCollider args={[visualRadius]} restitution={0.55} friction={0.4} />
          <ObjectRenderer object={{ ...projectile, radius: visualRadius, color: PALETTE.white, position: [0, 0, 0] }} />
        </RigidBody>
      )}
    </Physics>
  )
})
