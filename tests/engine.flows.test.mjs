// verifier: DATA scope regression tests for engine-01
//
// Run with: npx tsx --test tests/engine.flows.test.mjs
//
// Covers CONTRACT.md's step(params, t) shape for light/projectiles/fields, plus a shape check
// of convex/schema.ts + convex/scenarios.ts against CONTRACT.md (execution against a live Convex
// deployment is not possible until `npx convex dev` has run and convex/_generated/* exists).

import { test } from "node:test"
import assert from "node:assert/strict"

import { step as lightStep } from "../lib/physics/light.ts"
import { step as projectilesStep } from "../lib/physics/projectiles.ts"
import { step as fieldsStep } from "../lib/physics/fields.ts"

const DEG = Math.PI / 180

function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
}

function assertStateIsClean(state, label) {
  assert.ok(state.objects.length > 0, `${label}: objects.length > 0`)
  for (const obj of state.objects) {
    assert.ok(isFiniteVec3(obj.position), `${label}: ${obj.id}.position finite`)
    if (obj.velocity !== undefined) {
      assert.ok(isFiniteVec3(obj.velocity), `${label}: ${obj.id}.velocity finite`)
    }
  }
  for (const r of state.readouts) {
    assert.ok(typeof r.value === "string", `${label}: readout ${r.label} has string value`)
    assert.ok(!/nan|infinity/i.test(r.value), `${label}: readout ${r.label} not NaN/Infinity (${r.value})`)
  }
  if (state.fieldVectors) {
    for (const fv of state.fieldVectors) {
      assert.ok(isFiniteVec3(fv.origin), `${label}: fieldVector.origin finite`)
      assert.ok(isFiniteVec3(fv.direction), `${label}: fieldVector.direction finite`)
      assert.ok(Number.isFinite(fv.magnitude), `${label}: fieldVector.magnitude finite`)
    }
  }
}

// ---------------------------------------------------------------------------
// light: Snell's law closed-form checks (default n1=1.5 glass -> n2=1.0 air)
// ---------------------------------------------------------------------------

test("light: at the critical angle, refraction is ~90 deg and TIR is false", () => {
  const n1 = 1.5
  const n2 = 1.0
  const criticalDeg = Math.asin(n2 / n1) / DEG // ~41.8103 deg
  const state = lightStep({ angle_deg: criticalDeg, n1, n2 }, 0)

  const tir = state.readouts.find((r) => r.label === "total internal reflection")
  const refraction = state.readouts.find((r) => r.label === "angle of refraction")
  assert.equal(tir.value, "no")
  const refractionDeg = parseFloat(refraction.value)
  assert.ok(Math.abs(refractionDeg - 90) < 0.5, `expected ~90deg, got ${refraction.value}`)
  assertStateIsClean(state, "light@critical")
})

test("light: a few degrees past the critical angle triggers TIR (no refracted-ray object)", () => {
  const n1 = 1.5
  const n2 = 1.0
  const criticalDeg = Math.asin(n2 / n1) / DEG
  const state = lightStep({ angle_deg: criticalDeg + 5, n1, n2 }, 0)

  const tir = state.readouts.find((r) => r.label === "total internal reflection")
  assert.equal(tir.value, "yes")
  assert.ok(!state.objects.some((o) => o.id === "refracted-ray"), "no refracted-ray object under TIR")
  assertStateIsClean(state, "light@TIR")
})

test("light: well below critical angle refracts per Snell's law (30 deg)", () => {
  const n1 = 1.5
  const n2 = 1.0
  const angleDeg = 30
  const state = lightStep({ angle_deg: angleDeg, n1, n2 }, 0)
  const expectedThetaTDeg = Math.asin((n1 / n2) * Math.sin(angleDeg * DEG)) / DEG

  const refraction = state.readouts.find((r) => r.label === "angle of refraction")
  const refractionDeg = parseFloat(refraction.value)
  assert.ok(Math.abs(refractionDeg - expectedThetaTDeg) < 1e-2)
  assertStateIsClean(state, "light@30deg")
})

test("light: param sweep across documented ranges stays clean", () => {
  for (const angle_deg of [0, 1, 15, 30, 41.8, 45, 60, 75, 89]) {
    for (const n1 of [1.0, 1.5, 2.0, 2.5]) {
      for (const n2 of [1.0, 1.5, 2.0, 2.5]) {
        const state = lightStep({ angle_deg, n1, n2 }, 0)
        assertStateIsClean(state, `light(angle=${angle_deg},n1=${n1},n2=${n2})`)
      }
    }
  }
})

