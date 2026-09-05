"use client"

import { useRef, useState, type MutableRefObject } from "react"
import { useFrame } from "@react-three/fiber"
import { Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier"
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
 */
export function ProjectilesScene({
  paramsRef,
  onReadouts,
}: {
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  const [launchId, setLaunchId] = useState(0)
  const [initial, setInitial] = useState<ScenarioState>(() => projectilesStep(paramsRef.current, 0))
  const lastKey = useRef(JSON.stringify(paramsRef.current))
  const bodyRef = useRef<RapierRigidBody>(null)
  const frameCount = useRef(0)

  // Re-launch (fresh RigidBody with new initial velocity) whenever a slider
  // actually changes value — not every frame.
  useFrame(() => {
    const key = JSON.stringify(paramsRef.current)
    if (key !== lastKey.current) {
      lastKey.current = key
      const next = projectilesStep(paramsRef.current, 0)
      setInitial(next)
      setLaunchId((id) => id + 1)
      onReadouts(next.readouts)
    }
  })

  // Live readout straight from Rapier's solver, throttled to ~10Hz — plenty
  // fast to look continuous, cheap enough not to matter.
  useFrame(() => {
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
      <RigidBody type="fixed" colliders="cuboid" position={[0, GROUND_Y, 0]}>
        <ObjectRenderer
          object={{ id: "ground", kind: "box", position: [0, 0, 0], color: "#1a2233", meta: { size: [50, 0.3, 6] } }}
        />
      </RigidBody>

      {wallHeight > 0 && (
        <RigidBody
          key={`wall-${launchId}`}
          type="fixed"
          colliders="cuboid"
          position={[wallDistance, wallHeight / 2, 0]}
        >
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

      {projectile && (
        <RigidBody
          key={`ball-${launchId}`}
          ref={bodyRef}
          type="dynamic"
          colliders="ball"
          position={projectile.position}
          linearVelocity={projectile.velocity}
          restitution={0.55}
          friction={0.4}
        >
          <ObjectRenderer object={{ ...projectile, position: [0, 0, 0] }} />
        </RigidBody>
      )}
    </Physics>
  )
}
