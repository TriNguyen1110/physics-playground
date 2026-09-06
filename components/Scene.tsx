"use client"

import { Suspense, type MutableRefObject } from "react"
import { Environment, ContactShadows } from "@react-three/drei"
import { CameraRig, type CameraView } from "@/components/CameraRig"
import { SplatBackdrop } from "@/components/SplatBackdrop"
import { SimpleHallway } from "@/components/SimpleHallway"
import { LightScene } from "@/components/modules/LightScene"
import { FieldsScene } from "@/components/modules/FieldsScene"
import { ProjectilesScene } from "@/components/modules/ProjectilesScene"
import { PALETTE } from "@/components/palette"
import type { ModuleId } from "@/components/modules/types"
import type { ScenarioParams, ScenarioState } from "@/lib/physics/types"

// Beaker-by-Thix aesthetic: one dark laboratory void, never a different
// backdrop per module. Each module's identity lives in what glows, not in
// the environment behind it.
const VOID_COLOR = PALETTE.black

// Locked palette: each module's rim/fill light picks its glow out of the
// dark using the SAME accent it uses everywhere else (MODULE_META.accent),
// not an unrelated per-module hue.
const RIM_LIGHT_COLOR: Record<ModuleId, string> = {
  light: PALETTE.cyan,
  projectiles: PALETTE.maroon,
  fields: PALETTE.silver,
}

export function Scene({
  module,
  cameraView,
  showRoomContent,
  onSelectModule,
  paramsRef,
  onReadouts,
}: {
  module: ModuleId
  // Where the camera should actually be looking from — decoupled from
  // `module` (which drives which module's physics/UI is active) so the
  // "Home" button can pull the camera back out to the hub overview without
  // tearing down/changing the active module's content underneath it.
  cameraView: CameraView
  // Whether any room's 3D content should render at all. False on a fresh
  // page load (still standing in the hallway, no room picked yet) even
  // though `module` already has some default value for the params/UI
  // plumbing — without this, Light's rays/objects would render underneath
  // the hub camera before the user ever chose a room.
  showRoomContent: boolean
  // Lets SimpleHallway's clickable pedestal markers select a room directly,
  // same function the top-right tabs call.
  onSelectModule: (m: ModuleId) => void
  paramsRef: MutableRefObject<ScenarioParams>
  onReadouts: (r: ScenarioState["readouts"]) => void
}) {
  return (
    <>
      <color attach="background" args={[VOID_COLOR]} />
      {/* far bumped 30->70->110: the projectiles camera preset sits further
          back than that (see CameraRig.tsx) to fit both the default arc and
          steeper/faster launches the sliders can reach — at far=70 the
          ground/wall/ball were fogged down to near-indistinguishable-from-
          black at that distance, which was the root cause of the "empty
          canvas" bug, not a missing mesh. light/fields' cameras stay within
          ~10 units of their content and are unaffected by raising this. The
          same fog also does double duty on the splat backdrop below: it
          fades the splat's own baked lighting toward the void color at
          distance, which is what keeps a warmer-than-palette splat from
          fighting the cold black/maroon/cyan mood up close. */}
      <fog attach="fog" args={[VOID_COLOR, 8, module === "projectiles" ? 110 : 70]} />

      {/* The actual Marble/World Labs generated world, mounted once (not
          per-module) as the room the physics objects sit inside — see
          SplatBackdrop.tsx for the URL/scale/floor-alignment notes. This is
          the North-star merge: previously this world only existed as an
          external marble.worldlabs.ai link, completely disconnected from
          the app. */}
      <SplatBackdrop />

      {/* Simple, reliable primitive-based museum lobby — renders in place
          of the gap the now-disabled splat left behind at the hub/home
          view (no room picked yet, `showRoomContent` false). Plain
          boxes/materials only, no Spark/SplatMesh, per Tri's "no more
          hallway when I'm at home page [being a black void]" feedback —
          see SimpleHallway.tsx. Once a module is picked `showRoomContent`
          flips permanently true and this stops rendering, same as before. */}
      {!showRoomContent && <SimpleHallway onSelectModule={onSelectModule} />}

      <CameraRig view={cameraView} />

      {/* Dim, cold base lighting — the glowing simulation elements are the
          light source the eye actually reads, not this. */}
      <ambientLight intensity={module === "projectiles" ? 0.22 : 0.12} />
      <directionalLight position={[4, 6, 3]} intensity={0.25} color="#cfe8ff" />
      <pointLight position={[0, 3, 2]} intensity={0.6} color={RIM_LIGHT_COLOR[module]} distance={12} decay={2} />
      {/* Projectiles' camera sits much further from its content than the
          other two modules' (see CameraRig.tsx) — the two lights above are
          both tuned for a ~10-unit radius and don't reach the ground/wall
          out at ~20-40 units, so add a second, wider-throw fill light aimed
          down the range. */}
      {module === "projectiles" && (
        <pointLight position={[16, 18, 10]} intensity={1.4} color={PALETTE.maroon} distance={90} decay={1.6} />
      )}

      <Suspense fallback={null}>
        <Environment preset="night" background={false} environmentIntensity={0.25} />
      </Suspense>

      <ContactShadows position={[0, -0.16, 0]} opacity={0.35} scale={30} blur={2.5} far={10} color="#000000" />

      {showRoomContent && module === "light" && <LightScene paramsRef={paramsRef} onReadouts={onReadouts} />}
      {showRoomContent && module === "fields" && <FieldsScene paramsRef={paramsRef} onReadouts={onReadouts} />}
      {showRoomContent && module === "projectiles" && (
        <ProjectilesScene paramsRef={paramsRef} onReadouts={onReadouts} />
      )}
    </>
  )
}