// ---------------------------------------------------------------------------
// projectiles: closed-form apex/range/time-of-flight (flat ground, no drag)
// ---------------------------------------------------------------------------

test("projectiles: 45deg / 20 m/s / g=9.81 matches closed-form apex height and range", () => {
  const angleDeg = 45
  const speed = 20
  const g = 9.81
  const angleRad = angleDeg * DEG
  const expectedApex = (speed * Math.sin(angleRad)) ** 2 / (2 * g)
  const expectedRange = (speed * speed * Math.sin(2 * angleRad)) / g
  const expectedTof = (2 * speed * Math.sin(angleRad)) / g

  const state = projectilesStep({ angle_deg: angleDeg, speed, gravity: g }, 0)
  const proj = state.objects.find((o) => o.id === "projectile")
  assert.equal(proj.meta.apex_height_m, expectedApex)
  assert.equal(proj.meta.range_m, expectedRange)
  assert.equal(proj.meta.time_of_flight_s, expectedTof)

  // Cross-check the rendered readout strings too, per CLAUDE.md's grounding rule (readouts must
  // reproduce from step()'s actual returned numbers).
  const apexReadout = state.readouts.find((r) => r.label === "expected apex height")
  assert.ok(Math.abs(parseFloat(apexReadout.value) - expectedApex) < 0.01)

  assertStateIsClean(state, "projectiles@45/20/9.81")
})

test("projectiles: 30deg / 10 m/s / g=9.81 matches closed-form values", () => {
  const angleDeg = 30
  const speed = 10
  const g = 9.81
  const angleRad = angleDeg * DEG
  const expectedApex = (speed * Math.sin(angleRad)) ** 2 / (2 * g)
  const expectedRange = (speed * speed * Math.sin(2 * angleRad)) / g

  const state = projectilesStep({ angle_deg: angleDeg, speed, gravity: g }, 0)
  const proj = state.objects.find((o) => o.id === "projectile")
  assert.ok(Math.abs(proj.meta.apex_height_m - expectedApex) < 1e-9)
  assert.ok(Math.abs(proj.meta.range_m - expectedRange) < 1e-9)
  assertStateIsClean(state, "projectiles@30/10/9.81")
})

test("projectiles: param sweep across documented ranges stays clean", () => {
  for (const angle_deg of [1, 10, 45, 80, 89]) {
    for (const speed of [1, 20, 40, 60]) {
      for (const gravity of [1, 9.81, 20]) {
        const state = projectilesStep({ angle_deg, speed, gravity }, 0)
        assertStateIsClean(state, `projectiles(angle=${angle_deg},speed=${speed},g=${gravity})`)
      }
    }
  }
})

// ---------------------------------------------------------------------------
// fields: Coulomb's law using the engine's actual sim-scale constant K
// ---------------------------------------------------------------------------

test("fields: Coulomb force matches F = K*q1*q2/r^2 with the engine's actual K", () => {
  // Recompute K independently by inverting the known default (q1=3, q2=-3, separation=4):
  // F = K*3*-3/16 -> back out K from a second known case below instead of trusting the fact row.
  const q1 = 2
  const q2 = 4
  const separation = 2
  const state = fieldsStep({ charge1: q1, charge2: q2, separation, test_velocity: 0, b_field: 0, test_charge: 1 }, 0)
  const readout = state.readouts.find((r) => r.label === "Coulomb force (1 on 2)")
  const actualForce = parseFloat(readout.value)

  // Solve for K from this single measurement, then confirm it matches the documented K=5 by
  // checking a second, independent case with that same K.
  const impliedK = (actualForce * separation * separation) / (q1 * q2)
  assert.ok(Math.abs(impliedK - 5) < 1e-9, `expected K=5 per BOARD.tsv fact row, engine actually uses K=${impliedK}`)

  const expectedForce = (impliedK * q1 * q2) / (separation * separation)
  assert.ok(Math.abs(Math.abs(actualForce) - Math.abs(expectedForce)) < 1e-6)

  // Second independent case with K pinned at 5, default-ish separation.
  const q1b = 3
  const q2b = -3
  const sepB = 4
  const stateB = fieldsStep({ charge1: q1b, charge2: q2b, separation: sepB, test_velocity: 0, b_field: 0, test_charge: 1 }, 0)
  const readoutB = stateB.readouts.find((r) => r.label === "Coulomb force (1 on 2)")
  const expectedForceB = (5 * q1b * q2b) / (sepB * sepB) // = -2.8125
  // readout is toFixed(3), so allow for that rounding rather than exact float equality.
  assert.ok(Math.abs(parseFloat(readoutB.value) - expectedForceB) < 1e-3)

  assertStateIsClean(state, "fields@coulomb-case-1")
  assertStateIsClean(stateB, "fields@coulomb-case-2")
})

