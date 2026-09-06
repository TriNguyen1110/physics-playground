"use client"

import { useEffect, useMemo, useRef, type MutableRefObject } from "react"
import * as THREE from "three"
import { Line, TransformControls } from "@react-three/drei"
import { useFrame } from "@react-three/fiber"
import type { Line2, LineSegments2 } from "three-stdlib"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { PALETTE } from "@/components/palette"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as lightStep } from "@/lib/physics/light"
import type { ScenarioParams, ScenarioState, SceneObject, Vec3 } from "@/lib/physics/types"

// Rendering-space constant matching lib/physics/light.ts's SECOND_INTERFACE_GAP (1.5m below
// interface 1 at y=0) — purely a visual placement choice, mirrors the gap the engine already
// uses to place its own "interface-2" marker, so the prism wedge lines up with the physics rays.
const SECOND_INTERFACE_GAP = 1.5

// Defensive rendering guard, not a physics change: the lens path's f = 1 / ((n-1)(1/R1 - 1/R2))
// can legitimately be +/-Infinity (e.g. the shared n2 slider's default of 1.0 makes a "lens" with
// no index mismatch, a physically flat no-op) and 1/Infinity in the ray-bend math above that
// propagates a NaN component into that object's position/velocity. Rendering a NaN/Infinite
// vector into a `<Line>`/mesh throws real console errors (`LineSegmentsGeometry ... NaN`) and can
// break the whole canvas, so any SceneObject step() hands us with a non-finite position or
// velocity is skipped rather than rendered — every other object (readouts included, since those
// are plain strings) still renders normally.
function isFiniteVec3(v?: readonly number[]): boolean {
  if (!v) return true
  return v.every((n) => Number.isFinite(n))
}

/** Elements 1 (prism) and 2/3 (lens) get bespoke set-piece geometry — a wedge / lens silhouette
 * — since `step()` only returns flat plane *markers* (`kind: "box"`) for those interfaces, not
 * the element's actual shape. Element 0 (slab, default) renders through the generic
 * `ObjectRenderer` unchanged: zero regression. */
function PrismWedge({ apexAngleDeg }: { apexAngleDeg: number }) {
  const geometry = useMemo(() => {
    const halfAngle = THREE.MathUtils.degToRad(apexAngleDeg / 2)
    const halfWidth = SECOND_INTERFACE_GAP * Math.tan(halfAngle)
    const shape = new THREE.Shape()
    shape.moveTo(0, 0)
    shape.lineTo(-halfWidth, -SECOND_INTERFACE_GAP)
    shape.lineTo(halfWidth, -SECOND_INTERFACE_GAP)
    shape.closePath()
    const depth = 1.2
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
    geo.translate(0, 0, -depth / 2)
    return geo
  }, [apexAngleDeg])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        color="#0d1416"
        emissive={PALETTE.cyan}
        emissiveIntensity={0.35}
        roughness={0.15}
        metalness={0.1}
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}

/** Stylized biconvex/biconcave lens silhouette, extruded along Z. Optical axis is X (matches
 * lib/physics/light.ts), lens plane at x=0, aperture along Y. Convex: thick center, pointed
 * top/bottom edges. Concave: thin center, flat rim at top/bottom edges — the standard textbook
 * cross-section shapes, not a claim of exact curvature matching R1_m/R2_m. */
function LensShape({ converging }: { converging: boolean }) {
  const geometry = useMemo(() => {
    const H = 1.6
    const shape = new THREE.Shape()
    if (converging) {
      const bulge = 0.4
      shape.moveTo(0, H / 2)
      shape.quadraticCurveTo(bulge, 0, 0, -H / 2)
      shape.quadraticCurveTo(-bulge, 0, 0, H / 2)
    } else {
      const edge = 0.4
      const center = 0.12
      shape.moveTo(-edge, H / 2)
      shape.lineTo(edge, H / 2)
      shape.quadraticCurveTo(center, 0, edge, -H / 2)
      shape.lineTo(-edge, -H / 2)
      shape.quadraticCurveTo(-center, 0, -edge, H / 2)
    }
    shape.closePath()
    const depth = 1.2
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 })
    // Shape's local (x,y) is already (thickness-along-optical-axis, aperture-along-Y) — matches
    // lib/physics/light.ts's world X/Y directly, no rotation needed. Extrusion runs along local
    // Z purely for visual solidity (the lens's depth into/out of the page); center it on z=0.
    geo.translate(0, 0, -depth / 2)
    return geo
  }, [converging])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        color="#0d1416"
        emissive={PALETTE.cyan}
        emissiveIntensity={0.35}
        roughness={0.1}
        metalness={0.1}
        transparent
        opacity={0.45}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}

// Eight samples spanning the visible spectrum (violet -> red), fed one-at-a-time into `step()`
// with every other param held fixed, so the prism's real Cauchy dispersion (already computed
// inside lib/physics/light.ts, just previously invisible because only one wavelength ever
// rendered at once) shows up as an actual rainbow fan of exit rays.
const PRISM_FAN_WAVELENGTHS_NM = [420, 450, 480, 510, 540, 570, 600, 650]

// Seven parallel-ray heights spanning the ray_height_m slider's [-1.5, 1.5] range, fed
// one-at-a-time into `step()` with every other param held fixed, so a lens's real
// convergence/divergence (already correct paraxial math, just previously invisible with a
// single ray) shows up as an actual bundle of parallel rays bending toward/away from one focal
// point.
const LENS_BUNDLE_HEIGHTS_M = [-1.4, -0.9, -0.45, 0, 0.45, 0.9, 1.4]

