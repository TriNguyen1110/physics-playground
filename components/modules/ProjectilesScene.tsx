"use client"

import { memo, useMemo, useRef, useState, type MutableRefObject } from "react"
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

// Fourth obstacle (projectiles-multiball-platforms-01): a flat horizontal
// platform a ball can land and rest on, distinct from the tilted ramp
// (which deflects) — this one is meant to be landed ON. Fixed, not
// slider-driven, positioned further out than the ramp so a mid-range shot
// can clear the first wall and land on the platform instead of the ground.
const PLATFORM_DISTANCE_M = 16
const PLATFORM_HEIGHT_M = 1.6
const PLATFORM_SIZE: [number, number, number] = [3.2, 0.35, 4.5]

// projectiles-multiball-platforms-01: instead of one ball that gets reset on
// every Launch click, each click spawns a NEW ball so different launches can
// be compared side by side. Capped so the Rapier world doesn't grow
// unbounded across a long demo session — oldest balls fall off the front of
// the queue once the cap is exceeded.
const MAX_BALLS = 6

type FlyingBall = {
  id: number
  position: [number, number, number]
  velocity: [number, number, number]
  mass: number
  radius: number
  dragEnabled: boolean
  dragK: number
}

// --- Spring launcher visual (bug fix: launch_mode=spring had a correct
// readout but no visible spring mechanism in the 3D scene) ---
//
// A stylized coiled helix built once as a unit-length (1m, centered on
// local Z from -0.5 to +0.5) TubeGeometry, then scaled along its local Z
// axis every render to the CURRENT visible length — this is what makes a
// bigger spring_compression_m slider value visibly shrink/compact the coil
// instead of just changing a number, without rebuilding geometry every
// frame (cheap, and keeps slider response instant per scene.md's "driven
// every frame" rule since it flows through the same `initial` state the
// resting ball preview already uses).
const SPRING_TURNS = 8
const SPRING_COIL_RADIUS_M = 0.16
const SPRING_TUBE_RADIUS_M = 0.045
// Relaxed (uncompressed) visible length and how much length is lost per
// meter of spring_compression_m (range [0, 2]) — clamped to a minimum so the
// coil never visually collapses to nothing and stays recognizable as a
// spring even at max compression.
const SPRING_RELAXED_LENGTH_M = 1.4
const SPRING_LENGTH_LOST_PER_COMPRESSION_M = 0.5
const SPRING_MIN_LENGTH_M = 0.4

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private turns: number, private coilRadius: number) {
    super()
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    const angle = t * Math.PI * 2 * this.turns
    return target.set(Math.cos(angle) * this.coilRadius, Math.sin(angle) * this.coilRadius, t - 0.5)
  }
}

/**
 * Owns the actual Rapier `<Physics>` world: feeds the launch
 * position/velocity from engine's step() into a real RigidBody on each
 * launch and lets Rapier's solver produce the bounce/trajectory. Live
 * readouts are read straight off the RigidBody so they match what the
 * solver actually produced, not the closed-form guess.
 *
 * Wrapped in `memo`: `onReadouts` fires from a `useFrame` tick (~10Hz) and
 * bubbles a `setState` up to the page, which re-renders this component's
 * parent with referentially-new (but value-identical) `paramsRef`/`onReadouts`
 * props. Without `memo`, that re-render reaches the balls' `<RigidBody>`
 * elements every ~100ms; @react-three/rapier doesn't value-memoize its own
 * options, so its internal effect re-fires on every one of those re-renders
 * and re-calls `setTranslation`/`setRotation`/`setLinvel` on the *live*
 * dynamic body — stomping the solver's own integration and corrupting the
 * render sync so the mesh never visibly appears. `memo` keeps this subtree
 * from re-rendering on every readout tick so a ball's RigidBody is only
 * touched on its own (re)launch.
 */