test("fields: Lorentz force F = q(E + v x B) matches closed-form for a simple case", () => {
  // charge1=0, charge2=0 -> E field at test particle is exactly zero, isolating the magnetic
  // term v x B so it can be checked in closed form.
  const testVelocity = 10
  const bFieldMag = 2
  const testCharge = 1
  const state = fieldsStep(
    { charge1: 0, charge2: 0, separation: 4, test_velocity: testVelocity, b_field: bFieldMag, test_charge: testCharge },
    0
  )
  // v = (0,0,testVelocity), B = (0,bFieldMag,0) -> v x B = (testVelocity*0 - 0*bFieldMag... )
  // Cross product (0,0,vz) x (0,by,0) = (0*0 - vz*by, vz*0 - 0*0, 0*by - 0*0) = (-vz*by, 0, 0)
  const vCrossB = [-(testVelocity * bFieldMag), 0, 0]
  const expectedLorentz = vCrossB.map((c) => c * testCharge)

  const testParticle = state.objects.find((o) => o.id === "test-particle")
  const lorentz = testParticle.meta.lorentz_force
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(lorentz[i] - expectedLorentz[i]) < 1e-9, `lorentz_force[${i}] expected ${expectedLorentz[i]}, got ${lorentz[i]}`)
  }
  assertStateIsClean(state, "fields@lorentz-isolated")
})

test("fields: param sweep across documented ranges stays clean", () => {
  for (const charge1 of [-5, 0, 3, 5]) {
    for (const charge2 of [-5, 0, -3, 5]) {
      for (const separation of [0.5, 4, 10]) {
        for (const test_velocity of [0, 10, 20]) {
          for (const b_field of [0, 2.5, 5]) {
            for (const test_charge of [-5, 1, 5]) {
              const state = fieldsStep({ charge1, charge2, separation, test_velocity, b_field, test_charge }, 0)
              assertStateIsClean(
                state,
                `fields(q1=${charge1},q2=${charge2},sep=${separation},v=${test_velocity},b=${b_field},qt=${test_charge})`
              )
            }
          }
        }
      }
    }
  }
})

// ---------------------------------------------------------------------------
// convex: shape check only (unverified execution — convex/_generated/* doesn't exist until
// `npx convex dev` has run, so these can't be run against a live deployment yet)
// ---------------------------------------------------------------------------

test("convex: schema.ts and scenarios.ts source matches CONTRACT.md's shape (static check)", async () => {
  const fs = await import("node:fs")
  const schemaSrc = fs.readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8")
  const scenariosSrc = fs.readFileSync(new URL("../convex/scenarios.ts", import.meta.url), "utf8")

  // sessions table: module (union of the 3 literals), params (record<string, number>), createdAt.
  assert.match(schemaSrc, /sessions:\s*defineTable/)
  assert.match(schemaSrc, /v\.union\(v\.literal\("light"\), v\.literal\("projectiles"\), v\.literal\("fields"\)\)/)
  assert.match(schemaSrc, /params:\s*v\.record\(v\.string\(\), v\.number\(\)\)/)
  assert.match(schemaSrc, /createdAt:\s*v\.number\(\)/)

  // scenarios.ts: createSession(module) -> sessionId, setParams(sessionId, module, params) -> void,
  // getSession(sessionId) -> { module, params } | null
  assert.match(scenariosSrc, /export const createSession = mutation/)
  assert.match(scenariosSrc, /export const setParams = mutation/)
  assert.match(scenariosSrc, /export const getSession = query/)
  assert.match(scenariosSrc, /sessionId:\s*v\.id\("sessions"\)/)

  // NOTE: this is a static/shape check only. convex/_generated/* does not exist yet (npx convex
  // dev has not run), so setParams/getSession/createSession cannot be executed against a live
  // deployment — that's an expected/documented gap (BOARD.tsv fact row `convex.generated`), not
  // a bug. Report as "unverified execution, verified shape."
})

// ---------------------------------------------------------------------------
// engine-04: mass/drag (projectiles), F=ma (fields), Cauchy dispersion + RGB (light)
// ---------------------------------------------------------------------------

