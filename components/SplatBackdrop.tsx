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

// PLACEHOLDER WORLD, flagged deliberately: this is operation
// babfd53b-754a-44b6-9468-d25d579609ce, a warm/golden museum hall generated
// BEFORE the palette (maroon/toned-cyan/silver/black/white) was locked. A
// re-generation matching the palette ("dark moody science museum hall,
// near-black void with deep maroon and muted teal-cyan accent lighting,
// brushed silver/steel fixtures") was kicked off as operation
// 6eba91ef-08aa-4d90-b62b-20a2eaadcbd1 but was still IN_PROGRESS after
// ~8 minutes of polling (typical ~5min generation time exceeded) at the end
// of this tick — swap SPLAT_URL below to that operation's spz_urls["100k"]
// (GET /marble/v1/operations/6eba91ef-08aa-4d90-b62b-20a2eaadcbd1) the
// moment it reports done:true. This URL only proves the Spark/R3F
// integration renders a real Marble splat inside the shared Canvas; it is
// NOT the final palette-matched backdrop.
export const SPLAT_URL =
  "https://cdn.marble.worldlabs.ai/d9f02382-d3a2-437e-a0e9-4823bcc93538/ff305adf-71d6-4b78-ab5a-c388c02802ee_dust_100k.spz"

// Marble's own reported semantics for this world (from the generation
// operation's response.assets.splats.semantics_metadata): metric_scale_factor
// converts the splat's native local units to meters, ground_plane_offset is
// how far below the splat's local origin its walkable floor sits (in the
// same local units, pre-scale). We scale the whole mesh by that factor and
// shift it down so the world's own floor lands at GROUND_Y — the same floor
// height ProjectilesScene's Rapier ground collider already uses — so the
// physics objects visually sit ON the splat's floor instead of floating
// over or sinking into it. Re-tune these two numbers first (not anything
// else) if the floor visibly doesn't line up once rendered.
const METRIC_SCALE_FACTOR = 2.316369
const GROUND_PLANE_OFFSET = 1.580335
const GROUND_Y = -0.15

/**
 * The Marble/World Labs generated Gaussian-splat world, rendered as a real
 * 3D object in the shared `<Canvas>` scene graph (see Scene.tsx) — mounted
 * once, not per-module, and sharing the exact same camera/lights/depth as
 * the physics objects (it's a `SplatMesh` object3D, not a background image
 * or a plane behind the UI). That architecture is the right one for "one
 * merged room," but the actual calibration is NOT verified: a live look at
 * an earlier version of this build showed the splat rendering as a small
 * warped/glitchy patch floating disconnected from the scene rather than an
 * enclosing room, which points at METRIC_SCALE_FACTOR/GROUND_PLANE_OFFSET
 * above (or an outright wrong axis/orientation assumption — Marble's exact
 * semantics for those two numbers were inferred from their names, not
 * confirmed against docs) being wrong. This session's browser tooling
 * (playwright, both the MCP server and a direct npx-cached fallback) could
 * not launch here to iterate on it live — every attempt hung indefinitely
 * just importing the package, an environment problem, not a code one.
 *
 * Net effect: this now defaults OFF (opt-in via the `?splat=1` query param,
 * read here directly rather than threaded through page.tsx/Scene.tsx props
 * — this task's scope is `components/**` only) rather than being an
 * off-escape-hatch from an on-by-default splat, specifically so this ships
 * as the previous plain dark void instead of a broken-looking scene. Flip
 * the default (the `!== "1"` below) back to on once someone can actually
 * watch it render and re-tune the scale/position/orientation against
 * what's really in frame.
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
        position={[0, GROUND_Y - GROUND_PLANE_OFFSET * METRIC_SCALE_FACTOR, 0]}
      />
    </Suspense>
  )
}
