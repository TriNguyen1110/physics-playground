// Reflection + refraction (Snell's law) for a ray crossing TWO sequential flat interfaces:
// medium1 -> medium2 -> medium3 (e.g. air -> glass -> water). Two chained applications of
// Snell's law, each checked independently for total internal reflection — not a new law.
//
// Params:
//   angle_deg     — angle of incidence, measured from the surface normal, in degrees. [0, 89]
//   n1            — refractive index of the medium the ray starts in (the denser medium the ray
//                   is leaving). Default 1.5 (glass). Range [1.0, 2.5].
//   n2            — refractive index of the second medium, AT the reference wavelength 589nm
//                   (sodium D line). Default 1.0 (air). Range [1.0, 2.5].
//   n3            — refractive index of the THIRD medium the ray enters after crossing the
//                   second interface, at the reference wavelength. Default equals n2 (1.0), which
//                   makes the second interface a physical no-op (n3==n2 -> theta stays the same,
//                   ray keeps going straight through) so the module reduces EXACTLY to the old
//                   single-interface behavior when n3=n2 — nothing already-verified regresses.
//                   Range [1.0, 2.5].
//   wavelength_nm — visible wavelength of the ray, nm. Default 590 (was a fixed constant).
//                   Range [400, 700]. Drives two real effects:
//                     (a) the ray's rendered color, via a standard wavelength->RGB mapping
//                         (Bruton's algorithm, a public-domain piecewise formula).
//                     (b) a small real chromatic dispersion: the actual index of refraction
//                         used in Snell's law for medium 2/3 is n_eff(wavelength_nm), computed
//                         via Cauchy's equation n(lambda) = A + B/lambda^2, calibrated so
//                         n_eff(589nm) == the slider value exactly — this keeps the
//                         wavelength_nm=590 default numerically identical to the pre-existing
//                         behavior (regression-safe), while sweeping wavelength_nm away from
//                         590 now visibly changes the refraction angle by a small, physically
//                         real amount, same as a prism.
//
// The ray travels from medium n1 into medium n2 at the first (y=0) interface, then — if it
// isn't totally internally reflected there — continues from n2 into n3 at a second interface
// (y=-2), using the FIRST refracted ray's own direction as the second interface's incidence
// direction (chained Snell's law), with its own independent TIR check at n2->n3.
//
// Sweeping angle_deg from 0 to 89 with n1 > n2 (the default: glass -> air) crosses the first
// critical angle asin(n2/n1) — e.g. n1 = 1.5, n2 = 1.0 gives a critical angle of ~41.8°, so total
// internal reflection is visibly reachable by turning the angle slider past that point. That's
// the "aha" moment for this module; the second interface adds a second, independent one (e.g.
// glass -> water -> air can TIR at the second boundary even when the first one doesn't).
//
// All vector work (reflect, dot, normalize, cross) goes through THREE.Vector3/THREE.Ray. Only
// Snell's law itself (n1 sin(theta1) = n2 sin(theta2), applied twice), Cauchy's dispersion
// equation, and the wavelength->RGB piecewise formula are hand-written, since no generic vector
// library computes any of those for you.

import * as THREE from "three"
import type { ScenarioParams, ScenarioState, SceneObject } from "./types"

// Cauchy's equation coefficient B, in nm^2 (equivalent to the textbook ~0.00420 um^2 typical of
// crown glass), converted so the visible-spectrum dispersion spread it produces (~0.01-0.02 in
// index across 400-700nm) is a realistic small chromatic-dispersion effect, not an invented one.
const CAUCHY_B_NM2 = 4200
// Calibration wavelength for n2's slider value. Matches the module's pre-existing default
// wavelength_nm (590) exactly, so the default state's refraction numbers are byte-identical to
// the original no-wavelength-slider behavior (regression-safe).
const REFERENCE_WAVELENGTH_NM = 590

// Generic Cauchy-dispersion lookup, used for both the n2 and n3 sliders (same formula/law
// applied to whichever medium's slider value is passed in).
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
