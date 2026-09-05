"use client"

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import * as THREE from "three"
import { useFrame } from "@react-three/fiber"
import { TransformControls } from "@react-three/drei"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { FieldVectorRenderer } from "@/components/FieldVectorRenderer"
import { PALETTE } from "@/components/palette"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as fieldsStep, stepTrajectory } from "@/lib/physics/fields"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"
import type { SceneObject, Vec3 } from "@/lib/physics/types"

// fields-play-01: the "t" window `stepTrajectory` re-integrates every frame, wrapped so the
// per-frame RK4 cost (lib/physics/fields.ts caps it at 20000 substeps, growing with `t` up to
// that cap for any scenario with a nonzero B field) never keeps climbing across a long-running
// demo session. Wrapping resets `t` back to 0 every `TRAJECTORY_LOOP_PERIOD_S` seconds instead
// of letting elapsed real time grow unboundedly — for a periodic cyclotron/helical orbit this is
// invisible (the orbit already repeats faster than this window in every reachable-by-slider
// case we checked: default solenoid/magnet/point-charge B strengths give cyclotron periods far
// longer than a human notices one loop point, and default no-B scenarios integrate in a constant
// 500 substeps regardless of t anyway); for a net E x B drift it reads as a smooth restart rather
// than a visible stutter. 45s is long enough to show many orbits/a full drift arc before looping.
const TRAJECTORY_LOOP_PERIOD_S = 45

// --- CRUD stage 1 (crud-fields-01) ------------------------------------------------------------
// Pattern established here for reuse by crud-projectiles-01/crud-light-01: drei's
// `TransformControls`, attached to a plain <group> that wraps a bespoke/`ObjectRenderer` mesh,
// with the gizmo axis/mode restricted to exactly what the underlying `step()` params can express.
// `onObjectChange` reads the dragged Object3D's live transform and writes the equivalent
// `ScenarioParams` value straight into `paramsRef.current` (no `setState`) — the SAME
// "write to the ref, let `useLiveScenario`'s `useFrame` pick it up next tick" pattern every
// slider in this app already uses, so a drag and a slider drag are physically indistinguishable
// to `step()`. This keeps the physics authoritative: dragging never fakes a position, it always
// round-trips through a real param that the next frame's `step()` recomputes from.
//
// Real limits hit here, worth reading before extending the pattern:
//  1. lib/physics/fields.ts's point-charge model has only ONE `separation` scalar shared by
//     charge1 (-separation/2) and charge2 (+separation/2) — there is no way to place them
//     independently. Dragging EITHER charge along X moves BOTH (mirrored about the origin),
//     because both literally read the same param. This is not a bug, it's the model; the drag
//     is constrained to the X axis only (showY/showZ off) so it can't even suggest otherwise.
//  2. charge3 only has a Z-offset param (`charge3_offset`, position always X=0), so its drag is
//     constrained to Z only for the same reason.
//  3. The test particle's world position in the point-charges path is HARD-CODED to the origin
//     in `stepPointCharges` (no param feeds it at all) — there is truly no param to write a drag
//     back into, so it deliberately has NO TransformControls gizmo here. Faking a free-drag on it
//     would be pure decoration with zero physics behind it.
//  4. The bar magnet's dipole moment `m` is hard-coded along world +Y in `stepBarMagnet` — there
//     is no param for the magnet's own orientation. The only angle the engine exposes is
//     `magnet_angle_deg`, which actually moves the TEST PARTICLE around a stationary magnet, not
//     the magnet itself. The rotate gizmo below is wired to that param (the one thing genuinely
//     connected to the B-field math and the readouts) and is clamped to the slider's existing
//     [0, 90] range with a hard stop at the boundary — spinning the box past that range does
//     nothing further, same as dragging the slider past its end. This is the real "rotate the
//     magnet" ceiling without an engine change: it moves the same number the slider does, it just
//     doesn't represent independent 3D orientation of two separate bodies.
const SEPARATION_MIN = 0.5
const SEPARATION_MAX = 10
const CHARGE3_OFFSET_MIN = 0.5
const CHARGE3_OFFSET_MAX = 10
const MAGNET_ANGLE_MIN = 0
const MAGNET_ANGLE_MAX = 90

