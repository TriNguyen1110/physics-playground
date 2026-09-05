// Electric field (Coulomb's law) + magnetic Lorentz force on a test particle.
//
// Three fixed source charges sit around the origin (charge1/charge2 on the X axis as before,
// charge3 offset onto the Z axis so the third source isn't collinear with the other two); a
// test particle sits at the origin with a velocity slider so the Lorentz force (magnetic
// component) has something to act on. This is a pure function of (params, t) — no hidden state.
//
// Params:
//   charge1       — signed charge of source 1, in arbitrary "charge units" (C-equivalent). [-5, 5]
//   charge2       — signed charge of source 2, in arbitrary "charge units". [-5, 5]
//   charge3       — signed charge of source 3, in arbitrary "charge units". [-5, 5]. Default 0,
//                   which makes source 3 contribute exactly zero field/force everywhere (0/r^2
//                   is always 0 for finite r), so the whole module reduces EXACTLY to the old
//                   2-charge behavior when charge3=0 — nothing already-verified regresses.
//   separation    — distance between charge1 and charge2, meters. [0.5, 10]
//   charge3_offset — distance of charge3 off the X axis, along +Z, meters. [0.5, 10]. Only
//                   matters when charge3 != 0.
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
// two hand-written physical laws. Adding a third source charge is the superposition principle
// (E_net = E1 + E2 + E3, same law applied pairwise and summed) — not a new law. Everything
// downstream — combining per-source field vectors, computing directions, cross products — goes
// through THREE.Vector3.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

// Coulomb constant. Using a "nice" simulation-scale constant (not real-world 8.99e9) so the
// resulting forces/fields are in a visually/numerically sane range for on-screen arrows and
// sliders bounded to [-5, 5] charge units and [0.5, 10] m separation.
const K = 5

// Pairwise Coulomb force ON `pos_b` (charge `q_b`) DUE TO `pos_a` (charge `q_a`).
// F = k*qa*qb/r^2, direction along the line joining them: attractive (product<0) pulls b toward
// a; repulsive (product>0) pushes b away from a.
function coulombForceOn(posB: THREE.Vector3, qB: number, posA: THREE.Vector3, qA: number) {
  const r = posB.clone().sub(posA)
  const rMag = Math.max(r.length(), 1e-6)
  const rHat = r.clone().normalize()
  const mag = (K * qA * qB) / (rMag * rMag)
  return rHat.multiplyScalar(mag)
}

// Electric field from a single source charge, sampled at `point`: E = k*q/r^2, direction
// radially outward from the source (for q > 0).
function fieldAt(point: THREE.Vector3, sourcePos: THREE.Vector3, q: number) {
  const d = point.clone().sub(sourcePos)
  const dist = Math.max(d.length(), 1e-6)
  const dHat = d.clone().normalize()
  const mag = (K * q) / (dist * dist)
  return dHat.multiplyScalar(mag)
}

