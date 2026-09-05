"use client"

import { useEffect, useMemo, type MutableRefObject } from "react"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { FieldVectorRenderer } from "@/components/FieldVectorRenderer"
import { PALETTE } from "@/components/palette"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as fieldsStep } from "@/lib/physics/fields"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"
import type { SceneObject } from "@/lib/physics/types"

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

  // lib/physics/fields.ts (engine-owned) hardcodes charge sign colors
  // (red/blue) and a yellow test particle — recolored here, at the scene
  // layer, to the locked palette instead of editing lib/**: positive
  // source charges -> maroon, negative -> toned-down cyan (a coherent
  // mapping, not an arbitrary swap), test particle -> white/silver so it
  // reads as the neutral "probe" against the two charge colors.
  const objects = useMemo<SceneObject[]>(
    () =>
      state.objects.map((o) => {
        if (o.meta?.role === "source") {
          const charge = (o.meta.charge as number) ?? 0
          return { ...o, color: charge >= 0 ? PALETTE.maroon : PALETTE.cyan }
        }
        if (o.meta?.role === "test-particle") {
          return { ...o, color: PALETTE.white }
        }
        return o
      }),
    [state.objects]
  )

  return (
    <group>
      {objects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
      {state.fieldVectors && <FieldVectorRenderer vectors={state.fieldVectors} color={PALETTE.silver} />}
    </group>
  )
}