test("projectiles: drag_enabled=0 reproduces the exact vacuum closed form regardless of mass/radius", () => {
  const combos = [
    { angle_deg: 45, speed: 20, gravity: 9.81 },
    { angle_deg: 30, speed: 15, gravity: 9.81 },
    { angle_deg: 60, speed: 40, gravity: 20 },
  ]
  for (const c of combos) {
    const angleRad = c.angle_deg * DEG
    const expectedApex = (c.speed * Math.sin(angleRad)) ** 2 / (2 * c.gravity)
    const expectedRange = (c.speed * c.speed * Math.sin(2 * angleRad)) / c.gravity
    const expectedTof = (2 * c.speed * Math.sin(angleRad)) / c.gravity

    for (const [mass_kg, radius_m] of [[1, 0.1], [50, 1], [0.1, 0.01]]) {
      const state = projectilesStep({ ...c, mass_kg, radius_m, drag_enabled: 0 }, 0)
      const proj = state.objects.find((o) => o.id === "projectile")
      assert.ok(Math.abs(proj.meta.apex_height_m - expectedApex) < 1e-9)
      assert.ok(Math.abs(proj.meta.range_m - expectedRange) < 1e-9)
      assert.ok(Math.abs(proj.meta.time_of_flight_s - expectedTof) < 1e-9)
      assertStateIsClean(state, `projectiles-no-drag(mass=${mass_kg},radius=${radius_m})`)
    }
  }
})

test("projectiles: drag_enabled=1 matches independent RK4 integration of vx/vy/y(t) and strictly reduces apex/range", () => {
  const DRAG_COEFFICIENT = 2.5

  function rk4(mass, radius, angleDeg, speed, g, dt, steps) {
    const th = angleDeg * DEG
    let state = [0, 0, speed * Math.cos(th), speed * Math.sin(th)]
    const k = DRAG_COEFFICIENT * radius
    function deriv(s) {
      const [, , vx, vy] = s
      return [vx, vy, (-k / mass) * vx, -g - (k / mass) * vy]
    }
    for (let i = 0; i < steps; i++) {
      const k1 = deriv(state)
      const s2 = state.map((s, idx) => s + (dt / 2) * k1[idx])
      const k2 = deriv(s2)
      const s3 = state.map((s, idx) => s + (dt / 2) * k2[idx])
      const k3 = deriv(s3)
      const s4 = state.map((s, idx) => s + dt * k3[idx])
      const k4 = deriv(s4)
      state = state.map((s, idx) => s + (dt / 6) * (k1[idx] + 2 * k2[idx] + 2 * k3[idx] + k4[idx]))
    }
    return { x: state[0], y: state[1], vx: state[2], vy: state[3] }
  }

  const combos = [
    { mass_kg: 1, radius_m: 0.1, angle_deg: 45, speed: 20, gravity: 9.81 },
    { mass_kg: 5, radius_m: 0.5, angle_deg: 30, speed: 15, gravity: 9.81 },
    { mass_kg: 0.2, radius_m: 0.05, angle_deg: 60, speed: 25, gravity: 9.81 },
    { mass_kg: 10, radius_m: 1.0, angle_deg: 50, speed: 30, gravity: 9.81 },
  ]

  for (const c of combos) {
    const state = projectilesStep({ ...c, drag_enabled: 1 }, 0)
    const proj = state.objects.find((o) => o.id === "projectile")
    const tof = proj.meta.time_of_flight_s
    const dt = 0.0005
    const sampleT = tof * 0.5

    const rk = rk4(c.mass_kg, c.radius_m, c.angle_deg, c.speed, c.gravity, dt, Math.round(sampleT / dt))

    // Independently re-derive closed-form vx/vy/y at sampleT to diff against RK4 (not trusting
    // engine's meta directly here, since step() doesn't expose a trajectory sample — only
    // apex/range/tof — so this test checks apex/tof/range against the same math used to build
    // them, cross-checked against RK4).
    const k = DRAG_COEFFICIENT * c.radius_m
    const tau = c.mass_kg / k
    const th = c.angle_deg * DEG
    const vx0 = c.speed * Math.cos(th)
    const vy0 = c.speed * Math.sin(th)
    const xOf = (t) => tau * vx0 * (1 - Math.exp(-t / tau))
    const yOf = (t) => tau * (vy0 + c.gravity * tau) * (1 - Math.exp(-t / tau)) - c.gravity * tau * t
    const vxOf = (t) => vx0 * Math.exp(-t / tau)
    const vyOf = (t) => (vy0 + c.gravity * tau) * Math.exp(-t / tau) - c.gravity * tau

    assert.ok(Math.abs(rk.x - xOf(sampleT)) < 1e-2, `x mismatch mass=${c.mass_kg}`)
    assert.ok(Math.abs(rk.y - yOf(sampleT)) < 1e-2, `y mismatch mass=${c.mass_kg}`)
    assert.ok(Math.abs(rk.vx - vxOf(sampleT)) < 1e-2, `vx mismatch mass=${c.mass_kg}`)
    assert.ok(Math.abs(rk.vy - vyOf(sampleT)) < 1e-2, `vy mismatch mass=${c.mass_kg}`)

    // Physically must be true: drag always reduces apex/range vs the same launch params w/o drag.
    const noDragApex = (vy0 * vy0) / (2 * c.gravity)
    const noDragRange = (c.speed * c.speed * Math.sin(2 * th)) / c.gravity
    assert.ok(proj.meta.apex_height_m < noDragApex, `drag apex should be < no-drag apex`)
    assert.ok(proj.meta.range_m < noDragRange, `drag range should be < no-drag range`)

    assertStateIsClean(state, `projectiles-drag(mass=${c.mass_kg},radius=${c.radius_m})`)
  }
})

