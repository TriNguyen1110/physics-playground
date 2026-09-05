// Electric field (Coulomb's law) + magnetic Lorentz force on a test particle.
//
// Two fixed source charges sit at +/-X on the X axis; a test particle sits at the origin with
// a velocity slider so the Lorentz force (magnetic component) has something to act on. This is
// a pure function of (params, t) — no hidden state.
//
// Params:
//   charge1       — signed charge of source 1, in arbitrary "charge units" (C-equivalent). [-5, 5]
//   charge2       — signed charge of source 2, in arbitrary "charge units". [-5, 5]
//   separation    — distance between the two source charges, meters. [0.5, 10]
//   test_velocity — speed of the test particle along +Z, m/s (drives the magnetic force via
//                   v x B). [0, 20]
//   b_field       — magnitude of a uniform external magnetic field along +Y, tesla-equivalent.
//                   [0, 5]
//   test_charge   — signed charge of the test particle sitting at the origin. [-5, 5]
//   test_mass_kg  — mass of the test particle, kg. Default 1. [0.1, 20]. Feeds a direct F=ma
//                   readout: acceleration = lorentzForce / test_mass_kg. No new law, just the
//                   already-computed Lorentz force divided by mass.
//
// Coulomb's law (F = k*q1*q2/r^2) and the Lorentz force magnitude (F = q(E + v x B)) are the
// two hand-written physical laws. Everything downstream — combining per-source field vectors,
// computing directions, cross products — goes through THREE.Vector3.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

// Coulomb constant. Using a "nice" simulation-scale constant (not real-world 8.99e9) so the
// resulting forces/fields are in a visually/numerically sane range for on-screen arrows and
// sliders bounded to [-5, 5] charge units and [0.5, 10] m separation.
const K = 5

export function step(params: ScenarioParams, t: number): ScenarioState {
  const q1 = params.charge1 ?? 3
  const q2 = params.charge2 ?? -3
  const separation = Math.max(params.separation ?? 4, 0.1)
  const testVelocity = params.test_velocity ?? 0
  const bFieldMag = params.b_field ?? 0
  const testCharge = params.test_charge ?? 1
  const testMass = Math.max(params.test_mass_kg ?? 1, 1e-6)

  const pos1 = new THREE.Vector3(-separation / 2, 0, 0)
  const pos2 = new THREE.Vector3(separation / 2, 0, 0)
  const testPos = new THREE.Vector3(0, 0, 0)

  // Coulomb's law between the two source charges: F = k * q1 * q2 / r^2, direction along the
  // line joining them. Positive product (like charges) -> repulsive (force on charge2 points
  // away from charge1); negative product (opposite charges) -> attractive.
  const r = pos2.clone().sub(pos1)
  const rMag = r.length()
  const rHat = r.clone().normalize()
  const coulombForceMag = (K * q1 * q2) / (rMag * rMag)
  // Force ON charge2, due to charge1: attractive (product<0) pulls charge2 toward charge1
  // (i.e. -rHat), repulsive (product>0) pushes charge2 away (i.e. +rHat).
  const forceOn2 = rHat.clone().multiplyScalar(coulombForceMag)
  const forceOn1 = forceOn2.clone().multiplyScalar(-1)

  // Electric field from each source charge, sampled at the test particle's position:
  // E = k*q/r^2, direction radially outward from the source (for q > 0).
  function fieldAt(point: THREE.Vector3, sourcePos: THREE.Vector3, q: number) {
    const d = point.clone().sub(sourcePos)
    const dist = Math.max(d.length(), 1e-6)
    const dHat = d.clone().normalize()
    const mag = (K * q) / (dist * dist)
    return dHat.multiplyScalar(mag)
  }

  const e1 = fieldAt(testPos, pos1, q1)
  const e2 = fieldAt(testPos, pos2, q2)
  const eTotal = e1.clone().add(e2) // vector combination via THREE.Vector3, not hand-rolled

  // Lorentz force on the test particle: F = q(E + v x B).
  const velocity = new THREE.Vector3(0, 0, testVelocity)
  const bField = new THREE.Vector3(0, bFieldMag, 0)
  const vCrossB = velocity.clone().cross(bField)
  const lorentzForce = eTotal.clone().add(vCrossB).multiplyScalar(testCharge)

  // F = m*a -> a = F/m. Direct application of Newton's second law to the already-computed
  // Lorentz force; no new physical law, just a division.
  const acceleration = lorentzForce.clone().divideScalar(testMass)

  const objects: SceneObject[] = [
    {
      id: "charge-1",
      kind: "sphere",
      position: [pos1.x, pos1.y, pos1.z],
      radius: 0.25 + Math.min(Math.abs(q1), 5) * 0.05,
      color: q1 >= 0 ? "#f87171" : "#60a5fa",
      meta: { role: "source", charge: q1, force_on_this: [forceOn1.x, forceOn1.y, forceOn1.z] },
    },
    {
      id: "charge-2",
      kind: "sphere",
      position: [pos2.x, pos2.y, pos2.z],
      radius: 0.25 + Math.min(Math.abs(q2), 5) * 0.05,
      color: q2 >= 0 ? "#f87171" : "#60a5fa",
      meta: { role: "source", charge: q2, force_on_this: [forceOn2.x, forceOn2.y, forceOn2.z] },
    },
    {
      id: "test-particle",
      kind: "sphere",
      position: [testPos.x, testPos.y, testPos.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      radius: 0.15,
      color: "#facc15",
      meta: {
        role: "test-particle",
        charge: testCharge,
        mass_kg: testMass,
        lorentz_force: [lorentzForce.x, lorentzForce.y, lorentzForce.z],
        acceleration: [acceleration.x, acceleration.y, acceleration.z],
      },
    },
  ]

  const fieldVectors: ScenarioState["fieldVectors"] = [
    { origin: [testPos.x, testPos.y, testPos.z], direction: [eTotal.x, eTotal.y, eTotal.z], magnitude: eTotal.length() },
    { origin: [pos1.x, pos1.y, pos1.z], direction: [forceOn1.x, forceOn1.y, forceOn1.z], magnitude: forceOn1.length() },
    { origin: [pos2.x, pos2.y, pos2.z], direction: [forceOn2.x, forceOn2.y, forceOn2.z], magnitude: forceOn2.length() },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "charge 1", value: `${q1.toFixed(2)} q` },
    { label: "charge 2", value: `${q2.toFixed(2)} q` },
    { label: "separation", value: `${separation.toFixed(2)} m` },
    { label: "Coulomb force (1 on 2)", value: `${coulombForceMag.toFixed(3)} N` },
    { label: "net E-field at test particle", value: `${eTotal.length().toFixed(3)} N/C` },
    { label: "Lorentz force on test particle", value: `${lorentzForce.length().toFixed(3)} N` },
    { label: "test particle mass", value: `${testMass.toFixed(2)} kg` },
    { label: "acceleration (F/m)", value: `${acceleration.length().toFixed(3)} m/s^2` },
  ]

  return { t, objects, fieldVectors, readouts }
}
