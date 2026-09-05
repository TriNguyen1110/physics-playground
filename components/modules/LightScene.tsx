"use client"

import { useEffect, useMemo, type MutableRefObject } from "react"
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
    sample.objects
      .filter((o) => o.id === "incident-ray" || o.id === "refracted-ray")
      .forEach((o) => bundled.push({ ...o, id: `${o.id}-bundle-${i}` }))
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

  // The current slider-selected ray, pulled out of the single-call `state` so it can be drawn
  // thicker/highlighted among the multi-ray bundle below rather than getting lost in the fan.
  // Prism: the post-first-face rays are where dispersion is visible. Lens: the incident +
  // bent ray at the slider's own ray_height_m.
  const highlightObjects = isPrism
    ? state.objects.filter((o) => o.id === "refracted-ray" || o.id === "refracted-ray-2")
    : isLens
      ? state.objects.filter((o) => o.id === "incident-ray" || o.id === "refracted-ray")
      : []

  // The actual "aha" effect: N extra calls to the same pure step() with only wavelength_nm (prism)
  // or ray_height_m (lens) swept across a spread, so the real dispersion/convergence math already
  // in lib/physics/light.ts renders as a visible rainbow fan / converging-ray bundle instead of a
  // single ray. Recomputed only when `state` changes (useLiveScenario already gates step() calls
  // behind an actual param change), so this stays cheap — no per-frame cost beyond what a single
  // ray already had.
  const bundleObjects = useMemo(() => {
    if (isPrism) return buildPrismFan(paramsRef.current, state.t)
    if (isLens) return buildLensBundle(paramsRef.current, state.t)
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPrism, isLens, state])

  // For prism/lens, the two flat "interface"/"interface-2" plane markers are slab-only visual
  // stand-ins; swap them out for the wedge/lens set piece instead of drawing both (avoids a
  // flat plane floating through a wedge/lens mesh). The single-ray objects that the fan/bundle
  // replaces are also dropped here (they're re-added below, once as the default-width bundle,
  // once as the thicker highlight) so nothing double-draws. Every other SceneObject (the
  // untouched incident/reflected ray for prism, the focal-point sphere for lens) still renders
  // generically via ObjectRenderer, unchanged.
  const renderedObjects = (isPrism || isLens
    ? state.objects.filter(
        (o) => o.id !== "interface" && o.id !== "interface-2" && !highlightObjects.includes(o)
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
