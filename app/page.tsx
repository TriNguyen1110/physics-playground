"use client"

import { useCallback, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { Scene } from "@/components/Scene"
import { ModuleSwitcher } from "@/components/ModuleSwitcher"
import { ControlPanel } from "@/components/ControlPanel"
import { ReadoutCard } from "@/components/ReadoutCard"
import { SponsorCredits } from "@/components/SponsorCredits"
import { MODULE_META, defaultParams, type ModuleId } from "@/components/modules/types"
import type { ScenarioState } from "@/lib/physics/types"

export default function Home() {
  const [module, setModule] = useState<ModuleId>("light")
  const [readouts, setReadouts] = useState<ScenarioState["readouts"]>([])

  // One persistent params ref per module so switching modules and back
  // doesn't reset sliders. Sliders mutate these directly — no setState.
  const lightParams = useRef(defaultParams("light"))
  const projectilesParams = useRef(defaultParams("projectiles"))
  const fieldsParams = useRef(defaultParams("fields"))

  const paramsByModule = { light: lightParams, projectiles: projectilesParams, fields: fieldsParams } as const
  const activeParamsRef = paramsByModule[module]

  const onReadouts = useCallback((r: ScenarioState["readouts"]) => setReadouts(r), [])

  const meta = MODULE_META[module]

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <Canvas
        shadows
        camera={{ fov: 45, position: [0, 3, 8] }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <Scene module={module} paramsRef={activeParamsRef} onReadouts={onReadouts} />
      </Canvas>

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6">
        <div className="flex items-start justify-between">
          <div className="flex flex-col items-start gap-2">
            <div className="pointer-events-auto">
              <h1 className="text-sm font-semibold tracking-wide text-white/70">
                Physics Playground <span className="text-white/30">/ {meta.label}</span>
              </h1>
            </div>
            <SponsorCredits />
          </div>
          <ModuleSwitcher active={module} onSelect={setModule} />
        </div>

        <div className="flex items-end justify-between gap-4">
          <ControlPanel module={module} paramsRef={activeParamsRef} accent={meta.accent} />
          <ReadoutCard title={meta.label} readouts={readouts} accent={meta.accent} />
        </div>
      </div>
    </div>
  )
}
