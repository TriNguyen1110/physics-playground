"use client"

import { memo, useMemo, useRef, useState, type MutableRefObject } from "react"
import { useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { TransformControls } from "@react-three/drei"
import { BallCollider, CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { PALETTE } from "@/components/palette"
import { step as projectilesStep } from "@/lib/physics/projectiles"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

// --- CRUD stage 2 (crud-projectiles-01) -------------------------------------------------------
// Follows the pattern established in FieldsScene (crud-fields-01, commit deea424): drei's
// `TransformControls`, `onObjectChange` reading the dragged Object3D's live position and writing
// back into a real value, position given as a DIRECT prop on `<TransformControls>` itself (never
// relying on it being inherited from a `children` group — that collapses every gizmo onto world
// origin, a bug already shipped once in the fields tick).
//
// Three different honesty tiers here, same bar as crud-fields-01's test-particle finding:
//  1. Primary wall (wall_distance/wall_height): REAL ScenarioParams already read by this file.
//     Drag round-trips through paramsRef exactly like the sliders do — physics stays
//     authoritative, a drag and a slider drag are indistinguishable to the render.
//  2. Second wall / ramp / platform: hardcoded set-piece constants with NO backing ScenarioParams
//     (added in the layout-cleanup tick, and types.ts is out of scope this tick per file
//     restrictions). These get local `useState` position — genuinely draggable and their real
//     Rapier colliders follow (RigidBody position prop, not a visual-only offset), but it is
//     SCENE-LOCAL: a reload or a second Convex-synced client will not see the moved position.
//     Constrained to X/Z only so a drag can't undo the ramp/platform's own ground-contact Y math.
//  3. Launch point/spring: NOT draggable. `lib/physics/projectiles.ts`'s `launchPosition` is
//     hardcoded to `(0, 0.05, 0)` (line ~92) with no param feeding X/Z at all — same category as
//     fields' test-particle. Faking a free-drag handle on it would be decoration with nothing
//     behind it, so it deliberately has none.
//
// Drag handles are rendered as thin wireframe boxes (not the solid ObjectRenderer mesh) so
// dragging never produces two overlapping solid meshes — the REAL solid wall/obstacle mesh is
// still the one rendered by its own RigidBody below, driven by the same params/state this handle
// writes into, and it visibly follows within a frame since this file already re-renders every
// frame (the `setInitial` useFrame below).
function attachedObjectFrom(e: unknown): THREE.Object3D | undefined {
  const target = (e as { target?: { object?: THREE.Object3D } } | undefined)?.target
  return target?.object
}

const WALL_DISTANCE_MIN = 2
const WALL_DISTANCE_MAX = 40
const WALL_HEIGHT_MIN = 0
const WALL_HEIGHT_MAX = 10

// No backing params for these three, so the clamp ranges are just "keep it on the sensible part
// of the ground plane" (GROUND_HALF_EXTENT is 200, but a drag that far out would be pointless).
const OBSTACLE_X_MIN = 0
const OBSTACLE_X_MAX = 60
const OBSTACLE_Z_MIN = -20
const OBSTACLE_Z_MAX = 20

// Wall drag handle: translate-only on X/Y (matches the two real params it writes into), Z locked
// since the wall's real Z-extent/position isn't slider-driven at all. Y is the wall's CENTER
// (matches the RigidBody's own `position={[wallDistance, wallHeight / 2, 0]}` below), so dragging
// it maps back to wall_height via *2 — dragging the handle up doubles the wall's height, which
// reads naturally since the handle sits at the wall's visual midpoint.
function WallDragHandle({
  wallDistance,
  wallHeight,
  paramsRef,
}: {
  wallDistance: number
  wallHeight: number
  paramsRef: MutableRefObject<ScenarioParams>
}) {
  return (
    <TransformControls
      position={[wallDistance, wallHeight / 2, 0]}
      mode="translate"
      showX
      showY
      showZ={false}
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        const nextDistance = THREE.MathUtils.clamp(obj.position.x, WALL_DISTANCE_MIN, WALL_DISTANCE_MAX)
        const nextHeight = THREE.MathUtils.clamp(obj.position.y * 2, WALL_HEIGHT_MIN, WALL_HEIGHT_MAX)
        paramsRef.current = { ...paramsRef.current, wall_distance: nextDistance, wall_height: nextHeight }
      }}
    >
      <mesh>
        <boxGeometry args={[0.5, Math.max(wallHeight, 0.4), 8.4]} />
        <meshStandardMaterial color={PALETTE.maroon} wireframe transparent opacity={0.35} depthTest={false} />
      </mesh>
    </TransformControls>
  )
}

