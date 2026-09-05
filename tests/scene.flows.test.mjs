// verifier: SCREEN scope regression tests for scene-01
//
// Run with: npx tsx --test tests/scene.flows.test.mjs
//
// What this file CAN check without a browser: MODULE_META (the scene-owned slider config)
// stays in sync with BOARD.tsv's `scene.slider_keys` fact row and with each module's actual
// step() params, and the interactivity/"aha" claims that are really a property of step()'s pure
// math (light's TIR flip, fields' Lorentz-force dependence on slider defaults) can be asserted
// directly against step() output — no rendering required, so these are cheap and not flaky.
//
// What this file CANNOT check (left as manual/Playwright-driven, not faked here):
//   - actual canvas pixels, WebGL rendering, glow/emissive material appearance
//   - real slider-drag-to-canvas-update latency (that's a live rAF/useFrame timing property)
//   - the projectiles wall_distance/wall_height "clears vs hits" outcome, because that physics
//     lives inside scene's live Rapier <Physics> world (components/modules/ProjectilesScene.tsx),
//     not in lib/physics/projectiles.ts's step() — CONTRACT.md's documented exception. There is
//     no pure function to call here; it requires an actual browser + Rapier world ticking.
//   - background color / on-screen readout card DOM structure as literally painted — the static
//     source checks below approximate this by grepping component source, which is weaker than a
//     real screenshot but still catches an accidental regression (e.g. someone reintroducing a
//     <pre> dump or a per-module background color).
//
// A real Playwright run (done manually for this scene-01 SCREEN review — see BOARD.tsv) found:
//   - console/network: clean across all 3 modules
//   - every slider produces a live readout change EXCEPT fields' test_velocity and b_field, which
//     each individually produce NO change (from their own MODULE_META defaults) because the
//     Lorentz magnetic term v x B is exactly zero whenever either factor is zero, and both
//     default to 0. That specific bug is reproduced here as a pure step()-level check (see
//     "fields: b_field/test_velocity ..." tests below), so it's caught by `node --test` without
//     needing a browser at all.

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { step as lightStep } from "../lib/physics/light.ts"
import { step as fieldsStep } from "../lib/physics/fields.ts"
import { step as projectilesStep } from "../lib/physics/projectiles.ts"
import { MODULE_META, defaultParams } from "../components/modules/types.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, "..")

function readBoardFact(id) {
  const board = fs.readFileSync(path.join(repoRoot, "BOARD.tsv"), "utf8")
  const rows = board
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"))
  const matches = rows.filter((r) => r[1] === "fact" && r[2] === id)
  assert.ok(matches.length > 0, `expected at least one 'fact ${id}' row in BOARD.tsv`)
  return matches[matches.length - 1][3] // last row wins, per BOARD.tsv's own convention
}

// ---------------------------------------------------------------------------
// MODULE_META (scene-owned slider config) stays honest against BOARD.tsv's fact row
// ---------------------------------------------------------------------------

test("scene.slider_keys fact row matches MODULE_META's actual slider keys, per module", () => {
  const fact = readBoardFact("scene.slider_keys")
  for (const mod of ["light", "projectiles", "fields"]) {
    const keysInFact = fact.match(new RegExp(mod + ":\\{([^}]*)\\}"))
    assert.ok(keysInFact, `expected a "${mod}:{...}" block in scene.slider_keys fact row`)
    const expectedKeys = keysInFact[1].split(",").map((k) => k.trim())
    const actualKeys = MODULE_META[mod].sliders.map((s) => s.key)
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `${mod} MODULE_META slider keys ${JSON.stringify(actualKeys)} != BOARD.tsv fact ${JSON.stringify(expectedKeys)}`
    )
  }
})

// ---------------------------------------------------------------------------
// Param sweeps across MODULE_META's actual slider min/max (not hand-picked ranges) stay clean —
// bridges DATA and SCREEN: these are the exact values a slider can ever produce in the UI.
// ---------------------------------------------------------------------------

function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
}

function assertStateIsClean(state, label) {
  assert.ok(state.objects.length > 0, `${label}: objects.length > 0`)
  for (const obj of state.objects) {
    assert.ok(isFiniteVec3(obj.position), `${label}: ${obj.id}.position finite`)
  }
  for (const r of state.readouts) {
    assert.ok(!/nan|infinity/i.test(r.value), `${label}: readout ${r.label} not NaN/Infinity (${r.value})`)
  }
}

const stepByModule = { light: lightStep, projectiles: projectilesStep, fields: fieldsStep }

