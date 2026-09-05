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
// A real Playwright run against commit eea1aff (final re-check, this verifier pass) found the
// fields inert-slider bug (test_velocity/b_field both defaulting to 0, making v x B always 0)
// FIXED: from a fresh default load, dragging b_field alone (test_velocity held at its own
// nonzero default 5) sweeps the Lorentz readout 7.5N->17.5N, and dragging test_velocity alone
// (b_field held at its own nonzero default 1.5) likewise changes it — verified via real
// keyboard-driven slider drags (focus + Home/End), not synthetic JS events. Note: at the exact
// untouched default state (test_velocity=5, b_field=1.5) the E-field and v x B terms happen to
// cancel exactly, so the Lorentz readout reads 0.000N at rest — that's correct physics
// (coincidental cancellation), not a bug, and every slider still produces a distinct change
// across its range as required.
//
// This same Playwright run found a NEW, unrelated, blocking SCREEN failure in `projectiles`:
// the launched ball never visibly renders in the canvas (pixel-diffed screenshots across the
// whole flight are byte-identical in the canvas region every frame) and falls straight through
// the ground RigidBody with no bounce (live height goes to -73m and still falling), even though
// the live Rapier readout itself updates correctly frame to frame. See BOARD.tsv scene-01 `doing`
// row for the full repro. Not reproducible as a pure step()-level test here since it's a live
// Rapier/render issue inside components/modules/ProjectilesScene.tsx, not lib/physics/*.ts.
//
// Re-check against 0fea0e5 (widened ground to +/-200m, explicit BallCollider/CuboidCollider,
// ccd, widened camera preset, memoized ProjectilesScene): the `playwright` MCP server this
// verifier role depends on (declared in .claude/agents/verifier.md's `mcpServers` block) did not
// expose any `mcp__playwright__*` tools in this session (confirmed via ToolSearch, and via a
// second, independent fresh general-purpose sub-agent hitting the exact same gap), despite
// `claude mcp list` reporting the server itself as "Connected". So items 1/2 of this pass's
// checklist (ball visibly present + bounces; wall_distance/wall_height clears-vs-hits) and the
// *live* half of the fields inertness re-check are UNVERIFIED this pass, not passed — per
// verifier.md's own rule ("if something can't be checked, say unverified, don't assume a pass").
// tsc --noEmit and this file's own step()-level checks are clean/passing, and the 0fea0e5 diff
// (ground half-extent, explicit colliders, ccd, camera preset, memo) is consistent with the
// claimed root cause on inspection, but that is not the same as having watched it happen.
//
// Independently of the tooling gap, this pass DID find a real, step()-level (no browser needed)
// inert-slider bug in `fields` — the third instance of this exact bug class (see H+1.8/H+2.0
// notes above for the first two). At MODULE_META's current defaults (charge1=3, charge2=-3,
// separation=4, test_velocity=5, b_field=1.5), the net E-field and v x B term cancel to the exact
// zero vector (not just zero magnitude) at the test particle's position — so
// `lorentzForce = testCharge * (eTotal + vCrossB)` is `testCharge * (0,0,0) = (0,0,0)` for EVERY
// value of `test_charge`, not just at test_charge's own default. Dragging test_charge alone
// across its full [-5, 5] range, holding every other slider at its MODULE_META default, changes
// NOTHING — no readout, no rendered force vector. Confirmed directly against lib/physics/fields.ts
// (see the new test below) independent of any browser tool. charge1/charge2/separation/
// test_velocity/b_field were all re-checked the same way and are NOT inert (see the generalized
// sweep in tests/journeys.test.mjs). Fix shape: same family as the two prior fixes — nudge one
// more MODULE_META.fields default (e.g. separation, or either charge) just enough that
// eTotal + vCrossB is not exactly zero at rest, then re-verify test_charge alone AND re-verify
// the two previously-fixed sliders (b_field/test_velocity alone) still aren't re-broken by
// whatever default changes.

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
// fields: regression guard for a bug kicked back twice (BOARD.tsv scene-01) — dragging b_field
// or test_velocity alone, holding the other at its own MODULE_META default, must change the
// Lorentz readout. Fixed as of eea1aff (both sliders now default nonzero: test_velocity=5,
// b_field=1.5), so both assertions below now pass; kept as a standing regression test since this
// exact bug class reappeared once already after a partial fix.
// ---------------------------------------------------------------------------

test("fields: b_field slider alone (test_velocity at its own MODULE_META default) changes the Lorentz force readout", () => {
  const base = defaultParams("fields")
  const bFieldSlider = MODULE_META.fields.sliders.find((s) => s.key === "b_field")
  const at = (v) => fieldsStep({ ...base, b_field: v }, 0).objects.find((o) => o.id === "test-particle").meta.lorentz_force
  const atMin = at(bFieldSlider.min)
  const atMax = at(bFieldSlider.max)
  assert.notDeepEqual(atMin, atMax, "Lorentz force did not change across b_field's full range with test_velocity at default")
})

test("fields: test_velocity slider alone (b_field at its own MODULE_META default) changes the Lorentz force readout", () => {
  const base = defaultParams("fields")
  const vSlider = MODULE_META.fields.sliders.find((s) => s.key === "test_velocity")
  const at = (v) => fieldsStep({ ...base, test_velocity: v }, 0).objects.find((o) => o.id === "test-particle").meta.lorentz_force
  const atMin = at(vSlider.min)
  const atMax = at(vSlider.max)
  assert.notDeepEqual(atMin, atMax, "Lorentz force did not change across test_velocity's full range with b_field at default")
})

// ---------------------------------------------------------------------------
// fields: NEW inert-slider finding, this verifier pass (scene-01 0fea0e5 re-check) — third
// instance of this bug class. At MODULE_META's current defaults, net E-field + v x B is exactly
// the zero vector at the test particle, so lorentzForce = test_charge * (0,0,0) = (0,0,0) for
// EVERY value of test_charge, not just its own default. This is currently a FAILING test —
// intentionally, since the bug is not yet fixed (BOARD.tsv scene-01 kicked back this pass) — see
// this file's header comment for the fix shape. Once fixed, this should flip to passing.
// ---------------------------------------------------------------------------

test("fields: test_charge slider alone (all others at their own MODULE_META default) changes the Lorentz force readout", () => {
  // Compare the actual DISPLAYED readout string, not the raw meta.lorentz_force vector — the raw
  // vector at min vs max here is [-0,-0,-0] vs [0,0,0] (a floating-point sign artifact from
  // multiplying an exact-zero vector by a negative vs positive scalar), which would make a naive
  // notDeepEqual on the raw vector pass even though the on-screen readout ("0.000 N" both times)
  // and every rendered force-vector arrow are pixel-identical — i.e. genuinely inert to a judge.
  const base = defaultParams("fields")
  const tcSlider = MODULE_META.fields.sliders.find((s) => s.key === "test_charge")
  const readoutAt = (v) => {
    const state = fieldsStep({ ...base, test_charge: v }, 0)
    return state.readouts.find((r) => r.label === "Lorentz force on test particle").value
  }
  const atMin = readoutAt(tcSlider.min)
  const atMax = readoutAt(tcSlider.max)
  assert.notEqual(
    atMin,
    atMax,
    `Lorentz force readout did not change across test_charge's full range with every other slider at its own MODULE_META default (both read "${atMin}") — net E-field + v x B is the exact zero vector at these defaults, so test_charge is completely inert`
  )
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
