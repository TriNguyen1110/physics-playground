import { PALETTE } from "@/components/palette"

export type ModuleId = "light" | "projectiles" | "fields"

export type SliderConfig = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
  // "toggle" renders as a checkbox (0/1) instead of a range input — used
  // for boolean-shaped params like projectiles' drag_enabled.
  // "select" renders as a labeled button group instead of a bare numeric
  // slider — used for discrete mode-index params like light's element_type
  // or fields' source_type, where "0.00"/"2.00" on a slider is meaningless
  // to a user but "Slab / Prism / Convex / Concave" as clickable buttons
  // is immediately legible. `options` gives the label for each integer
  // value from min to max, in order.
  kind?: "range" | "toggle" | "select"
  options?: string[]
}

export const MODULE_META: Record<
  ModuleId,
  { label: string; accent: string; accentSoft: string; sliders: SliderConfig[] }
> = {
  light: {
    label: "Light & Optics",
    // Locked palette: light's identity is the toned-down/desaturated cyan accent.
    accent: PALETTE.cyan,
    accentSoft: "rgba(95, 163, 172, 0.16)",
    sliders: [
      // ranges/defaults match lib/physics/light.ts exactly (n1>n2 default
      // crosses the critical angle ~41.8deg as angle_deg increases — the
      // TIR "aha" moment).
      { key: "angle_deg", label: "Incidence angle", min: 0, max: 89, step: 0.5, default: 30, unit: "°" },
      { key: "n1", label: "n1 (medium 1)", min: 1.0, max: 2.5, step: 0.01, default: 1.5 },
      { key: "n2", label: "n2 (medium 2)", min: 1.0, max: 2.5, step: 0.01, default: 1.0 },
      // engine-05: 2nd interface (n2 -> n3), chained Snell's law, own
      // independent TIR/critical-angle check. Default equals n2's default
      // (1.0) — a physical no-op (theta3==theta2, straight-through) so the
      // module reduces exactly to the single-interface case until moved.
      { key: "n3", label: "n3 (medium 3, 2nd interface)", min: 1.0, max: 2.5, step: 0.01, default: 1.0 },
      // engine-04: wavelength drives both the ray's real rendered color
      // (Bruton wavelength->RGB) and a small real Cauchy dispersion on
      // n2/n3 — sweeping it visibly tints the ray and nudges the
      // refraction angle, like a prism.
      { key: "wavelength_nm", label: "Wavelength", min: 400, max: 700, step: 5, default: 590, unit: " nm" },
      // engine-07: selectable optical element. Default 0 (slab) is byte-identical to the
      // pre-existing engine-05 two-interface path — nothing below this line does anything
      // until element_type is actually changed.
      {
        key: "element_type",
        label: "Optical element",
        min: 0,
        max: 3,
        step: 1,
        default: 0,
        kind: "select",
        options: ["Slab", "Prism", "Convex lens", "Concave lens"],
      },
      { key: "apex_angle_deg", label: "Prism apex angle", min: 10, max: 90, step: 1, default: 60, unit: "°" },
      { key: "R1_m", label: "Lens R1", min: -2, max: 2, step: 0.05, default: 0.5, unit: " m" },
      { key: "R2_m", label: "Lens R2", min: -2, max: 2, step: 0.05, default: -0.5, unit: " m" },
      { key: "ray_height_m", label: "Ray height (lens)", min: -1.5, max: 1.5, step: 0.05, default: 0.5, unit: " m" },
      // light-multiray-01 correction: the prism's rainbow-fan (8 sampled wavelengths) is only
      // physically correct as a stand-in for WHITE light being dispersed — a single selected
      // wavelength through a prism produces exactly one colored ray, not a rainbow. Default OFF
      // so the base case is the physically correct monochromatic ray at the slider's own
      // wavelength_nm; flipping this on is an explicit "simulate white light" opt-in. Does not
      // affect the lens's ray-height convergence bundle (see LightScene.tsx), which sweeps
      // ray_height_m at one fixed wavelength and is unrelated to color mixing.
      { key: "white_light", label: "White light (rainbow)", min: 0, max: 1, step: 1, default: 0, kind: "toggle" },
    ],
  },
  projectiles: {
    label: "Projectiles",
    // Locked palette: projectiles' identity is the maroon accent (hot streak trail).
    accent: PALETTE.maroon,
    accentSoft: "rgba(156, 59, 82, 0.16)",
    sliders: [
      // speed/angle_deg/gravity match lib/physics/projectiles.ts. wall_*
      // are scene-owned set pieces (not read by engine's step()) that give
      // the "clears vs. hits the wall" aha moment.
      { key: "speed", label: "Launch speed", min: 1, max: 60, step: 0.5, default: 20, unit: "m/s" },
      { key: "angle_deg", label: "Launch angle", min: 1, max: 89, step: 1, default: 45, unit: "°" },
      { key: "gravity", label: "Gravity", min: 1, max: 20, step: 0.1, default: 9.81, unit: "m/s²" },
      // engine-04: mass/radius only change anything once drag is on
      // (Galileo equivalence principle keeps them inert in vacuum, by
      // design) — radius_m also drives the rendered ball size directly
      // (see ProjectilesScene.tsx), independent of drag.
      { key: "mass_kg", label: "Mass", min: 0.1, max: 50, step: 0.1, default: 1, unit: " kg" },
      { key: "radius_m", label: "Radius", min: 0.01, max: 1, step: 0.01, default: 0.1, unit: " m" },
      // Default OFF: matches lib/physics/projectiles.ts's own default (0)
      // and keeps the base-case ball/trajectory identical to the
      // already-verified no-drag regression until explicitly switched on.
      // Scene wires a matching linear-drag force into the flying Rapier
      // body when this is on (see ProjectilesScene.tsx DRAG_COEFFICIENT).
      { key: "drag_enabled", label: "Air drag", min: 0, max: 1, step: 1, default: 0, kind: "toggle" },
      { key: "wall_distance", label: "Wall distance", min: 2, max: 40, step: 0.5, default: 12, unit: "m" },
      { key: "wall_height", label: "Wall height", min: 0, max: 10, step: 0.25, default: 3, unit: "m" },
      // engine-09: launch_mode default 0 (manual) + azimuth_deg default 0 are both
      // byte-identical no-ops vs. the pre-existing engine-04 default trajectory.
      {
        key: "launch_mode",
        label: "Launch mode",
        min: 0,
        max: 1,
        step: 1,
        default: 0,
        kind: "select",
        options: ["Manual speed", "Spring"],
      },
      { key: "spring_k", label: "Spring constant k", min: 1, max: 2000, step: 1, default: 200, unit: " N/m" },
      { key: "spring_compression_m", label: "Spring compression", min: 0, max: 2, step: 0.05, default: 0.3, unit: " m" },
      { key: "azimuth_deg", label: "Launch azimuth", min: 0, max: 360, step: 1, default: 0, unit: "°" },
    ],
  },
  fields: {
    label: "Electric & Magnetic Fields",
    // Locked palette: fields' identity is neutral silver/white structure —
    // its charge polarity coloring already uses maroon (positive) / cyan
    // (negative), see FieldsScene.tsx, so the module's "accent" reads as
    // the neutral third color rather than competing with those.
    accent: PALETTE.silver,
    accentSoft: "rgba(199, 204, 214, 0.16)",
    sliders: [
      // matches lib/physics/fields.ts exactly (Coulomb between source
      // charges + Lorentz force on a test particle moving through a
      // uniform B field).
      { key: "charge1", label: "Charge 1", min: -5, max: 5, step: 0.1, default: 3, unit: "q" },
      { key: "charge2", label: "Charge 2", min: -5, max: 5, step: 0.1, default: -3, unit: "q" },
      // engine-05: 3rd source charge, off-axis (+Z) so it's a genuinely
      // independent source, not collinear with charge1/charge2. Default 0
      // makes it contribute exactly zero everywhere (0/r^2), so the module
      // reduces exactly to the old 2-charge behavior until moved.
      // charge3_offset fix (H+4.7): charge3 default nudged 0->1.5 so the offset slider is
      // no longer inert on load — same inert-slider bug class as separation's earlier fix.
      { key: "charge3", label: "Charge 3", min: -5, max: 5, step: 0.1, default: 1.5, unit: "q" },
      { key: "charge3_offset", label: "Charge 3 offset (+Z)", min: 0.5, max: 10, step: 0.1, default: 3, unit: "m" },
      // separation default nudged 4->5 (3rd fix in this class): at separation=4 the net
      // E-field (7.5 N/C along +X) exactly canceled v x B (-7.5 N/C along +X) at the other
      // defaults below, making test_charge inert — its ONLY effect is scaling that vector,
      // so a zero vector means test_charge changes nothing across its whole range no matter
      // what value it's set to. separation=5 makes E-field=4.8 N/C, which no longer cancels
      // v x B, so the net vector test_charge scales is nonzero (-2.7,0,0) at rest.
      { key: "separation", label: "Separation (1-2)", min: 0.5, max: 10, step: 0.1, default: 5, unit: "m" },
      { key: "test_charge", label: "Test particle charge", min: -5, max: 5, step: 0.1, default: 1, unit: "q" },
      // Both test_velocity and b_field default nonzero so v x B is nonzero at the default
      // state no matter which slider moves alone — either one defaulting to 0 makes the
      // other slider inert across its whole range (verifier scene-01 SCREEN fail, twice).
      { key: "test_velocity", label: "Test particle v (+Z)", min: 0, max: 20, step: 0.5, default: 5, unit: "m/s" },
      { key: "b_field", label: "Magnetic field (+Y)", min: 0, max: 5, step: 0.1, default: 1.5, unit: "T" },
      // engine-04: F=ma readout only, no new law — acceleration = lorentz_force / test_mass_kg.
      { key: "test_mass_kg", label: "Test particle mass", min: 0.1, max: 20, step: 0.1, default: 1, unit: " kg" },
      // engine-08: selectable field source. Default 0 (point_charges) is byte-identical to
      // the pre-existing engine-05/06 path.
      {
        key: "source_type",
        label: "Field source",
        min: 0,
        max: 3,
        step: 1,
        default: 0,
        kind: "select",
        options: ["Point charges", "Solenoid coil", "Capacitor", "Bar magnet"],
      },
      { key: "solenoid_turns_per_m", label: "Solenoid turns/m", min: 10, max: 5000, step: 10, default: 500 },
      { key: "solenoid_current_a", label: "Solenoid current", min: -10, max: 10, step: 0.1, default: 2, unit: " A" },
      { key: "capacitor_voltage_v", label: "Capacitor voltage", min: -1000, max: 1000, step: 5, default: 100, unit: " V" },
      { key: "capacitor_separation_m", label: "Capacitor plate gap", min: 0.01, max: 2, step: 0.01, default: 0.1, unit: " m" },
      { key: "magnet_moment", label: "Magnet moment", min: -50, max: 50, step: 0.5, default: 10 },
      { key: "magnet_distance_m", label: "Magnet distance", min: 0.5, max: 10, step: 0.1, default: 3, unit: " m" },
      { key: "magnet_angle_deg", label: "Magnet angle (0 axis/90 equatorial)", min: 0, max: 90, step: 1, default: 0, unit: "°" },
    ],
  },
}

export function defaultParams(module: ModuleId): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of MODULE_META[module].sliders) out[s.key] = s.default
  return out
}
