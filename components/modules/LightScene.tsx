"use client"

import { useEffect, useMemo, useRef, type MutableRefObject } from "react"
import * as THREE from "three"
import { Line } from "@react-three/drei"
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

/** Same geometry as ObjectRenderer's RayObject, but with a thicker/brighter line — used to pick
 * the current slider-selected ray out of the prism/lens bundle rather than losing it in the
 * fan. Duplicated (not imported) since ObjectRenderer.tsx is out of scope for this change. */
function HighlightRay({ object }: { object: SceneObject }) {
  const dir = object.velocity ?? [0, -1, 0]
  const length = (object.meta?.length as number) ?? 4
  const points = useMemo<[Vec3, Vec3]>(() => {
    const end: Vec3 = [
      object.position[0] + dir[0] * length,
      object.position[1] + dir[1] * length,
      object.position[2] + dir[2] * length,
    ]
    return [object.position, end]
  }, [object.position, dir, length])

  return <Line points={points} color={object.color} lineWidth={5} toneMapped={false} transparent opacity={1} />
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
  ).filter((o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity))

  const finiteBundleObjects = bundleObjects.filter(
    (o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity)
  )
  const finiteHighlightObjects = highlightObjects.filter(
    (o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity)
  )

  const apexAngleDeg = (interfaceObj?.meta?.apex_angle_deg as number | undefined) ?? 60

  return (
    <group>
      {renderedObjects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
      {finiteBundleObjects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
      {finiteHighlightObjects.map((o) => (
        <HighlightRay key={`highlight-${o.id}`} object={o} />
      ))}
      {isPrism && <PrismWedge apexAngleDeg={apexAngleDeg} />}
      {isLens && <LensShape converging={role === "convex-lens"} />}
    </group>
  )
}
