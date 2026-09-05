"use client"

import { memo, useRef, useState, type MutableRefObject } from "react"
import { useFrame } from "@react-three/fiber"
import { BallCollider, CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { step as projectilesStep } from "@/lib/physics/projectiles"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

// Ground + wall are scene-owned set pieces, not part of engine's step() —
// engine's projectiles.step() only returns the launch object + closed-form
// apex/range (see lib/physics/projectiles.ts). `wall_distance`/`wall_height`
// are extra keys on the same params object; step() simply ignores them.
const GROUND_Y = -0.15

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

  return (
    <Physics gravity={[0, -gravity, 0]}>
      <RigidBody type="fixed" colliders={false} position={[0, GROUND_Y, 0]}>
        {/* Half-extent 200m in x: sliders reach speed=60/angle=45/gravity=1,
            whose closed-form range is in the hundreds of meters — a ground
            that only spans +/-25m (the original size) is flown past in x
            well before the ball ever descends back to y=0, so it never
            re-contacts the ground and just free-falls forever. Even the
            *default* params (speed 20, angle 45, gravity 9.81 -> range
            ~40.8m) already exceeded the old +/-25m half-width. */}
        <CuboidCollider args={[200, 0.15, 3]} restitution={0.55} friction={0.4} />
        <ObjectRenderer
          object={{ id: "ground", kind: "box", position: [0, 0, 0], color: "#1a2233", meta: { size: [400, 0.3, 6] } }}
        />
      </RigidBody>

      {wallHeight > 0 && (
        <RigidBody
          key={`wall-${launchId}`}
          type="fixed"
          colliders={false}
          position={[wallDistance, wallHeight / 2, 0]}
        >
          <CuboidCollider args={[0.2, wallHeight / 2, 1.5]} restitution={0.55} friction={0.4} />
          <ObjectRenderer
            object={{
              id: "wall",
              kind: "box",
              position: [0, 0, 0],
              color: "#3a2f45",
              meta: { size: [0.4, wallHeight, 3] },
            }}
          />
        </RigidBody>
      )}

      {/* Resting: a fixed body sitting visibly at the launch point before
          the user has ever clicked Launch (or right after a slider change,
          since dragging alone no longer fires the ball). */}
      {projectile && phase === "resting" && (
        <RigidBody key={`rest-${launchId}`} type="fixed" colliders={false} position={projectile.position}>
          <BallCollider args={[projectile.radius ?? 0.3]} />
          <ObjectRenderer object={{ ...projectile, position: [0, 0, 0] }} />
        </RigidBody>
      )}

      {projectile && phase === "flying" && (
        <RigidBody
          key={`ball-${launchId}`}
          ref={bodyRef}
          type="dynamic"
          colliders={false}
          position={projectile.position}
          linearVelocity={projectile.velocity}
          ccd
        >
          <BallCollider args={[projectile.radius ?? 0.3]} restitution={0.55} friction={0.4} />
          <ObjectRenderer object={{ ...projectile, position: [0, 0, 0] }} />
        </RigidBody>
      )}
    </Physics>
  )
})