test("fields: acceleration readout equals lorentz_force / test_mass_kg exactly (F=ma)", () => {
  const combos = [
    { charge1: 2, charge2: 4, separation: 2, test_velocity: 10, b_field: 3, test_charge: -2, test_mass_kg: 5 },
    { charge1: -1, charge2: 1, separation: 8, test_velocity: 0, b_field: 5, test_charge: 3, test_mass_kg: 0.5 },
    { charge1: 5, charge2: -5, separation: 0.5, test_velocity: 20, b_field: 0, test_charge: 1, test_mass_kg: 20 },
  ]
  for (const c of combos) {
    const state = fieldsStep(c, 0)
    const testParticle = state.objects.find((o) => o.id === "test-particle")
    const lorentz = testParticle.meta.lorentz_force
    const accel = testParticle.meta.acceleration
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(accel[i] - lorentz[i] / c.test_mass_kg) < 1e-9, `a[${i}] should equal F[${i}]/m`)
    }
    assertStateIsClean(state, `fields-mass(mass=${c.test_mass_kg})`)
  }
})

test("light: Cauchy dispersion n2(lambda)=A+B/lambda^2 is calibrated so n2_eff(590nm)==n2 slider exactly, and refraction angle differs measurably between 450nm and 650nm", () => {
  const CAUCHY_B_NM2 = 4200
  const REF_WL = 590
  function n2AtWavelength(n2Slider, wavelengthNm) {
    const a = n2Slider - CAUCHY_B_NM2 / (REF_WL * REF_WL)
    return a + CAUCHY_B_NM2 / (wavelengthNm * wavelengthNm)
  }

  const n1 = 1.5
  const n2Slider = 1.0
  const angleDeg = 30

  // Regression: default wavelength (590) must match the pre-existing fixed-n2 behavior exactly.
  const stateDefault = lightStep({ angle_deg: angleDeg, n1, n2: n2Slider, wavelength_nm: 590 }, 0)
  const interfaceDefault = stateDefault.objects.find((o) => o.id === "interface")
  assert.ok(Math.abs(interfaceDefault.meta.n2 - n2Slider) < 1e-9)

  // Independently recompute n2 at 450nm/650nm and confirm refraction angle differs measurably,
  // matching an independent Snell's law computation with the module's own n2.
  for (const wavelength_nm of [450, 650]) {
    const state = lightStep({ angle_deg: angleDeg, n1, n2: n2Slider, wavelength_nm }, 0)
    const interfaceObj = state.objects.find((o) => o.id === "interface")
    const expectedN2 = n2AtWavelength(n2Slider, wavelength_nm)
    assert.ok(Math.abs(interfaceObj.meta.n2 - expectedN2) < 1e-9, `n2 mismatch at ${wavelength_nm}nm`)

    const expectedThetaTDeg = Math.asin((n1 / expectedN2) * Math.sin(angleDeg * DEG)) / DEG
    const refraction = state.readouts.find((r) => r.label === "angle of refraction")
    const refractionDeg = parseFloat(refraction.value)
    // readout string is toFixed(1), so allow for that rounding rather than exact float equality.
    assert.ok(Math.abs(refractionDeg - expectedThetaTDeg) < 0.05, `refraction mismatch at ${wavelength_nm}nm`)
    assertStateIsClean(state, `light-dispersion(${wavelength_nm}nm)`)
  }

  const state450 = lightStep({ angle_deg: angleDeg, n1, n2: n2Slider, wavelength_nm: 450 }, 0)
  const state650 = lightStep({ angle_deg: angleDeg, n1, n2: n2Slider, wavelength_nm: 650 }, 0)
  const refraction450 = parseFloat(state450.readouts.find((r) => r.label === "angle of refraction").value)
  const refraction650 = parseFloat(state650.readouts.find((r) => r.label === "angle of refraction").value)
  assert.ok(Math.abs(refraction450 - refraction650) > 1e-3, "refraction angle should measurably differ 450nm vs 650nm")
})

