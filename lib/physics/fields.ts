// Electric/magnetic field sources acting on a test particle via the Lorentz force.
//
// `source_type` selects which field-source model is active. All four share the same downstream
// Lorentz-force machinery (F = q(E + v x B), then a = F/m) — only how E and B are produced
// changes:
//   0 "point_charges" (default) — three fixed point charges, Coulomb's law + superposition for
//     E, a uniform slider-set B along +Y. This is the pre-existing engine-05/06 behavior,
//     UNCHANGED, so it stays the default and regresses nothing already verified.
//   1 "solenoid"      — ideal coil, uniform B = mu0*n*I inside (test particle modeled as being
//     inside the coil), E = 0 (no charges as the source).
//   2 "capacitor"     — ideal parallel-plate capacitor, uniform E = V/d between the plates,
//     B = 0 (no external magnetic field in this mode).
//   3 "bar_magnet"    — magnetic dipole field B = (mu0/4pi)*(3*(m.rhat)*rhat - m)/r^3 at the test
//     particle's position relative to the magnet, E = 0.
//
// Because `ScenarioParams` is `Record<string, number>` (CONTRACT.md), `source_type` is a
// clamped/rounded index into SOURCE_TYPES rather than a string literal.
//
// Coulomb's law, the Lorentz force, and the magnetic dipole formula are the hand-written
// physical laws here; everything downstream of "here's the resulting vector" (adding, crossing,
// normalizing, scaling) goes through THREE.Vector3, never custom vector math.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

// Coulomb constant. Using a "nice" simulation-scale constant (not real-world 8.99e9) so the
// resulting forces/fields are in a visually/numerically sane range for on-screen arrows and
// sliders bounded to [-5, 5] charge units and [0.5, 10] m separation.
const K = 5

// Real vacuum permeability (mu0), used as-is for solenoid/bar-magnet since both formulas are
// standard closed-form physics-2 laws, not simulation-scale constants.
const MU0 = 4 * Math.PI * 1e-7

const SOURCE_TYPES = ["point_charges", "solenoid", "capacitor", "bar_magnet"] as const
type SourceType = (typeof SOURCE_TYPES)[number]

function resolveSourceType(raw: number | undefined): SourceType {
  const idx = Math.min(SOURCE_TYPES.length - 1, Math.max(0, Math.round(raw ?? 0)))
  return SOURCE_TYPES[idx]
}

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

// Shared Lorentz-force + F=ma tail: given the E and B fields at the test particle's position
// plus its velocity/charge/mass, returns the Lorentz force, its signed X-component, and the
// resulting acceleration. Identical machinery regardless of which source_type produced E/B.
function lorentzAndAccel(eField: THREE.Vector3, bField: THREE.Vector3, velocity: THREE.Vector3, testCharge: number, testMass: number) {
  const vCrossB = velocity.clone().cross(bField)
  const lorentzForce = eField.clone().add(vCrossB).multiplyScalar(testCharge)
  const acceleration = lorentzForce.clone().divideScalar(testMass)
  return { lorentzForce, acceleration, lorentzForceSignedX: lorentzForce.x }
}

export function step(params: ScenarioParams, t: number): ScenarioState {
  const sourceType = resolveSourceType(params.source_type)

  if (sourceType === "solenoid") return stepSolenoid(params, t)
  if (sourceType === "capacitor") return stepCapacitor(params, t)
  if (sourceType === "bar_magnet") return stepBarMagnet(params, t)
  return stepPointCharges(params, t)
}