// Real-lens-aperture fix (screenshot-flagged bug): LensShape's own silhouette (below) is drawn
// at half-height H/2 = 0.8m — anything sampled/selected outside that never actually passes
// through the glass, no matter what step()'s paraxial (infinite-aperture) math says. Kept here
// as the single source of truth so the bundle/highlight clipping below and LensShape's H both
// derive from the same number (LensShape defines H = 1.6 directly since it's a local geometry
// constant, not exported — if that ever changes, this must change with it).
const LENS_APERTURE_HALF_HEIGHT_M = 0.8

// A ray height beyond the lens's own rendered aperture never touches the glass — physically it
// must pass straight through undeviated, not bend as if step()'s infinite-aperture paraxial
// formula applied. Only the "refracted-ray" leg is bent by step(); overriding just its velocity
// back to the original incident direction (+X) turns it into a straight continuation instead of
// a fake convergence/divergence for a ray that never hit the lens.
function clipRayToAperture(objects: SceneObject[], rayHeightM: number): SceneObject[] {
  if (Math.abs(rayHeightM) <= LENS_APERTURE_HALF_HEIGHT_M) return objects
  return objects.map((o) =>
    o.id === "refracted-ray" ? { ...o, velocity: [1, 0, 0] as Vec3 } : o
  )
}

/** Calls the pure `step()` once per wavelength sample (same angle/apex/index params, only
 * wavelength_nm varies) and pulls out just the post-first-face rays (where real dispersion is
 * visible) from each, uniquely re-keyed so React doesn't collide ids across samples. */
function buildPrismFan(params: ScenarioParams, t: number): SceneObject[] {
  const fanned: SceneObject[] = []
  PRISM_FAN_WAVELENGTHS_NM.forEach((wavelength_nm, i) => {
    const sample = lightStep({ ...params, wavelength_nm }, t)
    sample.objects
      .filter((o) => o.id === "refracted-ray" || o.id === "refracted-ray-2")
      .forEach((o) => fanned.push({ ...o, id: `${o.id}-fan-${i}` }))
  })
  return fanned
}

/** Calls the pure `step()` once per ray-height sample (same lens/wavelength params, only
 * ray_height_m varies) and pulls out the incident + bent ray from each, uniquely re-keyed. */
function buildLensBundle(params: ScenarioParams, t: number): SceneObject[] {
  const bundled: SceneObject[] = []
  LENS_BUNDLE_HEIGHTS_M.forEach((ray_height_m, i) => {
    const sample = lightStep({ ...params, ray_height_m }, t)
    const legs = sample.objects.filter((o) => o.id === "incident-ray" || o.id === "refracted-ray")
    clipRayToAperture(legs, ray_height_m).forEach((o) => bundled.push({ ...o, id: `${o.id}-bundle-${i}` }))
  })
  return bundled
}

// light-multiray-01 correction (user-reported "the white light only works for the prism
// somehow"): the lens's existing bundle above sweeps ray HEIGHT at one fixed wavelength — a
// "parallel rays converge to one point" demo, with no lens-mode analog of the prism's white-light
// rainbow. Real lenses do have their own well-known white-light effect, chromatic aberration: the
// lensmaker's focal length depends on the glass index, which depends on wavelength (the same
// Cauchy dispersion stepLens already computes, confirmed via BOARD.tsv's f(450nm) vs f(650nm)
// rows), so different colors focus at slightly different points along the axis. Calls the pure
// `step()` once per wavelength sample (same lens/height params, only wavelength_nm varies, and at
// the SAME ray_height_m — the slider's current single height, not the height-sweep) and pulls out
// each sample's own refracted ray + its own focal-point marker, uniquely re-keyed.
function buildLensChromaticBundle(params: ScenarioParams, t: number): SceneObject[] {
  const rayHeightM = THREE.MathUtils.clamp(params.ray_height_m ?? 0.5, -1.5, 1.5)
  const chromatic: SceneObject[] = []
  PRISM_FAN_WAVELENGTHS_NM.forEach((wavelength_nm, i) => {
    const sample = lightStep({ ...params, ray_height_m: rayHeightM, wavelength_nm }, t)
    const refracted = sample.objects.find((o) => o.id === "refracted-ray")
    const focal = sample.objects.find((o) => o.id === "focal-point")
    const legs: SceneObject[] = []
    if (refracted) legs.push(refracted)
    // stepLens's own focal-point marker is a fixed maroon/cyan role color (matches the lens
    // type, not the wavelength) — recolor it here to this sample's real Bruton-mapped ray color
    // so each chromatic-aberration focal point visibly matches its own ray's hue, same treatment
    // the prism fan already gives its refracted rays.
    if (focal && refracted) legs.push({ ...focal, color: refracted.color })
    clipRayToAperture(legs, rayHeightM).forEach((o) => chromatic.push({ ...o, id: `${o.id}-chroma-${i}` }))
  })
  return chromatic
}

