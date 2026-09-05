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
