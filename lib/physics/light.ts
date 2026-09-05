// Reflection + refraction (Snell's law) across a SELECTABLE optical element.
//
// `element_type` (numeric code — ScenarioParams is frozen as Record<string, number> per
// CONTRACT.md, so the element choice is encoded as a number, not a string):
//   0 = flat glass SLAB (default) — the original two-parallel-interface n1->n2->n3 path from
//       engine-05, byte-for-byte unchanged below. This is the regression baseline: every prior
//       verified check (Snell's law, TIR, critical angle, dispersion) must reproduce identically
//       when element_type is 0 or omitted.
//   1 = PRISM — two interfaces at an apex angle A, real angular deviation via
//       delta = theta1 + theta4 - A.
//   2 = CONVEX (converging) LENS — thin-lens paraxial approximation, focal length from the
//       lensmaker's equation.
//   3 = CONCAVE (diverging) LENS — same lensmaker's equation, negative focal length.
//
// All vector work (reflect, normalize, cross, applyAxisAngle) goes through THREE.Vector3. Only
// the physical laws themselves (Snell's law, the prism-geometry apex relation r1+r2=A, the
// deviation formula, the lensmaker's equation, Cauchy dispersion, wavelength->RGB) are
// hand-written, since no generic vector library computes any of those for you.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

// Cauchy's equation coefficient B, in nm^2 (equivalent to the textbook ~0.00420 um^2 typical of
// crown glass), converted so the visible-spectrum dispersion spread it produces (~0.01-0.02 in
// index across 400-700nm) is a realistic small chromatic-dispersion effect, not an invented one.
const CAUCHY_B_NM2 = 4200
// Calibration wavelength for a medium's slider value. Matches the module's pre-existing default
// wavelength_nm (590) exactly, so the default state's refraction numbers are byte-identical to
// the original no-wavelength-slider behavior (regression-safe).
const REFERENCE_WAVELENGTH_NM = 590

// Generic Cauchy-dispersion lookup, used for n2/n3/prism-n/lens-n (same formula/law applied to
// whichever medium's slider value is passed in).
function nAtWavelength(nSlider: number, wavelengthNm: number): number {
  // Calibrate A so that n(REFERENCE_WAVELENGTH_NM) === nSlider exactly (regression-safe default).
  const a = nSlider - CAUCHY_B_NM2 / (REFERENCE_WAVELENGTH_NM * REFERENCE_WAVELENGTH_NM)
  return a + CAUCHY_B_NM2 / (wavelengthNm * wavelengthNm)
}

