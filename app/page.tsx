"use client"

import { useCallback, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { Scene } from "@/components/Scene"
import { ModuleSwitcher } from "@/components/ModuleSwitcher"
import { ControlPanel } from "@/components/ControlPanel"
import { ReadoutCard } from "@/components/ReadoutCard"
import { SponsorCredits } from "@/components/SponsorCredits"
import type { CameraView } from "@/components/CameraRig"
import { MODULE_META, defaultParams, type ModuleId } from "@/components/modules/types"
import { PALETTE } from "@/components/palette"
import type { ScenarioState } from "@/lib/physics/types"

export default function Home() {
  const [module, setModule] = useState<ModuleId>("light")
  // Decoupled from `module`: the camera's actual current view. Starts at
  // "hub" (the neutral overview shot) rather than snapping straight to a
  // module preset on load, per repeated feedback that the camera should
  // start from the main/overview shot and travel in/out of module "rooms"
  // rather than hard-cutting between disconnected presets. Picking a
  // module tab moves the camera into that module; "Home" pulls it back out
  // to the hub without changing which module's controls/content are active.
  const [cameraView, setCameraView] = useState<CameraView>("hub")
  const [readouts, setReadouts] = useState<ScenarioState["readouts"]>([])

  const selectModule = useCallback((m: ModuleId) => {
    setModule(m)
    setCameraView(m)
  }, [])

  const goHome = useCallback(() => {
    setCameraView("hub")
  }, [])

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
        <Scene module={module} cameraView={cameraView} paramsRef={activeParamsRef} onReadouts={onReadouts} />
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
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={goHome}
              title="Return to the hub overview"
              className="rounded-full border border-white/10 bg-black/50 px-4 py-2 text-sm font-medium text-white/75 backdrop-blur-md shadow-2xl transition-colors hover:text-white"
              style={cameraView === "hub" ? { color: "#0a0a0a", backgroundColor: PALETTE.silver } : undefined}
            >
              Home
            </button>
            <ModuleSwitcher active={module} onSelect={selectModule} />
          </div>
        </div>

        <div className="flex items-end justify-between gap-4">
          <ControlPanel module={module} paramsRef={activeParamsRef} accent={meta.accent} />
          <ReadoutCard title={meta.label} readouts={readouts} accent={meta.accent} />
        </div>
      </div>
    </div>
  )
}