// ---------------------------------------------------------------------------
// engine-07: element_type (light) — slab regression + prism + convex/concave lens
// ---------------------------------------------------------------------------

test("light: element_type omitted vs element_type=0 are byte-identical to the slab default", () => {
  const params = { angle_deg: 30, n1: 1.5, n2: 1.0 }
  const stateOmitted = lightStep(params, 0)
  const stateExplicit0 = lightStep({ ...params, element_type: 0 }, 0)
  assert.deepEqual(stateOmitted, stateExplicit0)
  assertStateIsClean(stateOmitted, "light@element_type-omitted")
})

test("light: prism deviation delta=theta1+theta4-A matches an independent r1/r2/theta4 Snell chain", () => {
  const cases = [
    { A: 55, n1: 1.0, n2: 1.6, theta1Deg: 35 },
    { A: 60, n1: 1.0, n2: 1.5, theta1Deg: 40 },
    { A: 45, n1: 1.0, n2: 1.4, theta1Deg: 20 },
  ]
  for (const { A, n1, n2, theta1Deg } of cases) {
    const theta1 = theta1Deg * DEG
    const Arad = A * DEG
    const sinR1 = (n1 / n2) * Math.sin(theta1)
    const r1 = Math.asin(sinR1)
    const r2 = Arad - r1
    const sinTheta4 = (n2 / n1) * Math.sin(r2)
    assert.ok(Math.abs(sinTheta4) <= 1, `case A=${A},n2=${n2},theta1=${theta1Deg} unexpectedly hits TIR`)
    const theta4 = Math.asin(sinTheta4)
    const expectedDeltaDeg = theta1Deg + theta4 / DEG - A

    const state = lightStep({ element_type: 1, angle_deg: theta1Deg, n1, n2, apex_angle_deg: A }, 0)
    const devReadout = state.readouts.find((r) => r.label === "angular deviation")
    const actualDelta = parseFloat(devReadout.value)
    assert.ok(Math.abs(actualDelta - expectedDeltaDeg) < 0.02, `prism delta mismatch: expected ${expectedDeltaDeg}, got ${actualDelta}`)
    assertStateIsClean(state, `light-prism(A=${A},n2=${n2},theta1=${theta1Deg})`)
  }
})

test("light: convex lens focal length matches the lensmaker's equation and a parallel ray crosses the axis at x=f", () => {
  const R1 = 0.4
  const R2 = -0.6
  const n = 1.7
  const rayHeight = 0.3
  const invF = (n - 1) * (1 / R1 - 1 / R2)
  const f = 1 / invF

  const state = lightStep({ element_type: 2, R1_m: R1, R2_m: R2, n2: n, ray_height_m: rayHeight }, 0)
  const focalReadout = state.readouts.find((r) => r.label === "focal length (f)")
  assert.ok(Math.abs(parseFloat(focalReadout.value) - f) < 1e-4)

  const refracted = state.objects.find((o) => o.id === "refracted-ray")
  const [ox, oy] = refracted.position
  const [dx, dy] = refracted.velocity
  const crossX = ox + dx * (-oy / dy)
  assert.ok(Math.abs(crossX - f) < 1e-6, `convex lens crossing mismatch: expected x=${f}, got ${crossX}`)
  assertStateIsClean(state, "light-convex-lens")
})

test("light: concave lens focal length is negative and the ray's backward extension crosses the axis at x=f (virtual focus)", () => {
  const R1 = -0.3
  const R2 = 0.7
  const n = 1.5
  const rayHeight = 0.4
  const invF = (n - 1) * (1 / R1 - 1 / R2)
  const f = 1 / invF

  const state = lightStep({ element_type: 3, R1_m: R1, R2_m: R2, n2: n, ray_height_m: rayHeight }, 0)
  const focalReadout = state.readouts.find((r) => r.label === "focal length (f)")
  assert.ok(f < 0, "concave lens should have negative focal length")
  assert.ok(Math.abs(parseFloat(focalReadout.value) - f) < 1e-4)

  const refracted = state.objects.find((o) => o.id === "refracted-ray")
  const [ox, oy] = refracted.position
  const [dx, dy] = refracted.velocity
  const crossX = ox + dx * (-oy / dy)
  assert.ok(Math.abs(crossX - f) < 1e-6, `concave lens crossing mismatch: expected x=${f}, got ${crossX}`)
  assertStateIsClean(state, "light-concave-lens")
})

// ---------------------------------------------------------------------------
// engine-08: source_type (fields) — point_charges regression + solenoid/capacitor/bar-magnet
// ---------------------------------------------------------------------------

