// Projectile launch conditions + closed-form readouts.
//
// CONTRACT.md exception: this module does NOT integrate the trajectory. `scene` owns a Rapier
// <Physics> world and feeds the launch position/velocity produced here into a real rigid body;
// `scene` reads that body's live position every frame for rendering and collisions. This
// `step()` only computes:
//   - the initial launch position/velocity vector (from angle_deg + speed)
//   - closed-form apex height and range (flat-ground, no-drag projectile motion), so the
//     readout panel can display expected values that Rapier's actual trajectory can be
//     checked against.
//
// Params:
//   angle_deg  — launch angle above horizontal, in degrees. [1, 89]
//   speed      — launch speed, m/s. [1, 60]
//   gravity    — magnitude of gravitational acceleration, m/s^2. Default 9.81. [1, 20]
//
// t is accepted for shape-compatibility with other modules' step() but is otherwise unused here
// since this module returns only the initial/closed-form snapshot, not a trajectory sample.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

export function step(params: ScenarioParams, t: number): ScenarioState {
  const angleDeg = params.angle_deg ?? 45
  const speed = params.speed ?? 20
  const g = params.gravity ?? 9.81

  const angleRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(angleDeg, 0.1, 89.9))

  const launchPosition = new THREE.Vector3(0, 0.05, 0)
  const launchVelocity = new THREE.Vector3(
    Math.cos(angleRad) * speed,
    Math.sin(angleRad) * speed,
    0
  )

  // Closed-form flat-ground projectile motion (no drag):
  //   apex height h = (v*sin(theta))^2 / (2g)
  //   time of flight T = 2*v*sin(theta) / g
  //   range R = v^2 * sin(2*theta) / g
  const vy = launchVelocity.y
  const apexHeight = (vy * vy) / (2 * g)
  const timeOfFlight = (2 * vy) / g
  const range = (speed * speed * Math.sin(2 * angleRad)) / g

  const objects: SceneObject[] = [
    {
      id: "projectile",
      kind: "sphere",
      position: [launchPosition.x, launchPosition.y, launchPosition.z],
      velocity: [launchVelocity.x, launchVelocity.y, launchVelocity.z],
      radius: 0.3,
      color: "#e2e8f0",
      meta: {
        role: "launch",
        angle_deg: angleDeg,
        speed,
        gravity: g,
        apex_height_m: apexHeight,
        range_m: range,
        time_of_flight_s: timeOfFlight,
      },
    },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "launch angle", value: `${angleDeg.toFixed(1)} deg` },
    { label: "launch speed", value: `${speed.toFixed(1)} m/s` },
    { label: "gravity", value: `${g.toFixed(2)} m/s^2` },
    { label: "expected apex height", value: `${apexHeight.toFixed(2)} m` },
    { label: "expected range", value: `${range.toFixed(2)} m` },
    { label: "expected time of flight", value: `${timeOfFlight.toFixed(2)} s` },
  ]

  return { t, objects, readouts }
}
