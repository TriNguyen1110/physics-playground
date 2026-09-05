// Projectile launch conditions + closed-form readouts.
//
// CONTRACT.md exception: this module does NOT integrate the trajectory. `scene` owns a Rapier
// <Physics> world and feeds the launch position/velocity produced here into a real rigid body;
// `scene` reads that body's live position every frame for rendering and collisions. This
// `step()` only computes:
//   - the initial launch position/velocity vector (from angle_deg + speed)
//   - closed-form apex height/range/time-of-flight readouts, so the readout panel can display
//     expected values that Rapier's actual trajectory can be checked against.
//
// Params:
//   angle_deg    — launch angle (elevation) above horizontal, in degrees. [1, 89]
//   speed        — launch speed, m/s. [1, 60]. Used directly in manual launch_mode; overridden
//                  by the spring formula (see spring_k/spring_compression_m below) in spring mode.
//   gravity      — magnitude of gravitational acceleration, m/s^2. Default 9.81. [1, 20]
//   mass_kg      — projectile mass, kg. Default 1. [0.1, 50]. Only matters when drag_enabled
//                  is on — mass alone has zero effect on a vacuum trajectory (Galileo's
//                  equivalence principle), so this module does NOT fake a mass dependence in
//                  the no-drag case. It only changes the numbers once linear drag is enabled.
//   radius_m     — projectile radius, m. Default 0.1. [0.01, 1]. Feeds the linear drag
//                  coefficient k = DRAG_COEFFICIENT * radius_m (bigger object -> more drag).
//   drag_enabled — 0/1 toggle. Default 0 (off), which reproduces the exact original no-drag
//                  closed-form apex/range/time-of-flight so the base case the verifier already
//                  checked keeps working unchanged.
//   azimuth_deg  — rotation of the launch direction around the vertical (Y) axis, degrees.
//                  Default 0. [0, 360]. At 0 the launch stays in the original X-Y plane
//                  (z-component of velocity is exactly 0), byte-identical to the pre-existing
//                  behavior engine-01/04 verified. Nonzero values rotate the horizontal
//                  component of the launch velocity into +/-Z, giving a full 3D launch
//                  direction: velocity = speed * (cos(elev)*cos(az), sin(elev), cos(elev)*sin(az)).
//   launch_mode  — 0 = "manual" (use `speed` directly, default/unchanged), 1 = "spring" (derive
//                  launch speed from spring_k/spring_compression_m/mass_kg instead — see below).
//                  Encoded as a number, not a string, since ScenarioParams is
//                  Record<string, number>; >= 0.5 means spring mode, same convention as
//                  drag_enabled.
//   spring_k     — spring constant, N/m. Default 200. [1, 2000]. Only used when
//                  launch_mode = spring.
//   spring_compression_m — spring compression distance, m. Default 0.3. [0, 2]. Only used when
//                  launch_mode = spring.
//
// Spring launcher (energy conservation): all spring potential energy converts to launch kinetic
// energy at release — PE = 0.5*k*x^2 = KE = 0.5*m*v^2 — so v = sqrt(k*x^2/m). This replaces the
// `speed` param's value (not `angle_deg`/`azimuth_deg`) when launch_mode = spring; manual mode
// (the default) is completely unaffected and uses `speed` exactly as before.
//
// Linear (Stokes) drag, not quadratic: this is the deliberate choice because linear drag has
// an exact elementary closed form (quadratic drag does not), which is what makes it
// independently verifiable. With drag force = -k*v (k = DRAG_COEFFICIENT * radius_m), and
// tau = mass_kg / k:
//   vx(t) = vx0 * exp(-t/tau)
//   x(t)  = tau * vx0 * (1 - exp(-t/tau))
//   vy(t) = (vy0 + g*tau) * exp(-t/tau) - g*tau
//   y(t)  = tau*(vy0 + g*tau)*(1 - exp(-t/tau)) - g*tau*t
//   terminal velocity v_term = g * tau = m*g/k
// Apex time (vy=0) has a closed form: t_apex = tau * ln((vy0 + g*tau) / (g*tau)).
// Time of flight (y=0 again) does NOT have an elementary closed form once drag is present (it's
// a transcendental equation, solvable only via Lambert W) — that root is found here by bisection
// on the closed-form y(t) itself, which is still exact/deterministic and independently
// reproducible by the verifier from the same y(t) formula above.
//
// t is accepted for shape-compatibility with other modules' step() but is otherwise unused here
// since this module returns only the initial/closed-form snapshot, not a trajectory sample.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

// Sim-scale drag coefficient constant (not a real fluid-mechanics Stokes' law constant) chosen
// so that radius_m in [0.01, 1] and mass_kg in [0.1, 50] produce a visually meaningful terminal
// velocity / apex-height reduction within the existing speed/angle slider ranges.
const DRAG_COEFFICIENT = 2.5

