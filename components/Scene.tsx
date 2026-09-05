"use client"

import { Suspense, type MutableRefObject } from "react"
import { Environment, ContactShadows } from "@react-three/drei"
import { CameraRig } from "@/components/CameraRig"
import { LightScene } from "@/components/modules/LightScene"
import { FieldsScene } from "@/components/modules/FieldsScene"
import { ProjectilesScene } from "@/components/modules/ProjectilesScene"
import type { ModuleId } from "@/components/modules/types"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

// Beaker-by-Thix aesthetic: one dark laboratory void, never a different
// backdrop per module. Each module's identity lives in what glows, not in
// the environment behind it.
const VOID_COLOR = "#05060a"

const RIM_LIGHT_COLOR: Record<ModuleId, string> = {
  light: "#8fe9ff",
  projectiles: "#ff8a5c",
  fields: "#9a7bff",
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
      <fog attach="fog" args={[VOID_COLOR, 8, 30]} />

      <CameraRig module={module} />

      {/* Dim, cold base lighting — the glowing simulation elements are the
          light source the eye actually reads, not this. */}
      <ambientLight intensity={0.12} />
      <directionalLight position={[4, 6, 3]} intensity={0.25} color="#cfe8ff" />
      <pointLight position={[0, 3, 2]} intensity={0.6} color={RIM_LIGHT_COLOR[module]} distance={12} decay={2} />

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