// --- Sin-wave ray rendering ------------------------------------------------------------------
// "we agree upon making the lights sin waves not straight rays already": every ray SEGMENT
// below (incident/reflected/refracted, the rainbow fan, the lens bundle, the highlight ray) is
// drawn as a real oscillating EM-wave shape instead of a straight `THREE.Line`, purely a
// rendering change — none of the underlying step() angles/colors/physics above are touched.
//
// Real optical wavelength_nm (400-700nm = 4e-7-7e-7 m) is many orders of magnitude smaller than
// this scene's geometry (rays run several meters), so drawing the literal wavelength is
// impossible — instead we pick a fixed VISUAL_WAVELENGTH_SCALE_M_PER_NM that keeps the
// physically-meaningful part (spatial frequency scales linearly, and inversely, with
// wavelength_nm — shorter wavelength = visibly tighter oscillation) while landing at a cycle
// count that actually reads as a wave on screen. At this scene's typical ~4m ray length:
//   650nm (red)   -> visual wavelength 0.39m -> ~10.3 cycles
//   450nm (blue)  -> visual wavelength 0.27m -> ~14.8 cycles
// enough cycles to clearly show both "it's a wave" and "blue oscillates tighter than red",
// without being so dense it looks chaotic or obscures the ray's underlying straight-line path.
const VISUAL_WAVELENGTH_SCALE_M_PER_NM = 6e-4
// Perpendicular displacement, modest relative to the scene's ~1-5m object scale so the wave
// reads as a wiggle on top of the ray, not a chaotic zigzag that obscures the geometry.
const WAVE_AMPLITUDE_M = 0.08
// Points-per-segment fix (user screenshot-flagged "jagged/zigzag, not a smooth sinusoid"): the
// underlying sine math was already confirmed correct in a prior round (see the phase-continuity
// note below) — the facet look was purely under-sampling. A FIXED 28-point total doesn't scale
// with how many oscillation cycles actually fit in a given ray segment: a 4m ray at 650nm (red)
// has visualWavelength ~0.39m (~10.3 cycles across 28 points, ~2.7 points/cycle — visibly
// faceted), and a shorter 420nm ray packs even more cycles into the same 28 points, making it
// worse exactly where the coordinator's report said it looked worst. Fix (below, in WaveRay):
// point count is now computed PER SEGMENT from its own real length/visualWavelength so it always
// lands at MIN_SAMPLES_PER_CYCLE, instead of one shared constant that starves short-wavelength
// segments. These two constants replace the old single WAVE_POINTS_PER_SEGMENT.
const MIN_SAMPLES_PER_CYCLE = 16
const WAVE_POINTS_FLOOR = 28
const WAVE_POINTS_CEIL = 240
// Phase advance rate (rad/s), purely a "looks like it's traveling" visual rate — not tied to c
// (that would be imperceptibly fast at this scene's scale), just fast enough to clearly read as
// propagating along the ray direction from frame to frame.
const WAVE_PROPAGATION_SPEED = 6

// Bug fix (light-wave-animation-01 correction, user-reported "the wave is not strictly sin cos
// at all"): confirmed via a standalone Node repro (replicating this file's exact formula) that a
// SINGLE ray segment's 28-point array IS a mathematically clean sinusoid (uniform spacing, exact
// A*sin(2*pi*distanceAlongRay/visualWavelength - phase) at every point, perpendicular truly
// perpendicular, no NaN). The actual bug is at the SEAM between chained segments
// (incident-ray -> reflected-ray / refracted-ray -> refracted-ray-2): each WaveRay instance
// computed `distAlong` from its OWN local origin (0 -> its own length), so the sine argument
// reset to a phase of `-phase` at every segment's start instead of continuing from where the
// previous segment's phase left off. For a typical non-wavelength-multiple ray length this is a
// full, visible jump in the offset value (up to 2x amplitude) exactly at the point where two
// segments visually meet — reads as a kink/break, not "one ray's clean wave", even though each
// segment alone was clean. Fix: track how much distance the wave has already "traveled" before
// each segment starts (`phaseOffsetM`) using the known, fixed chain topology of this module's ray
// ids, and add it into the sine argument only (not into the geometry's along-ray offset) so
// adjacent segments share one continuous running phase.
const RAY_CHAIN_ROLE_ORDER = ["incident-ray", "reflected-ray", "refracted-ray", "refracted-ray-2"] as const
type RayChainRole = (typeof RAY_CHAIN_ROLE_ORDER)[number]

/** Strips the `-fan-N` / `-bundle-N` re-keying suffix (added by buildPrismFan/buildLensBundle so
 * React ids stay unique across samples) back down to the underlying chain role, so segments that
 * belong to the same sampled ray can be matched up regardless of which pass rendered them. */
function chainRoleOf(id: string): RayChainRole | null {
  const base = id.replace(/-(fan|bundle|chroma)-\d+$/, "")
  return (RAY_CHAIN_ROLE_ORDER as readonly string[]).includes(base) ? (base as RayChainRole) : null
}

/** Given every SceneObject about to be rendered as a WaveRay this frame (across the main pass,
 * the rainbow fan, and the lens bundle), returns a map of object id -> cumulative distance the
 * wave has already traveled before that segment's own local origin, so its sine argument can
 * continue the previous segment's phase instead of resetting to 0. Segments are grouped by their
 * `-fan-N`/`-bundle-N` suffix (each sampled ray is its own independent chain); the fan doesn't
 * re-include `incident-ray` per sample (only the post-first-face legs), so those groups fall back
 * to the single shared `incident-ray`'s own length as the base offset. */
function buildPhaseOffsets(objects: SceneObject[]): Map<string, number> {
  const suffixOf = (id: string) => id.match(/-(?:fan|bundle|chroma)-\d+$/)?.[0] ?? ""
  const groups = new Map<string, Map<RayChainRole, SceneObject>>()
  for (const o of objects) {
    const role = chainRoleOf(o.id)
    if (!role) continue
    const key = suffixOf(o.id)
    if (!groups.has(key)) groups.set(key, new Map())
    groups.get(key)!.set(role, o)
  }
  const sharedIncidentLength = (groups.get("")?.get("incident-ray")?.meta?.length as number) ?? 0

  const offsets = new Map<string, number>()
  for (const [, byRole] of groups) {
    const lengthOf = (role: RayChainRole) => (byRole.get(role)?.meta?.length as number) ?? 0
    const incidentLen = byRole.has("incident-ray") ? lengthOf("incident-ray") : sharedIncidentLength
    const cumulative: Record<RayChainRole, number> = {
      "incident-ray": 0,
      "reflected-ray": incidentLen,
      "refracted-ray": incidentLen,
      "refracted-ray-2": incidentLen + lengthOf("refracted-ray"),
    }
    for (const [role, obj] of byRole) offsets.set(obj.id, cumulative[role])
  }
  return offsets
}

