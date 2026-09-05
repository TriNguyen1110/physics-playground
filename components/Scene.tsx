"use client"

import { Suspense, type MutableRefObject } from "react"
import { Environment, ContactShadows } from "@react-three/drei"
import { CameraRig } from "@/components/CameraRig"
import { LightScene } from "@/components/modules/LightScene"
import { FieldsScene } from "@/components/modules/FieldsScene"
import { ProjectilesScene } from "@/components/modules/ProjectilesScene"
import { PALETTE } from "@/components/palette"
import type { ModuleId } from "@/components/modules/types"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

// Beaker-by-Thix aesthetic: one dark laboratory void, never a different
// backdrop per module. Each module's identity lives in what glows, not in
// the environment behind it.
const VOID_COLOR = PALETTE.black

// Locked palette: each module's rim/fill light picks its glow out of the
// dark using the SAME accent it uses everywhere else (MODULE_META.accent),
// not an unrelated per-module hue.
const RIM_LIGHT_COLOR: Record<ModuleId, string> = {
  light: PALETTE.cyan,
  projectiles: PALETTE.maroon,
  fields: PALETTE.silver,
}

export function Scene({
  module,
  paramsRef,
  onReadouts,
}: {
  module: ModuleId
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  return (
    <>
      <color attach="background" args={[VOID_COLOR]} />
      {/* far bumped 30->70->110: the projectiles camera preset sits further
          back than that (see CameraRig.tsx) to fit both the default arc and
          steeper/faster launches the sliders can reach — at far=70 the
          ground/wall/ball were fogged down to near-indistinguishable-from-
          black at that distance, which was the root cause of the "empty
          canvas" bug, not a missing mesh. light/fields' cameras stay within
          ~10 units of their content and are unaffected by raising this. */}
      <fog attach="fog" args={[VOID_COLOR, 8, module === "projectiles" ? 110 : 70]} />

      <CameraRig module={module} />

      {/* Dim, cold base lighting — the glowing simulation elements are the
          light source the eye actually reads, not this. */}
      <ambientLight intensity={module === "projectiles" ? 0.22 : 0.12} />
      <directionalLight position={[4, 6, 3]} intensity={0.25} color="#cfe8ff" />
      <pointLight position={[0, 3, 2]} intensity={0.6} color={RIM_LIGHT_COLOR[module]} distance={12} decay={2} />
      {/* Projectiles' camera sits much further from its content than the
          other two modules' (see CameraRig.tsx) — the two lights above are
          both tuned for a ~10-unit radius and don't reach the ground/wall
          out at ~20-40 units, so add a second, wider-throw fill light aimed
          down the range. */}
      {module === "projectiles" && (
        <pointLight position={[16, 18, 10]} intensity={1.4} color={PALETTE.maroon} distance={90} decay={1.6} />
      )}

      <Suspense fallback={null}>
        <Environment preset="night" background={false} environmentIntensity={0.25} />
      </Suspense>

      <ContactShadows position={[0, -0.16, 0]} opacity={0.35} scale={30} blur={2.5} far={10} color="#000000" />

      {module === "light" && <LightScene paramsRef={paramsRef} onReadouts={onReadouts} />}
      {module === "fields" && <FieldsScene paramsRef={paramsRef} onReadouts={onReadouts} />}
      {module === "projectiles" && <ProjectilesScene paramsRef={paramsRef} onReadouts={onReadouts} />}
    </>
  )
}