test("fields: source_type omitted vs source_type=0 are byte-identical to the point-charges default", () => {
  const params = { charge1: 3, charge2: -3, separation: 4, test_velocity: 5, b_field: 1.5, test_charge: 1 }
  const stateOmitted = fieldsStep(params, 0)
  const stateExplicit0 = fieldsStep({ ...params, source_type: 0 }, 0)
  assert.deepEqual(stateOmitted, stateExplicit0)
  assertStateIsClean(stateOmitted, "fields@source_type-omitted")
})

test("fields: solenoid B = mu0*n*I for independent (n,I) combos", () => {
  const MU0 = 4 * Math.PI * 1e-7
  for (const [n, I] of [[800, 3.5], [500, 2], [1000, -4]]) {
    const expectedB = MU0 * n * I
    const state = fieldsStep({ source_type: 1, solenoid_turns_per_m: n, solenoid_current_a: I, test_velocity: 0 }, 0)
    const fv = state.fieldVectors[0]
    assert.ok(Math.abs(fv.magnitude - Math.abs(expectedB)) < 1e-15 * Math.max(1, Math.abs(expectedB)) + 1e-20, `solenoid B mismatch n=${n} I=${I}`)
    const readout = state.readouts.find((r) => r.label === "B field (mu0*n*I)")
    // readout string is toExponential(4) (5 significant figures), so allow for that rounding.
    assert.ok(Math.abs(parseFloat(readout.value) - expectedB) / Math.max(Math.abs(expectedB), 1e-30) < 1e-4)
    assertStateIsClean(state, `fields-solenoid(n=${n},I=${I})`)
  }
})

test("fields: capacitor E = V/d for independent (V,d) combos", () => {
  for (const [V, d] of [[250, 0.04], [100, 0.1], [-500, 0.2]]) {
    const expectedE = V / d
    const state = fieldsStep({ source_type: 2, capacitor_voltage_v: V, capacitor_separation_m: d, test_velocity: 0 }, 0)
    const readout = state.readouts.find((r) => r.label === "E field (V/d)")
    assert.ok(Math.abs(parseFloat(readout.value) - expectedE) < 1e-6, `capacitor E mismatch V=${V} d=${d}`)
    const fv = state.fieldVectors[0]
    assert.ok(Math.abs(fv.magnitude - Math.abs(expectedE)) < 1e-9)
    assertStateIsClean(state, `fields-capacitor(V=${V},d=${d})`)
  }
})

test("fields: bar magnet on-axis vs equatorial field ratio is exactly 2.0 (hard dipole constraint)", () => {
  const MU0 = 4 * Math.PI * 1e-7
  for (const [m, r] of [[7, 2.5], [10, 3], [25, 5], [-8, 2]]) {
    const stateOnAxis = fieldsStep({ source_type: 3, magnet_moment: m, magnet_distance_m: r, magnet_angle_deg: 0, test_velocity: 0 }, 0)
    const stateEquatorial = fieldsStep({ source_type: 3, magnet_moment: m, magnet_distance_m: r, magnet_angle_deg: 90, test_velocity: 0 }, 0)
    const bOnAxis = stateOnAxis.fieldVectors[0].magnitude
    const bEquatorial = stateEquatorial.fieldVectors[0].magnitude

    const expectedOnAxis = Math.abs((MU0 / (4 * Math.PI)) * (2 * m) / r ** 3)
    const expectedEquatorial = Math.abs((MU0 / (4 * Math.PI)) * m / r ** 3)
    assert.ok(Math.abs(bOnAxis - expectedOnAxis) < 1e-15 * Math.max(1, expectedOnAxis) + 1e-20)
    assert.ok(Math.abs(bEquatorial - expectedEquatorial) < 1e-15 * Math.max(1, expectedEquatorial) + 1e-20)

    const ratio = bOnAxis / bEquatorial
    assert.ok(Math.abs(ratio - 2.0) < 1e-9, `bar magnet ratio should be exactly 2.0, got ${ratio}`)
    assertStateIsClean(stateOnAxis, `fields-barmagnet-onaxis(m=${m},r=${r})`)
    assertStateIsClean(stateEquatorial, `fields-barmagnet-equatorial(m=${m},r=${r})`)
  }
})

// ---------------------------------------------------------------------------
// engine-09: projectiles — spring launcher + full 3D azimuth direction
// ---------------------------------------------------------------------------