/** Renders one ray SceneObject as an animated sinusoidal wave instead of a straight line: builds
 * a dense point array offset perpendicular to the ray's own direction by
 * amplitude*sin(2*pi*distanceAlongRay/visualWavelength - phase), phase incremented every frame
 * via useFrame so the pattern visibly propagates along the ray. Mutates the underlying
 * `Line2`/`LineGeometry`'s position buffer in place each frame (via three-stdlib's
 * `LineGeometry.setPositions`) rather than driving it through React state, so animating many
 * bundled rays at once never triggers a React re-render per frame. */
function WaveRay({
  object,
  lineWidth = 2.5,
  opacity = 0.95,
  phaseOffsetM = 0,
}: {
  object: SceneObject
  lineWidth?: number
  opacity?: number
  phaseOffsetM?: number
}) {
  const dir = object.velocity ?? [0, -1, 0]
  const length = (object.meta?.length as number) ?? 4
  const wavelengthNm = (object.meta?.wavelength_nm as number) ?? 590

  const lineRef = useRef<Line2 | LineSegments2 | null>(null)
  const phaseRef = useRef(0)
  const scratch = useMemo(() => new THREE.Vector3(), [])

  const { origin, dirNorm, perp, visualWavelength } = useMemo(() => {
    const d = new THREE.Vector3(dir[0], dir[1], dir[2] ?? 0)
    if (d.lengthSq() < 1e-8) d.set(1, 0, 0)
    d.normalize()
    // In-plane perpendicular (rotate 90deg within XY): this scene's rays live in the XY plane
    // (see HighlightRay's original default direction / RayObject in ObjectRenderer.tsx), so
    // oscillating perpendicular within that same plane keeps the wave fully visible to camera
    // instead of foreshortened along the view axis.
    let p = new THREE.Vector3(-d.y, d.x, 0)
    if (p.lengthSq() < 1e-8) p = new THREE.Vector3(0, 0, 1)
    p.normalize()
    return {
      origin: new THREE.Vector3(object.position[0], object.position[1], object.position[2] ?? 0),
      dirNorm: d,
      perp: p,
      visualWavelength: Math.max(wavelengthNm * VISUAL_WAVELENGTH_SCALE_M_PER_NM, 1e-3),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir[0], dir[1], dir[2], object.position[0], object.position[1], object.position[2], wavelengthNm])

  // Points-per-segment fix: this segment's own real cycle count (length / visualWavelength)
  // drives its own sample density, floored/ceiled so a degenerate near-zero-length segment still
  // gets a sane minimum and a pathologically long one never allocates something absurd.
  const pointsPerSegment = useMemo(() => {
    const cycles = length / visualWavelength
    return THREE.MathUtils.clamp(
      Math.ceil(cycles * MIN_SAMPLES_PER_CYCLE),
      WAVE_POINTS_FLOOR,
      WAVE_POINTS_CEIL
    )
  }, [length, visualWavelength])

  const flat = useMemo(() => new Float32Array(pointsPerSegment * 3), [pointsPerSegment])

  const initialPoints = useMemo<Vec3[]>(() => {
    const pts: Vec3[] = []
    for (let i = 0; i < pointsPerSegment; i++) {
      const t = i / (pointsPerSegment - 1)
      const p = origin.clone().addScaledVector(dirNorm, t * length)
      pts.push([p.x, p.y, p.z])
    }
    return pts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, dirNorm, length, pointsPerSegment])

  useFrame((_, delta) => {
    phaseRef.current += delta * WAVE_PROPAGATION_SPEED
    const phase = phaseRef.current
    for (let i = 0; i < pointsPerSegment; i++) {
      const t = i / (pointsPerSegment - 1)
      const distAlong = t * length
      // Sine argument uses the CUMULATIVE distance (this segment's own distAlong plus however far
      // prior chained segments already carried the wave) so phase is continuous across the seam
      // where one ray segment ends and the next begins; the geometry offset itself still applies
      // along this segment's own local dirNorm/perp, only the wave's phase input changes.
      const offset =
        WAVE_AMPLITUDE_M * Math.sin((2 * Math.PI * (distAlong + phaseOffsetM)) / visualWavelength - phase)
      scratch.copy(origin).addScaledVector(dirNorm, distAlong).addScaledVector(perp, offset)
      flat[i * 3] = scratch.x
      flat[i * 3 + 1] = scratch.y
      flat[i * 3 + 2] = scratch.z
    }
    const geom = lineRef.current?.geometry as unknown as { setPositions?: (a: Float32Array) => void } | undefined
    geom?.setPositions?.(flat)
  })

  return (
    <Line
      ref={lineRef}
      points={initialPoints}
      color={object.color}
      lineWidth={lineWidth}
      toneMapped={false}
      transparent
      opacity={opacity}
    />
  )
}

/** Same wave rendering as WaveRay, but with a thicker/brighter line — used to pick the current
 * slider-selected ray out of the prism/lens bundle rather than losing it in the fan. */
function HighlightRay({ object, phaseOffsetM = 0 }: { object: SceneObject; phaseOffsetM?: number }) {
  return <WaveRay object={object} lineWidth={5} opacity={1} phaseOffsetM={phaseOffsetM} />
}

// ---------------------------------------------------------------------------------------------
// CRUD stage 3 (crud-light-01). Pattern established by crud-fields-01 (FieldsScene.tsx,
// commit deea424): drei's `TransformControls` with `position` passed as a direct prop on
// `<TransformControls>` itself (NOT inherited via children — a positioned child renders one
// place while the gizmo attaches to TransformControls' own internal, unpositioned wrapper group,
// collapsing every gizmo onto world origin; caught and documented there, re-applied here from
// the start). `onObjectChange` reads the dragged Object3D's live transform and writes straight
// into a real `ScenarioParams` field on `paramsRef.current` — the same ref-write every slider in
// this app already uses — so a drag and a slider drag are physically indistinguishable to
// `step()`. Nothing here fakes a purely-visual position.
//
// What's genuinely draggable in this module, decided per-element:
//  1. Incidence angle (slab AND prism): stepSlab/stepPrism build the incident ray from the exact
//     same `(sin(theta1), -cos(theta1), 0)` formula off `angle_deg`, with the interface itself
//     pinned at the canonical origin y=0 in both paths — there is no independent "interface
//     position" to drag, only the angle really varies. So this is a ROTATE handle at the
//     incident ray's own current source point (see IncidenceAngleControls below).
//  2. Slab interface itself: deliberately gets NO drag handle. Per point 1, the interface is a
//     fixed plane at a canonical origin in the physics; there is no second real degree of
//     freedom to fake a handle for.
//  3. Prism apex angle: real, physically-meaningful drag. TIR handle sits at the wedge's outer
//     base corner (not the pointed vertex itself, which is pinned at the same fixed y=0 origin
//     as the slab interface) and translating it along X directly sets `apex_angle_deg` via the
//     same halfWidth = GAP*tan(apexAngle/2) relation PrismWedge already renders with.
//  4. Lens ray height: real, physically-meaningful drag. TRANSLATE handle at the point the
//     incident ray meets the lens (0, ray_height_m, 0), Y-axis only, writing `ray_height_m`.
//
// Every handle mesh (small sphere) is scene-only decoration for grabbing — none of them are a
// physics object step() returns — but every value the handle's drag actually WRITES is a real
// ScenarioParams field the sliders already control, clamped to that same slider's [min,max].
const ANGLE_MIN = 0
const ANGLE_MAX = 89
const APEX_MIN = 10
const APEX_MAX = 90
const RAY_HEIGHT_MIN = -1.5
const RAY_HEIGHT_MAX = 1.5

// Same shape drei's underlying three-stdlib TransformControls always fires `objectChange` with
// (`e.target.object` carrying the live attached Object3D) — identical helper to FieldsScene's,
// duplicated here rather than shared since this tick's file scope is LightScene.tsx only.
function attachedObjectFrom(e: unknown): THREE.Object3D | undefined {
  const target = (e as { target?: { object?: THREE.Object3D } } | undefined)?.target
  return target?.object
}

/** Rotate-only handle (Z axis — this scene's rays live in the XY plane, same convention WaveRay
 * already uses) at the incident ray's own current source point. Real physics: `angle_deg` is the
 * one thing this handle changes.
 *
 * Baseline-sync note: `<TransformControls>`'s rotation is a cumulative delta off wherever the
 * attached Object3D's `.rotation.z` last sat — it is NOT an absolute readout of `angle_deg`. The
 * effect below resyncs `.rotation.z` to `degToRad(angle_deg)` every time `angle_deg` actually
 * changes (by this same drag, by the slider, or by the n2-auto-bump effect elsewhere in this
 * file), so after every drag tick the gizmo's own baseline snaps back to exactly the value it
 * just wrote — no drift accumulates, and an external slider move is picked up too. Same
 * rotate-handle family as fields' `MagnetRotateControls`; this file follows that precedent.
 */
function IncidenceAngleControls({
  sourcePosition,
  angleDeg,
  paramsRef,
}: {
  sourcePosition: Vec3
  angleDeg: number
  paramsRef: MutableRefObject<ScenarioParams>
}) {
  const controlsRef = useRef<{ object?: THREE.Object3D } | null>(null)
  const syncedAngleRef = useRef<number | null>(null)

  useEffect(() => {
    const obj = controlsRef.current?.object
    if (!obj || syncedAngleRef.current === angleDeg) return
    obj.rotation.z = THREE.MathUtils.degToRad(angleDeg)
    syncedAngleRef.current = angleDeg
  }, [angleDeg])

  return (
    <TransformControls
      ref={controlsRef as never}
      position={sourcePosition}
      mode="rotate"
      showX={false}
      showY={false}
      showZ
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        const deg = THREE.MathUtils.radToDeg(obj.rotation.z)
        const clamped = THREE.MathUtils.clamp(deg, ANGLE_MIN, ANGLE_MAX)
        if (clamped !== deg) obj.rotation.z = THREE.MathUtils.degToRad(clamped) // hard stop
        syncedAngleRef.current = clamped
        paramsRef.current = { ...paramsRef.current, angle_deg: clamped }
      }}
    >
      <mesh>
        <sphereGeometry args={[0.14, 16, 16]} />
        <meshStandardMaterial
          color={PALETTE.silver}
          emissive={PALETTE.cyan}
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
    </TransformControls>
  )
}

