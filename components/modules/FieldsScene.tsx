"use client"

import { useEffect, useMemo, type MutableRefObject } from "react"
import * as THREE from "three"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { FieldVectorRenderer } from "@/components/FieldVectorRenderer"
import { PALETTE } from "@/components/palette"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as fieldsStep } from "@/lib/physics/fields"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"
import type { SceneObject, Vec3 } from "@/lib/physics/types"

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

  useEffect(() => {
    onReadouts(state.readouts)
  }, [state, onReadouts])

  const solenoidRaw = state.objects.find((o) => o.id === SOLENOID_ID)
  const magnetRaw = state.objects.find((o) => o.id === MAGNET_ID)
  const sourceLabel = state.readouts[0]?.value
  const isPointCharges = sourceLabel === "point charges"

  // lib/physics/fields.ts hardcodes charge sign colors (red/blue) and a yellow test particle —
  // recolored here, at the scene layer, to the locked palette instead of editing lib/**:
  // positive source charges -> maroon, negative -> toned-down cyan, test particle -> white/silver
  // so it reads as the neutral "probe". Capacitor plates get the same polarity->color mapping,
  // plus a size override (ObjectRenderer's BoxObject already reads meta.size) so a plate reads as
  // a thin facing panel instead of the generic wide ground-slab default, and its thickness grows
  // a little with |voltage| so the plate itself visibly reacts to that slider too, not just the
  // field lines between them.
  const objects = useMemo<SceneObject[]>(
    () =>
      state.objects
        .filter((o) => o.id !== SOLENOID_ID && o.id !== MAGNET_ID)
        .map((o) => {
          if (o.meta?.role === "source") {
            const charge = (o.meta.charge as number) ?? 0
            return { ...o, color: charge >= 0 ? PALETTE.maroon : PALETTE.cyan }
          }
          if (o.meta?.role === "test-particle") {
            return { ...o, color: PALETTE.white }
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
    [state.objects]
  )

  return (
    <group>
      {objects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}

      {solenoidRaw && <SolenoidCoil object={solenoidRaw} />}
      {magnetRaw && <BarMagnetBody object={magnetRaw} />}

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
