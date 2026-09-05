"use client"

import { useEffect, useMemo, useRef, type MutableRefObject } from "react"
import * as THREE from "three"
import { Line } from "@react-three/drei"
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
// Points per ray segment — dense enough to look smooth, cheap enough that the rainbow fan (up
// to 8 extra rays) and lens bundle (up to 7 extra rays) don't cost real frame time.
const WAVE_POINTS_PER_SEGMENT = 28
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
  const base = id.replace(/-(fan|bundle)-\d+$/, "")
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
  const suffixOf = (id: string) => id.match(/-(?:fan|bundle)-\d+$/)?.[0] ?? ""
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
  const flat = useMemo(() => new Float32Array(WAVE_POINTS_PER_SEGMENT * 3), [])
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

  const initialPoints = useMemo<Vec3[]>(() => {
    const pts: Vec3[] = []
    for (let i = 0; i < WAVE_POINTS_PER_SEGMENT; i++) {
      const t = i / (WAVE_POINTS_PER_SEGMENT - 1)
      const p = origin.clone().addScaledVector(dirNorm, t * length)
      pts.push([p.x, p.y, p.z])
    }
    return pts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, dirNorm, length])

  useFrame((_, delta) => {
    phaseRef.current += delta * WAVE_PROPAGATION_SPEED
    const phase = phaseRef.current
    for (let i = 0; i < WAVE_POINTS_PER_SEGMENT; i++) {
      const t = i / (WAVE_POINTS_PER_SEGMENT - 1)
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
  // fan is gated behind the explicit white_light toggle. The lens bundle sweeps ray_height_m at
  // one fixed wavelength_nm — it's a "parallel rays converge to one focal point" demo, not a
  // color-mixing one, so it is NOT gated by white_light and stays on regardless.
  const whiteLightOn = (paramsRef.current.white_light ?? 0) >= 0.5

  // The actual "aha" effect: N extra calls to the same pure step() with only wavelength_nm (prism)
  // or ray_height_m (lens) swept across a spread, so the real dispersion/convergence math already
  // in lib/physics/light.ts renders as a visible rainbow fan / converging-ray bundle instead of a
  // single ray. Recomputed only when `state` changes (useLiveScenario already gates step() calls
  // behind an actual param change), so this stays cheap — no per-frame cost beyond what a single
  // ray already had.
  const bundleObjects = useMemo(() => {
    if (isPrism && whiteLightOn) return buildPrismFan(paramsRef.current, state.t)
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
  const highlightIds = new Set(highlightObjects.map((o) => o.id))
  const renderedObjects = (isPrism || isLens
    ? state.objects.filter(
        (o) => o.id !== "interface" && o.id !== "interface-2" && !highlightIds.has(o.id)
      )
    : state.objects
  )
    // White-light fix (light-multiray-01 correction): the "incident-ray" leg is the ray BEFORE
    // it hits the prism's glass, i.e. still the unmixed source beam. lib/physics/light.ts always
    // colors it via `rayColor` (wavelength_nm's own Bruton-mapped color) since step() only ever
    // simulates one wavelength per call — real single-wavelength light, correctly colored. But
    // when the user has explicitly flipped white_light on, that same slider wavelength is just
    // one of the PRISM_FAN_WAVELENGTHS_NM samples used to build the rainbow fan below, not "the"
    // color of the light — white light is a mix of all of them, so the pre-glass ray should read
    // as white/neutral, with only the POST-refraction fan rays (already real per-wavelength
    // colors) showing the individual spectral hues. Lens mode has no such "mixed before / split
    // after" framing (a lens doesn't disperse into a visible rainbow the way a prism does), so its
    // incident ray intentionally keeps the slider-wavelength color regardless of white_light.
    .map((o) => (isPrism && whiteLightOn && o.id === "incident-ray" ? { ...o, color: "#ffffff" } : o))
    .filter((o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity))

  const finiteBundleObjects = bundleObjects.filter(
    (o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity)
  )
  const finiteHighlightObjects = highlightObjects.filter(
    (o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity)
  )

  const apexAngleDeg = (interfaceObj?.meta?.apex_angle_deg as number | undefined) ?? 60

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
    </group>
  )
}