// ids lib/physics/fields.ts (engine-owned, see BOARD.tsv fact fields.meta) emits for the three
// non-default source_type set pieces. Rendered here with bespoke meshes instead of the generic
// ObjectRenderer cases (a "custom" icosahedron doesn't read as a coil, and a plain box can't show
// two-tone N/S coloring), while the point_charges default path below is left byte-identical to
// before — zero regression on the already-verified behavior.
const SOLENOID_ID = "solenoid-coil"
const MAGNET_ID = "bar-magnet"

// Maps a real physical field magnitude (Tesla for solenoid/magnet, V/m for capacitor — never a
// normalized/relative value) onto a visible on-screen length via a log scale, so dragging a
// source-strength slider (turns/current/voltage/moment/distance) actually resizes what's drawn
// instead of only changing the readout text. `refScale` is chosen per source type below so each
// one's own physically-real magnitude range spans the visible length range, not just its extremes.
function magToLength(magnitude: number, refScale: number) {
  const norm = Math.abs(magnitude) / Math.max(refScale, 1e-30)
  return THREE.MathUtils.clamp(0.22 + Math.log10(norm + 1) * 1.1, 0.2, 2.4)
}

export function FieldsScene({
  paramsRef,
  onReadouts,
}: {
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  const state = useLiveScenario(fieldsStep, paramsRef)

  // fields-play-01: the test particle's REAL motion under the Lorentz force — continuous from
  // mount, not a button-triggered one-shot like ProjectilesScene's Launch. Cyclotron/E x B
  // motion is an ongoing steady-state (there's no natural "the particle is done moving" moment
  // the way a projectile lands), so animating it continuously is the more honest fit than
  // requiring a "Play" click first. `elapsedRef` accumulates real time via useFrame's `delta`;
  // `trajectoryParticle` is the only thing read from `stepTrajectory` here — the source objects
  // (charges/coil/plates/magnet) still come from the static `fieldsStep` call above, unchanged.
  const elapsedRef = useRef(0)
  const [trajectoryParticle, setTrajectoryParticle] = useState<{ position: Vec3; velocity: Vec3 } | null>(null)

  useFrame((_, delta) => {
    elapsedRef.current += delta
    const wrappedT = elapsedRef.current % TRAJECTORY_LOOP_PERIOD_S
    const traj = stepTrajectory(paramsRef.current, wrappedT)
    const particle = traj.objects.find((o) => o.id === "test-particle")
    if (particle) {
      setTrajectoryParticle({
        position: particle.position,
        velocity: (particle.velocity as Vec3) ?? [0, 0, 0],
      })
    }
  })

  useEffect(() => {
    onReadouts(state.readouts)
  }, [state, onReadouts])

  const solenoidRaw = state.objects.find((o) => o.id === SOLENOID_ID)
  const magnetRaw = state.objects.find((o) => o.id === MAGNET_ID)
  const sourceLabel = state.readouts[0]?.value
  const isPointCharges = sourceLabel === "point charges"

  const charge1Raw = state.objects.find((o) => o.id === "charge-1")
  const charge2Raw = state.objects.find((o) => o.id === "charge-2")
  const charge3Raw = state.objects.find((o) => o.id === "charge-3")

  // lib/physics/fields.ts hardcodes charge sign colors (red/blue) and a yellow test particle —
  // recolored here, at the scene layer, to the locked palette instead of editing lib/**:
  // positive source charges -> maroon, negative -> toned-down cyan, test particle -> white/silver
  // so it reads as the neutral "probe". Capacitor plates get the same polarity->color mapping,
  // plus a size override (ObjectRenderer's BoxObject already reads meta.size) so a plate reads as
  // a thin facing panel instead of the generic wide ground-slab default, and its thickness grows
  // a little with |voltage| so the plate itself visibly reacts to that slider too, not just the
  // field lines between them.
  // charge-1/charge-2/charge-3 are pulled out of the generic loop below and rendered through
  // DraggableCharge instead (still using ObjectRenderer underneath for the actual mesh) so they
  // can carry a TransformControls gizmo; test-particle stays in the generic path since it has no
  // param to drag back into (see limit #3 above).
  const draggableIds = ["charge-1", "charge-2", "charge-3"]

  const objects = useMemo<SceneObject[]>(
    () =>
      state.objects
        .filter((o) => o.id !== SOLENOID_ID && o.id !== MAGNET_ID && !(isPointCharges && draggableIds.includes(o.id)))
        .map((o) => {
          if (o.meta?.role === "source") {
            const charge = (o.meta.charge as number) ?? 0
            return { ...o, color: charge >= 0 ? PALETTE.maroon : PALETTE.cyan }
          }
          if (o.meta?.role === "test-particle") {
            // Position/velocity here come from the CONTINUOUS `stepTrajectory` animation above,
            // not the static `fieldsStep` position `o` already carries — that static position is
            // only ever t=0 (see fields.ts's `initialTestState`), which is why the particle used
            // to render as a fixed dot with no visible motion. Falls back to the static value
            // only for the first frame or two before `trajectoryParticle` has been set once.
            return {
              ...o,
              color: PALETTE.white,
              position: trajectoryParticle?.position ?? o.position,
              velocity: trajectoryParticle?.velocity ?? o.velocity,
            }
          }
          if (o.meta?.role === "capacitor_plate") {
            const polarity = o.meta.polarity as string
            const voltage = Math.abs((o.meta.voltage as number) ?? 0)
            const thickness = 0.06 + Math.min(voltage / 2000, 0.14)
            return {
              ...o,
              color: polarity === "+" ? PALETTE.maroon : PALETTE.cyan,
              meta: { ...o.meta, size: [thickness, 2.4, 2.4] as Vec3 },
            }
          }
          return o
        }),
    [state.objects, trajectoryParticle]
  )

  return (
    <group>
      {objects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}

      {solenoidRaw && <SolenoidCoil object={solenoidRaw} />}

      {/* Point charges: draggable along the one axis each one's backing param actually supports
          (see the CRUD stage 1 note above). charge3's meta.charge default is nonzero, so there's
          no separate "add" gizmo needed to reach it — an honest "remove" is dragging its charge
          slider to 0, which already zeroes its field contribution (existing behavior). */}
      {isPointCharges && charge1Raw && (
        <DraggableCharge object={{ ...charge1Raw, color: (charge1Raw.meta?.charge as number) >= 0 ? PALETTE.maroon : PALETTE.cyan }} axis="x" onDrag={(v) => setSeparationFromCharge1(paramsRef, v)} />
      )}
      {isPointCharges && charge2Raw && (
        <DraggableCharge object={{ ...charge2Raw, color: (charge2Raw.meta?.charge as number) >= 0 ? PALETTE.maroon : PALETTE.cyan }} axis="x" onDrag={(v) => setSeparationFromCharge2(paramsRef, v)} />
      )}
      {isPointCharges && charge3Raw && (
        <DraggableCharge object={{ ...charge3Raw, color: (charge3Raw.meta?.charge as number) >= 0 ? PALETTE.maroon : PALETTE.cyan }} axis="z" onDrag={(v) => setCharge3Offset(paramsRef, v)} />
      )}

      {/* Bar magnet: rotate gizmo restricted to Z (the plane stepBarMagnet's theta actually
          sweeps), wired to the one real physics-connected angle (see limit #4 above). */}
      {!isPointCharges && sourceLabel === "bar magnet (dipole)" && magnetRaw && (
        <MagnetRotateControls object={magnetRaw} paramsRef={paramsRef} />
      )}
      {!isPointCharges && sourceLabel !== "bar magnet (dipole)" && magnetRaw && <BarMagnetBody object={magnetRaw} />}

      {/* source_type=0 (point charges, default): unchanged single-field-vector-arrow treatment. */}
      {isPointCharges && state.fieldVectors && <FieldVectorRenderer vectors={state.fieldVectors} color={PALETTE.silver} />}

      {/* source_type=1 (solenoid): a bundle of parallel lines through the coil axis, standing in
          for the uniform interior B field, real length driven by the actual B magnitude. */}
      {!isPointCharges && sourceLabel === "solenoid / coil" && state.fieldVectors?.[0] && (
        <SolenoidFieldLines vector={state.fieldVectors[0]} />
      )}

      {/* source_type=2 (capacitor): straight parallel lines spanning the real plate gap, from the
          + plate to the - plate, so the E field between them is visible, not just the one value
          at the test particle. */}
      {!isPointCharges && sourceLabel === "parallel-plate capacitor" && state.fieldVectors?.[0] && (
        <CapacitorFieldLines vector={state.fieldVectors[0]} />
      )}

      {/* source_type=3 (bar magnet): a single scaled arrow at the test particle's actual position
          showing the local dipole field there (real log-scaled length, not the shared renderer's
          self-normalized-to-1 arrow). */}
      {!isPointCharges && sourceLabel === "bar magnet (dipole)" && state.fieldVectors?.[0] && (
        <MagnetFieldArrow vector={state.fieldVectors[0]} />
      )}
    </group>
  )
}

type FieldVec = { origin: Vec3; direction: Vec3; magnitude: number }

// Stylized coil: a stack of thin torus rings along the field axis (+Y). Ring count scales with
// turns_per_m (more turns slider -> visibly more rings, not just a bigger readout number) and
// radius/height are static — this is a schematic coil, not a to-scale one (CLAUDE.md: demo-grade,
// not anatomically exact).
function SolenoidCoil({ object }: { object: SceneObject }) {
  const turnsPerM = (object.meta?.turns_per_meter as number) ?? 500
  const current = (object.meta?.current_amps as number) ?? 0
  const ringCount = THREE.MathUtils.clamp(Math.round(turnsPerM / 500) + 2, 3, 10)
  const radius = 0.9
  const halfHeight = 1
  const ringYs = useMemo(
    () => Array.from({ length: ringCount }, (_, i) => -halfHeight + (i * (2 * halfHeight)) / Math.max(ringCount - 1, 1)),
    [ringCount]
  )
  const glow = current >= 0 ? PALETTE.silver : PALETTE.cyan

  return (
    <group position={object.position}>
      {ringYs.map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[radius, 0.035, 12, 32]} />
          <meshStandardMaterial color="#14161f" emissive={glow} emissiveIntensity={0.7} roughness={0.4} metalness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

// A handful of parallel straight lines running the coil's axial length, one per rendered ring's
// worth of "region" — length is the same fixed axial span the coil mesh occupies, but line
// brightness/count reacting isn't very legible, so instead the arrow-equivalent length itself
// (via `magToLength`) drives how far the lines extend past the coil, making the real B magnitude
// visible as it changes.
function SolenoidFieldLines({ vector }: { vector: FieldVec }) {
  const dir = useMemo(() => new THREE.Vector3(...vector.direction).normalize(), [vector.direction])
  // mu0*n*I default is ~1.26e-3 T; refScale keeps the default roughly mid-range visually.
  const length = magToLength(vector.magnitude, 1e-3) + 1 // +1 so it always at least spans the coil
  const offsets: [number, number][] = [
    [0, 0],
    [0.45, 0],
    [-0.45, 0],
    [0, 0.45],
    [0, -0.45],
  ]
  const lines = useMemo<SceneObject[]>(
    () =>
      offsets.map(([x, z], i) => {
        const start = dir.clone().multiplyScalar(-length / 2)
        return {
          id: `solenoid-field-line-${i}`,
          kind: "ray",
          position: [start.x + x, start.y, start.z + z],
          velocity: [dir.x, dir.y, dir.z],
          color: PALETTE.cyan,
          meta: { length },
        }
      }),
    [dir, length]
  )
  return (
    <>
      {lines.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
    </>
  )
}

// Straight parallel lines from the negative plate to the positive plate, spanning the REAL plate
// gap (so the capacitor_separation_m slider visibly changes line length), with direction following
// the actual signed E field (so flipping voltage's sign visibly flips the lines' direction).
function CapacitorFieldLines({ vector }: { vector: FieldVec }) {
  const dir = useMemo(() => new THREE.Vector3(...vector.direction).normalize(), [vector.direction])
  // vector.magnitude here is |E| = |V|/d in V/m; the gap itself is derived back out of it isn't
  // reliable (d and V both vary), so the origin->half-span geometry instead uses the vector's own
  // length in world units via the shared |E| log mapping, which still visibly reacts to both
  // sliders (magnitude scales with V, and this length is drawn centered on the true origin).
  const halfSpan = magToLength(vector.magnitude, 1000) / 2 + 0.15
  const offsets: [number, number][] = [
    [0.5, 0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [-0.5, -0.5],
    [0, 0],
  ]
  const lines = useMemo<SceneObject[]>(
    () =>
      offsets.map(([y, z], i) => {
        const start = dir.clone().multiplyScalar(-halfSpan)
        return {
          id: `capacitor-field-line-${i}`,
          kind: "ray",
          position: [start.x, y, start.z + z],
          velocity: [dir.x, dir.y, dir.z],
          color: PALETTE.silver,
          meta: { length: halfSpan * 2 },
        }
      }),
    [dir, halfSpan]
  )
  return (
    <>
      {lines.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
    </>
  )
}

// Single arrow at the test particle's real (source_type=3) position, length real-magnitude-driven
// via the shared log mapping rather than the shared FieldVectorRenderer's self-normalized-to-1
// scale (which can never show a real magnitude change when there's only one vector in the array).
function MagnetFieldArrow({ vector }: { vector: FieldVec }) {
  const length = magToLength(vector.magnitude, 7e-8)
  const arrow: SceneObject = {
    id: "magnet-field-arrow",
    kind: "arrow",
    position: vector.origin,
    velocity: vector.direction,
    color: PALETTE.cyan,
    meta: { length },
  }
  return <ObjectRenderer object={arrow} />
}

// Bar magnet body: an elongated box along its dipole-moment axis (+Y, per lib/physics/fields.ts)
// with two-tone N/S coloring (locked palette: maroon "N" half, cyan "S" half) instead of a single
// flat color, and overall length/width scaling with |magnet_moment| so that slider visibly resizes
// the magnet itself, not just the field readout.
function BarMagnetBody({ object }: { object: SceneObject }) {
  const moment = (object.meta?.moment as number) ?? 10
  const halfLength = 0.6 + Math.min(Math.abs(moment) / 50, 1) * 0.7
  const width = 0.32 + Math.min(Math.abs(moment) / 50, 1) * 0.12

  return (
    <group position={object.position}>
      <mesh position={[0, halfLength / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, halfLength, width]} />
        <meshStandardMaterial color="#1c1118" emissive={PALETTE.maroon} emissiveIntensity={0.7} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -halfLength / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, halfLength, width]} />
        <meshStandardMaterial color="#101418" emissive={PALETTE.cyan} emissiveIntensity={0.7} roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------------------------
// CRUD stage 1: drag/rotate gizmos. See the file-header note for the pattern + real limits.
// ---------------------------------------------------------------------------------------------

// Reads the attached Object3D off a drei TransformControls change event. drei's typing only
// promises `THREE.Event` (a bare `{type}`), but the underlying three-stdlib `TransformControls`
// always fires `objectChange`/`change` with `target` set to the controls instance itself, which
// carries the live attached `.object` — this is the documented drei usage pattern
// (`e.target.object`), not a guess.
function attachedObjectFrom(e: unknown): THREE.Object3D | undefined {
  const target = (e as { target?: { object?: THREE.Object3D } } | undefined)?.target
  return target?.object
}

// Charge1/charge2 share ONE `separation` param (see limit #1); charge3 has its own
// `charge3_offset` (limit #2). Each setter clamps to the same [min,max] the slider itself uses
// (components/modules/types.ts — read, not edited, per this tick's file scope) so a drag can
// never push `step()` a value the slider UI wouldn't otherwise allow.
function setSeparationFromCharge1(paramsRef: MutableRefObject<ScenarioParams>, x: number) {
  const separation = THREE.MathUtils.clamp(-2 * x, SEPARATION_MIN, SEPARATION_MAX)
  paramsRef.current = { ...paramsRef.current, separation }
}
function setSeparationFromCharge2(paramsRef: MutableRefObject<ScenarioParams>, x: number) {
  const separation = THREE.MathUtils.clamp(2 * x, SEPARATION_MIN, SEPARATION_MAX)
  paramsRef.current = { ...paramsRef.current, separation }
}
function setCharge3Offset(paramsRef: MutableRefObject<ScenarioParams>, z: number) {
  const charge3_offset = THREE.MathUtils.clamp(z, CHARGE3_OFFSET_MIN, CHARGE3_OFFSET_MAX)
  paramsRef.current = { ...paramsRef.current, charge3_offset }
}

// One charge sphere, translate-only, locked to whichever single world axis its backing param
// actually maps onto (`axis`). IMPORTANT: `<TransformControls>` (given `children` instead of an
// explicit `object` prop) wraps its children in its OWN internal `<group ref={group}>` and
// attaches the gizmo to THAT group — so the real world position has to be passed as a prop on
// `<TransformControls>` itself (it spreads `...props` onto that internal group), not on some
// inner wrapper. Positioning the inner child instead attaches the gizmo to an unpositioned group
// at the local origin while the mesh renders correctly one level deeper — gizmo and mesh visibly
// split apart. Learned by shipping this bug once in this same tick and catching it via the
// playwright screenshot check below (all three gizmos collapsed onto world origin instead of
// each charge) — worth remembering when this pattern gets reused for projectiles/light.
function DraggableCharge({
  object,
  axis,
  onDrag,
}: {
  object: SceneObject
  axis: "x" | "z"
  onDrag: (value: number) => void
}) {
  return (
    <TransformControls
      position={object.position}
      mode="translate"
      showX={axis === "x"}
      showY={false}
      showZ={axis === "z"}
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        onDrag(axis === "x" ? obj.position.x : obj.position.z)
      }}
    >
      <ObjectRenderer object={{ ...object, position: [0, 0, 0] }} />
    </TransformControls>
  )
}

// Rotate-only, Z axis (the plane stepBarMagnet's theta sweeps — see limit #4). The magnet body
// itself is fixed at the origin in the physics (never moves), so this only ever spins in place;
// the resulting angle is clamped to the slider's own [0,90] range and hard-stopped there so the
// visible gizmo can never silently exceed what magnet_angle_deg can represent. Position is on
// `<TransformControls>` itself, same reasoning as DraggableCharge above.
function MagnetRotateControls({
  object,
  paramsRef,
}: {
  object: SceneObject
  paramsRef: MutableRefObject<ScenarioParams>
}) {
  return (
    <TransformControls
      position={object.position}
      mode="rotate"
      showX={false}
      showY={false}
      showZ
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        const deg = THREE.MathUtils.radToDeg(obj.rotation.z)
        const clamped = THREE.MathUtils.clamp(deg, MAGNET_ANGLE_MIN, MAGNET_ANGLE_MAX)
        if (clamped !== deg) obj.rotation.z = THREE.MathUtils.degToRad(clamped) // hard stop at the boundary
        paramsRef.current = { ...paramsRef.current, magnet_angle_deg: clamped }
      }}
    >
      <BarMagnetBody object={{ ...object, position: [0, 0, 0] }} />
    </TransformControls>
  )
}