/** Translate-only handle (X axis) at the prism wedge's outer base corner — see point 3 above.
 * Position is a pure function of the current `apex_angle_deg` (same halfWidth formula
 * PrismWedge renders with), so unlike the rotate handle there is no baseline-sync needed: each
 * render places the gizmo exactly where that param says the corner is. */
function PrismApexControls({
  apexAngleDeg,
  paramsRef,
}: {
  apexAngleDeg: number
  paramsRef: MutableRefObject<ScenarioParams>
}) {
  const halfAngle = THREE.MathUtils.degToRad(apexAngleDeg / 2)
  const halfWidth = SECOND_INTERFACE_GAP * Math.tan(halfAngle)
  const handlePos: Vec3 = [halfWidth, -SECOND_INTERFACE_GAP, 0]

  return (
    <TransformControls
      position={handlePos}
      mode="translate"
      showX
      showY={false}
      showZ={false}
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        // Keep the handle on the same (+X) side it started on — dragging it across x=0 would
        // otherwise flip sign and read as a negative-width wedge, which apex_angle_deg can't
        // express (it's a magnitude, [10,90]).
        const x = Math.max(obj.position.x, 1e-3)
        const deg = THREE.MathUtils.radToDeg(2 * Math.atan(x / SECOND_INTERFACE_GAP))
        const clamped = THREE.MathUtils.clamp(deg, APEX_MIN, APEX_MAX)
        paramsRef.current = { ...paramsRef.current, apex_angle_deg: clamped }
      }}
    >
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={PALETTE.maroon}
          emissive={PALETTE.maroon}
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
    </TransformControls>
  )
}

