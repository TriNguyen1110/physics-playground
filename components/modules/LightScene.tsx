"use client"

import { useEffect, useMemo, type MutableRefObject } from "react"
import * as THREE from "three"
import { ObjectRenderer } from "@/components/ObjectRenderer"
import { PALETTE } from "@/components/palette"
import { useLiveScenario } from "@/components/modules/useLiveScenario"
import { step as lightStep } from "@/lib/physics/light"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

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

  // For prism/lens, the two flat "interface"/"interface-2" plane markers are slab-only visual
  // stand-ins; swap them out for the wedge/lens set piece instead of drawing both (avoids a
  // flat plane floating through a wedge/lens mesh). Every other SceneObject (rays, focal-point
  // sphere) still renders generically via ObjectRenderer, unchanged.
  const renderedObjects = (isPrism || isLens
    ? state.objects.filter((o) => o.id !== "interface" && o.id !== "interface-2")
    : state.objects
  ).filter((o) => isFiniteVec3(o.position) && isFiniteVec3(o.velocity))

  const apexAngleDeg = (interfaceObj?.meta?.apex_angle_deg as number | undefined) ?? 60

  return (
    <group>
      {renderedObjects.map((o) => (
        <ObjectRenderer key={o.id} object={o} />
      ))}
      {isPrism && <PrismWedge apexAngleDeg={apexAngleDeg} />}
      {isLens && <LensShape converging={role === "convex-lens"} />}
    </group>
  )
}