export function step(params: ScenarioParams, t: number): ScenarioState {
  const q1 = params.charge1 ?? 3
  const q2 = params.charge2 ?? -3
  const q3 = params.charge3 ?? 0
  const separation = Math.max(params.separation ?? 5, 0.1)
  const charge3Offset = Math.max(params.charge3_offset ?? 3, 0.1)
  const testVelocity = params.test_velocity ?? 0
  const bFieldMag = params.b_field ?? 0
  const testCharge = params.test_charge ?? 1
  const testMass = Math.max(params.test_mass_kg ?? 1, 1e-6)

  const pos1 = new THREE.Vector3(-separation / 2, 0, 0)
  const pos2 = new THREE.Vector3(separation / 2, 0, 0)
  // Off the 1-2 axis (Z offset) so charge3 isn't collinear with charge1/charge2 — a genuinely
  // independent third source, not just a third point on the same line.
  const pos3 = new THREE.Vector3(0, 0, charge3Offset)
  const testPos = new THREE.Vector3(0, 0, 0)

  // Pairwise Coulomb forces between every source pair (superposition: the net force on each
  // source is the vector sum of the forces from the OTHER two sources).
  const forceOn1From2 = coulombForceOn(pos1, q1, pos2, q2)
  const forceOn1From3 = coulombForceOn(pos1, q1, pos3, q3)
  const forceOn2From1 = coulombForceOn(pos2, q2, pos1, q1)
  const forceOn2From3 = coulombForceOn(pos2, q2, pos3, q3)
  const forceOn3From1 = coulombForceOn(pos3, q3, pos1, q1)
  const forceOn3From2 = coulombForceOn(pos3, q3, pos2, q2)

  const forceOn1 = forceOn1From2.clone().add(forceOn1From3)
  const forceOn2 = forceOn2From1.clone().add(forceOn2From3)
  const forceOn3 = forceOn3From1.clone().add(forceOn3From2)

  // Coulomb force magnitude between charge1 and charge2 alone, kept for the readout/regression
  // (identical formula/value to the pre-3-charge module).
  const r12 = pos2.clone().sub(pos1)
  const r12Mag = Math.max(r12.length(), 1e-6)
  const coulombForceMag = (K * q1 * q2) / (r12Mag * r12Mag)

  // Electric field from each of the three source charges, sampled at the test particle's
  // position — net field is the superposition (vector sum) of all three.
  const e1 = fieldAt(testPos, pos1, q1)
  const e2 = fieldAt(testPos, pos2, q2)
  const e3 = fieldAt(testPos, pos3, q3)
  const eTotal = e1.clone().add(e2).add(e3) // vector combination via THREE.Vector3, not hand-rolled

  // Lorentz force on the test particle: F = q(E + v x B).
  const velocity = new THREE.Vector3(0, 0, testVelocity)
  const bField = new THREE.Vector3(0, bFieldMag, 0)
  const vCrossB = velocity.clone().cross(bField)
  const lorentzForce = eTotal.clone().add(vCrossB).multiplyScalar(testCharge)

  // F = m*a -> a = F/m. Direct application of Newton's second law to the already-computed
  // Lorentz force; no new physical law, just a division.
  const acceleration = lorentzForce.clone().divideScalar(testMass)

  // Signed scalar readout: the Lorentz force's X-component. `.length()` (magnitude) is
  // mathematically EVEN in test_charge's sign for any vector V (|(-c)*V| == |c*V|), so flipping
  // test_charge from -5 to +5 can never change a magnitude-based readout even though the force
  // direction genuinely reverses — that's real physics (F=qE flips with q's sign) with no
  // observable readout. X is the axis both source charges (charge1/charge2) sit on and where the
  // net field/v x B combination is dominant at this module's defaults (charge3 defaults to 0, so
  // Z stays 0 unless charge3 is moved off zero) — the most physically meaningful single signed
  // component to expose given this file's vector layout, without inventing a second hand-rolled
  // formula (it's just lorentzForce.x, already computed above via THREE.Vector3 addition).
  const lorentzForceSignedX = lorentzForce.x

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
      id: "charge-3",
      kind: "sphere",
      position: [pos3.x, pos3.y, pos3.z],
      radius: 0.25 + Math.min(Math.abs(q3), 5) * 0.05,
      color: q3 >= 0 ? "#f87171" : "#60a5fa",
      meta: { role: "source", charge: q3, force_on_this: [forceOn3.x, forceOn3.y, forceOn3.z] },
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
        lorentz_force_signed_x: lorentzForceSignedX,
        acceleration: [acceleration.x, acceleration.y, acceleration.z],
      },
    },
  ]

  const fieldVectors: ScenarioState["fieldVectors"] = [
    { origin: [testPos.x, testPos.y, testPos.z], direction: [eTotal.x, eTotal.y, eTotal.z], magnitude: eTotal.length() },
    { origin: [pos1.x, pos1.y, pos1.z], direction: [forceOn1.x, forceOn1.y, forceOn1.z], magnitude: forceOn1.length() },
    { origin: [pos2.x, pos2.y, pos2.z], direction: [forceOn2.x, forceOn2.y, forceOn2.z], magnitude: forceOn2.length() },
    { origin: [pos3.x, pos3.y, pos3.z], direction: [forceOn3.x, forceOn3.y, forceOn3.z], magnitude: forceOn3.length() },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "charge 1", value: `${q1.toFixed(2)} q` },
    { label: "charge 2", value: `${q2.toFixed(2)} q` },
    { label: "charge 3", value: `${q3.toFixed(2)} q` },
    { label: "separation (1-2)", value: `${separation.toFixed(2)} m` },
    { label: "Coulomb force (1 on 2)", value: `${coulombForceMag.toFixed(3)} N` },
    { label: "net E-field at test particle", value: `${eTotal.length().toFixed(3)} N/C` },
    { label: "Lorentz force on test particle", value: `${lorentzForce.length().toFixed(3)} N` },
    // Signed readout — magnitude above is even in test_charge's sign (|-c|==|c|) and can never
    // show that flipping the test particle's charge sign reverses the force direction; this
    // exposes the raw signed X-component (the axis charge1/charge2 sit on and where the
    // net-field/v x B vector is dominant at defaults) so that real, physical sign flip is
    // actually visible in a readout.
    { label: "Lorentz force (signed, x-axis)", value: `${lorentzForceSignedX.toFixed(3)} N` },
    { label: "test particle mass", value: `${testMass.toFixed(2)} kg` },
    { label: "acceleration (F/m)", value: `${acceleration.length().toFixed(3)} m/s^2` },
  ]

  return { t, objects, fieldVectors, readouts }
}
