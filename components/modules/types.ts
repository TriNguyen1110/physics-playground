export type ModuleId = "light" | "projectiles" | "fields"

export type SliderConfig = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
}

export const MODULE_META: Record<
  ModuleId,
  { label: string; accent: string; accentSoft: string; sliders: SliderConfig[] }
> = {
  light: {
    label: "Light & Optics",
    accent: "#9be7ff", // cyan-white glow
    accentSoft: "rgba(155, 231, 255, 0.14)",
    sliders: [
      // ranges/defaults match lib/physics/light.ts exactly (n1>n2 default
      // crosses the critical angle ~41.8deg as angle_deg increases — the
      // TIR "aha" moment).
      { key: "angle_deg", label: "Incidence angle", min: 0, max: 89, step: 0.5, default: 30, unit: "°" },
      { key: "n1", label: "n1 (medium 1)", min: 1.0, max: 2.5, step: 0.01, default: 1.5 },
      { key: "n2", label: "n2 (medium 2)", min: 1.0, max: 2.5, step: 0.01, default: 1.0 },
    ],
  },
  projectiles: {
    label: "Projectiles",
    accent: "#ff7a45", // hot streak trail
    accentSoft: "rgba(255, 122, 69, 0.14)",
    sliders: [
      // speed/angle_deg/gravity match lib/physics/projectiles.ts. wall_*
      // are scene-owned set pieces (not read by engine's step()) that give
      // the "clears vs. hits the wall" aha moment.
      { key: "speed", label: "Launch speed", min: 1, max: 60, step: 0.5, default: 20, unit: "m/s" },
      { key: "angle_deg", label: "Launch angle", min: 1, max: 89, step: 1, default: 45, unit: "°" },
      { key: "gravity", label: "Gravity", min: 1, max: 20, step: 0.1, default: 9.81, unit: "m/s²" },
      { key: "wall_distance", label: "Wall distance", min: 2, max: 40, step: 0.5, default: 12, unit: "m" },
      { key: "wall_height", label: "Wall height", min: 0, max: 10, step: 0.25, default: 3, unit: "m" },
    ],
  },
  fields: {
    label: "Electric Fields",
    accent: "#8f6bff", // electric blue/violet
    accentSoft: "rgba(143, 107, 255, 0.14)",
    sliders: [
      // matches lib/physics/fields.ts exactly (Coulomb between the two
      // source charges + Lorentz force on a test particle moving through a
      // uniform B field).
      { key: "charge1", label: "Charge 1", min: -5, max: 5, step: 0.1, default: 3, unit: "q" },
      { key: "charge2", label: "Charge 2", min: -5, max: 5, step: 0.1, default: -3, unit: "q" },
      { key: "separation", label: "Separation", min: 0.5, max: 10, step: 0.1, default: 4, unit: "m" },
      { key: "test_charge", label: "Test particle charge", min: -5, max: 5, step: 0.1, default: 1, unit: "q" },
      // Both test_velocity and b_field default nonzero so v x B is nonzero at the default
      // state no matter which slider moves alone — either one defaulting to 0 makes the
      // other slider inert across its whole range (verifier scene-01 SCREEN fail, twice).
      { key: "test_velocity", label: "Test particle v (+Z)", min: 0, max: 20, step: 0.5, default: 5, unit: "m/s" },
      { key: "b_field", label: "Magnetic field (+Y)", min: 0, max: 5, step: 0.1, default: 1.5, unit: "T" },
    ],
  },
}

export function defaultParams(module: ModuleId): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of MODULE_META[module].sliders) out[s.key] = s.default
  return out
}