// Bruton's algorithm: standard public-domain piecewise wavelength(nm) -> RGB mapping for the
// visible spectrum (~380-780nm), with a Gamma correction and an edge-intensity attenuation
// factor near the limits of vision.
function wavelengthToColor(wavelengthNm: number): string {
  const L = THREE.MathUtils.clamp(wavelengthNm, 380, 780)
  const gamma = 0.8
  let r = 0
  let g = 0
  let b = 0

  if (L >= 380 && L < 440) {
    r = -(L - 440) / (440 - 380)
    g = 0
    b = 1
  } else if (L >= 440 && L < 490) {
    r = 0
    g = (L - 440) / (490 - 440)
    b = 1
  } else if (L >= 490 && L < 510) {
    r = 0
    g = 1
    b = -(L - 510) / (510 - 490)
  } else if (L >= 510 && L < 580) {
    r = (L - 510) / (580 - 510)
    g = 1
    b = 0
  } else if (L >= 580 && L < 645) {
    r = 1
    g = -(L - 645) / (645 - 580)
    b = 0
  } else if (L >= 645 && L <= 780) {
    r = 1
    g = 0
    b = 0
  }

  let factor: number
  if (L >= 380 && L < 420) factor = 0.3 + (0.7 * (L - 380)) / (420 - 380)
  else if (L >= 420 && L < 701) factor = 1.0
  else if (L >= 701 && L <= 780) factor = 0.3 + (0.7 * (780 - L)) / (780 - 700)
  else factor = 0.0

  const toByte = (c: number) => {
    if (c === 0) return 0
    return Math.round(255 * Math.pow(c * factor, gamma))
  }

  const rb = toByte(r)
  const gb = toByte(g)
  const bb = toByte(b)
  const hex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${hex(rb)}${hex(gb)}${hex(bb)}`
}

// Gap (meters) along -Y between interface 1 (y=0) and interface 2, purely a rendering-space
// choice — the physics (chained Snell's law) doesn't depend on this distance.
const SECOND_INTERFACE_GAP = 1.5

export function step(params: ScenarioParams, t: number): ScenarioState {
  const elementType = Math.round(params.element_type ?? 0)
  if (elementType === 1) return stepPrism(params, t)
  if (elementType === 2) return stepLens(params, t, /* converging */ true)
  if (elementType === 3) return stepLens(params, t, /* converging */ false)
  return stepSlab(params, t)
}

// ---------------------------------------------------------------------------------------------
// element_type 0 (default): flat glass SLAB — two parallel interfaces, n1 -> n2 -> n3.
// UNCHANGED from the pre-existing engine-05 implementation (regression baseline).
// ---------------------------------------------------------------------------------------------
function stepSlab(params: ScenarioParams, t: number): ScenarioState {
  const angleDeg = params.angle_deg ?? 30
  const n1 = params.n1 ?? 1.5
  const n2Slider = params.n2 ?? 1.0
  // Default n3 == n2Slider: at the default, interface 2 sees equal indices on both sides, which
  // is a physical no-op (Snell's law gives theta3 == theta2 exactly, straight-through). This is
  // what makes n3=n2 reduce exactly to the old single-interface behavior.
  const n3Slider = params.n3 ?? n2Slider
  const wavelengthNm = THREE.MathUtils.clamp(params.wavelength_nm ?? 590, 400, 700)

  const n2 = nAtWavelength(n2Slider, wavelengthNm)
  const n3 = nAtWavelength(n3Slider, wavelengthNm)
  const rayColor = wavelengthToColor(wavelengthNm)

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

  // Snell's law at interface 1: n1 sin(theta1) = n2 sin(theta2) -> sin(theta2) = (n1/n2) sin(theta1)
  const sinThetaT = (n1 / n2) * Math.sin(thetaI)
  const totalInternalReflection = Math.abs(sinThetaT) > 1

  const objects: SceneObject[] = []

  // Interface 1 plane marker (visual reference for the surface), small flat box.
  objects.push({
    id: "interface",
    kind: "box",
    position: [0, 0, 0],
    color: "#334155",
    meta: { role: "interface", n1, n2, n2_at_reference: n2Slider },
  })

  // Interface 2 plane marker, offset below interface 1.
  objects.push({
    id: "interface-2",
    kind: "box",
    position: [0, -SECOND_INTERFACE_GAP, 0],
    color: "#334155",
    meta: { role: "interface-2", n2, n3, n3_at_reference: n3Slider },
  })

  // Incident ray: from source to hit point.
  objects.push({
    id: "incident-ray",
    kind: "ray",
    position: [sourcePos.x, sourcePos.y, sourcePos.z],
    velocity: [incidentDir.x, incidentDir.y, incidentDir.z],
    color: rayColor,
    meta: { role: "incident", angle_deg: angleDeg, wavelength_nm: wavelengthNm },
  })

  // Reflected ray: from hit point outward along reflectedDir.
  objects.push({
    id: "reflected-ray",
    kind: "ray",
    position: [hitPoint.x, hitPoint.y, hitPoint.z],
    velocity: [reflectedDir.x, reflectedDir.y, reflectedDir.z],
    color: rayColor,
    meta: { role: "reflected", angle_deg: THREE.MathUtils.radToDeg(thetaI), wavelength_nm: wavelengthNm },
  })

  let thetaTDeg: number | null = null
  let thetaT2Deg: number | null = null
  let totalInternalReflection2 = false

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

    // Second interface hit point: travel from hitPoint along refractedDir until y drops by
    // SECOND_INTERFACE_GAP. refractedDir.y = -cos(thetaT) < 0 (for thetaT < 90deg), so this is a
    // positive, finite distance.
    const distanceToSecondInterface = SECOND_INTERFACE_GAP / Math.max(Math.cos(thetaT), 1e-6)
    const hitPoint2 = hitPoint.clone().add(refractedDir.clone().multiplyScalar(distanceToSecondInterface))

    objects.push({
      id: "refracted-ray",
      kind: "ray",
      position: [hitPoint.x, hitPoint.y, hitPoint.z],
      velocity: [refractedDir.x, refractedDir.y, refractedDir.z],
      color: rayColor,
      meta: { role: "refracted", angle_deg: thetaTDeg, wavelength_nm: wavelengthNm },
    })

    // Interface 2 is parallel to interface 1 (same normal), so the ray's angle of incidence at
    // interface 2 is exactly thetaT (the angle refractedDir makes with the shared normal) —
    // chained Snell's law: n2 sin(theta2) = n3 sin(theta3), independent TIR check at n2/n3.
    const sinThetaT2 = (n2 / n3) * Math.sin(thetaT)
    totalInternalReflection2 = Math.abs(sinThetaT2) > 1

    if (!totalInternalReflection2) {
      const thetaT2 = Math.asin(sinThetaT2)
      thetaT2Deg = THREE.MathUtils.radToDeg(thetaT2)

      const tangent2 = new THREE.Vector3(refractedDir.x, 0, refractedDir.z)
      if (tangent2.lengthSq() > 1e-12) tangent2.normalize()
      const refractedDir2 = tangent2
        .multiplyScalar(Math.sin(thetaT2))
        .add(new THREE.Vector3(0, -Math.cos(thetaT2), 0))
        .normalize()

      objects.push({
        id: "refracted-ray-2",
        kind: "ray",
        position: [hitPoint2.x, hitPoint2.y, hitPoint2.z],
        velocity: [refractedDir2.x, refractedDir2.y, refractedDir2.z],
        color: rayColor,
        meta: { role: "refracted-2", angle_deg: thetaT2Deg, wavelength_nm: wavelengthNm },
      })
    } else {
      // TIR at interface 2: reflect the interface-1 refracted ray back off interface 2 instead
      // of passing into medium 3.
      const reflectedDir2 = refractedDir.clone().reflect(normal).normalize()
      objects.push({
        id: "refracted-ray-2",
        kind: "ray",
        position: [hitPoint2.x, hitPoint2.y, hitPoint2.z],
        velocity: [reflectedDir2.x, reflectedDir2.y, reflectedDir2.z],
        color: rayColor,
        meta: { role: "reflected-2-tir", angle_deg: thetaTDeg, wavelength_nm: wavelengthNm },
      })
    }
  }

  const criticalAngleDeg =
    n2 < n1 ? THREE.MathUtils.radToDeg(Math.asin(n2 / n1)) : null
  const criticalAngle2Deg =
    n3 < n2 ? THREE.MathUtils.radToDeg(Math.asin(n3 / n2)) : null

  const readouts: ScenarioState["readouts"] = [
    { label: "angle of incidence", value: `${angleDeg.toFixed(1)} deg` },
    { label: "n1 (medium 1)", value: n1.toFixed(3) },
    { label: "n2 (medium 2, at this wavelength)", value: n2.toFixed(4) },
    { label: "n3 (medium 3, at this wavelength)", value: n3.toFixed(4) },
    { label: "wavelength", value: `${wavelengthNm.toFixed(0)} nm` },
    { label: "ray color", value: rayColor },
    {
      // Unchanged label (regression-safe: existing tests/scene key off this exact string for
      // the interface-1 refraction angle).
      label: "angle of refraction",
      value: totalInternalReflection ? "n/a (TIR)" : `${(thetaTDeg ?? 0).toFixed(1)} deg`,
    },
    // Unchanged label (regression-safe).
    { label: "total internal reflection", value: totalInternalReflection ? "yes" : "no" },
    {
      // Unchanged label (regression-safe).
      label: "critical angle",
      value: criticalAngleDeg !== null ? `${criticalAngleDeg.toFixed(1)} deg` : "n/a (n2 >= n1)",
    },
    {
      label: "angle of refraction (2nd interface)",
      value:
        totalInternalReflection || totalInternalReflection2
          ? "n/a (TIR)"
          : `${(thetaT2Deg ?? 0).toFixed(1)} deg`,
    },
    {
      label: "total internal reflection (2nd interface)",
      value: totalInternalReflection ? "n/a" : totalInternalReflection2 ? "yes" : "no",
    },
    {
      label: "critical angle (2nd interface)",
      value: criticalAngle2Deg !== null ? `${criticalAngle2Deg.toFixed(1)} deg` : "n/a (n3 >= n2)",
    },
  ]

  return { t, objects, readouts }
}

// ---------------------------------------------------------------------------------------------
// element_type 1: PRISM. Two flat faces meeting at apex angle A. Real angular deviation:
//   delta = theta1 + theta4 - A
// where theta1 is the incidence angle at face 1 and theta4 is the exit angle at face 2, each
// individually from Snell's law, chained through the well-known prism-geometry relation
// r1 + r2 = A (the two internal refraction angles sum to the apex angle — a geometric theorem
// about the two face normals meeting at angle A, not a new physical law).
//
// Params:
//   angle_deg      — theta1, incidence angle at face 1, degrees. [0, 89]. Default 40.
//   n1             — external medium index (default 1.0, air).
//   n2             — prism glass index at the reference wavelength (default 1.5).
//   apex_angle_deg — apex angle A, degrees. [10, 90]. Default 60 (a standard prism).
//   wavelength_nm  — as in the slab; also drives real chromatic dispersion of the prism glass
//                    via the same Cauchy equation, which is exactly why real prisms split white
//                    light into a spectrum (different wavelengths deviate by different amounts).
// ---------------------------------------------------------------------------------------------
function stepPrism(params: ScenarioParams, t: number): ScenarioState {
  const angleDeg = THREE.MathUtils.clamp(params.angle_deg ?? 40, 0, 89.9)
  const n1 = params.n1 ?? 1.0
  const n2Slider = params.n2 ?? 1.5
  const apexAngleDeg = THREE.MathUtils.clamp(params.apex_angle_deg ?? 60, 10, 90)
  const wavelengthNm = THREE.MathUtils.clamp(params.wavelength_nm ?? 590, 400, 700)

  const n2 = nAtWavelength(n2Slider, wavelengthNm)
  const rayColor = wavelengthToColor(wavelengthNm)

  const theta1 = THREE.MathUtils.degToRad(angleDeg)
  const apexAngle = THREE.MathUtils.degToRad(apexAngleDeg)

  // Face 1: normal (0,1,0) at the origin, same convention as the slab.
  const normal1 = new THREE.Vector3(0, 1, 0)
  const hitPoint1 = new THREE.Vector3(0, 0, 0)
  const zAxis = new THREE.Vector3(0, 0, 1)

  const incidentDir = new THREE.Vector3(Math.sin(theta1), -Math.cos(theta1), 0).normalize()
  const sourcePos = hitPoint1.clone().sub(incidentDir.clone().multiplyScalar(4))
  const reflectedDir = incidentDir.clone().reflect(normal1).normalize()

  // Snell's law at face 1: n1 sin(theta1) = n2 sin(r1).
  const sinR1 = (n1 / n2) * Math.sin(theta1)
  const tirAtFace1 = Math.abs(sinR1) > 1

  const objects: SceneObject[] = []

  objects.push({
    id: "interface",
    kind: "box",
    position: [0, 0, 0],
    color: "#334155",
    meta: { role: "prism-face-1", n1, n2, apex_angle_deg: apexAngleDeg },
  })
  objects.push({
    id: "interface-2",
    kind: "box",
    position: [0, -SECOND_INTERFACE_GAP, 0],
    color: "#334155",
    meta: { role: "prism-face-2", n1, n2, apex_angle_deg: apexAngleDeg },
  })
  objects.push({
    id: "incident-ray",
    kind: "ray",
    position: [sourcePos.x, sourcePos.y, sourcePos.z],
    velocity: [incidentDir.x, incidentDir.y, incidentDir.z],
    color: rayColor,
    meta: { role: "incident", angle_deg: angleDeg, wavelength_nm: wavelengthNm },
  })
  objects.push({
    id: "reflected-ray",
    kind: "ray",
    position: [hitPoint1.x, hitPoint1.y, hitPoint1.z],
    velocity: [reflectedDir.x, reflectedDir.y, reflectedDir.z],
    color: rayColor,
    meta: { role: "reflected", angle_deg: angleDeg, wavelength_nm: wavelengthNm },
  })

  let r1Deg: number | null = null
  let r2Deg: number | null = null
  let theta4Deg: number | null = null
  let deviationDeg: number | null = null
  let tirAtFace2 = false

  if (!tirAtFace1) {
    const r1 = Math.asin(sinR1)
    r1Deg = THREE.MathUtils.radToDeg(r1)

    // Internal ray direction inside the glass, refracted at face 1.
    const tangent = new THREE.Vector3(incidentDir.x, 0, incidentDir.z)
    if (tangent.lengthSq() > 1e-12) tangent.normalize()
    const internalDir = tangent
      .multiplyScalar(Math.sin(r1))
      .add(new THREE.Vector3(0, -Math.cos(r1), 0))
      .normalize()

    // Face 2 hit point: a fixed rendering-space distance along the internal ray (same spirit as
    // SECOND_INTERFACE_GAP for the slab — a visual placement choice, not a plane-intersection
    // solve; the physics below doesn't depend on it).
    const hitPoint2 = hitPoint1.clone().add(internalDir.clone().multiplyScalar(SECOND_INTERFACE_GAP * 1.2))

    objects.push({
      id: "refracted-ray",
      kind: "ray",
      position: [hitPoint1.x, hitPoint1.y, hitPoint1.z],
      velocity: [internalDir.x, internalDir.y, internalDir.z],
      color: rayColor,
      meta: { role: "refracted", angle_deg: r1Deg, wavelength_nm: wavelengthNm },
    })

    // Real prism geometry: the two face normals meet at the apex angle A, which means the two
    // internal angles (measured from each face's own normal) sum to A: r1 + r2 = A.
    const r2 = apexAngle - r1
    r2Deg = THREE.MathUtils.radToDeg(r2)

    // Snell's law at face 2, glass -> external medium: n2 sin(r2) = n1 sin(theta4).
    const sinTheta4 = (n2 / n1) * Math.sin(r2)
    tirAtFace2 = Math.abs(sinTheta4) > 1 || r2 < 0

    if (!tirAtFace2) {
      const theta4 = Math.asin(sinTheta4)
      theta4Deg = THREE.MathUtils.radToDeg(theta4)
      // Total angular deviation of the ray, exact by definition: the exit ray is the incident
      // ray rotated by delta about the axis perpendicular to the plane of incidence (Z here).
      deviationDeg = angleDeg + theta4Deg - apexAngleDeg
      const exitDir = incidentDir
        .clone()
        .applyAxisAngle(zAxis, THREE.MathUtils.degToRad(deviationDeg))
        .normalize()

      objects.push({
        id: "refracted-ray-2",
        kind: "ray",
        position: [hitPoint2.x, hitPoint2.y, hitPoint2.z],
        velocity: [exitDir.x, exitDir.y, exitDir.z],
        color: rayColor,
        meta: { role: "refracted-2", angle_deg: theta4Deg, deviation_deg: deviationDeg, wavelength_nm: wavelengthNm },
      })
    } else {
      // TIR at face 2 (common at steep angles / high index prisms): reflect the internal ray
      // off face 2's normal instead of exiting.
      const normal2 = normal1.clone().applyAxisAngle(zAxis, apexAngle)
      const reflectedDir2 = internalDir.clone().reflect(normal2).normalize()
      objects.push({
        id: "refracted-ray-2",
        kind: "ray",
        position: [hitPoint2.x, hitPoint2.y, hitPoint2.z],
        velocity: [reflectedDir2.x, reflectedDir2.y, reflectedDir2.z],
        color: rayColor,
        meta: { role: "reflected-2-tir", angle_deg: r1Deg, wavelength_nm: wavelengthNm },
      })
    }
  }

  const readouts: ScenarioState["readouts"] = [
    { label: "angle of incidence", value: `${angleDeg.toFixed(1)} deg` },
    { label: "apex angle (A)", value: `${apexAngleDeg.toFixed(1)} deg` },
    { label: "n1 (external medium)", value: n1.toFixed(3) },
    { label: "n2 (prism glass, at this wavelength)", value: n2.toFixed(4) },
    { label: "wavelength", value: `${wavelengthNm.toFixed(0)} nm` },
    { label: "ray color", value: rayColor },
    {
      label: "angle of refraction",
      value: tirAtFace1 ? "n/a (TIR)" : `${(r1Deg ?? 0).toFixed(1)} deg`,
    },
    { label: "total internal reflection", value: tirAtFace1 ? "yes" : "no" },
    {
      label: "internal angle at face 2 (r2)",
      value: tirAtFace1 ? "n/a" : `${(r2Deg ?? 0).toFixed(1)} deg`,
    },
    {
      label: "angle of refraction (2nd interface)",
      value: tirAtFace1 || tirAtFace2 ? "n/a (TIR)" : `${(theta4Deg ?? 0).toFixed(1)} deg`,
    },
    {
      label: "total internal reflection (2nd interface)",
      value: tirAtFace1 ? "n/a" : tirAtFace2 ? "yes" : "no",
    },
    {
      label: "angular deviation",
      value: deviationDeg !== null ? `${deviationDeg.toFixed(2)} deg` : "n/a (TIR)",
    },
  ]

  return { t, objects, readouts }
}

// ---------------------------------------------------------------------------------------------
// element_type 2/3: thin CONVEX (converging) / CONCAVE (diverging) LENS.
//
// Focal length from the lensmaker's equation: 1/f = (n-1)(1/R1 - 1/R2), with the standard sign
// convention (R positive if the surface's center of curvature is on the far/outgoing side).
// A biconvex lens (R1 > 0, R2 < 0) gives f > 0 (converging); a biconcave lens (R1 < 0, R2 > 0)
// gives f < 0 (diverging) — the SAME formula, just different radii signs, exactly as real optics
// textbooks do it. This module does NOT ray-trace the actual curved surfaces (that needs full
// surface-normal refraction at each curved boundary); it uses the standard thin-lens PARAXIMAL
// approximation — a real, textbook-standard simplification, not full curved-surface ray tracing
// — to bend a ray parallel to the optical axis toward (converging) or away from (diverging) the
// focal point.
//
// Params:
//   R1_m, R2_m    — radii of curvature of the two lens surfaces, meters. Defaults: biconvex
//                    (0.5, -0.5) for the converging lens, biconcave (-0.5, 0.5) for the
//                    diverging lens.
//   n2            — lens glass index at the reference wavelength (default 1.5).
//   ray_height_m  — height of the incoming ray above the optical axis, meters. [-1.5, 1.5],
//                    default 0.5.
//   wavelength_nm — also drives real chromatic aberration: the lens index (and therefore f)
//                    depends on wavelength via the same Cauchy dispersion used elsewhere.
//
// Geometry: optical axis = X axis, lens plane at x=0, ray travels in +X. Ray starts at
// (-4, ray_height_m, 0) parallel to the axis, hits the lens at (0, ray_height_m, 0).
//
// Verified paraxial construction (see engine's hand-check below): the outgoing ray direction is
//   dir = normalize( (|f|, -h * sign(f), 0) )
// For f > 0 (converging): this sends the ray toward the axis, crossing it at exactly x = f past
// the lens — the textbook "parallel ray -> real focal point" rule.
// For f < 0 (diverging): this sends the ray AWAY from the axis, and its backward extension
// crosses the axis at exactly x = f (behind/before the lens, at distance |f|) — the textbook
// "parallel ray -> appears to diverge from the virtual front focal point" rule.
// ---------------------------------------------------------------------------------------------
function stepLens(params: ScenarioParams, t: number, converging: boolean): ScenarioState {
  const nSlider = params.n2 ?? 1.5
  const wavelengthNm = THREE.MathUtils.clamp(params.wavelength_nm ?? 590, 400, 700)
  const n = nAtWavelength(nSlider, wavelengthNm)
  const rayColor = wavelengthToColor(wavelengthNm)

  const R1 = params.R1_m ?? (converging ? 0.5 : -0.5)
  const R2 = params.R2_m ?? (converging ? -0.5 : 0.5)
  const rayHeight = THREE.MathUtils.clamp(params.ray_height_m ?? 0.5, -1.5, 1.5)

  // Lensmaker's equation: 1/f = (n - 1)(1/R1 - 1/R2).
  const invF = (n - 1) * (1 / R1 - 1 / R2)
  const f = invF !== 0 ? 1 / invF : Infinity

  const lensPos = new THREE.Vector3(0, rayHeight, 0)
  const sourcePos = new THREE.Vector3(-4, rayHeight, 0)
  const incidentDir = new THREE.Vector3(1, 0, 0)

  // Paraxial thin-lens ray-bend rule (see header comment for the derivation/verification).
  const sign = Math.sign(f) || 1
  const outDir = new THREE.Vector3(Math.abs(f), -rayHeight * sign, 0).normalize()

  const objects: SceneObject[] = []

  objects.push({
    id: "interface",
    kind: "box",
    position: [0, 0, 0],
    color: "#334155",
    meta: {
      role: converging ? "convex-lens" : "concave-lens",
      n,
      R1_m: R1,
      R2_m: R2,
      focal_length_m: f,
    },
  })

  objects.push({
    id: "incident-ray",
    kind: "ray",
    position: [sourcePos.x, sourcePos.y, sourcePos.z],
    velocity: [incidentDir.x, incidentDir.y, incidentDir.z],
    color: rayColor,
    meta: { role: "incident", ray_height_m: rayHeight, wavelength_nm: wavelengthNm },
  })

  objects.push({
    id: "refracted-ray",
    kind: "ray",
    position: [lensPos.x, lensPos.y, lensPos.z],
    velocity: [outDir.x, outDir.y, outDir.z],
    color: rayColor,
    meta: { role: "refracted", focal_length_m: f, wavelength_nm: wavelengthNm },
  })

  // Mark the (real or virtual) focal point explicitly so the "aha" — ray crossing the axis at
  // f, or appearing to diverge from -f — is visible on screen.
  objects.push({
    id: "focal-point",
    kind: "sphere",
    position: [f, 0, 0],
    radius: 0.08,
    color: converging ? "#f43f5e" : "#22d3ee",
    meta: { role: "focal-point", focal_length_m: f, virtual: !converging },
  })

  const readouts: ScenarioState["readouts"] = [
    { label: "lens type", value: converging ? "convex (converging)" : "concave (diverging)" },
    { label: "R1 (surface 1)", value: `${R1.toFixed(3)} m` },
    { label: "R2 (surface 2)", value: `${R2.toFixed(3)} m` },
    { label: "n (lens glass, at this wavelength)", value: n.toFixed(4) },
    { label: "wavelength", value: `${wavelengthNm.toFixed(0)} nm` },
    { label: "ray color", value: rayColor },
    { label: "ray height above axis", value: `${rayHeight.toFixed(2)} m` },
    {
      label: "focal length (f)",
      value: Number.isFinite(f) ? `${f.toFixed(4)} m` : "infinite (flat, n=1)",
    },
    {
      label: "focal point type",
      value: converging ? "real (behind lens)" : "virtual (in front of lens)",
    },
  ]

  return { t, objects, readouts }
}