// Shared drag handle for the three scene-local (no-ScenarioParams) obstacles — X/Z translate
// only, Y fixed, so a drag can't lift them off their own already-correct ground-contact Y.
function ObstacleDragHandle({
  position,
  size,
  color,
  onDrag,
}: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  onDrag: (x: number, z: number) => void
}) {
  return (
    <TransformControls
      position={position}
      mode="translate"
      showX
      showY={false}
      showZ
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        onDrag(
          THREE.MathUtils.clamp(obj.position.x, OBSTACLE_X_MIN, OBSTACLE_X_MAX),
          THREE.MathUtils.clamp(obj.position.z, OBSTACLE_Z_MIN, OBSTACLE_Z_MAX)
        )
      }}
    >
      <mesh>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} wireframe transparent opacity={0.35} depthTest={false} />
      </mesh>
    </TransformControls>
  )
}

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
//
// Downrange (x) obstacle-course ordering, closest to farthest from launch:
// ramp (6) -> primary slider-driven wall (default 12, range [2,40]) ->
// platform (16) -> second fixed wall (24). Kept in this order (rather than
// the previous scattered/arbitrary x-values each obstacle was added with)
// so the scene reads as one intentional course instead of a pile of props.
const RAMP_DISTANCE_M = 6
const RAMP_TILT_DEG = 18
const RAMP_SIZE: [number, number, number] = [2.4, 0.25, 3]

