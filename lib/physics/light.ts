// Reflection + refraction (Snell's law) for a ray hitting a flat interface between two media.
//
// Params:
//   angle_deg   — angle of incidence, measured from the surface normal, in degrees. [0, 89]
//   n1          — refractive index of the medium the ray starts in (the denser medium the ray
//                 is leaving). Default 1.5 (glass). Range [1.0, 2.5].
//   n2          — refractive index of the medium the ray is entering. Default 1.0 (air).
//                 Range [1.0, 2.5].
//
// The ray always travels from medium n1 into medium n2. Sweeping angle_deg from 0 to 89 with
// n1 > n2 (the default: glass -> air) crosses the critical angle asin(n2/n1) — e.g. n1 = 1.5,
// n2 = 1.0 gives a critical angle of ~41.8°, so total internal reflection is visibly reachable
// by turning the angle slider past that point. That's the "aha" moment for this module.
//
// All vector work (reflect, dot, normalize, cross) goes through THREE.Vector3/THREE.Ray. Only
// Snell's law itself (n1 sin(theta1) = n2 sin(theta2)) is hand-written, since no generic vector
// library computes a refraction angle for you.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

export function step(params: ScenarioParams, t: number): ScenarioState {
  const angleDeg = params.angle_deg ?? 30
  const n1 = params.n1 ?? 1.5
  const n2 = params.n2 ?? 1.0

  const thetaI = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(angleDeg, 0, 89.9))

  // Flat interface at y = 0, normal pointing up (+Y). Incoming ray travels down-and-across
  // toward the origin, in the X-Y plane, hitting the surface at the origin.
  const normal = new THREE.Vector3(0, 1, 0)
  const hitPoint = new THREE.Vector3(0, 0, 0)

  // Incident direction (unit vector), coming FROM the source TOWARD the hit point.
  const incidentDir = new THREE.Vector3(Math.sin(thetaI), -Math.cos(thetaI), 0).normalize()
  const sourcePos = hitPoint.clone().sub(incidentDir.clone().multiplyScalar(4))

  // Reflection: THREE.Vector3.reflect expects the normal and reflects the vector "as is" (it
  // negates internally per THREE's convention of reflecting an incoming direction about the
  // normal), so we reflect the incident direction about the surface normal.
  const reflectedDir = incidentDir.clone().reflect(normal).normalize()

  // Snell's law: n1 sin(theta1) = n2 sin(theta2) -> sin(theta2) = (n1/n2) sin(theta1)
  const sinThetaT = (n1 / n2) * Math.sin(thetaI)
  const totalInternalReflection = Math.abs(sinThetaT) > 1

  const objects: SceneObject[] = []

  // Interface plane marker (visual reference for the surface), small flat box.
  objects.push({
    id: "interface",
    kind: "box",
    position: [0, 0, 0],
    color: "#334155",
    meta: { role: "interface", n1, n2 },
  })

  // Incident ray: from source to hit point.
  objects.push({
    id: "incident-ray",
    kind: "ray",
    position: [sourcePos.x, sourcePos.y, sourcePos.z],
    velocity: [incidentDir.x, incidentDir.y, incidentDir.z],
    color: "#fbbf24",
    meta: { role: "incident", angle_deg: angleDeg, wavelength_nm: 590 },
  })

  // Reflected ray: from hit point outward along reflectedDir.
  objects.push({
    id: "reflected-ray",
    kind: "ray",
    position: [hitPoint.x, hitPoint.y, hitPoint.z],
    velocity: [reflectedDir.x, reflectedDir.y, reflectedDir.z],
    color: "#f59e0b",
    meta: { role: "reflected", angle_deg: THREE.MathUtils.radToDeg(thetaI), wavelength_nm: 590 },
  })

  let thetaTDeg: number | null = null

  if (!totalInternalReflection) {
    const thetaT = Math.asin(sinThetaT)
    thetaTDeg = THREE.MathUtils.radToDeg(thetaT)

    // Build the refracted direction: tangential component scaled by (n1/n2), normal component
    // from cos(thetaT), pointing "through" the surface (continuing in -Y).
    const tangent = new THREE.Vector3(incidentDir.x, 0, incidentDir.z)
    if (tangent.lengthSq() > 1e-12) tangent.normalize()
    const refractedDir = tangent
      .multiplyScalar(Math.sin(thetaT))
      .add(new THREE.Vector3(0, -Math.cos(thetaT), 0))
      .normalize()

    objects.push({
      id: "refracted-ray",
      kind: "ray",
      position: [hitPoint.x, hitPoint.y, hitPoint.z],
      velocity: [refractedDir.x, refractedDir.y, refractedDir.z],
      color: "#38bdf8",
      meta: { role: "refracted", angle_deg: thetaTDeg, wavelength_nm: 590 },
    })
  }

  const criticalAngleDeg =
    n2 < n1 ? THREE.MathUtils.radToDeg(Math.asin(n2 / n1)) : null

  const readouts: ScenarioState["readouts"] = [
    { label: "angle of incidence", value: `${angleDeg.toFixed(1)} deg` },
    { label: "n1 (medium 1)", value: n1.toFixed(3) },
    { label: "n2 (medium 2)", value: n2.toFixed(3) },
    {
      label: "angle of refraction",
      value: totalInternalReflection ? "n/a (TIR)" : `${(thetaTDeg ?? 0).toFixed(1)} deg`,
    },
    { label: "total internal reflection", value: totalInternalReflection ? "yes" : "no" },
    {
      label: "critical angle",
      value: criticalAngleDeg !== null ? `${criticalAngleDeg.toFixed(1)} deg` : "n/a (n2 >= n1)",
    },
  ]

  return { t, objects, readouts }
}
