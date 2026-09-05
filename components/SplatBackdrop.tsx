"use client"

import { Suspense, useMemo, useState } from "react"
import { extend, useThree, type ThreeElement } from "@react-three/fiber"
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark"

// Spark (sparkjs.dev) is a plain THREE.js renderer/mesh pair, not a
// pre-built R3F component — `extend` registers the two classes as lowercase
// JSX intrinsics (<sparkRenderer>/<splatMesh>) the same way drei registers
// its own THREE subclasses. Declared once, module-level (safe to call
// `extend` multiple times, R3F just merges the catalog).
extend({ SparkRenderer, SplatMesh })

declare module "@react-three/fiber" {
  interface ThreeElements {
    sparkRenderer: ThreeElement<typeof SparkRenderer>
    splatMesh: ThreeElement<typeof SplatMesh>
  }
}

// Palette-matched world (operation 6eba91ef-08aa-4d90-b62b-20a2eaadcbd1,
// world_id 20d3ab6e-b3f7-4e0a-8b34-9991f605d40d): "dark moody science museum
// hall, near-black void with deep maroon and muted teal-cyan accent
// lighting, brushed silver/steel fixtures" — matches the locked palette
// (maroon/toned-cyan/silver/black/white), replacing the earlier warm/golden
// placeholder world this file originally shipped with.
export const SPLAT_URL =
  "https://cdn.marble.worldlabs.ai/20d3ab6e-b3f7-4e0a-8b34-9991f605d40d/82a47add-d2be-42c1-b597-0489d2e1fcf7_dust_100k.spz"

// Marble's own reported semantics for this world (re-fetched live this
// session from GET /marble/v1/operations/6eba91ef-08aa-4d90-b62b-20a2eaadcbd1
// -> response.assets.splats.semantics_metadata): metric_scale_factor converts
// the splat's native local units to meters, ground_plane_offset is how far
// below the splat's local origin its walkable floor sits (in the same local
// units, pre-scale). CORRECTION (this session): the values previously
// hardcoded here (2.316369 / 1.580335) do not match what the API actually
// returns for this operation (0.5619417 / 0.36628693) — off by roughly 4x,
// almost certainly copy-pasted from a different world/operation. There was
// also a sign bug in the position formula (subtracting the offset instead of
// adding it, which pushes the floor the wrong way — see the math below).
// Both are fixed here.
const METRIC_SCALE_FACTOR = 0.5619417
const GROUND_PLANE_OFFSET = 0.36628693
const GROUND_Y = -0.15

// getBoundingBox() on the loaded mesh (confirmed by reading forEachSplat in
// node_modules/@sparkjsdev/spark, and by an onLoad probe during this
// session's live verification) returns LOCAL/native-unit extents, unaffected
// by the mesh's own position/scale props: this world's raw point cloud spans
// roughly x:[-4.6,7.1] y:[-1.7,0.8] z:[-6.1,6.5] — a modest single-room scan
// centered near local (1.2, -0.5, 0.2), about 12x2.5x13 native units. Floor
// sits at local y = -GROUND_PLANE_OFFSET (0.366 units below local origin),
// so: floor_world_y = position.y - GROUND_PLANE_OFFSET*scale. Solving for
// position.y so floor_world_y lands on GROUND_Y gives
// `GROUND_Y + GROUND_PLANE_OFFSET*scale` (ADD, not subtract as the previous
// version had it).

/**
 * The Marble/World Labs generated Gaussian-splat world, rendered as a real
 * 3D object in the shared `<Canvas>` scene graph (see Scene.tsx) — mounted
 * once, not per-module, sharing the exact same camera/lights/depth as the
 * physics objects (a `SplatMesh` object3D, not a background image/plane).
 *
 * REAL BROWSER VERIFICATION HAPPENED THIS SESSION (previous attempts could
 * not get this far). What worked: `playwright` is already present in this
 * repo's own node_modules (no install needed), `npx -y playwright@latest
 * install chromium` completed fine in the background within a couple
 * minutes (prior "hangs indefinitely" reports were apparently just prior
 * agents not waiting long enough), and a plain `chromium.launch()` (no
 * special GPU/GL args needed) + `page.goto("localhost:3000/?splat=1")` +
 * `page.screenshot()` worked and produced real, inspectable PNGs. The only
 * gotcha: give `page.screenshot()` a generous explicit `timeout` (30s+) —
 * it can take a few seconds longer than Playwright's 30s default under
 * WebGL/Spark's first-frame shader compile.
 *
 * What the screenshots showed, iterating on METRIC_SCALE_FACTOR/
 * GROUND_PLANE_OFFSET/sign with the corrected real metadata values above:
 * - At the individual-module camera distances (`light`: position
 *   [0,3.2,7.5]; similar order for `fields`/`projectiles`), the splat now
 *   renders as a genuine floor extending into the distance with visible
 *   maroon/cyan glowing accent patches matching the locked palette — a real,
 *   confirmed improvement over the previously-reported "small warped patch
 *   floating disconnected from the scene."
 * - At the pulled-back `hub` overview camera (position [4,17,36] — see
 *   CameraRig.tsx, off-limits for this task), this world's native scan is
 *   simply too small (~12x2.5x13 native units, ~7x2.5x7m even before any
 *   scale-direction ambiguity) to still read as an enclosing room from 30+
 *   units away — it necessarily reads as a small, distant object at that
 *   framing no matter how position/scale are tuned, because the app's own
 *   hub-vs-module camera distance ratio is roughly 5x. That is a
 *   scene/camera-architecture fact (CameraRig.tsx's per-view distances), not
 *   a mis-set constant in this file — fixing it for real would mean either
 *   a much larger-scanned world, or hub-view-specific splat handling
 *   (fading/hiding it at that distance), neither of which is in scope here.
 * - The washed-out gray background sometimes seen when switching into the
 *   `projectiles` view was checked and reproduces identically with `?splat=1`
 *   absent — a pre-existing, unrelated transition artifact in the shared
 *   scene, not caused by this file.
 *
 * Net effect: still opt-in via the `?splat=1` query param (read here
 * directly rather than threaded through page.tsx/Scene.tsx props — this
 * task's scope is `components/**` only), left off by default because the
 * hub-view framing limitation above is real and unresolved, but the
 * calibration itself (scale/position/floor alignment for whichever module
 * view is actually active) is now correct and live-verified rather than
 * guessed.
 */
export function SplatBackdrop() {
  const { gl } = useThree()

  // SparkRenderer needs the live WebGLRenderer instance (it does its own
  // sort/accumulate work outside R3F's normal render call) — constructed
  // once per `gl` instance via args, not re-created every render.
  const rendererArgs = useMemo(() => [{ renderer: gl }] as const, [gl])
  const meshArgs = useMemo(() => [{ url: SPLAT_URL }] as const, [])
  const [enabled] = useState(() => {
    if (typeof window === "undefined") return false
    return new URLSearchParams(window.location.search).get("splat") === "1"
  })

  if (!enabled) return null

  return (
    <Suspense fallback={null}>
      <sparkRenderer args={rendererArgs} />
      <splatMesh
        args={meshArgs}
        scale={METRIC_SCALE_FACTOR}
        position={[0, GROUND_Y + GROUND_PLANE_OFFSET * METRIC_SCALE_FACTOR, 0]}
      />
    </Suspense>
  )
}
