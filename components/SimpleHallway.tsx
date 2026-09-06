"use client"

import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import type * as THREE from "three"
import { PALETTE } from "@/components/palette"
import { MODULE_META, type ModuleId } from "@/components/modules/types"

// Replaces the disabled Gaussian-splat hallway (see SplatBackdrop.tsx) as
// what renders at the hub/home view before a module is picked. That splat
// never reached a clean state after 8+ fix rounds (glitchy/tiny/disconnected/
// blurry) and was defaulted off, which left the hub view as a literal empty
// black void — this is a plain-primitives replacement (boxes/planes/cones,
// the same THREE.js every other module already renders reliably with, no
// Spark/SplatMesh dependency) so it can never regress into that failure
// class again.
//
// A simple museum-lobby diorama, NOT a walkable room (that's the exact
// scope Tri cut — see BOARD.tsv H+8.3/H+9.1, tabs are the permanent
// navigation method): floor + back wall + two side walls, open toward the
// hub camera (position [4,8,14.4] looking at [4,2,0], see CameraRig.tsx —
// read-only reference, not edited here), with three lit archway/pedestal
// markers along the back wall hinting at the three module "rooms," each
// tinted with that module's own MODULE_META.accent so the hub reads as
// "this leads to that room" without needing any interactivity here.

const ROOM_CENTER_X = 4
const FLOOR_Y = 0
const WALL_HEIGHT = 8
const BACK_Z = -9
const FRONT_Z = 11
const LEFT_X = ROOM_CENTER_X - 9
const RIGHT_X = ROOM_CENTER_X + 9

// Order matches ModuleSwitcher's own tab order (light, projectiles, fields)
// so a pedestal's left-to-right position roughly maps to its tab position.
const MODULE_ORDER: ModuleId[] = ["light", "projectiles", "fields"]

function Pedestal({ x, accent }: { x: number; accent: string }) {
  return (
    <group position={[x, FLOOR_Y, BACK_Z + 2.4]}>
      {/* Stone-toned base */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 1, 1.2]} />
        <meshStandardMaterial color={PALETTE.silver} metalness={0.35} roughness={0.7} />
      </mesh>
      {/* Glowing accent marker floating above the base — the module's own
          identity color, the "this leads to that room" nod. */}
      <mesh position={[0, 1.45, 0]}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={2.2}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, 1.7, 0]} color={accent} intensity={2.2} distance={7} decay={2} />
    </group>
  )
}

function Archway({ x, accent }: { x: number; accent: string }) {
  const halfWidth = 1.6
  const height = 4.4
  const thickness = 0.35
  return (
    <group position={[x, FLOOR_Y, BACK_Z + 0.15]}>
      {/* Left post */}
      <mesh position={[-halfWidth, height / 2, 0]}>
        <boxGeometry args={[thickness, height, thickness]} />
        <meshStandardMaterial color={PALETTE.silver} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Right post */}
      <mesh position={[halfWidth, height / 2, 0]}>
        <boxGeometry args={[thickness, height, thickness]} />
        <meshStandardMaterial color={PALETTE.silver} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Lintel */}
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[halfWidth * 2 + thickness, thickness, thickness]} />
        <meshStandardMaterial color={PALETTE.silver} metalness={0.5} roughness={0.5} />
      </mesh>
      {/* Thin emissive strip under the lintel, the accent glow that reads
          from across the room. */}
      <mesh position={[0, height - 0.22, 0]}>
        <boxGeometry args={[halfWidth * 2 - 0.1, 0.05, 0.06]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={3} toneMapped={false} />
      </mesh>
    </group>
  )
}

