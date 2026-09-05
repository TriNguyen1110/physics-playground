// verifier: cross-cutting DATA+SCREEN journey tests
//
// Run with: npx tsx --test tests/journeys.test.mjs
//
// Models what a judge actually does in the two-minute demo slot: open the app, cycle through
// all three modules (light -> projectiles -> fields, the exact ModuleSwitcher order in
// components/ModuleSwitcher.tsx), touch a slider in each, and expect both the readout numbers
// and the underlying scenario state to visibly change — fast.
//
// What this file CAN check without a browser: the full per-module round trip through
// MODULE_META's actual slider config (components/modules/types.ts) -> lib/physics/<module>.ts's
// real step() -> a changed, clean ScenarioState, all under a strict wall-clock time budget. This
// exercises the exact same data path a live slider drag drives (useLiveScenario /
// ProjectilesScene's useFrame both just call step(paramsRef.current, t) each frame), so a
// regression here (step() throwing, going non-finite, or getting slow enough to feel laggy)
// would show up as a real demo-breaking symptom.
//
// What this file CANNOT check (left to a live Playwright/Chromium pass, not faked here): actual
// browser paint latency between a slider drag and the next rendered frame, WebGL canvas pixels,
// Rapier's live rigid-body solver for `projectiles` (CONTRACT.md's documented step()-doesn't-
// integrate-trajectory exception — see tests/scene.flows.test.mjs's own header for why), and
// console/network cleanliness. Those were re-confirmed live in Chromium as part of the scene-01
// final re-check (see BOARD.tsv) that this test file accompanies.

import { test } from "node:test"
import assert from "node:assert/strict"

import { step as lightStep } from "../lib/physics/light.ts"
import { step as projectilesStep } from "../lib/physics/projectiles.ts"
import { step as fieldsStep } from "../lib/physics/fields.ts"
import { MODULE_META, defaultParams } from "../components/modules/types.ts"

// Exact order ModuleSwitcher.tsx renders/cycles through — a judge clicking left to right hits
// modules in this order, not alphabetical.
const MODULE_ORDER = ["light", "projectiles", "fields"]
const stepByModule = { light: lightStep, projectiles: projectilesStep, fields: fieldsStep }

// wall_distance/wall_height are scene-owned set pieces (CONTRACT.md's documented exception,
// BOARD.tsv's scene.slider_keys fact row) — lib/physics/projectiles.ts's step() never reads
// them, they only feed a Rapier obstacle built live inside ProjectilesScene.tsx. There is no
// pure-function readout for the "clears vs hits wall" aha; that's covered by the live
// Playwright/Chromium pass in scene-01's verifier note, not here.
const SCENE_OWNED_SLIDERS = { projectiles: new Set(["wall_distance", "wall_height"]) }

// Generous but real budget: a two-minute demo slot with three modules leaves ~40s/module for a
// judge to even notice something's there, let alone for step() itself to run. 200ms for a single
// module's full "open it, sweep every slider once" pass is already a two-orders-of-magnitude
// margin over what step() actually costs (pure math, no I/O) — tight enough to catch a real
// regression (e.g. an accidental O(n^2) loop or a blocking network call sneaking into step()).
const PER_MODULE_BUDGET_MS = 200

function isFiniteVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
}

function assertStateIsClean(state, label) {
  assert.ok(state.objects.length > 0, `${label}: objects.length > 0`)
  for (const obj of state.objects) {
    assert.ok(isFiniteVec3(obj.position), `${label}: ${obj.id}.position finite`)
  }
  assert.ok(state.readouts.length > 0, `${label}: at least one live readout`)
  for (const r of state.readouts) {
    assert.ok(!/nan|infinity/i.test(r.value), `${label}: readout ${r.label} not NaN/Infinity (${r.value})`)
  }
}

test("journey: open the app, cycle light -> projectiles -> fields in ModuleSwitcher order, drag a slider in each, all within budget", () => {
  const start = performance.now()

  for (const mod of MODULE_ORDER) {
    const moduleStart = performance.now()
    const base = defaultParams(mod)
    const step = stepByModule[mod]

    // "Open it" — the state a judge sees the instant they switch to this module, before
    // touching anything.
    const initial = step(base, 0)
    assertStateIsClean(initial, `${mod} on open`)

    // "Drag a slider" — touch every slider this module exposes (not just the first one),
    // sweeping min -> max, and require at least one readout to actually change value somewhere
    // along the sweep. A slider that never changes anything is exactly the class of bug
    // scene-01 was kicked back for twice already (fields' test_velocity/b_field).
    for (const slider of MODULE_META[mod].sliders) {
      const atMin = step({ ...base, [slider.key]: slider.min }, 0)
      const atMax = step({ ...base, [slider.key]: slider.max }, 0)
      assertStateIsClean(atMin, `${mod} ${slider.key}=min`)
      assertStateIsClean(atMax, `${mod} ${slider.key}=max`)

      if (SCENE_OWNED_SLIDERS[mod]?.has(slider.key)) continue // see SCENE_OWNED_SLIDERS above

      const changed = atMin.readouts.some((r, i) => r.value !== atMax.readouts[i]?.value)
      assert.ok(
        changed,
        `${mod}: dragging ${slider.key} from ${slider.min} to ${slider.max} (all other sliders at default) never changed any readout`
      )
    }

    const moduleElapsed = performance.now() - moduleStart
    assert.ok(
      moduleElapsed < PER_MODULE_BUDGET_MS,
      `${mod}: full open+sweep-every-slider pass took ${moduleElapsed.toFixed(1)}ms, over the ${PER_MODULE_BUDGET_MS}ms budget`
    )
  }

  const totalElapsed = performance.now() - start
  // Three modules well inside budget individually should trivially clear a 2s total ceiling;
  // this just guards against something budget-passing-per-module but still creeping overall.
  assert.ok(totalElapsed < 2000, `full three-module journey took ${totalElapsed.toFixed(1)}ms, over the 2000ms ceiling`)
})

test("journey: switching modules and back does not corrupt a module's default state (paramsRef persistence in app/page.tsx)", () => {
  // app/page.tsx keeps one persistent params ref per module (lightParams/projectilesParams/
  // fieldsParams) specifically so switching away and back doesn't reset sliders. Modeled here at
  // the step() level: re-deriving defaultParams(mod) after "visiting" every other module must
  // still produce the exact same default state light/projectiles/fields started with.
  const before = {}
  for (const mod of MODULE_ORDER) before[mod] = stepByModule[mod](defaultParams(mod), 0)

  for (const mod of MODULE_ORDER) {
    for (const other of MODULE_ORDER) {
      stepByModule[other](defaultParams(other), 0) // simulate visiting every other module
    }
  }

  for (const mod of MODULE_ORDER) {
    const after = stepByModule[mod](defaultParams(mod), 0)
    assert.deepEqual(
      after.readouts,
      before[mod].readouts,
      `${mod}: default-state readouts changed after cycling through other modules`
    )
  }
})