export const ProjectilesScene = memo(function ProjectilesScene({
  paramsRef,
  onReadouts,
}: {
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  const [initial, setInitial] = useState<ScenarioState>(() => projectilesStep(paramsRef.current, 0))
  // `_launchToken` is a scene-owned, non-slider key that ControlPanel's
  // "Launch" button bumps directly on `paramsRef.current` (same ref the
  // sliders write to) — this is the ONLY thing that spawns a new ball.
  // Dragging a slider alone only updates the resting preview below, it
  // never fires by itself, so there's exactly one obvious control for
  // "make a ball go" and it can be clicked repeatedly to compare launches.
  const lastLaunchToken = useRef<number>(paramsRef.current._launchToken ?? 0)
  // `launchId` only keys the wall/resting-preview RigidBodies below (forces
  // a remount so a fixed body's collider args pick up a changed slider
  // value on the next launch, since Rapier's bindings don't reliably hot-
  // swap collider args on a live fixed body) — it does NOT gate which balls
  // exist; that's `balls` below.
  const [launchId, setLaunchId] = useState(0)
  const [balls, setBalls] = useState<FlyingBall[]>([])
  const bodyRefs = useRef<Map<number, RapierRigidBody>>(new Map())
  const nextBallId = useRef(0)
  const frameCount = useRef(0)

  const springGeometry = useMemo(
    () => new THREE.TubeGeometry(new HelixCurve(SPRING_TURNS, SPRING_COIL_RADIUS_M), SPRING_TURNS * 16, SPRING_TUBE_RADIUS_M, 8, false),
    []
  )

  // Keep the closed-form preview (and the resting ball / spring visuals
  // derived from it below) live as sliders move — every frame, not gated
  // behind a throttled React re-render, so dragging a slider feels instant.
  useFrame(() => {
    const next = projectilesStep(paramsRef.current, 0)
    setInitial(next)
  })

  // Explicit launch: only fires when `_launchToken` changes, i.e. only when
  // the Launch button was clicked — captures whatever the sliders read
  // right now and spawns a NEW ball rather than resetting an existing one.
  useFrame(() => {
    const token = paramsRef.current._launchToken ?? 0
    if (token === lastLaunchToken.current) return
    lastLaunchToken.current = token
    const next = projectilesStep(paramsRef.current, 0)
    setInitial(next)
    setLaunchId((id) => id + 1)

    const launched = next.objects.find((o) => o.id === "projectile")
    if (launched) {
      const radius = (launched.meta?.radius_m as number) ?? launched.radius ?? 0.3
      const mass = (launched.meta?.mass_kg as number) ?? 1
      const dragEnabled = Boolean(launched.meta?.drag_enabled)
      const dragK = (launched.meta?.drag_k as number) ?? 0
      const id = nextBallId.current++
      const spawnPosition: [number, number, number] = [
        launched.position[0],
        GROUND_SURFACE_Y + radius,
        launched.position[2],
      ]
      const spawned: FlyingBall = {
        id,
        position: spawnPosition,
        velocity: launched.velocity as [number, number, number],
        mass,
        radius,
        dragEnabled,
        dragK,
      }
      setBalls((prev) => {
        const merged = [...prev, spawned]
        return merged.length > MAX_BALLS ? merged.slice(merged.length - MAX_BALLS) : merged
      })
    }
    onReadouts(next.readouts)
  })

  // Live readout straight from the most recently launched ball's Rapier
  // body, throttled to ~10Hz — plenty fast to look continuous, cheap enough
  // not to matter.
  useFrame(() => {
    frameCount.current += 1
    if (frameCount.current % 6 !== 0) return
    const latest = balls[balls.length - 1]
    const body = latest ? bodyRefs.current.get(latest.id) : undefined
    if (!body) {
      onReadouts(initial.readouts)
      return
    }
    const p = body.translation()
    const v = body.linvel()
    const speed = Math.hypot(v.x, v.y, v.z)
    onReadouts([
      ...initial.readouts,
      { label: "live height (Rapier)", value: `${p.y.toFixed(2)} m` },
      { label: "live speed (Rapier)", value: `${speed.toFixed(2)} m/s` },
      { label: "balls in flight", value: `${balls.length}/${MAX_BALLS}` },
    ])
  })

  // Real per-frame linear drag on each flying ball: F_drag = -k*v, using
  // that ball's OWN drag settings captured at its own launch time (not the
  // current live sliders, which may have moved since) — this is what makes
  // the rendered trajectory of each ball actually track the drag-adjusted
  // readout it was launched with instead of Rapier quietly simulating a
  // vacuum, or a later slider change retroactively changing an
  // already-flying ball's drag.
  useFrame(() => {
    for (const ball of balls) {
      if (!ball.dragEnabled || ball.dragK <= 0) continue
      const body = bodyRefs.current.get(ball.id)
      if (!body) continue
      const v = body.linvel()
      body.addForce({ x: -ball.dragK * v.x, y: -ball.dragK * v.y, z: -ball.dragK * v.z }, true)
    }
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

  // Spring launcher visual: only meaningful in spring mode. Reads its
  // inputs straight off the live `projectile.meta` (same numbers the
  // readout panel shows) rather than re-deriving from raw params, so the
  // spring's visible compression can never drift from what's displayed.
  const springModeActive = projectile?.meta?.launch_mode === "spring"
  const springCompressionM = (projectile?.meta?.spring_compression_m as number) ?? 0.3
  const angleDeg = (projectile?.meta?.angle_deg as number) ?? 45
  const azimuthDeg = (projectile?.meta?.azimuth_deg as number) ?? 0
  const springLengthM = Math.max(
    SPRING_RELAXED_LENGTH_M - SPRING_LENGTH_LOST_PER_COMPRESSION_M * springCompressionM,
    SPRING_MIN_LENGTH_M
  )
  const launchDirection = new THREE.Vector3(
    Math.cos(THREE.MathUtils.degToRad(angleDeg)) * Math.cos(THREE.MathUtils.degToRad(azimuthDeg)),
    Math.sin(THREE.MathUtils.degToRad(angleDeg)),
    Math.cos(THREE.MathUtils.degToRad(angleDeg)) * Math.sin(THREE.MathUtils.degToRad(azimuthDeg))
  ).normalize()
  const springQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), launchDirection)
  // Center the coil behind the ball, touching its surface, along the
  // launch direction's reverse — as springLengthM shrinks (more
  // compression) this offset shrinks too, so a heavily compressed spring
  // visibly tucks in closer to the ball instead of floating in place.
  const springCenterOffset = visualRadius + springLengthM / 2
  const springPosition: [number, number, number] = [
    launchPosition[0] - launchDirection.x * springCenterOffset,
    launchPosition[1] - launchDirection.y * springCenterOffset,
    launchPosition[2] - launchDirection.z * springCenterOffset,
  ]

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

      {/* Fourth obstacle (projectiles-multiball-platforms-01): a flat
          horizontal platform further downrange than the ramp — something a
          ball can land and rest ON, distinct from the ramp's deflection and
          the walls' block-or-clear. High friction/moderate restitution so a
          landing ball settles instead of bouncing forever. */}
      <RigidBody type="fixed" colliders={false} position={[PLATFORM_DISTANCE_M, PLATFORM_HEIGHT_M, 0]}>
        <CuboidCollider
          args={[PLATFORM_SIZE[0] / 2, PLATFORM_SIZE[1] / 2, PLATFORM_SIZE[2] / 2]}
          restitution={0.35}
          friction={0.6}
        />
        <ObjectRenderer
          object={{
            id: "platform",
            kind: "box",
            position: [0, 0, 0],
            color: PALETTE.cyan,
            meta: { size: PLATFORM_SIZE },
          }}
        />
      </RigidBody>

      {/* Resting preview: always visible at the current launch point,
          reflecting whatever the sliders currently read (radius/position),
          independent of how many balls have already been launched — this
          is "the next shot, loaded and waiting." */}
      {projectile && (
        <RigidBody key={`rest-${launchId}`} type="fixed" colliders={false} position={launchPosition}>
          <BallCollider args={[visualRadius]} />
          <ObjectRenderer object={{ ...projectile, radius: visualRadius, color: PALETTE.white, position: [0, 0, 0] }} />
        </RigidBody>
      )}

      {/* Spring launcher visual (bug fix): a coiled helix rendered behind
          the resting ball along its launch direction whenever launch_mode
          is spring. Only a `scale.z` change per render — no geometry
          rebuild — so it tracks the spring_compression_m slider instantly,
          visibly shrinking/compacting as compression increases. Hidden
          entirely in manual mode. */}
      {springModeActive && projectile && (
        <group position={springPosition} quaternion={springQuaternion} scale={[1, 1, springLengthM]}>
          <mesh geometry={springGeometry}>
            <meshStandardMaterial
              color={PALETTE.maroon}
              emissive={PALETTE.maroon}
              emissiveIntensity={0.85}
              roughness={0.35}
              metalness={0.6}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {/* Flying balls: one dynamic RigidBody per launch (up to MAX_BALLS),
          each keeping its own launch snapshot (position/velocity/mass/
          radius/drag) so relaunching or changing sliders never retroactively
          alters a ball already in flight. */}
      {balls.map((ball) => (
        <RigidBody
          key={`ball-${ball.id}`}
          ref={(instance) => {
            if (instance) bodyRefs.current.set(ball.id, instance)
            else bodyRefs.current.delete(ball.id)
          }}
          type="dynamic"
          colliders={false}
          position={ball.position}
          linearVelocity={ball.velocity}
          mass={ball.mass}
          ccd
        >
          <BallCollider args={[ball.radius]} restitution={0.55} friction={0.4} />
          <ObjectRenderer
            object={{
              id: `ball-${ball.id}`,
              kind: "sphere",
              position: [0, 0, 0],
              color: PALETTE.white,
              radius: ball.radius,
            }}
          />
        </RigidBody>
      ))}
    </Physics>
  )
})
