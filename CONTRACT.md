# Contract — frozen for the day

Three modules, one shared shape. `engine` owns the left column, `scene` owns the right.
Changing this file is a stop-and-say-so, not a silent edit — it breaks whichever agent is
mid-tick on the other side.

## Modules (topics)

`light` | `projectiles` | `fields` (magnetic/electric)

## Scenario config — `lib/physics/<module>.ts`

Each module exports one function with this exact shape. `scene` imports and renders the
result; it never computes physics itself.

```ts
export type Vec3 = [number, number, number]

export type SceneObject = {
  id: string
  kind: "sphere" | "box" | "ray" | "arrow" | "custom"
  position: Vec3
  velocity?: Vec3
  color: string
  radius?: number
  meta?: Record<string, unknown> // e.g. charge, mass, wavelength
}

export type ScenarioState = {
  t: number // seconds since scenario start
  objects: SceneObject[]
  fieldVectors?: { origin: Vec3; direction: Vec3; magnitude: number }[]
  readouts: { label: string; value: string }[] // e.g. "velocity: 4.2 m/s"
}

export type ScenarioParams = Record<string, number> // slider values, e.g. { angle, speed, charge }

export function step(params: ScenarioParams, t: number): ScenarioState
```

`step` is a pure function of `(params, t)`. No hidden mutable state, no `Date.now()`. This is
what makes it independently testable by the verifier and independently renderable by `scene`
without either side touching the other's code.

**Don't hand-derive math a real library already does correctly:**

- `projectiles` is the exception to "pure function" above — real collisions need an actual
  rigid-body solver, not hand-integrated kinematics. `scene` owns a `@react-three/rapier`
  `<Physics>` world for this module and reads live body positions each frame; `engine`'s
  `step()` for `projectiles` only returns the *initial* conditions (launch position/velocity
  from the slider params) that `scene` feeds into a Rapier rigid body on (re)launch, plus the
  closed-form apex/range numbers (from `three`'s own `Vector3` ops, not custom vector math) for
  the readout panel so the displayed numbers can be checked against Rapier's actual trajectory.
- `light` and `fields` stay pure `step()` functions, but built on `THREE.Vector3`/`THREE.Ray`
  (reflect, dot, cross, normalize) instead of reimplementing vector algebra — `THREE.Raycaster`
  and `Ray.reflect` cover mirror/refraction bounces; only Coulomb's law / Lorentz force magnitude
  itself needs to be written out, since no generic library computes that for you.

## Convex schema — `convex/schema.ts`

```ts
sessions: {
  _id: Id<"sessions">
  module: "light" | "projectiles" | "fields"
  params: Record<string, number>
  createdAt: number
}
```

One table for now: a shared session lets two people on the same laptop/room see the same
slider state (the multiplayer hook for the demo). No auth, no user table.

## Convex functions — `convex/scenarios.ts`

```ts
export const setParams: Mutation  // (sessionId, module, params) -> void
export const getSession: Query   // (sessionId) -> { module, params } | null
export const createSession: Mutation // (module) -> sessionId
```

`scene` calls these via `useMutation`/`useQuery`. `engine` owns the implementation.

## API client stubs — `lib/api/*.ts`

Real keys arrive at hackathon check-in. Until then every client below returns canned/mocked
data so `scene` never blocks on network access. Each export throws only if called with no
`NEXT_PUBLIC_*_API_KEY`/`*_API_KEY` env var set AND `mock: false` is passed explicitly —
default is mocked.

```ts
// lib/api/worldlabs.ts
export async function generateWorld(prompt: string, opts?: { mock?: boolean }): Promise<{ previewUrl: string }>

// lib/api/tripo.ts
export async function generateAsset(prompt: string, opts?: { mock?: boolean }): Promise<{ modelUrl: string; format: "glb" }>

// lib/api/mintgg.ts
export async function publishScene(sceneId: string, opts?: { mock?: boolean }): Promise<{ shareUrl: string }>
```

**This is a sponsored hackathon — real sponsor tool usage is a judged requirement, not
optional polish.** The core simulator working without them is a *resilience* property (no
single flaky API call can sink the demo), not a reason to skip them. Target: at least Tripo
(hero 3D assets) and mint.gg (publish) actually wired in and called for real before the 6pm
freeze; World Labs (backdrop) too if time allows. Only fall back to mocked/local if a specific
integration is genuinely blocked (no key, API down) after a real attempt — not by default.

## Fallback table

| Blocked on | Take this instead |
|---|---|
| No World Labs key / API down by ~1pm | Static gradient/skybox background, ship without it |
| No Tripo key / API down | Primitive Three.js meshes (sphere/box) instead of generated assets |
| No mint.gg key / API down | Skip publish step, demo runs locally / from a Vercel preview |
| Convex account issues | Local-only React state (`useState`), drop the multiplayer session sync |

Cut order if the day runs short: mint.gg publish → World Labs backdrop → Tripo assets →
multiplayer session sync. Never cut: the three `step()` functions actually being physically
correct and interactive with visible sliders. That's the demo.
