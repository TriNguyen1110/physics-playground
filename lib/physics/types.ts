export type Vec3 = [number, number, number]

export type SceneObject = {
  id: string
  kind: "sphere" | "box" | "ray" | "arrow" | "custom"
  position: Vec3
  velocity?: Vec3
  color: string
  radius?: number
  meta?: Record<string, unknown>
}

export type ScenarioState = {
  t: number
  objects: SceneObject[]
  fieldVectors?: { origin: Vec3; direction: Vec3; magnitude: number }[]
  readouts: { label: string; value: string }[]
}

export type ScenarioParams = Record<string, number>

export type Scenario = {
  step: (params: ScenarioParams, t: number) => ScenarioState
}