// Fourth obstacle (projectiles-multiball-platforms-01): a flat horizontal
// platform a ball can land and rest on, distinct from the tilted ramp
// (which deflects) — this one is meant to be landed ON. Fixed, not
// slider-driven, positioned further out than the ramp so a mid-range shot
// can clear the first wall and land on the platform instead of the ground.
// PLATFORM_HEIGHT_M is the height of its TOP (landing) surface above
// GROUND_SURFACE_Y — deliberately elevated (not ground-level like the ramp)
// so landing on it reads as a distinct "aha" from resting on the ground; a
// purely cosmetic support pillar (no collider, doesn't touch Rapier setup)
// fills the visual gap underneath so it doesn't read as floating/disconnected.
const PLATFORM_DISTANCE_M = 16
const PLATFORM_HEIGHT_M = 1.6
const PLATFORM_SIZE: [number, number, number] = [3.2, 0.35, 4.5]
const PLATFORM_PILLAR_SIZE: [number, number] = [0.5, 0.5]

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
  // CRUD stage 2, local/scene-only state (see file-header note): wall2/ramp/platform have no
  // backing ScenarioParams, so their dragged position lives here instead of paramsRef. {x, z}
  // only — Y stays derived from the same ground-contact math as before.
  const [wall2XZ, setWall2XZ] = useState<{ x: number; z: number }>({ x: WALL2_DISTANCE_M, z: 0 })
  const [rampXZ, setRampXZ] = useState<{ x: number; z: number }>({ x: RAMP_DISTANCE_M, z: 0 })
  const [platformXZ, setPlatformXZ] = useState<{ x: number; z: number }>({ x: PLATFORM_DISTANCE_M, z: 0 })
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
  //
  // Bug fix (user-reported: "turning on air drag makes the balls oscillate
  // in 1 point"): the original approach called `body.addForce({x: -k*v.x,
  // ...})` every frame, which Rapier integrates as an explicit-Euler step —
  // v_next = v * (1 - (k/m)*dt). That update is only stable while
  // (k/m)*dt < 2; push past that (e.g. radius_m near its [0.01,1] max ->
  // k = DRAG_COEFFICIENT(2.5)*radius_m up to 2.5, combined with mass_kg
  // near its [0.1,50] min) and each step overshoots zero and FLIPS the
  // velocity's sign, so the ball never settles into a decaying arc — it
  // visibly vibrates back and forth around whatever point it was at when
  // drag "won", which is exactly the reported symptom. `addForce` also has
  // no way to know our intent is "decay toward zero, never past it," so it
  // can't self-correct.
  // Fix: skip Rapier's force accumulator entirely and apply the SAME exact
  // closed-form decay this module's own engine already uses for its tau
  // math (lib/physics/projectiles.ts: tau = mass_kg / k, v(t) = v0 *
  // exp(-t/tau)) directly to the body's linear velocity via `setLinvel`.
  // `Math.exp(-x)` is in (0, 1] for every x >= 0 — there is no k/m/dt
  // combination that can make this overshoot past zero or flip sign, so
  // it's unconditionally stable regardless of how high radius_m/dragK gets
  // or how large a single frame's delta is (e.g. a dropped/slow frame).
  // Gravity is untouched here — Rapier's own solver still integrates that
  // separately on its own fixed step, exactly as before; this only removes
  // this frame's drag-attributable share of velocity.
  useFrame((_state, delta) => {
    for (const ball of balls) {
      if (!ball.dragEnabled || ball.dragK <= 0) continue
      const body = bodyRefs.current.get(ball.id)
      if (!body) continue
      const v = body.linvel()
      const decay = Math.exp((-ball.dragK / ball.mass) * delta)
      body.setLinvel({ x: v.x * decay, y: v.y * decay, z: v.z * decay }, true)
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
  // Bug fix (screenshot-confirmed): the coil's Y was previously derived the
  // SAME way as X/Z — `launchPosition.y - launchDirection.y * springCenterOffset`
  // — but launchDirection.y is sin(angle_deg), which is POSITIVE for any
  // upward launch angle. Subtracting a positive offset*sin(angle) pulls the
  // whole coil down below GROUND_SURFACE_Y (e.g. at angle_deg=45,
  // radius_m=0.3 this landed ~0.35m underground), unlike X/Z where that math
  // is fine because there's no ground plane to clip through sideways.
  // Fixed the same way the ball's resting Y was fixed earlier: anchor the
  // coil's LOWEST point (its ground-facing end) to GROUND_SURFACE_Y (+ the
  // tube's own radius, so the mesh surface itself never clips into the
  // ground either), then let the coil rise from there toward the ball by
  // half its own length along the vertical component of the launch
  // direction. This holds for any launch_angle/azimuth/radius_m/compression
  // combo since it's derived straight from GROUND_SURFACE_Y instead of
  // being offset away from an already-correct ball height.
  const springHalfLengthM = springLengthM / 2
  const springBaseY = GROUND_SURFACE_Y + SPRING_TUBE_RADIUS_M
  const springPosition: [number, number, number] = [
    launchPosition[0] - launchDirection.x * springCenterOffset,
    springBaseY + springHalfLengthM * Math.abs(launchDirection.y),
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

      {/* CRUD stage 2: drag handle for the primary wall, always rendered (even at
          wall_height=0) so the wall can be dragged back up from nothing. Writes straight into
          paramsRef.current — see WallDragHandle above. */}
      <WallDragHandle wallDistance={wallDistance} wallHeight={wallHeight} paramsRef={paramsRef} />

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
          clear or hit, instead of open field after the first wall.
          CRUD stage 2: position is now local `wall2XZ` state (see file header) instead of the
          WALL2_DISTANCE_M constant directly, draggable via the handle below on X/Z. */}
      <ObstacleDragHandle
        position={[wall2XZ.x, WALL2_HEIGHT_M / 2, wall2XZ.z]}
        size={[0.6, WALL2_HEIGHT_M, 8.4]}
        color={PALETTE.cyan}
        onDrag={(x, z) => setWall2XZ({ x, z })}
      />
      <RigidBody type="fixed" colliders={false} position={[wall2XZ.x, WALL2_HEIGHT_M / 2, wall2XZ.z]}>
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
          tilts toward the incoming ball.

          Bug fix (screenshot-confirmed floating/clipping): the box's own
          center was previously hardcoded to y=0.3 regardless of tilt, which
          floats the high (uphill) end above the ground while clipping the
          low (downhill) end below it. Since the box is rotated about Z, its
          lowest world-space corner after rotation is offset from center by
          halfX*sin(tilt) + halfY*cos(tilt) (worst-case corner of a rotated
          rectangle) — anchoring the center at GROUND_SURFACE_Y plus that
          offset puts the ramp's downhill edge exactly on the ground, same
          "sits on the ground plane" bar as every other ground-relative
          object here, just accounting for the rotation.
          CRUD stage 2: X/Z now come from local `rampXZ` state instead of the RAMP_DISTANCE_M
          constant directly (Y stays derived from the same tilt math, untouched by the drag). */}
      <ObstacleDragHandle
        position={[
          rampXZ.x,
          GROUND_SURFACE_Y +
            (RAMP_SIZE[0] / 2) * Math.sin(THREE.MathUtils.degToRad(RAMP_TILT_DEG)) +
            (RAMP_SIZE[1] / 2) * Math.cos(THREE.MathUtils.degToRad(RAMP_TILT_DEG)),
          rampXZ.z,
        ]}
        size={RAMP_SIZE}
        color={PALETTE.white}
        onDrag={(x, z) => setRampXZ({ x, z })}
      />
      <RigidBody
        type="fixed"
        colliders={false}
        position={[
          rampXZ.x,
          GROUND_SURFACE_Y +
            (RAMP_SIZE[0] / 2) * Math.sin(THREE.MathUtils.degToRad(RAMP_TILT_DEG)) +
            (RAMP_SIZE[1] / 2) * Math.cos(THREE.MathUtils.degToRad(RAMP_TILT_DEG)),
          rampXZ.z,
        ]}
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
          landing ball settles instead of bouncing forever.

          Bug fix (screenshot-confirmed floating): the box's own center was
          previously set to y=PLATFORM_HEIGHT_M directly (its TOP surface
          height, not center), leaving it floating ~1.4m above the ground
          with nothing connecting it — same class of bug as the ramp above.
          Center is now derived so the TOP surface still lands exactly at
          GROUND_SURFACE_Y + PLATFORM_HEIGHT_M (same visual landing height as
          before), and a purely cosmetic support pillar (no collider — does
          not touch the collision/Rapier setup) fills the gap down to the
          ground so the platform reads as a structure standing on the
          ground plane instead of a disconnected floating slab.
          CRUD stage 2: X/Z now come from local `platformXZ` state instead of the
          PLATFORM_DISTANCE_M constant directly; Y untouched by the drag. The cosmetic pillar
          below is repositioned to match so it doesn't visibly detach from the platform. */}
      <ObstacleDragHandle
        position={[platformXZ.x, GROUND_SURFACE_Y + PLATFORM_HEIGHT_M - PLATFORM_SIZE[1] / 2, platformXZ.z]}
        size={PLATFORM_SIZE}
        color={PALETTE.cyan}
        onDrag={(x, z) => setPlatformXZ({ x, z })}
      />
      <RigidBody
        type="fixed"
        colliders={false}
        position={[platformXZ.x, GROUND_SURFACE_Y + PLATFORM_HEIGHT_M - PLATFORM_SIZE[1] / 2, platformXZ.z]}
      >
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
      {/* Cosmetic-only support pillar under the platform (no collider) —
          purely visual ground connection, see bug-fix note above. */}
      <mesh
        position={[
          platformXZ.x,
          GROUND_SURFACE_Y + (PLATFORM_HEIGHT_M - PLATFORM_SIZE[1]) / 2,
          platformXZ.z,
        ]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[PLATFORM_PILLAR_SIZE[0], PLATFORM_HEIGHT_M - PLATFORM_SIZE[1], PLATFORM_PILLAR_SIZE[1]]} />
        <meshStandardMaterial color="#1c1e29" emissive={PALETTE.silver} emissiveIntensity={0.25} roughness={0.8} metalness={0.2} />
      </mesh>

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
