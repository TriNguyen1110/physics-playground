"use client"

import { useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

/**
 * Drives a pure analytic `step()` every animation frame, reading params from
 * a ref (written to directly by slider `onChange`, no `setState`) so a
 * slider drag never waits on a React re-render. We only push a new React
 * state (and thus re-render the small object list) when the serialized
 * params actually changed since last frame — recompute is effectively free,
 * so response is indistinguishable from "instant".
 */
export function useLiveScenario(
  step: (params: ScenarioParams, t: number) => ScenarioState,
  paramsRef: React.MutableRefObject<ScenarioParams>
): ScenarioState {
  const [state, setState] = useState<ScenarioState>(() => step(paramsRef.current, 0))
  const lastKey = useRef<string>(JSON.stringify(paramsRef.current))

  useFrame(({ clock }) => {
    const key = JSON.stringify(paramsRef.current)
    if (key !== lastKey.current) {
      lastKey.current = key
      setState(step(paramsRef.current, clock.elapsedTime))
    }
  })

  return state
}