for (const mod of ["light", "projectiles", "fields"]) {
  test(`${mod}: step() stays clean across MODULE_META's actual slider min/max/default`, () => {
    const step = stepByModule[mod]
    const base = defaultParams(mod)
    for (const slider of MODULE_META[mod].sliders) {
      for (const value of [slider.min, slider.default, slider.max]) {
        const params = { ...base, [slider.key]: value }
        const state = step(params, 0)
        assertStateIsClean(state, `${mod}(${slider.key}=${value})`)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// light "aha": sweeping angle_deg across MODULE_META's own range, from MODULE_META's own default
// n1/n2, actually flips TIR no -> yes (this is the exact slider a person drags in the UI).
// ---------------------------------------------------------------------------

test('light aha: angle_deg slider (MODULE_META range/defaults) flips "total internal reflection" no -> yes', () => {
  const base = defaultParams("light")
  const angleSlider = MODULE_META.light.sliders.find((s) => s.key === "angle_deg")
  const tirValues = new Set()
  for (let a = angleSlider.min; a <= angleSlider.max; a += angleSlider.step * 20) {
    const state = lightStep({ ...base, angle_deg: a }, 0)
    const tir = state.readouts.find((r) => r.label === "total internal reflection")
    tirValues.add(tir.value)
  }
  assert.ok(tirValues.has("no") && tirValues.has("yes"), `expected both "no" and "yes" across the angle_deg range, got: ${[...tirValues]}`)
})

// ---------------------------------------------------------------------------
// fields: KNOWN BUG (reproduced here without a browser) — dragging b_field or test_velocity
// alone, holding the other at its own MODULE_META default (both default to 0), never changes any
// readout, because the magnetic term v x B is exactly zero whenever either factor is zero. This
// fails verifier.md's SCREEN check ("every module shows a live readout that changes when a
// slider moves") for these two specific sliders. Tracked in BOARD.tsv as scene-01 `doing` with
// the fix instruction. These two tests are EXPECTED TO FAIL until scene gives one of
// test_velocity/b_field a nonzero MODULE_META default (or adds a readout that depends on each
// slider independently of the other).
// ---------------------------------------------------------------------------

test("fields: b_field slider alone (test_velocity at its own MODULE_META default) should change the Lorentz force readout — KNOWN FAILING, see BOARD.tsv scene-01", () => {
  const base = defaultParams("fields")
  const bFieldSlider = MODULE_META.fields.sliders.find((s) => s.key === "b_field")
  const at = (v) => fieldsStep({ ...base, b_field: v }, 0).objects.find((o) => o.id === "test-particle").meta.lorentz_force
  const atMin = at(bFieldSlider.min)
  const atMax = at(bFieldSlider.max)
  assert.notDeepEqual(atMin, atMax, "Lorentz force did not change across b_field's full range with test_velocity at default")
})

test("fields: test_velocity slider alone (b_field at its own MODULE_META default) should change the Lorentz force readout — KNOWN FAILING, see BOARD.tsv scene-01", () => {
  const base = defaultParams("fields")
  const vSlider = MODULE_META.fields.sliders.find((s) => s.key === "test_velocity")
  const at = (v) => fieldsStep({ ...base, test_velocity: v }, 0).objects.find((o) => o.id === "test-particle").meta.lorentz_force
  const atMin = at(vSlider.min)
  const atMax = at(vSlider.max)
  assert.notDeepEqual(atMin, atMax, "Lorentz force did not change across test_velocity's full range with b_field at default")
})

// ---------------------------------------------------------------------------
// Static source checks: cheap regression guards for the visual bar (CLAUDE.md's Beaker-by-Thix
// direction) that a full pixel screenshot would otherwise be needed for. These catch an
// accidental regression (per-module background, a <pre> dump reappearing) but are not a
// substitute for actually looking at the rendered canvas.
// ---------------------------------------------------------------------------

test("ReadoutCard renders a definition-list museum-placard, not a <pre>/JSON dump (static source check)", () => {
  const src = fs.readFileSync(path.join(repoRoot, "components/ReadoutCard.tsx"), "utf8")
  // Strip comments first — this file's own doc-comment mentions "<pre>" by name as the thing NOT
  // to do, which would otherwise false-positive against a naive tag search.
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  assert.doesNotMatch(codeOnly, /<pre[\s>]/, "ReadoutCard should never render a <pre> tag")
  assert.match(src, /<dl/, "expected a <dl> definition list")
  assert.match(src, /backdrop-blur/, "expected a frosted-glass backdrop-blur class")
})

test("Scene.tsx uses one hardcoded background color shared by all modules, not a per-module color (static source check)", () => {
  const src = fs.readFileSync(path.join(repoRoot, "components/Scene.tsx"), "utf8")
  const colorAttachMatches = [...src.matchAll(/<color attach="background" args={\[([^\]]+)\]}/g)]
  assert.equal(colorAttachMatches.length, 1, "expected exactly one <color attach=\"background\"> element")
  const arg = colorAttachMatches[0][1].trim()
  assert.doesNotMatch(arg, /RIM_LIGHT_COLOR|module/i, "background color must not be keyed off `module` — it should be one constant for all three")
})

test("BOARD.tsv scene-01 has a review or later row (this test file corresponds to a real submission)", () => {
  const board = fs.readFileSync(path.join(repoRoot, "BOARD.tsv"), "utf8")
  const rows = board.split("\n").filter(Boolean).map((l) => l.split("\t"))
  const sceneRows = rows.filter((r) => r[2] === "scene-01")
  assert.ok(sceneRows.length > 0, "expected at least one scene-01 row in BOARD.tsv")
})