// ---------------------------------------------------------------------------------------------
// source_type = "point_charges" (default) — UNCHANGED from engine-05/06, extracted verbatim into
// its own function so the default path stays byte-identical (zero regression).
// ---------------------------------------------------------------------------------------------
function stepPointCharges(params: ScenarioParams, t: number): ScenarioState {
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
  const { lorentzForce, acceleration, lorentzForceSignedX } = lorentzAndAccel(eTotal, bField, velocity, testCharge, testMass)

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
    { label: "field source", value: "point charges" },
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

// ---------------------------------------------------------------------------------------------
// source_type = "solenoid" — ideal coil, uniform B = mu0*n*I inside. Test particle modeled as
// being inside the coil (uniform field region), so the field it experiences is just that
// constant vector everywhere, no position dependence. E = 0 (no charges as the source).
// ---------------------------------------------------------------------------------------------
function stepSolenoid(params: ScenarioParams, t: number): ScenarioState {
  const n = Math.max(params.solenoid_turns_per_m ?? 500, 0) // turns per meter
  const current = params.solenoid_current_a ?? 2 // amps, signed (reverses B direction)
  const testVelocity = params.test_velocity ?? 0
  const testCharge = params.test_charge ?? 1
  const testMass = Math.max(params.test_mass_kg ?? 1, 1e-6)

  const bMag = MU0 * n * current // B = mu0 * n * I, along the coil axis (+Y)
  const testPos = new THREE.Vector3(0, 0, 0)
  const velocity = new THREE.Vector3(0, 0, testVelocity)
  const eField = new THREE.Vector3(0, 0, 0) // no electric field source in this mode
  const bField = new THREE.Vector3(0, bMag, 0)

  const { lorentzForce, acceleration, lorentzForceSignedX } = lorentzAndAccel(eField, bField, velocity, testCharge, testMass)

  const objects: SceneObject[] = [
    {
      id: "solenoid-coil",
      kind: "custom",
      position: [0, 0, 0],
      radius: 1,
      color: "#94a3b8",
      meta: { role: "solenoid", turns_per_meter: n, current_amps: current, b_field_t: bMag },
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
    { origin: [0, 0, 0], direction: [bField.x, bField.y, bField.z], magnitude: Math.abs(bMag) },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "field source", value: "solenoid / coil" },
    { label: "turns per meter (n)", value: `${n.toFixed(1)} /m` },
    { label: "current (I)", value: `${current.toFixed(2)} A` },
    { label: "B field (mu0*n*I)", value: `${bMag.toExponential(4)} T` },
    { label: "Lorentz force on test particle", value: `${lorentzForce.length().toExponential(4)} N` },
    { label: "Lorentz force (signed, x-axis)", value: `${lorentzForceSignedX.toExponential(4)} N` },
    { label: "test particle mass", value: `${testMass.toFixed(2)} kg` },
    { label: "acceleration (F/m)", value: `${acceleration.length().toExponential(4)} m/s^2` },
  ]

  return { t, objects, fieldVectors, readouts }
}

// ---------------------------------------------------------------------------------------------
// source_type = "capacitor" — ideal parallel-plate capacitor, uniform E = V/d between the
// plates, along +X (plates sit perpendicular to X at x = -d/2 and x = +d/2). B = 0 (no external
// magnetic field in this mode).
// ---------------------------------------------------------------------------------------------
function stepCapacitor(params: ScenarioParams, t: number): ScenarioState {
  const voltage = params.capacitor_voltage_v ?? 100 // volts, signed (reverses E direction)
  const d = Math.max(params.capacitor_separation_m ?? 0.1, 1e-3) // plate separation, meters
  const testVelocity = params.test_velocity ?? 0
  const testCharge = params.test_charge ?? 1
  const testMass = Math.max(params.test_mass_kg ?? 1, 1e-6)

  const eMag = voltage / d // E = V/d
  const testPos = new THREE.Vector3(0, 0, 0)
  const velocity = new THREE.Vector3(0, 0, testVelocity)
  const eField = new THREE.Vector3(eMag, 0, 0)
  const bField = new THREE.Vector3(0, 0, 0) // no magnetic field source in this mode

  const { lorentzForce, acceleration, lorentzForceSignedX } = lorentzAndAccel(eField, bField, velocity, testCharge, testMass)

  const objects: SceneObject[] = [
    {
      id: "capacitor-plate-neg",
      kind: "box",
      position: [-d / 2, 0, 0],
      color: "#60a5fa",
      meta: { role: "capacitor_plate", polarity: voltage >= 0 ? "-" : "+", voltage, separation_m: d },
    },
    {
      id: "capacitor-plate-pos",
      kind: "box",
      position: [d / 2, 0, 0],
      color: "#f87171",
      meta: { role: "capacitor_plate", polarity: voltage >= 0 ? "+" : "-", voltage, separation_m: d },
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
    { origin: [0, 0, 0], direction: [eField.x, eField.y, eField.z], magnitude: Math.abs(eMag) },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "field source", value: "parallel-plate capacitor" },
    { label: "voltage (V)", value: `${voltage.toFixed(1)} V` },
    { label: "plate separation (d)", value: `${d.toFixed(3)} m` },
    { label: "E field (V/d)", value: `${eMag.toFixed(2)} V/m` },
    { label: "Lorentz force on test particle", value: `${lorentzForce.length().toFixed(4)} N` },
    { label: "Lorentz force (signed, x-axis)", value: `${lorentzForceSignedX.toFixed(4)} N` },
    { label: "test particle mass", value: `${testMass.toFixed(2)} kg` },
    { label: "acceleration (F/m)", value: `${acceleration.length().toFixed(4)} m/s^2` },
  ]

  return { t, objects, fieldVectors, readouts }
}

// ---------------------------------------------------------------------------------------------
// source_type = "bar_magnet" — magnetic dipole field B = (mu0/4pi)*(3*(m.rhat)*rhat - m)/r^3.
// The magnet sits fixed at the origin with dipole moment m along +Y; the test particle sits at
// distance `magnet_distance_m` from the magnet, at angle `magnet_angle_deg` from the dipole axis
// (0deg = on-axis, 90deg = equatorial/off-axis), so both closed-form special cases are directly
// reachable via the angle slider. E = 0 (no electric field source in this mode).
// ---------------------------------------------------------------------------------------------
function stepBarMagnet(params: ScenarioParams, t: number): ScenarioState {
  const magnetMoment = params.magnet_moment ?? 10 // dipole moment magnitude, signed
  const r = Math.max(params.magnet_distance_m ?? 3, 0.1) // meters, from magnet to test particle
  const angleDeg = params.magnet_angle_deg ?? 0 // 0 = on-axis, 90 = equatorial
  const testVelocity = params.test_velocity ?? 0
  const testCharge = params.test_charge ?? 1
  const testMass = Math.max(params.test_mass_kg ?? 1, 1e-6)

  const theta = (angleDeg * Math.PI) / 180
  const m = new THREE.Vector3(0, magnetMoment, 0) // dipole moment vector, along +Y
  // rHat sweeps from on-axis (+Y, theta=0) to equatorial (+X, theta=90deg), in the X-Y plane.
  const rHat = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0)
  const testPos = rHat.clone().multiplyScalar(r)

  const mDotRHat = m.dot(rHat)
  const bField = rHat
    .clone()
    .multiplyScalar(3 * mDotRHat)
    .sub(m)
    .multiplyScalar(MU0 / (4 * Math.PI * r * r * r))

  const velocity = new THREE.Vector3(0, 0, testVelocity)
  const eField = new THREE.Vector3(0, 0, 0) // no electric field source in this mode

  const { lorentzForce, acceleration, lorentzForceSignedX } = lorentzAndAccel(eField, bField, velocity, testCharge, testMass)

  const objects: SceneObject[] = [
    {
      id: "bar-magnet",
      kind: "box",
      position: [0, 0, 0],
      color: "#94a3b8",
      meta: { role: "bar_magnet", moment: magnetMoment },
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
        distance_m: r,
        angle_from_axis_deg: angleDeg,
        b_field: [bField.x, bField.y, bField.z],
        lorentz_force: [lorentzForce.x, lorentzForce.y, lorentzForce.z],
        lorentz_force_signed_x: lorentzForceSignedX,
        acceleration: [acceleration.x, acceleration.y, acceleration.z],
      },
    },
  ]

  const fieldVectors: ScenarioState["fieldVectors"] = [
    { origin: [testPos.x, testPos.y, testPos.z], direction: [bField.x, bField.y, bField.z], magnitude: bField.length() },
  ]

  const readouts: ScenarioState["readouts"] = [
    { label: "field source", value: "bar magnet (dipole)" },
    { label: "magnet moment (m)", value: `${magnetMoment.toFixed(2)} A·m^2` },
    { label: "distance (r)", value: `${r.toFixed(2)} m` },
    { label: "angle from axis", value: `${angleDeg.toFixed(1)} deg` },
    { label: "B field magnitude", value: `${bField.length().toExponential(4)} T` },
    { label: "Lorentz force on test particle", value: `${lorentzForce.length().toExponential(4)} N` },
    { label: "Lorentz force (signed, x-axis)", value: `${lorentzForceSignedX.toExponential(4)} N` },
    { label: "test particle mass", value: `${testMass.toFixed(2)} kg` },
    { label: "acceleration (F/m)", value: `${acceleration.length().toExponential(4)} m/s^2` },
  ]

  return { t, objects, fieldVectors, readouts }
}