/** Translate-only handle (Y axis) at the point the incident ray meets the lens — see point 4
 * above. Position is a pure function of `ray_height_m` (same point stepLens itself uses as
 * `lensPos`), so like the prism handle this needs no baseline-sync. */
function LensRayHeightControls({
  rayHeightM,
  paramsRef,
}: {
  rayHeightM: number
  paramsRef: MutableRefObject<ScenarioParams>
}) {
  const handlePos: Vec3 = [0, rayHeightM, 0]

  return (
    <TransformControls
      position={handlePos}
      mode="translate"
      showX={false}
      showY
      showZ={false}
      onObjectChange={(e) => {
        const obj = attachedObjectFrom(e)
        if (!obj) return
        const clamped = THREE.MathUtils.clamp(obj.position.y, RAY_HEIGHT_MIN, RAY_HEIGHT_MAX)
        paramsRef.current = { ...paramsRef.current, ray_height_m: clamped }
      }}
    >
      <mesh>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={PALETTE.cyan}
          emissive={PALETTE.cyan}
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
    </TransformControls>
  )
}

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

  // Determine which bespoke set-piece (if any) to draw from the "interface" object's own
  // meta.role — the same discriminant lib/physics/light.ts uses internally — rather than
  // re-reading element_type off paramsRef, so the wedge/lens always matches what step() actually
  // computed for this frame (including default/omitted -> slab).
  const interfaceObj = state.objects.find((o) => o.id === "interface")
  const role = (interfaceObj?.meta?.role as string | undefined) ?? "interface"
  const isPrism = role === "prism-face-1"
  const isLens = role === "convex-lens" || role === "concave-lens"
  const isGlassElement = isPrism || isLens

  // Bug fix (light-multiray-01 follow-up): the shared n2 slider defaults to 1.0, which is
  // correct as an "air" value for the slab element (0) but is physically wrong as a glass
  // index for prism/lens (1/2/3) — real glass is ~1.5. At n2=1.0, engine-10's dispersion floor
  // (MIN_LENS_GLASS_N=1.05) clamps every wavelength in the prism fan to the identical flat
  // 1.05, so the whole rainbow-fan/convergence-bundle effect built above renders with zero
  // visible spread. Auto-bump n2 to a glass-appropriate value the instant element_type
  // transitions from slab (0) into prism/lens (nonzero), and restore the slab-appropriate
  // value on the way back — but ONLY on that edge transition (never every render), and ONLY
  // when the current n2 still looks like the value we ourselves last set, so a user's own
  // deliberate n2 tweak after switching is never stomped.
  const wasGlassElementRef = useRef(isGlassElement)
  useEffect(() => {
    if (wasGlassElementRef.current === isGlassElement) return
    wasGlassElementRef.current = isGlassElement
    const current = paramsRef.current.n2
    let next: number | null = null
    if (isGlassElement) {
      // Entering prism/lens: only bump if n2 still looks like the untouched slab default —
      // don't override a value the user already raised themselves.
      if (current <= 1.05) next = 1.5
    } else {
      // Returning to slab: only restore if n2 still looks like the auto-bump we applied —
      // don't override a value the user deliberately set while in prism/lens mode.
      if (Math.abs(current - 1.5) < 1e-6) next = 1.0
    }
    if (next === null) return
    paramsRef.current.n2 = next
    // Sliders in ControlPanel.tsx are uncontrolled <input type="range"> elements (no React
    // state), so a programmatic paramsRef write alone never moves the visible thumb/readout —
    // ControlPanel only pushes that on its own onChange. Mirror that same DOM-write pattern
    // here (locate the slider via its value-readout's data attribute, since the range input
    // itself carries no unique test id) so the UI reflects this auto-adjustment truthfully.
    const valueEl = document.querySelector<HTMLElement>('[data-slider-value="n2"]')
    const input = valueEl?.closest("label")?.querySelector<HTMLInputElement>('input[type="range"]')
    if (input) input.value = String(next)
    if (valueEl) valueEl.textContent = next.toFixed(2)
  }, [isGlassElement, paramsRef])

  // Bug fix (light-multiray-01/crud-light-01 correction, user screenshot-flagged "the concave
  // lens physics is wrong"): R1_m/R2_m are ONE shared slider pair (types.ts default: R1_m=0.5,
  // R2_m=-0.5 — the biconvex/converging shape). Switching element_type between convex_lens(2)
  // and concave_lens(3) only changes the UI LABEL/role ("concave (diverging)") — it never
  // actually swapped R1_m/R2_m to the biconcave shape, so a user selecting "concave lens" kept
  // getting the converging biconvex curvature pair, exactly like the n2-glass-index bug above.
  // Per BOARD.tsv's light.lens.params fact (engine-07): "default biconvex(0.5,-0.5) for
  // convex_lens / biconcave(-0.5,0.5) for concave_lens" — this swap was never implemented. Same
  // transition-only pattern as the n2 fix above: track the current lens shape bucket
  // ("convex"/"concave"/"other"), and only on the edge where it actually changes INTO convex or
  // concave, snap R1_m/R2_m to that shape's default — but only when the current values still
  // look like the OTHER shape's untouched default (or already match the target, a harmless
  // no-op), never stomping a value the user deliberately customized.
  const lensShapeOf = (r: string) => (r === "convex-lens" ? "convex" : r === "concave-lens" ? "concave" : "other")
  const lensShapeRef = useRef<"convex" | "concave" | "other">(lensShapeOf(role))
  useEffect(() => {
    const currentShape = lensShapeOf(role)
    if (lensShapeRef.current === currentShape) return
    lensShapeRef.current = currentShape
    if (currentShape === "other") return // leaving lens mode entirely — R1/R2 have no
    // slab/prism-appropriate value to restore to (unlike n2, which doubles as slab's real air
    // index), so nothing to fix up on the way out.
    const target = currentShape === "convex" ? { R1: 0.5, R2: -0.5 } : { R1: -0.5, R2: 0.5 }
    const otherShapeDefault = currentShape === "convex" ? { R1: -0.5, R2: 0.5 } : { R1: 0.5, R2: -0.5 }
    const curR1 = paramsRef.current.R1_m
    const curR2 = paramsRef.current.R2_m
    const looksLike = (v: { R1: number; R2: number }) =>
      Math.abs(curR1 - v.R1) < 1e-6 && Math.abs(curR2 - v.R2) < 1e-6
    if (!looksLike(otherShapeDefault) && !looksLike(target)) return // user's own custom R1/R2 — leave it alone
    paramsRef.current = { ...paramsRef.current, R1_m: target.R1, R2_m: target.R2 }
    // Mirror the n2 fix's DOM-write: R1_m/R2_m sliders are uncontrolled <input type="range">
    // elements too, so a programmatic paramsRef write alone never moves the visible
    // thumb/readout — locate each via its own data-slider-value readout span.
    for (const [key, value] of [["R1_m", target.R1], ["R2_m", target.R2]] as const) {
      const valueEl = document.querySelector<HTMLElement>(`[data-slider-value="${key}"]`)
      const input = valueEl?.closest("label")?.querySelector<HTMLInputElement>('input[type="range"]')
      if (input) input.value = String(value)
      if (valueEl) valueEl.textContent = value.toFixed(2)
    }
  }, [role, paramsRef])

  // The current slider-selected ray, pulled out of the single-call `state` so it can be drawn
  // thicker/highlighted among the multi-ray bundle below rather than getting lost in the fan.
  // Prism: the post-first-face rays are where dispersion is visible. Lens: the incident +
  // bent ray at the slider's own ray_height_m.
  const highlightObjects = isPrism
    ? state.objects.filter((o) => o.id === "refracted-ray" || o.id === "refracted-ray-2")
    : isLens
      ? clipRayToAperture(
          state.objects.filter((o) => o.id === "incident-ray" || o.id === "refracted-ray"),
          THREE.MathUtils.clamp(paramsRef.current.ray_height_m ?? 0.5, -1.5, 1.5)
        )
      : []

  // light-multiray-01 correction: the prism's wavelength-sweep rainbow fan is only physically
  // correct as a stand-in for WHITE light (many wavelengths mixed) being dispersed — with a
  // single wavelength selected (the default), a prism produces exactly one colored ray, so the
  // fan is gated behind the explicit white_light toggle. The lens's default (white_light off)
  // bundle sweeps ray_height_m at one fixed wavelength_nm — it's a "parallel rays converge to one
  // focal point" demo, not a color-mixing one, so that path is NOT gated by white_light and stays
  // on regardless. When white_light IS on, the lens switches to its own real white-light effect
  // instead: chromatic aberration (see buildLensChromaticBundle) — otherwise the toggle visibly
  // does nothing in lens mode, which is exactly the reported bug.
  const whiteLightOn = (paramsRef.current.white_light ?? 0) >= 0.5

  // The actual "aha" effect: N extra calls to the same pure step() with only wavelength_nm (prism
  // fan, lens chromatic aberration) or ray_height_m (lens default bundle) swept across a spread,
  // so the real dispersion/convergence math already in lib/physics/light.ts renders as a visible
  // rainbow fan / converging-ray bundle / chromatic-aberration spread instead of a single ray.
  // Recomputed only when `state` changes (useLiveScenario already gates step() calls behind an
  // actual param change), so this stays cheap — no per-frame cost beyond what a single ray
  // already had.
  const bundleObjects = useMemo(() => {
    if (isPrism && whiteLightOn) return buildPrismFan(paramsRef.current, state.t)
    if (isLens && whiteLightOn) return buildLensChromaticBundle(paramsRef.current, state.t)
    if (isLens) return buildLensBundle(paramsRef.current, state.t)
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrism, isLens, whiteLightOn, state])

  // For prism/lens, the two flat "interface"/"interface-2" plane markers are slab-only visual
  // stand-ins; swap them out for the wedge/lens set piece instead of drawing both (avoids a
  // flat plane floating through a wedge/lens mesh). The single-ray objects that the fan/bundle
  // replaces are also dropped here (they're re-added below, once as the default-width bundle,
  // once as the thicker highlight) so nothing double-draws. Every other SceneObject (the
  // untouched incident/reflected ray for prism, the focal-point sphere for lens) still renders
  // generically via ObjectRenderer, unchanged.
  // Matched by id, not reference: clipRayToAperture (lens aperture fix, above) can return clones
  // of highlightObjects' entries rather than the original state.objects references, so a
  // reference-based .includes() would miss those and double-draw the un-clipped original.
  // White-light fix (light-multiray-01 correction): the "incident-ray" leg is the ray BEFORE it
  // hits the glass, i.e. still the unmixed source beam. lib/physics/light.ts always colors it via
  // `rayColor` (wavelength_nm's own Bruton-mapped color) since step() only ever simulates one
  // wavelength per call — real single-wavelength light, correctly colored. But when the user has
  // explicitly flipped white_light on, that same slider wavelength is just one of the sample
  // wavelengths used to build the rainbow fan (prism) / chromatic-aberration spread (lens) below,
  // not "the" color of the light — white light is a mix of all of them, so the pre-glass ray
  // should read as white/neutral, with only the POST-refraction rays (already real per-wavelength
  // colors) showing the individual spectral hues. Applies to both prism and lens now that the
  // lens has its own real white-light effect (chromatic aberration) to split into.
  const whiteIncidentRay = (o: SceneObject) =>
    (isPrism || isLens) && whiteLightOn && o.id === "incident-ray" ? { ...o, color: "#ffffff" } : o

  const highlightIds = new Set(highlightObjects.map((o) => o.id))
  const renderedObjects = (isPrism || isLens
    ? state.objects.filter(
        (o) => o.id !== "interface" && o.id !== "interface-2" && !highlightIds.has(o.id)
      )
    : state.objects
  )
    .map(whiteIncidentRay)
    .filter((o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity))

  const finiteBundleObjects = bundleObjects.filter(
    (o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity)
  )
  // The lens's incident-ray (before the glass) lives inside highlightObjects, not
  // renderedObjects (see highlightObjects above) — needs the same white-light treatment so it
  // doesn't render as the slider's single-wavelength color while the chromatic bundle below
  // splits that same beam into its real per-wavelength rays.
  const finiteHighlightObjects = highlightObjects.map(whiteIncidentRay).filter(
    (o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity)
  )

  const apexAngleDeg = (interfaceObj?.meta?.apex_angle_deg as number | undefined) ?? 60

  // CRUD stage 3 drag handles (see the file-header note above IncidenceAngleControls for what's
  // real vs. decorative). Sourced straight off `state`/`interfaceObj` — the same values step()
  // just actually used this frame — rather than re-deriving from paramsRef, so a handle's own
  // position always matches what's genuinely on screen.
  const incidentRayObj = state.objects.find((o) => o.id === "incident-ray")
  const currentAngleDeg =
    (incidentRayObj?.meta?.angle_deg as number | undefined) ?? paramsRef.current.angle_deg ?? 30
  const currentRayHeightM = THREE.MathUtils.clamp(paramsRef.current.ray_height_m ?? 0.5, -1.5, 1.5)

  // Phase-continuity fix (see buildPhaseOffsets above): computed once over every ray object about
  // to be drawn as a WaveRay this frame — the main pass, the fan, and the highlight all share ids
  // that resolve to the same fixed chain topology, so one shared map covers all three loops below.
  const phaseOffsets = buildPhaseOffsets([...renderedObjects, ...finiteBundleObjects, ...finiteHighlightObjects])

  return (
    <group>
      {renderedObjects.map((o) =>
        o.kind === "ray" ? (
          <WaveRay key={o.id} object={o} phaseOffsetM={phaseOffsets.get(o.id) ?? 0} />
        ) : (
          <ObjectRenderer key={o.id} object={o} />
        )
      )}
      {finiteBundleObjects.map((o) =>
        o.kind === "ray" ? (
          <WaveRay key={o.id} object={o} phaseOffsetM={phaseOffsets.get(o.id) ?? 0} />
        ) : (
          <ObjectRenderer key={o.id} object={o} />
        )
      )}
      {finiteHighlightObjects.map((o) => (
        <HighlightRay key={`highlight-${o.id}`} object={o} phaseOffsetM={phaseOffsets.get(o.id) ?? 0} />
      ))}
      {isPrism && <PrismWedge apexAngleDeg={apexAngleDeg} />}
      {isLens && <LensShape converging={role === "convex-lens"} />}

      {/* CRUD stage 3 drag handles — see the note above IncidenceAngleControls for exactly what
          each one is real vs. decorative about. */}
      {!isLens && incidentRayObj && (
        <IncidenceAngleControls
          sourcePosition={incidentRayObj.position}
          angleDeg={currentAngleDeg}
          paramsRef={paramsRef}
        />
      )}
      {isPrism && <PrismApexControls apexAngleDeg={apexAngleDeg} paramsRef={paramsRef} />}
      {isLens && <LensRayHeightControls rayHeightM={currentRayHeightM} paramsRef={paramsRef} />}
    </group>
  )
}