export function step(params: ScenarioParams, t: number): ScenarioState {
  const angleDeg = params.angle_deg ?? 45
  const azimuthDeg = params.azimuth_deg ?? 0
  const manualSpeed = params.speed ?? 20
  const g = params.gravity ?? 9.81
  const massKg = Math.max(params.mass_kg ?? 1, 1e-6)
  const radiusM = Math.max(params.radius_m ?? 0.1, 0)
  const dragEnabled = (params.drag_enabled ?? 0) >= 0.5
  const springMode = (params.launch_mode ?? 0) >= 0.5
  const springK = params.spring_k ?? 200
  const springCompressionM = params.spring_compression_m ?? 0.3

  // Energy conservation: spring PE = 0.5*k*x^2 fully converts to launch KE = 0.5*m*v^2, so
  // v = sqrt(k*x^2/m). Only takes effect in spring mode; manual mode keeps `speed` as-is.
  const springSpeed = Math.sqrt((springK * springCompressionM * springCompressionM) / massKg)
  const speed = springMode ? springSpeed : manualSpeed

  const angleRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(angleDeg, 0.1, 89.9))
  const azimuthRad = THREE.MathUtils.degToRad(azimuthDeg)

  const launchPosition = new THREE.Vector3(0, 0.05, 0)
  const launchVelocity = new THREE.Vector3(
    Math.cos(angleRad) * Math.cos(azimuthRad) * speed,
    Math.sin(angleRad) * speed,
    Math.cos(angleRad) * Math.sin(azimuthRad) * speed
  )
  const vx0 = launchVelocity.x
  const vy0 = launchVelocity.y
  // Horizontal launch speed magnitude (independent of azimuth direction) — used for the range
  // readout below. At azimuth 0 this equals vx0 exactly, so the no-drag/drag formulas reduce to
  // the original 2D-only math byte-for-byte.
  const h0 = Math.cos(angleRad) * speed

  const k = DRAG_COEFFICIENT * radiusM
  const dragActive = dragEnabled && k > 1e-9

  // No-drag closed-form flat-ground projectile motion (kept byte-for-byte identical to the
  // original formulas so the base case's regression check still passes):
  //   apex height h = (v*sin(theta))^2 / (2g)
  //   time of flight T = 2*v*sin(theta) / g
  //   range R = v^2 * sin(2*theta) / g
  const apexHeightNoDrag = (vy0 * vy0) / (2 * g)
  const timeOfFlightNoDrag = (2 * vy0) / g
  const rangeNoDrag = (speed * speed * Math.sin(2 * angleRad)) / g

  let apexHeight = apexHeightNoDrag
  let timeOfFlight = timeOfFlightNoDrag
  let range = rangeNoDrag
  let terminalVelocity: number | null = null

  if (dragActive) {
    const tau = massKg / k
    terminalVelocity = g * tau

    const yOf = (time: number) => tau * (vy0 + g * tau) * (1 - Math.exp(-time / tau)) - g * tau * time
    // Horizontal (range) displacement magnitude. Linear drag decouples per-axis, so x and z each
    // decay independently with the same tau; since vx0 = h0*cos(az) and vz0 = h0*sin(az), the
    // horizontal path is a straight line in the (vx0, vz0) direction whose magnitude is exactly
    // this h0-based formula (reduces to the original xOf(t) = tau*vx0*(1-exp(-t/tau)) when
    // azimuth = 0, since h0 = vx0 there).
    const hOf = (time: number) => tau * h0 * (1 - Math.exp(-time / tau))

    const tApex = tau * Math.log((vy0 + g * tau) / (g * tau))
    apexHeight = yOf(tApex)

    // Bisect for the second root of y(t) = 0 (t > tApex): y is positive at tApex (the apex) and
    // eventually goes negative as t grows (the -g*tau*t term dominates), so grow the bracket
    // until y flips sign, then bisect.
    let lo = tApex
    let hi = tApex + tau
    let guard = 0
    while (yOf(hi) >= 0 && guard < 64) {
      hi *= 2
      guard++
    }
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2
      if (yOf(mid) >= 0) lo = mid
      else hi = mid
    }
    timeOfFlight = (lo + hi) / 2
    range = hOf(timeOfFlight)
  }

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
        azimuth_deg: azimuthDeg,
        speed,
        launch_mode: springMode ? "spring" : "manual",
        spring_k: springK,
        spring_compression_m: springCompressionM,
        gravity: g,
        mass_kg: massKg,
        radius_m: radiusM,
        drag_enabled: dragActive,
        drag_k: dragActive ? k : 0,
        terminal_velocity_mps: terminalVelocity,
        apex_height_m: apexHeight,
        range_m: range,
        time_of_flight_s: timeOfFlight,
      },
    },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "launch angle (elevation)", value: `${angleDeg.toFixed(1)} deg` },
    { label: "launch azimuth", value: `${azimuthDeg.toFixed(1)} deg` },
    {
      label: "launch speed",
      value: springMode
        ? `${speed.toFixed(2)} m/s (spring: k=${springK.toFixed(1)} N/m, x=${springCompressionM.toFixed(2)} m)`
        : `${speed.toFixed(1)} m/s`,
    },
    { label: "gravity", value: `${g.toFixed(2)} m/s^2` },
    { label: "mass", value: `${massKg.toFixed(2)} kg` },
    { label: "radius", value: `${radiusM.toFixed(3)} m` },
    {
      label: "drag",
      value: dragActive ? `on (k=${k.toFixed(2)} kg/s)` : "off (vacuum)",
    },
    { label: "expected apex height", value: `${apexHeight.toFixed(2)} m` },
    { label: "expected range", value: `${range.toFixed(2)} m` },
    { label: "expected time of flight", value: `${timeOfFlight.toFixed(2)} s` },
    ...(dragActive && terminalVelocity !== null
      ? [{ label: "terminal velocity", value: `${terminalVelocity.toFixed(2)} m/s` }]
      : []),
  ]

  return { t, objects, readouts }
}
