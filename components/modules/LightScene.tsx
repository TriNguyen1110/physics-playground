"use client"

import { useEffect, type MutableRefObject } from "react"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as lightStep } from "@/lib/physics/light"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

export function LightScene({
  paramsRef,
  onReadouts,
}: {
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  const state = useLiveScenario(lightStep, paramsRef)

  useEffect(() => {
    onReadouts(state.readouts)
  }, [state, onReadouts])

  return (
    <group>
      {state.objects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
    </group>
  )
}
