// Locked palette (CLAUDE.md "North star"): maroon, toned-down/desaturated
// cyan, silver, black, white. Every module's glow/accent color comes from
// this set instead of each module inventing its own hue — this is what
// makes the three modules (and the dark void backdrop) read as one
// coherent thing. Maroon + cyan are the two accent colors, silver/white are
// neutral structure, black is the void.
export const PALETTE = {
  maroon: "#9c3b52", // desaturated maroon accent (projectiles' primary glow)
  cyan: "#5fa3ac", // toned-down/desaturated cyan accent (light's primary glow) — muted, not neon
  silver: "#c7ccd6", // neutral structure (fields' primary glow, ground/wall/test-particle accents)
  white: "#f3f2ee",
  black: "#05060a", // matches Scene.tsx VOID_COLOR
} as const
