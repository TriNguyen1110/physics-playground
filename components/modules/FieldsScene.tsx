"use client"

import { useEffect, type MutableRefObject } from "react"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { FieldVectorRenderer } from "@/components/FieldVectorRenderer"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as fieldsStep } from "@/lib/physics/fields"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

export function FieldsScene({
  paramsRef,
  onReadouts,
}: {
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  const state = useLiveScenario(fieldsStep, paramsRef)

  useEffect(() => {
    onReadouts(state.readouts)
  }, [state, onReadouts])

  return (
    <group>
      {state.objects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
      {state.fieldVectors && <FieldVectorRenderer vectors={state.fieldVectors} color="#8f6bff" />}
    </group>
  )
}