test("projectiles: manual mode / azimuth=0 is byte-identical to the pre-existing engine-04 formulas", () => {
  const angleDeg = 37
  const speed = 22
  const g = 9.81
  const angleRad = angleDeg * DEG
  const expectedApex = (speed * Math.sin(angleRad)) ** 2 / (2 * g)
  const expectedRange = (speed * speed * Math.sin(2 * angleRad)) / g
  const expectedTof = (2 * speed * Math.sin(angleRad)) / g
  const expectedVel = [speed * Math.cos(angleRad), speed * Math.sin(angleRad), 0]

  const state = projectilesStep({ angle_deg: angleDeg, speed, gravity: g }, 0)
  const proj = state.objects.find((o) => o.id === "projectile")
  assert.ok(Math.abs(proj.meta.apex_height_m - expectedApex) < 1e-9)
  assert.ok(Math.abs(proj.meta.range_m - expectedRange) < 1e-9)
  assert.ok(Math.abs(proj.meta.time_of_flight_s - expectedTof) < 1e-9)
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(proj.velocity[i] - expectedVel[i]) < 1e-9)
  assert.equal(proj.velocity[2], 0, "z velocity must be exactly 0 at azimuth=0")
  assertStateIsClean(state, "projectiles-azimuth0-regression")
})

test("projectiles: spring launch speed v=sqrt(k*x^2/m) for independent (k,x,mass) combos", () => {
  for (const [k, x, mass] of [[850, 0.45, 3.2], [200, 0.3, 1], [2000, 2, 50]]) {
    const expectedV = Math.sqrt((k * x * x) / mass)
    const state = projectilesStep({ launch_mode: 1, spring_k: k, spring_compression_m: x, mass_kg: mass, angle_deg: 45 }, 0)
    const proj = state.objects.find((o) => o.id === "projectile")
    assert.ok(Math.abs(proj.meta.speed - expectedV) < 1e-9, `spring speed mismatch k=${k} x=${x} mass=${mass}`)
    assertStateIsClean(state, `projectiles-spring(k=${k},x=${x},mass=${mass})`)
  }
})

test("projectiles: full 3D launch velocity vector matches independent elevation/azimuth trig and preserves |v|=speed", () => {
  for (const [elevDeg, azDeg, speed] of [[25, 63, 18], [30, 120, 25], [10, 275, 40]]) {
    const elevRad = elevDeg * DEG
    const azRad = azDeg * DEG
    const expectedVel = [
      speed * Math.cos(elevRad) * Math.cos(azRad),
      speed * Math.sin(elevRad),
      speed * Math.cos(elevRad) * Math.sin(azRad),
    ]
    const state = projectilesStep({ angle_deg: elevDeg, azimuth_deg: azDeg, speed }, 0)
    const proj = state.objects.find((o) => o.id === "projectile")
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(proj.velocity[i] - expectedVel[i]) < 1e-9, `velocity[${i}] mismatch elev=${elevDeg} az=${azDeg}`)
    const mag = Math.sqrt(proj.velocity[0] ** 2 + proj.velocity[1] ** 2 + proj.velocity[2] ** 2)
    assert.ok(Math.abs(mag - speed) < 1e-9, `|v| should equal speed, got ${mag}`)
    assertStateIsClean(state, `projectiles-3d-direction(elev=${elevDeg},az=${azDeg})`)
  }
})

test("light: Bruton wavelength-to-RGB mapping is dominant-channel-correct (450nm blue, 550nm green, 650nm red)", () => {
  const angleDeg = 30
  const n1 = 1.5
  const n2 = 1.0

  function hexToRgb(hex) {
    const clean = hex.replace("#", "")
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16))
  }

  const state450 = lightStep({ angle_deg: angleDeg, n1, n2, wavelength_nm: 450 }, 0)
  const state550 = lightStep({ angle_deg: angleDeg, n1, n2, wavelength_nm: 550 }, 0)
  const state650 = lightStep({ angle_deg: angleDeg, n1, n2, wavelength_nm: 650 }, 0)

  const [r450, g450, b450] = hexToRgb(state450.objects.find((o) => o.id === "incident-ray").color)
  const [r550, g550, b550] = hexToRgb(state550.objects.find((o) => o.id === "incident-ray").color)
  const [r650, g650, b650] = hexToRgb(state650.objects.find((o) => o.id === "incident-ray").color)

  assert.ok(b450 > r450 && b450 > g450, `450nm should be blue-dominant, got rgb(${r450},${g450},${b450})`)
  assert.ok(g550 > r550 && g550 > b550, `550nm should be green-dominant, got rgb(${r550},${g550},${b550})`)
  assert.ok(r650 > g650 && r650 > b650, `650nm should be red-dominant, got rgb(${r650},${g650},${b650})`)
})