// Thin emissive grid lines resting just above the floor slab — reads as a
// faint lab-floor tile pattern instead of one flat black plane, without
// needing a reflective material (keeps the existing floor mesh/material
// untouched, this just lays lines on top of it).
function FloorGrid() {
  const spacingX = 3
  const spacingZ = 2.5
  const linesX = useMemo(() => {
    const out: number[] = []
    for (let x = LEFT_X + spacingX / 2; x < RIGHT_X; x += spacingX) out.push(x)
    return out
  }, [])
  const linesZ = useMemo(() => {
    const out: number[] = []
    for (let z = BACK_Z + spacingZ / 2; z < FRONT_Z; z += spacingZ) out.push(z)
    return out
  }, [])
  return (
    <group>
      {linesX.map((x) => (
        <mesh key={`gx-${x}`} position={[x, FLOOR_Y + 0.001, (BACK_Z + FRONT_Z) / 2]}>
          <boxGeometry args={[0.02, 0.01, FRONT_Z - BACK_Z]} />
          <meshStandardMaterial
            color={PALETTE.silver}
            emissive={PALETTE.silver}
            emissiveIntensity={0.35}
            transparent
            opacity={0.2}
            toneMapped={false}
          />
        </mesh>
      ))}
      {linesZ.map((z) => (
        <mesh key={`gz-${z}`} position={[ROOM_CENTER_X, FLOOR_Y + 0.001, z]}>
          <boxGeometry args={[RIGHT_X - LEFT_X, 0.01, 0.02]} />
          <meshStandardMaterial
            color={PALETTE.silver}
            emissive={PALETTE.silver}
            emissiveIntensity={0.35}
            transparent
            opacity={0.2}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

// Recessed ceiling light panels, thin emissive rectangles set slightly below
// the ceiling slab — a small nod to "considered space" rather than a plain
// dark lid, matching the neutral silver/white end of the locked palette so
// it doesn't compete with the per-module accent glow below.
function CeilingPanels() {
  const panelZ = [BACK_Z + 3, (BACK_Z + FRONT_Z) / 2, FRONT_Z - 3]
  const panelX = [LEFT_X + 3, ROOM_CENTER_X, RIGHT_X - 3]
  return (
    <group>
      {panelZ.map((z) =>
        panelX.map((x) => (
          <mesh key={`panel-${x}-${z}`} position={[x, WALL_HEIGHT - 0.11, z]} rotation={[Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, 0.7]} />
            <meshStandardMaterial
              color={PALETTE.white}
              emissive={PALETTE.white}
              emissiveIntensity={0.6}
              toneMapped={false}
            />
          </mesh>
        )),
      )}
    </group>
  )
}

// A couple of slim background columns against each side wall, set back
// toward the dark far end of the room — a cheap depth/scale cue so the
// space reads as bigger and more considered than four flat walls, without
// adding any new floor area to walk (this stays a diorama, not a walkable
// room, per BOARD.tsv H+8.3/H+9.1).
function Pillars() {
  const zPositions = [BACK_Z + 1.2, (BACK_Z + FRONT_Z) / 2 - 1, FRONT_Z - 2.5]
  return (
    <group>
      {zPositions.map((z, i) => (
        <group key={`pillar-${i}`}>
          <mesh position={[LEFT_X + 0.35, WALL_HEIGHT / 2, z]}>
            <cylinderGeometry args={[0.28, 0.32, WALL_HEIGHT, 12]} />
            <meshStandardMaterial color={PALETTE.silver} metalness={0.4} roughness={0.6} />
          </mesh>
          <mesh position={[RIGHT_X - 0.35, WALL_HEIGHT / 2, z]}>
            <cylinderGeometry args={[0.28, 0.32, WALL_HEIGHT, 12]} />
            <meshStandardMaterial color={PALETTE.silver} metalness={0.4} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// A handful of slow-drifting light motes — small emissive spheres with a
// gentle per-mote sinusoidal bob and pulse, purely decorative (no physics
// backing, this is atmosphere for the hub diorama, not a step() object).
// Kept to a small fixed count so it stays cheap and doesn't read as busy.
const MOTE_COUNT = 9
const MOTE_COLORS = [PALETTE.cyan, PALETTE.maroon, PALETTE.silver]

function LightMotes() {
  const motes = useMemo(() => {
    return Array.from({ length: MOTE_COUNT }, (_, i) => ({
      baseX: LEFT_X + 1.5 + ((i * 37) % (RIGHT_X - LEFT_X - 3)),
      baseY: 1.2 + ((i * 53) % 100) / 100 * 3.5,
      baseZ: BACK_Z + 1.5 + ((i * 71) % (FRONT_Z - BACK_Z - 3)),
      phase: (i / MOTE_COUNT) * Math.PI * 2,
      speed: 0.15 + ((i * 13) % 10) / 40,
      color: MOTE_COLORS[i % MOTE_COLORS.length],
    }))
  }, [])
  const refs = useRef<THREE.Mesh[]>([])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    motes.forEach((m, i) => {
      const mesh = refs.current[i]
      if (!mesh) return
      mesh.position.y = m.baseY + Math.sin(t * m.speed + m.phase) * 0.4
      mesh.position.x = m.baseX + Math.cos(t * m.speed * 0.6 + m.phase) * 0.3
      const mat = mesh.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 1.4 + Math.sin(t * m.speed * 1.5 + m.phase) * 0.7
    })
  })

  return (
    <group>
      {motes.map((m, i) => (
        <mesh key={i} ref={(el) => { if (el) refs.current[i] = el }} position={[m.baseX, m.baseY, m.baseZ]}>
          <sphereGeometry args={[0.045, 8, 8]} />
          <meshStandardMaterial color={m.color} emissive={m.color} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

export function SimpleHallway() {
  const pedestalX = useMemo(() => {
    const spacing = 5.5
    const startX = ROOM_CENTER_X - spacing
    return MODULE_ORDER.map((_, i) => startX + i * spacing)
  }, [])

  return (
    <group>
      {/* Floor */}
      <mesh position={[ROOM_CENTER_X, FLOOR_Y - 0.05, (BACK_Z + FRONT_Z) / 2]} receiveShadow>
        <boxGeometry args={[RIGHT_X - LEFT_X, 0.1, FRONT_Z - BACK_Z]} />
        <meshStandardMaterial color={PALETTE.black} metalness={0.2} roughness={0.85} />
      </mesh>

      {/* Back wall */}
      <mesh position={[ROOM_CENTER_X, WALL_HEIGHT / 2, BACK_Z]} receiveShadow>
        <boxGeometry args={[RIGHT_X - LEFT_X, WALL_HEIGHT, 0.3]} />
        <meshStandardMaterial color="#0b0c12" metalness={0.15} roughness={0.9} />
      </mesh>

      {/* Left wall */}
      <mesh position={[LEFT_X, WALL_HEIGHT / 2, (BACK_Z + FRONT_Z) / 2]} receiveShadow>
        <boxGeometry args={[0.3, WALL_HEIGHT, FRONT_Z - BACK_Z]} />
        <meshStandardMaterial color="#0b0c12" metalness={0.15} roughness={0.9} />
      </mesh>

      {/* Right wall */}
      <mesh position={[RIGHT_X, WALL_HEIGHT / 2, (BACK_Z + FRONT_Z) / 2]} receiveShadow>
        <boxGeometry args={[0.3, WALL_HEIGHT, FRONT_Z - BACK_Z]} />
        <meshStandardMaterial color="#0b0c12" metalness={0.15} roughness={0.9} />
      </mesh>

      {/* Ceiling, low-opacity so it doesn't crush the void feel from the
          elevated hub camera looking slightly down into the room. */}
      <mesh position={[ROOM_CENTER_X, WALL_HEIGHT, (BACK_Z + FRONT_Z) / 2]}>
        <boxGeometry args={[RIGHT_X - LEFT_X, 0.2, FRONT_Z - BACK_Z]} />
        <meshStandardMaterial color="#05060a" metalness={0.1} roughness={1} />
      </mesh>

      {/* Soft cold overhead fill so the room reads as a real lit space, not
          just silhouettes — kept dim, the pedestal/archway glow is still the
          brightest thing in frame per the Beaker-by-Thix "one glowing focal
          point in the dark" reference. */}
      <pointLight position={[ROOM_CENTER_X, WALL_HEIGHT - 0.6, 4]} color={PALETTE.white} intensity={0.5} distance={22} decay={2} />

      <FloorGrid />
      <CeilingPanels />
      <Pillars />
      <LightMotes />

      {MODULE_ORDER.map((m, i) => (
        <group key={m}>
          <Archway x={pedestalX[i]} accent={MODULE_META[m].accent} />
          <Pedestal x={pedestalX[i]} accent={MODULE_META[m].accent} />
        </group>
      ))}
    </group>
  )
}
